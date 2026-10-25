import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import {
  createEvidenceBodySchema,
  updateEvidenceBodySchema,
} from "../schemas/eap-evidences.schema";
import {
  createEapInMemoryStore,
  makeEapInMemoryRepos,
  makeEapInMemoryTransactionRunner,
  makeMember,
  makeProject,
  makeUser,
} from "../test/in-memory";
import { makeCreateEvidenceUseCase } from "./create-evidence";
import { makeCreateMilestoneUseCase } from "./create-milestone";
import { makeCreatePhaseUseCase } from "./create-phase";
import { makeCreateTaskUseCase } from "./create-task";
import { makeGetEvidenceUseCase } from "./get-evidence";
import { makeListEvidencesUseCase } from "./list-evidences";
import { makeUpdateEvidenceUseCase } from "./update-evidence";

function actor(role: AuthUser["role"], id: string): AuthUser {
  return { id, name: id, email: `${id}@igepps.test`, role };
}

async function setup() {
  const store = createEapInMemoryStore({
    users: [
      makeUser({ id: "pmo-1", role: "PMO" }),
      makeUser({ id: "admin-1", role: "ADMIN" }),
      makeUser({ id: "coord-1", role: "COORDENADOR" }),
      makeUser({ id: "owner-1", role: "GESTOR" }),
      makeUser({ id: "gestor-1", role: "GESTOR" }),
      makeUser({ id: "dev-1", role: "COLABORADOR" }),
      makeUser({ id: "forn-1", role: "FORNECEDOR" }),
      makeUser({ id: "obs-1", role: "COLABORADOR" }),
      makeUser({ id: "outsider-1", role: "COLABORADOR" }),
    ],
    projects: [
      makeProject({ id: "project-1", ownerId: "owner-1", name: "Projeto Alfa" }),
      makeProject({ id: "project-2", ownerId: "owner-1", name: "Projeto Beta" }),
    ],
    members: [
      makeMember({
        id: "m-gestor",
        projectId: "project-1",
        userId: "gestor-1",
        role: "GESTOR",
      }),
      makeMember({
        id: "m-dev",
        projectId: "project-1",
        userId: "dev-1",
        role: "DESENVOLVEDOR",
      }),
      makeMember({
        id: "m-forn",
        projectId: "project-1",
        userId: "forn-1",
        role: "FORNECEDOR",
      }),
      makeMember({
        id: "m-obs",
        projectId: "project-1",
        userId: "obs-1",
        role: "OBSERVADOR",
      }),
    ],
    scheduleRequests: [
      { id: "sched-1", projectId: "project-1" },
      { id: "sched-2", projectId: "project-2" },
    ],
  });
  const repos = makeEapInMemoryRepos(store);
  const runner = makeEapInMemoryTransactionRunner(repos, store);
  const deps = { repos, runInTransaction: runner };
  const createPhase = makeCreatePhaseUseCase(deps);
  const createTask = makeCreateTaskUseCase(deps);
  const createMilestone = makeCreateMilestoneUseCase(deps);
  const phase = await createPhase(actor("PMO", "pmo-1"), "project-1", { name: "Execução" });
  const otherPhase = await createPhase(actor("PMO", "pmo-1"), "project-2", { name: "Outra" });
  const task = await createTask(actor("PMO", "pmo-1"), "project-1", phase.id, {
    title: "Levantar requisitos",
  
  plannedStartAt: "2026-06-01T15:00:00.000Z",
  plannedEndAt: "2026-06-30T15:00:00.000Z"});
  const otherTask = await createTask(actor("PMO", "pmo-1"), "project-2", otherPhase.id, {
    title: "Tarefa de outro projeto",
  
  plannedStartAt: "2026-06-01T15:00:00.000Z",
  plannedEndAt: "2026-06-30T15:00:00.000Z"});
  const milestone = await createMilestone(actor("PMO", "pmo-1"), "project-1", phase.id, {
    title: "Entrega parcial",
    type: "ENTREGA",
  
  plannedAt: "2026-06-15T15:00:00.000Z"});

  return {
    store,
    repos,
    phase,
    task,
    otherTask,
    milestone,
    createEvidence: makeCreateEvidenceUseCase(deps),
    updateEvidence: makeUpdateEvidenceUseCase(deps),
    listEvidences: makeListEvidencesUseCase(deps),
    getEvidence: makeGetEvidenceUseCase(deps),
  };
}

