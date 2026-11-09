import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../lib/http-error";
import { createBusinessCalendar, type CalendarDayInput } from "../business-calendar/business-days";
import { computeExecutiveFollowUp } from "../eap/use-cases/executive-follow-up";
import type { ExecutiveSummaryValidationRow } from "../eap/repositories/contracts";
import { createEapInMemoryStore, makeEapInMemoryRepos, makeProject, makeUser } from "../eap/test/in-memory";
import { runNotificationGenerator, type GeneratorDeps } from "./notification-generator";
import { InMemoryNotificationRepository } from "./notifications.in-memory";

const at = (value: string) => new Date(value);
// Quinta 12/11/2026, 10h em Belém. Ciclos: 22/10, 29/10, 05/11 (encerrados) e 12/11 (atual). Corte: quinta 22/10.
const NOW = at("2026-11-12T10:00:00-03:00");
const CUTOFF = "2026-10-22";
const ACTIVATED = at("2026-10-20T12:00:00-03:00");

function setup(options: { holidays?: CalendarDayInput[]; validated?: number[]; enabled?: boolean } = {}) {
  const notifications = new InMemoryNotificationRepository();
  notifications.users = [
    { id: "pmo-1", name: "PMO Um", email: "pmo1@igepps.test", role: "PMO", isActive: true },
    { id: "pmo-2", name: "PMO Inativo", email: "pmo2@igepps.test", role: "PMO", isActive: false },
    { id: "coord-1", name: "Coordenador CTIN", email: "coord@igepps.test", role: "COORDENADOR", isActive: true },
    { id: "admin-1", name: "Admin", email: "admin@igepps.test", role: "ADMIN", isActive: true },
  ];
  notifications.projectList = [{ id: "p1", name: "Projeto Um", status: "EM_EXECUCAO" }];
  const rule = (id: string, kind: string, source: string, target: { role?: string; userId?: string }, visibility: string) => ({
    id,
    kind,
    source,
    role: target.role ?? null,
    userId: target.userId ?? null,
    visibility,
    enabled: true,
    createdBy: "admin-1",
    createdAt: NOW,
    updatedBy: "admin-1",
    updatedAt: NOW,
  });
  notifications.rules = [
    rule("r1", "PREVENTIVE", "ROLE", { role: "PMO" }, "TO"),
    rule("r2", "OVERDUE", "ROLE", { role: "PMO" }, "TO"),
    rule("r3", "ESCALATION", "USER", { userId: "coord-1" }, "TO"),
    rule("r4", "ESCALATION", "ROLE", { role: "PMO" }, "CC"),
  ];
  if (options.enabled !== false) {
    notifications.settings = { id: "GLOBAL", activationEnabled: true, activationCutoff: CUTOFF, activatedAt: ACTIVATED, activatedBy: "admin-1", updatedAt: ACTIVATED };
  }
  const store = createEapInMemoryStore({
    users: [makeUser({ id: "admin-1", role: "ADMIN" })],
    projects: [makeProject({ id: "p1", ownerId: "admin-1", status: "EM_EXECUCAO" })],
  });
  const eap = makeEapInMemoryRepos(store);
  const audit = (id: string, entityType: string, payload: Record<string, unknown>, when: string) =>
    store.auditLogs.push({ id, projectId: "p1", entityType, entityId: "p1", action: "STATUS_CHANGE", summary: id, payload, actorId: "admin-1", createdAt: at(when) } as never);
  audit("start", "PROJECT", { automatic: false, from: "NAO_INICIADO", to: "EM_EXECUCAO" }, "2026-09-01T10:00:00-03:00");
  const validated = new Set(options.validated ?? [2026]);
  const deps: GeneratorDeps = {
    notifications,
    eap,
    loadCalendar: async () => createBusinessCalendar(options.holidays ?? [], validated),
    validatedCalendarYears: async () => validated,
  };
  const addValidation = (cycleStart: string, kind: "REGULAR" | "EXTRAORDINARY", id = `v-${cycleStart}-${kind}`) =>
    store.executiveSummaries.push({ id, projectId: "p1", cycleStart, cycleEnd: cycleStart, kind, validatedBy: "admin-1", validatedAt: NOW, fingerprint: "x", unchanged: false, observation: null, snapshot: {}, snapshotVersion: 1 } as unknown as ExecutiveSummaryValidationRow);
  return { notifications, deps, store, audit, addValidation, validated };
}

