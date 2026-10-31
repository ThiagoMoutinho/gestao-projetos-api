import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../lib/http-error";
import type { AuthUser } from "../../lib/session";
import {
  createInMemoryStore,
  makeInMemoryRepos,
  makeInMemoryTransactionRunner,
  makeUser,
  noPlan,
} from "../projects/test/in-memory";
import { makeUpdateProjectUseCase } from "../projects/use-cases/update-project";
import { parseGlpiBaseUrl } from "./dtos/institutional.dto";
import { decisionBodySchema } from "./schemas/institutional.schema";
import { makeDecideProfileFieldUseCase } from "./use-cases/decide-profile-field";
import { makeArchiveResultUseCase, makeDecideResultUseCase } from "./use-cases/decide-result";
import { makeGetProjectOverviewUseCase } from "./use-cases/get-project-overview";
import { makeRemoveHighlightUseCase, makeSetHighlightUseCase } from "./use-cases/highlights";
import { makeSaveProfileFieldUseCase } from "./use-cases/save-profile-field";
import { makeRegisterResultEvidenceUseCase } from "./use-cases/result-evidence";
import { makeCreateResultUseCase, makeUpdateResultUseCase } from "./use-cases/save-result";
import {
  createInstitutionalStore,
  makeInstitutionalTestRepos,
  makeInstitutionalTestRunner,
} from "./test/in-memory";

function actor(role: AuthUser["role"], id: string): AuthUser {
  return { id, name: id, email: `${id}@igepps.test`, role };
}

const pmo1 = actor("PMO", "pmo-1");
const pmo2 = actor("PMO", "pmo-2");
const manager = actor("GESTOR", "gestor-1");
const supplier = actor("FORNECEDOR", "forn-1");
const observer = actor("COLABORADOR", "obs-1");
const outsider = actor("COLABORADOR", "out-1");
const coordinator = actor("COORDENADOR", "coord-1");
const adminUser = actor("ADMIN", "admin-1");

const codeIs = (code: string) => (error: unknown) => error instanceof HttpError && error.code === code;
const milestone = (id: string, projectId: string, status: string) => ({
  milestoneId: id,
  projectId,
  title: `Marco ${id}`,
  phaseId: "fase-1",
  phaseName: "Fase 1",
  type: "ENTREGA",
  status,
  plannedAt: new Date("2026-06-01T15:00:00Z"),
  actualAt: status === "APROVADO" ? new Date("2026-06-02T15:00:00Z") : null,
  validatedAt: status === "APROVADO" ? new Date("2026-06-03T15:00:00Z") : null,
});

function setup(options: { glpiBaseUrl?: string | null } = {}) {
  const now = new Date();
  const projectStore = createInMemoryStore({
    users: [
      makeUser({ id: "pmo-1", role: "PMO", name: "PMO Um" }),
      makeUser({ id: "pmo-2", role: "PMO", name: "PMO Dois" }),
      makeUser({ id: "owner-1", role: "GESTOR", name: "Dono" }),
      makeUser({ id: "gestor-1", role: "GESTOR", name: "Gestor" }),
      makeUser({ id: "forn-1", role: "FORNECEDOR", name: "Fornecedor" }),
      makeUser({ id: "obs-1", role: "COLABORADOR", name: "Observador" }),
      makeUser({ id: "out-1", role: "COLABORADOR", name: "Sem vínculo" }),
      makeUser({ id: "coord-1", role: "COORDENADOR", name: "Coordenação CTIN" }),
      makeUser({ id: "admin-1", role: "ADMIN", name: "Administração" }),
    ],
    projects: [
      {
        id: "project-1",
        name: "Projeto",
        description: null,
        glpiTicketId: "999001",
        pmoGlpiTicketId: "555",
        ownerId: "owner-1",
        status: "EM_EXECUCAO",
        ...noPlan,
        createdAt: now,
        updatedAt: now,
      },
    ],
    members: [
      { id: "m-1", projectId: "project-1", userId: "gestor-1", role: "GESTOR", createdAt: now },
      { id: "m-2", projectId: "project-1", userId: "forn-1", role: "FORNECEDOR", createdAt: now },
      { id: "m-3", projectId: "project-1", userId: "obs-1", role: "OBSERVADOR", createdAt: now },
    ],
  });
  const store = createInstitutionalStore({
    milestones: [
      milestone("m-ok", "project-1", "APROVADO"),
      milestone("m-pend", "project-1", "PENDENTE"),
      milestone("m-other", "project-2", "APROVADO"),
    ],
    evidences: [{ id: "ev-1", projectId: "project-1", title: "Ata", url: "https://sharepoint.test/ata" }],
  });
  const repos = makeInstitutionalTestRepos(projectStore, store);
  const deps = { repos, runInTransaction: makeInstitutionalTestRunner(repos) };
  return {
    projectStore,
    store,
    saveProfile: makeSaveProfileFieldUseCase(deps),
    decideProfile: makeDecideProfileFieldUseCase(deps),
    createResult: makeCreateResultUseCase(deps),
    updateResult: makeUpdateResultUseCase(deps),
    decideResult: makeDecideResultUseCase(deps),
    archiveResult: makeArchiveResultUseCase(deps),
    setHighlight: makeSetHighlightUseCase(deps),
    removeHighlight: makeRemoveHighlightUseCase(deps),
    registerEvidence: makeRegisterResultEvidenceUseCase(deps),
    overview: makeGetProjectOverviewUseCase({ repos, glpiBaseUrl: options.glpiBaseUrl ?? null }),
  };
}

