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
import { makeCreateTaskUseCase } from "./create-task";
import { copyTitle, makeDuplicateMilestoneUseCase, makeDuplicatePhaseUseCase, makeDuplicateTaskUseCase } from "./duplicate-items";
import { makeUpdateTaskProgressUseCase } from "./update-task-progress";

const pmo: AuthUser = { id: "pmo-1", name: "PMO", email: "pmo@igepps.test", role: "PMO" };
const outsider: AuthUser = { id: "out-1", name: "Fora", email: "out@igepps.test", role: "GESTOR" };

const range = { plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z" };

async function setup() {
  const store = createEapInMemoryStore({
    users: [makeUser({ id: "pmo-1", role: "PMO", name: "PMO" }), makeUser({ id: "out-1", role: "GESTOR" })],
    projects: [makeProject({ id: "project-1", ownerId: "owner-1", name: "Projeto Alfa" })],
    members: [],
  });
  const repos = makeEapInMemoryRepos(store);
  const runInTransaction = makeEapInMemoryTransactionRunner(repos);
  const deps = { repos, runInTransaction };
  const createPhase = makeCreatePhaseUseCase(deps);
  const createTask = makeCreateTaskUseCase(deps);
  const createMilestone = makeCreateMilestoneUseCase(deps);
  const updateProgress = makeUpdateTaskProgressUseCase(deps);
  const phase = await createPhase(pmo, "project-1", { name: "Diagnóstico", description: "Levantamento inicial" });
  return {
    store,
    phase,
    createTask,
    createMilestone,
    updateProgress,
    duplicateTask: makeDuplicateTaskUseCase(deps),
    duplicateMilestone: makeDuplicateMilestoneUseCase(deps),
    duplicatePhase: makeDuplicatePhaseUseCase(deps),
  };
}

describe("duplicar tarefa", () => {
  it("faz uma cópia limpa, sem andamento nem datas reais, e leva as subtarefas", async () => {
    const { store, phase, createTask, updateProgress, duplicateTask } = await setup();
    const parent = await createTask(pmo, "project-1", phase.id, { title: "Mapear sistemas", priority: "ALTA", weight: 2, ...range });
    const child = await createTask(pmo, "project-1", phase.id, { title: "Listar bases", parentTaskId: parent.id, ...range });
    await updateProgress(pmo, "project-1", phase.id, child.id, {
      progressPercent: 100,
      actualStartAt: "2026-06-02T15:00:00.000Z",
      actualEndAt: "2026-06-03T15:00:00.000Z",
    });

    const copy = await duplicateTask(pmo, "project-1", phase.id, parent.id);
    assert.equal(copy.title, "Mapear sistemas (cópia)");
    assert.equal(copy.parentTaskId, null);
    assert.equal(copy.status, "NAO_INICIADA");
    assert.equal(copy.progressPercent, 0);
    assert.equal(copy.actualStartAt, null);
    assert.equal(copy.priority, "ALTA");
    assert.equal(copy.weight, 2);
    assert.equal(copy.plannedEndAt, parent.plannedEndAt);
    assert.equal(copy.baselineEndAt, parent.plannedEndAt);

    const copiedChildren = store.tasks.filter((task) => task.parentTaskId === copy.id);
    assert.equal(copiedChildren.length, 1);
    assert.equal(copiedChildren[0].title, "Listar bases");
    assert.equal(copiedChildren[0].progressPercent, 0);
    assert.equal(copiedChildren[0].actualEndAt, null);
    // O original não muda.
    assert.equal(store.tasks.find((task) => task.id === child.id)?.progressPercent, 100);
    // A ordem de cada tarefa continua única na fase.
    const orders = store.tasks.filter((task) => task.phaseId === phase.id).map((task) => task.sortOrder);
    assert.equal(new Set(orders).size, orders.length);
  });

  it("duplicar uma subtarefa gera outra subtarefa da mesma tarefa superior", async () => {
    const { phase, createTask, duplicateTask } = await setup();
    const parent = await createTask(pmo, "project-1", phase.id, { title: "Superior", ...range });
    const child = await createTask(pmo, "project-1", phase.id, { title: "Filha", parentTaskId: parent.id, ...range });
    const copy = await duplicateTask(pmo, "project-1", phase.id, child.id);
    assert.equal(copy.parentTaskId, parent.id);
    assert.equal(copy.title, "Filha (cópia)");
  });

  it("exige permissão para criar itens", async () => {
    const { phase, createTask, duplicateTask } = await setup();
    const task = await createTask(pmo, "project-1", phase.id, { title: "Tarefa", ...range });
    await assert.rejects(duplicateTask(outsider, "project-1", phase.id, task.id), (error: unknown) => error instanceof HttpError);
  });
});

describe("duplicar marco", () => {
  it("copia o marco como pendente", async () => {
    const { phase, createMilestone, duplicateMilestone } = await setup();
    const milestone = await createMilestone(pmo, "project-1", phase.id, {
      title: "Entrega do diagnóstico",
      type: "ENTREGA",
      plannedAt: "2026-07-01T15:00:00.000Z",
    });
    const copy = await duplicateMilestone(pmo, "project-1", phase.id, milestone.id);
    assert.equal(copy.title, "Entrega do diagnóstico (cópia)");
    assert.equal(copy.status, "PENDENTE");
    assert.equal(copy.type, "ENTREGA");
    assert.equal(copy.plannedAt, milestone.plannedAt);
    assert.equal(copy.baselineAt, milestone.plannedAt);
    assert.equal(copy.actualAt, null);
  });
});

describe("duplicar fase", () => {
  it("copia a fase com tarefas, subtarefas e marcos, ao final, tudo não iniciado", async () => {
    const { store, phase, createTask, createMilestone, updateProgress, duplicatePhase } = await setup();
    const parent = await createTask(pmo, "project-1", phase.id, { title: "Superior", ...range });
    const child = await createTask(pmo, "project-1", phase.id, { title: "Filha", parentTaskId: parent.id, ...range });
    await createTask(pmo, "project-1", phase.id, { title: "Solta", ...range });
    await createMilestone(pmo, "project-1", phase.id, { title: "Marco", type: "ENTREGA", plannedAt: "2026-07-01T15:00:00.000Z" });
    await updateProgress(pmo, "project-1", phase.id, child.id, {
      progressPercent: 100,
      actualStartAt: "2026-06-02T15:00:00.000Z",
      actualEndAt: "2026-06-03T15:00:00.000Z",
    });

    const copy = await duplicatePhase(pmo, "project-1", phase.id);
    assert.equal(copy.name, "Diagnóstico (cópia)");
    assert.equal(copy.description, "Levantamento inicial");
    assert.equal(copy.status, "NAO_INICIADA");
    assert.ok(copy.sortOrder > phase.sortOrder);

    const tasks = store.tasks.filter((task) => task.phaseId === copy.id);
    assert.equal(tasks.length, 3);
    assert.ok(tasks.every((task) => task.progressPercent === 0 && task.status === "NAO_INICIADA" && task.actualStartAt === null));
    const copiedParent = tasks.find((task) => task.title === "Superior");
    const copiedChild = tasks.find((task) => task.title === "Filha");
    assert.equal(copiedChild?.parentTaskId, copiedParent?.id);
    assert.equal(store.milestones.filter((milestone) => milestone.phaseId === copy.id).length, 1);
    // A fase original e os itens dela continuam como estavam.
    assert.equal(store.tasks.filter((task) => task.phaseId === phase.id).length, 3);
    assert.equal(store.tasks.find((task) => task.id === child.id)?.progressPercent, 100);
  });
});

describe("copyTitle", () => {
  it("acrescenta (cópia) sem passar do limite do nome", () => {
    assert.equal(copyTitle("A"), "A (cópia)");
    assert.equal(copyTitle("x".repeat(255)).length, 255);
    assert.ok(copyTitle("x".repeat(255)).endsWith(" (cópia)"));
  });
});
