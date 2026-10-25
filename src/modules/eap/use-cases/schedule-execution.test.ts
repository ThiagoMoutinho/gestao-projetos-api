import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import {
  createEapInMemoryStore,
  makeEapInMemoryRepos,
  makeEapInMemoryTransactionRunner,
  makeMember,
  makeProject,
  makeUser,
} from "../test/in-memory";
import { makeCreatePhaseUseCase } from "./create-phase";
import { makeCreateMilestoneUseCase } from "./create-milestone";
import { makeCreateTaskUseCase } from "./create-task";
import { makeDeliverMilestoneUseCase } from "./deliver-milestone";
import { civilToday, deadlinePerformance } from "./eap-status";
import { makeGetPhaseUseCase } from "./get-phase";
import { makeGetScheduleMonitoringUseCase } from "./get-schedule-monitoring";
import { makeListAuditUseCase } from "./list-audit";
import { makeListScheduleChangesUseCase } from "./list-schedule-changes";
import { makeReorderTasksUseCase } from "./reorder-tasks";
import { makeRescheduleUseCase } from "./reschedule";
import { makeReviewMilestoneUseCase } from "./review-milestone";
import { makeUpdateMilestoneUseCase } from "./update-milestone";
import { makeUpdatePhaseUseCase } from "./update-phase";
import { makeUpdateTaskUseCase } from "./update-task";
import { makeUpdateTaskProgressUseCase } from "./update-task-progress";

function actor(role: AuthUser["role"], id: string): AuthUser {
  return { id, name: id, email: `${id}@igepps.test`, role };
}

const pmo = actor("PMO", "pmo-1");
const supplier = actor("FORNECEDOR", "forn-1");
const observer = actor("COLABORADOR", "obs-1");

