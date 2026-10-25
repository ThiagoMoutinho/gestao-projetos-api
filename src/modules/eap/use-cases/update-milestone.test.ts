import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { updateMilestoneBodySchema } from "../schemas/eap-milestones.schema";
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
import { makeGetMilestoneUseCase } from "./get-milestone";
import { makeListMilestonesUseCase } from "./list-milestones";
import { makeUpdateMilestoneUseCase } from "./update-milestone";

function actor(role: AuthUser["role"], id = "actor-1"): AuthUser {
  return { id, name: "Actor", email: `${id}@igepps.test`, role };
}

describe("UpdateMilestone, ListMilestones e GetMilestone", () => {
  it("atualiza estrutura sem alterar baseline ou data planejada", async () => {
    const store = createEapInMemoryStore({
      users: [makeUser({ id: "pmo-1", role: "PMO" })],
      projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
    });
    const repos = makeEapInMemoryRepos(store);
    const runner = makeEapInMemoryTransactionRunner(repos);
    const phase = await makeCreatePhaseUseCase({ repos, runInTransaction: runner })(
      actor("PMO", "pmo-1"),
      "project-1",
      {
        name: "Fase 1",

      },
    );
    const created = await makeCreateMilestoneUseCase({ repos, runInTransaction: runner })(
      actor("PMO", "pmo-1"),
      "project-1",
      phase.id,
      {
        title: "Aprovação PMO",
        type: "APROVACAO",
        plannedAt: "2026-05-01T00:00:00.000Z",
      },
    );
    const updated = await makeUpdateMilestoneUseCase({ repos, runInTransaction: runner })(
      actor("PMO", "pmo-1"),
      "project-1",
      phase.id,
      created.id,
      { title: "Aprovação institucional" },
    );

    assert.equal(updated.title, "Aprovação institucional");
    assert.equal(updated.status, "PENDENTE");
    assert.equal(updated.plannedAt, created.plannedAt);
    assert.equal(updated.baselineAt, created.baselineAt);
    assert.equal((store.auditLogs.at(-1)?.payload as { kind?: string }).kind, "STRUCTURE");
  });

  it("impede FORNECEDOR de editar e recusa marco de outra fase", async () => {
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
    const createMilestone = makeCreateMilestoneUseCase({ repos, runInTransaction: runner });
    const updateMilestone = makeUpdateMilestoneUseCase({ repos, runInTransaction: runner });
    const listMilestones = makeListMilestonesUseCase({ repos });
    const getMilestone = makeGetMilestoneUseCase({ repos });
    const phaseA = await createPhase(actor("PMO", "pmo-1"), "project-1", { name: "Fase A" });
    const phaseB = await createPhase(actor("PMO", "pmo-1"), "project-2", { name: "Fase B" });
    const milestoneA = await createMilestone(actor("PMO", "pmo-1"), "project-1", phaseA.id, {
      title: "Marco A",
      type: "ENTREGA",
    
    plannedAt: "2026-06-15T15:00:00.000Z"});
    const milestoneB = await createMilestone(actor("PMO", "pmo-1"), "project-2", phaseB.id, {
      title: "Marco B",
      type: "ENTREGA",
    
    plannedAt: "2026-06-15T15:00:00.000Z"});

    const listed = await listMilestones(actor("FORNECEDOR", "forn-1"), "project-1", phaseA.id);
    assert.deepEqual(
      listed.data.map((item) => item.title),
      ["Marco A"],
    );

    await assert.rejects(
      () =>
        updateMilestone(actor("FORNECEDOR", "forn-1"), "project-1", phaseA.id, milestoneA.id, {
          title: "Alterado",
        }),
      (error: unknown) =>
        error instanceof HttpError && error.code === "MILESTONE_STRUCTURE_FORBIDDEN",
    );
    await assert.rejects(
      () => getMilestone(actor("PMO", "pmo-1"), "project-1", phaseA.id, milestoneB.id),
      (error: unknown) =>
        error instanceof HttpError && error.code === "MILESTONE_NOT_FOUND",
    );
  });

  it("rejeita no schema PATCH com baseline, plannedAt ou status", () => {
    assert.equal(
      updateMilestoneBodySchema.safeParse({ plannedAt: "2026-01-01T00:00:00.000Z" }).success,
      false,
    );
    assert.equal(
      updateMilestoneBodySchema.safeParse({ baselineAt: "2026-01-01T00:00:00.000Z" }).success,
      false,
    );
    assert.equal(updateMilestoneBodySchema.safeParse({ status: "APROVADO" }).success, false);
  });
});
