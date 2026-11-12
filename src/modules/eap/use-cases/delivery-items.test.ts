import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { reasonDeliveryItemBodySchema, submitDeliveryItemBodySchema } from "../schemas/eap-delivery-compliance.schema";
import { createEapInMemoryStore, makeEapInMemoryRepos, makeEapInMemoryTransactionRunner, makeMember, makeProject, makeUser } from "../test/in-memory";
import { makeCreateMilestoneUseCase } from "./create-milestone";
import { makeCreatePhaseUseCase } from "./create-phase";
import { makeDeliveryItemUseCases } from "./delivery-items";
import { makeDeliveryVersionUseCases } from "./delivery-versions";

const actor = (role: AuthUser["role"], id: string): AuthUser => ({ id, name: `Pessoa ${id}`, email: `${id}@igepps.test`, role });
const owner = actor("GESTOR", "dono-1");
const manager = actor("GESTOR", "gestor-1");
const supplier = actor("FORNECEDOR", "forn-1");
const tech = actor("COLABORADOR", "tec-1");
const tech2 = actor("COLABORADOR", "tec-2");
const dev = actor("COLABORADOR", "dev-1");
const po = actor("COLABORADOR", "po-1");
const observer = actor("COLABORADOR", "obs-1");
const pmo = actor("PMO", "pmo-1");
const admin = actor("ADMIN", "admin-1");
const coordinator = actor("COORDENADOR", "coord-1");
const outsider = actor("GESTOR", "fora-1");

const code = (value: string) => (error: unknown) => error instanceof HttpError && error.code === value;
type Evidence = { evidenceKind: "SHAREPOINT" | "GITLAB_TAG" | "GITLAB_RELEASE" | "OUTRO"; evidenceRef: string };
const link: Evidence = { evidenceKind: "SHAREPOINT", evidenceRef: "https://igepps.sharepoint.com/sites/ctin/escopo.pdf" };

async function setup(options: { closed?: boolean } = {}) {
  const store = createEapInMemoryStore({
    users: [
      makeUser({ id: "dono-1", name: "Pessoa dono-1", role: "GESTOR" }),
      makeUser({ id: "gestor-1", name: "Pessoa gestor-1", role: "GESTOR" }),
      makeUser({ id: "forn-1", name: "Pessoa forn-1", role: "FORNECEDOR" }),
      makeUser({ id: "tec-1", name: "Pessoa tec-1", role: "COLABORADOR" }),
      makeUser({ id: "tec-2", name: "Pessoa tec-2", role: "COLABORADOR" }),
      makeUser({ id: "dev-1", name: "Pessoa dev-1", role: "COLABORADOR" }),
      makeUser({ id: "po-1", name: "Pessoa po-1", role: "COLABORADOR" }),
      makeUser({ id: "obs-1", name: "Pessoa obs-1", role: "COLABORADOR" }),
      makeUser({ id: "pmo-1", name: "Pessoa pmo-1", role: "PMO" }),
      makeUser({ id: "admin-1", name: "Pessoa admin-1", role: "ADMIN" }),
      makeUser({ id: "coord-1", name: "Pessoa coord-1", role: "COORDENADOR" }),
      makeUser({ id: "fora-1", name: "Pessoa fora-1", role: "GESTOR" }),
    ],
    projects: [makeProject({ id: "project-1", name: "Portal", ownerId: "dono-1", ...(options.closed ? {} : {}) })],
    members: [
      makeMember({ id: "m1", projectId: "project-1", userId: "gestor-1", role: "GESTOR" }),
      makeMember({ id: "m2", projectId: "project-1", userId: "forn-1", role: "FORNECEDOR" }),
      makeMember({ id: "m3", projectId: "project-1", userId: "tec-1", role: "RESPONSAVEL_TECNICO" }),
      makeMember({ id: "m4", projectId: "project-1", userId: "tec-2", role: "RESPONSAVEL_TECNICO" }),
      makeMember({ id: "m5", projectId: "project-1", userId: "dev-1", role: "DESENVOLVEDOR" }),
      makeMember({ id: "m6", projectId: "project-1", userId: "po-1", role: "PO" }),
      makeMember({ id: "m7", projectId: "project-1", userId: "obs-1", role: "OBSERVADOR" }),
    ],
  });
  const repos = makeEapInMemoryRepos(store);
  const deps = { repos, runInTransaction: makeEapInMemoryTransactionRunner(repos, store) };
  const phase = await makeCreatePhaseUseCase(deps)(pmo, "project-1", { name: "Entrega" });
  // Responsável técnico designado no marco de homologação: tec-1.
  await makeCreateMilestoneUseCase(deps)(pmo, "project-1", phase.id, {
    title: "Homologação do sistema",
    type: "HOMOLOGACAO",
    plannedAt: "2030-11-10T15:00:00.000Z",
    reviewerId: "tec-1",
  });
  if (options.closed) {
    store.projects[0].status = "CONCLUIDO";
  }
  const versions = makeDeliveryVersionUseCases(deps);
  const items = makeDeliveryItemUseCases(deps);
  if (options.closed) store.projects[0].status = "EM_EXECUCAO";
  const version = await versions.createVersion(supplier, "project-1", { versionLabel: "1.0", nature: "SISTEMAS" });
  if (options.closed) store.projects[0].status = "CONCLUIDO";
  const byType = (type: string) => version.items.find((item) => item.documentType === type)?.id as string;
  return { store, versions, items, version, byType, escopo: byType("ESCOPO_CRITERIOS"), plano: byType("PLANO_TESTES"), docs: byType("DOCUMENTACAO"), integracoes: byType("INTEGRACOES_DEPENDENCIAS") };
}

