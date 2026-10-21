import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import {
  createMilestoneBodySchema,
  reviewMilestoneBodySchema,
  updateMilestoneBodySchema,
} from "../schemas/eap-milestones.schema";
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
import { makeDeliverMilestoneUseCase } from "./deliver-milestone";
import { makeReviewMilestoneUseCase } from "./review-milestone";

function actor(role: AuthUser["role"], id = "actor-1"): AuthUser {
  return { id, name: "Actor", email: `${id}@igepps.test`, role };
}

function setup() {
  const store = createEapInMemoryStore({
    users: [
      makeUser({ id: "pmo-1", role: "PMO" }),
      makeUser({ id: "coord-1", role: "COORDENADOR" }),
      makeUser({ id: "forn-1", role: "FORNECEDOR" }),
      makeUser({ id: "dev-1", role: "GESTOR" }),
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
    ],
  });
  const repos = makeEapInMemoryRepos(store);
  const runner = makeEapInMemoryTransactionRunner(repos, store);
  return {
    store,
    repos,
    createPhase: makeCreatePhaseUseCase({ repos, runInTransaction: runner }),
    createMilestone: makeCreateMilestoneUseCase({ repos, runInTransaction: runner }),
    deliverMilestone: makeDeliverMilestoneUseCase({ repos, runInTransaction: runner }),
    reviewMilestone: makeReviewMilestoneUseCase({ repos, runInTransaction: runner }),
  };
}

