import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { updateTaskBodySchema } from "../schemas/eap-tasks.schema";
import {
  createEapInMemoryStore,
  makeEapInMemoryRepos,
  makeEapInMemoryTransactionRunner,
  makeMember,
  makeProject,
  makeUser,
} from "../test/in-memory";
import { makeCreateEvidenceUseCase } from "./create-evidence";
import { makeCreatePhaseUseCase } from "./create-phase";
import { makeCreateTaskUseCase } from "./create-task";
import { makeRegisterImpedimentUseCase } from "./register-impediment";
import { makeReorderTasksUseCase } from "./reorder-tasks";
import { makeUpdateTaskUseCase } from "./update-task";
import { makeUpdateTaskProgressUseCase } from "./update-task-progress";

function actor(role: AuthUser["role"], id = "actor-1"): AuthUser {
  return { id, name: "Actor", email: `${id}@igepps.test`, role };
}

describe("UpdateTask", () => {
  it("atualiza estrutura sem alterar baseline, prazos planejados ou fase", async () => {
    const store = createEapInMemoryStore({
      users: [makeUser({ id: "pmo-1", role: "PMO" })],
      projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
    });
    const repos = makeEapInMemoryRepos(store);
    const runner = makeEapInMemoryTransactionRunner(repos);
    const phase = await makeCreatePhaseUseCase({ repos, runInTransaction: runner })(
      actor("PMO", "pmo-1"),
      "project-1",
      { name: "Fase 1" },
    );
    const created = await makeCreateTaskUseCase({ repos, runInTransaction: runner })(
      actor("PMO", "pmo-1"),
      "project-1",
      phase.id,
      {
        title: "Tarefa 1",
        plannedStartAt: "2026-01-01T00:00:00.000Z",
        plannedEndAt: "2026-02-01T00:00:00.000Z",
      },
    );
    const updateTask = makeUpdateTaskUseCase({ repos, runInTransaction: runner });

    const updated = await updateTask(actor("PMO", "pmo-1"), "project-1", phase.id, created.id, {
      title: "Tarefa 1 revisada",
      weight: 3,
    });

    assert.equal(updated.title, "Tarefa 1 revisada");
    assert.equal(updated.weight, 3);
    assert.equal(updated.phaseId, created.phaseId);
    assert.equal(updated.plannedStartAt, created.plannedStartAt);
    assert.equal(updated.baselineStartAt, created.baselineStartAt);
    assert.equal(store.auditLogs.at(-1)?.action, "UPDATE");
    assert.equal((store.auditLogs.at(-1)?.payload as { kind?: string }).kind, "STRUCTURE");
  });

  it("impede FORNECEDOR de editar a estrutura e recusa tarefa de outra fase", async () => {
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
    const updateTask = makeUpdateTaskUseCase({ repos, runInTransaction: runner });
    const phaseA = await createPhase(actor("PMO", "pmo-1"), "project-1", { name: "Fase A" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});
    const phaseB = await createPhase(actor("PMO", "pmo-1"), "project-2", { name: "Fase B" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});
    const taskA = await createTask(actor("PMO", "pmo-1"), "project-1", phaseA.id, {
      title: "Tarefa A",
    
    plannedStartAt: "2026-06-01T15:00:00.000Z",
    plannedEndAt: "2026-06-30T15:00:00.000Z"});
    const taskB = await createTask(actor("PMO", "pmo-1"), "project-2", phaseB.id, {
      title: "Tarefa B",
    
    plannedStartAt: "2026-06-01T15:00:00.000Z",
    plannedEndAt: "2026-06-30T15:00:00.000Z"});

    await assert.rejects(
      () =>
        updateTask(actor("FORNECEDOR", "forn-1"), "project-1", phaseA.id, taskA.id, {
          title: "Alterada",
        }),
      (error: unknown) =>
        error instanceof HttpError && error.code === "TASK_STRUCTURE_FORBIDDEN",
    );
    await assert.rejects(
      () =>
        updateTask(actor("PMO", "pmo-1"), "project-1", phaseA.id, taskB.id, {
          title: "Tentativa",
        }),
      (error: unknown) => error instanceof HttpError && error.code === "TASK_NOT_FOUND",
    );
  });

  it("permite ao criador editar a própria tarefa sem editar a de outros nem reordenar", async () => {
    const store = createEapInMemoryStore({
      users: [
        makeUser({ id: "pmo-1", role: "PMO" }),
        makeUser({ id: "dev-1", role: "COLABORADOR" }),
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
    const createTask = makeCreateTaskUseCase({ repos, runInTransaction: runner });
    const updateTask = makeUpdateTaskUseCase({ repos, runInTransaction: runner });
    const updateProgress = makeUpdateTaskProgressUseCase({ repos, runInTransaction: runner });
    const reorderTasks = makeReorderTasksUseCase({ repos, runInTransaction: runner });
    const dev = actor("COLABORADOR", "dev-1");
    const own = await createTask(dev, "project-1", phase.id, {
      title: "Minha tarefa",
      plannedStartAt: "2026-01-01T00:00:00.000Z",
      plannedEndAt: "2026-02-01T00:00:00.000Z",
    });
    const others = await createTask(actor("PMO", "pmo-1"), "project-1", phase.id, {
      title: "Tarefa do PMO",
    
    plannedStartAt: "2026-06-01T15:00:00.000Z",
    plannedEndAt: "2026-06-30T15:00:00.000Z"});

    const updated = await updateTask(dev, "project-1", phase.id, own.id, { title: "Minha tarefa revisada" });
    assert.equal(updated.title, "Minha tarefa revisada");
    assert.equal(updated.baselineStartAt, own.baselineStartAt);
    const progressed = await updateProgress(dev, "project-1", phase.id, own.id, { progressPercent: 50 });
    assert.equal(progressed.progressPercent, 50);

    await assert.rejects(
      () => updateTask(dev, "project-1", phase.id, others.id, { title: "Alterada" }),
      (error: unknown) => error instanceof HttpError && error.code === "TASK_STRUCTURE_FORBIDDEN",
    );
    await assert.rejects(
      () => updateProgress(dev, "project-1", phase.id, others.id, { progressPercent: 10 }),
      (error: unknown) => error instanceof HttpError && error.code === "TASK_PROGRESS_FORBIDDEN",
    );
    await assert.rejects(
      () =>
        reorderTasks(dev, "project-1", phase.id, [
          { taskId: own.id, sortOrder: 1 },
          { taskId: others.id, sortOrder: 0 },
        ]),
      (error: unknown) => error instanceof HttpError && error.code === "TASK_STRUCTURE_FORBIDDEN",
    );
  });

  it("permite ao responsável atualizar andamento, impedimento e evidência sem editar a estrutura", async () => {
    const store = createEapInMemoryStore({
      users: [
        makeUser({ id: "pmo-1", role: "PMO" }),
        makeUser({ id: "obs-1", role: "GESTOR" }),
      ],
      projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
      members: [
        makeMember({
          id: "member-obs",
          projectId: "project-1",
          userId: "obs-1",
          role: "OBSERVADOR",
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
      { title: "Tarefa atribuída", assigneeId: "obs-1" },
    );
    const assignee = actor("GESTOR", "obs-1");

    const progressed = await makeUpdateTaskProgressUseCase({ repos, runInTransaction: runner })(
      assignee,
      "project-1",
      phase.id,
      task.id,
      { progressPercent: 40 },
    );
    assert.equal(progressed.progressPercent, 40);

    const impeded = await makeRegisterImpedimentUseCase({ repos, runInTransaction: runner })(
      assignee,
      "project-1",
      phase.id,
      task.id,
      { description: "Aguardando liberação de acesso." },
    );
    assert.equal(impeded.task.hasImpediment, true);

    const evidence = await makeCreateEvidenceUseCase({ repos, runInTransaction: runner })(
      assignee,
      "project-1",
      { taskId: task.id, title: "Relatório", url: "https://exemplo.com/relatorio" },
    );
    assert.equal(evidence.createdBy, "obs-1");

    await assert.rejects(
      () =>
        makeUpdateTaskUseCase({ repos, runInTransaction: runner })(
          assignee,
          "project-1",
          phase.id,
          task.id,
          { title: "Alterada" },
        ),
      (error: unknown) => error instanceof HttpError && error.code === "TASK_STRUCTURE_FORBIDDEN",
    );
  });

  it("rejeita no schema PATCH estrutural com baseline, planned_* ou phaseId", () => {
    const planned = updateTaskBodySchema.safeParse({
      plannedStartAt: "2026-01-01T00:00:00.000Z",
    });
    const baseline = updateTaskBodySchema.safeParse({
      baselineEndAt: "2026-03-01T00:00:00.000Z",
    });
    const phase = updateTaskBodySchema.safeParse({
      phaseId: "phase-2",
      title: "Nova fase",
    });

    assert.equal(planned.success, false);
    assert.equal(baseline.success, false);
    assert.equal(phase.success, false);
  });
});
