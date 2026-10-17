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
import { makeTransferProjectOwnerUseCase } from "./transfer-project-owner";

function actor(role: AuthUser["role"], id = "pmo-1"): AuthUser {
  return { id, name: "Actor", email: `${id}@igepps.test`, role };
}

describe("TransferProjectOwner", () => {
  it("transfere o dono e mantém a participação DONO_PROJETO consistente", async () => {
    const store = createInMemoryStore({
      users: [
        makeUser({ id: "owner-1", role: "GESTOR", name: "Dono atual" }),
        makeUser({ id: "owner-2", role: "GESTOR", name: "Novo dono" }),
        makeUser({ id: "pmo-1", role: "PMO", name: "PMO" }),
      ],
      projects: [
        {
          id: "project-1",
          name: "Projeto",
          description: null,
          glpiTicketId: null,
          ownerId: "owner-1",
          status: "NAO_INICIADO",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      members: [
        {
          id: "member-owner",
          projectId: "project-1",
          userId: "owner-1",
          role: "DONO_PROJETO",
          createdAt: new Date(),
        },
      ],
    });
    const repos = makeInMemoryRepos(store);
    const transfer = makeTransferProjectOwnerUseCase({
      repos,
      runInTransaction: makeInMemoryTransactionRunner(repos),
    });

    const project = await transfer(actor("PMO"), "project-1", "owner-2");

    assert.equal(project.ownerId, "owner-2");
    assert.equal(
      store.members.some(
        (row) => row.userId === "owner-1" && row.role === "DONO_PROJETO",
      ),
      false,
    );
    assert.equal(
      store.members.some(
        (row) => row.userId === "owner-2" && row.role === "DONO_PROJETO",
      ),
      true,
    );
  });

  it("impede GESTOR que não é o titular de transferir o dono", async () => {
    const store = createInMemoryStore({
      users: [
        makeUser({ id: "owner-1", role: "GESTOR" }),
        makeUser({ id: "gestor-2", role: "GESTOR" }),
      ],
      projects: [
        {
          id: "project-1",
          name: "Projeto",
          description: null,
          glpiTicketId: null,
          ownerId: "owner-1",
          status: "NAO_INICIADO",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      members: [
        {
          id: "member-gestor",
          projectId: "project-1",
          userId: "gestor-2",
          role: "GESTOR",
          createdAt: new Date(),
        },
      ],
    });
    const repos = makeInMemoryRepos(store);
    const transfer = makeTransferProjectOwnerUseCase({
      repos,
      runInTransaction: makeInMemoryTransactionRunner(repos),
    });

    await assert.rejects(
      () => transfer(actor("GESTOR", "gestor-2"), "project-1", "gestor-2"),
      (error: unknown) =>
        error instanceof HttpError &&
        error.code === "PROJECT_OWNER_TRANSFER_FORBIDDEN",
    );
  });
});