describe("Perfil institucional: permissões", () => {
  it("permite gestor e PMO editarem; fornecedor, observador e quem não tem vínculo não", async () => {
    const ctx = setup();
    await ctx.saveProfile(manager, "project-1", "PURPOSE", "Finalidade do gestor");
    await ctx.saveProfile(pmo1, "project-1", "SCOPE", "Escopo do PMO");

    await assert.rejects(() => ctx.saveProfile(supplier, "project-1", "PURPOSE", "x"), codeIs("INSTITUTIONAL_EDIT_FORBIDDEN"));
    await assert.rejects(() => ctx.saveProfile(observer, "project-1", "PURPOSE", "x"), codeIs("INSTITUTIONAL_EDIT_FORBIDDEN"));
    await assert.rejects(() => ctx.saveProfile(outsider, "project-1", "PURPOSE", "x"), codeIs("PROJECT_FORBIDDEN"));
  });

  it("só PMO ou administração validam; o gestor não", async () => {
    const ctx = setup();
    await ctx.saveProfile(manager, "project-1", "PURPOSE", "Texto");

    await assert.rejects(
      () => ctx.decideProfile(manager, "project-1", "PURPOSE", { decision: "VALIDATE" }),
      codeIs("INSTITUTIONAL_VALIDATE_FORBIDDEN"),
    );
  });

  it("não permite consultar a visão de projeto sem vínculo", async () => {
    const ctx = setup();
    await assert.rejects(() => ctx.overview(outsider, "project-1"), codeIs("PROJECT_FORBIDDEN"));
    await assert.rejects(() => ctx.overview(pmo1, "nao-existe"), codeIs("PROJECT_NOT_FOUND"));
  });
});

type TestCtx = ReturnType<typeof setup>;

/** Rascunho antigo (anterior à publicação direta): ainda pode existir no banco e aguardar validação do PMO. */
function seedLegacyDraft(
  ctx: TestCtx,
  field: "PURPOSE" | "SCOPE" | "PROBLEM",
  draft: { value: string; by: string },
  published?: { value: string; by: string; validator: string },
) {
  const at = new Date("2026-06-10T12:00:00Z");
  ctx.store.fields.push({
    id: `legacy-${field}`,
    projectId: "project-1",
    field,
    publishedValue: published?.value ?? null,
    publishedBy: published?.by ?? null,
    publishedAt: published ? at : null,
    validatedBy: published?.validator ?? null,
    validatedAt: published ? at : null,
    draftValue: draft.value,
    draftBy: draft.by,
    draftAt: at,
  });
}

