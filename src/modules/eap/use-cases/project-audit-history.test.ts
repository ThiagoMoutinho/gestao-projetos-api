import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import type { ProjectRepos } from "../../projects/repositories/contracts";
import { makeInMemoryRepos, makeInMemoryTransactionRunner } from "../../projects/test/in-memory";
import { makeAddProjectMemberUseCase } from "../../projects/use-cases/add-project-member";
import { makeRemoveProjectMemberUseCase } from "../../projects/use-cases/remove-project-member";
import { makeTransferProjectOwnerUseCase } from "../../projects/use-cases/transfer-project-owner";
import { makeUpdateProjectUseCase } from "../../projects/use-cases/update-project";
import { makeUpdateProjectMemberUseCase } from "../../projects/use-cases/update-project-member";
import { eapAuditListResponseSchema } from "../schemas/eap-audit.schema";
import {
  createEapInMemoryStore,
  type EapInMemoryStore,
  makeEapInMemoryRepos,
  makeMember,
  makeProject,
  makeUser,
} from "../test/in-memory";
import { makeCreatePhaseUseCase } from "./create-phase";
import { makeListAuditUseCase } from "./list-audit";

function actor(role: AuthUser["role"], id: string): AuthUser {
  return { id, name: id, email: `${id}@igepps.test`, role };
}

const pmo = actor("PMO", "pmo-1");
const owner = actor("GESTOR", "owner-1");
const supplier = actor("FORNECEDOR", "forn-1");
const observer = actor("COLABORADOR", "obs-1");
const outsider = actor("COLABORADOR", "outsider-1");

/** Os casos de uso de projetos gravam na mesma trilha (eap_audit_logs) que a consulta lê. */
function projectReposOn(store: EapInMemoryStore): ProjectRepos {
  return {
    ...makeInMemoryRepos(store),
    audit: {
      async create(data) {
        store.auditLogs.push({ ...data, id: crypto.randomUUID(), createdAt: new Date() });
      },
    },
  };
}

function setup() {
  const store = createEapInMemoryStore({
    users: [
      makeUser({ id: "pmo-1", role: "PMO", name: "PMO Um", email: "pmo@igepps.test" }),
      makeUser({ id: "owner-1", role: "GESTOR", name: "Dono Atual" }),
      makeUser({ id: "owner-2", role: "GESTOR", name: "Novo Dono" }),
      makeUser({ id: "dev-1", role: "COLABORADOR", name: "Dev Um", email: "dev@igepps.test" }),
      makeUser({ id: "forn-1", role: "FORNECEDOR" }),
      makeUser({ id: "obs-1", role: "COLABORADOR" }),
      makeUser({ id: "outsider-1", role: "COLABORADOR" }),
    ],
    projects: [
      makeProject({ id: "project-1", ownerId: "owner-1" }),
      makeProject({ id: "project-2", ownerId: "owner-1" }),
    ],
    members: [
      makeMember({ id: "m-owner", projectId: "project-1", userId: "owner-1", role: "DONO_PROJETO" }),
      makeMember({ id: "m-forn", projectId: "project-1", userId: "forn-1", role: "FORNECEDOR" }),
      makeMember({ id: "m-obs", projectId: "project-1", userId: "obs-1", role: "OBSERVADOR" }),
    ],
  });
  const projectRepos = projectReposOn(store);
  const projectDeps = {
    repos: projectRepos,
    runInTransaction: makeInMemoryTransactionRunner(projectRepos),
  };
  const eapRepos = makeEapInMemoryRepos(store);
  return {
    store,
    addMember: makeAddProjectMemberUseCase(projectDeps),
    updateMember: makeUpdateProjectMemberUseCase(projectDeps),
    removeMember: makeRemoveProjectMemberUseCase(projectDeps),
    updateProject: makeUpdateProjectUseCase(projectDeps),
    transferOwner: makeTransferProjectOwnerUseCase(projectDeps),
    createPhase: makeCreatePhaseUseCase({
      repos: eapRepos,
      runInTransaction: async (fn) => fn(eapRepos),
    }),
    listAudit: makeListAuditUseCase({ repos: eapRepos }),
  };
}

function isForbidden(error: unknown) {
  return error instanceof HttpError && error.code === "PROJECT_AUDIT_FORBIDDEN";
}

