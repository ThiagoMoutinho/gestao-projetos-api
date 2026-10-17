import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import {
  createInMemoryStore,
  makeInMemoryRepos,
  makeInMemoryTransactionRunner,
  makeUser,
} from "../test/in-memory";
import { makeCreateProjectUseCase } from "./create-project";

function actor(role: AuthUser["role"], id = "actor-1"): AuthUser {
  return { id, name: "Actor", email: `${id}@igepps.test`, role };
}

describe("CreateProject", () => {
  it("permite ADMIN e PMO cadastrar projeto e cria o participante DONO_PROJETO", async () => {
    const store = createInMemoryStore({
      users: [makeUser({ id: "actor-1", role: "PMO", name: "PMO" })],
    });
    const repos = makeInMemoryRepos(store);
    const createProject = makeCreateProjectUseCase({
      repos,
      runInTransaction: makeInMemoryTransactionRunner(repos),
    });

    const project = await createProject(actor("PMO"), {
      name: "Modernização GLPI",
    });

    assert.equal(project.name, "Modernização GLPI");
    assert.equal(project.ownerId, "actor-1");
    assert.equal(project.isOwner, true);
    assert.deepEqual(project.roles, ["DONO_PROJETO"]);
    assert.equal(store.members.length, 1);
    assert.equal(store.members[0].role, "DONO_PROJETO");
  });

  it("impede COLABORADOR e FORNECEDOR de cadastrar projeto", async () => {
    const store = createInMemoryStore({
      users: [makeUser({ id: "actor-1", role: "COLABORADOR" })],
    });
    const repos = makeInMemoryRepos(store);
    const createProject = makeCreateProjectUseCase({
      repos,
      runInTransaction: makeInMemoryTransactionRunner(repos),
    });

    await assert.rejects(
      () => createProject(actor("COLABORADOR"), { name: "Projeto X" }),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 403 &&
        error.code === "PROJECT_CREATE_FORBIDDEN",
    );
  });

  it("não permite GESTOR atribuir outro usuário como dono", async () => {
    const store = createInMemoryStore({
      users: [
        makeUser({ id: "actor-1", role: "GESTOR" }),
        makeUser({ id: "other", role: "GESTOR" }),
      ],
    });
    const repos = makeInMemoryRepos(store);
    const createProject = makeCreateProjectUseCase({
      repos,
      runInTransaction: makeInMemoryTransactionRunner(repos),
    });

    await assert.rejects(
      () =>
        createProject(actor("GESTOR"), {
          name: "Projeto X",
          ownerId: "other",
        }),
      (error: unknown) =>
        error instanceof HttpError && error.code === "PROJECT_CREATE_FORBIDDEN",
    );
  });
});
