import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { createDeliveryVersionBodySchema } from "../schemas/eap-delivery-compliance.schema";
import { createEapInMemoryStore, makeEapInMemoryRepos, makeEapInMemoryTransactionRunner, makeMember, makeProject, makeUser } from "../test/in-memory";
import { makeDeliveryChecklistTemplateUseCases } from "./delivery-checklist-templates";
import { makeDeliveryVersionUseCases } from "./delivery-versions";

const actor = (role: AuthUser["role"], id: string): AuthUser => ({ id, name: id, email: `${id}@igepps.test`, role });
const owner = actor("GESTOR", "dono-1");
const manager = actor("GESTOR", "gestor-1");
const supplier = actor("FORNECEDOR", "forn-1");
const po = actor("COLABORADOR", "po-1");
const dev = actor("COLABORADOR", "dev-1");
const tech = actor("COLABORADOR", "tec-1");
const observer = actor("COLABORADOR", "obs-1");
const pmo = actor("PMO", "pmo-1");
const admin = actor("ADMIN", "admin-1");
const coordinator = actor("COORDENADOR", "coord-1");
const outsider = actor("GESTOR", "fora-1");

function setup(options: { supplier?: boolean; closed?: boolean } = {}) {
  const hasSupplier = options.supplier !== false;
  const store = createEapInMemoryStore({
    users: ["dono-1", "gestor-1", "forn-1", "po-1", "dev-1", "tec-1", "obs-1", "pmo-1", "admin-1", "coord-1", "fora-1"].map((id) =>
      makeUser({ id, name: `Pessoa ${id}`, role: id.startsWith("pmo") ? "PMO" : id.startsWith("admin") ? "ADMIN" : id.startsWith("coord") ? "COORDENADOR" : id.startsWith("forn") ? "FORNECEDOR" : id.startsWith("gestor") || id.startsWith("dono") || id.startsWith("fora") ? "GESTOR" : "COLABORADOR" }),
    ),
    projects: [
      makeProject({ id: "project-1", name: "Portal", ownerId: "dono-1", ...(options.closed ? { status: "CONCLUIDO" as const } : {}) }),
      makeProject({ id: "project-2", name: "Outro", ownerId: "dono-1" }),
    ],
    members: [
      makeMember({ id: "m1", projectId: "project-1", userId: "gestor-1", role: "GESTOR" }),
      ...(hasSupplier ? [makeMember({ id: "m2", projectId: "project-1", userId: "forn-1", role: "FORNECEDOR" })] : []),
      makeMember({ id: "m3", projectId: "project-1", userId: "po-1", role: "PO" }),
      makeMember({ id: "m4", projectId: "project-1", userId: "dev-1", role: "DESENVOLVEDOR" }),
      makeMember({ id: "m5", projectId: "project-1", userId: "tec-1", role: "RESPONSAVEL_TECNICO" }),
      makeMember({ id: "m6", projectId: "project-1", userId: "obs-1", role: "OBSERVADOR" }),
      makeMember({ id: "m7", projectId: "project-2", userId: "forn-1", role: "FORNECEDOR" }),
    ],
  });
  const repos = makeEapInMemoryRepos(store);
  const deps = { repos, runInTransaction: makeEapInMemoryTransactionRunner(repos, store) };
  return { store, versions: makeDeliveryVersionUseCases(deps), templates: makeDeliveryChecklistTemplateUseCases(deps) };
}

const code = (value: string) => (error: unknown) => error instanceof HttpError && error.code === value;
const body = (versionLabel = "1.0", nature: "SISTEMAS" | "INFRAESTRUTURA" | "PROCESSOS" = "SISTEMAS") => ({ versionLabel, nature });

