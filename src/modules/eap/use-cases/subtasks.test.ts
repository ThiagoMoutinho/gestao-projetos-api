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
import { makeDeleteTaskUseCase } from "./delete-task";
import { derivePhaseStatus, parentTaskProgress, phaseProgress } from "./eap-status";
import { makeUpdateTaskProgressUseCase } from "./update-task-progress";

const pmo: AuthUser = { id: "pmo-1", name: "PMO", email: "pmo@igepps.test", role: "PMO" };

async function setup() {
  const store = createEapInMemoryStore({
    users: [makeUser({ id: "pmo-1", role: "PMO", name: "PMO" })],
    projects: [makeProject({ id: "project-1", ownerId: "owner-1", name: "Projeto Alfa" })],
    members: [],
  });
  const repos = makeEapInMemoryRepos(store);
  const runInTransaction = makeEapInMemoryTransactionRunner(repos);
  const createPhase = makeCreatePhaseUseCase({ repos, runInTransaction });
  const createTask = makeCreateTaskUseCase({ repos, runInTransaction });
  const updateProgress = makeUpdateTaskProgressUseCase({ repos, runInTransaction });
  const deleteTask = makeDeleteTaskUseCase({ repos, runInTransaction });
  const phase = await createPhase(pmo, "project-1", { name: "Diagnóstico" });
  const other = await createPhase(pmo, "project-1", { name: "Execução" });
  const range = { plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z" };
  return { store, createTask, updateProgress, deleteTask, phase, other, range };
}

async function expectHttp(promise: Promise<unknown>, status: number, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, status);
    assert.equal(error.code, code);
    return true;
  });
}

const done = {
  progressPercent: 100,
  actualStartAt: "2026-06-02T15:00:00.000Z",
  actualEndAt: "2026-06-03T15:00:00.000Z",
};

describe("subtarefas", () => {
  it("cria a subtarefa ligada à tarefa superior, na mesma fase", async () => {
    const { createTask, phase, range } = await setup();
    const parent = await createTask(pmo, "project-1", phase.id, { title: "Superior", ...range });
    const child = await createTask(pmo, "project-1", phase.id, { title: "Filha", parentTaskId: parent.id, ...range });
    assert.equal(parent.parentTaskId, null);
    assert.equal(child.parentTaskId, parent.id);
    assert.equal(child.phaseId, phase.id);
    assert.notEqual(child.sortOrder, parent.sortOrder);
  });

  it("recusa subtarefa de subtarefa (só 1 nível)", async () => {
    const { createTask, phase, range } = await setup();
    const parent = await createTask(pmo, "project-1", phase.id, { title: "Superior", ...range });
    const child = await createTask(pmo, "project-1", phase.id, { title: "Filha", parentTaskId: parent.id, ...range });
    await expectHttp(
      createTask(pmo, "project-1", phase.id, { title: "Neta", parentTaskId: child.id, ...range }),
      409,
      "TASK_PARENT_IS_SUBTASK",
    );
  });

  it("recusa tarefa superior de outra fase", async () => {
    const { createTask, phase, other, range } = await setup();
    const parent = await createTask(pmo, "project-1", other.id, { title: "Em outra fase", ...range });
    await expectHttp(
      createTask(pmo, "project-1", phase.id, { title: "Filha", parentTaskId: parent.id, ...range }),
      404,
      "TASK_PARENT_NOT_FOUND",
    );
  });

  it("calcula o andamento e a situação da superior pelas subtarefas, ponderando pelo peso", async () => {
    const { store, createTask, updateProgress, phase, range } = await setup();
    const parent = await createTask(pmo, "project-1", phase.id, { title: "Superior", ...range });
    const light = await createTask(pmo, "project-1", phase.id, { title: "Leve", parentTaskId: parent.id, weight: 1, ...range });
    await createTask(pmo, "project-1", phase.id, { title: "Pesada", parentTaskId: parent.id, weight: 3, ...range });

    await updateProgress(pmo, "project-1", phase.id, light.id, done);
    const afterOne = store.tasks.find((task) => task.id === parent.id);
    assert.equal(afterOne?.progressPercent, 25); // (100*1 + 0*3) / 4
    assert.equal(afterOne?.status, "EM_ANDAMENTO");
  });

  it("conclui a superior quando todas as subtarefas concluem e reabre ao criar uma nova", async () => {
    const { store, createTask, updateProgress, phase, range } = await setup();
    const parent = await createTask(pmo, "project-1", phase.id, { title: "Superior", ...range });
    const child = await createTask(pmo, "project-1", phase.id, { title: "Única", parentTaskId: parent.id, ...range });
    await updateProgress(pmo, "project-1", phase.id, child.id, done);
    assert.equal(store.tasks.find((task) => task.id === parent.id)?.status, "CONCLUIDA");

    await createTask(pmo, "project-1", phase.id, { title: "Nova", parentTaskId: parent.id, ...range });
    const reopened = store.tasks.find((task) => task.id === parent.id);
    assert.equal(reopened?.progressPercent, 50);
    assert.equal(reopened?.status, "EM_ANDAMENTO");
    assert.equal(reopened?.actualEndAt, null);
  });

  it("não deixa informar o andamento da superior diretamente", async () => {
    const { createTask, updateProgress, phase, range } = await setup();
    const parent = await createTask(pmo, "project-1", phase.id, { title: "Superior", ...range });
    await createTask(pmo, "project-1", phase.id, { title: "Filha", parentTaskId: parent.id, ...range });
    await expectHttp(
      updateProgress(pmo, "project-1", phase.id, parent.id, { progressPercent: 50 }),
      409,
      "TASK_PROGRESS_FROM_SUBTASKS",
    );
  });

  it("não deixa excluir a superior enquanto houver subtarefas", async () => {
    const { createTask, deleteTask, phase, range } = await setup();
    const parent = await createTask(pmo, "project-1", phase.id, { title: "Superior", ...range });
    await createTask(pmo, "project-1", phase.id, { title: "Filha", parentTaskId: parent.id, ...range });
    await expectHttp(deleteTask(pmo, "project-1", phase.id, parent.id), 409, "TASK_DELETE_HAS_SUBTASKS");
  });
});

describe("fase e subtarefas", () => {
  it("o andamento e a situação da fase contam só as tarefas de nível principal", () => {
    const parent = { status: "EM_ANDAMENTO" as const, progressPercent: 50, weight: 1, parentTaskId: null };
    const child = { status: "CONCLUIDA" as const, progressPercent: 100, weight: 1, parentTaskId: "p" };
    assert.deepEqual(phaseProgress([parent, child], []), { state: "VALUE", basisPoints: 5000 });
    assert.equal(derivePhaseStatus([parent, child], []), "EM_ANDAMENTO");
  });

  it("parentTaskProgress ignora subtarefas canceladas e arredonda", () => {
    assert.equal(parentTaskProgress([]), null);
    assert.equal(parentTaskProgress([{ status: "CANCELADA", progressPercent: 0, weight: 1 }]), null);
    assert.equal(
      parentTaskProgress([
        { status: "EM_ANDAMENTO", progressPercent: 10, weight: 1 },
        { status: "EM_ANDAMENTO", progressPercent: 11, weight: 1 },
        { status: "CANCELADA", progressPercent: 0, weight: 5 },
      ]),
      11, // (10 + 11) / 2 = 10,5, arredonda para 11
    );
  });
});