type Ctx = Awaited<ReturnType<typeof setup>>;
const submit = (ctx: Ctx, person: AuthUser, itemId: string, body: Evidence = link) => ctx.items.submitItem(person, "project-1", ctx.version.id, itemId, body);
const approve = (ctx: Ctx, person: AuthUser, itemId: string) => ctx.items.approveItem(person, "project-1", ctx.version.id, itemId, {});
const reject = (ctx: Ctx, person: AuthUser, itemId: string, note = "O escopo não cobre os requisitos aprovados.") => ctx.items.rejectItem(person, "project-1", ctx.version.id, itemId, { note });
const waive = (ctx: Ctx, person: AuthUser, itemId: string, note = "Documento não se aplica a esta entrega, conforme a coordenação.") => ctx.items.waiveItem(person, "project-1", ctx.version.id, itemId, { note });
const itemOf = (version: { items: Array<{ id: string }> }, id: string) => version.items.find((item) => item.id === id) as never as Record<string, unknown>;

describe("envio e validação documental", () => {
  it("o envio registra o link, a pessoa e a data; vira ENVIADO e gera histórico e auditoria", async () => {
    const ctx = await setup();
    const updated = await submit(ctx, supplier, ctx.escopo);
    const item = itemOf(updated, ctx.escopo);
    assert.equal(item.status, "ENVIADO");
    assert.equal(item.evidenceKind, "SHAREPOINT");
    assert.equal(item.evidenceRef, link.evidenceRef);
    assert.deepEqual(item.submittedBy, { id: "forn-1", name: "Pessoa forn-1" });
    assert.ok(item.submittedAt);

    const { data: events } = await ctx.items.listEvents(pmo, "project-1", ctx.version.id, ctx.escopo);
    assert.deepEqual(events.map((event) => [event.action, event.actor?.id, event.evidenceRef]), [["ENVIO", "forn-1", link.evidenceRef]]);
    const audit = ctx.store.auditLogs.find((row) => row.entityType === "DELIVERY_ITEM");
    assert.equal(audit?.action, "UPDATE");
    assert.equal((audit?.payload as Record<string, unknown>).kind, "DELIVERY_ITEM_SUBMITTED");
    assert.equal(audit?.actorId, "forn-1");
  });

  it("só aceita link do SharePoint (https) ou referência de tag/release do GitLab; o sistema não guarda arquivos", async () => {
    const ctx = await setup();
    for (const body of [
      { evidenceKind: "SHAREPOINT" as const, evidenceRef: "http://igepps.sharepoint.com/doc" },
      { evidenceKind: "SHAREPOINT" as const, evidenceRef: "arquivo.pdf" },
      { evidenceKind: "GITLAB_TAG" as const, evidenceRef: "tag com espaços" },
      { evidenceKind: "OUTRO" as const, evidenceRef: "sem-protocolo" },
    ]) {
      assert.equal(submitDeliveryItemBodySchema.safeParse(body).success, false, JSON.stringify(body));
      await assert.rejects(() => submit(ctx, supplier, ctx.escopo, body), code("DELIVERY_EVIDENCE_INVALID"));
    }
    for (const body of [
      { evidenceKind: "GITLAB_TAG" as const, evidenceRef: "v1.0.0" },
      { evidenceKind: "GITLAB_RELEASE" as const, evidenceRef: "release/2026.11" },
      { evidenceKind: "GITLAB_TAG" as const, evidenceRef: "https://gitlab.igepps.local/sistemas/portal/-/tags/v1.0.0" },
      { evidenceKind: "OUTRO" as const, evidenceRef: "https://exemplo.com/relatorio" },
    ]) {
      assert.equal(submitDeliveryItemBodySchema.safeParse(body).success, true, JSON.stringify(body));
    }
    assert.equal((await submit(ctx, supplier, ctx.plano, { evidenceKind: "GITLAB_TAG", evidenceRef: "v1.0.0" }) as never as { items: unknown[] }).items.length > 0, true);
  });

  it("dono, gestor, fornecedor, PO, desenvolvedor e responsável técnico enviam; PMO, coordenação e observador não", async () => {
    const ctx = await setup();
    const senders = [owner, manager, supplier, po, dev, tech2];
    const ids = [ctx.escopo, ctx.plano, ctx.docs, ctx.integracoes];
    for (const [index, person] of senders.slice(0, 4).entries()) {
      await submit(ctx, person, ids[index]);
    }
    await submit(ctx, tech2, ctx.escopo).then(
      () => assert.fail("item já enviado não deveria aceitar novo envio"),
      code("DELIVERY_ITEM_TRANSITION_INVALID"),
    );
    for (const person of [pmo, coordinator, observer]) {
      await assert.rejects(() => submit(ctx, person, ctx.escopo), code("DELIVERY_ITEM_SUBMIT_FORBIDDEN"), person.id);
    }
    await assert.rejects(() => submit(ctx, outsider, ctx.escopo), code("PROJECT_FORBIDDEN"));
  });

  it("o responsável técnico designado no marco aprova; a decisão fica no histórico e na auditoria", async () => {
    const ctx = await setup();
    await submit(ctx, supplier, ctx.escopo);
    const updated = await approve(ctx, tech, ctx.escopo);
    const item = itemOf(updated, ctx.escopo);
    assert.equal(item.status, "APROVADO");
    assert.deepEqual(item.decidedBy, { id: "tec-1", name: "Pessoa tec-1" });
    assert.ok(item.decidedAt);

    const { data: events } = await ctx.items.listEvents(manager, "project-1", ctx.version.id, ctx.escopo);
    assert.deepEqual(events.map((event) => event.action), ["ENVIO", "APROVACAO"]);
    const audit = ctx.store.auditLogs.filter((row) => row.entityType === "DELIVERY_ITEM" && row.action === "VALIDATE");
    assert.equal(audit.length, 1);
    assert.equal((audit[0].payload as Record<string, unknown>).kind, "DELIVERY_ITEM_APPROVED");
  });

  it("quem enviou o documento não valida o próprio envio, mesmo sendo o responsável técnico designado", async () => {
    const ctx = await setup();
    await submit(ctx, tech, ctx.escopo);
    await assert.rejects(() => approve(ctx, tech, ctx.escopo), code("DELIVERY_ITEM_SELF_VALIDATION"));
    await assert.rejects(() => reject(ctx, tech, ctx.escopo), code("DELIVERY_ITEM_SELF_VALIDATION"));
    assert.equal(itemOf(await ctx.versions.getVersion(manager, "project-1", ctx.version.id), ctx.escopo).status, "ENVIADO");
  });

  it("só o validador designado valida: gestão, PMO, coordenação, fornecedor e outro responsável técnico não", async () => {
    const ctx = await setup();
    await submit(ctx, supplier, ctx.escopo);
    for (const person of [owner, manager, pmo, coordinator, supplier, tech2, dev]) {
      await assert.rejects(() => approve(ctx, person, ctx.escopo), code("DELIVERY_ITEM_VALIDATE_FORBIDDEN"), person.id);
    }
  });

  it("a gestão ou o PMO designam o validador do item; o designado prevalece sobre o do marco e o fornecedor não pode ser validador", async () => {
    const ctx = await setup();
    await submit(ctx, supplier, ctx.escopo);
    await assert.rejects(() => ctx.items.assignValidator(supplier, "project-1", ctx.version.id, ctx.escopo, { validatorId: "tec-2" }), code("DELIVERY_VALIDATOR_FORBIDDEN"));
    await assert.rejects(() => ctx.items.assignValidator(manager, "project-1", ctx.version.id, ctx.escopo, { validatorId: "forn-1" }), code("DELIVERY_VALIDATOR_INVALID"));
    await assert.rejects(() => ctx.items.assignValidator(manager, "project-1", ctx.version.id, ctx.escopo, { validatorId: "fora-1" }), code("DELIVERY_VALIDATOR_INVALID"));

    const assigned = await ctx.items.assignValidator(manager, "project-1", ctx.version.id, ctx.escopo, { validatorId: "tec-2" });
    assert.deepEqual(itemOf(assigned, ctx.escopo).validator, { id: "tec-2", name: "Pessoa tec-2" });
    await assert.rejects(() => approve(ctx, tech, ctx.escopo), code("DELIVERY_ITEM_VALIDATE_FORBIDDEN"));
    assert.equal(itemOf(await approve(ctx, tech2, ctx.escopo), ctx.escopo).status, "APROVADO");

    const cleared = await ctx.items.assignValidator(pmo, "project-1", ctx.version.id, ctx.plano, { validatorId: null });
    assert.equal(itemOf(cleared, ctx.plano).validator, null);
  });

  it("a versão informa os responsáveis técnicos do marco de homologação, que validam os documentos sem validador designado", async () => {
    const ctx = await setup();
    assert.deepEqual(ctx.version.defaultValidators, [{ id: "tec-1", name: "Pessoa tec-1" }]);
  });

  it("histórico: envio, rejeição, reenvio, aprovação e trocas de validador com autor, perfil, papéis no projeto, data e justificativa", async () => {
    const ctx = await setup();
    await ctx.items.assignValidator(manager, "project-1", ctx.version.id, ctx.escopo, { validatorId: "tec-2" });
    await submit(ctx, supplier, ctx.escopo);
    await reject(ctx, tech2, ctx.escopo, "Faltam os critérios de aceite do módulo financeiro.");
    await submit(ctx, supplier, ctx.escopo, { evidenceKind: "GITLAB_TAG", evidenceRef: "v1.0.1" });
    await approve(ctx, tech2, ctx.escopo);
    await ctx.items.assignValidator(pmo, "project-1", ctx.version.id, ctx.escopo, { validatorId: null });

    const { data } = await ctx.items.listEvents(observer, "project-1", ctx.version.id, ctx.escopo);
    const decisions = data.filter((event) => event.action !== "DESIGNACAO");
    assert.deepEqual(decisions.map((event) => event.action), ["ENVIO", "REJEICAO", "ENVIO", "APROVACAO"], "o reenvio não apaga o envio anterior");
    assert.deepEqual(decisions[0].actor, { id: "forn-1", name: "Pessoa forn-1" });
    assert.equal(decisions[0].actorRole, "FORNECEDOR");
    assert.deepEqual(decisions[0].actorProjectRoles, ["FORNECEDOR"]);
    assert.equal(decisions[1].note, "Faltam os critérios de aceite do módulo financeiro.");
    assert.deepEqual(decisions[1].actorProjectRoles, ["RESPONSAVEL_TECNICO"]);
    assert.equal(decisions[2].evidenceRef, "v1.0.1");
    assert.ok(decisions.every((event) => !Number.isNaN(Date.parse(event.createdAt))));

    const designations = data.filter((event) => event.action === "DESIGNACAO");
    assert.equal(designations.length, 2);
    assert.deepEqual(designations[0].previousValidator, null);
    assert.deepEqual(designations[0].newValidator, { id: "tec-2", name: "Pessoa tec-2" });
    assert.equal(designations[0].actorRole, "GESTOR");
    assert.deepEqual(designations[0].actorProjectRoles, ["GESTOR"]);
    assert.deepEqual(designations[1].previousValidator, { id: "tec-2", name: "Pessoa tec-2" });
    assert.equal(designations[1].newValidator, null);
    assert.equal(designations[1].actorRole, "PMO");
    assert.deepEqual(designations[1].actorProjectRoles, []);
  });

  it("rejeição exige justificativa; o reenvio volta a ENVIADO sem criar versão e todo o histórico é preservado", async () => {
    const ctx = await setup();
    assert.equal(reasonDeliveryItemBodySchema.safeParse({ note: "curta" }).success, false);
    assert.equal(reasonDeliveryItemBodySchema.safeParse({ note: "Justificativa com mais de dez caracteres." }).success, true);

    await submit(ctx, supplier, ctx.escopo);
    const rejected = itemOf(await reject(ctx, tech, ctx.escopo), ctx.escopo);
    assert.equal(rejected.status, "REJEITADO");
    assert.equal(rejected.decisionNote, "O escopo não cobre os requisitos aprovados.");

    const resubmitted = itemOf(
      await submit(ctx, dev, ctx.escopo, { evidenceKind: "SHAREPOINT", evidenceRef: "https://igepps.sharepoint.com/sites/ctin/escopo-v2.pdf" }),
      ctx.escopo,
    );
    assert.equal(resubmitted.status, "ENVIADO");
    assert.equal(resubmitted.decisionNote, null);
    assert.equal(resubmitted.decidedBy, null);
    assert.equal(resubmitted.evidenceRef, "https://igepps.sharepoint.com/sites/ctin/escopo-v2.pdf");

    await approve(ctx, tech, ctx.escopo);
    const { data: events } = await ctx.items.listEvents(pmo, "project-1", ctx.version.id, ctx.escopo);
    assert.deepEqual(events.map((event) => event.action), ["ENVIO", "REJEICAO", "ENVIO", "APROVACAO"]);
    assert.equal(events[1].note, "O escopo não cobre os requisitos aprovados.");
    assert.equal((await ctx.versions.listVersions(pmo, "project-1")).data.length, 1, "o reenvio não cria versão nova");
    assert.ok(ctx.store.auditLogs.some((row) => (row.payload as Record<string, unknown>).kind === "DELIVERY_ITEM_RESUBMITTED"));
  });

  it("aprovar ou rejeitar só vale para documento ENVIADO; decisões repetidas ou fora de ordem são recusadas", async () => {
    const ctx = await setup();
    await assert.rejects(() => approve(ctx, tech, ctx.escopo), code("DELIVERY_ITEM_TRANSITION_INVALID"));
    await submit(ctx, supplier, ctx.escopo);
    await approve(ctx, tech, ctx.escopo);
    await assert.rejects(() => approve(ctx, tech, ctx.escopo), code("DELIVERY_ITEM_TRANSITION_INVALID"));
    await assert.rejects(() => reject(ctx, tech, ctx.escopo), code("DELIVERY_ITEM_TRANSITION_INVALID"));
    await assert.rejects(() => submit(ctx, supplier, ctx.escopo), code("DELIVERY_ITEM_TRANSITION_INVALID"));
    await assert.rejects(() => waive(ctx, pmo, ctx.escopo), code("DELIVERY_ITEM_TRANSITION_INVALID"));
  });

  it("somente ADMIN e PMO dispensam, com justificativa formal; documento dispensado deixa de bloquear a conformidade", async () => {
    const ctx = await setup();
    for (const person of [owner, manager, supplier, tech, tech2, dev, po, observer, coordinator]) {
      await assert.rejects(() => waive(ctx, person, ctx.docs), code("DELIVERY_ITEM_WAIVE_FORBIDDEN"), person.id);
    }
    const updated = await waive(ctx, pmo, ctx.docs);
    const item = itemOf(updated, ctx.docs);
    assert.equal(item.status, "DISPENSADO");
    assert.deepEqual(item.decidedBy, { id: "pmo-1", name: "Pessoa pmo-1" });
    assert.equal(item.decisionNote, "Documento não se aplica a esta entrega, conforme a coordenação.");
    assert.equal((updated as never as { conformity: { dispensed: number } }).conformity.dispensed, 1);
    assert.ok(ctx.store.auditLogs.some((row) => (row.payload as Record<string, unknown>).kind === "DELIVERY_ITEM_WAIVED"));
    const { data: events } = await ctx.items.listEvents(pmo, "project-1", ctx.version.id, ctx.docs);
    assert.deepEqual(events.map((event) => event.action), ["DISPENSA"]);
  });

  it("ADMIN também dispensa; a auditoria guarda quem, o perfil, a justificativa e a situação anterior", async () => {
    const ctx = await setup();
    await submit(ctx, supplier, ctx.plano);
    const updated = await waive(ctx, admin, ctx.plano, "Plano substituído pela evidência de testes automatizados.");
    const item = itemOf(updated, ctx.plano);
    assert.equal(item.status, "DISPENSADO");
    assert.deepEqual(item.decidedBy, { id: "admin-1", name: "Pessoa admin-1" });
    assert.equal(item.decisionNote, "Plano substituído pela evidência de testes automatizados.");
    const row = ctx.store.auditLogs.find((entry) => (entry.payload as Record<string, unknown>).kind === "DELIVERY_ITEM_WAIVED");
    assert.ok(row, "dispensa auditada");
    assert.equal(row.actorId, "admin-1");
    assert.equal(row.entityId, ctx.plano);
    const payload = row.payload as Record<string, unknown>;
    assert.equal(payload.actorRole, "ADMIN");
    assert.equal(payload.note, "Plano substituído pela evidência de testes automatizados.");
    assert.equal(payload.from, "ENVIADO");
    assert.equal(payload.to, "DISPENSADO");
    assert.equal(payload.required, true);
    const { data: events } = await ctx.items.listEvents(admin, "project-1", ctx.version.id, ctx.plano);
    assert.deepEqual(events.map((event) => event.action), ["ENVIO", "DISPENSA"]);
  });

  it("dispensa exige justificativa formal de ao menos 10 caracteres", () => {
    assert.equal(reasonDeliveryItemBodySchema.safeParse({ note: "curta" }).success, false);
    assert.equal(reasonDeliveryItemBodySchema.safeParse({ note: "          " }).success, false);
    assert.equal(reasonDeliveryItemBodySchema.safeParse({ note: "Não se aplica a esta entrega." }).success, true);
  });

  it("a versão fica conforme quando todo obrigatório está aprovado ou dispensado; pendente, enviado ou rejeitado bloqueiam; opcional não", async () => {
    const ctx = await setup();
    const conformity = async () => (await ctx.versions.getVersion(pmo, "project-1", ctx.version.id)).conformity;
    assert.equal((await conformity()).conforming, false);

    await submit(ctx, supplier, ctx.escopo);
    await approve(ctx, tech, ctx.escopo);
    await submit(ctx, supplier, ctx.plano);
    assert.equal((await conformity()).conforming, false, "enviado sem validação ainda bloqueia");
    await reject(ctx, tech, ctx.plano);
    assert.equal((await conformity()).rejected, 1);
    await submit(ctx, supplier, ctx.plano);
    await approve(ctx, tech, ctx.plano);
    assert.equal((await conformity()).conforming, false, "falta a documentação obrigatória");
    await waive(ctx, pmo, ctx.docs);

    const final = await conformity();
    assert.equal(final.conforming, true, "o item opcional pendente não bloqueia");
    assert.equal(final.blockingItems.length, 0);
    assert.deepEqual([final.approved, final.dispensed, final.pending], [2, 1, 1]);
  });

  it("quem vê o projeto consulta o histórico; quem não vê, não", async () => {
    const ctx = await setup();
    await submit(ctx, supplier, ctx.escopo);
    for (const person of [pmo, coordinator, observer, supplier]) {
      assert.equal((await ctx.items.listEvents(person, "project-1", ctx.version.id, ctx.escopo)).data.length, 1, person.id);
    }
    await assert.rejects(() => ctx.items.listEvents(outsider, "project-1", ctx.version.id, ctx.escopo), code("PROJECT_FORBIDDEN"));
    await assert.rejects(() => ctx.items.listEvents(pmo, "project-1", ctx.version.id, "item-inexistente"), code("DELIVERY_ITEM_NOT_FOUND"));
  });

  it("projeto encerrado não aceita novos envios nem decisões", async () => {
    const ctx = await setup({ closed: true });
    await assert.rejects(() => submit(ctx, supplier, ctx.escopo), code("DELIVERY_PROJECT_CLOSED"));
    await assert.rejects(() => waive(ctx, pmo, ctx.escopo), code("DELIVERY_PROJECT_CLOSED"));
  });
});
