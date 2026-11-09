import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { canValidateExecutiveSummary } from "../eap.authorization";
import {
  createEapInMemoryStore,
  makeEapInMemoryRepos,
  makeEapInMemoryTransactionRunner,
  makeMember,
  makeProject,
  makeUser,
} from "../test/in-memory";
import { makeCreatePhaseUseCase } from "./create-phase";
import { makeCreateTaskUseCase } from "./create-task";
import { executiveCycleOf } from "./executive-cycle";
import {
  makeGetExecutiveSummaryValidationUseCase,
  makeListExecutiveSummaryValidationsUseCase,
  makeValidateExecutiveSummaryUseCase,
} from "./executive-summary-validations";
import { makeGetExecutiveSummaryUseCase } from "./get-executive-summary";

function actor(role: AuthUser["role"], id: string): AuthUser {
  return { id, name: id, email: `${id}@igepps.test`, role };
}

const pmo = actor("PMO", "pmo-1");
const admin = actor("ADMIN", "admin-1");
const coordinator = actor("COORDENADOR", "coord-1");
const manager = actor("GESTOR", "owner-1");
const supplier = actor("FORNECEDOR", "forn-1");
const outsider = actor("COLABORADOR", "out-1");

// Quarta-feira 28/10/2026 (ciclo 22/10 a 28/10) e a semana seguinte (quinta 29/10 a quarta 04/11).
const WED = new Date("2026-10-28T15:00:00.000Z");
const NEXT_CYCLE = new Date("2026-11-02T15:00:00.000Z");

const day = (value: string) => `${value}T15:00:00.000Z`;

async function setup() {
  const store = createEapInMemoryStore({
    users: [
      makeUser({ id: "pmo-1", role: "PMO" }),
      makeUser({ id: "admin-1", role: "ADMIN" }),
      makeUser({ id: "coord-1", role: "COORDENADOR" }),
      makeUser({ id: "owner-1", role: "GESTOR" }),
      makeUser({ id: "forn-1", role: "FORNECEDOR" }),
      makeUser({ id: "out-1", role: "COLABORADOR" }),
    ],
    projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
    members: [makeMember({ id: "m-forn", projectId: "project-1", userId: "forn-1", role: "FORNECEDOR" })],
  });
  const repos = makeEapInMemoryRepos(store);
  const deps = { repos, runInTransaction: makeEapInMemoryTransactionRunner(repos, store) };
  const phase = await makeCreatePhaseUseCase(deps)(pmo, "project-1", { name: "Fase" });
  const createTask = makeCreateTaskUseCase(deps);
  await createTask(pmo, "project-1", phase.id, { title: "Tarefa", assigneeId: "forn-1", plannedStartAt: day("2026-08-01"), plannedEndAt: day("2026-12-30") });
  return {
    store,
    repos,
    phase,
    createTask,
    summary: makeGetExecutiveSummaryUseCase(deps),
    validate: makeValidateExecutiveSummaryUseCase(deps),
    // Sem desfazer por cópia do estado: o banco real garante a unicidade pelo índice, aqui só se exercita o caminho do conflito.
    validateConcurrent: makeValidateExecutiveSummaryUseCase({ repos, runInTransaction: makeEapInMemoryTransactionRunner(repos) }),
    list: makeListExecutiveSummaryValidationsUseCase(deps),
    detail: makeGetExecutiveSummaryValidationUseCase(deps),
  };
}

const rejectsWith = (status: number, code?: string) => (error: unknown) =>
  error instanceof HttpError && error.statusCode === status && (code === undefined || error.code === code);

async function fingerprintOf(ctx: Awaited<ReturnType<typeof setup>>, user: AuthUser, now: Date) {
  return (await ctx.summary(user, "project-1", now)).governance.fingerprint;
}