const run = (ctx: ReturnType<typeof setup>, now = NOW, mode: "ACTIVE" | "DRY_RUN" = "ACTIVE", simulatedCutoff: string | null = null) =>
  runNotificationGenerator(ctx.deps, { mode, origin: "CLI", actorId: null, now, simulatedCutoff });

const kinds = (ctx: ReturnType<typeof setup>) => ctx.notifications.notifications.map((row) => row.kind).sort();

describe("gerador de notificações: geração e destinatários", () => {
  it("gera atraso (1 por ciclo) e escalonamento, para os destinatários certos e só ativos", async () => {
    const ctx = setup();
    const result = await run(ctx);
    assert.equal(result.status, "COMPLETED");
    assert.deepEqual(kinds(ctx), ["ESCALATION", "OVERDUE"]);

    const overdue = ctx.notifications.notifications.find((row) => row.kind === "OVERDUE")!;
    assert.equal(overdue.dedupeKey, "OVERDUE:p1:2026-11-05");
    assert.equal(overdue.dueDate, "2026-11-11"); // vencimento original
    assert.equal(overdue.scheduledFor.toISOString(), "2026-11-12T12:00:00.000Z"); // quinta 9h em Belém
    const overdueTo = ctx.notifications.deliveries.filter((d) => d.notificationId === overdue.id);
    assert.deepEqual(overdueTo.map((d) => [d.userId, d.visibility]), [["pmo-1", "TO"]]); // PMO inativo não recebe

    const escalation = ctx.notifications.notifications.find((row) => row.kind === "ESCALATION")!;
    assert.equal(escalation.dedupeKey, "ESCALATION:p1:2026-10-22");
    assert.equal(escalation.scheduledFor.toISOString(), "2026-11-09T12:00:00.000Z"); // segunda 9h (28/10 + 10 dias = sábado)
    const escalationTo = ctx.notifications.deliveries.filter((d) => d.notificationId === escalation.id);
    assert.deepEqual(escalationTo.map((d) => [d.userId, d.visibility]).sort(), [["coord-1", "TO"], ["pmo-1", "CC"]]);
    assert.equal(escalationTo[0].recipientName.length > 0, true); // cópia de nome/e-mail da época
  });

  it("é idempotente: repetir a execução não duplica avisos nem entregas", async () => {
    const ctx = setup();
    await run(ctx);
    const first = ctx.notifications.deliveries.length;
    const again = await run(ctx);
    assert.equal(again.summary?.created, 0);
    assert.equal(again.summary?.duplicates, 2);
    assert.equal(ctx.notifications.notifications.length, 2);
    assert.equal(ctx.notifications.deliveries.length, first);
  });

  it("execuções concorrentes: a trava global deixa uma só trabalhar", async () => {
    const ctx = setup();
    const [a, b] = await Promise.all([run(ctx), run(ctx)]);
    assert.deepEqual([a.status, b.status].sort(), ["COMPLETED", "SKIPPED_LOCKED"]);
    assert.equal(ctx.notifications.notifications.length, 2);
    assert.equal(ctx.notifications.runs.filter((item) => item.status === "SKIPPED_LOCKED").length, 1);
  });

  it("aviso preventivo na terça-feira às 9h e deslocado para o dia útil anterior se for feriado", async () => {
    const tuesday = at("2026-11-17T10:00:00-03:00");
    const normal = setup();
    await run(normal, tuesday);
    const preventive = normal.notifications.notifications.find((row) => row.kind === "PREVENTIVE")!;
    assert.equal(preventive.dedupeKey, "PREVENTIVE:p1:2026-11-12");
    assert.equal(preventive.scheduledFor.toISOString(), "2026-11-17T12:00:00.000Z");
    assert.equal(preventive.dueDate, "2026-11-18");

    const holiday = setup({ holidays: [{ day: "2026-11-17", kind: "FERIADO", observed: true }] });
    // No próprio feriado a entrega é adiada (dia não útil); na segunda-feira, dia útil anterior, o aviso é entregue.
    const onHoliday = await run(holiday, at("2026-11-17T10:00:00-03:00"));
    assert.equal(onHoliday.summary!.deliveryWindow.reason, "NOT_BUSINESS_DAY");
    assert.equal(holiday.notifications.notifications.some((row) => row.kind === "PREVENTIVE"), false);
    await run(holiday, at("2026-11-16T10:00:00-03:00"));
    assert.equal(holiday.notifications.notifications.find((row) => row.kind === "PREVENTIVE")!.scheduledFor.toISOString(), "2026-11-16T12:00:00.000Z");
    // Antes da terça às 9h não há aviso.
    const early = setup();
    await run(early, at("2026-11-16T10:00:00-03:00"));
    assert.equal(early.notifications.notifications.some((row) => row.kind === "PREVENTIVE"), false);
  });
});

