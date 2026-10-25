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

function actor(role: AuthUser["role"], id = "actor-1"): AuthUser {
  return { id, name: "Actor", email: `${id}@igepps.test`, role };
}

function setup(role: AuthUser["role"] = "PMO") {
  const store = createEapInMemoryStore({
    users: [makeUser({ id: "actor-1", role, name: "Actor" })],
    projects: [makeProject({ id: "project-1", ownerId: "owner-1", name: "Projeto Alfa" })],
    members: [],
  });
  const repos = makeEapInMemoryRepos(store);
  const createPhase = makeCreatePhaseUseCase({
    repos,
    runInTransaction: makeEapInMemoryTransactionRunner(repos),
  });

  return { store, createPhase };
}

describe("CreatePhase", () => {
  it("permite ADMIN, PMO e COORDENADOR criar fase", async () => {
    for (const role of ["ADMIN", "PMO", "COORDENADOR"] as const) {
      const { createPhase } = setup(role);
      const phase = await createPhase(actor(role), "project-1", {
        name: "Diagnóstico",
      
      plannedStartAt: "2026-06-01T15:00:00.000Z",
      plannedEndAt: "2026-06-30T15:00:00.000Z"});
      assert.equal(phase.name, "Diagnóstico");
      assert.equal(phase.projectId, "project-1");
      assert.equal(phase.sortOrder, 0);
    }
  });

  it("permite GESTOR autorizado criar fase", async () => {
    const store = createEapInMemoryStore({
      users: [makeUser({ id: "gestor-1", role: "GESTOR" })],
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
    const createPhase = makeCreatePhaseUseCase({
      repos,
      runInTransaction: makeEapInMemoryTransactionRunner(repos),
    });

    const phase = await createPhase(actor("GESTOR", "gestor-1"), "project-1", {
      name: "Execução",
    
    plannedStartAt: "2026-06-01T15:00:00.000Z",
    plannedEndAt: "2026-06-30T15:00:00.000Z"});
    assert.equal(phase.name, "Execução");
  });

  it("copia as datas planejadas para a linha de base na criação", async () => {
    const { store, createPhase } = setup("PMO");
    const phase = await createPhase(actor("PMO"), "project-1", {
      name: "Planejamento",
      plannedStartAt: "2026-01-01T00:00:00.000Z",
      plannedEndAt: "2026-03-31T00:00:00.000Z",
    });

    assert.equal(phase.plannedStartAt, "2026-01-01T00:00:00.000Z");
    assert.equal(phase.plannedEndAt, "2026-03-31T00:00:00.000Z");
    assert.equal(phase.baselineStartAt, phase.plannedStartAt);
    assert.equal(phase.baselineEndAt, phase.plannedEndAt);
    assert.equal(store.auditLogs.length, 1);
    assert.equal(store.auditLogs[0].action, "CREATE");
    assert.equal(store.auditLogs[0].entityType, "PHASE");
    assert.equal(store.auditLogs[0].entityId, phase.id);
  });

  it("permite FORNECEDOR vinculado criar fase e impede OBSERVADOR e usuário sem vínculo", async () => {
    const store = createEapInMemoryStore({
      users: [
        makeUser({ id: "forn-1", role: "FORNECEDOR" }),
        makeUser({ id: "obs-1", role: "GESTOR" }),
        makeUser({ id: "outsider-1", role: "COLABORADOR" }),
      ],
      projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
      members: [
        makeMember({
          id: "member-1",
          projectId: "project-1",
          userId: "forn-1",
          role: "FORNECEDOR",
        }),
        makeMember({
          id: "member-2",
          projectId: "project-1",
          userId: "obs-1",
          role: "OBSERVADOR",
        }),
      ],
    });
    const repos = makeEapInMemoryRepos(store);
    const createPhase = makeCreatePhaseUseCase({
      repos,
      runInTransaction: makeEapInMemoryTransactionRunner(repos),
    });

    const phase = await createPhase(actor("FORNECEDOR", "forn-1"), "project-1", {
      name: "Fase do fornecedor",
    
    plannedStartAt: "2026-06-01T15:00:00.000Z",
    plannedEndAt: "2026-06-30T15:00:00.000Z"});
    assert.equal(phase.createdBy, "forn-1");

    await assert.rejects(
      () => createPhase(actor("GESTOR", "obs-1"), "project-1", { name: "Fase X" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"}),
      (error: unknown) => error instanceof HttpError && error.code === "EAP_CREATE_FORBIDDEN",
    );
    await assert.rejects(
      () => createPhase(actor("COLABORADOR", "outsider-1"), "project-1", { name: "Fase Y" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"}),
      (error: unknown) => error instanceof HttpError && error.code === "PROJECT_FORBIDDEN",
    );
  });
});
