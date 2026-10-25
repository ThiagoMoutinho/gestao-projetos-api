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
import { makeCreateMilestoneUseCase } from "./create-milestone";
import { makeCreatePhaseUseCase } from "./create-phase";
import { makeCreateTaskUseCase } from "./create-task";
import { makeGetScheduleMonitoringUseCase } from "./get-schedule-monitoring";
import { makeListAuditUseCase } from "./list-audit";
import { makeListScheduleChangesUseCase } from "./list-schedule-changes";
import { makeRescheduleUseCase } from "./reschedule";

function actor(role: AuthUser["role"], id: string): AuthUser {
  return { id, name: id, email: `${id}@igepps.test`, role };
}

const admin = actor("ADMIN", "admin-1");
const pmo = actor("PMO", "pmo-1");
const owner = actor("GESTOR", "owner-1");
const projectManager = actor("GESTOR", "gestor-1");
const coordinator = actor("COORDENADOR", "coord-1");
const outsideManager = actor("GESTOR", "gestor-fora");
const supplier = actor("FORNECEDOR", "forn-1");
const collaborator = actor("COLABORADOR", "colab-1");

const day = (value: string) => `${value}T15:00:00.000Z`;
const justification = "Fornecedor atrasou a entrega do ambiente de homologação.";

function rejectsWith(code: string) {
  return (error: unknown) => error instanceof HttpError && error.code === code;
}

async function setup() {
  const store = createEapInMemoryStore({
    users: [
      makeUser({ id: "admin-1", role: "ADMIN" }),
      makeUser({ id: "pmo-1", role: "PMO" }),
      makeUser({ id: "owner-1", role: "GESTOR" }),
      makeUser({ id: "gestor-1", role: "GESTOR" }),
      makeUser({ id: "coord-1", role: "COORDENADOR" }),
      makeUser({ id: "gestor-fora", role: "GESTOR" }),
      makeUser({ id: "forn-1", role: "FORNECEDOR" }),
      makeUser({ id: "colab-1", role: "COLABORADOR" }),
    ],
    projects: [
      makeProject({
        id: "project-1",
        name: "Portal",
        ownerId: "owner-1",
        plannedStartAt: new Date(day("2030-01-01")),
        plannedEndAt: new Date(day("2030-12-31")),
        baselineStartAt: new Date(day("2030-01-01")),
        baselineEndAt: new Date(day("2030-12-31")),
      }),
    ],
    members: [
      makeMember({ id: "m-gestor", projectId: "project-1", userId: "gestor-1", role: "GESTOR" }),
      makeMember({ id: "m-forn", projectId: "project-1", userId: "forn-1", role: "FORNECEDOR" }),
      makeMember({ id: "m-colab", projectId: "project-1", userId: "colab-1", role: "GESTOR" }),
      makeMember({ id: "m-coord", projectId: "project-1", userId: "coord-1", role: "OBSERVADOR" }),
    ],
  });
  const repos = makeEapInMemoryRepos(store);
  const runInTransaction = makeEapInMemoryTransactionRunner(repos, store);
  const deps = { repos, runInTransaction };
  const createPhase = makeCreatePhaseUseCase(deps);
  const phase = await createPhase(pmo, "project-1", {
    name: "Construção",
    plannedStartAt: day("2030-02-01"),
    plannedEndAt: day("2030-06-30"),
  });
  const task = await makeCreateTaskUseCase(deps)(pmo, "project-1", phase.id, {
    title: "API de integração",
    plannedStartAt: day("2030-02-10"),
    plannedEndAt: day("2030-03-10"),
  });

  return {
    store,
    phase,
    task,
    reschedule: makeRescheduleUseCase(deps),
    listChanges: makeListScheduleChangesUseCase(deps),
    listAudit: makeListAuditUseCase(deps),
    monitoring: makeGetScheduleMonitoringUseCase(deps),
    createMilestone: makeCreateMilestoneUseCase(deps),
    createTask: makeCreateTaskUseCase(deps),
  };
}