describe("gerador de notificações: ativação, corte e simulação", () => {
  it("com a ativação desligada a geração real é recusada e nada é gravado", async () => {
    const ctx = setup({ enabled: false });
    await assert.rejects(() => run(ctx), (error: unknown) => error instanceof HttpError && error.statusCode === 409 && error.code === "NOTIFICATIONS_DISABLED");
    assert.equal(ctx.notifications.notifications.length, 0);
    assert.equal(ctx.notifications.issues.length, 0);
  });

  it("--dry-run não cria avisos, entregas nem ocorrências: só o histórico técnico da execução", async () => {
    const ctx = setup({ enabled: false, validated: [] });
    const result = await run(ctx, NOW, "DRY_RUN", CUTOFF);
    assert.equal(result.status, "COMPLETED");
    assert.equal(ctx.notifications.notifications.length, 0);
    assert.equal(ctx.notifications.deliveries.length, 0);
    assert.equal(ctx.notifications.issues.length, 0);
    assert.equal(ctx.notifications.runs.length, 1);
    assert.equal(ctx.notifications.runs[0].mode, "DRY_RUN");
    assert.ok(result.summary!.issues.some((item) => item.dedupeKey === "CALENDAR_NOT_VALIDATED:2026")); // descrito, não gravado

    const covered = setup({ enabled: false });
    const simulated = await run(covered, NOW, "DRY_RUN", CUTOFF);
    assert.equal(simulated.summary!.wouldCreate.length, 2);
    assert.match(simulated.summary!.note ?? "", /Simulação/);
    assert.equal(covered.notifications.notifications.length, 0);
    const noCutoff = await run(setup({ enabled: false }), NOW, "DRY_RUN", null);
    assert.equal(noCutoff.summary!.wouldCreate.length, 0);
    assert.match(noCutoff.summary!.note ?? "", /Sem corte/);
  });

  it("sem cobrança retroativa: aviso agendado antes da ativação não é gerado; ciclos anteriores ao corte não geram nada", async () => {
    const late = setup();
    late.notifications.settings = { ...late.notifications.settings, activatedAt: at("2026-11-12T08:00:00-03:00") };
    const result = await run(late);
    assert.equal(result.summary!.skippedBeforeActivation, 1); // escalonamento era de 09/11
    assert.deepEqual(kinds(late), ["OVERDUE"]);

    const future = setup();
    future.notifications.settings = { ...future.notifications.settings, activationCutoff: "2026-11-12", activatedAt: at("2026-11-12T08:00:00-03:00") };
    await run(future);
    assert.equal(future.notifications.notifications.length, 0); // ciclo 12/11 é o primeiro cobrável
  });

  it("projeto não iniciado, suspenso ou sem histórico não gera cobrança", async () => {
    const ctx = setup();
    ctx.notifications.projectList = [
      { id: "p1", name: "Projeto Um", status: "SUSPENSO" }, // suspenso sem evento: INDETERMINADO
      { id: "p2", name: "Não iniciado", status: "NAO_INICIADO" },
      { id: "p3", name: "Sem prova de início", status: "EM_EXECUCAO" },
    ];
    await run(ctx);
    assert.equal(ctx.notifications.notifications.length, 0);
  });
});