describe("Perfil institucional: Sobre o projeto sem aprovação", () => {
  it("publica na hora qualquer campo de Sobre o projeto, sem rascunho e sem validador", async () => {
    const ctx = setup();
    for (const field of ["PURPOSE", "SCOPE", "PROBLEM", "REQUESTING_AREA", "RESPONSIBLE_COMPANY", "BENEFITED_SECTORS", "SYSTEM_DESCRIPTION", "RESULTS_SUMMARY"] as const) {
      const saved = await ctx.saveProfile(manager, "project-1", field, `Texto de ${field}`);
      assert.equal(saved.status, "VALIDATED", field);
      assert.equal(saved.draft, null, field);
      assert.equal(saved.published?.value, `Texto de ${field}`, field);
      assert.equal(saved.published?.author.id, "gestor-1", field);
      assert.equal(saved.published?.validatedBy, null, field);
    }
  });

  it("um novo salvamento substitui o valor publicado e recusa texto igual", async () => {
    const ctx = setup();
    await ctx.saveProfile(manager, "project-1", "PURPOSE", "Primeira versão");
    const updated = await ctx.saveProfile(pmo1, "project-1", "PURPOSE", "Segunda versão");
    assert.equal(updated.published?.value, "Segunda versão");
    assert.equal(updated.published?.author.id, "pmo-1");
    await assert.rejects(() => ctx.saveProfile(pmo1, "project-1", "PURPOSE", "Segunda versão"), codeIs("INSTITUTIONAL_NO_CHANGE"));
  });

  it("registra autoria na auditoria, com tipo de entidade próprio", async () => {
    const ctx = setup();
    await ctx.saveProfile(manager, "project-1", "PURPOSE", "Texto");
    await ctx.saveProfile(manager, "project-1", "PURPOSE", "Texto revisado");

    const entries = ctx.projectStore.audit.filter((entry) => entry.entityType === "PROJECT_PROFILE");
    assert.deepEqual(entries.map((entry) => [entry.action, entry.actorId, entry.payload.kind]), [
      ["CREATE", "gestor-1", "PROFILE_DIRECT"],
      ["UPDATE", "gestor-1", "PROFILE_DIRECT"],
    ]);
    assert.equal(entries[1].payload.previousPublished, "Texto");
    assert.ok(ctx.projectStore.audit.every((entry) => entry.entityType !== "PROJECT"));
  });
});

describe("Perfil institucional: rascunhos antigos, validação e rejeição", () => {
  it("valida um rascunho antigo por outro usuário e publica", async () => {
    const ctx = setup();
    seedLegacyDraft(ctx, "PURPOSE", { value: "Primeira versão", by: "gestor-1" });

    const decided = await ctx.decideProfile(pmo1, "project-1", "PURPOSE", { decision: "VALIDATE" });
    assert.equal(decided.status, "VALIDATED");
    assert.equal(decided.published?.value, "Primeira versão");
    assert.equal(decided.published?.author.id, "gestor-1");
    assert.equal(decided.published?.validatedBy?.id, "pmo-1");
    assert.equal(decided.draft, null);
    const entry = ctx.projectStore.audit.find((item) => item.payload.kind === "PROFILE_VALIDATE");
    assert.deepEqual([entry?.action, entry?.actorId], ["INSTITUTIONAL_VALIDATE", "pmo-1"]);
  });

  it("bloqueia a autovalidação, inclusive quando já existe versão publicada", async () => {
    const ctx = setup();
    seedLegacyDraft(ctx, "PURPOSE", { value: "v2 escrita pelo PMO", by: "pmo-1" }, { value: "v1", by: "gestor-1", validator: "pmo-2" });

    await assert.rejects(
      () => ctx.decideProfile(pmo1, "project-1", "PURPOSE", { decision: "VALIDATE" }),
      codeIs("INSTITUTIONAL_SELF_VALIDATION"),
    );
    const row = ctx.store.fields[0];
    assert.equal(row.publishedValue, "v1");
    assert.equal(row.draftValue, "v2 escrita pelo PMO");

    const decided = await ctx.decideProfile(pmo2, "project-1", "PURPOSE", { decision: "VALIDATE" });
    assert.equal(decided.published?.value, "v2 escrita pelo PMO");
    assert.equal(decided.published?.author.id, "pmo-1");
    assert.equal(decided.published?.validatedBy?.id, "pmo-2");
  });

  it("preserva a última versão validada enquanto há rascunho antigo pendente", async () => {
    const ctx = setup();
    seedLegacyDraft(ctx, "SCOPE", { value: "Escopo em revisão", by: "gestor-1" }, { value: "Escopo validado", by: "gestor-1", validator: "pmo-1" });

    const forEditor = await ctx.overview(manager, "project-1");
    assert.equal(forEditor.profile.scope.status, "PENDING_VALIDATION");
    assert.equal(forEditor.profile.scope.published?.value, "Escopo validado");
    assert.equal(forEditor.profile.scope.draft?.value, "Escopo em revisão");

    const forViewer = await ctx.overview(observer, "project-1");
    assert.equal(forViewer.profile.scope.published?.value, "Escopo validado");
    assert.equal(forViewer.profile.scope.draft, null);
  });

  it("rejeita com motivo, preserva a versão publicada e registra a decisão", async () => {
    const ctx = setup();
    seedLegacyDraft(ctx, "PROBLEM", { value: "Alteração indevida", by: "gestor-1" }, { value: "Publicado", by: "gestor-1", validator: "pmo-2" });

    const decided = await ctx.decideProfile(pmo1, "project-1", "PROBLEM", { decision: "REJECT", reason: "Texto fora do padrão." });
    assert.equal(decided.status, "VALIDATED");
    assert.equal(decided.published?.value, "Publicado");

    const reject = ctx.projectStore.audit.find((entry) => entry.payload.kind === "PROFILE_REJECT");
    assert.equal(reject?.action, "INSTITUTIONAL_VALIDATE");
    assert.equal(reject?.entityType, "PROJECT_PROFILE");
    assert.equal(reject?.actorId, "pmo-1");
    assert.equal(reject?.payload.reason, "Texto fora do padrão.");
    assert.equal(reject?.payload.rejectedValue, "Alteração indevida");
  });

  it("exige motivo na rejeição (contrato da API)", () => {
    assert.equal(decisionBodySchema.safeParse({ decision: "REJECT" }).success, false);
    assert.equal(decisionBodySchema.safeParse({ decision: "REJECT", reason: "Motivo" }).success, true);
    assert.equal(decisionBodySchema.safeParse({ decision: "VALIDATE" }).success, true);
  });

  it("recusa decidir sem alteração pendente", async () => {
    const ctx = setup();
    await assert.rejects(
      () => ctx.decideProfile(pmo1, "project-1", "PURPOSE", { decision: "VALIDATE" }),
      codeIs("INSTITUTIONAL_NO_PENDING_CHANGE"),
    );
  });

  it("publicar direto substitui um rascunho antigo pendente", async () => {
    const ctx = setup();
    seedLegacyDraft(ctx, "PURPOSE", { value: "Rascunho antigo", by: "gestor-1" });

    const view = await ctx.saveProfile(manager, "project-1", "PURPOSE", "Valor novo");

    assert.equal(view.published?.value, "Valor novo");
    assert.equal(view.draft, null);
  });
});

