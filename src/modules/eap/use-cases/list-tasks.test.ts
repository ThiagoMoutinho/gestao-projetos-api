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
import { makeGetTaskUseCase } from "./get-task";
import { makeListTasksUseCase } from "./list-tasks";

function actor(role: AuthUser["role"], id = "actor-1"): AuthUser {
  return { id, name: "Actor", email: `${id}@igepps.test`, role };
}

describe("ListTasks e GetTask", () => {
  it("impede usuário sem vínculo de consultar tarefas restritas", async () => {
    const store = createEapInMemoryStore({
      users: [
        makeUser({ id: "pmo-1", role: "PMO" }),
        makeUser({ id: "forn-1", role: "FORNECEDOR" }),
      ],
      projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
    });
    const repos = makeEapInMemoryRepos(store);
    const runner = makeEapInMemoryTransactionRunner(repos);
    const phase = await makeCreatePhaseUseCase({ repos, runInTransaction: runner })(
      actor("PMO", "pmo-1"),
      "project-1",
      {
        name: "Fase 1",
        plannedStartAt: "2026-06-01T15:00:00.000Z",
        plannedEndAt: "2026-06-30T15:00:00.000Z",
      },
    );
    const listTasks = makeListTasksUseCase({ repos });

    await assert.rejects(
      () => listTasks(actor("FORNECEDOR", "forn-1"), "project-1", phase.id),
      (error: unknown) =>
        error instanceof HttpError && error.code === "PROJECT_FORBIDDEN",
    );
  });

  it("lista tarefas da fase autorizada e recusa fase de outro projeto", async () => {
    const store = createEapInMemoryStore({
      users: [
        makeUser({ id: "pmo-1", role: "PMO" }),
        makeUser({ id: "forn-1", role: "FORNECEDOR" }),
      ],
      projects: [
        makeProject({ id: "project-1", ownerId: "owner-1" }),
        makeProject({ id: "project-2", ownerId: "owner-2" }),
      ],
      members: [
        makeMember({
          id: "member-forn",
          projectId: "project-1",
          userId: "forn-1",
          role: "FORNECEDOR",
        }),
      ],
    });
    const repos = makeEapInMemoryRepos(store);
    const runner = makeEapInMemoryTransactionRunner(repos);
    const createPhase = makeCreatePhaseUseCase({ repos, runInTransaction: runner });
    const createTask = makeCreateTaskUseCase({ repos, runInTransaction: runner });
    const listTasks = makeListTasksUseCase({ repos });
    const getTask = makeGetTaskUseCase({ repos });

    const phaseA = await createPhase(actor("PMO", "pmo-1"), "project-1", { name: "Fase A" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});
    const phaseB = await createPhase(actor("PMO", "pmo-1"), "project-2", { name: "Fase B" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});
    await createTask(actor("PMO", "pmo-1"), "project-1", phaseA.id, { title: "Tarefa 1" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});
    const otherTask = await createTask(actor("PMO", "pmo-1"), "project-2", phaseB.id, {
      title: "Tarefa outra",
    
    plannedStartAt: "2026-06-01T15:00:00.000Z",
    plannedEndAt: "2026-06-30T15:00:00.000Z"});

    const listed = await listTasks(actor("FORNECEDOR", "forn-1"), "project-1", phaseA.id);
    assert.deepEqual(
      listed.data.map((task) => task.title),
      ["Tarefa 1"],
    );

    await assert.rejects(
      () => getTask(actor("PMO", "pmo-1"), "project-1", phaseA.id, otherTask.id),
      (error: unknown) => error instanceof HttpError && error.code === "TASK_NOT_FOUND",
    );
    await assert.rejects(
      () => listTasks(actor("PMO", "pmo-1"), "project-1", phaseB.id),
      (error: unknown) => error instanceof HttpError && error.code === "PHASE_NOT_FOUND",
    );
  });
});
