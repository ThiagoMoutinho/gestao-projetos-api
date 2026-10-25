import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import {
  authorizeResubmissionBodySchema,
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
import { makeAuthorizeResubmissionUseCase } from "./authorize-resubmission";
import { makeCreateEvidenceUseCase } from "./create-evidence";
import { makeCreateMilestoneUseCase } from "./create-milestone";
import { makeCreatePhaseUseCase } from "./create-phase";
import { makeDeliverMilestoneUseCase } from "./deliver-milestone";
import { makeListMilestoneDeliveriesUseCase } from "./list-milestone-deliveries";
import { makeListPhasesUseCase } from "./list-phases";
import { makeReviewMilestoneUseCase } from "./review-milestone";
import { makeUpdateEvidenceUseCase } from "./update-evidence";
import { makeUpdateMilestoneUseCase } from "./update-milestone";

function actor(role: AuthUser["role"], id: string): AuthUser {
  return { id, name: id, email: `${id}@igepps.test`, role };
}

const pmo = actor("PMO", "pmo-1");
const coordinator = actor("COORDENADOR", "coord-1");
const supplier = actor("FORNECEDOR", "forn-1");
const developer = actor("GESTOR", "dev-1");
const manager = actor("GESTOR", "gestor-1");
const owner = actor("GESTOR", "owner-1");
const areaManager = actor("COLABORADOR", "area-1");

function rejectsWith(code: string) {
  return (error: unknown) => error instanceof HttpError && error.code === code;
}

function setup() {
  const store = createEapInMemoryStore({
    users: [
      makeUser({ id: "pmo-1", role: "PMO" }),
      makeUser({ id: "coord-1", role: "COORDENADOR" }),
      makeUser({ id: "forn-1", role: "FORNECEDOR" }),
      makeUser({ id: "dev-1", role: "GESTOR" }),
      makeUser({ id: "gestor-1", role: "GESTOR" }),
      makeUser({ id: "owner-1", role: "GESTOR" }),
      makeUser({ id: "area-1", role: "COLABORADOR" }),
    ],
    projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
    members: [
      makeMember({ id: "m-forn", projectId: "project-1", userId: "forn-1", role: "FORNECEDOR" }),
      makeMember({ id: "m-dev", projectId: "project-1", userId: "dev-1", role: "DESENVOLVEDOR" }),
      makeMember({ id: "m-gestor", projectId: "project-1", userId: "gestor-1", role: "GESTOR" }),
      makeMember({ id: "m-area", projectId: "project-1", userId: "area-1", role: "OBSERVADOR" }),
    ],
  });
  const repos = makeEapInMemoryRepos(store);
  const runInTransaction = makeEapInMemoryTransactionRunner(repos, store);
  const deps = { repos, runInTransaction };
  return {
    store,
    repos,
    createPhase: makeCreatePhaseUseCase(deps),
    listPhases: makeListPhasesUseCase(deps),
    createMilestone: makeCreateMilestoneUseCase(deps),
    updateMilestone: makeUpdateMilestoneUseCase(deps),
    deliverMilestone: makeDeliverMilestoneUseCase(deps),
    reviewMilestone: makeReviewMilestoneUseCase(deps),
    authorizeResubmission: makeAuthorizeResubmissionUseCase(deps),
    listDeliveries: makeListMilestoneDeliveriesUseCase(deps),
    createEvidence: makeCreateEvidenceUseCase(deps),
    updateEvidence: makeUpdateEvidenceUseCase(deps),
  };
}

async function withMilestone(type: "ENTREGA" | "APROVACAO" = "ENTREGA") {
  const ctx = setup();
  const phase = await ctx.createPhase(pmo, "project-1", { name: "Fase 1" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});
  const milestone = await ctx.createMilestone(pmo, "project-1", phase.id, {
    title: "Pacote técnico",
    type,
    plannedAt: "2026-11-10T15:00:00.000Z",
  });
  const call = <T>(fn: (phaseId: string, milestoneId: string) => Promise<T>) => fn(phase.id, milestone.id);
  return { ctx, phase, milestone, call };
}

const adjustments = {
  decision: "AJUSTES_SOLICITADOS" as const,
  note: "O relatório não cobre os testes de carga.",
  adjustments: "Incluir os testes de carga e o plano de rollback.",
};
const rejection = { decision: "REJEITADO" as const, note: "A entrega não atende aos critérios de aceite." };

describe("homologação de marcos", () => {
  it("aceite autorizado vincula a decisão à rodada e leva o marco a 100% na fase", async () => {
    const { ctx, call } = await withMilestone();

    const delivered = await call((p, m) => ctx.deliverMilestone(supplier, "project-1", p, m, { note: "Versão 1" }));
    assert.equal(delivered.status, "ENTREGUE");
    assert.equal((await ctx.listPhases(pmo, "project-1")).data[0].progressBasisPoints, 0);

    await assert.rejects(
      () => call((p, m) => ctx.reviewMilestone(pmo, "project-1", p, m, { decision: "APROVADO" })),
      rejectsWith("MILESTONE_REVIEW_FORBIDDEN"),
    );
    await assert.rejects(
      () => call((p, m) => ctx.reviewMilestone(coordinator, "project-1", p, m, { decision: "APROVADO" })),
      rejectsWith("MILESTONE_REVIEW_FORBIDDEN"),
    );

    const accepted = await call((p, m) => ctx.reviewMilestone(manager, "project-1", p, m, { decision: "APROVADO" }));
    assert.equal(accepted.status, "APROVADO");
    assert.equal(accepted.validatedBy, "gestor-1");
    assert.equal((await ctx.listPhases(pmo, "project-1")).data[0].progressBasisPoints, 10000);

    const rounds = (await call((p, m) => ctx.listDeliveries(supplier, "project-1", p, m))).data;
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0].status, "ACEITA");
    assert.equal(rounds[0].submittedBy, "forn-1");
    assert.equal(rounds[0].note, "Versão 1");
    assert.equal(rounds[0].decidedBy, "gestor-1");
    assert.ok(rounds[0].decidedAt);
  });

  it("impede autoaprovação mesmo para a gestão do projeto", async () => {
    const { ctx, call } = await withMilestone();
    await call((p, m) => ctx.deliverMilestone(manager, "project-1", p, m));

    await assert.rejects(
      () => call((p, m) => ctx.reviewMilestone(manager, "project-1", p, m, { decision: "APROVADO" })),
      rejectsWith("MILESTONE_SELF_REVIEW_FORBIDDEN"),
    );
    assert.equal(ctx.store.deliveries[0].status, "EM_ANALISE");

    const accepted = await call((p, m) => ctx.reviewMilestone(owner, "project-1", p, m, { decision: "APROVADO" }));
    assert.equal(accepted.status, "APROVADO");
  });

  it("exige justificativa para solicitar ajustes", async () => {
    const { ctx, call } = await withMilestone();
    await call((p, m) => ctx.deliverMilestone(supplier, "project-1", p, m));

    await assert.rejects(
      () =>
        call((p, m) =>
          ctx.reviewMilestone(manager, "project-1", p, m, { decision: "AJUSTES_SOLICITADOS", note: "curto" }),
        ),
      rejectsWith("MILESTONE_ADJUSTMENTS_NOTE_REQUIRED"),
    );
    assert.equal(
      reviewMilestoneBodySchema.safeParse({ decision: "AJUSTES_SOLICITADOS" }).success,
      false,
    );
    assert.equal(ctx.store.milestones[0].status, "ENTREGUE");
  });

  it("reenvio após ajustes abre nova rodada e preserva a rodada e as evidências anteriores", async () => {
    const { ctx, phase, milestone, call } = await withMilestone();
    const first = await ctx.createEvidence(supplier, "project-1", {
      title: "Relatório v1",
      url: "https://exemplo.com/v1",
      milestoneId: milestone.id,
    });
    await call((p, m) => ctx.deliverMilestone(supplier, "project-1", p, m));

    const returned = await call((p, m) => ctx.reviewMilestone(manager, "project-1", p, m, adjustments));
    assert.equal(returned.status, "AJUSTES_SOLICITADOS");
    assert.equal((await ctx.listPhases(pmo, "project-1")).data[0].progressBasisPoints, 0);

    await assert.rejects(
      () => ctx.updateEvidence(supplier, "project-1", first.id, { url: "https://exemplo.com/outro" }),
      rejectsWith("EVIDENCE_LOCKED"),
    );
    const second = await ctx.createEvidence(supplier, "project-1", {
      title: "Relatório v2",
      url: "https://exemplo.com/v2",
      milestoneId: milestone.id,
    });

    const redelivered = await call((p, m) => ctx.deliverMilestone(supplier, "project-1", p, m));
    assert.equal(redelivered.status, "ENTREGUE");

    const rounds = (await ctx.listDeliveries(manager, "project-1", phase.id, milestone.id)).data;
    assert.deepEqual(
      rounds.map((round) => [round.round, round.status]),
      [
        [1, "AJUSTES_SOLICITADOS"],
        [2, "EM_ANALISE"],
      ],
    );
    assert.equal(rounds[0].adjustments, adjustments.adjustments);
    assert.equal(rounds[0].decisionNote, adjustments.note);
    const evidenceRound = new Map(ctx.store.evidences.map((row) => [row.id, row.deliveryId]));
    assert.equal(evidenceRound.get(first.id), rounds[0].id);
    assert.equal(evidenceRound.get(second.id), rounds[1].id);
    assert.equal(ctx.store.evidences.find((row) => row.id === first.id)?.url, "https://exemplo.com/v1");
  });

  it("rejeição exige autorização para nova submissão e encaminha ao PMO", async () => {
    const { ctx, call } = await withMilestone();
    await call((p, m) => ctx.deliverMilestone(supplier, "project-1", p, m));

    await assert.rejects(
      () => call((p, m) => ctx.reviewMilestone(manager, "project-1", p, m, { decision: "REJEITADO" })),
      rejectsWith("MILESTONE_REJECTION_NOTE_REQUIRED"),
    );
    const rejected = await call((p, m) => ctx.reviewMilestone(manager, "project-1", p, m, rejection));
    assert.equal(rejected.status, "REJEITADO");
    const review = ctx.store.auditLogs.findLast((log) => log.action === "VALIDATE");
    assert.equal((review?.payload as { escalatedToPmo?: boolean }).escalatedToPmo, true);

    await assert.rejects(
      () => call((p, m) => ctx.deliverMilestone(supplier, "project-1", p, m)),
      rejectsWith("MILESTONE_RESUBMISSION_NOT_AUTHORIZED"),
    );
    const justification = { justification: "Comitê aceitou nova versão no prazo vigente." };
    await assert.rejects(
      () => call((p, m) => ctx.authorizeResubmission(supplier, "project-1", p, m, justification)),
      rejectsWith("MILESTONE_RESUBMISSION_FORBIDDEN"),
    );
    await assert.rejects(
      () => call((p, m) => ctx.authorizeResubmission(coordinator, "project-1", p, m, justification)),
      rejectsWith("MILESTONE_RESUBMISSION_FORBIDDEN"),
    );
    assert.equal(authorizeResubmissionBodySchema.safeParse({ justification: "curto" }).success, false);

    const authorized = await call((p, m) => ctx.authorizeResubmission(pmo, "project-1", p, m, justification));
    assert.equal(authorized.status, "REJEITADO");
    await assert.rejects(
      () => call((p, m) => ctx.authorizeResubmission(pmo, "project-1", p, m, justification)),
      rejectsWith("MILESTONE_RESUBMISSION_INVALID"),
    );

    const redelivered = await call((p, m) => ctx.deliverMilestone(supplier, "project-1", p, m));
    assert.equal(redelivered.status, "ENTREGUE");
    const rounds = ctx.store.deliveries.sort((a, b) => a.round - b.round);
    assert.deepEqual(
      rounds.map((round) => [round.round, round.status, round.resubmissionAuthorizedBy]),
      [
        [1, "REJEITADA", "pmo-1"],
        [2, "EM_ANALISE", null],
      ],
    );
    assert.equal(rounds[0].decisionNote, rejection.note);
  });

  it("decisões não alteram prazo planejado, linha de base nem prazo vigente", async () => {
    const { ctx, call } = await withMilestone();
    const before = { ...ctx.store.milestones[0] };

    await call((p, m) => ctx.deliverMilestone(supplier, "project-1", p, m));
    await call((p, m) => ctx.reviewMilestone(manager, "project-1", p, m, adjustments));
    await call((p, m) => ctx.deliverMilestone(supplier, "project-1", p, m));
    await call((p, m) => ctx.reviewMilestone(manager, "project-1", p, m, rejection));

    const after = ctx.store.milestones[0];
    assert.equal(after.plannedAt?.toISOString(), before.plannedAt?.toISOString());
    assert.equal(after.baselineAt?.toISOString(), before.baselineAt?.toISOString());
  });

  it("homologador designado é o único a decidir e precisa ser participante não fornecedor", async () => {
    const { ctx, call } = await withMilestone();

    await assert.rejects(
      () => call((p, m) => ctx.updateMilestone(pmo, "project-1", p, m, { reviewerId: "forn-1" })),
      rejectsWith("MILESTONE_REVIEWER_INVALID"),
    );
    await assert.rejects(
      () => call((p, m) => ctx.updateMilestone(pmo, "project-1", p, m, { reviewerId: "coord-1" })),
      rejectsWith("MILESTONE_REVIEWER_INVALID"),
    );
    const designated = await call((p, m) => ctx.updateMilestone(pmo, "project-1", p, m, { reviewerId: "area-1" }));
    assert.equal(designated.reviewerId, "area-1");

    await call((p, m) => ctx.deliverMilestone(supplier, "project-1", p, m));
    await assert.rejects(
      () => call((p, m) => ctx.reviewMilestone(manager, "project-1", p, m, { decision: "APROVADO" })),
      rejectsWith("MILESTONE_REVIEW_FORBIDDEN"),
    );
    const accepted = await call((p, m) => ctx.reviewMilestone(areaManager, "project-1", p, m, { decision: "APROVADO" }));
    assert.equal(accepted.validatedBy, "area-1");
  });

  it("entrega anterior ao controle ganha rodada legado com os dados já gravados", async () => {
    const { ctx, milestone, call } = await withMilestone();
    const deliveredAt = new Date("2026-10-01T15:00:00.000Z");
    Object.assign(ctx.store.milestones[0], { status: "ENTREGUE", deliveredBy: "forn-1", actualAt: deliveredAt });
    ctx.store.evidences.push(
      {
        id: "ev-old",
        phaseId: null,
        taskId: null,
        milestoneId: milestone.id,
        scheduleRequestId: null,
        title: "Anexo enviado",
        url: "https://exemplo.com/antigo",
        deliveryId: null,
        createdBy: "forn-1",
        createdAt: new Date("2026-09-30T15:00:00.000Z"),
      },
      {
        id: "ev-late",
        phaseId: null,
        taskId: null,
        milestoneId: milestone.id,
        scheduleRequestId: null,
        title: "Anexo posterior",
        url: "https://exemplo.com/posterior",
        deliveryId: null,
        createdBy: "forn-1",
        createdAt: new Date("2026-10-05T15:00:00.000Z"),
      },
    );

    await call((p, m) => ctx.reviewMilestone(manager, "project-1", p, m, adjustments));

    const [round] = ctx.store.deliveries;
    assert.equal(round.legacy, true);
    assert.equal(round.round, 1);
    assert.equal(round.submittedBy, "forn-1");
    assert.equal(round.submittedAt?.toISOString(), deliveredAt.toISOString());
    assert.equal(round.note, null);
    assert.equal(round.status, "AJUSTES_SOLICITADOS");
    assert.equal(ctx.store.evidences.find((row) => row.id === "ev-old")?.deliveryId, round.id);
    assert.equal(ctx.store.evidences.find((row) => row.id === "ev-late")?.deliveryId, null);
  });

  it("marco de aprovação admite somente aceite ou rejeição, sem rodadas", async () => {
    const { ctx, call } = await withMilestone("APROVACAO");

    await assert.rejects(
      () => call((p, m) => ctx.deliverMilestone(supplier, "project-1", p, m)),
      rejectsWith("MILESTONE_DELIVER_TYPE_INVALID"),
    );
    await assert.rejects(
      () => call((p, m) => ctx.reviewMilestone(manager, "project-1", p, m, adjustments)),
      rejectsWith("MILESTONE_DECISION_INVALID"),
    );
    const accepted = await call((p, m) => ctx.reviewMilestone(manager, "project-1", p, m, { decision: "APROVADO" }));
    assert.equal(accepted.status, "APROVADO");
    assert.equal(ctx.store.deliveries.length, 0);
  });

  it("impede quem não é fornecedor nem gestão de entregar", async () => {
    const { ctx, call } = await withMilestone();
    await assert.rejects(
      () => call((p, m) => ctx.deliverMilestone(developer, "project-1", p, m)),
      rejectsWith("MILESTONE_DELIVER_FORBIDDEN"),
    );
  });

  it("desfaz rodada, vínculo de evidências e auditoria quando a transação falha", async () => {
    const { ctx, milestone, call } = await withMilestone();
    await ctx.createEvidence(supplier, "project-1", {
      title: "Relatório",
      url: "https://exemplo.com/r",
      milestoneId: milestone.id,
    });
    const originalCreate = ctx.repos.audit.create.bind(ctx.repos.audit);
    ctx.repos.audit.create = async (data) => {
      if (data.action === "STATUS_CHANGE") {
        throw new Error("falha forçada");
      }
      return originalCreate(data);
    };

    await assert.rejects(() => call((p, m) => ctx.deliverMilestone(supplier, "project-1", p, m)));

    assert.equal(ctx.store.milestones[0].status, "PENDENTE");
    assert.equal(ctx.store.milestones[0].deliveredBy, null);
    assert.equal(ctx.store.deliveries.length, 0);
    assert.equal(ctx.store.evidences[0].deliveryId, null);
  });

  it("bloqueia decisão quando a entrega atual não tem deliveredBy", async () => {
    const { ctx, call } = await withMilestone();
    Object.assign(ctx.store.milestones[0], { status: "ENTREGUE", deliveredBy: null });

    await assert.rejects(
      () => call((p, m) => ctx.reviewMilestone(manager, "project-1", p, m, { decision: "APROVADO" })),
      rejectsWith("MILESTONE_DELIVERED_BY_MISSING"),
    );
    assert.equal(ctx.store.milestones[0].status, "ENTREGUE");
    assert.equal(ctx.store.deliveries.length, 0);
  });

  it("não aceita deliveredBy informado pelo cliente", () => {
    assert.equal(
      createMilestoneBodySchema.safeParse({ title: "Marco", type: "ENTREGA", deliveredBy: "forn-1" }).success,
      false,
    );
    assert.equal(
      updateMilestoneBodySchema.safeParse({ deliveredBy: "forn-1", title: "Marco" }).success,
      false,
    );
  });
});
