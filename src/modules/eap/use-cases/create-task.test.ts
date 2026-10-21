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

function actor(role: AuthUser["role"], id = "actor-1"): AuthUser {
  return { id, name: "Actor", email: `${id}@igepps.test`, role };
}

async function setup(role: AuthUser["role"] = "PMO") {
  const store = createEapInMemoryStore({
    users: [
      makeUser({ id: "actor-1", role, name: "Actor" }),
      makeUser({ id: "forn-1", role: "FORNECEDOR" }),
      makeUser({ id: "outsider-1", role: "GESTOR" }),
    ],
    projects: [makeProject({ id: "project-1", ownerId: "owner-1", name: "Projeto Alfa" })],
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
  const phase = await createPhase(actor("PMO", "actor-1"), "project-1", {
    name: "Diagnóstico",
  });

  return { store, createTask, phase };
}

describe("CreateTask", () => {
  it("permite ADMIN, PMO e COORDENADOR criar tarefas", async () => {
    for (const role of ["ADMIN", "PMO", "COORDENADOR"] as const) {
      const { createTask, phase } = await setup(role);
      const task = await createTask(actor(role), "project-1", phase.id, {
        title: `Tarefa ${role}`,
      });
      assert.equal(task.title, `Tarefa ${role}`);
      assert.equal(task.phaseId, phase.id);
      assert.equal(task.progressPercent, 0);
      assert.equal(task.weight, 1);
    }
  });

  it("permite GESTOR autorizado criar tarefa", async () => {
    const store = createEapInMemoryStore({
      users: [makeUser({ id: "gestor-1", role: "GESTOR" }), makeUser({ id: "pmo-1", role: "PMO" })],
      projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
      members: [
        makeMember({
          id: "member-1",
          projectId: "project-1",
          userId: "gestor-1",
          role: "GESTOR",
        }),
      ],
    });
    const repos = makeEapInMemoryRepos(store);
    const runner = makeEapInMemoryTransactionRunner(repos);
    const phase = await makeCreatePhaseUseCase({ repos, runInTransaction: runner })(
      actor("PMO", "pmo-1"),
      "project-1",
      { name: "Execução" },
    );
    const createTask = makeCreateTaskUseCase({ repos, runInTransaction: runner });

    const task = await createTask(actor("GESTOR", "gestor-1"), "project-1", phase.id, {
      title: "Levantar requisitos",
    });
    assert.equal(task.title, "Levantar requisitos");
  });

  it("copia as datas planejadas para a linha de base na criação", async () => {
    const { store, createTask, phase } = await setup("PMO");
    const task = await createTask(actor("PMO"), "project-1", phase.id, {
      title: "Mapear processos",
      plannedStartAt: "2026-01-01T00:00:00.000Z",
      plannedEndAt: "2026-01-15T00:00:00.000Z",
      assigneeId: "forn-1",
    });

    assert.equal(task.plannedStartAt, "2026-01-01T00:00:00.000Z");
    assert.equal(task.plannedEndAt, "2026-01-15T00:00:00.000Z");
    assert.equal(task.baselineStartAt, task.plannedStartAt);
    assert.equal(task.baselineEndAt, task.plannedEndAt);
    assert.equal(task.assigneeId, "forn-1");
    assert.equal(
      store.auditLogs.some((log) => log.entityType === "TASK" && log.action === "CREATE"),
      true,
    );
  });

  it("permite FORNECEDOR e DESENVOLVEDOR vinculados criar tarefa e impede OBSERVADOR", async () => {
    const store = createEapInMemoryStore({
      users: [
        makeUser({ id: "pmo-1", role: "PMO" }),
        makeUser({ id: "forn-1", role: "FORNECEDOR" }),
        makeUser({ id: "dev-1", role: "GESTOR" }),
        makeUser({ id: "obs-1", role: "GESTOR" }),
      ],
      projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
      members: [
        makeMember({
          id: "member-forn",
          projectId: "project-1",
          userId: "forn-1",
          role: "FORNECEDOR",
        }),
        makeMember({
          id: "member-dev",
          projectId: "project-1",
          userId: "dev-1",
          role: "DESENVOLVEDOR",
        }),
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
    const createTask = makeCreateTaskUseCase({ repos, runInTransaction: runner });

    const supplierTask = await createTask(actor("FORNECEDOR", "forn-1"), "project-1", phase.id, {
      title: "Tarefa fornecedor",
    });
    const devTask = await createTask(actor("GESTOR", "dev-1"), "project-1", phase.id, {
      title: "Tarefa desenvolvedor",
    });
    assert.equal(supplierTask.createdBy, "forn-1");
    assert.equal(devTask.createdBy, "dev-1");

    await assert.rejects(
      () =>
        createTask(actor("GESTOR", "obs-1"), "project-1", phase.id, {
          title: "Tarefa observador",
        }),
      (error: unknown) => error instanceof HttpError && error.code === "EAP_CREATE_FORBIDDEN",
    );
  });

  it("rejeita responsável que não participa do projeto", async () => {
    const { createTask, phase } = await setup("PMO");

    await assert.rejects(
      () =>
        createTask(actor("PMO"), "project-1", phase.id, {
          title: "Tarefa inválida",
          assigneeId: "outsider-1",
        }),
      (error: unknown) =>
        error instanceof HttpError && error.code === "TASK_ASSIGNEE_NOT_MEMBER",
    );
  });
});
