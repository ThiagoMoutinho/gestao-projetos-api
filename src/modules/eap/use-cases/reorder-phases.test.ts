import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import {
  createEapInMemoryStore,
  makeEapInMemoryRepos,
  makeEapInMemoryTransactionRunner,
  makeProject,
  makeUser,
} from "../test/in-memory";
import { makeCreatePhaseUseCase } from "./create-phase";
import { makeReorderPhasesUseCase } from "./reorder-phases";

function actor(role: AuthUser["role"], id = "pmo-1"): AuthUser {
  return { id, name: "PMO", email: `${id}@igepps.test`, role };
}

describe("ReorderPhases", () => {
  it("reordena de forma consistente sem duplicar sort_order e registra auditoria", async () => {
    const store = createEapInMemoryStore({
      users: [makeUser({ id: "pmo-1", role: "PMO" })],
      projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
    });
    const repos = makeEapInMemoryRepos(store);
    const runner = makeEapInMemoryTransactionRunner(repos);
    const createPhase = makeCreatePhaseUseCase({ repos, runInTransaction: runner });
    const reorderPhases = makeReorderPhasesUseCase({ repos, runInTransaction: runner });

    const first = await createPhase(actor("PMO"), "project-1", { name: "Fase A" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});
    const second = await createPhase(actor("PMO"), "project-1", { name: "Fase B" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});
    const third = await createPhase(actor("PMO"), "project-1", { name: "Fase C" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});

    const result = await reorderPhases(actor("PMO"), "project-1", [
      { phaseId: third.id, sortOrder: 0 },
      { phaseId: first.id, sortOrder: 1 },
      { phaseId: second.id, sortOrder: 2 },
    ]);

    assert.deepEqual(
      result.data.map((phase) => [phase.name, phase.sortOrder]),
      [
        ["Fase C", 0],
        ["Fase A", 1],
        ["Fase B", 2],
      ],
    );

    const sortOrders = result.data.map((phase) => phase.sortOrder);
    assert.equal(new Set(sortOrders).size, sortOrders.length);
    assert.equal(
      store.auditLogs.some(
        (log) => log.entityType === "PHASE_ORDER" && log.action === "UPDATE",
      ),
      true,
    );
  });

  it("rejeita reordenação incompleta ou com ordem duplicada", async () => {
    const store = createEapInMemoryStore({
      users: [makeUser({ id: "pmo-1", role: "PMO" })],
      projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
    });
    const repos = makeEapInMemoryRepos(store);
    const runner = makeEapInMemoryTransactionRunner(repos);
    const createPhase = makeCreatePhaseUseCase({ repos, runInTransaction: runner });
    const reorderPhases = makeReorderPhasesUseCase({ repos, runInTransaction: runner });
    const first = await createPhase(actor("PMO"), "project-1", { name: "Fase A" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});
    const second = await createPhase(actor("PMO"), "project-1", { name: "Fase B" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});

    await assert.rejects(
      () => reorderPhases(actor("PMO"), "project-1", [{ phaseId: first.id, sortOrder: 0 }]),
      (error: unknown) =>
        error instanceof HttpError && error.code === "PHASE_REORDER_INVALID",
    );
    await assert.rejects(
      () =>
        reorderPhases(actor("PMO"), "project-1", [
          { phaseId: first.id, sortOrder: 0 },
          { phaseId: second.id, sortOrder: 0 },
        ]),
      (error: unknown) =>
        error instanceof HttpError && error.code === "PHASE_REORDER_INVALID",
    );
  });
});