describe("Resultados esperados e alcançados", () => {
  it("publica o esperado direto e mantém o alcançado como rascunho até a validação", async () => {
    const ctx = setup();
    const expected = await ctx.createResult(manager, "project-1", { type: "ESPERADO", text: "Reduzir o tempo de atendimento" });
    const achieved = await ctx.createResult(manager, "project-1", {
      type: "ALCANCADO",
      text: "Atendimento 30% mais rápido",
      milestoneId: "m-ok",
      resultDate: "2026-07-01T15:00:00.000Z",
    });
    assert.equal(expected.status, "VALIDATED");
    assert.equal(expected.draft, null);
    assert.equal(expected.published?.validatedBy, null);
    assert.equal(achieved.status, "PENDING_VALIDATION");
    assert.equal(achieved.published, null);

    await ctx.decideResult(pmo2, "project-1", achieved.id, { decision: "VALIDATE" });

    const overview = await ctx.overview(observer, "project-1");
    assert.deepEqual(overview.results.expected.map((item) => item.published?.content.text), ["Reduzir o tempo de atendimento"]);
    assert.equal(overview.results.achieved[0].published?.content.milestone?.title, "Marco m-ok");
    assert.equal(overview.results.achieved[0].published?.validatedBy?.id, "pmo-2");
  });

  it("não valida nem rejeita resultado esperado", async () => {
    const ctx = setup();
    const expected = await ctx.createResult(manager, "project-1", { type: "ESPERADO", text: "Meta" });
    await assert.rejects(
      () => ctx.decideResult(pmo1, "project-1", expected.id, { decision: "VALIDATE" }),
      codeIs("RESULT_EXPECTED_NO_VALIDATION"),
    );
  });

  it("editar o esperado publica a nova versão direto e registra o valor anterior na auditoria", async () => {
    const ctx = setup();
    const expected = await ctx.createResult(manager, "project-1", { type: "ESPERADO", text: "Texto", details: { target: "70%", indicator: "Chamados" } });

    const edited = await ctx.updateResult(manager, "project-1", expected.id, { text: "Texto revisado" });

    assert.equal(edited.published?.content.text, "Texto revisado");
    assert.equal(edited.published?.content.details?.target, "70%");
    assert.equal(edited.draft, null);
    const entry = ctx.projectStore.audit.at(-1);
    assert.equal(entry?.payload.kind, "RESULT_DIRECT");
    assert.equal(entry?.payload.previousPublishedText, "Texto");
  });

  it("bloqueia a autovalidação do alcançado e preserva a versão validada na edição", async () => {
    const ctx = setup();
    const created = await ctx.createResult(pmo1, "project-1", { type: "ALCANCADO", text: "Texto" });
    await assert.rejects(
      () => ctx.decideResult(pmo1, "project-1", created.id, { decision: "VALIDATE" }),
      codeIs("INSTITUTIONAL_SELF_VALIDATION"),
    );
    await ctx.decideResult(pmo2, "project-1", created.id, { decision: "VALIDATE" });

    const edited = await ctx.updateResult(manager, "project-1", created.id, { text: "Texto revisado" });
    assert.equal(edited.published?.content.text, "Texto");
    assert.equal(edited.draft?.content.text, "Texto revisado");
  });

  it("rejeição exige justificativa, mantém o rascunho como Correções solicitadas e o reenvio volta a aguardar validação", async () => {
    const ctx = setup();
    const created = await ctx.createResult(supplier, "project-1", { type: "ALCANCADO", text: "Chamados caíram 55%" });

    const rejected = await ctx.decideResult(pmo1, "project-1", created.id, { decision: "REJECT", reason: "Anexe o relatório do GLPI." });
    assert.equal(rejected.status, "CORRECTIONS_REQUESTED");
    assert.equal(rejected.correction?.reason, "Anexe o relatório do GLPI.");
    assert.equal(rejected.correction?.by.id, "pmo-1");
    assert.equal(rejected.draft?.content.text, "Chamados caíram 55%");
    assert.ok(ctx.store.results.every((row) => row.archivedAt === null));

    const resubmitted = await ctx.updateResult(supplier, "project-1", created.id, { text: "Chamados caíram 55%, conforme relatório" });
    assert.equal(resubmitted.status, "PENDING_VALIDATION");
    assert.equal(resubmitted.correction, null);
    const audit = ctx.projectStore.audit.filter((entry) => entry.entityId === created.id).map((entry) => entry.payload.kind);
    assert.deepEqual(audit, ["RESULT_CREATE", "RESULT_REJECT", "RESULT_DRAFT"]);
  });

  it("não vincula marco de outro projeto", async () => {
    const ctx = setup();
    await assert.rejects(
      () => ctx.createResult(manager, "project-1", { type: "ALCANCADO", text: "x", milestoneId: "m-other" }),
      codeIs("MILESTONE_NOT_FOUND"),
    );
  });

  it("vincula alcançados a esperados: várias aferições por esperado e alcançado não previsto", async () => {
    const ctx = setup();
    const expected = await ctx.createResult(manager, "project-1", { type: "ESPERADO", text: "Reduzir chamados" });
    const first = await ctx.createResult(manager, "project-1", { type: "ALCANCADO", text: "Mês 1: -30%", expectedIds: [expected.id] });
    await ctx.createResult(manager, "project-1", { type: "ALCANCADO", text: "Mês 2: -55%", expectedIds: [expected.id] });
    const unforeseen = await ctx.createResult(manager, "project-1", { type: "ALCANCADO", text: "Ganho de segurança", unforeseen: true });

    const overview = await ctx.overview(manager, "project-1");
    assert.equal(overview.results.expected[0].achievedCount, 2);
    assert.deepEqual(overview.results.achieved.find((item) => item.id === first.id)?.expected, [{ id: expected.id, text: "Reduzir chamados" }]);
    assert.equal(overview.results.achieved.find((item) => item.id === unforeseen.id)?.unforeseen, true);

    await assert.rejects(
      () => ctx.createResult(manager, "project-1", { type: "ALCANCADO", text: "x", unforeseen: true, expectedIds: [expected.id] }),
      codeIs("RESULT_UNFORESEEN_WITH_LINKS"),
    );
    await assert.rejects(
      () => ctx.createResult(manager, "project-1", { type: "ALCANCADO", text: "x", expectedIds: [first.id] }),
      codeIs("RESULT_EXPECTED_NOT_FOUND"),
    );
  });

  it("fornecedor cadastra esperados e alcançados, altera só o que cadastrou e não valida", async () => {
    const ctx = setup();
    const own = await ctx.createResult(supplier, "project-1", { type: "ESPERADO", text: "Meta do fornecedor" });
    const other = await ctx.createResult(manager, "project-1", { type: "ESPERADO", text: "Meta do gestor" });
    const achieved = await ctx.createResult(supplier, "project-1", { type: "ALCANCADO", text: "Resultado do fornecedor" });

    assert.equal(own.status, "VALIDATED");
    await ctx.updateResult(supplier, "project-1", own.id, { text: "Meta ajustada" });
    await assert.rejects(() => ctx.updateResult(supplier, "project-1", other.id, { text: "x" }), codeIs("RESULT_EDIT_FORBIDDEN"));
    await assert.rejects(() => ctx.archiveResult(supplier, "project-1", other.id), codeIs("RESULT_EDIT_FORBIDDEN"));
    await assert.rejects(
      () => ctx.decideResult(supplier, "project-1", achieved.id, { decision: "VALIDATE" }),
      codeIs("RESULT_VALIDATE_FORBIDDEN"),
    );
    const overview = await ctx.overview(supplier, "project-1");
    assert.equal(overview.permissions.ownResultsOnly, true);
    assert.equal(overview.permissions.canRegisterResults, true);
    assert.equal(overview.permissions.canValidateResults, false);
  });

  it("valida alcançado: PMO, coordenador e gestor do projeto; nunca ADMIN por perfil, fornecedor ou observador", async () => {
    const ctx = setup();
    const make = () => ctx.createResult(supplier, "project-1", { type: "ALCANCADO", text: "Resultado" });

    for (const validator of [pmo1, coordinator, manager]) {
      const result = await make();
      const decided = await ctx.decideResult(validator, "project-1", result.id, { decision: "VALIDATE" });
      assert.equal(decided.status, "VALIDATED");
      assert.equal(decided.published?.validatedBy?.id, validator.id);
    }
    const pending = await make();
    for (const denied of [adminUser, supplier, observer, outsider]) {
      await assert.rejects(() => ctx.decideResult(denied, "project-1", pending.id, { decision: "VALIDATE" }));
    }
  });

  it("registra evidência do resultado e só o autor fornecedor anexa ao seu resultado", async () => {
    const ctx = setup();
    const own = await ctx.createResult(supplier, "project-1", { type: "ALCANCADO", text: "Resultado" });
    const other = await ctx.createResult(manager, "project-1", { type: "ALCANCADO", text: "Outro" });

    const evidence = await ctx.registerEvidence(supplier, "project-1", own.id, { title: "Relatório GLPI", url: "https://glpi.test/rel" });
    assert.equal(evidence.projectResultId, own.id);
    await assert.rejects(
      () => ctx.registerEvidence(supplier, "project-1", other.id, { title: "x", url: "https://glpi.test/x" }),
      codeIs("RESULT_EDIT_FORBIDDEN"),
    );
    const overview = await ctx.overview(manager, "project-1");
    assert.deepEqual(overview.evidences.filter((item) => item.projectResultId === own.id).map((item) => item.title), ["Relatório GLPI"]);
  });

  it("arquiva sem excluir e some da visão", async () => {
    const ctx = setup();
    const first = await ctx.createResult(manager, "project-1", { type: "ESPERADO", text: "A" });

    await ctx.archiveResult(manager, "project-1", first.id);

    assert.equal(ctx.store.results.length, 1);
    assert.ok(ctx.store.results.every((row) => row.archivedAt !== null && row.archivedBy !== null));
    const overview = await ctx.overview(pmo1, "project-1");
    assert.equal(overview.results.expected.length, 0);
    await assert.rejects(() => ctx.archiveResult(manager, "project-1", first.id), codeIs("PROJECT_RESULT_ALREADY_ARCHIVED"));
    assert.ok(ctx.projectStore.audit.some((entry) => entry.payload.kind === "RESULT_ARCHIVE"));
  });

  it("esconde alcançado ainda não publicado de quem não cadastra nem valida", async () => {
    const ctx = setup();
    await ctx.createResult(manager, "project-1", { type: "ALCANCADO", text: "Rascunho" });
    const forViewer = await ctx.overview(observer, "project-1");
    const forEditor = await ctx.overview(manager, "project-1");
    assert.equal(forViewer.results.achieved.length, 0);
    assert.equal(forEditor.results.achieved.length, 1);
  });
});

