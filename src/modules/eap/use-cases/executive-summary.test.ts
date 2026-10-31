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
import { makeDeliverMilestoneUseCase } from "./deliver-milestone";
import { projectProgress } from "./eap-status";
import { buildNarrative, nextDeliveriesFrom } from "./executive-summary-narrative";
import { makeGetExecutiveSummaryUseCase } from "./get-executive-summary";
import { makeRescheduleUseCase } from "./reschedule";

function actor(role: AuthUser["role"], id: string): AuthUser {
  return { id, name: id, email: `${id}@igepps.test`, role };
}

const pmo = actor("PMO", "pmo-1");
const supplier = actor("FORNECEDOR", "forn-1");
const outsider = actor("COLABORADOR", "out-1");
const NOW = new Date("2026-07-15T15:00:00.000Z");
const day = (value: string) => `${value}T15:00:00.000Z`;

async function setup() {
  const store = createEapInMemoryStore({
    users: [
      makeUser({ id: "pmo-1", role: "PMO" }),
      makeUser({ id: "forn-1", role: "FORNECEDOR" }),
      makeUser({ id: "rev-1", role: "COLABORADOR" }),
      makeUser({ id: "out-1", role: "COLABORADOR" }),
    ],
    projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
    members: [
      makeMember({ id: "m-forn", projectId: "project-1", userId: "forn-1", role: "FORNECEDOR" }),
      makeMember({ id: "m-rev", projectId: "project-1", userId: "rev-1", role: "OBSERVADOR" }),
    ],
  });
  const repos = makeEapInMemoryRepos(store);
  const deps = { repos, runInTransaction: makeEapInMemoryTransactionRunner(repos, store) };
  return {
    store,
    summary: makeGetExecutiveSummaryUseCase(deps),
    createPhase: makeCreatePhaseUseCase(deps),
    createTask: makeCreateTaskUseCase(deps),
    createMilestone: makeCreateMilestoneUseCase(deps),
    deliver: makeDeliverMilestoneUseCase(deps),
    reschedule: makeRescheduleUseCase(deps),
  };
}