describe("DeliverMilestone e ReviewMilestone", () => {
  it("permite fornecedor entregar e PMO aprovar com usuários diferentes", async () => {
    const ctx = setup();
    const phase = await ctx.createPhase(actor("PMO", "pmo-1"), "project-1", { name: "Fase 1" });
    const milestone = await ctx.createMilestone(actor("PMO", "pmo-1"), "project-1", phase.id, {
      title: "Pacote técnico",
      type: "ENTREGA",
    });

    const delivered = await ctx.deliverMilestone(
      actor("FORNECEDOR", "forn-1"),
      "project-1",
      phase.id,
      milestone.id,
    );
    assert.equal(delivered.status, "ENTREGUE");
    assert.equal(delivered.deliveredBy, "forn-1");
    assert.ok(delivered.actualAt);

    const approved = await ctx.reviewMilestone(
      actor("PMO", "pmo-1"),
      "project-1",
      phase.id,
      milestone.id,
      { decision: "APROVADO" },
    );
    assert.equal(approved.status, "APROVADO");
    assert.equal(approved.validatedBy, "pmo-1");
    assert.equal(approved.deliveredBy, "forn-1");
    assert.equal(ctx.store.projects[0].status, "NAO_INICIADO");
    assert.equal(
      ctx.store.auditLogs.some(
        (log) => log.action === "STATUS_CHANGE" && log.entityType === "MILESTONE",
      ),
      true,
    );
    assert.equal(
      ctx.store.auditLogs.some((log) => log.action === "VALIDATE"),
      true,
    );
  });

  it("impede autoaprovação e transições inválidas", async () => {
    const ctx = setup();
    const phase = await ctx.createPhase(actor("PMO", "pmo-1"), "project-1", { name: "Fase 1" });
    const delivery = await ctx.createMilestone(actor("PMO", "pmo-1"), "project-1", phase.id, {
      title: "Entrega",
      type: "ENTREGA",
    });
    const approval = await ctx.createMilestone(actor("PMO", "pmo-1"), "project-1", phase.id, {
      title: "Aprovação",
      type: "APROVACAO",
    });

    await ctx.deliverMilestone(actor("PMO", "pmo-1"), "project-1", phase.id, delivery.id);

    await assert.rejects(
      () =>
        ctx.reviewMilestone(actor("PMO", "pmo-1"), "project-1", phase.id, delivery.id, {
          decision: "APROVADO",
        }),
      (error: unknown) =>
        error instanceof HttpError && error.code === "MILESTONE_SELF_REVIEW_FORBIDDEN",
    );
    await assert.rejects(
      () => ctx.deliverMilestone(actor("FORNECEDOR", "forn-1"), "project-1", phase.id, delivery.id),
      (error: unknown) =>
        error instanceof HttpError && error.code === "MILESTONE_TRANSITION_INVALID",
    );
    await assert.rejects(
      () => ctx.deliverMilestone(actor("FORNECEDOR", "forn-1"), "project-1", phase.id, approval.id),
      (error: unknown) =>
        error instanceof HttpError && error.code === "MILESTONE_DELIVER_TYPE_INVALID",
    );
    await assert.rejects(
      () =>
        ctx.reviewMilestone(actor("COORDENADOR", "coord-1"), "project-1", phase.id, delivery.id, {
          decision: "REJEITADO",
          note: "curto",
        }),
      (error: unknown) =>
        error instanceof HttpError && error.code === "MILESTONE_REJECTION_NOTE_REQUIRED",
    );
  });

  it("rejeita com justificativa, permite reentrega e impede DESENVOLVEDOR de entregar", async () => {
    const ctx = setup();
    const phase = await ctx.createPhase(actor("PMO", "pmo-1"), "project-1", { name: "Fase 1" });
    const milestone = await ctx.createMilestone(actor("PMO", "pmo-1"), "project-1", phase.id, {
      title: "Entrega",
      type: "ENTREGA",
    });

    await assert.rejects(
      () => ctx.deliverMilestone(actor("GESTOR", "dev-1"), "project-1", phase.id, milestone.id),
      (error: unknown) =>
        error instanceof HttpError && error.code === "MILESTONE_DELIVER_FORBIDDEN",
    );

    const firstDelivery = await ctx.deliverMilestone(
      actor("FORNECEDOR", "forn-1"),
      "project-1",
      phase.id,
      milestone.id,
    );
    assert.equal(firstDelivery.deliveredBy, "forn-1");
    const rejected = await ctx.reviewMilestone(
      actor("PMO", "pmo-1"),
      "project-1",
      phase.id,
      milestone.id,
      { decision: "REJEITADO", note: "Faltam evidências técnicas suficientes." },
    );
    assert.equal(rejected.status, "REJEITADO");
    assert.equal(rejected.validationNote, "Faltam evidências técnicas suficientes.");

    const redelivered = await ctx.deliverMilestone(
      actor("PMO", "pmo-1"),
      "project-1",
      phase.id,
      milestone.id,
    );
    assert.equal(redelivered.status, "ENTREGUE");
    assert.equal(redelivered.deliveredBy, "pmo-1");
    assert.equal(redelivered.validatedBy, null);
    const deliveries = ctx.store.auditLogs.filter(
      (log) =>
        log.action === "STATUS_CHANGE" &&
        (log.payload as { kind?: string } | null)?.kind === "DELIVER",
    );
    assert.deepEqual(
      deliveries.map((log) => log.actorId),
      ["forn-1", "pmo-1"],
    );
  });

  it("desfaz alteração e auditoria quando a transação falha", async () => {
    const ctx = setup();
    const originalCreate = ctx.repos.audit.create.bind(ctx.repos.audit);
    ctx.repos.audit.create = async (data) => {
      if (data.action === "STATUS_CHANGE") {
        throw new Error("falha forçada");
      }
      return originalCreate(data);
    };

    const phase = await ctx.createPhase(actor("PMO", "pmo-1"), "project-1", { name: "Fase 1" });
    const milestone = await ctx.createMilestone(actor("PMO", "pmo-1"), "project-1", phase.id, {
      title: "Entrega",
      type: "ENTREGA",
    });

    await assert.rejects(() =>
      ctx.deliverMilestone(actor("FORNECEDOR", "forn-1"), "project-1", phase.id, milestone.id),
    );

    assert.equal(ctx.store.milestones[0].status, "PENDENTE");
    assert.equal(ctx.store.milestones[0].deliveredBy, null);
    assert.equal(
      ctx.store.auditLogs.some((log) => log.action === "STATUS_CHANGE"),
      false,
    );
  });

  it("bloqueia decisão quando a entrega atual não tem deliveredBy", async () => {
    const ctx = setup();
    const phase = await ctx.createPhase(actor("PMO", "pmo-1"), "project-1", { name: "Fase 1" });
    const milestone = await ctx.createMilestone(actor("PMO", "pmo-1"), "project-1", phase.id, {
      title: "Entrega sem responsável",
      type: "ENTREGA",
    });
    await ctx.deliverMilestone(actor("FORNECEDOR", "forn-1"), "project-1", phase.id, milestone.id);
    ctx.store.milestones[0].deliveredBy = null;

    await assert.rejects(
      () =>
        ctx.reviewMilestone(actor("PMO", "pmo-1"), "project-1", phase.id, milestone.id, {
          decision: "APROVADO",
        }),
      (error: unknown) =>
        error instanceof HttpError && error.code === "MILESTONE_DELIVERED_BY_MISSING",
    );
    assert.equal(ctx.store.milestones[0].status, "ENTREGUE");
  });

  it("rejeita no schema decisão REJEITADO sem justificativa e deliveredBy informado pelo cliente", () => {
    const parsed = reviewMilestoneBodySchema.safeParse({ decision: "REJEITADO", note: "curto" });
    assert.equal(parsed.success, false);
    assert.equal(
      createMilestoneBodySchema.safeParse({
        title: "Marco",
        type: "ENTREGA",
        deliveredBy: "forn-1",
      }).success,
      false,
    );
    assert.equal(
      updateMilestoneBodySchema.safeParse({ deliveredBy: "forn-1", title: "Marco" }).success,
      false,
    );
  });
});