describe("gerador de notificações: falhas de calendário e de destinatários", () => {
  it("calendário não validado: bloqueia só o que depende dele, registra a ocorrência uma vez e a resolve ao validar", async () => {
    const ctx = setup({ validated: [] });
    const first = await run(ctx);
    assert.equal(ctx.notifications.notifications.length, 0);
    assert.ok(first.summary!.blockedCalendar >= 1);
    const open = ctx.notifications.issues.filter((item) => item.resolvedAt === null);
    assert.deepEqual(open.map((item) => [item.kind, item.year]), [["CALENDAR_NOT_VALIDATED", 2026]]);

    await run(ctx);
    assert.equal(ctx.notifications.issues.length, 1); // mesma ocorrência, sem duplicar
    assert.equal(ctx.notifications.issues[0].occurrences, 2);

    ctx.validated.add(2026);
    await run(ctx);
    assert.deepEqual(kinds(ctx), ["ESCALATION", "OVERDUE"]);
    assert.equal(ctx.notifications.issues[0].resolution, "AUTO");
  });

  it("sem regra, sem destinatário ativo ou coordenador inativo: nada é cobrado e a ocorrência é registrada", async () => {
    const noRules = setup();
    noRules.notifications.rules = [];
    await run(noRules);
    assert.equal(noRules.notifications.notifications.length, 0);
    assert.deepEqual(noRules.notifications.issues.map((item) => item.dedupeKey).sort(), ["RULE_MISSING:ESCALATION", "RULE_MISSING:OVERDUE", "RULE_MISSING:PREVENTIVE"]);

    const inactive = setup();
    inactive.notifications.users = inactive.notifications.users.map((item) => (item.id === "coord-1" ? { ...item, isActive: false } : item));
    await run(inactive);
    assert.deepEqual(kinds(inactive), ["OVERDUE"]); // o escalonamento fica bloqueado (sem destinatário em TO)
    const keys = inactive.notifications.issues.map((item) => item.dedupeKey).sort();
    assert.deepEqual(keys, ["NO_RECIPIENT:ESCALATION", "RECIPIENT_INACTIVE:coord-1"]);

    // Ao reativar o coordenador, o escalonamento pendente é gerado e as ocorrências se resolvem.
    inactive.notifications.users = inactive.notifications.users.map((item) => (item.id === "coord-1" ? { ...item, isActive: true } : item));
    await run(inactive);
    assert.deepEqual(kinds(inactive), ["ESCALATION", "OVERDUE"]);
    assert.ok(inactive.notifications.issues.every((item) => item.resolution === "AUTO"));
  });

  it("coordenador da CTIN só por usuário específico: usuário sem perfil COORDENADOR em TO não recebe o escalonamento", async () => {
    const ctx = setup();
    ctx.notifications.users = ctx.notifications.users.map((item) => (item.id === "coord-1" ? { ...item, role: "GESTOR" } : item));
    await run(ctx);
    assert.equal(ctx.notifications.notifications.some((row) => row.kind === "ESCALATION"), false);
  });
});

