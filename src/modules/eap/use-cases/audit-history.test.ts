import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthUser } from "../../../lib/session";
import { toEapAuditDetails } from "../dtos/eap-audit.dto";
import type { EapAuditEntryRow } from "../repositories/contracts";
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
import { makeReactivateTaskUseCase } from "./reactivate-task";
import { makeUpdateTaskProgressUseCase } from "./update-task-progress";

function actor(role: AuthUser["role"], id: string): AuthUser {
  return { id, name: id, email: `${id}@igepps.test`, role };
}

const pmo = actor("PMO", "pmo-1");
const dev = actor("COLABORADOR", "dev-1");

function setup() {
  const store = createEapInMemoryStore({
    users: [
      makeUser({ id: "pmo-1", role: "PMO", name: "PMO Um" }),
      makeUser({ id: "dev-1", role: "COLABORADOR" }),
      makeUser({ id: "outsider-1", role: "COLABORADOR" }),
    ],
    projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
    members: [
      makeMember({ id: "m-dev", projectId: "project-1", userId: "dev-1", role: "DESENVOLVEDOR" }),
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
    reactivateTask: makeReactivateTaskUseCase(deps),
    listAudit: makeListAuditUseCase(deps),
  };
}

function legacyRow(overrides: Partial<EapAuditEntryRow>): EapAuditEntryRow {
  return {
    id: "log-1",
    projectId: "project-1",
    entityType: "TASK",
    entityId: "task-1",
    action: "UPDATE",
    summary: "Evento antigo.",
    payload: null,
    actorId: "pmo-1",
    actorName: "PMO Um",
    createdAt: new Date("2026-10-01T12:00:00Z"),
    ...overrides,
  };
}

describe("Histórico: justificativas de cancelamento e reativação", () => {
  it("retorna cada justificativa vinculada ao próprio evento e preserva ambos", async () => {
    const ctx = setup();
    const phase = await ctx.createPhase(pmo, "project-1", { name: "Execução" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});
    const task = await ctx.createTask(pmo, "project-1", phase.id, {
      title: "teste",
      assigneeId: "dev-1",
    
    plannedStartAt: "2026-06-01T15:00:00.000Z",
    plannedEndAt: "2026-06-30T15:00:00.000Z"});
    await ctx.updateProgress(dev, "project-1", phase.id, task.id, { progressPercent: 25 });
    await ctx.cancelTask(pmo, "project-1", phase.id, task.id, {
      justification: "Escopo retirado pelo comitê.",
    });
    await ctx.reactivateTask(pmo, "project-1", phase.id, task.id, {
      justification: "Escopo devolvido ao projeto.",
    });

    const history = await ctx.listAudit(dev, "project-1", {
      entityType: "TASK",
      entityId: task.id,
    });
    const cancellation = history.data.find((row) => row.details.kind === "CANCELLATION");
    const reactivation = history.data.find((row) => row.details.kind === "REACTIVATION");

    assert.ok(cancellation);
    assert.equal(cancellation.actorName, "PMO Um");
    assert.equal(cancellation.details.fromStatus, "EM_ANDAMENTO");
    assert.equal(cancellation.details.toStatus, "CANCELADA");
    assert.equal(cancellation.details.justification, "Escopo retirado pelo comitê.");

    assert.ok(reactivation);
    assert.equal(reactivation.details.fromStatus, "CANCELADA");
    assert.equal(reactivation.details.toStatus, "EM_ANDAMENTO");
    assert.equal(reactivation.details.justification, "Escopo devolvido ao projeto.");
    assert.equal("payload" in reactivation, false);
  });

  it("registra o percentual anterior nos novos eventos de andamento", async () => {
    const ctx = setup();
    const phase = await ctx.createPhase(pmo, "project-1", { name: "Execução" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});
    const task = await ctx.createTask(pmo, "project-1", phase.id, {
      title: "Tarefa",
      assigneeId: "dev-1",
    
    plannedStartAt: "2026-06-01T15:00:00.000Z",
    plannedEndAt: "2026-06-30T15:00:00.000Z"});
    await ctx.updateProgress(dev, "project-1", phase.id, task.id, { progressPercent: 25 });
    await ctx.updateProgress(dev, "project-1", phase.id, task.id, { progressPercent: 50 });

    const history = await ctx.listAudit(pmo, "project-1", {
      entityType: "TASK",
      entityId: task.id,
    });
    const progress = history.data.filter((row) => row.details.kind === "PROGRESS");
    assert.deepEqual(
      progress.map((row) => [row.details.fromPercent, row.details.toPercent]),
      [
        [25, 50],
        [0, 25],
      ],
    );
    const automatic = history.data.find((row) => row.details.kind === "AUTOMATIC_STATUS");
    assert.equal(automatic?.details.cause, "Andamento passou de 0% para 25%.");
  });
});

describe("Histórico: eventos antigos", () => {
  it("não inventa dados ausentes e ignora campos não reconhecidos", () => {
    const progress = toEapAuditDetails(
      legacyRow({ payload: { kind: "PROGRESS", progressPercent: 40, assigneeId: "dev-1" } }),
    );
    assert.equal(progress.kind, "PROGRESS");
    assert.equal(progress.fromPercent, null);
    assert.equal(progress.toPercent, 40);
    assert.equal(progress.justification, null);
    assert.equal("assigneeId" in progress, false);

    const empty = toEapAuditDetails(legacyRow({ action: "STATUS_CHANGE", payload: null }));
    assert.equal(empty.kind, "STATUS");
    assert.equal(empty.fromStatus, null);
    assert.equal(empty.justification, null);
  });

  it("classifica entrega, aceite, rejeição e evidência", () => {
    assert.equal(
      toEapAuditDetails(
        legacyRow({ action: "STATUS_CHANGE", payload: { kind: "DELIVER", to: "ENTREGUE" } }),
      ).kind,
      "DELIVERY",
    );
    const accepted = toEapAuditDetails(
      legacyRow({
        entityType: "MILESTONE",
        action: "VALIDATE",
        payload: { kind: "REVIEW", from: "ENTREGUE", to: "APROVADO", note: "Conforme." },
      }),
    );
    assert.equal(accepted.kind, "ACCEPTANCE");
    assert.equal(accepted.note, "Conforme.");
    assert.equal(
      toEapAuditDetails(
        legacyRow({ entityType: "MILESTONE", action: "VALIDATE", payload: { to: "REJEITADO" } }),
      ).kind,
      "REJECTION",
    );
    assert.equal(
      toEapAuditDetails(legacyRow({ entityType: "EVIDENCE", action: "CREATE" })).kind,
      "EVIDENCE",
    );
  });

  it("classifica ajustes solicitados e autorização de nova submissão com a rodada", () => {
    const adjustments = toEapAuditDetails(
      legacyRow({
        entityType: "MILESTONE",
        action: "VALIDATE",
        payload: {
          kind: "REVIEW",
          to: "AJUSTES_SOLICITADOS",
          note: "Faltam os testes de carga.",
          adjustments: "Incluir testes de carga.",
          round: 2,
        },
      }),
    );
    assert.equal(adjustments.kind, "ADJUSTMENTS_REQUESTED");
    assert.equal(adjustments.adjustments, "Incluir testes de carga.");
    assert.equal(adjustments.round, 2);

    const authorized = toEapAuditDetails(
      legacyRow({
        entityType: "MILESTONE",
        action: "UPDATE",
        payload: { kind: "AUTHORIZE_RESUBMISSION", justification: "Comitê aprovou o reenvio.", round: 1 },
      }),
    );
    assert.equal(authorized.kind, "RESUBMISSION_AUTHORIZED");
    assert.equal(authorized.justification, "Comitê aprovou o reenvio.");
    assert.equal(authorized.round, 1);
  });
});
