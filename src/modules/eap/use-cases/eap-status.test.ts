import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { taskStatusDecisionBodySchema } from "../schemas/eap-tasks.schema";
import {
  createEapInMemoryStore,
  makeEapInMemoryRepos,
  makeEapInMemoryTransactionRunner,
  makeMember,
  makeProject,
  makeUser,
} from "../test/in-memory";
import { makeCancelTaskUseCase } from "./cancel-task";
import { makeCreateMilestoneUseCase } from "./create-milestone";
import { makeCreatePhaseUseCase } from "./create-phase";
import { makeCreateTaskUseCase } from "./create-task";
import { makeDeliverMilestoneUseCase } from "./deliver-milestone";
import {
  civilToday,
  derivePhaseStatus,
  deriveTaskStatus,
  phaseProgress,
  projectProgress,
} from "./eap-status";
import { makeListPhasesUseCase } from "./list-phases";
import { makeReactivateTaskUseCase } from "./reactivate-task";
import { makeReviewMilestoneUseCase } from "./review-milestone";
import { makeUpdatePhaseUseCase } from "./update-phase";
import { makeUpdateTaskProgressUseCase } from "./update-task-progress";

function actor(role: AuthUser["role"], id = "actor-1"): AuthUser {
  return { id, name: "Actor", email: `${id}@igepps.test`, role };
}

const pmo = actor("PMO", "pmo-1");
const dev = actor("COLABORADOR", "dev-1");
const supplier = actor("FORNECEDOR", "forn-1");
const owner = actor("GESTOR", "owner-1");

function setup() {
  const store = createEapInMemoryStore({
    users: [
      makeUser({ id: "pmo-1", role: "PMO" }),
      makeUser({ id: "dev-1", role: "COLABORADOR" }),
      makeUser({ id: "forn-1", role: "FORNECEDOR" }),
    ],
    projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
    members: [
      makeMember({ id: "m-dev", projectId: "project-1", userId: "dev-1", role: "DESENVOLVEDOR" }),
      makeMember({ id: "m-forn", projectId: "project-1", userId: "forn-1", role: "FORNECEDOR" }),
    ],
  });
  const repos = makeEapInMemoryRepos(store);
  const runInTransaction = makeEapInMemoryTransactionRunner(repos, store);
  const deps = { repos, runInTransaction };
  return {
    store,
    createPhase: makeCreatePhaseUseCase(deps),
    updatePhase: makeUpdatePhaseUseCase(deps),
    listPhases: makeListPhasesUseCase(deps),
    createTask: makeCreateTaskUseCase(deps),
    updateProgress: makeUpdateTaskProgressUseCase(deps),
    cancelTask: makeCancelTaskUseCase(deps),
    reactivateTask: makeReactivateTaskUseCase(deps),
    createMilestone: makeCreateMilestoneUseCase(deps),
    deliverMilestone: makeDeliverMilestoneUseCase(deps),
    reviewMilestone: makeReviewMilestoneUseCase(deps),
  };
}

function phaseRow(ctx: ReturnType<typeof setup>, phaseId: string) {
  const phase = ctx.store.phases.find((item) => item.id === phaseId);
  assert.ok(phase);
  return phase;
}

function automaticPhaseAudits(ctx: ReturnType<typeof setup>, phaseId: string) {
  return ctx.store.auditLogs.filter(
    (log) =>
      log.entityType === "PHASE" &&
      log.entityId === phaseId &&
      log.action === "STATUS_CHANGE" &&
      (log.payload as { automatic?: boolean }).automatic === true,
  );
}

function rejectsWith(code: string) {
  return (error: unknown) => error instanceof HttpError && error.code === code;
}

describe("regra de situação da EAP", () => {
  it("deriva a situação da tarefa somente do percentual", () => {
    assert.equal(deriveTaskStatus(0), "NAO_INICIADA");
    assert.equal(deriveTaskStatus(1), "EM_ANDAMENTO");
    assert.equal(deriveTaskStatus(99), "EM_ANDAMENTO");
    assert.equal(deriveTaskStatus(100), "CONCLUIDA");
  });

  it("deriva a situação da fase considerando tarefas e marcos", () => {
    const task = (status: string, progressPercent: number) =>
      ({ status, progressPercent, weight: 1 }) as never;
    const milestone = (status: string) => ({ status }) as never;

    assert.equal(derivePhaseStatus([], []), "NAO_INICIADA");
    assert.equal(derivePhaseStatus([task("CANCELADA", 50)], []), "NAO_INICIADA");
    assert.equal(derivePhaseStatus([task("NAO_INICIADA", 0)], [milestone("PENDENTE")]), "NAO_INICIADA");
    assert.equal(derivePhaseStatus([task("EM_ANDAMENTO", 10)], []), "EM_ANDAMENTO");
    assert.equal(derivePhaseStatus([task("NAO_INICIADA", 0)], [milestone("ENTREGUE")]), "EM_ANDAMENTO");
    assert.equal(derivePhaseStatus([task("CONCLUIDA", 100)], [milestone("ENTREGUE")]), "EM_ANDAMENTO");
    assert.equal(
      derivePhaseStatus([task("CONCLUIDA", 100), task("CANCELADA", 0)], [milestone("APROVADO")]),
      "CONCLUIDA",
    );
  });

  it("mantém a fórmula de andamento: marco entregue conta 0% e aprovado conta 100%", () => {
    const tasks = [{ status: "CONCLUIDA", progressPercent: 100, weight: 1 }] as never[];
    assert.deepEqual(phaseProgress(tasks, [{ status: "ENTREGUE" }] as never[]), {
      state: "VALUE",
      basisPoints: 5000,
    });
    assert.deepEqual(phaseProgress(tasks, [{ status: "APROVADO" }] as never[]), {
      state: "VALUE",
      basisPoints: 10000,
    });
    assert.deepEqual(phaseProgress([], []), { state: "EMPTY", basisPoints: null });
    assert.deepEqual(
      projectProgress([
        { state: "VALUE", basisPoints: 5000 },
        { state: "EMPTY", basisPoints: null },
      ]),
      { progressBasisPoints: 5000, coverageBasisPoints: 5000 },
    );
  });
});

