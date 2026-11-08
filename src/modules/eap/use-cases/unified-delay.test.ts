import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
import { eapDelays } from "./eap-delay";
import { makeGetExecutiveSummaryUseCase } from "./get-executive-summary";
import { makeGetScheduleMonitoringUseCase } from "./get-schedule-monitoring";

const pmo: AuthUser = { id: "pmo-1", name: "pmo-1", email: "pmo-1@igepps.test", role: "PMO" };
const NOW = new Date("2026-10-26T15:00:00.000Z");
const day = (value: string) => `${value}T15:00:00.000Z`;

async function setup() {
  const store = createEapInMemoryStore({
    users: [makeUser({ id: "pmo-1", role: "PMO" }), makeUser({ id: "forn-1", role: "FORNECEDOR" })],
    projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
    members: [makeMember({ id: "m-forn", projectId: "project-1", userId: "forn-1", role: "FORNECEDOR" })],
  });
  const repos = makeEapInMemoryRepos(store);
  const deps = { repos, runInTransaction: makeEapInMemoryTransactionRunner(repos, store) };
  const createPhase = makeCreatePhaseUseCase(deps);
  const createTask = makeCreateTaskUseCase(deps);
  const createMilestone = makeCreateMilestoneUseCase(deps);

  const phase = await createPhase(pmo, "project-1", { name: "Execução" });
  const suspended = await createPhase(pmo, "project-1", { name: "Suspensa" });
  store.phases.find((row) => row.id === suspended.id)!.status = "SUSPENSA";

  const task = (title: string, phaseId: string, plannedEndAt: string) =>
    createTask(pmo, "project-1", phaseId, { title, assigneeId: "forn-1", plannedStartAt: day("2026-06-01"), plannedEndAt: day(plannedEndAt) });
  const mark = (title: string, phaseId: string, plannedAt: string) =>
    createMilestone(pmo, "project-1", phaseId, { title, description: "Marco.", type: "ENTREGA", plannedAt: day(plannedAt) });

  // Em atraso de execução (4): tarefa aberta, marco pendente, marco rejeitado e marco entregue depois do prazo.
  await task("Tarefa vencida", phase.id, "2026-10-24"); // 2 dias
  await mark("Marco pendente vencido", phase.id, "2026-10-15"); // 11 dias
  const rejected = await mark("Marco rejeitado vencido", phase.id, "2026-10-20");
  store.milestones.find((row) => row.id === rejected.id)!.status = "REJEITADO";
  const late = await mark("Marco entregue com atraso", phase.id, "2026-10-20");
  Object.assign(store.milestones.find((row) => row.id === late.id)!, { status: "ENTREGUE", actualAt: new Date(day("2026-10-23")) });

  // Fora do atraso: entregue no prazo e aguardando homologação (prazo já passado), itens de fase suspensa e prazos futuros.
  const onTime = await mark("Marco entregue no prazo", phase.id, "2026-10-22");
  Object.assign(store.milestones.find((row) => row.id === onTime.id)!, { status: "ENTREGUE", actualAt: new Date(day("2026-10-21")) });
  await task("Tarefa de fase suspensa", suspended.id, "2026-09-01");
  await mark("Marco de fase suspensa", suspended.id, "2026-09-01");
  await task("Tarefa no prazo", phase.id, "2026-12-01");

  return {
    store,
    monitoring: makeGetScheduleMonitoringUseCase(deps),
    summary: makeGetExecutiveSummaryUseCase(deps),
  };
}

describe("regra única de atraso: todos os pontos da API concordam", () => {
  it("8. Situação atual, monitoramento, Resumo executivo e Planejamento apresentam a mesma contagem", async () => {
    const ctx = await setup();
    const monitoring = await ctx.monitoring(pmo, "project-1", NOW);
    const summary = await ctx.summary(pmo, "project-1", NOW);

    // Situação atual (e status do projeto).
    assert.equal(monitoring.situation.delayedItems, 4);
    // Monitoramento de prazos: contagem por tipo e a marca de cada item.
    assert.deepEqual(monitoring.overdue, { phases: 0, tasks: 1, milestones: 3 });
    const flagged = monitoring.items.filter((item) => item.overdue);
    assert.equal(flagged.length, 4);
    assert.ok(flagged.every((item) => item.entityType !== "PHASE"));
    // Planejamento ("Em atraso agora") soma o mesmo objeto do monitoramento.
    assert.equal(monitoring.overdue.phases + monitoring.overdue.tasks + monitoring.overdue.milestones, monitoring.situation.delayedItems);
    // Resumo executivo.
    assert.equal(summary.overdue.total, monitoring.situation.delayedItems);
    assert.equal(summary.situation.delayedItems, summary.overdue.total);
    assert.match(summary.narrative.map((line) => line.text).join(" "), /4 itens em atraso: 1 tarefa e 3 marcos\./);
    // A entrega no prazo fica só no indicador de homologação (2 entregues: uma no prazo e uma com atraso).
    assert.equal(monitoring.homologation.awaiting, 2);
    assert.equal(monitoring.situation.pendingValidation, 2);
    const onTime = monitoring.items.find((item) => item.title === "Marco entregue no prazo")!;
    assert.equal(onTime.overdue, false);
    assert.equal(onTime.deadlinePerformance, "OPEN_ON_TIME");
    const lateItem = monitoring.items.find((item) => item.title === "Marco entregue com atraso")!;
    assert.equal(lateItem.overdue, true);
    assert.equal(lateItem.deadlinePerformance, "OPEN_OVERDUE");
  });

  it("9. o status do projeto usa a mesma regra: o maior atraso da função única decide Atenção ou Crítico", async () => {
    const ctx = await setup();
    const monitoring = await ctx.monitoring(pmo, "project-1", NOW);
    const { store } = ctx;
    const direct = eapDelays({ phases: store.phases, tasks: store.tasks, milestones: store.milestones, deliveries: store.deliveries, now: NOW });
    assert.equal(monitoring.situation.delayDays, direct.delayDays);
    assert.equal(monitoring.situation.delayedItems, direct.items.length);
    assert.equal(monitoring.situation.delayDays, 11);
    assert.equal(monitoring.situation.status, "CRITICO"); // mais de 5 dias

    // Sem os itens que a regra manda ignorar, só sobra a entrega no prazo aguardando validação: não é atraso.
    const clean = await setup();
    clean.store.tasks.length = 0;
    clean.store.milestones.splice(0, clean.store.milestones.length, ...clean.store.milestones.filter((row) => row.title === "Marco entregue no prazo"));
    const onlyOnTime = await clean.monitoring(pmo, "project-1", NOW);
    assert.equal(onlyOnTime.situation.delayedItems, 0);
    assert.equal(onlyOnTime.situation.status, "EM_VALIDACAO");
    assert.equal(onlyOnTime.homologation.awaiting, 1);
    assert.equal((await clean.summary(pmo, "project-1", NOW)).overdue.total, 0);
  });
});
