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
import { makeCreateMilestoneUseCase } from "./create-milestone";
import { makeCreatePhaseUseCase } from "./create-phase";

function actor(role: AuthUser["role"], id = "actor-1"): AuthUser {
  return { id, name: "Actor", email: `${id}@igepps.test`, role };
}

describe("CreateMilestone", () => {
  it("permite institucional criar marco e copia a baseline da data planejada", async () => {
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
    const createMilestone = makeCreateMilestoneUseCase({ repos, runInTransaction: runner });

    const milestone = await createMilestone(actor("PMO", "pmo-1"), "project-1", phase.id, {
      title: "Entrega do diagnóstico",
      type: "ENTREGA",
      plannedAt: "2026-04-01T00:00:00.000Z",
    });

    assert.equal(milestone.status, "PENDENTE");
    assert.equal(milestone.plannedAt, "2026-04-01T00:00:00.000Z");
    assert.equal(milestone.baselineAt, milestone.plannedAt);
    assert.equal(
      store.auditLogs.some((log) => log.entityType === "MILESTONE" && log.action === "CREATE"),
      true,
    );
  });

  it("permite FORNECEDOR vinculado criar marco e impede OBSERVADOR", async () => {
    const store = createEapInMemoryStore({
      users: [
        makeUser({ id: "pmo-1", role: "PMO" }),
        makeUser({ id: "forn-1", role: "FORNECEDOR" }),
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
    const createMilestone = makeCreateMilestoneUseCase({ repos, runInTransaction: runner });

    const milestone = await createMilestone(actor("FORNECEDOR", "forn-1"), "project-1", phase.id, {
      title: "Marco fornecedor",
      type: "ENTREGA",
    
    plannedAt: "2026-06-15T15:00:00.000Z"});
    assert.equal(milestone.createdBy, "forn-1");
    assert.equal(milestone.status, "PENDENTE");

    await assert.rejects(
      () =>
        createMilestone(actor("GESTOR", "obs-1"), "project-1", phase.id, {
          title: "Marco observador",
          type: "ENTREGA",
        
        plannedAt: "2026-06-15T15:00:00.000Z"}),
      (error: unknown) => error instanceof HttpError && error.code === "EAP_CREATE_FORBIDDEN",
    );
  });
});
