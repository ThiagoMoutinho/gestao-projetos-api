import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { toEapAuditDetails } from "../dtos/eap-audit.dto";
import type { EapAuditEntryRow } from "../repositories/contracts";
import { registerImpedimentBodySchema, resolveImpedimentBodySchema } from "../schemas/eap-impediments.schema";
import { updateTaskProgressBodySchema } from "../schemas/eap-tasks.schema";
import {
  createEapInMemoryStore,
  makeEapInMemoryRepos,
  makeEapInMemoryTransactionRunner,
  makeMember,
  makeProject,
  makeUser,
} from "../test/in-memory";
import { makeCancelTaskUseCase } from "./cancel-task";
import { makeCreatePhaseUseCase } from "./create-phase";
import { makeCreateTaskUseCase } from "./create-task";
import { makeListAuditUseCase } from "./list-audit";
import { makeListImpedimentsUseCase } from "./list-impediments";
import { makeRegisterImpedimentUseCase } from "./register-impediment";
import { makeResolveImpedimentUseCase } from "./resolve-impediment";
import { makeUpdateImpedimentUseCase } from "./update-impediment";
import { makeUpdateTaskProgressUseCase } from "./update-task-progress";

function actor(role: AuthUser["role"], id: string): AuthUser {
  return { id, name: id, email: `${id}@igepps.test`, role };
}

const pmo = actor("PMO", "pmo-1");
const supplier = actor("FORNECEDOR", "forn-1");
const observer = actor("COLABORADOR", "obs-1");
const outsider = actor("COLABORADOR", "outsider-1");

function setup() {
  const store = createEapInMemoryStore({
    users: [
      makeUser({ id: "pmo-1", role: "PMO", name: "PMO Um" }),
      makeUser({ id: "forn-1", role: "FORNECEDOR", name: "Fornecedor Um" }),
      makeUser({ id: "obs-1", role: "COLABORADOR" }),
      makeUser({ id: "outsider-1", role: "COLABORADOR" }),
    ],
    projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
    members: [
      makeMember({ id: "m-forn", projectId: "project-1", userId: "forn-1", role: "FORNECEDOR" }),
      makeMember({ id: "m-obs", projectId: "project-1", userId: "obs-1", role: "OBSERVADOR" }),
    ],
  });
  const repos = makeEapInMemoryRepos(store);
  const deps = { repos, runInTransaction: makeEapInMemoryTransactionRunner(repos, store) };
  return {
    store,
    createPhase: makeCreatePhaseUseCase(deps),
    createTask: makeCreateTaskUseCase(deps),
    updateProgress: makeUpdateTaskProgressUseCase(deps),
    cancelTask: makeCancelTaskUseCase(deps),
    register: makeRegisterImpedimentUseCase(deps),
    update: makeUpdateImpedimentUseCase(deps),
    resolve: makeResolveImpedimentUseCase(deps),
    list: makeListImpedimentsUseCase(deps),
    listAudit: makeListAuditUseCase(deps),
  };
}

async function taskInProgress(ctx: ReturnType<typeof setup>) {
  const phase = await ctx.createPhase(pmo, "project-1", { name: "Execução" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});
  const task = await ctx.createTask(pmo, "project-1", phase.id, {
    title: "Integração",
    assigneeId: "forn-1",
    plannedStartAt: "2026-10-01T15:00:00.000Z",
    plannedEndAt: "2026-10-30T15:00:00.000Z",
  });
  await ctx.updateProgress(supplier, "project-1", phase.id, task.id, { progressPercent: 40 });
  return { phase, task };
}

function rejectsWith(code: string) {
  return (error: unknown) => error instanceof HttpError && error.code === code;
}