describe("automação de situação e datas", () => {
  it("atualiza tarefa e fase pelo andamento, preenche datas reais e audita como automático", async () => {
    const ctx = setup();
    const phase = await ctx.createPhase(pmo, "project-1", { name: "Execução" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});
    const task = await ctx.createTask(pmo, "project-1", phase.id, {
      title: "Codificar",
      assigneeId: "dev-1",
    
    plannedStartAt: "2026-06-01T15:00:00.000Z",
    plannedEndAt: "2026-06-30T15:00:00.000Z"});
    assert.equal(task.status, "NAO_INICIADA");

    const started = await ctx.updateProgress(dev, "project-1", phase.id, task.id, {
      progressPercent: 40,
    });
    const today = civilToday().toISOString();
    assert.equal(started.status, "EM_ANDAMENTO");
    assert.equal(started.actualStartAt, today);
    assert.equal(phaseRow(ctx, phase.id).status, "EM_ANDAMENTO");
    assert.equal(phaseRow(ctx, phase.id).actualStartAt?.toISOString(), today);
    const taskAudit = ctx.store.auditLogs.find(
      (log) => log.entityId === task.id && log.action === "STATUS_CHANGE",
    );
    assert.deepEqual(
      { automatic: (taskAudit?.payload as { automatic?: boolean }).automatic, actor: taskAudit?.actorId },
      { automatic: true, actor: "dev-1" },
    );

    const done = await ctx.updateProgress(dev, "project-1", phase.id, task.id, {
      progressPercent: 100,
    });
    assert.equal(done.status, "CONCLUIDA");
    assert.equal(done.actualEndAt, today);
    assert.equal(phaseRow(ctx, phase.id).status, "CONCLUIDA");
    assert.equal(phaseRow(ctx, phase.id).actualEndAt?.toISOString(), today);

    const reopened = await ctx.updateProgress(dev, "project-1", phase.id, task.id, {
      progressPercent: 60,
    });
    assert.equal(reopened.status, "EM_ANDAMENTO");
    assert.equal(reopened.actualEndAt, null);
    assert.equal(reopened.actualStartAt, today);
    const reopenAudit = ctx.store.auditLogs.findLast(
      (log) => log.entityId === task.id && (log.payload as { kind?: string }).kind === "PROGRESS",
    );
    assert.equal(
      (reopenAudit?.payload as { automaticDates?: { previousActualEndAt?: string } }).automaticDates
        ?.previousActualEndAt,
      today,
    );
    assert.equal(phaseRow(ctx, phase.id).status, "EM_ANDAMENTO");
    assert.equal(phaseRow(ctx, phase.id).actualEndAt, null);
    assert.equal(automaticPhaseAudits(ctx, phase.id).length, 3);

    const listed = await ctx.listPhases(pmo, "project-1");
    assert.equal(listed.data[0].calculatedStatus, "EM_ANDAMENTO");
    assert.equal(listed.data[0].progressBasisPoints, 6000);
    assert.deepEqual(listed.summary, { progressBasisPoints: 6000, coverageBasisPoints: 10000 });
  });

  it("aceita data retroativa informada e rejeita data futura", async () => {
    const ctx = setup();
    const phase = await ctx.createPhase(pmo, "project-1", { name: "Execução" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});
    const task = await ctx.createTask(pmo, "project-1", phase.id, { title: "Tarefa" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});

    const updated = await ctx.updateProgress(pmo, "project-1", phase.id, task.id, {
      progressPercent: 30,
      actualStartAt: "2026-01-05T15:00:00.000Z",
    });
    assert.equal(updated.actualStartAt, "2026-01-05T15:00:00.000Z");

    await assert.rejects(
      () =>
        ctx.updateProgress(pmo, "project-1", phase.id, task.id, {
          actualStartAt: "2999-01-01T15:00:00.000Z",
        }),
      rejectsWith("TASK_ACTUAL_DATE_FUTURE"),
    );
  });

  it("homologação: só o marco aprovado conclui a fase e o fornecedor não aprova a própria entrega", async () => {
    const ctx = setup();
    const phase = await ctx.createPhase(pmo, "project-1", { name: "Entrega" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});
    const task = await ctx.createTask(pmo, "project-1", phase.id, { title: "Tarefa" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});
    await ctx.updateProgress(pmo, "project-1", phase.id, task.id, { progressPercent: 100 });
    assert.equal(phaseRow(ctx, phase.id).status, "CONCLUIDA");

    const milestone = await ctx.createMilestone(pmo, "project-1", phase.id, {
      title: "Pacote",
      type: "ENTREGA",
    
    plannedAt: "2026-06-15T15:00:00.000Z"});
    assert.equal(phaseRow(ctx, phase.id).status, "EM_ANDAMENTO");

    await ctx.deliverMilestone(supplier, "project-1", phase.id, milestone.id);
    assert.equal(phaseRow(ctx, phase.id).status, "EM_ANDAMENTO");
    await assert.rejects(
      () =>
        ctx.reviewMilestone(supplier, "project-1", phase.id, milestone.id, {
          decision: "APROVADO",
        }),
      rejectsWith("MILESTONE_REVIEW_FORBIDDEN"),
    );
    await assert.rejects(
      () =>
        ctx.reviewMilestone(pmo, "project-1", phase.id, milestone.id, {
          decision: "APROVADO",
        }),
      rejectsWith("MILESTONE_REVIEW_FORBIDDEN"),
    );

    const approved = await ctx.reviewMilestone(owner, "project-1", phase.id, milestone.id, {
      decision: "APROVADO",
    });
    assert.ok(approved.validatedAt);
    assert.equal(phaseRow(ctx, phase.id).status, "CONCLUIDA");
  });

  it("cancelamento e reativação são decisões da gestão com justificativa", async () => {
    const ctx = setup();
    const phase = await ctx.createPhase(pmo, "project-1", { name: "Execução" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});
    const task = await ctx.createTask(pmo, "project-1", phase.id, {
      title: "Tarefa",
      assigneeId: "dev-1",
    
    plannedStartAt: "2026-06-01T15:00:00.000Z",
    plannedEndAt: "2026-06-30T15:00:00.000Z"});
    await ctx.updateProgress(dev, "project-1", phase.id, task.id, { progressPercent: 20 });
    const justification = { justification: "Escopo retirado pelo comitê." };

    await assert.rejects(
      () => ctx.cancelTask(dev, "project-1", phase.id, task.id, justification),
      rejectsWith("TASK_STATUS_DECISION_FORBIDDEN"),
    );

    const cancelled = await ctx.cancelTask(pmo, "project-1", phase.id, task.id, justification);
    assert.equal(cancelled.status, "CANCELADA");
    assert.equal(phaseRow(ctx, phase.id).status, "NAO_INICIADA");
    const audit = ctx.store.auditLogs.findLast(
      (log) => log.entityId === task.id && log.action === "STATUS_CHANGE",
    );
    assert.deepEqual(audit?.payload, {
      automatic: false,
      from: "EM_ANDAMENTO",
      to: "CANCELADA",
      justification: justification.justification,
    });

    await assert.rejects(
      () => ctx.updateProgress(dev, "project-1", phase.id, task.id, { progressPercent: 50 }),
      rejectsWith("TASK_CANCELLED"),
    );

    const reactivated = await ctx.reactivateTask(pmo, "project-1", phase.id, task.id, {
      justification: "Escopo devolvido ao projeto.",
    });
    assert.equal(reactivated.status, "EM_ANDAMENTO");
    assert.equal(phaseRow(ctx, phase.id).status, "EM_ANDAMENTO");

    await ctx.updateProgress(pmo, "project-1", phase.id, task.id, { progressPercent: 100 });
    await assert.rejects(
      () => ctx.cancelTask(pmo, "project-1", phase.id, task.id, justification),
      rejectsWith("TASK_CANCEL_CONCLUDED"),
    );
    assert.equal(taskStatusDecisionBodySchema.safeParse({ justification: "curta" }).success, false);
  });

  it("fase suspensa não muda automaticamente e retoma pela situação calculada", async () => {
    const ctx = setup();
    const phase = await ctx.createPhase(pmo, "project-1", { name: "Execução" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});
    const task = await ctx.createTask(pmo, "project-1", phase.id, { title: "Tarefa" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});

    const suspended = await ctx.updatePhase(pmo, "project-1", phase.id, { suspended: true });
    assert.equal(suspended.status, "SUSPENSA");
    assert.equal(suspended.calculatedStatus, "SUSPENSA");

    await ctx.updateProgress(pmo, "project-1", phase.id, task.id, { progressPercent: 50 });
    assert.equal(phaseRow(ctx, phase.id).status, "SUSPENSA");

    const resumed = await ctx.updatePhase(pmo, "project-1", phase.id, { suspended: false });
    assert.equal(resumed.status, "EM_ANDAMENTO");
    const resumeAudit = ctx.store.auditLogs.at(-1);
    assert.equal((resumeAudit?.payload as { automatic?: boolean }).automatic, false);
  });
});