describe("reprogramação de prazos", () => {
  it("reprogramações sucessivas numeram, preservam a linha de base e formam histórico cronológico", async () => {
    const ctx = await setup();
    const target = { entityType: "TASK" as const, phaseId: ctx.phase.id, taskId: ctx.task.id };

    const first = await ctx.reschedule(projectManager, "project-1", target, {
      plannedStartAt: day("2030-02-10"),
      plannedEndAt: day("2030-03-20"),
      justification,
    });
    const second = await ctx.reschedule(pmo, "project-1", target, {
      plannedStartAt: day("2030-02-15"),
      plannedEndAt: day("2030-04-05"),
      justification: "Escopo ampliado após validação com a área de negócio.",
    });

    assert.equal(first.kind, "RESCHEDULE");
    assert.equal(first.sequence, 1);
    assert.equal(second.sequence, 2);
    assert.equal(second.previous.endAt, day("2030-03-20"));
    assert.equal(second.next.endAt, day("2030-04-05"));
    assert.equal(second.actorId, "pmo-1");

    const task = ctx.store.tasks.find((row) => row.id === ctx.task.id);
    assert.equal(task?.plannedEndAt?.toISOString(), day("2030-04-05"));
    assert.equal(task?.baselineStartAt?.toISOString(), day("2030-02-10"));
    assert.equal(task?.baselineEndAt?.toISOString(), day("2030-03-10"));

    const history = await ctx.listChanges(supplier, "project-1", { entityType: "TASK", entityId: ctx.task.id });
    assert.deepEqual(
      history.data.map((entry) => entry.sequence),
      [1, 2],
    );
    assert.equal(history.data[0].justification, justification);

    const audit = await ctx.listAudit(pmo, "project-1", { entityType: "TASK", entityId: ctx.task.id });
    assert.ok(audit.data.some((entry) => entry.details.kind === "RESCHEDULE"));
  });

  it("primeira definição grava planejamento e linha de base sem contar como reprogramação", async () => {
    const ctx = await setup();
    const milestone = await ctx.createMilestone(pmo, "project-1", ctx.phase.id, {
      title: "Homologação do portal",
      type: "HOMOLOGACAO",
      plannedAt: day("2030-06-01"),
    });
    const legacyMilestone = ctx.store.milestones.find((row) => row.id === milestone.id);
    if (legacyMilestone) {
      legacyMilestone.plannedAt = null;
      legacyMilestone.baselineAt = null;
    }
    const target = { entityType: "MILESTONE" as const, phaseId: ctx.phase.id, milestoneId: milestone.id };

    const defined = await ctx.reschedule(owner, "project-1", target, { plannedAt: day("2030-06-20") });
    assert.equal(defined.kind, "PLANNING_DEFINED");
    assert.equal(defined.sequence, null);

    const stored = ctx.store.milestones.find((row) => row.id === milestone.id);
    assert.equal(stored?.plannedAt?.toISOString(), day("2030-06-20"));
    assert.equal(stored?.baselineAt?.toISOString(), day("2030-06-20"));

    await assert.rejects(
      () => ctx.reschedule(owner, "project-1", target, { plannedAt: day("2030-06-25") }),
      rejectsWith("SCHEDULE_JUSTIFICATION_REQUIRED"),
    );
    const moved = await ctx.reschedule(owner, "project-1", target, {
      plannedAt: day("2030-06-25"),
      justification,
    });
    assert.equal(moved.sequence, 1);
    assert.ok(moved.impacts.some((impact) => impact.code === "CRITICAL_MILESTONE"));
    assert.equal(moved.escalatedToPmo, true);
    assert.equal(ctx.store.milestones.find((row) => row.id === milestone.id)?.baselineAt?.toISOString(), day("2030-06-20"));
  });

  it("classifica cada data na mesma operação: início definido pela primeira vez e término reprogramado", async () => {
    const ctx = await setup();
    const onlyEnd = await ctx.createTask(pmo, "project-1", ctx.phase.id, {
      title: "Migração de dados",
      plannedStartAt: day("2030-04-01"),
      plannedEndAt: day("2030-04-22"),
    });
    const read = () => ctx.store.tasks.find((row) => row.id === onlyEnd.id);
    const created = read();
    if (created) {
      created.plannedStartAt = null;
      created.baselineStartAt = null;
      created.actualStartAt = new Date(day("2030-04-22"));
    }
    const target = { entityType: "TASK" as const, phaseId: ctx.phase.id, taskId: onlyEnd.id };
    const input = { plannedStartAt: day("2030-04-23"), plannedEndAt: day("2030-04-26") };

    await assert.rejects(() => ctx.reschedule(pmo, "project-1", target, input), rejectsWith("SCHEDULE_JUSTIFICATION_REQUIRED"));

    const change = await ctx.reschedule(pmo, "project-1", target, { ...input, justification });
    assert.equal(change.kind, "RESCHEDULE");
    assert.equal(change.sequence, 1);
    assert.deepEqual(change.changes, [
      { field: "START", kind: "DEFINED", previous: null, next: day("2030-04-23") },
      { field: "END", kind: "RESCHEDULED", previous: day("2030-04-22"), next: day("2030-04-26") },
    ]);
    assert.equal(change.actorId, "pmo-1");
    assert.equal(change.justification, justification);

    assert.equal(read()?.baselineStartAt?.toISOString(), day("2030-04-23"));
    assert.equal(read()?.baselineEndAt?.toISOString(), day("2030-04-22"));
    assert.equal(read()?.actualStartAt?.toISOString(), day("2030-04-22"));
    assert.equal(read()?.actualEndAt, null);

    const later = await ctx.reschedule(pmo, "project-1", target, {
      plannedStartAt: day("2030-04-24"),
      plannedEndAt: day("2030-04-26"),
      justification,
    });
    assert.deepEqual(later.changes.map((item) => `${item.field}:${item.kind}`), ["START:RESCHEDULED"]);
    assert.equal(read()?.baselineStartAt?.toISOString(), day("2030-04-23"));
    assert.equal(read()?.baselineEndAt?.toISOString(), day("2030-04-22"));

    const audit = await ctx.listAudit(pmo, "project-1", { entityType: "TASK", entityId: onlyEnd.id });
    const summary = audit.data.find((entry) => entry.summary.includes("reprogramação nº 1"))?.summary ?? "";
    assert.match(summary, /início definido pela primeira vez: 23\/04\/2030/);
    assert.match(summary, /término 22\/04\/2030 → 26\/04\/2030/);
  });

  it("só definir uma data ausente não exige justificativa nem conta como reprogramação", async () => {
    const ctx = await setup();
    const onlyEnd = await ctx.createTask(pmo, "project-1", ctx.phase.id, {
      title: "Treinamento",
      plannedStartAt: day("2030-05-01"),
      plannedEndAt: day("2030-05-10"),
    });
    const legacyTask = ctx.store.tasks.find((row) => row.id === onlyEnd.id);
    if (legacyTask) {
      legacyTask.plannedStartAt = null;
      legacyTask.baselineStartAt = null;
    }
    const change = await ctx.reschedule(owner, "project-1", { entityType: "TASK", phaseId: ctx.phase.id, taskId: onlyEnd.id }, {
      plannedStartAt: day("2030-05-01"),
      plannedEndAt: day("2030-05-10"),
    });
    assert.equal(change.kind, "PLANNING_DEFINED");
    assert.equal(change.sequence, null);
    assert.deepEqual(change.changes.map((item) => `${item.field}:${item.kind}`), ["START:DEFINED"]);
  });

  it("usa a data planejada existente como linha de base quando ela ainda não foi registrada", async () => {
    const ctx = await setup();
    const read = () => ctx.store.tasks.find((row) => row.id === ctx.task.id);
    const legacy = read();
    if (legacy) {
      legacy.baselineStartAt = null;
      legacy.baselineEndAt = null;
    }
    await ctx.reschedule(pmo, "project-1", { entityType: "TASK", phaseId: ctx.phase.id, taskId: ctx.task.id }, {
      plannedStartAt: day("2030-02-10"),
      plannedEndAt: day("2030-03-30"),
      justification,
    });
    assert.equal(read()?.baselineStartAt?.toISOString(), day("2030-02-10"));
    assert.equal(read()?.baselineEndAt?.toISOString(), day("2030-03-10"));
  });

  it("bloqueia datas inválidas, alteração inexistente e item concluído sem gravar nada", async () => {
    const ctx = await setup();
    const target = { entityType: "TASK" as const, phaseId: ctx.phase.id, taskId: ctx.task.id };
    const before = ctx.store.auditLogs.length;

    await assert.rejects(
      () =>
        ctx.reschedule(pmo, "project-1", target, {
          plannedStartAt: day("2030-03-10"),
          plannedEndAt: day("2030-03-01"),
          justification,
        }),
      rejectsWith("SCHEDULE_DATES_INVALID"),
    );
    await assert.rejects(
      () =>
        ctx.reschedule(pmo, "project-1", target, {
          plannedStartAt: day("2030-02-10"),
          plannedEndAt: day("2030-03-10"),
          justification,
        }),
      rejectsWith("SCHEDULE_UNCHANGED"),
    );
    await assert.rejects(
      () =>
        ctx.reschedule(pmo, "project-1", target, {
          plannedStartAt: day("2030-02-10"),
          plannedEndAt: day("2030-03-12"),
          justification: "curta",
        }),
      rejectsWith("SCHEDULE_JUSTIFICATION_REQUIRED"),
    );

    const task = ctx.store.tasks.find((row) => row.id === ctx.task.id);
    if (task) task.progressPercent = 100;
    await assert.rejects(
      () =>
        ctx.reschedule(pmo, "project-1", target, {
          plannedStartAt: day("2030-02-10"),
          plannedEndAt: day("2030-03-12"),
          justification,
        }),
      rejectsWith("SCHEDULE_ITEM_CLOSED"),
    );

    assert.equal(ctx.store.auditLogs.length, before);
    assert.equal(task?.plannedEndAt?.toISOString(), day("2030-03-10"));
  });

  it("recusa quem não é ADMIN, PMO ou gestão do projeto", async () => {
    const ctx = await setup();
    const target = { entityType: "PHASE" as const, phaseId: ctx.phase.id };
    const input = { plannedStartAt: day("2030-02-01"), plannedEndAt: day("2030-07-15"), justification };

    for (const forbidden of [coordinator, supplier, collaborator]) {
      await assert.rejects(
        () => ctx.reschedule(forbidden, "project-1", target, input),
        rejectsWith("SCHEDULE_RESCHEDULE_FORBIDDEN"),
      );
    }
    await assert.rejects(
      () => ctx.reschedule(outsideManager, "project-1", target, input),
      rejectsWith("PROJECT_FORBIDDEN"),
    );

    const done = await ctx.reschedule(admin, "project-1", target, input);
    assert.equal(done.sequence, 1);
  });

  it("sinaliza impactos sem alterar outros elementos e preserva atraso anterior", async () => {
    const ctx = await setup();
    const overdueTask = await ctx.createTask(pmo, "project-1", ctx.phase.id, {
      title: "Carga inicial",
      plannedStartAt: day("2020-01-10"),
      plannedEndAt: day("2020-01-20"),
    });

    const change = await ctx.reschedule(pmo, "project-1", {
      entityType: "TASK",
      phaseId: ctx.phase.id,
      taskId: overdueTask.id,
    }, {
      plannedStartAt: day("2030-05-01"),
      plannedEndAt: day("2031-02-01"),
      justification,
    });

    assert.equal(change.wasOverdue, true);
    assert.deepEqual(
      change.impacts.map((impact) => impact.code),
      ["PHASE_END_EXCEEDED", "PROJECT_END_EXCEEDED"],
    );
    assert.equal(change.escalatedToPmo, true);

    const phase = ctx.store.phases.find((row) => row.id === ctx.phase.id);
    assert.equal(phase?.plannedEndAt?.toISOString(), day("2030-06-30"));
    assert.equal(ctx.store.projects[0].plannedEndAt?.toISOString(), day("2030-12-31"));

    const phaseChange = await ctx.reschedule(pmo, "project-1", { entityType: "PHASE", phaseId: ctx.phase.id }, {
      plannedStartAt: day("2030-02-01"),
      plannedEndAt: day("2030-03-01"),
      justification,
    });
    assert.ok(phaseChange.impacts.some((impact) => impact.code === "ITEMS_OUTSIDE"));
    assert.equal(ctx.store.tasks.find((row) => row.id === overdueTask.id)?.plannedEndAt?.toISOString(), day("2031-02-01"));
  });

  it("reprograma o projeto e expõe indicadores de monitoramento", async () => {
    const ctx = await setup();
    await ctx.reschedule(owner, "project-1", { entityType: "PROJECT" }, {
      plannedStartAt: day("2030-01-01"),
      plannedEndAt: day("2031-03-31"),
      justification,
    });
    await ctx.reschedule(pmo, "project-1", { entityType: "TASK", phaseId: ctx.phase.id, taskId: ctx.task.id }, {
      plannedStartAt: day("2030-02-10"),
      plannedEndAt: day("2030-03-25"),
      justification,
    });

    const project = ctx.store.projects[0];
    assert.equal(project.plannedEndAt?.toISOString(), day("2031-03-31"));
    assert.equal(project.baselineEndAt?.toISOString(), day("2030-12-31"));

    const data = await ctx.monitoring(supplier, "project-1");
    assert.equal(data.project.rescheduleCount, 1);
    assert.equal(data.project.baselineEndAt, day("2030-12-31"));
    assert.equal(data.reschedules.total, 2);
    const task = data.items.find((item) => item.entityId === ctx.task.id);
    assert.equal(task?.rescheduleCount, 1);
    assert.equal(task?.baselineEndAt, day("2030-03-10"));
    assert.equal(task?.plannedEndAt, day("2030-03-25"));
  });
});
