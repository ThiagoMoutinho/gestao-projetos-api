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

describe("CreateProject: situação inicial", () => {
  async function create(status?: "NAO_INICIADO" | "EM_EXECUCAO" | "SUSPENSO") {
    const store = createInMemoryStore({ users: [makeUser({ id: "actor-1", role: "PMO", name: "PMO" })] });
    const repos = makeInMemoryRepos(store);
    const createProject = makeCreateProjectUseCase({ repos, runInTransaction: makeInMemoryTransactionRunner(repos) });
    const project = await createProject(actor("PMO"), { name: "Projeto", ...(status ? { status } : {}) });
    return { store, project };
  }

  it("não registra evento quando o projeto nasce não iniciado", async () => {
    const { store } = await create();
    assert.equal(store.audit.filter((row) => row.action === "STATUS_CHANGE").length, 0);
    assert.equal((await create("NAO_INICIADO")).store.audit.length, 0);
  });

  it("registra a situação inicial, o responsável e o horário do servidor, uma única vez", async () => {
    for (const status of ["EM_EXECUCAO", "SUSPENSO"] as const) {
      const { store, project } = await create(status);
      const entries = store.audit.filter((row) => row.action === "STATUS_CHANGE");
      assert.equal(entries.length, 1);
      assert.equal(entries[0].projectId, project.id);
      assert.equal(entries[0].entityType, "PROJECT");
      assert.equal(entries[0].actorId, "actor-1");
      assert.ok(entries[0].createdAt instanceof Date);
      assert.deepEqual(entries[0].payload, { automatic: false, kind: "INITIAL_STATUS", from: null, to: status });
    }
  });
});
