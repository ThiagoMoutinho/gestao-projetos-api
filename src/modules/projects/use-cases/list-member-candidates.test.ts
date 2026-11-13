import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { createInMemoryStore, makeInMemoryRepos, makeUser, noPlan } from "../test/in-memory";
import { makeListMemberCandidatesUseCase } from "./list-member-candidates";

function actor(role: AuthUser["role"], id: string): AuthUser {
  return { id, name: "Actor", email: `${id}@igepps.test`, role };
}

function setup() {
  const store = createInMemoryStore({
    users: [
      makeUser({ id: "owner-1", role: "GESTOR" }),
      makeUser({ id: "pmo-1", role: "PMO" }),
      makeUser({ id: "dev-1", role: "COLABORADOR" }),
      makeUser({ id: "sup-1", role: "FORNECEDOR" }),
    ],
    projects: [
      {
        id: "project-1",
        name: "Projeto",
        description: null,
        glpiTicketId: "12345",
        pmoGlpiTicketId: null,
        ownerId: "owner-1",
        status: "NAO_INICIADO",
        ...noPlan,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    members: [
      { id: "m-owner", projectId: "project-1", userId: "owner-1", role: "DONO_PROJETO", createdAt: new Date() },
      { id: "m-dev", projectId: "project-1", userId: "dev-1", role: "DESENVOLVEDOR", createdAt: new Date() },
    ],
  });
  const candidates = {
    listActive: async () => [
      { id: "sup-1", name: "Zélia Fornecedora", email: "sup-1@igepps.test", role: "FORNECEDOR" },
      { id: "dev-1", name: "Ana Dev", email: "dev-1@igepps.test", role: "COLABORADOR" },
    ],
  };
  return makeListMemberCandidatesUseCase({ repos: makeInMemoryRepos(store), candidates });
}

describe("ListMemberCandidates", () => {
  it("PMO, ADMIN e o dono do projeto recebem os usuários ativos em ordem alfabética", async () => {
    const list = setup();
    for (const who of [actor("PMO", "pmo-1"), actor("ADMIN", "admin-1"), actor("GESTOR", "owner-1")]) {
      const result = await list(who, "project-1");
      assert.deepEqual(result.data.map((row) => row.name), ["Ana Dev", "Zélia Fornecedora"]);
    }
  });

  it("colaborador e fornecedor não gerenciam a equipe (403)", async () => {
    const list = setup();
    for (const who of [actor("COLABORADOR", "dev-1"), actor("FORNECEDOR", "sup-1")]) {
      await assert.rejects(list(who, "project-1"), (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 403);
        return true;
      });
    }
  });

  it("projeto inexistente responde 404", async () => {
    const list = setup();
    await assert.rejects(list(actor("PMO", "pmo-1"), "nao-existe"), (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 404);
      return true;
    });
  });
});
