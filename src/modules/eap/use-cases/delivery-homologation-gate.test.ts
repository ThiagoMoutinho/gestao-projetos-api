import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { createEapInMemoryStore, makeEapInMemoryRepos, makeEapInMemoryTransactionRunner, makeMember, makeProject, makeUser } from "../test/in-memory";
import { seedConformingVersion } from "../test/delivery-compliance.in-memory";
import { makeAuthorizeResubmissionUseCase } from "./authorize-resubmission";
import { makeCloseProjectUseCase } from "./close-project";
import { makeCreateMilestoneUseCase } from "./create-milestone";
import { makeCreatePhaseUseCase } from "./create-phase";
import { makeCreateTaskUseCase } from "./create-task";
import { makeDeliverMilestoneUseCase } from "./deliver-milestone";
import { makeDeliveryItemUseCases } from "./delivery-items";
import { makeDeliveryVersionUseCases } from "./delivery-versions";
import { makeListMilestoneDeliveriesUseCase } from "./list-milestone-deliveries";
import { makeReviewMilestoneUseCase } from "./review-milestone";
import { makeUpdateTaskProgressUseCase } from "./update-task-progress";

const actor = (role: AuthUser["role"], id: string): AuthUser => ({ id, name: `Pessoa ${id}`, email: `${id}@igepps.test`, role });
const pmo = actor("PMO", "pmo-1");
const owner = actor("GESTOR", "owner-1");
const supplier = actor("FORNECEDOR", "forn-1");
const tech = actor("COLABORADOR", "tec-1");

const code = (value: string) => (error: unknown) => error instanceof HttpError && error.code === value;
const day = (value: string) => `${value}T15:00:00.000Z`;
const link = { evidenceKind: "SHAREPOINT" as const, evidenceRef: "https://igepps.sharepoint.com/sites/ctin/documento.pdf" };

type Options = { supplier?: boolean; milestoneType?: "HOMOLOGACAO" | "ENTREGA" | "APROVACAO" };