describe("Destaque de evoluções da EAP", () => {
  it("destaca só marco aprovado do próprio projeto, sem alterar o marco, e é idempotente", async () => {
    const ctx = setup();
    const before = JSON.stringify(ctx.store.milestones);

    const first = await ctx.setHighlight(manager, "project-1", "m-ok");
    const again = await ctx.setHighlight(manager, "project-1", "m-ok");
    assert.equal(first.milestoneId, again.milestoneId);
    assert.equal(ctx.store.highlights.length, 1);
    assert.equal(JSON.stringify(ctx.store.milestones), before);

    await assert.rejects(() => ctx.setHighlight(manager, "project-1", "m-pend"), codeIs("HIGHLIGHT_REQUIRES_APPROVED_MILESTONE"));
    await assert.rejects(() => ctx.setHighlight(manager, "project-1", "m-other"), codeIs("MILESTONE_NOT_FOUND"));
    await assert.rejects(() => ctx.setHighlight(supplier, "project-1", "m-ok"), codeIs("INSTITUTIONAL_EDIT_FORBIDDEN"));

    const overview = await ctx.overview(observer, "project-1");
    assert.deepEqual(overview.evolutions.map((item) => [item.milestoneId, item.highlighted]), [["m-ok", true]]);

    await ctx.removeHighlight(manager, "project-1", "m-ok");
    await assert.rejects(() => ctx.removeHighlight(manager, "project-1", "m-ok"), codeIs("HIGHLIGHT_NOT_FOUND"));
    const kinds = ctx.projectStore.audit.filter((entry) => entry.entityType === "PROJECT_HIGHLIGHT").map((entry) => entry.payload.kind);
    assert.deepEqual(kinds, ["HIGHLIGHT_ADD", "HIGHLIGHT_REMOVE"]);
  });
});