describe("Ciclo semanal do resumo executivo", () => {
  it("vai de quinta a quarta no fuso de Belém, inclusive na virada de dia e de mês", () => {
    // Quarta 23:59 em Belém ainda é do ciclo que termina; quinta 00:00 abre o seguinte.
    assert.deepEqual(executiveCycleOf(new Date("2026-10-29T02:59:59.000Z")), {
      start: "2026-10-22",
      end: "2026-10-28",
      deadlineAt: "2026-10-29T02:59:59.999Z",
    });
    assert.equal(executiveCycleOf(new Date("2026-10-29T03:00:00.000Z")).start, "2026-10-29");
    assert.equal(executiveCycleOf(new Date("2026-10-29T03:00:00.000Z")).end, "2026-11-04");
    // Quinta, sexta, sábado, domingo, segunda, terça e quarta são do mesmo ciclo.
    for (const date of ["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]) {
      assert.equal(executiveCycleOf(new Date(`${date}T15:00:00.000Z`)).start, "2026-10-29", date);
    }
    // Virada de mês e de ano.
    assert.deepEqual(executiveCycleOf(new Date("2026-12-31T15:00:00.000Z")), {
      start: "2026-12-31",
      end: "2027-01-06",
      deadlineAt: "2027-01-07T02:59:59.999Z",
    });
    assert.equal(executiveCycleOf(new Date("2027-01-02T15:00:00.000Z")).start, "2026-12-31");
  });
});

describe("Validação do resumo executivo pelo PMO", () => {
  it("só o perfil global PMO valida: ADMIN, COORDENADOR, gestor, fornecedor e sem vínculo são recusados", async () => {
    const ctx = await setup();
    const fingerprint = await fingerprintOf(ctx, pmo, WED);

    for (const user of [admin, coordinator, manager, supplier]) {
      await assert.rejects(
        () => ctx.validate(user, "project-1", { fingerprint }, WED),
        rejectsWith(403, "EXECUTIVE_SUMMARY_VALIDATE_FORBIDDEN"),
        user.role,
      );
    }
    await assert.rejects(() => ctx.validate(outsider, "project-1", { fingerprint }, WED), rejectsWith(403));
    assert.equal(ctx.store.executiveSummaries.length, 0);
    assert.equal(ctx.store.auditLogs.some((log) => log.action === ("EXECUTIVE_SUMMARY_VALIDATE" as never)), false);

    assert.equal((await ctx.summary(pmo, "project-1", WED)).governance.canValidate, true);
    assert.equal((await ctx.summary(admin, "project-1", WED)).governance.canValidate, false);
    assert.equal((await ctx.summary(coordinator, "project-1", WED)).governance.canValidate, false);
    assert.equal(canValidateExecutiveSummary({ globalRole: "PMO" } as never), true);
    assert.equal(canValidateExecutiveSummary({ globalRole: "ADMIN" } as never), false);
  });

  it("recalcula o snapshot no servidor, grava o ciclo, o responsável, a hora real e a auditoria na mesma transação", async () => {
    const ctx = await setup();
    const before = await ctx.summary(pmo, "project-1", WED);
    assert.equal(before.governance.lastValidation, null);
    assert.equal(before.governance.currentCycleRegularValidated, false);
    assert.deepEqual(before.governance.cycle.start, "2026-10-22");

    const validation = await ctx.validate(pmo, "project-1", { fingerprint: before.governance.fingerprint, observation: "  Conferido com a equipe.  " }, WED);

    assert.equal(validation.kind, "REGULAR");
    assert.equal(validation.cycleStart, "2026-10-22");
    assert.equal(validation.cycleEnd, "2026-10-28");
    assert.equal(validation.validatedById, "pmo-1");
    assert.equal(validation.observation, "Conferido com a equipe.");
    assert.equal(validation.unchanged, false);
    const stored = ctx.store.executiveSummaries[0];
    assert.equal(stored.fingerprint, before.governance.fingerprint);
    assert.equal((stored.snapshot as { generatedAt: string }).generatedAt, WED.toISOString());
    const audit = ctx.store.auditLogs.find((log) => log.entityId === validation.id);
    assert.equal(audit?.entityType, "PROJECT_EXECUTIVE_SUMMARY");
    assert.equal(audit?.action, "EXECUTIVE_SUMMARY_VALIDATE");

    const after = await ctx.summary(pmo, "project-1", WED);
    assert.equal(after.governance.currentCycleRegularValidated, true);
    assert.equal(after.governance.lastValidation?.id, validation.id);
    // A validação não congela a atualização automática: o resumo ao vivo continua sendo o calculado agora.
    assert.equal(after.generatedAt, WED.toISOString());
  });

  it("desfaz tudo quando a auditoria falha (registro e auditoria na mesma transação)", async () => {
    const ctx = await setup();
    const fingerprint = await fingerprintOf(ctx, pmo, WED);
    const original = ctx.repos.audit.create.bind(ctx.repos.audit);
    ctx.repos.audit.create = async (data) => {
      if (data.entityType === "PROJECT_EXECUTIVE_SUMMARY") {
        throw new Error("falha forçada");
      }
      return original(data);
    };

    await assert.rejects(() => ctx.validate(pmo, "project-1", { fingerprint }, WED));
    assert.equal(ctx.store.executiveSummaries.length, 0);
  });

  it("recusa com 409 quando os indicadores mudam entre a visualização e a confirmação", async () => {
    const ctx = await setup();
    const seen = await fingerprintOf(ctx, pmo, WED);
    await ctx.createTask(pmo, "project-1", ctx.phase.id, { title: "Atrasada", assigneeId: "forn-1", plannedStartAt: day("2026-06-01"), plannedEndAt: day("2026-07-01") });

    await assert.rejects(() => ctx.validate(pmo, "project-1", { fingerprint: seen }, WED), rejectsWith(409, "EXECUTIVE_SUMMARY_CHANGED"));
    assert.equal(ctx.store.executiveSummaries.length, 0);
    // Com a impressão digital atual a validação passa; indicadores enviados pelo cliente nunca são usados.
    const current = await fingerprintOf(ctx, pmo, WED);
    assert.notEqual(current, seen);
    const done = await ctx.validate(pmo, "project-1", { fingerprint: current }, WED);
    const snapshot = ctx.store.executiveSummaries.find((row) => row.id === done.id)!.snapshot as { overdue: { total: number } };
    assert.ok(snapshot.overdue.total >= 1);
  });

  it("a impressão digital ignora a hora de geração e é estável para o mesmo conteúdo", async () => {
    const ctx = await setup();
    const first = await fingerprintOf(ctx, pmo, WED);
    const later = await fingerprintOf(ctx, pmo, new Date(WED.getTime() + 3 * 60 * 1000));
    assert.equal(first, later);
  });

  it("permite uma validação regular por ciclo e extraordinárias adicionais, com observação obrigatória, sem substituir a anterior", async () => {
    const ctx = await setup();
    const fingerprint = await fingerprintOf(ctx, pmo, WED);
    const regular = await ctx.validate(pmo, "project-1", { fingerprint }, WED);

    await assert.rejects(() => ctx.validate(pmo, "project-1", { fingerprint }, WED), rejectsWith(409, "EXECUTIVE_SUMMARY_ALREADY_VALIDATED"));
    await assert.rejects(() => ctx.validate(pmo, "project-1", { fingerprint, extraordinary: true }, WED), rejectsWith(400, "EXECUTIVE_SUMMARY_OBSERVATION_REQUIRED"));
    await assert.rejects(() => ctx.validate(pmo, "project-1", { fingerprint, extraordinary: true, observation: "   " }, WED), rejectsWith(400));

    const extra = await ctx.validate(pmo, "project-1", { fingerprint, extraordinary: true, observation: "Reunião com a diretoria." }, new Date("2026-10-28T20:00:00.000Z"));
    const extra2 = await ctx.validate(pmo, "project-1", { fingerprint, extraordinary: true, observation: "Segunda extraordinária." }, new Date("2026-10-28T21:00:00.000Z"));
    assert.equal(extra.kind, "EXTRAORDINARY");
    assert.equal(extra.cycleStart, regular.cycleStart);
    assert.notEqual(extra.id, regular.id);
    assert.notEqual(extra2.id, extra.id);
    assert.equal(ctx.store.executiveSummaries.length, 3);
    assert.ok(ctx.store.executiveSummaries.some((row) => row.id === regular.id), "a regular continua no histórico");
  });

  it("uma validação posterior ao fechamento pertence ao ciclo em que ocorreu, nunca ao anterior", async () => {
    const ctx = await setup();
    const fingerprint = await fingerprintOf(ctx, pmo, NEXT_CYCLE);
    const late = await ctx.validate(pmo, "project-1", { fingerprint }, NEXT_CYCLE);
    assert.equal(late.cycleStart, "2026-10-29");
    assert.equal(late.cycleEnd, "2026-11-04");
    // O ciclo anterior continua sem validação regular e não pode receber uma retroativa.
    assert.equal(ctx.store.executiveSummaries.some((row) => row.cycleStart === "2026-10-22"), false);
  });

  it("\"Validar sem alterações\" só vale quando os indicadores são iguais aos da validação anterior (conferido no servidor)", async () => {
    const ctx = await setup();
    const first = await fingerprintOf(ctx, pmo, WED);
    await assert.rejects(() => ctx.validate(pmo, "project-1", { fingerprint: first, withoutChanges: true }, WED), rejectsWith(409, "EXECUTIVE_SUMMARY_HAS_CHANGES"));
    await ctx.validate(pmo, "project-1", { fingerprint: first }, WED);

    const unchanged = await ctx.summary(pmo, "project-1", NEXT_CYCLE);
    assert.equal(unchanged.governance.unchangedSinceLastValidation, true);
    const same = await ctx.validate(pmo, "project-1", { fingerprint: unchanged.governance.fingerprint, withoutChanges: true }, NEXT_CYCLE);
    assert.equal(same.unchanged, true);

    await ctx.createTask(pmo, "project-1", ctx.phase.id, { title: "Nova atrasada", assigneeId: "forn-1", plannedStartAt: day("2026-06-01"), plannedEndAt: day("2026-07-01") });
    const changed = await ctx.summary(pmo, "project-1", new Date("2026-11-09T15:00:00.000Z"));
    assert.equal(changed.governance.unchangedSinceLastValidation, false);
    await assert.rejects(
      () => ctx.validate(pmo, "project-1", { fingerprint: changed.governance.fingerprint, withoutChanges: true }, new Date("2026-11-09T15:00:00.000Z")),
      rejectsWith(409, "EXECUTIVE_SUMMARY_HAS_CHANGES"),
    );
  });

  it("solicitações simultâneas não duplicam a validação regular do ciclo", async () => {
    const ctx = await setup();
    const fingerprint = await fingerprintOf(ctx, pmo, WED);

    const results = await Promise.allSettled([
      ctx.validateConcurrent(pmo, "project-1", { fingerprint }, WED),
      ctx.validateConcurrent(pmo, "project-1", { fingerprint }, WED),
      ctx.validateConcurrent(pmo, "project-1", { fingerprint }, WED),
    ]);

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    for (const result of results) {
      if (result.status === "rejected") {
        assert.ok(rejectsWith(409, "EXECUTIVE_SUMMARY_ALREADY_VALIDATED")(result.reason));
      }
    }
    assert.equal(ctx.store.executiveSummaries.filter((row) => row.kind === "REGULAR" && row.cycleStart === "2026-10-22").length, 1);
  });

  it("projetos concluídos ou suspensos saem das cobranças periódicas, mas aceitam validação manual", async () => {
    const ctx = await setup();
    assert.equal((await ctx.summary(pmo, "project-1", WED)).governance.periodic, true);
    for (const status of ["CONCLUIDO", "SUSPENSO"] as const) {
      ctx.store.projects.find((row) => row.id === "project-1")!.status = status;
      const summary = await ctx.summary(pmo, "project-1", WED);
      assert.equal(summary.governance.periodic, false, status);
    }
    const done = await ctx.validate(pmo, "project-1", { fingerprint: await fingerprintOf(ctx, pmo, WED) }, WED);
    assert.equal(done.kind, "REGULAR");
  });

  it("10. a nova regra de atraso não reescreve validações anteriores: snapshot, datas, responsável e auditoria intactos; só a revalidação regular é exigida", async () => {
    const ctx = await setup();
    const before = await ctx.summary(pmo, "project-1", WED);
    const old = await ctx.validate(pmo, "project-1", { fingerprint: before.governance.fingerprint, observation: "Validado antes da regra única." }, WED);
    // Valida como era antes da regra única: snapshot com contagem de fase e texto antigos, e a impressão digital da época.
    const row = ctx.store.executiveSummaries[0];
    row.fingerprint = "impressao-digital-anterior-a-regra-unica";
    Object.assign(row.snapshot as Record<string, unknown>, {
      overdue: { phases: 1, tasks: 1, milestones: 4, total: 6 },
      narrative: [{ key: "overdue", text: "6 itens em atraso: 1 fase, 1 tarefa e 4 marcos." }],
    });
    const legacyRow = structuredClone(row);
    const legacyAudit = structuredClone(ctx.store.auditLogs);

    // Cálculos futuros: a impressão digital nova não coincide com a antiga, então "Validar sem alterações" deixa de valer.
    const next = await ctx.summary(pmo, "project-1", NEXT_CYCLE);
    assert.notEqual(next.governance.fingerprint, "impressao-digital-anterior-a-regra-unica");
    assert.equal(next.governance.unchangedSinceLastValidation, false);
    await assert.rejects(
      () => ctx.validate(pmo, "project-1", { fingerprint: next.governance.fingerprint, withoutChanges: true }, NEXT_CYCLE),
      rejectsWith(409, "EXECUTIVE_SUMMARY_HAS_CHANGES"),
    );
    // A validação regular prevista continua possível, uma única vez por ciclo, e passa a gravar a impressão digital nova.
    const regular = await ctx.validate(pmo, "project-1", { fingerprint: next.governance.fingerprint }, NEXT_CYCLE);
    assert.equal(regular.kind, "REGULAR");
    assert.equal(ctx.store.executiveSummaries[1].fingerprint, next.governance.fingerprint);
    const again = await ctx.summary(pmo, "project-1", NEXT_CYCLE);
    assert.equal(again.governance.unchangedSinceLastValidation, true);

    // Histórico: o registro antigo está idêntico, e o snapshot é lido como foi gravado (nunca recalculado).
    assert.deepEqual(ctx.store.executiveSummaries[0], legacyRow);
    assert.deepEqual(ctx.store.auditLogs.slice(0, legacyAudit.length), legacyAudit);
    const detail = await ctx.detail(supplier, "project-1", old.id);
    assert.deepEqual(detail.snapshot.overdue, { phases: 1, tasks: 1, milestones: 4, total: 6 });
    assert.equal(detail.snapshot.narrative[0].text, "6 itens em atraso: 1 fase, 1 tarefa e 4 marcos.");
    assert.equal(detail.validatedAt, old.validatedAt);
    assert.equal(detail.validatedById, "pmo-1");
    assert.equal(detail.observation, "Validado antes da regra única.");
    const history = await ctx.list(supplier, "project-1");
    assert.deepEqual(history.data.map((item) => item.id), [regular.id, old.id]);
  });

  it("lista o histórico do mais recente ao mais antigo e abre o snapshot em modo leitura", async () => {
    const ctx = await setup();
    const first = await ctx.validate(pmo, "project-1", { fingerprint: await fingerprintOf(ctx, pmo, WED) }, WED);
    const second = await ctx.validate(pmo, "project-1", { fingerprint: await fingerprintOf(ctx, pmo, NEXT_CYCLE) }, NEXT_CYCLE);

    const history = await ctx.list(supplier, "project-1");
    assert.deepEqual(history.data.map((item) => item.id), [second.id, first.id]);
    assert.ok(!("snapshot" in history.data[0]));

    const detail = await ctx.detail(supplier, "project-1", first.id);
    assert.equal(detail.snapshot.generatedAt, WED.toISOString());
    await assert.rejects(() => ctx.detail(supplier, "project-1", "inexistente"), rejectsWith(404));
    await assert.rejects(() => ctx.list(outsider, "project-1"), rejectsWith(403));
  });

  it("o snapshot não revela entradas de governança a quem não pode consultá-las", async () => {
    const ctx = await setup();
    ctx.store.auditLogs.push({
      id: "gov-1",
      projectId: "project-1",
      entityType: "PROJECT",
      entityId: "project-1",
      action: "STATUS_CHANGE",
      summary: "Situação do projeto alterada.",
      payload: { kind: "STATUS" },
      actorId: "pmo-1",
      createdAt: new Date("2026-10-28T10:00:00.000Z"),
    } as never);
    const validation = await ctx.validate(pmo, "project-1", { fingerprint: await fingerprintOf(ctx, pmo, WED) }, WED);

    const asPmo = await ctx.detail(pmo, "project-1", validation.id);
    const asSupplier = await ctx.detail(supplier, "project-1", validation.id);
    assert.ok(asPmo.snapshot.movements.some((movement) => movement.id === "gov-1" && movement.governance));
    assert.ok(!asSupplier.snapshot.movements.some((movement) => movement.id === "gov-1"));
  });
});