const PLAN = { plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z" };
const day = (value: string) => `${value}T15:00:00.000Z`;

function rejectsWith(code: string) {
  return (error: unknown) => error instanceof HttpError && error.code === code;
}

async function setup() {
  const store = createEapInMemoryStore({
    users: [
      makeUser({ id: "pmo-1", role: "PMO" }),
      makeUser({ id: "forn-1", role: "FORNECEDOR" }),
      makeUser({ id: "obs-1", role: "COLABORADOR" }),
    ],
    projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
    members: [
      makeMember({ id: "m-forn", projectId: "project-1", userId: "forn-1", role: "FORNECEDOR" }),
      makeMember({ id: "m-obs", projectId: "project-1", userId: "obs-1", role: "OBSERVADOR" }),
    ],
  });
  const repos = makeEapInMemoryRepos(store);
  const deps = { repos, runInTransaction: makeEapInMemoryTransactionRunner(repos, store) };
  const ctx = {
    store,
    updateProgress: makeUpdateTaskProgressUseCase(deps),
    reschedule: makeRescheduleUseCase(deps),
    listChanges: makeListScheduleChangesUseCase(deps),
    listAudit: makeListAuditUseCase(deps),
    monitoring: makeGetScheduleMonitoringUseCase(deps),
  };
  const phase = await makeCreatePhaseUseCase(deps)(pmo, "project-1", { name: "Fase" });
  const task = await makeCreateTaskUseCase(deps)(pmo, "project-1", phase.id, {
    title: "Tarefa",
    assigneeId: "forn-1",
    ...PLAN,
  });
  return { ...ctx, phase, task };
}

function taskRow(ctx: Awaited<ReturnType<typeof setup>>) {
  return ctx.store.tasks.find((row) => row.id === ctx.task.id)!;
}

describe("Datas reais da tarefa", () => {
  it("registra o início real sem concluir nem reprogramar a tarefa", async () => {
    const ctx = await setup();

    const updated = await ctx.updateProgress(supplier, "project-1", ctx.phase.id, ctx.task.id, {
      actualStartAt: day("2026-06-02"),
    });

    assert.equal(updated.status, "NAO_INICIADA");
    assert.equal(updated.actualStartAt, day("2026-06-02"));
    assert.equal(updated.plannedEndAt, PLAN.plannedEndAt);
    const history = await ctx.listAudit(pmo, "project-1", { entityType: "TASK", entityId: ctx.task.id });
    const entry = history.data.find((item) => item.details.kind === "ACTUAL_DATES");
    assert.deepEqual(entry?.details.actualDates, [{ field: "START", previous: null, next: day("2026-06-02") }]);
    assert.equal(entry?.details.correction, false);
    const changes = await ctx.listChanges(pmo, "project-1", { entityType: "TASK", entityId: ctx.task.id });
    assert.ok(changes.data.every((change) => change.kind !== "RESCHEDULE"));
  });

  it("registra o término real e mantém a situação até a conclusão explícita", async () => {
    const ctx = await setup();
    await ctx.updateProgress(supplier, "project-1", ctx.phase.id, ctx.task.id, { progressPercent: 50 });

    const updated = await ctx.updateProgress(supplier, "project-1", ctx.phase.id, ctx.task.id, {
      actualEndAt: civilToday().toISOString(),
    });

    assert.equal(updated.status, "EM_ANDAMENTO");
    assert.equal(updated.progressPercent, 50);
    assert.ok(updated.actualEndAt);
  });

  it("exige justificativa para corrigir data real e preserva o valor anterior", async () => {
    const ctx = await setup();
    await ctx.updateProgress(supplier, "project-1", ctx.phase.id, ctx.task.id, {
      actualStartAt: day("2026-06-02"),
    });

    await assert.rejects(
      () =>
        ctx.updateProgress(supplier, "project-1", ctx.phase.id, ctx.task.id, {
          actualStartAt: day("2026-06-04"),
        }),
      rejectsWith("ACTUAL_DATE_CORRECTION_JUSTIFICATION_REQUIRED"),
    );
    assert.equal(taskRow(ctx).actualStartAt?.toISOString(), day("2026-06-02"));

    await ctx.updateProgress(supplier, "project-1", ctx.phase.id, ctx.task.id, {
      actualStartAt: day("2026-06-04"),
      justification: "Início registrado com a data errada.",
    });

    const history = await ctx.listAudit(pmo, "project-1", { entityType: "TASK", entityId: ctx.task.id });
    const correction = history.data.find((item) => item.details.correction);
    assert.deepEqual(correction?.details.actualDates, [
      { field: "START", previous: day("2026-06-02"), next: day("2026-06-04") },
    ]);
    assert.equal(correction?.details.justification, "Início registrado com a data errada.");
    assert.equal(correction?.actorId, "forn-1");
  });

  it("impede quem não é responsável nem gestão de registrar datas reais", async () => {
    const ctx = await setup();

    await assert.rejects(
      () =>
        ctx.updateProgress(observer, "project-1", ctx.phase.id, ctx.task.id, {
          actualStartAt: day("2026-06-02"),
        }),
      rejectsWith("TASK_PROGRESS_FORBIDDEN"),
    );
  });
});

describe("Conclusão da tarefa", () => {
  it("conclui pelo andamento com as datas reais confirmadas e atualiza a fase", async () => {
    const ctx = await setup();

    const done = await ctx.updateProgress(supplier, "project-1", ctx.phase.id, ctx.task.id, {
      progressPercent: 100,
      actualStartAt: day("2026-06-02"),
      actualEndAt: day("2026-06-20"),
    });

    assert.equal(done.status, "CONCLUIDA");
    assert.equal(done.actualEndAt, day("2026-06-20"));
    assert.equal(ctx.store.phases[0].status, "CONCLUIDA");
    const history = await ctx.listAudit(pmo, "project-1", { entityType: "TASK", entityId: ctx.task.id });
    assert.equal(history.data.filter((item) => item.details.kind === "COMPLETION").length, 1);
  });

  it("impede a conclusão sem as datas reais e não grava nada", async () => {
    const ctx = await setup();
    const auditBefore = ctx.store.auditLogs.length;

    await assert.rejects(
      () => ctx.updateProgress(supplier, "project-1", ctx.phase.id, ctx.task.id, { progressPercent: 100 }),
      rejectsWith("TASK_COMPLETION_ACTUAL_DATES_REQUIRED"),
    );
    await assert.rejects(
      () =>
        ctx.updateProgress(supplier, "project-1", ctx.phase.id, ctx.task.id, {
          progressPercent: 100,
          actualStartAt: day("2026-06-02"),
        }),
      rejectsWith("TASK_COMPLETION_ACTUAL_DATES_REQUIRED"),
    );
    assert.equal(taskRow(ctx).progressPercent, 0);
    assert.equal(ctx.store.auditLogs.length, auditBefore);
  });

  it("recusa término real anterior ao início", async () => {
    const ctx = await setup();

    await assert.rejects(
      () =>
        ctx.updateProgress(supplier, "project-1", ctx.phase.id, ctx.task.id, {
          progressPercent: 100,
          actualStartAt: day("2026-06-10"),
          actualEndAt: day("2026-06-05"),
        }),
      rejectsWith("TASK_ACTUAL_DATES_INVALID"),
    );
  });
});

describe("Reprogramação", () => {
  it("preserva o planejamento original em reprogramações sucessivas", async () => {
    const ctx = await setup();
    const target = { entityType: "TASK" as const, phaseId: ctx.phase.id, taskId: ctx.task.id };

    await ctx.reschedule(pmo, "project-1", target, {
      plannedStartAt: PLAN.plannedStartAt,
      plannedEndAt: day("2026-07-10"),
      justification: "Atraso na entrega do fornecedor.",
    });
    await ctx.reschedule(pmo, "project-1", target, {
      plannedStartAt: PLAN.plannedStartAt,
      plannedEndAt: day("2026-07-20"),
      justification: "Nova dependência identificada.",
    });

    const row = taskRow(ctx);
    assert.equal(row.baselineEndAt?.toISOString(), PLAN.plannedEndAt);
    assert.equal(row.plannedEndAt?.toISOString(), day("2026-07-20"));
    const changes = await ctx.listChanges(pmo, "project-1", { entityType: "TASK", entityId: ctx.task.id });
    const reschedules = changes.data.filter((change) => change.kind === "RESCHEDULE");
    assert.deepEqual(
      reschedules.map((change) => [change.sequence, change.previous.endAt, change.next.endAt, change.justification]),
      [
        [1, PLAN.plannedEndAt, day("2026-07-10"), "Atraso na entrega do fornecedor."],
        [2, day("2026-07-10"), day("2026-07-20"), "Nova dependência identificada."],
      ],
    );
    assert.ok(reschedules.every((change) => change.actorId === "pmo-1" && change.createdAt));
  });

  it("não permite reprogramar tarefa concluída nem a fornecedor", async () => {
    const ctx = await setup();
    const target = { entityType: "TASK" as const, phaseId: ctx.phase.id, taskId: ctx.task.id };
    const input = { ...PLAN, plannedEndAt: day("2026-07-10"), justification: "Ajuste do cronograma geral." };

    await assert.rejects(() => ctx.reschedule(supplier, "project-1", target, input), (error: unknown) =>
      error instanceof HttpError && error.statusCode === 403,
    );

    await ctx.updateProgress(supplier, "project-1", ctx.phase.id, ctx.task.id, {
      progressPercent: 100,
      actualStartAt: day("2026-06-02"),
      actualEndAt: day("2026-06-20"),
    });
    await assert.rejects(() => ctx.reschedule(pmo, "project-1", target, input), rejectsWith("SCHEDULE_ITEM_CLOSED"));
  });
});

describe("Datas da fase: planejamento gravado e datas consolidadas dos itens", () => {
  async function phaseCtx() {
    const ctx = await setup();
    const repos = makeEapInMemoryRepos(ctx.store);
    const deps = { repos, runInTransaction: makeEapInMemoryTransactionRunner(repos, ctx.store) };
    // Planejamento gravado da fase, como nos dados existentes.
    Object.assign(ctx.store.phases.find((row) => row.id === ctx.phase.id)!, {
      plannedStartAt: new Date(PLAN.plannedStartAt),
      plannedEndAt: new Date(PLAN.plannedEndAt),
      baselineStartAt: new Date(PLAN.plannedStartAt),
      baselineEndAt: new Date(PLAN.plannedEndAt),
    });
    return {
      ...ctx,
      createTask: makeCreateTaskUseCase(deps),
      createMilestone: makeCreateMilestoneUseCase(deps),
      review: makeReviewMilestoneUseCase(deps),
      getPhase: makeGetPhaseUseCase(deps),
      phaseRow: () => ctx.store.phases.find((row) => row.id === ctx.phase.id)!,
    };
  }
  const isoOf = (value: Date | null | undefined) => value?.toISOString() ?? null;

  it("alterar e reprogramar tarefas não substitui o planejamento gravado da fase nem a linha de base", async () => {
    const ctx = await phaseCtx();
    await ctx.createTask(pmo, "project-1", ctx.phase.id, {
      title: "Mais cedo e mais tarde",
      plannedStartAt: day("2026-05-20"),
      plannedEndAt: day("2026-07-15"),
    });
    await ctx.reschedule(pmo, "project-1", { entityType: "TASK", phaseId: ctx.phase.id, taskId: ctx.task.id }, {
      plannedStartAt: PLAN.plannedStartAt,
      plannedEndAt: day("2026-07-20"),
      justification: "Atraso na entrega do fornecedor.",
    });

    assert.equal(isoOf(ctx.phaseRow().plannedStartAt), PLAN.plannedStartAt);
    assert.equal(isoOf(ctx.phaseRow().plannedEndAt), PLAN.plannedEndAt);
    assert.equal(isoOf(ctx.phaseRow().baselineStartAt), PLAN.plannedStartAt);
    assert.equal(isoOf(ctx.phaseRow().baselineEndAt), PLAN.plannedEndAt);
  });

  it("exibe o planejamento gravado e identifica separadamente as datas consolidadas dos itens", async () => {
    const ctx = await phaseCtx();
    await ctx.createMilestone(pmo, "project-1", ctx.phase.id, {
      title: "Aprovação", description: "Aprovação final.", type: "APROVACAO", plannedAt: day("2026-07-05"), reviewerId: "obs-1",
    });

    const phase = await ctx.getPhase(pmo, "project-1", ctx.phase.id);
    assert.equal(phase.plannedStartAt, PLAN.plannedStartAt);
    assert.equal(phase.plannedEndAt, PLAN.plannedEndAt);
    assert.equal(phase.consolidatedStartAt, PLAN.plannedStartAt);
    assert.equal(phase.consolidatedEndAt, day("2026-07-05"));
  });

  it("a reprogramação justificada da fase continua funcionando e preserva a linha de base", async () => {
    const ctx = await phaseCtx();

    await assert.rejects(
      () => ctx.reschedule(pmo, "project-1", { entityType: "PHASE", phaseId: ctx.phase.id }, { ...PLAN, plannedEndAt: day("2026-07-31") }),
      rejectsWith("SCHEDULE_JUSTIFICATION_REQUIRED"),
    );
    const change = await ctx.reschedule(pmo, "project-1", { entityType: "PHASE", phaseId: ctx.phase.id }, {
      ...PLAN,
      plannedEndAt: day("2026-07-31"),
      justification: "Inclusão de nova entrega aprovada pelo comitê.",
    });

    assert.equal(change.kind, "RESCHEDULE");
    assert.equal(isoOf(ctx.phaseRow().plannedEndAt), day("2026-07-31"));
    assert.equal(isoOf(ctx.phaseRow().baselineEndAt), PLAN.plannedEndAt);
  });

  it("ajuste em cascata: replanejar a tarefa para fora da fase estende a fase com justificativa e histórico", async () => {
    const ctx = await phaseCtx();
    await ctx.reschedule(pmo, "project-1", { entityType: "TASK", phaseId: ctx.phase.id, taskId: ctx.task.id }, {
      plannedStartAt: day("2026-05-25"),
      plannedEndAt: day("2026-07-20"),
      justification: "Atraso na entrega do fornecedor.",
      extendPhase: true,
    });

    assert.equal(isoOf(ctx.phaseRow().plannedStartAt), day("2026-05-25"));
    assert.equal(isoOf(ctx.phaseRow().plannedEndAt), day("2026-07-20"));
    assert.equal(isoOf(ctx.phaseRow().baselineEndAt), PLAN.plannedEndAt);
    const phaseChange = ctx.store.auditLogs.find((log) => log.entityId === ctx.phase.id && log.action === "SCHEDULE_CHANGE");
    assert.equal((phaseChange?.payload as { cascadeFrom: string }).cascadeFrom, 'da tarefa "Tarefa"');
    assert.equal((phaseChange?.payload as { justification: string }).justification, "Atraso na entrega do fornecedor.");
    const taskChange = ctx.store.auditLogs.findLast((log) => log.entityId === ctx.task.id && log.action === "SCHEDULE_CHANGE");
    assert.deepEqual((taskChange?.payload as { impacts: unknown[] }).impacts, []);
  });

  it("ajuste em cascata na criação do marco: sem justificativa nada é gravado; com ela a fase cobre o marco", async () => {
    const ctx = await phaseCtx();
    const input = {
      title: "Aceite", description: "Aceite final.", type: "APROVACAO" as const, plannedAt: day("2026-07-05"), reviewerId: "obs-1", extendPhase: true,
    };
    const before = ctx.store.milestones.length;

    await assert.rejects(() => ctx.createMilestone(pmo, "project-1", ctx.phase.id, input), rejectsWith("SCHEDULE_JUSTIFICATION_REQUIRED"));
    assert.equal(ctx.store.milestones.length, before);
    assert.equal(isoOf(ctx.phaseRow().plannedEndAt), PLAN.plannedEndAt);

    await ctx.createMilestone(pmo, "project-1", ctx.phase.id, { ...input, justification: "Aceite incluído pelo comitê." });
    assert.equal(isoOf(ctx.phaseRow().plannedEndAt), day("2026-07-05"));
    assert.equal(isoOf(ctx.phaseRow().plannedStartAt), PLAN.plannedStartAt);
  });

  it("ajuste em cascata define o planejamento de fase sem datas e não altera fase que já cobre o item", async () => {
    const ctx = await phaseCtx();
    await ctx.createMilestone(pmo, "project-1", ctx.phase.id, {
      title: "Dentro", description: "Dentro do prazo.", type: "APROVACAO", plannedAt: day("2026-06-15"), reviewerId: "obs-1", extendPhase: true,
    });
    assert.equal(isoOf(ctx.phaseRow().plannedEndAt), PLAN.plannedEndAt);

    Object.assign(ctx.phaseRow(), { plannedStartAt: null, plannedEndAt: null, baselineStartAt: null, baselineEndAt: null });
    await ctx.createMilestone(pmo, "project-1", ctx.phase.id, {
      title: "Novo", description: "Sem planejamento.", type: "APROVACAO", plannedAt: day("2026-07-01"), reviewerId: "obs-1", extendPhase: true,
    });
    // Período consolidado de todos os itens: tarefa (01/06 a 30/06) e marcos (15/06 e 01/07).
    assert.equal(isoOf(ctx.phaseRow().plannedStartAt), PLAN.plannedStartAt);
    assert.equal(isoOf(ctx.phaseRow().plannedEndAt), day("2026-07-01"));
  });

  it("cascata cobre o período consolidado de todos os itens, em qualquer ordem, e nunca reduz o prazo", async () => {
    const ctx = await phaseCtx();
    // Marco já fora da fase, criado antes e sem ajuste: a divergência fica apenas sinalizada.
    await ctx.createMilestone(pmo, "project-1", ctx.phase.id, {
      title: "Aceite", description: "Aceite final.", type: "APROVACAO", plannedAt: day("2026-07-10"), reviewerId: "obs-1",
    });
    assert.equal(isoOf(ctx.phaseRow().plannedEndAt), PLAN.plannedEndAt);

    await ctx.reschedule(pmo, "project-1", { entityType: "TASK", phaseId: ctx.phase.id, taskId: ctx.task.id }, {
      plannedStartAt: PLAN.plannedStartAt,
      plannedEndAt: day("2026-07-05"),
      justification: "Atraso na entrega do fornecedor.",
      extendPhase: true,
    });
    assert.equal(isoOf(ctx.phaseRow().plannedEndAt), day("2026-07-10"));

    // Antecipar a tarefa não reduz o prazo planejado da fase.
    await ctx.reschedule(pmo, "project-1", { entityType: "TASK", phaseId: ctx.phase.id, taskId: ctx.task.id }, {
      plannedStartAt: day("2026-06-10"),
      plannedEndAt: day("2026-06-20"),
      justification: "Entrega antecipada pelo fornecedor.",
      extendPhase: true,
    });
    assert.equal(isoOf(ctx.phaseRow().plannedStartAt), PLAN.plannedStartAt);
    assert.equal(isoOf(ctx.phaseRow().plannedEndAt), day("2026-07-10"));
    assert.equal(isoOf(ctx.phaseRow().baselineEndAt), PLAN.plannedEndAt);
  });

  it("criar tarefa fora da fase oferece o mesmo ajuste em cascata dos marcos", async () => {
    const ctx = await phaseCtx();
    const input = { title: "Migração", plannedStartAt: day("2026-06-20"), plannedEndAt: day("2026-07-15"), extendPhase: true };

    await assert.rejects(() => ctx.createTask(pmo, "project-1", ctx.phase.id, input), rejectsWith("SCHEDULE_JUSTIFICATION_REQUIRED"));
    await ctx.createTask(pmo, "project-1", ctx.phase.id, { ...input, justification: "Migração incluída no escopo." });
    assert.equal(isoOf(ctx.phaseRow().plannedEndAt), day("2026-07-15"));
  });

  it("início consolidado considera tarefas e marcos; reordenar não altera as datas da fase", async () => {
    const ctx = await phaseCtx();
    await ctx.createMilestone(pmo, "project-1", ctx.phase.id, {
      title: "Kickoff", description: "Abertura.", type: "APROVACAO", plannedAt: day("2026-05-28"), reviewerId: "obs-1",
    });
    const phase = await ctx.getPhase(pmo, "project-1", ctx.phase.id);
    assert.equal(phase.consolidatedStartAt, day("2026-05-28"));

    const before = { ...ctx.phaseRow() };
    const repos = makeEapInMemoryRepos(ctx.store);
    await makeReorderTasksUseCase({ repos, runInTransaction: makeEapInMemoryTransactionRunner(repos, ctx.store) })(
      pmo, "project-1", ctx.phase.id, [{ taskId: ctx.task.id, sortOrder: 5 }],
    );
    assert.equal(isoOf(ctx.phaseRow().plannedStartAt), isoOf(before.plannedStartAt));
    assert.equal(isoOf(ctx.phaseRow().plannedEndAt), isoOf(before.plannedEndAt));
  });

  it("fase sem planejamento gravado continua sem planejamento, mesmo com itens datados", async () => {
    const ctx = await phaseCtx();
    Object.assign(ctx.phaseRow(), { plannedStartAt: null, plannedEndAt: null, baselineStartAt: null, baselineEndAt: null });
    await ctx.createTask(pmo, "project-1", ctx.phase.id, { title: "Nova", ...PLAN });

    const phase = await ctx.getPhase(pmo, "project-1", ctx.phase.id);
    assert.equal(phase.plannedEndAt, null);
    assert.equal(phase.consolidatedEndAt, PLAN.plannedEndAt);
  });

  it("início real vem das tarefas e o término real só existe com a fase formalmente concluída", async () => {
    const ctx = await phaseCtx();
    await ctx.createMilestone(pmo, "project-1", ctx.phase.id, {
      title: "Aprovação", description: "Aprovação final.", type: "APROVACAO", plannedAt: day("2026-06-30"), reviewerId: "obs-1",
    });
    await ctx.updateProgress(supplier, "project-1", ctx.phase.id, ctx.task.id, {
      progressPercent: 100,
      actualStartAt: day("2026-06-02"),
      actualEndAt: day("2026-06-20"),
    });

    assert.equal(isoOf(ctx.phaseRow().actualStartAt), day("2026-06-02"));
    assert.equal(ctx.phaseRow().actualEndAt, null);

    const milestone = ctx.store.milestones.find((row) => row.phaseId === ctx.phase.id)!;
    await ctx.review(observer, "project-1", ctx.phase.id, milestone.id, { decision: "APROVADO" });
    const accepted = ctx.store.milestones.find((row) => row.id === milestone.id)!;
    assert.equal(ctx.phaseRow().status, "CONCLUIDA");
    assert.equal(isoOf(ctx.phaseRow().actualEndAt), isoOf(accepted.actualAt));
    assert.equal(isoOf(ctx.phaseRow().plannedEndAt), PLAN.plannedEndAt);
  });
});

describe("Datas reais da fase: registro preservado e preenchimento de campos vazios", () => {
  async function actualCtx() {
    const ctx = await setup();
    const repos = makeEapInMemoryRepos(ctx.store);
    const deps = { repos, runInTransaction: makeEapInMemoryTransactionRunner(repos, ctx.store) };
    const milestone = await makeCreateMilestoneUseCase(deps)(pmo, "project-1", ctx.phase.id, {
      title: "Aprovação", description: "Aprovação final.", type: "APROVACAO", plannedAt: day("2026-06-30"), reviewerId: "obs-1",
    });
    return {
      ...ctx,
      milestone,
      review: makeReviewMilestoneUseCase(deps),
      getPhase: makeGetPhaseUseCase(deps),
      updatePhase: makeUpdatePhaseUseCase(deps),
      phaseRow: () => ctx.store.phases.find((row) => row.id === ctx.phase.id)!,
    };
  }
  type Ctx = Awaited<ReturnType<typeof actualCtx>>;
  const isoOf = (value: Date | null | undefined) => value?.toISOString() ?? null;
  const finishTask = (ctx: Ctx, start = "2026-06-02") =>
    ctx.updateProgress(supplier, "project-1", ctx.phase.id, ctx.task.id, {
      progressPercent: 100,
      actualStartAt: day(start),
      actualEndAt: day("2026-06-20"),
    });
  const conclude = async (ctx: Ctx) => {
    await finishTask(ctx);
    await ctx.review(observer, "project-1", ctx.phase.id, ctx.milestone.id, { decision: "APROVADO" });
  };

  it("sem evidência nos itens, as datas reais vazias continuam vazias (nunca usa a data atual)", async () => {
    const ctx = await actualCtx();
    // A reprogramação da tarefa dispara o recálculo da fase; nenhum item tem data real.
    await ctx.reschedule(pmo, "project-1", { entityType: "TASK", phaseId: ctx.phase.id, taskId: ctx.task.id }, {
      ...PLAN,
      plannedEndAt: day("2026-07-10"),
      justification: "Ajuste de escopo aprovado.",
    });

    assert.equal(ctx.phaseRow().actualStartAt, null);
    assert.equal(ctx.phaseRow().actualEndAt, null);
  });

  it("preenche o início real vazio pelas tarefas e registra a origem automática", async () => {
    const ctx = await actualCtx();
    await finishTask(ctx);

    assert.equal(isoOf(ctx.phaseRow().actualStartAt), day("2026-06-02"));
    const entry = ctx.store.auditLogs.findLast((log) => log.entityId === ctx.phase.id);
    assert.deepEqual((entry?.payload as { automatic: boolean }).automatic, true);
  });

  it("preserva a data real já registrada e exibe a divergência com a consolidada sem alterar o registro", async () => {
    const ctx = await actualCtx();
    Object.assign(ctx.phaseRow(), { actualStartAt: new Date(day("2026-06-05")) });
    await finishTask(ctx);

    assert.equal(isoOf(ctx.phaseRow().actualStartAt), day("2026-06-05"));
    const phase = await ctx.getPhase(pmo, "project-1", ctx.phase.id);
    assert.equal(phase.actualStartAt, day("2026-06-05"));
    assert.equal(phase.consolidatedActualStartAt, day("2026-06-02"));
    assert.equal(isoOf(ctx.phaseRow().plannedEndAt), null);
  });

  it("na conclusão preenche o término real vazio e preserva o início registrado", async () => {
    const ctx = await actualCtx();
    Object.assign(ctx.phaseRow(), { actualStartAt: new Date(day("2026-06-05")) });
    await conclude(ctx);

    const accepted = ctx.store.milestones.find((row) => row.id === ctx.milestone.id)!;
    assert.equal(ctx.phaseRow().status, "CONCLUIDA");
    assert.equal(isoOf(ctx.phaseRow().actualStartAt), day("2026-06-05"));
    assert.equal(isoOf(ctx.phaseRow().actualEndAt), isoOf(accepted.actualAt));
  });

  it("reabrir a fase remove o término real e mantém o início real", async () => {
    const ctx = await actualCtx();
    await conclude(ctx);
    await ctx.updateProgress(supplier, "project-1", ctx.phase.id, ctx.task.id, {
      progressPercent: 60,
      justification: "Homologação apontou ajuste pendente.",
    });

    assert.notEqual(ctx.phaseRow().status, "CONCLUIDA");
    assert.equal(ctx.phaseRow().actualEndAt, null);
    assert.equal(isoOf(ctx.phaseRow().actualStartAt), day("2026-06-02"));
    const entry = ctx.store.auditLogs.findLast((log) => log.entityId === ctx.phase.id);
    assert.equal((entry?.payload as { dates: Record<string, { next: string | null }> }).dates.actualEndAt.next, null);
  });

  it("correção explícita exige autorização e justificativa, é auditada e preservada nos recálculos", async () => {
    const ctx = await actualCtx();
    await finishTask(ctx);
    const correction = { actualStartAt: day("2026-06-01"), justification: "Kickoff registrado em ata." };

    await assert.rejects(
      () => ctx.updatePhase(pmo, "project-1", ctx.phase.id, { actualStartAt: day("2026-06-01") }),
      rejectsWith("ACTUAL_DATE_CORRECTION_JUSTIFICATION_REQUIRED"),
    );
    await assert.rejects(() => ctx.updatePhase(supplier, "project-1", ctx.phase.id, correction));
    await assert.rejects(
      () => ctx.updatePhase(pmo, "project-1", ctx.phase.id, { ...correction, actualEndAt: day("2026-06-20") }),
      rejectsWith("PHASE_ACTUAL_END_REQUIRES_CONCLUSION"),
    );

    await ctx.updatePhase(pmo, "project-1", ctx.phase.id, correction);
    const entry = ctx.store.auditLogs.findLast((log) => log.entityId === ctx.phase.id);
    assert.deepEqual(entry?.payload, {
      automatic: false,
      kind: "ACTUAL_DATES_CORRECTION",
      justification: "Kickoff registrado em ata.",
      dates: { actualStartAt: { previous: day("2026-06-02"), next: day("2026-06-01") } },
    });

    await ctx.review(observer, "project-1", ctx.phase.id, ctx.milestone.id, { decision: "APROVADO" });
    assert.equal(isoOf(ctx.phaseRow().actualStartAt), day("2026-06-01"));
  });
});

describe("Cumprimento de prazo", () => {
  const original = new Date(day("2026-06-30"));
  const rescheduled = new Date(day("2026-07-20"));

  it("diferencia prazo original, reprogramado e atraso na conclusão", () => {
    const done = (actual: string) =>
      deadlinePerformance({ state: "DONE", baselineEndAt: original, plannedEndAt: rescheduled, actualEndAt: new Date(day(actual)) });

    assert.equal(done("2026-06-28"), "DONE_ON_ORIGINAL");
    assert.equal(done("2026-07-15"), "DONE_ON_RESCHEDULED");
    assert.equal(done("2026-07-25"), "DONE_LATE");
    assert.equal(
      deadlinePerformance({ state: "DONE", baselineEndAt: original, plannedEndAt: original, actualEndAt: new Date(day("2026-06-30")) }),
      "DONE_ON_ORIGINAL",
    );
  });

  it("diferencia execução no prazo, no prazo reprogramado e vencida", () => {
    const open = (today: string) =>
      deadlinePerformance(
        { state: "OPEN", baselineEndAt: original, plannedEndAt: rescheduled, actualEndAt: null },
        new Date(day(today)),
      );

    assert.equal(open("2026-06-15"), "OPEN_ON_TIME");
    assert.equal(open("2026-07-05"), "OPEN_ON_RESCHEDULED");
    assert.equal(open("2026-07-21"), "OPEN_OVERDUE");
    assert.equal(deadlinePerformance({ state: "CLOSED", baselineEndAt: original, plannedEndAt: original, actualEndAt: null }), null);
  });

  it("publica o indicador no monitoramento do projeto", async () => {
    const ctx = await setup();
    await ctx.reschedule(pmo, "project-1", { entityType: "TASK", phaseId: ctx.phase.id, taskId: ctx.task.id }, {
      plannedStartAt: PLAN.plannedStartAt,
      plannedEndAt: day("2026-07-20"),
      justification: "Atraso na entrega do fornecedor.",
    });
    await ctx.updateProgress(supplier, "project-1", ctx.phase.id, ctx.task.id, {
      progressPercent: 100,
      actualStartAt: day("2026-06-02"),
      actualEndAt: day("2026-07-15"),
    });

    const monitoring = await ctx.monitoring(pmo, "project-1");
    const item = monitoring.items.find((entry) => entry.entityId === ctx.task.id);

    assert.equal(item?.deadlinePerformance, "DONE_ON_RESCHEDULED");
  });
});

describe("Planejamento definido nos detalhes da tarefa", () => {
  it("cria a tarefa sem datas e define o planejamento depois, sem exigir justificativa", async () => {
    const ctx = await setup();
    const repos = makeEapInMemoryRepos(ctx.store);
    const createTask = makeCreateTaskUseCase({ repos, runInTransaction: makeEapInMemoryTransactionRunner(repos, ctx.store) });

    const task = await createTask(pmo, "project-1", ctx.phase.id, { title: "Sem planejamento" });
    assert.equal(task.plannedStartAt, null);
    assert.equal(task.plannedEndAt, null);

    const change = await ctx.reschedule(pmo, "project-1", { entityType: "TASK", phaseId: ctx.phase.id, taskId: task.id }, PLAN);
    assert.equal(change.kind, "PLANNING_DEFINED");
    const row = ctx.store.tasks.find((item) => item.id === task.id)!;
    assert.equal(row.baselineEndAt?.toISOString(), PLAN.plannedEndAt);
  });

  it("recusa planejamento incompleto na criação", async () => {
    const ctx = await setup();
    const repos = makeEapInMemoryRepos(ctx.store);
    const createTask = makeCreateTaskUseCase({ repos, runInTransaction: makeEapInMemoryTransactionRunner(repos, ctx.store) });

    await assert.rejects(
      () => createTask(pmo, "project-1", ctx.phase.id, { title: "Só término", plannedEndAt: PLAN.plannedEndAt }),
      rejectsWith("PLANNED_DATES_REQUIRED"),
    );
  });
});

describe("Data prevista do marco na criação", () => {
  it("exige a data prevista ao criar o marco", async () => {
    const ctx = await setup();
    const repos = makeEapInMemoryRepos(ctx.store);
    const createMilestone = makeCreateMilestoneUseCase({ repos, runInTransaction: makeEapInMemoryTransactionRunner(repos, ctx.store) });

    await assert.rejects(
      () => createMilestone(pmo, "project-1", ctx.phase.id, { title: "Homologação final", type: "HOMOLOGACAO" }),
      rejectsWith("PLANNED_DATE_REQUIRED"),
    );
    const created = await createMilestone(pmo, "project-1", ctx.phase.id, {
      title: "Homologação final",
      type: "HOMOLOGACAO",
      plannedAt: day("2026-06-20"),
    });
    assert.equal(created.plannedAt, day("2026-06-20"));
    assert.equal(created.status, "PENDENTE");
  });
});

describe("Fase recém-criada", () => {
  it("nasce sem datas até receber itens datados", async () => {
    const ctx = await setup();
    const repos = makeEapInMemoryRepos(ctx.store);
    const createPhase = makeCreatePhaseUseCase({ repos, runInTransaction: makeEapInMemoryTransactionRunner(repos, ctx.store) });

    const phase = await createPhase(pmo, "project-1", { name: "Sem itens" });
    assert.deepEqual(
      [phase.plannedStartAt, phase.plannedEndAt, phase.actualStartAt, phase.actualEndAt],
      [null, null, null, null],
    );
  });
});

describe("Apresentador e gestor validador do marco", () => {
  async function milestoneCtx() {
    const ctx = await setup();
    const repos = makeEapInMemoryRepos(ctx.store);
    const deps = { repos, runInTransaction: makeEapInMemoryTransactionRunner(repos, ctx.store) };
    return {
      ...ctx,
      createMilestone: makeCreateMilestoneUseCase(deps),
      updateMilestone: makeUpdateMilestoneUseCase(deps),
      deliver: makeDeliverMilestoneUseCase(deps),
    };
  }
  const base = { title: "Apresentação do relatório", description: "Relatório final.", type: "ENTREGA" as const, plannedAt: day("2026-06-20") };

  it("registra quem apresenta e quem valida, e o apresentador pode registrar a entrega", async () => {
    const ctx = await milestoneCtx();

    const milestone = await ctx.createMilestone(pmo, "project-1", ctx.phase.id, { ...base, reviewerId: "obs-1", presenterId: "forn-1" });
    assert.equal(milestone.presenterId, "forn-1");
    assert.equal(milestone.reviewerId, "obs-1");

    const delivered = await ctx.deliver(supplier, "project-1", ctx.phase.id, milestone.id, { note: "Apresentado ao gestor." });
    assert.equal(delivered.status, "ENTREGUE");
  });

  it("não permite que a mesma pessoa apresente e valide o marco", async () => {
    const ctx = await milestoneCtx();

    await assert.rejects(
      () => ctx.createMilestone(pmo, "project-1", ctx.phase.id, { ...base, reviewerId: "obs-1", presenterId: "obs-1" }),
      rejectsWith("MILESTONE_PRESENTER_IS_REVIEWER"),
    );
    const milestone = await ctx.createMilestone(pmo, "project-1", ctx.phase.id, { ...base, reviewerId: "obs-1", presenterId: "forn-1" });
    await assert.rejects(
      () => ctx.updateMilestone(pmo, "project-1", ctx.phase.id, milestone.id, { presenterId: "obs-1" }),
      rejectsWith("MILESTONE_PRESENTER_IS_REVIEWER"),
    );
  });

  it("exige que o apresentador participe do projeto e registra a troca no histórico", async () => {
    const ctx = await milestoneCtx();
    const milestone = await ctx.createMilestone(pmo, "project-1", ctx.phase.id, { ...base, reviewerId: "obs-1", presenterId: "forn-1" });

    await assert.rejects(
      () => ctx.updateMilestone(pmo, "project-1", ctx.phase.id, milestone.id, { presenterId: "pmo-1" }),
      rejectsWith("MILESTONE_PRESENTER_INVALID"),
    );
    ctx.store.users.push(makeUser({ id: "owner-1", role: "GESTOR" }));
    await ctx.updateMilestone(pmo, "project-1", ctx.phase.id, milestone.id, { presenterId: "owner-1" });
    const entry = ctx.store.auditLogs.findLast((log) => log.entityId === milestone.id && log.action === "UPDATE");
    assert.deepEqual(
      [(entry?.payload as { previousPresenterId?: string }).previousPresenterId, (entry?.payload as { presenterId?: string }).presenterId],
      ["forn-1", "owner-1"],
    );
  });
});

describe("Itens concluídos ficam somente leitura", () => {
  async function lockCtx() {
    const ctx = await setup();
    const repos = makeEapInMemoryRepos(ctx.store);
    const deps = { repos, runInTransaction: makeEapInMemoryTransactionRunner(repos, ctx.store) };
    await ctx.updateProgress(supplier, "project-1", ctx.phase.id, ctx.task.id, {
      progressPercent: 100,
      actualStartAt: day("2026-06-02"),
      actualEndAt: day("2026-06-20"),
    });
    return { ...ctx, updateTask: makeUpdateTaskUseCase(deps), updatePhase: makeUpdatePhaseUseCase(deps) };
  }

  it("bloqueia a edição de tarefa e fase concluídas e libera após a reabertura", async () => {
    const ctx = await lockCtx();

    await assert.rejects(
      () => ctx.updateTask(pmo, "project-1", ctx.phase.id, ctx.task.id, { title: "Outro título" }),
      rejectsWith("ITEM_CONCLUDED_LOCKED"),
    );
    await assert.rejects(
      () => ctx.updatePhase(pmo, "project-1", ctx.phase.id, { name: "Outro nome" }),
      rejectsWith("ITEM_CONCLUDED_LOCKED"),
    );

    await ctx.updateProgress(supplier, "project-1", ctx.phase.id, ctx.task.id, {
      progressPercent: 60,
      justification: "Homologação apontou ajuste pendente.",
    });
    const renamed = await ctx.updateTask(pmo, "project-1", ctx.phase.id, ctx.task.id, { title: "Outro título" });
    assert.equal(renamed.title, "Outro título");
    const phase = await ctx.updatePhase(pmo, "project-1", ctx.phase.id, { name: "Outro nome" });
    assert.equal(phase.name, "Outro nome");
  });
});