describe("Contrato de leitura", () => {
  it("expõe os chamados GLPI, os responsáveis e as evidências do projeto", async () => {
    const ctx = setup({ glpiBaseUrl: "https://glpi.test" });
    const overview = await ctx.overview(observer, "project-1");

    assert.deepEqual(overview.origin.glpiTicket, { ticketId: "999001", url: "https://glpi.test/front/ticket.form.php?id=999001" });
    assert.deepEqual(overview.origin.pmoGlpiTicket, { ticketId: "555", url: "https://glpi.test/front/ticket.form.php?id=555" });
    assert.equal(overview.responsible.owner.name, "Dono");
    assert.deepEqual(overview.responsible.managers.map((person) => person.id), ["gestor-1"]);
    assert.deepEqual(overview.responsible.suppliers.map((person) => person.id), ["forn-1"]);
    assert.deepEqual(overview.evidences.map((item) => [item.title, item.projectId]), [["Ata", "project-1"]]);
    assert.deepEqual(overview.permissions, {
      canEdit: false,
      canValidate: false,
      canRegisterResults: false,
      canValidateResults: false,
      ownResultsOnly: false,
    });
    assert.deepEqual((await ctx.overview(pmo1, "project-1")).permissions, {
      canEdit: true,
      canValidate: true,
      canRegisterResults: true,
      canValidateResults: true,
      ownResultsOnly: false,
    });
  });

  it("não gera link sem URL base válida do GLPI e aceita o chamado do PMO vazio", async () => {
    const ctx = setup({ glpiBaseUrl: null });
    ctx.projectStore.projects[0].pmoGlpiTicketId = null;
    const overview = await ctx.overview(observer, "project-1");

    assert.deepEqual(overview.origin.glpiTicket, { ticketId: "999001", url: null });
    assert.equal(overview.origin.pmoGlpiTicket, null);
    assert.equal(parseGlpiBaseUrl(undefined), null);
    assert.equal(parseGlpiBaseUrl("ftp://glpi.test"), null);
    assert.equal(parseGlpiBaseUrl("não é url"), null);
    assert.equal(parseGlpiBaseUrl("https://glpi.test/glpi/"), "https://glpi.test/glpi");
  });

  it("campos ainda não preenchidos saem vazios, sem texto gerado", async () => {
    const ctx = setup();
    const overview = await ctx.overview(observer, "project-1");

    assert.equal(overview.profile.purpose.status, "EMPTY");
    assert.equal(overview.profile.purpose.published, null);
    assert.equal(overview.origin.requestingArea.status, "EMPTY");
    assert.deepEqual(overview.evolutions.map((item) => [item.milestoneId, item.highlighted]), [["m-ok", false]]);
  });
});

