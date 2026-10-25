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
import { makeRemoveProjectMemberUseCase } from "./remove-project-member";
import { makeUpdateProjectUseCase } from "./update-project";
import { makeUpdateProjectMemberUseCase } from "./update-project-member";

function actor(role: AuthUser["role"], id = "pmo-1"): AuthUser {
  return { id, name: "Actor", email: `${id}@igepps.test`, role };
}

function setup() {
  const store = createInMemoryStore({
    users: [
      makeUser({ id: "pmo-1", role: "PMO", name: "PMO" }),
      makeUser({ id: "owner-1", role: "GESTOR", name: "Dono atual" }),
      makeUser({ id: "owner-2", role: "GESTOR", name: "Novo dono" }),
      makeUser({ id: "dev-1", role: "COLABORADOR", name: "Dev" }),
    ],
    projects: [
      {
        id: "project-1",
        name: "Projeto",
        description: null,
        glpiTicketId: null,
        ownerId: "owner-1",
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
        userId: "owner-1",
        role: "DONO_PROJETO",
        createdAt: new Date(),
      },
      {
        id: "member-dev",
        projectId: "project-1",
        userId: "dev-1",
        role: "DESENVOLVEDOR",
        createdAt: new Date(),
      },
    ],
  });
  const repos = makeInMemoryRepos(store);
  const deps = { repos, runInTransaction: makeInMemoryTransactionRunner(repos) };
  return { store, deps };
}

describe("Auditoria de participantes", () => {
  it("registra a alteração de função com valores anterior e novo", async () => {
    const { store, deps } = setup();
    const updateMember = makeUpdateProjectMemberUseCase(deps);

    const updated = await updateMember(actor("PMO"), "project-1", "member-dev", { role: "PO" });

    assert.equal(updated.role, "PO");
    assert.equal(store.audit.length, 1);
    const [entry] = store.audit;
    assert.equal(entry.action, "MEMBER_UPDATE");
    assert.equal(entry.entityType, "PROJECT_MEMBER");
    assert.equal(entry.entityId, "member-dev");
    assert.equal(entry.actorId, "pmo-1");
    assert.deepEqual(entry.payload, {
      memberId: "member-dev",
      userId: "dev-1",
      userName: "Dev",
      fromRole: "DESENVOLVEDOR",
      toRole: "PO",
    });
  });

  it("não registra alteração quando a função permanece a mesma", async () => {
    const { store, deps } = setup();
    const updateMember = makeUpdateProjectMemberUseCase(deps);

    await updateMember(actor("PMO"), "project-1", "member-dev", { role: "DESENVOLVEDOR" });

    assert.equal(store.audit.length, 0);
  });

  it("registra a remoção do participante com a função que ele exercia", async () => {
    const { store, deps } = setup();
    const removeMember = makeRemoveProjectMemberUseCase(deps);

    await removeMember(actor("PMO"), "project-1", "member-dev");

    assert.equal(store.members.some((row) => row.id === "member-dev"), false);
    assert.equal(store.audit.length, 1);
    assert.equal(store.audit[0].action, "MEMBER_REMOVE");
    assert.deepEqual(store.audit[0].payload, {
      memberId: "member-dev",
      userId: "dev-1",
      userName: "Dev",
      role: "DESENVOLVEDOR",
    });
  });

  it("não registra nada quando a remoção do dono é bloqueada", async () => {
    const { store, deps } = setup();
    const removeMember = makeRemoveProjectMemberUseCase(deps);

    await assert.rejects(
      () => removeMember(actor("PMO"), "project-1", "member-owner"),
      (error: unknown) =>
        error instanceof HttpError && error.code === "PROJECT_OWNER_MEMBER_PROTECTED",
    );
    assert.equal(store.audit.length, 0);
  });
});

describe("Auditoria de status e titularidade do projeto", () => {
  it("registra a alteração de status com a situação anterior e a nova", async () => {
    const { store, deps } = setup();
    const updateProject = makeUpdateProjectUseCase(deps);

    await updateProject(actor("PMO"), "project-1", { status: "EM_EXECUCAO" });

    assert.equal(store.audit.length, 1);
    const [entry] = store.audit;
    assert.equal(entry.action, "STATUS_CHANGE");
    assert.equal(entry.entityType, "PROJECT");
    assert.equal(entry.entityId, "project-1");
    assert.equal(entry.actorId, "pmo-1");
    assert.deepEqual(entry.payload, { automatic: false, from: "NAO_INICIADO", to: "EM_EXECUCAO" });
  });

  it("não registra status quando apenas outros campos mudam ou o status é o mesmo", async () => {
    const { store, deps } = setup();
    const updateProject = makeUpdateProjectUseCase(deps);

    await updateProject(actor("PMO"), "project-1", { name: "Novo nome" });
    await updateProject(actor("PMO"), "project-1", { status: "NAO_INICIADO" });

    assert.equal(store.audit.length, 0);
  });

  it("registra a transferência de titularidade feita pela edição do projeto", async () => {
    const { store, deps } = setup();
    const updateProject = makeUpdateProjectUseCase(deps);

    await updateProject(actor("PMO"), "project-1", { ownerId: "owner-2", status: "EM_EXECUCAO" });

    assert.deepEqual(
      store.audit.map((entry) => entry.action),
      ["OWNER_TRANSFER", "STATUS_CHANGE"],
    );
    assert.deepEqual(store.audit[0].payload, {
      fromOwnerId: "owner-1",
      fromOwnerName: "Dono atual",
      toOwnerId: "owner-2",
      toOwnerName: "Novo dono",
    });
  });
});