describe("Consulta do histórico de participantes", () => {
  it("lista inclusão, troca de função e remoção do participante, mesmo após a remoção", async () => {
    const ctx = setup();
    const added = await ctx.addMember(pmo, "project-1", { userId: "dev-1", role: "DESENVOLVEDOR" });
    await ctx.updateMember(pmo, "project-1", added.id, { role: "PO" });
    await ctx.removeMember(pmo, "project-1", added.id);

    const history = await ctx.listAudit(pmo, "project-1", {
      entityType: "PROJECT_MEMBER",
      entityId: added.id,
    });

    assert.deepEqual(
      history.data
        .map((entry) => [entry.details.kind, entry.details.fromRole, entry.details.toRole])
        .sort(),
      [
        ["MEMBER_ADDED", null, "DESENVOLVEDOR"],
        ["MEMBER_REMOVED", "PO", null],
        ["MEMBER_ROLE_CHANGED", "DESENVOLVEDOR", "PO"],
      ],
    );
    for (const entry of history.data) {
      assert.equal(entry.entityType, "PROJECT_MEMBER");
      assert.equal(entry.actorId, "pmo-1");
      assert.equal(entry.actorName, "PMO Um");
      assert.equal(entry.details.memberName, "Dev Um");
      assert.ok(entry.createdAt);
    }
  });

  it("não expõe e-mails nem identificadores de usuários do payload", async () => {
    const ctx = setup();
    const added = await ctx.addMember(pmo, "project-1", { userId: "dev-1", role: "DESENVOLVEDOR" });

    const history = await ctx.listAudit(pmo, "project-1", {
      entityType: "PROJECT_MEMBER",
      entityId: added.id,
    });
    const serialized = JSON.stringify(eapAuditListResponseSchema.parse(history));

    assert.equal(serialized.includes("@igepps.test"), false);
    assert.equal(serialized.includes("\"dev-1\""), false);
  });

  it("não devolve eventos de participantes de outro projeto", async () => {
    const ctx = setup();
    const added = await ctx.addMember(pmo, "project-2", { userId: "dev-1", role: "DESENVOLVEDOR" });

    const history = await ctx.listAudit(pmo, "project-1", {
      entityType: "PROJECT_MEMBER",
      entityId: added.id,
    });

    assert.equal(history.data.length, 0);
  });
});

describe("Consulta do histórico do projeto", () => {
  it("lista alteração de status e transferências de titularidade com valores anteriores e novos", async () => {
    const ctx = setup();
    await ctx.updateProject(pmo, "project-1", { status: "EM_EXECUCAO" });
    await ctx.transferOwner(pmo, "project-1", "owner-2");

    const history = await ctx.listAudit(pmo, "project-1", {
      entityType: "PROJECT",
      entityId: "project-1",
    });

    const status = history.data.find((entry) => entry.details.kind === "STATUS");
    const transfer = history.data.find((entry) => entry.details.kind === "OWNER_TRANSFERRED");
    assert.equal(history.data.length, 2);
    assert.equal(status?.details.fromStatus, "NAO_INICIADO");
    assert.equal(status?.details.toStatus, "EM_EXECUCAO");
    assert.equal(status?.details.automatic, false);
    assert.equal(transfer?.details.fromOwnerName, "Dono Atual");
    assert.equal(transfer?.details.toOwnerName, "Novo Dono");
  });

  it("não registra nem lista eventos de operações que não alteram dados", async () => {
    const ctx = setup();
    await ctx.updateProject(pmo, "project-1", { status: "NAO_INICIADO" });
    await ctx.updateProject(pmo, "project-1", { name: "Outro nome" });
    await ctx.transferOwner(pmo, "project-1", "owner-1");
    await ctx.updateMember(pmo, "project-1", "m-obs", { role: "OBSERVADOR" });

    const projectHistory = await ctx.listAudit(pmo, "project-1", {
      entityType: "PROJECT",
      entityId: "project-1",
    });
    const memberHistory = await ctx.listAudit(pmo, "project-1", {
      entityType: "PROJECT_MEMBER",
      entityId: "m-obs",
    });

    assert.equal(projectHistory.data.length, 0);
    assert.equal(memberHistory.data.length, 0);
    assert.equal(ctx.store.auditLogs.length, 0);
  });

  it("recusa consultar o histórico de outro projeto pelo identificador", async () => {
    const ctx = setup();

    await assert.rejects(
      () => ctx.listAudit(pmo, "project-1", { entityType: "PROJECT", entityId: "project-2" }),
      (error: unknown) => error instanceof HttpError && error.code === "PROJECT_NOT_FOUND",
    );
  });
});

describe("Acesso ao histórico de governança", () => {
  it("permite ao dono do projeto consultar", async () => {
    const ctx = setup();
    await ctx.updateProject(pmo, "project-1", { status: "EM_EXECUCAO" });

    const history = await ctx.listAudit(owner, "project-1", {
      entityType: "PROJECT",
      entityId: "project-1",
    });

    assert.equal(history.data.length, 1);
  });

  it("impede fornecedor e observador vinculados de consultar projeto e participantes", async () => {
    const ctx = setup();

    for (const user of [supplier, observer]) {
      await assert.rejects(
        () => ctx.listAudit(user, "project-1", { entityType: "PROJECT", entityId: "project-1" }),
        isForbidden,
      );
      await assert.rejects(
        () => ctx.listAudit(user, "project-1", { entityType: "PROJECT_MEMBER", entityId: "m-obs" }),
        isForbidden,
      );
    }
  });

  it("impede usuário sem vínculo de consultar", async () => {
    const ctx = setup();

    await assert.rejects(
      () => ctx.listAudit(outsider, "project-1", { entityType: "PROJECT", entityId: "project-1" }),
      (error: unknown) => error instanceof HttpError && error.statusCode === 403,
    );
  });

  it("mantém o histórico de fase acessível a quem vê o projeto e sem eventos de governança", async () => {
    const ctx = setup();
    const phase = await ctx.createPhase(pmo, "project-1", {
      name: "Fase 1",
    });
    await ctx.updateProject(pmo, "project-1", { status: "EM_EXECUCAO" });

    const history = await ctx.listAudit(observer, "project-1", {
      entityType: "PHASE",
      entityId: phase.id,
    });

    assert.ok(history.data.length > 0);
    assert.ok(history.data.every((entry) => entry.entityType === "PHASE"));
    assert.ok(history.data.every((entry) => entry.details.memberName === null));
  });
});
