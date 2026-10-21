import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { updateTaskProgressBodySchema } from "../schemas/eap-tasks.schema";
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
import { makeUpdateTaskProgressUseCase } from "./update-task-progress";

function actor(role: AuthUser["role"], id = "actor-1"): AuthUser {
  return { id, name: "Actor", email: `${id}@igepps.test`, role };
}

describe("UpdateTaskProgress", () => {
  it("permite fornecedor responsável e bloqueia fornecedor não responsável", async () => {
    const store = createEapInMemoryStore({
      users: [
        makeUser({ id: "pmo-1", role: "PMO" }),
        makeUser({ id: "forn-1", role: "FORNECEDOR" }),
        makeUser({ id: "forn-2", role: "FORNECEDOR" }),
      ],
      projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
      members: [
        makeMember({
          id: "member-forn-1",
          projectId: "project-1",
          userId: "forn-1",
          role: "FORNECEDOR",
        }),
        makeMember({
          id: "member-forn-2",
          projectId: "project-1",
          userId: "forn-2",
          role: "FORNECEDOR",
        }),
      ],
    });
    const repos = makeEapInMemoryRepos(store);
    const runner = makeEapInMemoryTransactionRunner(repos);
    const phase = await makeCreatePhaseUseCase({ repos, runInTransaction: runner })(
      actor("PMO", "pmo-1"),
      "project-1",
      { name: "Fase 1" },
    );
    const task = await makeCreateTaskUseCase({ repos, runInTransaction: runner })(
      actor("PMO", "pmo-1"),
      "project-1",
      phase.id,
      { title: "Implementar API", assigneeId: "forn-1" },
    );
    const updateProgress = makeUpdateTaskProgressUseCase({
      repos,
      runInTransaction: runner,
    });

    const updated = await updateProgress(
      actor("FORNECEDOR", "forn-1"),
      "project-1",
      phase.id,
      task.id,
      { progressPercent: 40, status: "EM_ANDAMENTO" },
    );
    assert.equal(updated.progressPercent, 40);
    assert.equal(updated.status, "EM_ANDAMENTO");

    await assert.rejects(
      () =>
        updateProgress(actor("FORNECEDOR", "forn-2"), "project-1", phase.id, task.id, {
          progressPercent: 50,
        }),
      (error: unknown) =>
        error instanceof HttpError && error.code === "TASK_PROGRESS_FORBIDDEN",
    );
  });

  it("permite DESENVOLVEDOR responsável atualizar execução e registra auditoria", async () => {
    const store = createEapInMemoryStore({
      users: [
        makeUser({ id: "pmo-1", role: "PMO" }),
        makeUser({ id: "dev-1", role: "GESTOR" }),
      ],
      projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
      members: [
        makeMember({
          id: "member-dev",
          projectId: "project-1",
          userId: "dev-1",
          role: "DESENVOLVEDOR",
        }),
      ],
    });
    const repos = makeEapInMemoryRepos(store);
    const runner = makeEapInMemoryTransactionRunner(repos);
    const phase = await makeCreatePhaseUseCase({ repos, runInTransaction: runner })(
      actor("PMO", "pmo-1"),
      "project-1",
      { name: "Fase 1" },
    );
    const task = await makeCreateTaskUseCase({ repos, runInTransaction: runner })(
      actor("PMO", "pmo-1"),
      "project-1",
      phase.id,
      {
        title: "Codificar tela",
        assigneeId: "dev-1",
        plannedStartAt: "2026-01-01T00:00:00.000Z",
        plannedEndAt: "2026-02-01T00:00:00.000Z",
      },
    );
    const updateProgress = makeUpdateTaskProgressUseCase({
      repos,
      runInTransaction: runner,
    });

    const updated = await updateProgress(actor("GESTOR", "dev-1"), "project-1", phase.id, task.id, {
      progressPercent: 100,
      status: "CONCLUIDA",
      actualStartAt: "2026-01-02T00:00:00.000Z",
      actualEndAt: "2026-01-20T00:00:00.000Z",
      hasImpediment: false,
    });

    assert.equal(updated.status, "CONCLUIDA");
    assert.equal(updated.progressPercent, 100);
    assert.equal(updated.actualStartAt, "2026-01-02T00:00:00.000Z");
    assert.equal(updated.hasImpediment, false);
    assert.equal(updated.plannedStartAt, task.plannedStartAt);
    assert.equal(updated.baselineStartAt, task.baselineStartAt);
    assert.equal(store.projects[0].status, "NAO_INICIADO");
    assert.equal((store.auditLogs.at(-1)?.payload as { kind?: string }).kind, "PROGRESS");
  });

  it("rejeita CONCLUIDA sem percentual 100, datas reais inválidas e tarefa de outro projeto", async () => {
    const store = createEapInMemoryStore({
      users: [makeUser({ id: "pmo-1", role: "PMO" })],
      projects: [
        makeProject({ id: "project-1", ownerId: "owner-1" }),
        makeProject({ id: "project-2", ownerId: "owner-2" }),
      ],
    });
    const repos = makeEapInMemoryRepos(store);
    const runner = makeEapInMemoryTransactionRunner(repos);
    const createPhase = makeCreatePhaseUseCase({ repos, runInTransaction: runner });
    const createTask = makeCreateTaskUseCase({ repos, runInTransaction: runner });
    const updateProgress = makeUpdateTaskProgressUseCase({
      repos,
      runInTransaction: runner,
    });
    const phaseA = await createPhase(actor("PMO", "pmo-1"), "project-1", { name: "Fase A" });
    const phaseB = await createPhase(actor("PMO", "pmo-1"), "project-2", { name: "Fase B" });
    const taskA = await createTask(actor("PMO", "pmo-1"), "project-1", phaseA.id, {
      title: "Tarefa A",
    });
    const taskB = await createTask(actor("PMO", "pmo-1"), "project-2", phaseB.id, {
      title: "Tarefa B",
    });

    await assert.rejects(
      () =>
        updateProgress(actor("PMO", "pmo-1"), "project-1", phaseA.id, taskA.id, {
          status: "CONCLUIDA",
          progressPercent: 80,
        }),
      (error: unknown) =>
        error instanceof HttpError && error.code === "TASK_CONCLUDED_PROGRESS_INVALID",
    );
    await assert.rejects(
      () =>
        updateProgress(actor("PMO", "pmo-1"), "project-1", phaseA.id, taskA.id, {
          actualEndAt: "2026-02-01T00:00:00.000Z",
        }),
      (error: unknown) =>
        error instanceof HttpError && error.code === "TASK_ACTUAL_DATES_INVALID",
    );
    await assert.rejects(
      () =>
        updateProgress(actor("PMO", "pmo-1"), "project-1", phaseA.id, taskB.id, {
          progressPercent: 10,
        }),
      (error: unknown) => error instanceof HttpError && error.code === "TASK_NOT_FOUND",
    );
  });

  it("rejeita no schema PATCH de progresso com baseline ou planned_*", () => {
    const planned = updateTaskProgressBodySchema.safeParse({
      plannedStartAt: "2026-01-01T00:00:00.000Z",
      progressPercent: 10,
    });
    const baseline = updateTaskProgressBodySchema.safeParse({
      baselineStartAt: "2026-01-01T00:00:00.000Z",
    });
    const percent = updateTaskProgressBodySchema.safeParse({
      progressPercent: 120,
    });

    assert.equal(planned.success, false);
    assert.equal(baseline.success, false);
    assert.equal(percent.success, false);
  });
});
