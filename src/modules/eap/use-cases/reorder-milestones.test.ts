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
import { makeCreateMilestoneUseCase } from "./create-milestone";
import { makeCreatePhaseUseCase } from "./create-phase";
import { makeReorderMilestonesUseCase } from "./reorder-milestones";

function actor(role: AuthUser["role"], id = "pmo-1"): AuthUser {
  return { id, name: "PMO", email: `${id}@igepps.test`, role };
}

describe("ReorderMilestones", () => {
  it("reordena os marcos da fase e registra auditoria", async () => {
    const store = createEapInMemoryStore({
      users: [makeUser({ id: "pmo-1", role: "PMO" })],
      projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
    });
    const repos = makeEapInMemoryRepos(store);
    const runner = makeEapInMemoryTransactionRunner(repos);
    const phase = await makeCreatePhaseUseCase({ repos, runInTransaction: runner })(
      actor("PMO"),
      "project-1",
      { name: "Fase" },
    );
    const createMilestone = makeCreateMilestoneUseCase({ repos, runInTransaction: runner });
    const reorder = makeReorderMilestonesUseCase({ repos, runInTransaction: runner });
    const first = await createMilestone(actor("PMO"), "project-1", phase.id, {
      title: "Marco A",
      type: "ENTREGA",
    
    plannedAt: "2026-06-15T15:00:00.000Z"});
    const second = await createMilestone(actor("PMO"), "project-1", phase.id, {
      title: "Marco B",
      type: "APROVACAO",
    
    plannedAt: "2026-06-15T15:00:00.000Z"});

    const result = await reorder(actor("PMO"), "project-1", phase.id, [
      { milestoneId: second.id, sortOrder: 0 },
      { milestoneId: first.id, sortOrder: 1 },
    ]);

    assert.deepEqual(
      result.data.map((milestone) => milestone.title),
      ["Marco B", "Marco A"],
    );
    assert.equal(
      store.auditLogs.some((log) => log.entityType === "MILESTONE_ORDER" && log.action === "UPDATE"),
      true,
    );
  });

  it("rejeita uma lista incompleta", async () => {
    const store = createEapInMemoryStore({
      users: [makeUser({ id: "pmo-1", role: "PMO" })],
      projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
    });
    const repos = makeEapInMemoryRepos(store);
    const runner = makeEapInMemoryTransactionRunner(repos);
    const phase = await makeCreatePhaseUseCase({ repos, runInTransaction: runner })(
      actor("PMO"),
      "project-1",
      { name: "Fase" },
    );
    const createMilestone = makeCreateMilestoneUseCase({ repos, runInTransaction: runner });
    const reorder = makeReorderMilestonesUseCase({ repos, runInTransaction: runner });
    const first = await createMilestone(actor("PMO"), "project-1", phase.id, {
      title: "Marco A",
      type: "ENTREGA",
    
    plannedAt: "2026-06-15T15:00:00.000Z"});
    await createMilestone(actor("PMO"), "project-1", phase.id, {
      title: "Marco B",
      type: "ENTREGA",
    
    plannedAt: "2026-06-15T15:00:00.000Z"});

    await assert.rejects(
      () => reorder(actor("PMO"), "project-1", phase.id, [{ milestoneId: first.id, sortOrder: 0 }]),
      (error: unknown) => error instanceof HttpError && error.code === "MILESTONE_REORDER_INVALID",
    );
  });
});
