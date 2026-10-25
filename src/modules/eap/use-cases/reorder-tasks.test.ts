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
import { makeCreateTaskUseCase } from "./create-task";
import { makeReorderTasksUseCase } from "./reorder-tasks";

function actor(role: AuthUser["role"], id = "pmo-1"): AuthUser {
  return { id, name: "PMO", email: `${id}@igepps.test`, role };
}

describe("ReorderTasks", () => {
  it("reordena as tarefas da fase e registra auditoria", async () => {
    const store = createEapInMemoryStore({
      users: [makeUser({ id: "pmo-1", role: "PMO" })],
      projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
    });
    const repos = makeEapInMemoryRepos(store);
    const runner = makeEapInMemoryTransactionRunner(repos);
    const phase = await makeCreatePhaseUseCase({ repos, runInTransaction: runner })(
      actor("PMO"),
      "project-1",
      {
        name: "Fase",
        plannedStartAt: "2026-06-01T15:00:00.000Z",
        plannedEndAt: "2026-06-30T15:00:00.000Z",
      },
    );
    const createTask = makeCreateTaskUseCase({ repos, runInTransaction: runner });
    const reorder = makeReorderTasksUseCase({ repos, runInTransaction: runner });
    const first = await createTask(actor("PMO"), "project-1", phase.id, { title: "Tarefa A" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});
    const second = await createTask(actor("PMO"), "project-1", phase.id, { title: "Tarefa B" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});

    const result = await reorder(actor("PMO"), "project-1", phase.id, [
      { taskId: second.id, sortOrder: 0 },
      { taskId: first.id, sortOrder: 1 },
    ]);

    assert.deepEqual(
      result.data.map((task) => task.title),
      ["Tarefa B", "Tarefa A"],
    );
    assert.equal(
      store.auditLogs.some((log) => log.entityType === "TASK_ORDER" && log.action === "UPDATE"),
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
      {
        name: "Fase",
        plannedStartAt: "2026-06-01T15:00:00.000Z",
        plannedEndAt: "2026-06-30T15:00:00.000Z",
      },
    );
    const createTask = makeCreateTaskUseCase({ repos, runInTransaction: runner });
    const reorder = makeReorderTasksUseCase({ repos, runInTransaction: runner });
    const first = await createTask(actor("PMO"), "project-1", phase.id, { title: "Tarefa A" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});
    await createTask(actor("PMO"), "project-1", phase.id, { title: "Tarefa B" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});

    await assert.rejects(
      () => reorder(actor("PMO"), "project-1", phase.id, [{ taskId: first.id, sortOrder: 0 }]),
      (error: unknown) => error instanceof HttpError && error.code === "TASK_REORDER_INVALID",
    );
  });
});
