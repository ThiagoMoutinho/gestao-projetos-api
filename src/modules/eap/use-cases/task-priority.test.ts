import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { createTaskBodySchema, updateTaskBodySchema } from "../schemas/eap-tasks.schema";
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
import { makeUpdateTaskUseCase } from "./update-task";

function actor(role: AuthUser["role"], id: string): AuthUser {
  return { id, name: "Actor", email: `${id}@igepps.test`, role };
}

const dates = { plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z" };

async function setup() {
  const store = createEapInMemoryStore({
    users: [makeUser({ id: "pmo-1", role: "PMO" }), makeUser({ id: "forn-1", role: "FORNECEDOR" })],
    projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
    members: [makeMember({ id: "member-forn", projectId: "project-1", userId: "forn-1", role: "FORNECEDOR" })],
  });
  const repos = makeEapInMemoryRepos(store);
  const runner = makeEapInMemoryTransactionRunner(repos);
  const phase = await makeCreatePhaseUseCase({ repos, runInTransaction: runner })(actor("PMO", "pmo-1"), "project-1", {
    name: "Fase 1",
  });
  return {
    store,
    phase,
    createTask: makeCreateTaskUseCase({ repos, runInTransaction: runner }),
    updateTask: makeUpdateTaskUseCase({ repos, runInTransaction: runner }),
  };
}

describe("Prioridade da tarefa", () => {
  it("usa Normal por padrão e aceita a prioridade informada na criação", async () => {
    const { createTask, phase } = await setup();
    const normal = await createTask(actor("PMO", "pmo-1"), "project-1", phase.id, { title: "Padrão", ...dates });
    const critical = await createTask(actor("PMO", "pmo-1"), "project-1", phase.id, {
      title: "Urgente",
      priority: "CRITICA",
      ...dates,
    });

    assert.equal(normal.priority, "NORMAL");
    assert.equal(critical.priority, "CRITICA");
  });

  it("altera a prioridade, persiste e registra valor anterior e novo na auditoria", async () => {
    const { createTask, updateTask, phase, store } = await setup();
    const task = await createTask(actor("PMO", "pmo-1"), "project-1", phase.id, { title: "Tarefa", ...dates });

    const updated = await updateTask(actor("PMO", "pmo-1"), "project-1", phase.id, task.id, { priority: "ALTA" });

    assert.equal(updated.priority, "ALTA");
    assert.equal(store.tasks.find((row) => row.id === task.id)?.priority, "ALTA");
    const audit = store.auditLogs.at(-1);
    assert.equal(audit?.action, "UPDATE");
    assert.match(audit?.summary ?? "", /de Normal para Alta/);
    assert.equal((audit?.payload as { previousPriority?: string }).previousPriority, "NORMAL");
    assert.equal((audit?.payload as { priority?: string }).priority, "ALTA");
  });

  it("não registra mudança de prioridade quando o valor é o mesmo e preserva o restante da tarefa", async () => {
    const { createTask, updateTask, phase, store } = await setup();
    const task = await createTask(actor("PMO", "pmo-1"), "project-1", phase.id, { title: "Tarefa", ...dates });

    const updated = await updateTask(actor("PMO", "pmo-1"), "project-1", phase.id, task.id, {
      title: "Tarefa revisada",
      priority: "NORMAL",
    });

    assert.equal(updated.priority, "NORMAL");
    assert.equal(updated.title, "Tarefa revisada");
    assert.equal(updated.plannedStartAt, task.plannedStartAt);
    const payload = store.auditLogs.at(-1)?.payload as { previousPriority?: string };
    assert.equal(payload.previousPriority, undefined);
  });

  it("mantém a regra de permissão: fornecedor não altera a prioridade", async () => {
    const { createTask, updateTask, phase } = await setup();
    const task = await createTask(actor("PMO", "pmo-1"), "project-1", phase.id, { title: "Tarefa", ...dates });

    await assert.rejects(
      () => updateTask(actor("FORNECEDOR", "forn-1"), "project-1", phase.id, task.id, { priority: "BAIXA" }),
      (error: unknown) => error instanceof HttpError && error.code === "TASK_STRUCTURE_FORBIDDEN",
    );
  });

  it("valida os valores aceitos na criação e na edição", () => {
    assert.equal(createTaskBodySchema.safeParse({ title: "x", priority: "URGENTE" }).success, false);
    assert.equal(updateTaskBodySchema.safeParse({ priority: "URGENTE" }).success, false);
    for (const priority of ["CRITICA", "ALTA", "NORMAL", "BAIXA"]) {
      assert.equal(updateTaskBodySchema.safeParse({ priority }).success, true);
    }
  });
});
