import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { reviewMilestoneBodySchema } from "../schemas/eap-milestones.schema";
import {
  createEapInMemoryStore,
  makeEapInMemoryRepos,
  makeEapInMemoryTransactionRunner,
  makeMember,
  makeProject,
  makeUser,
} from "../test/in-memory";
import { makeAuthorizeResubmissionUseCase } from "./authorize-resubmission";
import { makeCreateMilestoneUseCase } from "./create-milestone";
import { makeCreatePhaseUseCase } from "./create-phase";
import { makeCreateTaskUseCase } from "./create-task";
import { makeDeliverMilestoneUseCase } from "./deliver-milestone";
import { makeGetScheduleMonitoringUseCase } from "./get-schedule-monitoring";
import { makeListMilestoneDeliveriesUseCase } from "./list-milestone-deliveries";
import { makeReviewMilestoneUseCase } from "./review-milestone";

function actor(role: AuthUser["role"], id: string): AuthUser {
  return { id, name: id, email: `${id}@igepps.test`, role };
}

const pmo = actor("PMO", "pmo-1");
const supplier = actor("FORNECEDOR", "forn-1");
const manager = actor("GESTOR", "gestor-1");
const plannedAt = "2030-11-10T15:00:00.000Z";

function rejectsWith(code: string) {
  return (error: unknown) => error instanceof HttpError && error.code === code;
}

async function setup() {
  const store = createEapInMemoryStore({
    users: [
      makeUser({ id: "pmo-1", role: "PMO" }),
      makeUser({ id: "forn-1", role: "FORNECEDOR" }),
      makeUser({ id: "gestor-1", role: "GESTOR" }),
      makeUser({ id: "owner-1", role: "GESTOR" }),
    ],
    projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
    members: [
      makeMember({ id: "m-forn", projectId: "project-1", userId: "forn-1", role: "FORNECEDOR" }),
      makeMember({ id: "m-gestor", projectId: "project-1", userId: "gestor-1", role: "GESTOR" }),
    ],
  });
  const repos = makeEapInMemoryRepos(store);
  const deps = { repos, runInTransaction: makeEapInMemoryTransactionRunner(repos, store) };
  const phase = await makeCreatePhaseUseCase(deps)(pmo, "project-1", { name: "Entrega" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});
  const milestone = await makeCreateMilestoneUseCase(deps)(pmo, "project-1", phase.id, {
    title: "Homologação do sistema",
    type: "HOMOLOGACAO",
    plannedAt,
  });
  const deliver = makeDeliverMilestoneUseCase(deps);
  const review = makeReviewMilestoneUseCase(deps);
  const authorize = makeAuthorizeResubmissionUseCase(deps);
  const listDeliveries = makeListMilestoneDeliveriesUseCase(deps);

  return {
    store,
    phase,
    milestone,
    createTask: makeCreateTaskUseCase(deps),
    monitoring: makeGetScheduleMonitoringUseCase(deps),
    deliver: () => deliver(supplier, "project-1", phase.id, milestone.id),
    review: (input: Parameters<typeof review>[4]) => review(manager, "project-1", phase.id, milestone.id, input),
    authorize: () =>
      authorize(pmo, "project-1", phase.id, milestone.id, {
        justification: "Comitê autorizou nova tentativa no prazo vigente.",
      }),
    rounds: async () => (await listDeliveries(pmo, "project-1", phase.id, milestone.id)).data,
  };
}

const rejection = {
  decision: "REJEITADO" as const,
  note: "O sistema não atende aos requisitos de acessibilidade.",
  nonconformities: "Formulários sem rótulos; contraste insuficiente.",
  adjustments: "Corrigir rótulos e paleta conforme o guia.",
};