describe("gerador de notificações: resolução e histórico", () => {
  it("validação regular resolve a pendência sem apagar a notificação nem o histórico de ciclos", async () => {
    const ctx = setup();
    await run(ctx);
    const before = ctx.notifications.notifications.map((row) => ({ ...row }));
    ctx.addValidation("2026-11-12", "REGULAR");
    const result = await run(ctx, at("2026-11-13T10:00:00-03:00"));
    assert.equal(result.summary!.resolved.length, 2);
    for (const row of ctx.notifications.notifications) {
      assert.equal(row.resolutionReason, "VALIDATED");
      assert.equal(row.resolvedValidationId, "v-2026-11-12-REGULAR");
      const original = before.find((item) => item.id === row.id)!;
      assert.equal(row.title, original.title);
      assert.equal(row.body, original.body);
      assert.equal(row.dedupeKey, original.dedupeKey);
    }
    assert.equal(ctx.notifications.notifications.length, 2); // nada foi excluído
    assert.equal(ctx.notifications.deliveries.length, 3);

    // Os ciclos vencidos continuam "encerrados sem validação" (a resolução não reescreve o histórico).
    const evidence = await import("../eap/use-cases/get-executive-summary").then((module) => module.loadFollowUpEvidence(ctx.deps.eap, "p1"));
    const core = computeExecutiveFollowUp({
      now: at("2026-11-13T10:00:00-03:00"),
      projectStatus: "EM_EXECUCAO",
      ...evidence,
      regularCycleStarts: new Set(["2026-11-12"]),
      activationCutoff: CUTOFF,
    });
    assert.equal(core.state, "VALIDADO");
    // O histórico não é reescrito: os ciclos vencidos seguem "encerrados sem validação".
    assert.equal(core.unvalidatedSequence?.length, 3);
    assert.equal(core.previousCycle.state, "ENCERRADO_SEM_VALIDACAO");
    // Quem está em dia (ciclo atual validado) não recebe novos avisos de atraso nem escalonamento.
    const upToDate = setup();
    upToDate.addValidation("2026-11-12", "REGULAR");
    await run(upToDate, at("2026-11-13T10:00:00-03:00"));
    assert.equal(upToDate.notifications.notifications.length, 0);
  });

  it("validação extraordinária não resolve a pendência", async () => {
    const ctx = setup();
    await run(ctx);
    ctx.addValidation("2026-11-12", "EXTRAORDINARY");
    const result = await run(ctx, at("2026-11-13T10:00:00-03:00"));
    assert.equal(result.summary!.resolved.length, 0);
    assert.ok(ctx.notifications.notifications.every((row) => row.resolvedAt === null));
  });

  it("suspensão resolve a pendência; aviso preventivo expira ao fim do ciclo", async () => {
    const suspended = setup();
    await run(suspended);
    suspended.notifications.projectList = [{ id: "p1", name: "Projeto Um", status: "SUSPENSO" }];
    suspended.audit("susp", "PROJECT", { automatic: false, from: "EM_EXECUCAO", to: "SUSPENSO" }, "2026-11-13T09:00:00-03:00");
    await run(suspended, at("2026-11-13T10:00:00-03:00"));
    assert.ok(suspended.notifications.notifications.every((row) => row.resolutionReason === "PROJECT_SUSPENDED"));

    const preventive = setup();
    await run(preventive, at("2026-11-17T10:00:00-03:00"));
    const row = () => preventive.notifications.notifications.find((item) => item.kind === "PREVENTIVE")!;
    assert.equal(row().resolvedAt, null);
    await run(preventive, at("2026-11-19T10:00:00-03:00"));
    assert.equal(row().resolutionReason, "CYCLE_EXPIRED");
  });

  it("nova sequência (após validação) gera novo escalonamento; dentro da mesma sequência nunca há dois", async () => {
    const ctx = setup();
    await run(ctx);
    ctx.addValidation("2026-11-12", "REGULAR");
    // Dois ciclos depois sem validação: nova sequência começa em 19/11.
    await run(ctx, at("2026-11-26T10:00:00-03:00"));
    await run(ctx, at("2026-12-07T10:00:00-03:00")); // 25/11 + 10 dias = sábado 05/12; primeiro dia útil: segunda 07/12
    await run(ctx, at("2026-12-08T10:00:00-03:00"));
    const escalations = ctx.notifications.notifications.filter((row) => row.kind === "ESCALATION").map((row) => row.dedupeKey);
    assert.equal(new Set(escalations).size, escalations.length);
    assert.ok(escalations.includes("ESCALATION:p1:2026-10-22"));
    assert.ok(escalations.length >= 2);
  });
});
