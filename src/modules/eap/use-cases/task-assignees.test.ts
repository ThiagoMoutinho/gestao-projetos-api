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
import { makeDuplicateTaskUseCase } from "./duplicate-items";
import { makeUpdateTaskUseCase } from "./update-task";

const pmo: AuthUser = { id: "pmo-1", name: "PMO", email: "pmo@igepps.test", role: "PMO" };
const range = { plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z" };

async function setup() {
  const store = createEapInMemoryStore({
    users: [
      makeUser({ id: "pmo-1", role: "PMO", name: "PMO" }),
      makeUser({ id: "ana", role: "COLABORADOR", name: "Ana" }),
      makeUser({ id: "bia", role: "COLABORADOR", name: "Bia" }),
      makeUser({ id: "fora", role: "COLABORADOR", name: "Fora do projeto" }),
    ],
    projects: [makeProject({ id: "project-1", ownerId: "owner-1", name: "Projeto Alfa" })],
    members: [
      makeMember({ id: "m-ana", projectId: "project-1", userId: "ana", role: "DESENVOLVEDOR" }),
      makeMember({ id: "m-bia", projectId: "project-1", userId: "bia", role: "DESENVOLVEDOR" }),
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
    duplicateTask: makeDuplicateTaskUseCase(deps),
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

describe("segundo responsável da tarefa", () => {
  it("cria a tarefa com responsável e segundo responsável", async () => {
    const { createTask, phase } = await setup();
    const task = await createTask(pmo, "project-1", phase.id, { title: "T", assigneeId: "ana", secondaryAssigneeId: "bia", ...range });
    assert.equal(task.assigneeId, "ana");
    assert.equal(task.secondaryAssigneeId, "bia");
  });

  it("a tarefa continua sem segundo responsável quando ele não é informado", async () => {
    const { createTask, phase } = await setup();
    const task = await createTask(pmo, "project-1", phase.id, { title: "T", assigneeId: "ana", ...range });
    assert.equal(task.secondaryAssigneeId, null);
  });

  it("recusa o segundo responsável sem o principal", async () => {
    const { createTask, phase } = await setup();
    await expectHttp(
      createTask(pmo, "project-1", phase.id, { title: "T", secondaryAssigneeId: "bia", ...range }),
      400,
      "TASK_SECONDARY_ASSIGNEE_REQUIRES_PRIMARY",
    );
  });

  it("recusa a mesma pessoa nos dois campos", async () => {
    const { createTask, phase } = await setup();
    await expectHttp(
      createTask(pmo, "project-1", phase.id, { title: "T", assigneeId: "ana", secondaryAssigneeId: "ana", ...range }),
      400,
      "TASK_SECONDARY_ASSIGNEE_SAME",
    );
  });

  it("recusa segundo responsável que não participa do projeto", async () => {
    const { createTask, phase } = await setup();
    await expectHttp(
      createTask(pmo, "project-1", phase.id, { title: "T", assigneeId: "ana", secondaryAssigneeId: "fora", ...range }),
      400,
      "TASK_ASSIGNEE_NOT_MEMBER",
    );
  });

  it("atualiza e remove o segundo responsável", async () => {
    const { createTask, updateTask, phase } = await setup();
    const task = await createTask(pmo, "project-1", phase.id, { title: "T", assigneeId: "ana", ...range });
    const withSecond = await updateTask(pmo, "project-1", phase.id, task.id, { secondaryAssigneeId: "bia" });
    assert.equal(withSecond.secondaryAssigneeId, "bia");
    const removed = await updateTask(pmo, "project-1", phase.id, task.id, { secondaryAssigneeId: null });
    assert.equal(removed.secondaryAssigneeId, null);
    assert.equal(removed.assigneeId, "ana");
  });

  it("não deixa tirar o principal enquanto houver segundo responsável", async () => {
    const { createTask, updateTask, phase } = await setup();
    const task = await createTask(pmo, "project-1", phase.id, { title: "T", assigneeId: "ana", secondaryAssigneeId: "bia", ...range });
    await expectHttp(
      updateTask(pmo, "project-1", phase.id, task.id, { assigneeId: null }),
      400,
      "TASK_SECONDARY_ASSIGNEE_REQUIRES_PRIMARY",
    );
    const swapped = await updateTask(pmo, "project-1", phase.id, task.id, { assigneeId: "bia", secondaryAssigneeId: "ana" });
    assert.equal(swapped.assigneeId, "bia");
    assert.equal(swapped.secondaryAssigneeId, "ana");
  });

  it("a cópia da tarefa leva os dois responsáveis", async () => {
    const { createTask, duplicateTask, phase } = await setup();
    const task = await createTask(pmo, "project-1", phase.id, { title: "T", assigneeId: "ana", secondaryAssigneeId: "bia", ...range });
    const copy = await duplicateTask(pmo, "project-1", phase.id, task.id);
    assert.equal(copy.assigneeId, "ana");
    assert.equal(copy.secondaryAssigneeId, "bia");
  });
});
