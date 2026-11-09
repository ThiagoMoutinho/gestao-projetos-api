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
import { makeCreateTaskUseCase } from "./create-task";
import { makeGetScheduleMonitoringUseCase } from "./get-schedule-monitoring";
import { makeListScheduleHistoryUseCase } from "./list-schedule-history";
import { makeRescheduleUseCase } from "./reschedule";

function actor(role: AuthUser["role"], id: string, name = id): AuthUser {
  return { id, name, email: `${id}@igepps.test`, role };
}

const pmo = actor("PMO", "pmo-1", "Ana PMO");
const manager = actor("GESTOR", "gestor-1", "Gil Gestor");
const supplier = actor("FORNECEDOR", "forn-1", "Fábio Fornecedor");
const outsider = actor("GESTOR", "gestor-fora", "Fora");

const day = (value: string) => `${value}T15:00:00.000Z`;
const at = (value: string) => new Date(day(value));
const defaults = { limit: 50, offset: 0, includeInitial: "true" as const };

async function setup() {
  const store = createEapInMemoryStore({
    users: [
      makeUser({ id: "pmo-1", name: "Ana PMO", role: "PMO" }),
      makeUser({ id: "gestor-1", name: "Gil Gestor", role: "GESTOR" }),
      makeUser({ id: "forn-1", name: "Fábio Fornecedor", role: "FORNECEDOR" }),
      makeUser({ id: "gestor-fora", name: "Fora", role: "GESTOR" }),
    ],
    projects: [makeProject({ id: "project-1", name: "Portal", ownerId: "gestor-1" })],
    members: [
      makeMember({ id: "m-gestor", projectId: "project-1", userId: "gestor-1", role: "GESTOR" }),
      makeMember({ id: "m-forn", projectId: "project-1", userId: "forn-1", role: "FORNECEDOR" }),
    ],
  });
  const repos = makeEapInMemoryRepos(store);
  const deps = { repos, runInTransaction: makeEapInMemoryTransactionRunner(repos, store) };
  const phase = await makeCreatePhaseUseCase(deps)(pmo, "project-1", { name: "Construção" });
  const task = await makeCreateTaskUseCase(deps)(pmo, "project-1", phase.id, {
    title: "API de integração",
    plannedStartAt: day("2030-02-10"),
    plannedEndAt: day("2030-03-10"),
  });
  const undated = await makeCreateTaskUseCase(deps)(pmo, "project-1", phase.id, { title: "Tarefa sem data" });
  return {
    store,
    phase,
    task,
    undated,
    reschedule: makeRescheduleUseCase(deps),
    history: makeListScheduleHistoryUseCase(deps),
    monitoring: makeGetScheduleMonitoringUseCase(deps),
  };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

function seedRequests(ctx: Ctx) {
  const base = { projectId: "project-1", taskId: ctx.task.id };
  const history = (status: "PENDENTE" | "APROVADA" | "REJEITADA" | "CANCELADA" | "CANCELADA_CONFLITO", extra = {}) => ({
    field: "PLANNED_END_AT" as const,
    baselineValue: at("2030-03-10"),
    expectedCurrentValue: at("2030-03-10"),
    proposedValue: at("2030-04-20"),
    justification: "Fornecedor atrasou a entrega do ambiente de homologação.",
    status,
    requestedBy: "gestor-1",
    requestedAt: at("2030-01-05"),
    reviewedBy: null,
    reviewedAt: null,
    decisionNote: null,
    ...extra,
  });
  ctx.store.scheduleRequests.push(
    { id: "req-pendente", ...base, history: history("PENDENTE", { requestedAt: at("2030-01-05") }) },
    {
      id: "req-aprovada",
      ...base,
      history: history("APROVADA", { requestedAt: at("2030-01-03"), reviewedBy: "pmo-1", reviewedAt: at("2030-01-04"), proposedValue: at("2030-03-25") }),
      change: { field: "PLANNED_END_AT", oldValue: at("2030-03-10"), newValue: at("2030-03-25"), createdAt: at("2030-01-04") },
    },
    {
      id: "req-rejeitada",
      ...base,
      history: history("REJEITADA", { requestedAt: at("2030-01-02"), reviewedBy: "pmo-1", reviewedAt: at("2030-01-02"), decisionNote: "Prazo sem justificativa técnica suficiente." }),
    },
    {
      id: "req-cancelada",
      ...base,
      history: history("CANCELADA", { requestedAt: at("2030-01-01"), reviewedAt: at("2030-01-01") }),
    },
  );
}

describe("histórico unificado de cronograma", () => {
  it("reprogramação sem solicitação vira LEGACY_DIRECT, sem solicitante, aprovador nem categoria inventados", async () => {
    const ctx = await setup();
    await ctx.reschedule(manager, "project-1", { entityType: "TASK", phaseId: ctx.phase.id, taskId: ctx.task.id }, {
      plannedStartAt: day("2030-02-10"),
      plannedEndAt: day("2030-03-20"),
      justification: "Fornecedor atrasou a entrega do ambiente.",
    });

    const result = await ctx.history(manager, "project-1", defaults);
    const [item] = result.data.filter((entry) => entry.source === "LEGACY_DIRECT");

    assert.equal(item.status, "EFETIVADA_DIRETAMENTE");
    assert.equal(item.entityType, "TASK");
    assert.equal(item.entityTitle, "API de integração");
    assert.equal(item.requestedBy, null);
    assert.equal(item.requestedAt, null);
    assert.equal(item.reviewedBy, null);
    assert.equal(item.reviewedAt, null);
    assert.equal(item.decisionNote, null);
    assert.equal(item.reasonCategory, null);
    assert.equal(item.field, null);
    assert.deepEqual(item.registeredBy, { id: "gestor-1", name: "Gil Gestor" });
    assert.equal(item.justification, "Fornecedor atrasou a entrega do ambiente.");
    assert.equal(item.previous.endAt, day("2030-03-10"));
    assert.equal(item.next.endAt, day("2030-03-20"));
    assert.equal(item.sequence, 1);
    assert.equal(result.counts.legacyDirect, 1);
  });

  it("registro antigo sem justificativa continua sem justificativa (nada é inventado)", async () => {
    const ctx = await setup();
    await ctx.reschedule(pmo, "project-1", { entityType: "TASK", phaseId: ctx.phase.id, taskId: ctx.task.id }, {
      plannedStartAt: day("2030-02-10"),
      plannedEndAt: day("2030-03-20"),
      justification: "Fornecedor atrasou a entrega do ambiente.",
    });
    const entry = ctx.store.auditLogs.find((row) => row.action === "SCHEDULE_CHANGE");
    assert.ok(entry);
    delete (entry.payload as Record<string, unknown>).justification;

    const [item] = (await ctx.history(pmo, "project-1", defaults)).data;
    assert.equal(item.justification, null);
  });

  it("primeira definição de datas aparece como INITIAL_DEFINITION e não conta como reprogramação", async () => {
    const ctx = await setup();
    await ctx.reschedule(manager, "project-1", { entityType: "TASK", phaseId: ctx.phase.id, taskId: ctx.undated.id }, {
      plannedStartAt: day("2030-05-01"),
      plannedEndAt: day("2030-05-20"),
    });

    const result = await ctx.history(manager, "project-1", defaults);
    const initial = result.data.filter((entry) => entry.source === "INITIAL_DEFINITION");
    assert.equal(initial.length, 1);
    assert.equal(initial[0].status, "DEFINIDA");
    assert.equal(result.counts.initialDefinitions, 1);
    assert.equal(result.counts.legacyDirect, 0);
    assert.equal(result.lastRescheduleAt, null);

    const hidden = await ctx.history(manager, "project-1", { ...defaults, includeInitial: "false" });
    assert.equal(hidden.data.length, 0);
    assert.equal(hidden.counts.initialDefinitions, 1, "a contagem continua mostrando o que existe");
  });

  it("solicitações aparecem em todas as situações, com solicitante e analista reais; só a aprovada mostra datas efetivadas", async () => {
    const ctx = await setup();
    seedRequests(ctx);

    const result = await ctx.history(manager, "project-1", defaults);
    const byId = Object.fromEntries(result.data.map((item) => [item.id, item]));

    const pendente = byId["request:req-pendente"];
    assert.equal(pendente.source, "REQUEST");
    assert.equal(pendente.status, "PENDENTE");
    assert.equal(pendente.field, "END");
    assert.deepEqual(pendente.requestedBy, { id: "gestor-1", name: "Gil Gestor" });
    assert.equal(pendente.reviewedBy, null);
    assert.equal(pendente.reviewedAt, null);
    assert.equal(pendente.previous.endAt, day("2030-03-10"));
    assert.equal(pendente.next.endAt, day("2030-04-20"), "datas PROPOSTAS, não vigentes");

    const aprovada = byId["request:req-aprovada"];
    assert.equal(aprovada.status, "APROVADA");
    assert.deepEqual(aprovada.reviewedBy, { id: "pmo-1", name: "Ana PMO" });
    assert.equal(aprovada.next.endAt, day("2030-03-25"), "datas da mudança efetivamente aplicada");

    const rejeitada = byId["request:req-rejeitada"];
    assert.equal(rejeitada.status, "REJEITADA");
    assert.equal(rejeitada.decisionNote, "Prazo sem justificativa técnica suficiente.");

    assert.equal(byId["request:req-cancelada"].status, "CANCELADA");
    assert.deepEqual(result.counts.requests, { pendente: 1, aprovada: 1, rejeitada: 1, cancelada: 1, canceladaConflito: 0 });
    assert.ok(result.data.every((item) => item.reasonCategory === null));
  });

  it("solicitação pendente, rejeitada ou cancelada não altera datas nem o total de reprogramações do monitoramento", async () => {
    const ctx = await setup();
    const before = await ctx.monitoring(pmo, "project-1");
    seedRequests(ctx);
    const snapshot = JSON.stringify({ tasks: ctx.store.tasks, phases: ctx.store.phases, audit: ctx.store.auditLogs, requests: ctx.store.scheduleRequests });

    await ctx.history(pmo, "project-1", defaults);
    await ctx.history(pmo, "project-1", { ...defaults, source: "REQUEST" });

    assert.equal(
      JSON.stringify({ tasks: ctx.store.tasks, phases: ctx.store.phases, audit: ctx.store.auditLogs, requests: ctx.store.scheduleRequests }),
      snapshot,
      "a consulta é somente leitura",
    );
    const after = await ctx.monitoring(pmo, "project-1");
    assert.equal(after.reschedules.total, before.reschedules.total);
    assert.deepEqual(after.overdue, before.overdue);
    assert.deepEqual(after.deadlineSituation, before.deadlineSituation);
    const task = after.items.find((item) => item.entityId === ctx.task.id);
    assert.equal(task?.plannedEndAt, day("2030-03-10"), "o prazo vigente permanece o original");
  });

  it("registro da auditoria que referencia uma solicitação não é contado duas vezes", async () => {
    const ctx = await setup();
    seedRequests(ctx);
    await ctx.reschedule(pmo, "project-1", { entityType: "TASK", phaseId: ctx.phase.id, taskId: ctx.task.id }, {
      plannedStartAt: day("2030-02-10"),
      plannedEndAt: day("2030-03-25"),
      justification: "Aplicação da solicitação aprovada pelo PMO.",
    });
    const entry = ctx.store.auditLogs.find((row) => row.action === "SCHEDULE_CHANGE");
    assert.ok(entry);
    (entry.payload as Record<string, unknown>).requestId = "req-aprovada";

    const result = await ctx.history(pmo, "project-1", defaults);
    assert.equal(result.counts.legacyDirect, 0);
    assert.equal(result.data.filter((item) => item.id.startsWith("audit:")).length, 0);
    assert.equal(result.data.find((item) => item.id === "request:req-aprovada")?.sequence, 1, "detalhes da auditoria complementam a solicitação");
    assert.notEqual(result.lastRescheduleAt, null, "a reprogramação efetivada continua contando no monitoramento");
  });

  it("ordena do mais recente ao mais antigo, filtra por origem e pagina", async () => {
    const ctx = await setup();
    seedRequests(ctx);
    await ctx.reschedule(manager, "project-1", { entityType: "TASK", phaseId: ctx.phase.id, taskId: ctx.task.id }, {
      plannedStartAt: day("2030-02-10"),
      plannedEndAt: day("2030-03-20"),
      justification: "Fornecedor atrasou a entrega do ambiente.",
    });

    const all = await ctx.history(manager, "project-1", defaults);
    const dates = all.data.map((item) => item.occurredAt);
    assert.deepEqual([...dates].sort().reverse(), dates);
    assert.equal(all.total, 5);

    const requestsOnly = await ctx.history(manager, "project-1", { ...defaults, source: "REQUEST" });
    assert.equal(requestsOnly.total, 4);
    assert.ok(requestsOnly.data.every((item) => item.source === "REQUEST"));

    const page = await ctx.history(manager, "project-1", { ...defaults, limit: 2, offset: 1 });
    assert.equal(page.total, 5);
    assert.deepEqual(page.data.map((item) => item.id), all.data.slice(1, 3).map((item) => item.id));
  });

  it("quem vê o projeto consulta (inclusive fornecedor vinculado); quem não vê não consulta", async () => {
    const ctx = await setup();
    seedRequests(ctx);
    assert.equal((await ctx.history(supplier, "project-1", defaults)).data.length, 4);
    await assert.rejects(
      () => ctx.history(outsider, "project-1", defaults),
      (error: unknown) => error instanceof HttpError && [403, 404].includes(error.statusCode),
    );
  });

  it("sem nenhum registro devolve vazio e contagens zeradas", async () => {
    const ctx = await setup();
    const result = await ctx.history(pmo, "project-1", defaults);
    assert.deepEqual(result, {
      total: 0,
      counts: { legacyDirect: 0, initialDefinitions: 0, requests: { pendente: 0, aprovada: 0, rejeitada: 0, cancelada: 0, canceladaConflito: 0 } },
      lastRescheduleAt: null,
      data: [],
    });
  });
});
