import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { createEapInMemoryStore, makeEapInMemoryRepos, makeEapInMemoryTransactionRunner } from "../test/in-memory";
import { makeDeliveryChecklistTemplateUseCases } from "./delivery-checklist-templates";

const actor = (role: AuthUser["role"], id = role.toLowerCase()): AuthUser => ({ id, name: id, email: `${id}@igepps.test`, role });
const admin = actor("ADMIN");
const pmo = actor("PMO");

function setup() {
  const store = createEapInMemoryStore();
  const repos = makeEapInMemoryRepos(store);
  return { store, templates: makeDeliveryChecklistTemplateUseCases({ repos, runInTransaction: makeEapInMemoryTransactionRunner(repos, store) }) };
}

const forbidden = (error: unknown) => error instanceof HttpError && error.code === "DELIVERY_TEMPLATE_FORBIDDEN";
const items = [
  { documentType: "ESCOPO_CRITERIOS", title: "Escopo e critérios de aceite", required: true },
  { documentType: "PLANO_TESTES", title: "Plano de testes", required: true },
  { documentType: "MANUAL", title: "Manual de uso", required: false },
];

describe("modelos de checklist da Conformidade de Entrega", () => {
  it("há um modelo por natureza, com revisão publicada; Infraestrutura e Processos são propostas sujeitas à validação da CTIN", async () => {
    const { templates } = setup();
    const { data } = await templates.listTemplates(actor("GESTOR"));
    assert.deepEqual(data.map((template) => template.nature).sort(), ["INFRAESTRUTURA", "PROCESSOS", "SISTEMAS"]);
    for (const template of data) {
      assert.equal(template.published?.status, "PUBLICADA");
      assert.equal(template.draft, null);
      assert.ok((template.published?.items.length ?? 0) > 0);
    }
    const proposals = Object.fromEntries(data.map((template) => [template.nature, template.published?.isProposal]));
    assert.deepEqual(proposals, { SISTEMAS: false, INFRAESTRUTURA: true, PROCESSOS: true });
  });

  it("somente ADMIN e PMO criam rascunho e publicam; os demais perfis só consultam", async () => {
    const { templates } = setup();
    for (const role of ["GESTOR", "COORDENADOR", "FORNECEDOR", "COLABORADOR"] as const) {
      await assert.rejects(() => templates.saveDraft(actor(role), "SISTEMAS", { items, required: undefined } as never), forbidden, role);
      await assert.rejects(() => templates.publishDraft(actor(role), "SISTEMAS"), forbidden, role);
    }
    await templates.saveDraft(admin, "SISTEMAS", { items });
    await templates.saveDraft(pmo, "INFRAESTRUTURA", { items });
  });

  it("o rascunho só aparece para ADMIN e PMO; publicar cria a revisão seguinte sem alterar a anterior", async () => {
    const { templates, store } = setup();
    const before = JSON.stringify(store.deliveryCompliance.items.filter((item) => item.revisionId === "rev-sistemas-1"));

    const draft = await templates.saveDraft(pmo, "SISTEMAS", { items, notes: "Inclui manual de uso." });
    assert.equal(draft.status, "RASCUNHO");
    assert.equal(draft.revision, 2);
    assert.deepEqual(draft.items.map((item) => [item.position, item.documentType]), [[1, "ESCOPO_CRITERIOS"], [2, "PLANO_TESTES"], [3, "MANUAL"]]);

    const asManager = (await templates.listTemplates(actor("GESTOR"))).data.find((template) => template.nature === "SISTEMAS");
    assert.equal(asManager?.draft, null, "quem não gerencia não vê o rascunho");
    assert.equal(asManager?.published?.revision, 1, "a versão publicada ainda é a 1");
    const asPmo = (await templates.listTemplates(pmo)).data.find((template) => template.nature === "SISTEMAS");
    assert.equal(asPmo?.draft?.revision, 2);

    const published = await templates.publishDraft(pmo, "SISTEMAS");
    assert.equal(published.status, "PUBLICADA");
    assert.equal(published.revision, 2);
    assert.equal(published.publishedBy, "pmo");
    assert.notEqual(published.publishedAt, null);

    const after = (await templates.listTemplates(actor("GESTOR"))).data.find((template) => template.nature === "SISTEMAS");
    assert.equal(after?.published?.revision, 2);
    assert.equal(after?.draft, null);
    assert.equal(JSON.stringify(store.deliveryCompliance.items.filter((item) => item.revisionId === "rev-sistemas-1")), before, "a revisão 1 publicada não muda");
  });

  it("um segundo rascunho substitui o primeiro: nunca há dois rascunhos do mesmo modelo", async () => {
    const { templates, store } = setup();
    await templates.saveDraft(pmo, "PROCESSOS", { items });
    const second = await templates.saveDraft(admin, "PROCESSOS", { items: items.slice(0, 2), notes: "Versão reduzida." });
    assert.equal(second.items.length, 2);
    assert.equal(store.deliveryCompliance.revisions.filter((row) => row.nature === "PROCESSOS" && row.status === "RASCUNHO").length, 1);
    assert.equal(store.deliveryCompliance.items.filter((item) => item.revisionId === second.id).length, 2);
  });

  it("a marca de proposta é mantida até a CTIN validar expressamente", async () => {
    const { templates } = setup();
    const kept = await templates.saveDraft(pmo, "INFRAESTRUTURA", { items });
    assert.equal(kept.isProposal, true);
    const validated = await templates.saveDraft(pmo, "INFRAESTRUTURA", { items, ctinValidated: true });
    assert.equal(validated.isProposal, false);
    const stillValidated = await templates.saveDraft(pmo, "INFRAESTRUTURA", { items });
    assert.equal(stillValidated.isProposal, false, "o rascunho já validado não volta a proposta sozinho");
    const sistemas = await templates.saveDraft(pmo, "SISTEMAS", { items });
    assert.equal(sistemas.isProposal, false);
  });

  it("recusa tipo de documento repetido e publicação sem rascunho", async () => {
    const { templates } = setup();
    await assert.rejects(
      () => templates.saveDraft(pmo, "SISTEMAS", { items: [items[0], { ...items[1], documentType: items[0].documentType }] }),
      (error: unknown) => error instanceof HttpError && error.code === "DELIVERY_TEMPLATE_DUPLICATED_TYPE",
    );
    await assert.rejects(
      () => templates.publishDraft(pmo, "SISTEMAS"),
      (error: unknown) => error instanceof HttpError && error.statusCode === 409 && error.code === "DELIVERY_TEMPLATE_NO_DRAFT",
    );
  });
});
