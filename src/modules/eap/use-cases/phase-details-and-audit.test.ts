import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { listAuditQuerySchema } from "../schemas/eap-audit.schema";
import { createEvidenceBodySchema } from "../schemas/eap-evidences.schema";
import {
  createEapInMemoryStore,
  makeEapInMemoryRepos,
  makeEapInMemoryTransactionRunner,
  makeMember,
  makeProject,
  makeUser,
} from "../test/in-memory";
import { makeCreateEvidenceUseCase } from "./create-evidence";
import { makeCreatePhaseUseCase } from "./create-phase";
import { makeCreateTaskUseCase } from "./create-task";
import { makeListAuditUseCase } from "./list-audit";
import { makeListEvidencesUseCase } from "./list-evidences";
import { makeUpdatePhaseUseCase } from "./update-phase";
import { makeUpdateTaskUseCase } from "./update-task";

function actor(role: AuthUser["role"], id: string): AuthUser {
  return { id, name: id, email: `${id}@igepps.test`, role };
}

function setup() {
  const store = createEapInMemoryStore({
    users: [
      makeUser({ id: "pmo-1", role: "PMO", name: "PMO Um" }),
      makeUser({ id: "owner-1", role: "GESTOR" }),
      makeUser({ id: "dev-1", role: "COLABORADOR" }),
      makeUser({ id: "obs-1", role: "COLABORADOR" }),
      makeUser({ id: "outsider-1", role: "COLABORADOR" }),
    ],
    projects: [
      makeProject({ id: "project-1", ownerId: "owner-1" }),
      makeProject({ id: "project-2", ownerId: "owner-1" }),
    ],
    members: [
      makeMember({ id: "m-dev", projectId: "project-1", userId: "dev-1", role: "DESENVOLVEDOR" }),
      makeMember({ id: "m-obs", projectId: "project-1", userId: "obs-1", role: "OBSERVADOR" }),
    ],
  });
  const repos = makeEapInMemoryRepos(store);
  const runner = makeEapInMemoryTransactionRunner(repos, store);
  const deps = { repos, runInTransaction: runner };

  return {
    store,
    createPhase: makeCreatePhaseUseCase(deps),
    updatePhase: makeUpdatePhaseUseCase(deps),
    createTask: makeCreateTaskUseCase(deps),
    updateTask: makeUpdateTaskUseCase(deps),
    createEvidence: makeCreateEvidenceUseCase(deps),
    listEvidences: makeListEvidencesUseCase(deps),
    listAudit: makeListAuditUseCase(deps),
  };
}

const pmo = actor("PMO", "pmo-1");