describe("Chamado do Escritório de Projetos", () => {
  it("é opcional, editável por quem atualiza o projeto e não altera o chamado de origem", async () => {
    const ctx = setup();
    const repos = makeInMemoryRepos(ctx.projectStore);
    const updateProject = makeUpdateProjectUseCase({ repos, runInTransaction: makeInMemoryTransactionRunner(repos) });

    const cleared = await updateProject(pmo1, "project-1", { pmoGlpiTicketId: null });
    assert.equal(cleared.pmoGlpiTicketId, null);
    assert.equal(cleared.glpiTicketId, "999001");

    const filled = await updateProject(manager, "project-1", { pmoGlpiTicketId: "777" });
    assert.equal(filled.pmoGlpiTicketId, "777");
    await assert.rejects(() => updateProject(supplier, "project-1", { pmoGlpiTicketId: "1" }), codeIs("PROJECT_UPDATE_FORBIDDEN"));
  });
});

describe("Perfil institucional: campos de preenchimento direto", () => {
  it("publica na hora a empresa responsável e os setores, sem rascunho e sem validador", async () => {
    const ctx = setup();
    const area = await ctx.saveProfile(manager, "project-1", "RESPONSIBLE_COMPANY", "CTIN");
    const sectors = await ctx.saveProfile(manager, "project-1", "BENEFITED_SECTORS", "CTIN, RH");

    for (const view of [area, sectors]) {
      assert.equal(view.status, "VALIDATED");
      assert.equal(view.draft, null);
      assert.equal(view.published?.author.id, "gestor-1");
      assert.equal(view.published?.validatedBy, null);
      assert.equal(view.published?.validatedAt, null);
    }
    assert.equal(sectors.published?.value, "CTIN, RH");
  });

  it("a síntese dos resultados e a descrição do sistema ficam no overview e entram na auditoria", async () => {
    const ctx = setup();
    await ctx.saveProfile(manager, "project-1", "RESULTS_SUMMARY", "Benefícios gerais do sistema.");
    await ctx.saveProfile(manager, "project-1", "SYSTEM_DESCRIPTION", "O sistema faz X, Y e Z.");

    const entries = ctx.projectStore.audit.filter((item) => item.entityType === "PROJECT_PROFILE");
    assert.equal(entries.length, 2);
    assert.equal(entries.at(-1)?.actorId, "gestor-1");
  });

  it("aceita até 8.000 caracteres só na descrição do sistema e na síntese; os demais campos seguem em 4.000", async () => {
    const ctx = setup();
    const big = "a".repeat(8000);
    assert.equal((await ctx.saveProfile(manager, "project-1", "SYSTEM_DESCRIPTION", big)).published?.value, big);
    assert.equal((await ctx.saveProfile(manager, "project-1", "RESULTS_SUMMARY", big)).published?.value, big);
    await assert.rejects(() => ctx.saveProfile(manager, "project-1", "SYSTEM_DESCRIPTION", big + "b"), codeIs("PROFILE_VALUE_TOO_LONG"));
    await assert.rejects(() => ctx.saveProfile(manager, "project-1", "PROBLEM", "a".repeat(4001)), codeIs("PROFILE_VALUE_TOO_LONG"));
    assert.equal((await ctx.saveProfile(manager, "project-1", "SCOPE", "a".repeat(4000))).published?.value.length, 4000);
  });

  it("registra na auditoria quem informou, o valor anterior e o novo", async () => {
    const ctx = setup();
    await ctx.saveProfile(manager, "project-1", "BENEFITED_SECTORS", "CTIN");
    await ctx.saveProfile(manager, "project-1", "BENEFITED_SECTORS", "CTIN, RH");

    const entry = ctx.projectStore.audit.at(-1);
    assert.equal(entry?.entityType, "PROJECT_PROFILE");
    assert.equal(entry?.actorId, "gestor-1");
    assert.deepEqual(
      { kind: (entry?.payload as { kind: string }).kind, previous: (entry?.payload as { previousPublished: string }).previousPublished, value: (entry?.payload as { value: string }).value },
      { kind: "PROFILE_DIRECT", previous: "CTIN", value: "CTIN, RH" },
    );
  });

  it("não permite que fornecedor ou observador publiquem esses campos", async () => {
    const ctx = setup();
    for (const user of [supplier, observer, outsider]) {
      await assert.rejects(() => ctx.saveProfile(user, "project-1", "BENEFITED_SECTORS", "CTIN"));
    }
  });

  it("substitui um rascunho pendente antigo ao publicar direto", async () => {
    const ctx = setup();
    ctx.store.fields.push({
      id: "legacy",
      projectId: "project-1",
      field: "RESPONSIBLE_COMPANY",
      publishedValue: null,
      publishedBy: null,
      publishedAt: null,
      validatedBy: null,
      validatedAt: null,
      draftValue: "Rascunho antigo",
      draftBy: "gestor-1",
      draftAt: new Date(),
    });

    const view = await ctx.saveProfile(manager, "project-1", "RESPONSIBLE_COMPANY", "CTIN");

    assert.equal(view.published?.value, "CTIN");
    assert.equal(view.draft, null);
  });
});