describe("Impedimentos da tarefa", () => {
  it("registra com motivo, sem alterar percentual, situação, linha de base ou datas", async () => {
    const ctx = setup();
    const { phase, task } = await taskInProgress(ctx);
    const before = ctx.store.tasks.find((row) => row.id === task.id);
    assert.ok(before);
    const snapshot = { ...before };

    const result = await ctx.register(supplier, "project-1", phase.id, task.id, {
      description: "Ambiente de homologação indisponível.",
    });

    assert.equal(result.task.hasImpediment, true);
    assert.equal(result.task.status, "EM_ANDAMENTO");
    assert.equal(result.task.progressPercent, snapshot.progressPercent);
    assert.equal(result.task.baselineEndAt, snapshot.baselineEndAt?.toISOString() ?? null);
    assert.equal(result.task.plannedStartAt, snapshot.plannedStartAt?.toISOString() ?? null);
    assert.equal(result.task.plannedEndAt, snapshot.plannedEndAt?.toISOString() ?? null);
    assert.equal(result.task.actualStartAt, snapshot.actualStartAt?.toISOString() ?? null);
    assert.equal(result.impediment?.openedBy, "forn-1");
    assert.equal(result.impediment?.description, "Ambiente de homologação indisponível.");

    await assert.rejects(
      () => ctx.register(pmo, "project-1", phase.id, task.id, { description: "Outro motivo qualquer." }),
      rejectsWith("IMPEDIMENT_ALREADY_OPEN"),
    );
  });

  it("atualiza o motivo preservando o anterior na auditoria e resolve com nota e duração", async () => {
    const ctx = setup();
    const { phase, task } = await taskInProgress(ctx);
    const opened = await ctx.register(supplier, "project-1", phase.id, task.id, {
      description: "Ambiente de homologação indisponível.",
    });
    const impedimentId = opened.impediment?.id ?? "";

    await ctx.update(supplier, "project-1", phase.id, task.id, impedimentId, {
      description: "Ambiente indisponível até liberação da infraestrutura.",
    });
    const resolved = await ctx.resolve(pmo, "project-1", phase.id, task.id, {
      resolutionNote: "Infraestrutura liberou o ambiente.",
    });

    assert.equal(resolved.task.hasImpediment, false);
    assert.equal(resolved.task.progressPercent, 40);
    assert.equal(resolved.impediment?.resolvedBy, "pmo-1");
    assert.ok(resolved.impediment?.resolvedAt);
    assert.equal(resolved.impediment?.resolutionNote, "Infraestrutura liberou o ambiente.");

    await assert.rejects(
      () => ctx.update(supplier, "project-1", phase.id, task.id, impedimentId, { description: "Tentativa depois." }),
      rejectsWith("IMPEDIMENT_NOT_OPEN"),
    );
    await assert.rejects(
      () => ctx.resolve(pmo, "project-1", phase.id, task.id, { resolutionNote: "Nada para resolver." }),
      rejectsWith("IMPEDIMENT_NOT_OPEN"),
    );

    const history = await ctx.listAudit(observer, "project-1", { entityType: "TASK", entityId: task.id });
    const byKind = (kind: string) => history.data.find((row) => row.details.kind === kind);
    assert.equal(byKind("IMPEDIMENT_OPENED")?.details.reason, "Ambiente de homologação indisponível.");
    assert.equal(byKind("IMPEDIMENT_UPDATED")?.details.previousReason, "Ambiente de homologação indisponível.");
    assert.equal(byKind("IMPEDIMENT_UPDATED")?.details.reason, "Ambiente indisponível até liberação da infraestrutura.");
    assert.equal(byKind("IMPEDIMENT_RESOLVED")?.details.resolutionNote, "Infraestrutura liberou o ambiente.");
    assert.equal(byKind("IMPEDIMENT_RESOLVED")?.details.openMinutes, 0);
    assert.equal(byKind("IMPEDIMENT_RESOLVED")?.actorName, "PMO Um");

    const listed = await ctx.list(observer, "project-1", phase.id, task.id);
    assert.equal(listed.data.length, 1);
    assert.ok(listed.data[0].resolvedAt);
    assert.equal(listed.data[0].openedByName, "Fornecedor Um");
    assert.equal(listed.data[0].resolvedByName, "PMO Um");
  });

  it("resolve marcação antiga sem registro, sem inventar o motivo original", async () => {
    const ctx = setup();
    const { phase, task } = await taskInProgress(ctx);
    const row = ctx.store.tasks.find((item) => item.id === task.id);
    assert.ok(row);
    row.hasImpediment = true;

    const resolved = await ctx.resolve(pmo, "project-1", phase.id, task.id, {
      resolutionNote: "Impedimento antigo já superado.",
    });

    assert.equal(resolved.task.hasImpediment, false);
    assert.equal(resolved.impediment, null);
    assert.equal(ctx.store.impediments.length, 0);
    const audit = ctx.store.auditLogs.at(-1);
    assert.equal(audit?.action, "CLEAR_IMPEDIMENT");
    assert.equal((audit?.payload as Record<string, unknown>).description, null);
  });

  it("bloqueia tarefa cancelada ou concluída e quem não pode atualizar a execução", async () => {
    const ctx = setup();
    const { phase, task } = await taskInProgress(ctx);
    const reason = { description: "Ambiente de homologação indisponível." };

    await assert.rejects(() => ctx.register(observer, "project-1", phase.id, task.id, reason), rejectsWith("TASK_PROGRESS_FORBIDDEN"));
    await assert.rejects(() => ctx.register(outsider, "project-1", phase.id, task.id, reason), rejectsWith("PROJECT_FORBIDDEN"));
    await assert.rejects(() => ctx.list(outsider, "project-1", phase.id, task.id), rejectsWith("PROJECT_FORBIDDEN"));

    await ctx.cancelTask(pmo, "project-1", phase.id, task.id, { justification: "Escopo retirado pelo comitê." });
    await assert.rejects(() => ctx.register(pmo, "project-1", phase.id, task.id, reason), rejectsWith("IMPEDIMENT_TASK_CLOSED"));

    const other = await ctx.createTask(pmo, "project-1", phase.id, { title: "Concluída", assigneeId: "forn-1" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});
    await ctx.updateProgress(supplier, "project-1", phase.id, other.id, { progressPercent: 100 });
    await assert.rejects(() => ctx.register(pmo, "project-1", phase.id, other.id, reason), rejectsWith("IMPEDIMENT_TASK_CLOSED"));
    assert.equal(ctx.store.impediments.length, 0);
  });

  it("valida motivo, nota e o fim do impedimento pelo endpoint de andamento", () => {
    assert.equal(registerImpedimentBodySchema.safeParse({ description: "curto" }).success, false);
    assert.equal(resolveImpedimentBodySchema.safeParse({ resolutionNote: "curto" }).success, false);
    assert.equal(updateTaskProgressBodySchema.safeParse({ hasImpediment: true }).success, false);
  });
});

describe("Histórico: marcações antigas de impedimento", () => {
  function legacy(payload: Record<string, unknown>): EapAuditEntryRow {
    return {
      id: "log-1",
      projectId: "project-1",
      entityType: "TASK",
      entityId: "task-1",
      action: "UPDATE",
      summary: 'Progresso da tarefa "teste" atualizado.',
      payload,
      actorId: "pmo-1",
      actorName: "PMO Um",
      createdAt: new Date("2026-10-21T23:59:23Z"),
    };
  }

  it("reconhece a marcação e a retirada sem criar motivo", () => {
    const flagged = toEapAuditDetails(legacy({ kind: "PROGRESS", hasImpediment: true }));
    assert.equal(flagged.kind, "IMPEDIMENT_FLAGGED");
    assert.equal(flagged.reason, null);
    assert.equal(toEapAuditDetails(legacy({ kind: "PROGRESS", hasImpediment: false })).kind, "IMPEDIMENT_UNFLAGGED");
    assert.equal(toEapAuditDetails(legacy({ kind: "PROGRESS", progressPercent: 50 })).kind, "PROGRESS");
  });
});