describe("Evidências da EAP", () => {
  it("permite cadastro por perfil institucional, dono, gestor e participante executor", async () => {
    const ctx = await setup();
    const allowed = [
      actor("ADMIN", "admin-1"),
      actor("PMO", "pmo-1"),
      actor("COORDENADOR", "coord-1"),
      actor("GESTOR", "owner-1"),
      actor("GESTOR", "gestor-1"),
      actor("COLABORADOR", "dev-1"),
      actor("FORNECEDOR", "forn-1"),
    ];

    for (const user of allowed) {
      const evidence = await ctx.createEvidence(user, "project-1", {
        title: `Evidência ${user.id}`,
        url: "https://igepps.example/evidencia",
        taskId: ctx.task.id,
      });
      assert.equal(evidence.createdBy, user.id);
      assert.equal(evidence.taskId, ctx.task.id);
    }
  });

  it("impede observador e usuário sem vínculo de registrar ou alterar", async () => {
    const ctx = await setup();
    const created = await ctx.createEvidence(actor("PMO", "pmo-1"), "project-1", {
      title: "Ata",
      url: "https://igepps.example/ata",
      taskId: ctx.task.id,
    });

    await assert.rejects(
      () =>
        ctx.createEvidence(actor("COLABORADOR", "obs-1"), "project-1", {
          title: "Observação",
          url: "https://igepps.example/obs",
          taskId: ctx.task.id,
        }),
      (error: unknown) => error instanceof HttpError && error.code === "EVIDENCE_MANAGE_FORBIDDEN",
    );
    await assert.rejects(
      () =>
        ctx.updateEvidence(actor("COLABORADOR", "obs-1"), "project-1", created.id, {
          title: "Alterada",
        }),
      (error: unknown) => error instanceof HttpError && error.code === "EVIDENCE_MANAGE_FORBIDDEN",
    );
    await assert.rejects(
      () =>
        ctx.createEvidence(actor("COLABORADOR", "outsider-1"), "project-1", {
          title: "Sem vínculo",
          url: "https://igepps.example/fora",
          taskId: ctx.task.id,
        }),
      (error: unknown) => error instanceof HttpError && error.code === "PROJECT_FORBIDDEN",
    );
  });

  it("consulta com canViewProject e oculta evidência de outro projeto", async () => {
    const ctx = await setup();
    const created = await ctx.createEvidence(actor("FORNECEDOR", "forn-1"), "project-1", {
      title: "Print",
      url: "https://igepps.example/print",
      milestoneId: ctx.milestone.id,
    });

    const listed = await ctx.listEvidences(actor("COLABORADOR", "obs-1"), "project-1", {});
    assert.equal(listed.data.length, 1);
    const viewed = await ctx.getEvidence(actor("COLABORADOR", "obs-1"), "project-1", created.id);
    assert.equal(viewed.id, created.id);

    await assert.rejects(
      () => ctx.getEvidence(actor("COLABORADOR", "outsider-1"), "project-1", created.id),
      (error: unknown) => error instanceof HttpError && error.code === "PROJECT_FORBIDDEN",
    );
    await assert.rejects(
      () => ctx.getEvidence(actor("PMO", "pmo-1"), "project-2", created.id),
      (error: unknown) => error instanceof HttpError && error.code === "EVIDENCE_NOT_FOUND",
    );
  });

  it("vincula tarefa, marco ou solicitação e rejeita pai de outro projeto", async () => {
    const ctx = await setup();
    const onTask = await ctx.createEvidence(actor("PMO", "pmo-1"), "project-1", {
      title: "Tarefa",
      url: "https://igepps.example/tarefa",
      taskId: ctx.task.id,
    });
    const onMilestone = await ctx.createEvidence(actor("PMO", "pmo-1"), "project-1", {
      title: "Marco",
      url: "https://igepps.example/marco",
      milestoneId: ctx.milestone.id,
    });
    const onSchedule = await ctx.createEvidence(actor("PMO", "pmo-1"), "project-1", {
      title: "Reprogramação",
      url: "https://igepps.example/agenda",
      scheduleRequestId: "sched-1",
    });

    assert.equal(onTask.taskId, ctx.task.id);
    assert.equal(onTask.milestoneId, null);
    assert.equal(onMilestone.milestoneId, ctx.milestone.id);
    assert.equal(onSchedule.scheduleRequestId, "sched-1");

    const byTask = await ctx.listEvidences(actor("PMO", "pmo-1"), "project-1", {
      taskId: ctx.task.id,
    });
    assert.deepEqual(
      byTask.data.map((item) => item.id),
      [onTask.id],
    );

    await assert.rejects(
      () =>
        ctx.createEvidence(actor("PMO", "pmo-1"), "project-1", {
          title: "Fora",
          url: "https://igepps.example/fora",
          taskId: ctx.otherTask.id,
        }),
      (error: unknown) => error instanceof HttpError && error.code === "EVIDENCE_PARENT_NOT_FOUND",
    );
    await assert.rejects(
      () =>
        ctx.createEvidence(actor("PMO", "pmo-1"), "project-1", {
          title: "Fora",
          url: "https://igepps.example/fora",
          scheduleRequestId: "sched-2",
        }),
      (error: unknown) => error instanceof HttpError && error.code === "EVIDENCE_PARENT_NOT_FOUND",
    );
  });

  it("registra auditoria de criação e atualização na mesma transação e desfaz o rollback", async () => {
    const ctx = await setup();
    const created = await ctx.createEvidence(actor("COLABORADOR", "dev-1"), "project-1", {
      title: "Documento",
      url: "https://igepps.example/doc",
      taskId: ctx.task.id,
    });
    await ctx.updateEvidence(actor("COLABORADOR", "dev-1"), "project-1", created.id, {
      title: "Documento revisado",
      url: "https://igepps.example/doc-v2",
    });

    const stored = ctx.store.evidences.find((row) => row.id === created.id);
    assert.equal(stored?.createdBy, "dev-1");
    assert.equal(stored?.taskId, ctx.task.id);
    assert.equal(stored?.milestoneId, null);
    assert.equal(stored?.scheduleRequestId, null);
    assert.equal(stored?.title, "Documento revisado");

    const logs = ctx.store.auditLogs.filter((log) => log.entityType === "EVIDENCE");
    assert.deepEqual(
      logs.map((log) => log.action),
      ["CREATE", "UPDATE"],
    );
    assert.equal(logs.every((log) => log.entityId === created.id && log.projectId === "project-1"), true);

    const originalCreate = ctx.repos.audit.create.bind(ctx.repos.audit);
    ctx.repos.audit.create = async (data) => {
      if (data.entityType === "EVIDENCE" && data.action === "CREATE") {
        throw new Error("falha forçada");
      }
      return originalCreate(data);
    };

    const before = ctx.store.evidences.length;
    await assert.rejects(() =>
      ctx.createEvidence(actor("PMO", "pmo-1"), "project-1", {
        title: "Não deve persistir",
        url: "https://igepps.example/rollback",
        taskId: ctx.task.id,
      }),
    );
    assert.equal(ctx.store.evidences.length, before);
    assert.equal(
      ctx.store.auditLogs.some((log) => log.summary.includes("Não deve persistir")),
      false,
    );
  });

  it("rejeita no schema vínculo ausente, duplo, arquivo e troca de pai", () => {
    assert.equal(
      createEvidenceBodySchema.safeParse({
        title: "Sem pai",
        url: "https://igepps.example/x",
      }).success,
      false,
    );
    assert.equal(
      createEvidenceBodySchema.safeParse({
        title: "Dois pais",
        url: "https://igepps.example/x",
        taskId: "task-1",
        milestoneId: "milestone-1",
      }).success,
      false,
    );
    assert.equal(
      createEvidenceBodySchema.safeParse({
        title: "Arquivo",
        url: "https://igepps.example/x",
        taskId: "task-1",
        fileName: "evidencia.pdf",
      }).success,
      false,
    );
    assert.equal(
      updateEvidenceBodySchema.safeParse({
        title: "Novo título",
        taskId: "task-2",
      }).success,
      false,
    );
    assert.equal(
      updateEvidenceBodySchema.safeParse({
        url: "ftp://igepps.example/arquivo",
      }).success,
      false,
    );
  });
});
