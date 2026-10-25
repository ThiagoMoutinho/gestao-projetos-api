import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { updatePhaseBodySchema } from "../schemas/eap-phases.schema";
import {
  createEapInMemoryStore,
  makeEapInMemoryRepos,
  makeEapInMemoryTransactionRunner,
  makeMember,
  makeProject,
  makeUser,
} from "../test/in-memory";
import { makeCreatePhaseUseCase } from "./create-phase";
import { makeUpdatePhaseUseCase } from "./update-phase";

function actor(role: AuthUser["role"], id = "actor-1"): AuthUser {
  return { id, name: "Actor", email: `${id}@igepps.test`, role };
}

describe("UpdatePhase", () => {
  it("impede FORNECEDOR de editar fase", async () => {
    const store = createEapInMemoryStore({
      users: [
        makeUser({ id: "pmo-1", role: "PMO" }),
        makeUser({ id: "forn-1", role: "FORNECEDOR" }),
      ],
      projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
      members: [
        makeMember({
          id: "member-1",
          projectId: "project-1",
          userId: "forn-1",
          role: "FORNECEDOR",
        }),
      ],
    });
    const repos = makeEapInMemoryRepos(store);
    const runner = makeEapInMemoryTransactionRunner(repos);
    const createPhase = makeCreatePhaseUseCase({ repos, runInTransaction: runner });
    const updatePhase = makeUpdatePhaseUseCase({ repos, runInTransaction: runner });
    const phase = await createPhase(actor("PMO", "pmo-1"), "project-1", {
      name: "Fase 1" });

    await assert.rejects(
      () =>
        updatePhase(actor("FORNECEDOR", "forn-1"), "project-1", phase.id, {
          name: "Fase alterada",
        }),
      (error: unknown) =>
        error instanceof HttpError && error.code === "PHASE_MANAGE_FORBIDDEN",
    );
  });

  it("não permite alterar fase de outro projeto pela URL", async () => {
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
    const updatePhase = makeUpdatePhaseUseCase({ repos, runInTransaction: runner });
    const phase = await createPhase(actor("PMO", "pmo-1"), "project-2", {
      name: "Fase do projeto 2" });

    await assert.rejects(
      () =>
        updatePhase(actor("PMO", "pmo-1"), "project-1", phase.id, {
          name: "Tentativa",
        }),
      (error: unknown) =>
        error instanceof HttpError && error.code === "PHASE_NOT_FOUND",
    );
  });

  it("atualiza nome sem alterar baseline nem prazos planejados", async () => {
    const store = createEapInMemoryStore({
      users: [makeUser({ id: "pmo-1", role: "PMO" })],
      projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
    });
    const repos = makeEapInMemoryRepos(store);
    const runner = makeEapInMemoryTransactionRunner(repos);
    const createPhase = makeCreatePhaseUseCase({ repos, runInTransaction: runner });
    const updatePhase = makeUpdatePhaseUseCase({ repos, runInTransaction: runner });
    const created = await createPhase(actor("PMO", "pmo-1"), "project-1", {
      name: "Fase 1",
    });

    const updated = await updatePhase(actor("PMO", "pmo-1"), "project-1", created.id, {
      name: "Fase 1 revisada",
    });

    assert.equal(updated.name, "Fase 1 revisada");
    assert.equal(updated.status, "NAO_INICIADA");
    assert.equal(updated.plannedStartAt, created.plannedStartAt);
    assert.equal(updated.plannedEndAt, created.plannedEndAt);
    assert.equal(updated.baselineStartAt, created.baselineStartAt);
    assert.equal(updated.baselineEndAt, created.baselineEndAt);
    assert.equal(store.auditLogs.at(-1)?.action, "UPDATE");
  });

  it("rejeita no schema PATCH com baseline ou planned_*", () => {
    const planned = updatePhaseBodySchema.safeParse({
      plannedStartAt: "2026-01-01T00:00:00.000Z",
    });
    const baseline = updatePhaseBodySchema.safeParse({
      baselineEndAt: "2026-03-01T00:00:00.000Z",
    });

    const status = updatePhaseBodySchema.safeParse({ status: "CONCLUIDA" });

    assert.equal(planned.success, false);
    assert.equal(baseline.success, false);
    assert.equal(status.success, false);
  });
});
