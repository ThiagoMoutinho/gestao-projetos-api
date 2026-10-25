import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import {
  createInMemoryStore,
  makeInMemoryRepos,
  makeInMemoryTransactionRunner,
  makeUser,
  noPlan,
} from "../test/in-memory";
import { makeAddProjectMemberUseCase } from "./add-project-member";

function actor(role: AuthUser["role"], id = "pmo-1"): AuthUser {
  return { id, name: "Actor", email: `${id}@igepps.test`, role };
}

function seedStore() {
  return createInMemoryStore({
    users: [
      makeUser({ id: "pmo-1", role: "PMO" }),
      makeUser({ id: "dev-1", role: "COLABORADOR" }),
    ],
    projects: [
      {
        id: "project-1",
        name: "Projeto",
        description: null,
        glpiTicketId: "12345",
        ownerId: "pmo-1",
        status: "NAO_INICIADO",
        ...noPlan,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    members: [
      {
        id: "member-owner",
        projectId: "project-1",
        userId: "pmo-1",
        role: "DONO_PROJETO",
        createdAt: new Date(),
      },
    ],
  });
}

describe("AddProjectMember", () => {
  it("permite adicionar a mesma pessoa com outra função", async () => {
    const store = seedStore();
    const repos = makeInMemoryRepos(store);
    const addMember = makeAddProjectMemberUseCase({
      repos,
      runInTransaction: makeInMemoryTransactionRunner(repos),
    });

    await addMember(actor("PMO"), "project-1", {
      userId: "dev-1",
      role: "DESENVOLVEDOR",
    });
    const second = await addMember(actor("PMO"), "project-1", {
      userId: "dev-1",
      role: "PO",
    });

    assert.equal(second.role, "PO");
    assert.equal(
      store.members.filter((row) => row.userId === "dev-1").length,
      2,
    );
    assert.deepEqual(
      store.audit.map((entry) => [entry.action, entry.entityType, entry.actorId, entry.payload.role]),
      [
        ["MEMBER_ADD", "PROJECT_MEMBER", "pmo-1", "DESENVOLVEDOR"],
        ["MEMBER_ADD", "PROJECT_MEMBER", "pmo-1", "PO"],
      ],
    );
    assert.equal(store.audit[1].entityId, second.id);
    assert.equal(store.audit[1].payload.userId, "dev-1");
  });

  it("rejeita participante duplicado com a mesma função", async () => {
    const store = seedStore();
    const repos = makeInMemoryRepos(store);
    const addMember = makeAddProjectMemberUseCase({
      repos,
      runInTransaction: makeInMemoryTransactionRunner(repos),
    });

    await addMember(actor("PMO"), "project-1", {
      userId: "dev-1",
      role: "DESENVOLVEDOR",
    });

    await assert.rejects(
      () =>
        addMember(actor("PMO"), "project-1", {
          userId: "dev-1",
          role: "DESENVOLVEDOR",
        }),
      (error: unknown) =>
        error instanceof HttpError && error.code === "PROJECT_MEMBER_DUPLICATE",
    );
    assert.equal(store.audit.length, 1);
  });
});