describe("Resumo executivo automático", () => {
  it("projeto sem EAP: sem dados suficientes, sem inventar indicadores", async () => {
    const ctx = await setup();

    const summary = await ctx.summary(pmo, "project-1", NOW);

    assert.equal(summary.hasData, false);
    assert.equal(summary.progress.basisPoints, null);
    assert.equal(summary.overdue.total, 0);
    assert.deepEqual(summary.nextDeliveries, []);
    assert.deepEqual(summary.movements, []);
    assert.equal(summary.generatedAt, NOW.toISOString());
    assert.deepEqual(summary.narrative.map((line) => line.key), ["no-data"]);
  });

  it("projeto com atrasos, impedimento, reprogramação e homologação pendente", async () => {
    const ctx = await setup();
    const phase = await ctx.createPhase(pmo, "project-1", { name: "Implantação" });
    const late = await ctx.createTask(pmo, "project-1", phase.id, {
      title: "Migrar base",
      assigneeId: "forn-1",
      plannedStartAt: day("2026-06-01"),
      plannedEndAt: day("2026-06-30"),
    });
    await ctx.createTask(pmo, "project-1", phase.id, {
      title: "Treinar equipe",
      assigneeId: "forn-1",
      plannedStartAt: day("2026-08-01"),
      plannedEndAt: day("2026-08-30"),
    });
    ctx.store.tasks.find((row) => row.id === late.id)!.hasImpediment = true;

    const delivered = await ctx.createMilestone(pmo, "project-1", phase.id, {
      title: "Homologação do módulo",
      description: "Entrega do módulo.",
      type: "ENTREGA",
      plannedAt: day("2026-07-01"),
      reviewerId: "rev-1",
      presenterId: "forn-1",
    });
    await ctx.deliver(supplier, "project-1", phase.id, delivered.id, { note: "Pronto para validação." });
    for (const [title, plannedAt] of [
      ["Marco D", "2026-09-30"],
      ["Marco A", "2026-08-10"],
      ["Marco C", "2026-09-10"],
      ["Marco B", "2026-08-20"],
    ] as const) {
      await ctx.createMilestone(pmo, "project-1", phase.id, { title, description: "Marco.", type: "ENTREGA", plannedAt: day(plannedAt) });
    }
    await ctx.reschedule(pmo, "project-1", { entityType: "TASK", phaseId: phase.id, taskId: late.id }, {
      plannedStartAt: day("2026-06-01"),
      plannedEndAt: day("2026-07-10"),
      justification: "Atraso na entrega do fornecedor.",
    });

    const summary = await ctx.summary(pmo, "project-1", NOW);

    assert.equal(summary.hasData, true);
    assert.ok(summary.overdue.tasks >= 1);
    assert.equal(summary.overdue.total, summary.overdue.phases + summary.overdue.tasks + summary.overdue.milestones);
    assert.equal(summary.impediments, 1);
    assert.equal(summary.reschedules.total, 1);
    assert.equal(summary.homologation.awaiting, 1);
    // Próximas entregas: só marcos ainda a entregar, do prazo mais próximo ao mais distante, no máximo três.
    assert.deepEqual(summary.nextDeliveries.map((item) => item.title), ["Marco A", "Marco B", "Marco C"]);
    assert.equal(summary.nextDeliveries[0].phaseName, "Implantação");
    // Os eventos relevantes (entrega e reprogramação) aparecem; sem texto interpretado.
    assert.ok(summary.movements.length > 0 && summary.movements.length <= 5);
    assert.ok(summary.movements.every((entry) => entry.summary.length > 0));
    assert.ok(summary.movements.some((entry) => entry.kind === "RESCHEDULE"));

    const text = summary.narrative.map((line) => line.text).join(" ");
    assert.match(text, /1 reprogramação registrada/);
    assert.match(text, /1 entrega aguardando homologação/);
    assert.match(text, /1 tarefa com impedimento registrado/);
    assert.match(text, /Próxima entrega: Marco A, prevista para 10\/08\/2026\./);
  });

  it("a narrativa usa apenas frases predefinidas e números calculados", () => {
    const lines = buildNarrative({
      generatedAt: NOW.toISOString(),
      hasData: true,
      situation: { status: "CRITICO", delayDays: 12, delayedItems: 2, pendingValidation: 0, formalDecision: null, closureRequirementsMissing: false, readyForClosure: false, undatedDeliveries: 0 } as never,
      progress: { basisPoints: 7333, coverageBasisPoints: 6667, phasesTotal: 3, phasesCalculated: 2 },
      overdue: { phases: 0, tasks: 2, milestones: 1, total: 3 },
      impediments: 0,
      reschedules: { total: 2, escalated: 1, affectingCriticalMilestones: 0 },
      homologation: { awaiting: 2, inCorrections: 1, rejected: 0 },
      nextDeliveries: [],
      movements: [],
    });
    const byKey = Object.fromEntries(lines.map((line) => [line.key, line.text]));

    assert.equal(byKey.situation, "Situação atual: Crítico, com o maior atraso em 12 dias.");
    assert.equal(byKey.progress, "Progresso consolidado: 73,3% (2 de 3 fases calculadas).");
    assert.equal(byKey.overdue, "3 itens em atraso: 0 fases, 2 tarefas e 1 marco.");
    assert.equal(byKey.impediments, "Nenhum impedimento registrado.");
    assert.equal(byKey.reschedules, "2 reprogramações registradas, 1 escalonada ao PMO.");
    assert.equal(byKey.homologation, "2 entregas aguardando homologação e 1 em correção.");
    assert.equal(byKey["next-delivery"], "Nenhuma entrega futura prevista.");
  });

  it("o andamento do projeto é a média simples das fases com valor (mesma regra do frontend)", () => {
    // Os mesmos valores são verificados no frontend (eap-progress.test.ts).
    const result = projectProgress([
      { state: "VALUE", basisPoints: 10000 },
      { state: "VALUE", basisPoints: 5000 },
      { state: "EMPTY", basisPoints: null },
    ] as never);
    assert.deepEqual(result, { progressBasisPoints: 7500, coverageBasisPoints: 6667 });
  });

  it("marcos entregues, aprovados ou sem data não entram nas próximas entregas", () => {
    const item = (entityId: string, status: string, plannedEndAt: string | null) =>
      ({ entityType: "MILESTONE", entityId, phaseId: "f1", title: entityId, status, plannedEndAt, overdue: false }) as never;
    const result = nextDeliveriesFrom(
      [item("a", "APROVADO", day("2026-08-01")), item("b", "ENTREGUE", day("2026-08-02")), item("c", "PENDENTE", null), item("d", "AJUSTES_SOLICITADOS", day("2026-08-03"))],
      new Map([["f1", "Fase 1"]]),
    );
    assert.deepEqual(result.map((entry) => [entry.id, entry.corrections]), [["d", true]]);
  });

  it("mantém as permissões de consulta: sem vínculo é recusado e fornecedor não vê o histórico de governança", async () => {
    const ctx = await setup();
    const phase = await ctx.createPhase(pmo, "project-1", { name: "Fase" });
    await ctx.createTask(pmo, "project-1", phase.id, { title: "Tarefa", assigneeId: "forn-1", plannedStartAt: day("2026-08-01"), plannedEndAt: day("2026-08-30") });

    await assert.rejects(() => ctx.summary(outsider, "project-1", NOW), (error: unknown) => error instanceof HttpError && [403, 404].includes(error.statusCode));
    const forSupplier = await ctx.summary(supplier, "project-1", NOW);
    assert.equal(forSupplier.hasData, true);
    // Sem permissão de governança, as entradas de governança não aparecem.
    ctx.store.auditLogs.push({
      id: "gov-1",
      projectId: "project-1",
      entityType: "PROJECT",
      entityId: "project-1",
      action: "STATUS_CHANGE",
      summary: "Situação do projeto alterada.",
      payload: { kind: "STATUS" },
      actorId: "pmo-1",
      createdAt: new Date(),
    } as never);
    const forPmo = await ctx.summary(pmo, "project-1", NOW);
    const bySupplier = await ctx.summary(supplier, "project-1", NOW);
    assert.ok(forPmo.movements.some((entry) => entry.id === "gov-1"));
    assert.ok(!bySupplier.movements.some((entry) => entry.id === "gov-1"));
  });
});