async function setup(options: Options = {}) {
  const hasSupplier = options.supplier !== false;
  const type = options.milestoneType ?? "HOMOLOGACAO";
  const store = createEapInMemoryStore({
    users: [
      makeUser({ id: "pmo-1", name: "Pessoa pmo-1", role: "PMO" }),
      makeUser({ id: "owner-1", name: "Pessoa owner-1", role: "GESTOR" }),
      makeUser({ id: "forn-1", name: "Pessoa forn-1", role: "FORNECEDOR" }),
      makeUser({ id: "tec-1", name: "Pessoa tec-1", role: "COLABORADOR" }),
    ],
    projects: [makeProject({ id: "project-1", name: "Portal", ownerId: "owner-1" }), makeProject({ id: "project-2", name: "Outro", ownerId: "owner-1" })],
    members: [
      ...(hasSupplier ? [makeMember({ id: "m1", projectId: "project-1", userId: "forn-1", role: "FORNECEDOR" })] : []),
      makeMember({ id: "m2", projectId: "project-1", userId: "tec-1", role: "RESPONSAVEL_TECNICO" }),
      makeMember({ id: "m3", projectId: "project-2", userId: "forn-1", role: "FORNECEDOR" }),
    ],
  });
  const repos = makeEapInMemoryRepos(store);
  const deps = { repos, runInTransaction: makeEapInMemoryTransactionRunner(repos, store) };
  const phase = await makeCreatePhaseUseCase(deps)(pmo, "project-1", { name: "Entrega" });
  const milestone = await makeCreateMilestoneUseCase(deps)(pmo, "project-1", phase.id, {
    title: "Marco final",
    type,
    plannedAt: day("2030-11-10"),
    reviewerId: "tec-1",
  });
  const versions = makeDeliveryVersionUseCases(deps);
  const items = makeDeliveryItemUseCases(deps);
  const deliver = makeDeliverMilestoneUseCase(deps);
  const review = makeReviewMilestoneUseCase(deps);
  const authorize = makeAuthorizeResubmissionUseCase(deps);
  const list = makeListMilestoneDeliveriesUseCase(deps);

  return {
    store,
    repos,
    phase,
    milestone,
    deps,
    versions,
    items,
    createVersion: (label = "1.0") => versions.createVersion(supplier, "project-1", { versionLabel: label, nature: "SISTEMAS" }),
    deliver: (input: Parameters<typeof deliver>[4] = {}) => deliver(supplier, "project-1", phase.id, milestone.id, input),
    approveMilestone: () => review(pmo, "project-1", phase.id, milestone.id, { decision: "APROVADO" }),
    rejectMilestone: () =>
      review(pmo, "project-1", phase.id, milestone.id, { decision: "REJEITADO", note: "O sistema não atende aos requisitos.", nonconformities: "Falhas.", adjustments: "Corrigir." }),
    authorize: () => authorize(pmo, "project-1", phase.id, milestone.id, { justification: "Comitê autorizou nova tentativa." }),
    rounds: async () => (await list(pmo, "project-1", phase.id, milestone.id)).data,
    /** Envia e aprova todos os documentos obrigatórios da versão (validação pelo responsável técnico do marco). */
    completeRequired: async (versionId: string) => {
      const version = await versions.getVersion(pmo, "project-1", versionId);
      for (const item of version.items.filter((entry) => entry.required)) {
        await items.assignValidator(owner, "project-1", versionId, item.id, { validatorId: "tec-1" });
        await items.submitItem(supplier, "project-1", versionId, item.id, link);
        await items.approveItem(tech, "project-1", versionId, item.id, {});
      }
    },
  };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

describe("homologação do marco final bloqueada pela conformidade documental", () => {
  it("bloqueia enquanto houver documento obrigatório pendente e libera quando todos estão aprovados", async () => {
    const ctx = await setup();
    const version = await ctx.createVersion("1.0");
    await ctx.deliver();

    await assert.rejects(() => ctx.approveMilestone(), code("DELIVERY_NOT_CONFORMING"));
    assert.equal(ctx.store.milestones[0].status, "ENTREGUE", "a recusa não altera o marco");
    assert.equal((await ctx.rounds())[0].status, "EM_ANALISE", "nem a rodada em análise");

    await ctx.completeRequired(version.id);
    const homologated = await ctx.approveMilestone();
    assert.equal(homologated.status, "APROVADO");
    const [round] = await ctx.rounds();
    assert.equal(round.status, "ACEITA");
    assert.equal(round.deliveryVersionId, version.id);
  });

  it("documento rejeitado ou enviado sem validação também bloqueia; a dispensa do PMO desbloqueia", async () => {
    const ctx = await setup();
    const version = await ctx.createVersion("1.0");
    const [escopo, plano, docs] = version.items.filter((item) => item.required);
    await ctx.deliver();

    await ctx.items.submitItem(supplier, "project-1", version.id, escopo.id, link);
    await ctx.items.approveItem(tech, "project-1", version.id, escopo.id, {});
    await ctx.items.submitItem(supplier, "project-1", version.id, plano.id, link);
    await assert.rejects(() => ctx.approveMilestone(), code("DELIVERY_NOT_CONFORMING"));

    await ctx.items.rejectItem(tech, "project-1", version.id, plano.id, { note: "Plano sem os cenários essenciais." });
    await assert.rejects(() => ctx.approveMilestone(), code("DELIVERY_NOT_CONFORMING"));

    await ctx.items.waiveItem(pmo, "project-1", version.id, plano.id, { note: "Plano substituído por evidência de testes em produção." });
    await ctx.items.waiveItem(pmo, "project-1", version.id, docs.id, { note: "Documentação será entregue na próxima versão." });
    assert.equal((await ctx.approveMilestone()).status, "APROVADO", "obrigatórios aprovados ou dispensados; o opcional pendente não bloqueia");
  });

  it("a mensagem do bloqueio informa a versão e os documentos pendentes", async () => {
    const ctx = await setup();
    await ctx.createVersion("1.0");
    await ctx.deliver();
    await assert.rejects(
      () => ctx.approveMilestone(),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 409 &&
        /versão 1\.0/.test(error.message) &&
        /Escopo e critérios de aceite \(pendente\)/.test(error.message),
    );
  });

  it("sem nenhuma versão registrada em projeto com fornecedor, a homologação fica bloqueada", async () => {
    const ctx = await setup();
    await ctx.deliver();
    await assert.rejects(() => ctx.approveMilestone(), code("DELIVERY_VERSION_REQUIRED"));
  });

  it("somente o aceite é bloqueado: rejeição e correções seguem permitidas, e o reenvio não cria versão nova", async () => {
    const ctx = await setup();
    const version = await ctx.createVersion("1.0");
    await ctx.deliver();
    const rejected = await ctx.rejectMilestone();
    assert.equal(rejected.status, "REJEITADO");

    await ctx.authorize();
    await ctx.deliver();
    const rounds = await ctx.rounds();
    assert.deepEqual(rounds.map((round) => [round.round, round.status, round.deliveryVersionId]), [
      [1, "REJEITADA", version.id],
      [2, "EM_ANALISE", version.id],
    ]);
    const listed = await ctx.versions.listVersions(pmo, "project-1");
    assert.equal(listed.data.length, 1, "continua uma única versão");
    assert.equal(listed.data[0].rounds, 2, "com duas rodadas de avaliação");
  });

  it("a rodada avalia a versão informada; nova versão evolutiva é avaliada por rodadas próprias", async () => {
    const ctx = await setup();
    const first = await ctx.createVersion("1.0");
    await ctx.completeRequired(first.id);
    const second = await ctx.createVersion("1.1");
    await ctx.deliver({ deliveryVersionId: first.id });
    assert.equal((await ctx.approveMilestone()).status, "APROVADO", "a rodada avaliou a 1.0, que está conforme");
    assert.notEqual(second.id, first.id);

    const outro = await ctx.versions.createVersion(supplier, "project-2", { versionLabel: "9.0", nature: "SISTEMAS" });
    const fresh = await setup();
    await assert.rejects(() => fresh.deliver({ deliveryVersionId: outro.id }), code("DELIVERY_VERSION_NOT_FOUND"));
  });

  it("sem versão informada, a rodada de homologação usa a versão mais recente do projeto", async () => {
    const ctx = await setup();
    const first = await ctx.createVersion("1.0");
    await ctx.completeRequired(first.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const latest = await ctx.createVersion("2.0");
    await ctx.deliver();
    assert.equal((await ctx.rounds())[0].deliveryVersionId, latest.id);
    await assert.rejects(() => ctx.approveMilestone(), code("DELIVERY_NOT_CONFORMING"), "a 2.0 ainda não está conforme");
  });

  it("não há bloqueio genérico: marcos de entrega e de aprovação, projeto sem fornecedor e rodadas de legado seguem como antes", async () => {
    const delivery = await setup({ milestoneType: "ENTREGA" });
    await delivery.deliver();
    assert.equal((await delivery.approveMilestone()).status, "APROVADO");

    const approval = await setup({ milestoneType: "APROVACAO" });
    assert.equal((await approval.approveMilestone()).status, "APROVADO");

    const noSupplier = await setup({ supplier: false });
    await noSupplier.store.milestones[0] && Object.assign(noSupplier.store.milestones[0], { status: "ENTREGUE", deliveredBy: "owner-1" });
    assert.equal((await noSupplier.approveMilestone()).status, "APROVADO");

    const legacy = await setup();
    Object.assign(legacy.store.milestones[0], { status: "ENTREGUE", deliveredBy: "forn-1" });
    assert.equal((await legacy.approveMilestone()).status, "APROVADO", "entrega anterior ao controle de rodadas não é bloqueada");
    assert.equal((await legacy.rounds())[0].legacy, true);
  });
});

describe("encerramento do projeto com fornecedor exige versões conformes", () => {
  async function closing() {
    const ctx = await setup({ milestoneType: "APROVACAO" });
    const deps = ctx.deps;
    const task = await makeCreateTaskUseCase(deps)(pmo, "project-1", ctx.phase.id, {
      title: "Tarefa",
      assigneeId: "forn-1",
      plannedStartAt: day("2026-06-01"),
      plannedEndAt: day("2026-06-30"),
    });
    await makeUpdateTaskProgressUseCase(deps)(supplier, "project-1", ctx.phase.id, task.id, {
      progressPercent: 100,
      actualStartAt: day("2026-06-02"),
      actualEndAt: day("2026-06-20"),
    });
    await ctx.approveMilestone();
    return { ...ctx, close: () => makeCloseProjectUseCase(deps)(owner, "project-1") };
  }

  it("com versão não conforme registrada, o encerramento é recusado e o projeto não muda", async () => {
    const ctx = await closing();
    await ctx.createVersion("1.0");
    await assert.rejects(
      () => ctx.close(),
      (error: unknown) => error instanceof HttpError && error.code === "PROJECT_DELIVERY_NOT_CONFORMING" && /1\.0/.test(error.message),
    );
    assert.notEqual(ctx.store.projects.find((row) => row.id === "project-1")?.status, "CONCLUIDO");
  });

  it("todas as versões conformes permitem encerrar; basta uma versão não conforme para recusar", async () => {
    const ctx = await closing();
    const first = await ctx.createVersion("1.0");
    await ctx.completeRequired(first.id);
    await ctx.createVersion("1.1");
    await assert.rejects(() => ctx.close(), code("PROJECT_DELIVERY_NOT_CONFORMING"));

    const second = (await ctx.versions.listVersions(pmo, "project-1")).data.find((version) => version.versionLabel === "1.1");
    await ctx.completeRequired(second?.id as string);
    assert.equal((await ctx.close()).status, "CONCLUIDO");
  });

  it("sem versões registradas o encerramento segue as regras anteriores; versão semeada como conforme também libera", async () => {
    const none = await closing();
    assert.equal((await none.close()).status, "CONCLUIDO");

    const seeded = await closing();
    seedConformingVersion(seeded.store.deliveryCompliance, "project-1");
    assert.equal((await seeded.close()).status, "CONCLUIDO");
  });
});

void ({} as Ctx);