describe("Fase: responsável e critério de conclusão", () => {
  it("grava responsável participante e critério na criação e na edição", async () => {
    const ctx = setup();
    const phase = await ctx.createPhase(pmo, "project-1", {
      name: "Execução",
      responsibleId: "dev-1",
      completionCriteria: "Todas as entregas homologadas.",
    
    plannedStartAt: "2026-06-01T15:00:00.000Z",
    plannedEndAt: "2026-06-30T15:00:00.000Z"});

    assert.equal(phase.responsibleId, "dev-1");
    assert.equal(phase.completionCriteria, "Todas as entregas homologadas.");

    const updated = await ctx.updatePhase(pmo, "project-1", phase.id, {
      responsibleId: "owner-1",
      completionCriteria: "Aceite formal do gestor.",
    });
    assert.equal(updated.responsibleId, "owner-1");
    assert.equal(updated.completionCriteria, "Aceite formal do gestor.");
    assert.equal(updated.plannedStartAt, phase.plannedStartAt);
    assert.equal(updated.baselineStartAt, phase.baselineStartAt);

    const cleared = await ctx.updatePhase(pmo, "project-1", phase.id, {
      responsibleId: null,
      completionCriteria: "",
    });
    assert.equal(cleared.responsibleId, null);
    assert.equal(cleared.completionCriteria, null);

    const audit = ctx.store.auditLogs.filter((row) => row.entityId === phase.id);
    const payload = audit.at(-2)?.payload as Record<string, unknown> | null | undefined;
    assert.equal(payload?.responsibleId, "owner-1");
    assert.equal(payload?.completionCriteria, "Aceite formal do gestor.");
  });

  it("rejeita responsável sem vínculo com o projeto", async () => {
    const ctx = setup();
    await assert.rejects(
      () =>
        ctx.createPhase(pmo, "project-1", { name: "Execução", responsibleId: "outsider-1" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"}),
      (error: unknown) =>
        error instanceof HttpError && error.code === "PHASE_RESPONSIBLE_NOT_MEMBER",
    );

    const phase = await ctx.createPhase(pmo, "project-1", { name: "Execução" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});
    await assert.rejects(
      () => ctx.updatePhase(pmo, "project-1", phase.id, { responsibleId: "inexistente" }),
      (error: unknown) => error instanceof HttpError && error.code === "USER_NOT_FOUND",
    );
    assert.equal(ctx.store.phases.find((row) => row.id === phase.id)?.responsibleId, null);
  });

  it("mantém a edição restrita a quem pode editar a fase", async () => {
    const ctx = setup();
    const phase = await ctx.createPhase(pmo, "project-1", { name: "Execução" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});

    await assert.rejects(
      () =>
        ctx.updatePhase(actor("COLABORADOR", "dev-1"), "project-1", phase.id, {
          completionCriteria: "Tentativa",
        }),
      (error: unknown) =>
        error instanceof HttpError && error.code === "PHASE_MANAGE_FORBIDDEN",
    );
  });
});

describe("Evidência vinculada à fase", () => {
  it("aceita fase como vínculo único no schema", () => {
    assert.equal(
      createEvidenceBodySchema.safeParse({ title: "Ata", url: "https://x.test", phaseId: "p" })
        .success,
      true,
    );
    assert.equal(
      createEvidenceBodySchema.safeParse({
        title: "Ata",
        url: "https://x.test",
        phaseId: "p",
        taskId: "t",
      }).success,
      false,
    );
  });

  it("registra e lista evidência da fase respeitando permissões", async () => {
    const ctx = setup();
    const phase = await ctx.createPhase(pmo, "project-1", {
      name: "Execução",
      responsibleId: "dev-1",
    
    plannedStartAt: "2026-06-01T15:00:00.000Z",
    plannedEndAt: "2026-06-30T15:00:00.000Z"});

    const evidence = await ctx.createEvidence(pmo, "project-1", {
      title: "Ata de abertura",
      url: "https://docs.test/ata",
      phaseId: phase.id,
    });
    assert.equal(evidence.phaseId, phase.id);
    assert.equal(evidence.taskId, null);

    const byResponsible = await ctx.createEvidence(actor("COLABORADOR", "dev-1"), "project-1", {
      title: "Checklist",
      url: "https://docs.test/check",
      phaseId: phase.id,
    });
    assert.equal(byResponsible.phaseId, phase.id);

    await assert.rejects(
      () =>
        ctx.createEvidence(actor("COLABORADOR", "obs-1"), "project-1", {
          title: "Tentativa",
          url: "https://docs.test/x",
          phaseId: phase.id,
        }),
      (error: unknown) =>
        error instanceof HttpError && error.code === "EVIDENCE_MANAGE_FORBIDDEN",
    );

    const listed = await ctx.listEvidences(pmo, "project-1", { phaseId: phase.id });
    assert.deepEqual(
      listed.data.map((row) => row.title),
      ["Ata de abertura", "Checklist"],
    );
  });

  it("não aceita fase de outro projeto", async () => {
    const ctx = setup();
    const other = await ctx.createPhase(pmo, "project-2", { name: "Outra" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});

    await assert.rejects(
      () =>
        ctx.createEvidence(pmo, "project-1", {
          title: "Ata",
          url: "https://docs.test/ata",
          phaseId: other.id,
        }),
      (error: unknown) =>
        error instanceof HttpError && error.code === "EVIDENCE_PARENT_NOT_FOUND",
    );
  });
});

describe("Histórico de alterações", () => {
  it("lista a auditoria do item e de suas evidências, mais recente primeiro", async () => {
    const ctx = setup();
    const phase = await ctx.createPhase(pmo, "project-1", { name: "Execução" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});
    await ctx.updatePhase(pmo, "project-1", phase.id, { name: "Execução revisada" });
    await ctx.createEvidence(pmo, "project-1", {
      title: "Ata",
      url: "https://docs.test/ata",
      phaseId: phase.id,
    });
    const task = await ctx.createTask(pmo, "project-1", phase.id, { title: "Tarefa" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});

    const history = await ctx.listAudit(pmo, "project-1", {
      entityType: "PHASE",
      entityId: phase.id,
    });

    assert.deepEqual(
      history.data.map((row) => `${row.entityType}:${row.action}`),
      ["EVIDENCE:CREATE", "PHASE:UPDATE", "PHASE:CREATE"],
    );
    assert.equal(history.data.some((row) => row.entityId === task.id), false);
    assert.equal(history.data.at(-1)?.summary, 'Fase "Execução" criada.');
    assert.equal(history.data[0].actorName, "PMO Um");
    assert.equal("payload" in history.data[0], false);
  });

  it("bloqueia quem não consulta o projeto e item de outro projeto", async () => {
    const ctx = setup();
    const phase = await ctx.createPhase(pmo, "project-1", { name: "Execução" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});
    const other = await ctx.createPhase(pmo, "project-2", { name: "Outra" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});

    await assert.rejects(
      () =>
        ctx.listAudit(actor("COLABORADOR", "outsider-1"), "project-1", {
          entityType: "PHASE",
          entityId: phase.id,
        }),
      (error: unknown) => error instanceof HttpError && error.code === "PROJECT_FORBIDDEN",
    );

    await assert.rejects(
      () =>
        ctx.listAudit(pmo, "project-1", { entityType: "PHASE", entityId: other.id }),
      (error: unknown) => error instanceof HttpError && error.code === "PHASE_NOT_FOUND",
    );
  });

  it("valida a consulta no schema", () => {
    assert.equal(
      listAuditQuerySchema.safeParse({ entityType: "EVIDENCE", entityId: "x" }).success,
      false,
    );
    assert.equal(
      listAuditQuerySchema.safeParse({ entityType: "TASK", entityId: "x", limit: "500" }).success,
      false,
    );
  });
});