describe("marco de homologação", () => {
  it("envio não grava data efetiva; a rejeição registra inconformidades e evidências sem alterar o prazo", async () => {
    const ctx = await setup();

    const sent = await ctx.deliver();
    assert.equal(sent.status, "ENTREGUE");
    assert.equal(sent.actualAt, null);

    const rejected = await ctx.review({
      ...rejection,
      evidences: [{ title: "Relatório de inspeção", url: "https://exemplo.com/inspecao" }],
    });
    assert.equal(rejected.status, "REJEITADO");
    assert.equal(rejected.actualAt, null);
    assert.equal(rejected.plannedAt, plannedAt);
    assert.equal(rejected.baselineAt, plannedAt);

    const [round] = await ctx.rounds();
    assert.equal(round.nonconformities, rejection.nonconformities);
    assert.equal(round.adjustments, rejection.adjustments);
    const evidence = ctx.store.evidences.find((row) => row.title === "Relatório de inspeção");
    assert.equal(evidence?.deliveryId, round.id);
    assert.equal(evidence?.createdBy, "gestor-1");
  });

  it("rejeições repetidas mantêm um único marco e o histórico de tentativas até a homologação", async () => {
    const ctx = await setup();

    await ctx.deliver();
    await ctx.review(rejection);
    await ctx.authorize();
    await ctx.deliver();
    await ctx.review({ ...rejection, note: "Persistem falhas de contraste na área administrativa." });
    await assert.rejects(() => ctx.deliver(), rejectsWith("MILESTONE_RESUBMISSION_NOT_AUTHORIZED"));
    await ctx.authorize();
    await ctx.deliver();
    await ctx.review({
      decision: "AJUSTES_SOLICITADOS",
      note: "Falta o termo de aceite assinado pela área.",
      adjustments: "Anexar o termo de aceite.",
    });
    await ctx.deliver();
    const homologated = await ctx.review({ decision: "APROVADO" });

    assert.equal(ctx.store.milestones.length, 1);
    assert.equal(homologated.status, "APROVADO");
    assert.ok(homologated.actualAt);
    assert.equal(homologated.plannedAt, plannedAt);

    const rounds = await ctx.rounds();
    assert.deepEqual(
      rounds.map((round) => [round.round, round.status]),
      [
        [1, "REJEITADA"],
        [2, "REJEITADA"],
        [3, "AJUSTES_SOLICITADOS"],
        [4, "ACEITA"],
      ],
    );

    const data = await ctx.monitoring(pmo, "project-1");
    const item = data.homologation.milestones.find((row) => row.milestoneId === ctx.milestone.id);
    assert.equal(item?.attempts, 4);
    assert.equal(item?.rejections, 2);
    assert.equal(item?.correctionRequests, 1);
    assert.equal(item?.attemptsUntilHomologation, 4);
    assert.equal(data.homologation.rejectionDecisions, 2);
  });

  it("tarefa corretiva usa a estrutura de tarefas e só se vincula a marco com correções pendentes", async () => {
    const ctx = await setup();

    await assert.rejects(
      () =>
        ctx.createTask(pmo, "project-1", ctx.phase.id, {
          title: "Corrigir contraste",
          correctiveMilestoneId: ctx.milestone.id,
        
        plannedStartAt: "2026-06-01T15:00:00.000Z",
        plannedEndAt: "2026-06-30T15:00:00.000Z"}),
      rejectsWith("TASK_CORRECTIVE_MILESTONE_INVALID"),
    );

    await ctx.deliver();
    await ctx.review({
      decision: "AJUSTES_SOLICITADOS",
      note: "Contraste abaixo do mínimo exigido.",
      adjustments: "Ajustar a paleta.",
    });
    const task = await ctx.createTask(supplier, "project-1", ctx.phase.id, {
      title: "Corrigir contraste",
      correctiveMilestoneId: ctx.milestone.id,
    
    plannedStartAt: "2026-06-01T15:00:00.000Z",
    plannedEndAt: "2026-06-30T15:00:00.000Z"});
    assert.equal(task.correctiveMilestoneId, ctx.milestone.id);
    assert.equal(ctx.store.milestones[0].status, "AJUSTES_SOLICITADOS");
  });

  it("valida o formulário de decisão", () => {
    assert.equal(
      reviewMilestoneBodySchema.safeParse({ decision: "REJEITADO", note: "curto" }).success,
      false,
    );
    assert.equal(
      reviewMilestoneBodySchema.safeParse({
        ...rejection,
        evidences: [{ title: "Laudo", url: "não é url" }],
      }).success,
      false,
    );
  });
});
