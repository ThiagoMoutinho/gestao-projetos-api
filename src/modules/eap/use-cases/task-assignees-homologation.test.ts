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
import { makeUpdateTaskProgressUseCase } from "./update-task-progress";
import { makeUpdateTaskUseCase } from "./update-task";

const pmo: AuthUser = { id: "pmo-1", name: "PMO", email: "pmo@igepps.test", role: "PMO" };
const asUser = (id: string): AuthUser => ({ id, name: id, email: `${id}@igepps.test`, role: "FORNECEDOR" });
const range = { plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z" };

async function setup() {
  const store = createEapInMemoryStore({
    users: [
      makeUser({ id: "pmo-1", role: "PMO", name: "PMO" }),
      makeUser({ id: "ana", role: "FORNECEDOR", name: "Ana" }),
      makeUser({ id: "bia", role: "FORNECEDOR", name: "Bia" }),
      makeUser({ id: "cris", role: "FORNECEDOR", name: "Cris" }),
      makeUser({ id: "saiu", role: "FORNECEDOR", name: "Saiu do projeto" }),
    ],
    projects: [makeProject({ id: "project-1", ownerId: "owner-1", name: "Projeto Alfa" })],
    members: [
      makeMember({ id: "m-ana", projectId: "project-1", userId: "ana", role: "DESENVOLVEDOR" }),
      makeMember({ id: "m-bia", projectId: "project-1", userId: "bia", role: "DESENVOLVEDOR" }),
      makeMember({ id: "m-cris", projectId: "project-1", userId: "cris", role: "DESENVOLVEDOR" }),
    ],
  });
  const repos = makeEapInMemoryRepos(store);
  const deps = { repos, runInTransaction: makeEapInMemoryTransactionRunner(repos) };
  const phase = await makeCreatePhaseUseCase(deps)(pmo, "project-1", { name: "Diagnóstico" });
  return {
    store,
    phase,
    createTask: makeCreateTaskUseCase(deps),
    updateTask: makeUpdateTaskUseCase(deps),
    updateProgress: makeUpdateTaskProgressUseCase(deps),
  };
}

async function expectHttp(promise: Promise<unknown>, status: number, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, status);
    assert.equal(error.code, code);
    return true;
  });
}

describe("responsáveis: zero, um e dois", () => {
  it("a API segue aceitando tarefa sem responsável (registros antigos e importação)", async () => {
    const { createTask, phase } = await setup();
    const task = await createTask(pmo, "project-1", phase.id, { title: "Sem responsável", ...range });
    assert.equal(task.assigneeId, null);
    assert.equal(task.secondaryAssigneeId, null);
  });

  it("grava um e dois responsáveis na ordem informada", async () => {
    const { createTask, phase } = await setup();
    const one = await createTask(pmo, "project-1", phase.id, { title: "Um", assigneeId: "ana", ...range });
    assert.deepEqual([one.assigneeId, one.secondaryAssigneeId], ["ana", null]);
    const two = await createTask(pmo, "project-1", phase.id, { title: "Dois", assigneeId: "bia", secondaryAssigneeId: "ana", ...range });
    assert.deepEqual([two.assigneeId, two.secondaryAssigneeId], ["bia", "ana"]);
  });
});

