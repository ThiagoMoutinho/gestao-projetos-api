import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import {
  createInMemoryStore,
  makeInMemoryRepos,
  makeUser,
  noPlan,
} from "../test/in-memory";
import { makeGetProjectUseCase } from "./get-project";

function actor(role: AuthUser["role"], id: string): AuthUser {
  return { id, name: "Actor", email: `${id}@igepps.test`, role };
}

describe("GetProject", () => {
  it("impede FORNECEDOR de consultar projeto sem vínculo", async () => {
    const store = createInMemoryStore({
      users: [
        makeUser({ id: "owner-1", role: "GESTOR" }),
        makeUser({ id: "forn-1", role: "FORNECEDOR" }),
      ],
      projects: [
        {
          id: "project-1",
          name: "Projeto interno",
          description: null,
          glpiTicketId: null,
          ownerId: "owner-1",
          status: "EM_EXECUCAO",
          ...noPlan,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      members: [],
    });
    const getProject = makeGetProjectUseCase({ repos: makeInMemoryRepos(store) });

    await assert.rejects(
      () => getProject(actor("FORNECEDOR", "forn-1"), "project-1"),
      (error: unknown) =>
        error instanceof HttpError && error.code === "PROJECT_FORBIDDEN",
    );
  });

  it("permite FORNECEDOR consultar somente projeto em que participa", async () => {
    const store = createInMemoryStore({
      users: [
        makeUser({ id: "owner-1", role: "GESTOR", name: "Dono" }),
        makeUser({ id: "forn-1", role: "FORNECEDOR" }),
      ],
      projects: [
        {
          id: "project-1",
          name: "Projeto interno",
          description: null,
          glpiTicketId: null,
          ownerId: "owner-1",
          status: "EM_EXECUCAO",
          ...noPlan,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      members: [
        {
          id: "member-forn",
          projectId: "project-1",
          userId: "forn-1",
          role: "FORNECEDOR",
          createdAt: new Date(),
        },
      ],
    });
    const getProject = makeGetProjectUseCase({ repos: makeInMemoryRepos(store) });
    const project = await getProject(actor("FORNECEDOR", "forn-1"), "project-1");

    assert.equal(project.id, "project-1");
    assert.deepEqual(project.roles, ["FORNECEDOR"]);
    assert.equal(project.isOwner, false);
  });
});