describe("versões de entrega", () => {
  it("a primeira entrega já tem versão identificável e recebe uma cópia dos itens do modelo publicado", async () => {
    const { versions, store } = setup();
    const version = await versions.createVersion(manager, "project-1", { ...body("1.0"), notes: "Primeira entrega." });

    assert.equal(version.versionLabel, "1.0");
    assert.equal(version.nature, "SISTEMAS");
    assert.equal(version.templateRevision, 1);
    assert.equal(version.templateIsProposal, false);
    assert.equal(version.rounds, 0);
    assert.deepEqual(version.createdBy, { id: "gestor-1", name: "Pessoa gestor-1" });
    assert.equal(version.items.length, 4);
    assert.ok(version.items.every((item) => item.status === "PENDENTE" && item.evidenceRef === null && item.submittedBy === null));
    assert.deepEqual(version.items.map((item) => [item.documentType, item.required]), [
      ["ESCOPO_CRITERIOS", true],
      ["PLANO_TESTES", true],
      ["DOCUMENTACAO", true],
      ["INTEGRACOES_DEPENDENCIAS", false],
    ]);
    assert.equal(version.conformity.conforming, false);
    assert.equal(version.conformity.required, 3);
    assert.equal(version.conformity.blockingItems.length, 3);

    const audit = store.auditLogs.find((row) => row.entityType === "DELIVERY_VERSION");
    assert.equal(audit?.action, "CREATE");
    assert.equal(audit?.entityId, version.id);
    assert.equal(audit?.actorId, "gestor-1");
  });

  it("evolutiva gera outra versão (1.0, 1.1, 2.0); o rótulo é único por projeto e pode se repetir em outro projeto", async () => {
    const { versions } = setup();
    await versions.createVersion(manager, "project-1", body("1.0"));
    await versions.createVersion(manager, "project-1", body("1.1"));
    await versions.createVersion(supplier, "project-1", body("2.0"));
    await assert.rejects(() => versions.createVersion(manager, "project-1", body("1.0")), code("DELIVERY_VERSION_LABEL_EXISTS"));

    const listed = await versions.listVersions(manager, "project-1");
    assert.deepEqual(listed.data.map((version) => version.versionLabel).sort(), ["1.0", "1.1", "2.0"]);
    assert.deepEqual(listed.summary, { versions: 3, conforming: 0, nonConforming: 3, hasSupplier: true });

    const other = await versions.createVersion(supplier, "project-2", body("1.0"));
    assert.equal(other.versionLabel, "1.0");
  });

  it("formato do rótulo: 1.0, 1.1, 2.0 e 1.2.3 valem; texto livre não", () => {
    for (const label of ["1.0", "1.1", "2.0", "10", "1.2.3"]) {
      assert.equal(createDeliveryVersionBodySchema.safeParse({ versionLabel: label, nature: "SISTEMAS" }).success, true, label);
    }
    for (const label of ["v1", "1.", ".1", "1.0-beta", "um", "1.2.3.4", ""]) {
      assert.equal(createDeliveryVersionBodySchema.safeParse({ versionLabel: label, nature: "SISTEMAS" }).success, false, label);
    }
    assert.equal(createDeliveryVersionBodySchema.safeParse({ versionLabel: "1.0", nature: "OUTRA" }).success, false);
  });

  it("dono, gestor, fornecedor, PO, desenvolvedor e responsável técnico registram versões; ADMIN, PMO, coordenação, observador e quem não é do projeto, não", async () => {
    const { versions } = setup();
    const allowed = [owner, manager, supplier, po, dev, tech];
    for (const [index, person] of allowed.entries()) {
      const created = await versions.createVersion(person, "project-1", body(`1.${index}`));
      assert.equal(created.createdBy?.id, person.id);
    }
    for (const person of [admin, pmo, coordinator, observer]) {
      await assert.rejects(() => versions.createVersion(person, "project-1", body("9.9")), code("DELIVERY_VERSION_FORBIDDEN"), person.id);
    }
    await assert.rejects(() => versions.createVersion(outsider, "project-1", body("9.9")), code("PROJECT_FORBIDDEN"));
  });

  it("quem vê o projeto consulta as versões, inclusive PMO e coordenação", async () => {
    const { versions } = setup();
    const created = await versions.createVersion(manager, "project-1", body("1.0"));
    for (const person of [pmo, admin, coordinator, observer, supplier]) {
      assert.equal((await versions.listVersions(person, "project-1")).data.length, 1, person.id);
      assert.equal((await versions.getVersion(person, "project-1", created.id)).versionLabel, "1.0");
    }
    await assert.rejects(() => versions.listVersions(outsider, "project-1"), code("PROJECT_FORBIDDEN"));
    await assert.rejects(() => versions.getVersion(pmo, "project-2", created.id), code("DELIVERY_VERSION_NOT_FOUND"));
  });

  it("projeto sem fornecedor ou já encerrado não recebe versões; a consulta informa que não se aplica", async () => {
    const without = setup({ supplier: false });
    await assert.rejects(() => without.versions.createVersion(manager, "project-1", body()), code("DELIVERY_PROJECT_WITHOUT_SUPPLIER"));
    assert.equal((await without.versions.listVersions(pmo, "project-1")).summary.hasSupplier, false);

    const closed = setup({ closed: true });
    await assert.rejects(() => closed.versions.createVersion(manager, "project-1", body()), code("DELIVERY_PROJECT_CLOSED"));
  });

  it("revisão publicada depois não altera retroativamente o checklist de uma versão existente", async () => {
    const { versions, templates } = setup();
    const first = await versions.createVersion(manager, "project-1", body("1.0"));
    const before = JSON.stringify(first.items);

    await templates.saveDraft(pmo, "SISTEMAS", {
      items: [
        { documentType: "ESCOPO_CRITERIOS", title: "Escopo e critérios de aceite", required: true },
        { documentType: "NOVO_DOCUMENTO", title: "Documento novo obrigatório", required: true },
      ],
    });
    await templates.publishDraft(pmo, "SISTEMAS");

    const reread = await versions.getVersion(pmo, "project-1", first.id);
    assert.equal(JSON.stringify(reread.items), before, "a versão 1.0 mantém os itens de quando foi criada");
    assert.equal(reread.templateRevision, 1);

    const second = await versions.createVersion(manager, "project-1", body("1.1"));
    assert.equal(second.templateRevision, 2, "a versão nova já usa a revisão publicada mais recente");
    assert.deepEqual(second.items.map((item) => item.documentType), ["ESCOPO_CRITERIOS", "NOVO_DOCUMENTO"]);
  });

  it("uma versão pode ter várias rodadas de avaliação sem criar versão nova", async () => {
    const { versions, store } = setup();
    const created = await versions.createVersion(manager, "project-1", body("1.0"));
    store.deliveryCompliance.roundsByVersion[created.id] = 3;
    const listed = await versions.listVersions(manager, "project-1");
    assert.equal(listed.data.length, 1);
    assert.equal(listed.data[0].rounds, 3);
  });

  it("modelo de Infraestrutura (proposta) marca a versão como baseada em proposta", async () => {
    const { versions } = setup();
    const infra = await versions.createVersion(manager, "project-1", body("1.0", "INFRAESTRUTURA"));
    assert.equal(infra.nature, "INFRAESTRUTURA");
    assert.equal(infra.templateIsProposal, true);
  });
});