describe("troca e remoção do responsável principal", () => {
  it("trocar a ordem (o segundo vira principal) em uma só requisição", async () => {
    const { createTask, updateTask, phase } = await setup();
    const task = await createTask(pmo, "project-1", phase.id, { title: "T", assigneeId: "ana", secondaryAssigneeId: "bia", ...range });
    const swapped = await updateTask(pmo, "project-1", phase.id, task.id, { assigneeId: "bia", secondaryAssigneeId: "ana" });
    assert.deepEqual([swapped.assigneeId, swapped.secondaryAssigneeId], ["bia", "ana"]);
  });

  it("promover o segundo e liberar o apoio (o que o painel envia ao desmarcar o primeiro)", async () => {
    const { createTask, updateTask, phase } = await setup();
    const task = await createTask(pmo, "project-1", phase.id, { title: "T", assigneeId: "ana", secondaryAssigneeId: "bia", ...range });
    const promoted = await updateTask(pmo, "project-1", phase.id, task.id, { assigneeId: "bia", secondaryAssigneeId: null });
    assert.deepEqual([promoted.assigneeId, promoted.secondaryAssigneeId], ["bia", null]);
  });

  it("trocar só o principal por outra pessoa mantém o segundo", async () => {
    const { createTask, updateTask, phase } = await setup();
    const task = await createTask(pmo, "project-1", phase.id, { title: "T", assigneeId: "ana", secondaryAssigneeId: "bia", ...range });
    const changed = await updateTask(pmo, "project-1", phase.id, task.id, { assigneeId: "cris" });
    assert.deepEqual([changed.assigneeId, changed.secondaryAssigneeId], ["cris", "bia"]);
  });

  it("trocar o principal pela mesma pessoa do segundo é recusado", async () => {
    const { createTask, updateTask, phase } = await setup();
    const task = await createTask(pmo, "project-1", phase.id, { title: "T", assigneeId: "ana", secondaryAssigneeId: "bia", ...range });
    await expectHttp(updateTask(pmo, "project-1", phase.id, task.id, { assigneeId: "bia" }), 400, "TASK_SECONDARY_ASSIGNEE_SAME");
  });

  it("remover os dois de uma vez, ou só o principal quando não há segundo", async () => {
    const { createTask, updateTask, phase } = await setup();
    const both = await createTask(pmo, "project-1", phase.id, { title: "A", assigneeId: "ana", secondaryAssigneeId: "bia", ...range });
    const cleared = await updateTask(pmo, "project-1", phase.id, both.id, { assigneeId: null, secondaryAssigneeId: null });
    assert.deepEqual([cleared.assigneeId, cleared.secondaryAssigneeId], [null, null]);
    const single = await createTask(pmo, "project-1", phase.id, { title: "B", assigneeId: "ana", ...range });
    const removed = await updateTask(pmo, "project-1", phase.id, single.id, { assigneeId: null });
    assert.equal(removed.assigneeId, null);
  });

  it("remover só o principal com segundo gravado é recusado", async () => {
    const { createTask, updateTask, phase } = await setup();
    const task = await createTask(pmo, "project-1", phase.id, { title: "T", assigneeId: "ana", secondaryAssigneeId: "bia", ...range });
    await expectHttp(updateTask(pmo, "project-1", phase.id, task.id, { assigneeId: null }), 400, "TASK_SECONDARY_ASSIGNEE_REQUIRES_PRIMARY");
  });
});

describe("compatibilidade com registros antigos", () => {
  it("tarefa antiga com responsável que saiu do projeto continua editável em outros campos e no segundo responsável", async () => {
    const { store, createTask, updateTask, phase } = await setup();
    const task = await createTask(pmo, "project-1", phase.id, { title: "Antiga", assigneeId: "ana", ...range });
    // O responsável antigo deixa de participar do projeto (registro gravado antes da regra de apoio).
    store.tasks.find((row) => row.id === task.id)!.assigneeId = "saiu";

    const renamed = await updateTask(pmo, "project-1", phase.id, task.id, { title: "Antiga renomeada" });
    assert.equal(renamed.title, "Antiga renomeada");
    assert.equal(renamed.assigneeId, "saiu");

    const withSupport = await updateTask(pmo, "project-1", phase.id, task.id, { secondaryAssigneeId: "bia" });
    assert.deepEqual([withSupport.assigneeId, withSupport.secondaryAssigneeId], ["saiu", "bia"]);

    // Informar um responsável novo que não participa continua sendo recusado.
    await expectHttp(updateTask(pmo, "project-1", phase.id, task.id, { assigneeId: "saiu" }), 400, "TASK_ASSIGNEE_NOT_MEMBER");
  });

  it("tarefa sem segundo responsável (todas as antigas) lê como nulo e atualiza normalmente", async () => {
    const { store, createTask, updateTask, phase } = await setup();
    const task = await createTask(pmo, "project-1", phase.id, { title: "Antiga", assigneeId: "ana", ...range });
    delete (store.tasks.find((row) => row.id === task.id) as { secondaryAssigneeId?: string | null }).secondaryAssigneeId;
    const updated = await updateTask(pmo, "project-1", phase.id, task.id, { priority: "ALTA" });
    assert.equal(updated.priority, "ALTA");
  });
});

describe("permissões: o segundo responsável é só apoio", () => {
  it("o principal registra andamento; o segundo responsável não", async () => {
    const { createTask, updateProgress, phase } = await setup();
    const task = await createTask(pmo, "project-1", phase.id, { title: "T", assigneeId: "ana", secondaryAssigneeId: "bia", ...range });
    const byPrimary = await updateProgress(asUser("ana"), "project-1", phase.id, task.id, { progressPercent: 30 });
    assert.equal(byPrimary.progressPercent, 30);
    await expectHttp(updateProgress(asUser("bia"), "project-1", phase.id, task.id, { progressPercent: 60 }), 403, "TASK_PROGRESS_FORBIDDEN");
  });

  it("quem só é apoio não consegue trocar os responsáveis", async () => {
    const { createTask, updateTask, phase } = await setup();
    const task = await createTask(pmo, "project-1", phase.id, { title: "T", assigneeId: "ana", secondaryAssigneeId: "bia", ...range });
    await assert.rejects(
      updateTask(asUser("bia"), "project-1", phase.id, task.id, { assigneeId: "bia", secondaryAssigneeId: "ana" }),
      (error: unknown) => error instanceof HttpError && (error.statusCode === 403 || error.statusCode === 404),
    );
  });
});
