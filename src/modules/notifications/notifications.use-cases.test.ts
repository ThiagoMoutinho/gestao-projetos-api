import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../lib/http-error";
import type { AuthUser } from "../../lib/session";
import { createBusinessCalendar } from "../business-calendar/business-days";
import { createEapInMemoryStore, makeEapInMemoryRepos, makeProject, makeUser } from "../eap/test/in-memory";
import { InMemoryNotificationRepository } from "./notifications.in-memory";
import { createRuleBodySchema } from "./notifications.schema";
import { makeNotificationUseCases } from "./notifications.use-cases";

const actor = (role: AuthUser["role"], id: string): AuthUser => ({ id, name: id, email: `${id}@igepps.test`, role });
const admin = actor("ADMIN", "admin-1");
const pmo = actor("PMO", "pmo-1");
const coordinator = actor("COORDENADOR", "coord-1");
const other = actor("GESTOR", "gestor-1");

// Terça-feira 03/11/2026; a próxima quinta-feira é 05/11.
const NOW = new Date("2026-11-03T13:00:00.000Z");

const rejects = (status: number, code: string) => (error: unknown) => error instanceof HttpError && error.statusCode === status && error.code === code;

function setup(options: { validated?: number[]; rules?: boolean } = {}) {
  const notifications = new InMemoryNotificationRepository();
  notifications.users = [
    { id: "admin-1", name: "Admin", email: "a@x.test", role: "ADMIN", isActive: true },
    { id: "pmo-1", name: "PMO", email: "p@x.test", role: "PMO", isActive: true },
    { id: "coord-1", name: "Coord", email: "c@x.test", role: "COORDENADOR", isActive: true },
    { id: "coord-off", name: "Coord inativo", email: "co@x.test", role: "COORDENADOR", isActive: false },
    { id: "gestor-1", name: "Gestor", email: "g@x.test", role: "GESTOR", isActive: true },
  ];
  notifications.projectList = [{ id: "p1", name: "Projeto", status: "EM_EXECUCAO" }];
  const validated = new Set(options.validated ?? [2026]);
  const store = createEapInMemoryStore({ users: [makeUser({ id: "admin-1", role: "ADMIN" })], projects: [makeProject({ id: "p1", ownerId: "admin-1" })] });
  const useCases = makeNotificationUseCases({
    notifications,
    eap: makeEapInMemoryRepos(store),
    loadCalendar: async () => createBusinessCalendar([], validated),
    validatedCalendarYears: async () => validated,
  });
  const addAllRules = async () => {
    await useCases.createRule(admin, { kind: "PREVENTIVE", source: "ROLE", role: "PMO", visibility: "TO", justification: "Aviso ao PMO." });
    await useCases.createRule(admin, { kind: "OVERDUE", source: "ROLE", role: "PMO", visibility: "TO", justification: "Atraso ao PMO." });
    await useCases.createRule(admin, { kind: "ESCALATION", source: "USER", userId: "coord-1", visibility: "TO", justification: "Coordenador da CTIN." });
    await useCases.createRule(admin, { kind: "ESCALATION", source: "ROLE", role: "PMO", visibility: "CC", justification: "Cópia ao PMO." });
  };
  return { notifications, useCases, addAllRules };
}

const activation = { cutoff: "2026-11-05", justification: "Início oficial da operação.", confirm: "ATIVAR" as const };

describe("notificações: permissões", () => {
  it("só o ADMIN altera; o PMO consulta; os demais perfis não acessam a administração", async () => {
    const ctx = setup();
    await ctx.addAllRules();
    for (const call of [
      () => ctx.useCases.activate(pmo, activation, NOW),
      () => ctx.useCases.deactivate(pmo, { justification: "Teste de permissão." }),
      () => ctx.useCases.createRule(pmo, { kind: "OVERDUE", source: "ROLE", role: "ADMIN", visibility: "CC", justification: "Teste de permissão." }),
      () => ctx.useCases.updateRule(pmo, "x", { enabled: false, justification: "Teste de permissão." }),
      () => ctx.useCases.resolveIssue(pmo, "x", "Teste de permissão."),
      () => ctx.useCases.dryRun(pmo, {}),
      () => ctx.useCases.listSettingsChanges(pmo),
    ]) {
      await assert.rejects(call, rejects(403, "NOTIFICATIONS_FORBIDDEN"));
    }
    assert.equal((await ctx.useCases.getSettings(pmo)).canManage, false);
    assert.equal((await ctx.useCases.listRules(pmo)).canManage, false);
    assert.equal((await ctx.useCases.getSettings(admin)).canManage, true);
    for (const user of [coordinator, other]) {
      await assert.rejects(() => ctx.useCases.getSettings(user), rejects(403, "NOTIFICATIONS_FORBIDDEN"));
      await assert.rejects(() => ctx.useCases.listRules(user), rejects(403, "NOTIFICATIONS_FORBIDDEN"));
      await assert.rejects(() => ctx.useCases.listIssues(user, { limit: 10 }), rejects(403, "NOTIFICATIONS_FORBIDDEN"));
      await assert.rejects(() => ctx.useCases.listNotifications(user, { limit: 10 }), rejects(403, "NOTIFICATIONS_FORBIDDEN"));
      await assert.rejects(() => ctx.useCases.listRuns(user), rejects(403, "NOTIFICATIONS_FORBIDDEN"));
    }
  });

  it("caixa de entrada: cada pessoa lê só as próprias entregas; ler é idempotente e separado da resolução", async () => {
    const ctx = setup();
    const repo = ctx.notifications;
    repo.settings = { ...repo.settings, activationEnabled: true, activationCutoff: "2026-10-22", activatedAt: new Date("2026-10-20T00:00:00Z"), activatedBy: "admin-1" };
    await repo.createNotification(
      { id: "n1", projectId: "p1", kind: "OVERDUE", cycleStart: "2026-10-29", sequenceStart: null, dueDate: "2026-11-04", scheduledFor: NOW, dedupeKey: "k1", title: "t", body: "b", followupSnapshot: {}, runId: "r" },
      [
        { id: "d-pmo", userId: "pmo-1", recipientName: "PMO", recipientEmail: "p@x.test", recipientRole: "PMO", visibility: "TO" },
        { id: "d-coord", userId: "coord-1", recipientName: "Coord", recipientEmail: "c@x.test", recipientRole: "COORDENADOR", visibility: "CC" },
      ],
    );
    const mine = await ctx.useCases.listInbox(pmo, { unread: false, limit: 10 });
    assert.deepEqual(mine.data.map((item) => item.deliveryId), ["d-pmo"]);
    assert.equal(mine.unread, 1);
    assert.equal((await ctx.useCases.listInbox(other, { unread: false, limit: 10 })).data.length, 0);

    await assert.rejects(() => ctx.useCases.markRead(other, "d-pmo"), rejects(404, "NOTIFICATION_DELIVERY_NOT_FOUND"));
    await assert.rejects(() => ctx.useCases.markRead(coordinator, "d-pmo"), rejects(404, "NOTIFICATION_DELIVERY_NOT_FOUND"));
    const first = await ctx.useCases.markRead(pmo, "d-pmo", NOW);
    const second = await ctx.useCases.markRead(pmo, "d-pmo", new Date("2026-11-04T10:00:00Z"));
    assert.equal(second.readAt, first.readAt); // a primeira leitura é preservada
    assert.equal((await ctx.useCases.listInbox(pmo, { unread: false, limit: 10 })).unread, 0);
    assert.equal(repo.notifications[0].resolvedAt, null); // ler não resolve a pendência
  });
});

describe("notificações: ativação", () => {
  it("exige corte numa quinta-feira, sem retroagir, confirmação e justificativa", async () => {
    const ctx = setup();
    await ctx.addAllRules();
    await assert.rejects(() => ctx.useCases.activate(admin, { ...activation, cutoff: "2026-11-06" }, NOW), rejects(400, "NOTIFICATIONS_CUTOFF_NOT_THURSDAY"));
    await assert.rejects(() => ctx.useCases.activate(admin, { ...activation, cutoff: "2026-10-29" }, NOW), rejects(400, "NOTIFICATIONS_CUTOFF_IN_PAST"));
    assert.equal((await ctx.notifications.getSettings()).activationEnabled, false);
  });

  it("exige destinatário ativo em TO para cada tipo de aviso", async () => {
    const ctx = setup();
    await assert.rejects(() => ctx.useCases.activate(admin, activation, NOW), rejects(422, "NOTIFICATIONS_RECIPIENTS_MISSING"));
    await ctx.useCases.createRule(admin, { kind: "PREVENTIVE", source: "ROLE", role: "PMO", visibility: "TO", justification: "Aviso ao PMO." });
    await ctx.useCases.createRule(admin, { kind: "OVERDUE", source: "ROLE", role: "PMO", visibility: "TO", justification: "Atraso ao PMO." });
    await assert.rejects(() => ctx.useCases.activate(admin, activation, NOW), rejects(422, "NOTIFICATIONS_RECIPIENTS_MISSING")); // falta o escalonamento
    // Cópia (CC) não substitui o destinatário em TO.
    await ctx.useCases.createRule(admin, { kind: "ESCALATION", source: "ROLE", role: "PMO", visibility: "CC", justification: "Cópia ao PMO." });
    await assert.rejects(() => ctx.useCases.activate(admin, activation, NOW), rejects(422, "NOTIFICATIONS_RECIPIENTS_MISSING"));
    assert.equal((await ctx.notifications.getSettings()).activationEnabled, false);
  });

  it("exige calendário validado para os anos necessários, e só eles", async () => {
    const missing = setup({ validated: [] });
    await missing.addAllRules();
    await assert.rejects(() => missing.useCases.activate(admin, activation, NOW), rejects(409, "NOTIFICATIONS_CALENDAR_NOT_READY"));

    // 2026 validado basta: o ano seguinte não é exigido quando a janela inicial não o alcança.
    const ok = setup({ validated: [2026] });
    await ok.addAllRules();
    const settings = await ok.useCases.activate(admin, activation, NOW);
    assert.equal(settings.activationEnabled, true);
    assert.equal(settings.activationCutoff, "2026-11-05");

    // Corte no fim do ano: a janela inicial alcança 2027, que passa a ser exigido.
    const yearEnd = setup({ validated: [2026] });
    await yearEnd.addAllRules();
    await assert.rejects(() => yearEnd.useCases.activate(admin, { ...activation, cutoff: "2026-12-31" }, NOW), rejects(409, "NOTIFICATIONS_CALENDAR_NOT_READY"));
  });

  it("ativa com auditoria; não ativa duas vezes; desativa com justificativa; reativar exige novo corte", async () => {
    const ctx = setup();
    await ctx.addAllRules();
    await ctx.useCases.activate(admin, activation, NOW);
    const settings = await ctx.notifications.getSettings();
    assert.equal(settings.activatedBy, "admin-1");
    assert.equal(settings.activatedAt?.toISOString(), NOW.toISOString());
    const activate = ctx.notifications.changes.find((change) => change.action === "ACTIVATE")!;
    assert.equal(activate.justification, "Início oficial da operação.");
    assert.deepEqual(activate.after, { activationEnabled: true, activationCutoff: "2026-11-05" });

    await assert.rejects(() => ctx.useCases.activate(admin, activation, NOW), rejects(409, "NOTIFICATIONS_ALREADY_ACTIVE"));
    await ctx.useCases.deactivate(admin, { justification: "Pausa para ajustes." });
    assert.equal((await ctx.notifications.getSettings()).activationEnabled, false);
    await assert.rejects(() => ctx.useCases.deactivate(admin, { justification: "Pausa para ajustes." }), rejects(409, "NOTIFICATIONS_ALREADY_INACTIVE"));
    await ctx.useCases.activate(admin, { ...activation, cutoff: "2026-11-12" }, NOW);
    assert.equal((await ctx.notifications.getSettings()).activationCutoff, "2026-11-12");
    assert.deepEqual(ctx.notifications.changes.map((change) => change.action), ["RULE_CREATE", "RULE_CREATE", "RULE_CREATE", "RULE_CREATE", "ACTIVATE", "DEACTIVATE", "ACTIVATE"]);
  });
});

describe("notificações: regras de destinatários", () => {
  it("o perfil global COORDENADOR não é aceito; o coordenador da CTIN é um usuário específico", async () => {
    assert.equal(createRuleBodySchema.safeParse({ kind: "ESCALATION", source: "ROLE", role: "COORDENADOR", visibility: "TO", justification: "Teste." }).success, false);
    assert.equal(createRuleBodySchema.safeParse({ kind: "ESCALATION", source: "ROLE", visibility: "TO", justification: "Teste de regra." }).success, false);
    assert.equal(createRuleBodySchema.safeParse({ kind: "ESCALATION", source: "USER", userId: "coord-1", role: "PMO", visibility: "TO", justification: "Teste de regra." }).success, false);

    const ctx = setup();
    const rule = await ctx.useCases.createRule(admin, { kind: "ESCALATION", source: "USER", userId: "coord-1", visibility: "TO", justification: "Coordenador da CTIN." });
    assert.equal(rule.userName, "Coord");
    await assert.rejects(() => ctx.useCases.createRule(admin, { kind: "ESCALATION", source: "USER", userId: "gestor-1", visibility: "TO", justification: "Usuário errado." }), rejects(400, "NOTIFICATIONS_ESCALATION_NOT_COORDINATOR"));
    await assert.rejects(() => ctx.useCases.createRule(admin, { kind: "ESCALATION", source: "USER", userId: "coord-off", visibility: "TO", justification: "Usuário inativo." }), rejects(409, "NOTIFICATIONS_USER_INACTIVE"));
    await assert.rejects(() => ctx.useCases.createRule(admin, { kind: "ESCALATION", source: "USER", userId: "ninguem", visibility: "TO", justification: "Usuário inexistente." }), rejects(404, "NOTIFICATIONS_USER_NOT_FOUND"));
    await assert.rejects(() => ctx.useCases.createRule(admin, { kind: "ESCALATION", source: "USER", userId: "coord-1", visibility: "TO", justification: "Duplicada." }), rejects(409, "NOTIFICATIONS_RULE_CONFLICT"));
  });

  it("alteração de regra fica no histórico imutável com antes e depois; regras não são excluídas", async () => {
    const ctx = setup();
    const rule = await ctx.useCases.createRule(admin, { kind: "OVERDUE", source: "ROLE", role: "PMO", visibility: "TO", justification: "Atraso ao PMO." });
    const updated = await ctx.useCases.updateRule(admin, rule.id, { enabled: false, justification: "Pausa temporária." });
    assert.equal(updated.enabled, false);
    const change = ctx.notifications.changes.at(-1)!;
    assert.equal(change.action, "RULE_UPDATE");
    assert.equal((change.before as { enabled: boolean }).enabled, true);
    assert.equal((change.after as { enabled: boolean }).enabled, false);
    assert.equal((await ctx.useCases.listRules(pmo)).data.length, 1);
    await assert.rejects(() => ctx.useCases.updateRule(admin, "inexistente", { enabled: true, justification: "Não existe." }), rejects(404, "NOTIFICATIONS_RULE_NOT_FOUND"));
  });
});

describe("notificações: ocorrências e simulação pela API", () => {
  it("o ADMIN resolve uma ocorrência com nota; não resolve duas vezes", async () => {
    const ctx = setup();
    ctx.notifications.settings = { ...ctx.notifications.settings, activationEnabled: true, activationCutoff: "2026-11-05", activatedAt: NOW, activatedBy: "admin-1" };
    await ctx.notifications.upsertIssue({ id: "i1", kind: "NO_RECIPIENT", dedupeKey: "NO_RECIPIENT:OVERDUE", year: null, details: {} }, NOW);
    const resolved = await ctx.useCases.resolveIssue(admin, "i1", "Destinatário cadastrado.");
    assert.equal(resolved.resolution, "MANUAL");
    assert.equal(resolved.resolutionNote, "Destinatário cadastrado.");
    await assert.rejects(() => ctx.useCases.resolveIssue(admin, "i1", "Outra vez."), rejects(409, "NOTIFICATIONS_ISSUE_RESOLVED"));
    await assert.rejects(() => ctx.useCases.resolveIssue(admin, "nao-existe", "Não existe."), rejects(404, "NOTIFICATIONS_ISSUE_NOT_FOUND"));
    assert.equal((await ctx.useCases.listIssues(pmo, { open: true, limit: 10 })).data.length, 0);
  });

  it("a simulação pela API só registra a execução técnica: nada de avisos, entregas ou ocorrências", async () => {
    const ctx = setup();
    const run = await ctx.useCases.dryRun(admin, { cutoff: "2026-11-05" }, NOW);
    assert.equal(run.mode, "DRY_RUN");
    assert.equal(run.origin, "API");
    assert.equal(run.status, "COMPLETED");
    assert.equal(ctx.notifications.notifications.length, 0);
    assert.equal(ctx.notifications.deliveries.length, 0);
    assert.equal(ctx.notifications.issues.length, 0);
    await assert.rejects(() => ctx.useCases.dryRun(admin, { cutoff: "2026-11-06" }, NOW), rejects(400, "NOTIFICATIONS_CUTOFF_NOT_THURSDAY"));
    assert.equal((await ctx.useCases.listRuns(pmo)).data.length, 1);
  });
});

describe("notificações: paginação por cursor, filtros e detalhe (Etapa 3.5A)", () => {
  type Seed = { id: string; kind?: string; projectId?: string; createdAt: Date; resolved?: boolean };

  /** Semeia direto na memória (sem passar pelo gerador): muitas notificações com a MESMA data para exercitar o desempate. */
  function seed(ctx: ReturnType<typeof setup>, rows: Seed[], recipients: Array<{ userId: string; readAt?: Date | null; visibility?: "TO" | "CC" }> = [{ userId: "pmo-1" }]) {
    for (const row of rows) {
      ctx.notifications.notifications.push({
        id: row.id,
        projectId: row.projectId ?? "p1",
        kind: row.kind ?? "OVERDUE",
        cycleStart: "2026-10-29",
        sequenceStart: null,
        dueDate: "2026-11-04",
        scheduledFor: row.createdAt,
        dedupeKey: `k-${row.id}`,
        title: `Título ${row.id}`,
        body: `Corpo congelado ${row.id}`,
        followupSnapshot: {},
        runId: "run-1",
        createdAt: row.createdAt,
        resolvedAt: row.resolved ? row.createdAt : null,
        resolutionReason: row.resolved ? "VALIDATED" : null,
        resolvedValidationId: row.resolved ? "v1" : null,
        resolvedRunId: row.resolved ? "run-2" : null,
      });
      for (const recipient of recipients) {
        ctx.notifications.deliveries.push({
          id: `d-${row.id}-${recipient.userId}`,
          notificationId: row.id,
          userId: recipient.userId,
          recipientName: recipient.userId,
          recipientEmail: `${recipient.userId}@x.test`,
          recipientRole: "PMO",
          visibility: recipient.visibility ?? "TO",
          deliveredAt: row.createdAt,
          readAt: recipient.readAt ?? null,
        });
      }
    }
  }

  const SAME = new Date("2026-11-12T13:00:00.000Z");
  const ids = (count: number, prefix = "n") => Array.from({ length: count }, (_, index) => `${prefix}${String(index).padStart(3, "0")}`);

  async function walk(fetchPage: (cursor?: string) => Promise<{ data: Array<{ id?: string; deliveryId?: string }>; nextCursor: string | null }>) {
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await fetchPage(cursor);
      seen.push(...page.data.map((item) => (item.id ?? item.deliveryId) as string));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor && pages < 100);
    return { seen, pages };
  }

  it("a paginação não repete nem perde registros, mesmo com datas idênticas (desempate pelo id)", async () => {
    const ctx = setup();
    seed(ctx, ids(25).map((id) => ({ id, createdAt: SAME })));
    const all = await walk((cursor) => ctx.useCases.listNotifications(pmo, { cursor, limit: 7 }));
    assert.equal(all.pages, 4);
    assert.equal(all.seen.length, 25);
    assert.equal(new Set(all.seen).size, 25);
    assert.deepEqual(all.seen, [...ids(25)].sort().reverse()); // ordem estável: data decrescente e, no empate, id decrescente
    const inbox = await walk((cursor) => ctx.useCases.listInbox(pmo, { cursor, limit: 7 }));
    assert.equal(inbox.seen.length, 25);
    assert.equal(new Set(inbox.seen).size, 25);
  });

  it("notificações criadas durante a navegação não duplicam nem fazem perder registros das páginas seguintes", async () => {
    const ctx = setup();
    const originals = ids(20, "o").map((id, index) => ({ id, createdAt: new Date(SAME.getTime() - index * 1000) }));
    seed(ctx, originals);
    const first = await ctx.useCases.listNotifications(pmo, { limit: 8 });
    // Chegam avisos novos (mais recentes) enquanto a pessoa ainda está na primeira página.
    seed(ctx, ids(5, "novo").map((id, index) => ({ id, createdAt: new Date(SAME.getTime() + (index + 1) * 1000) })));
    const seen = first.data.map((item) => item.id);
    let cursor = first.nextCursor ?? undefined;
    while (cursor) {
      const page = await ctx.useCases.listNotifications(pmo, { cursor, limit: 8 });
      seen.push(...page.data.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
    }
    assert.deepEqual(seen, originals.map((item) => item.id)); // exatamente os 20 originais, em ordem, sem os novos e sem repetir
    const refreshed = await ctx.useCases.listNotifications(pmo, { limit: 8 });
    assert.deepEqual(refreshed.data.slice(0, 5).map((item) => item.id), ["novo004", "novo003", "novo002", "novo001", "novo000"]); // os novos aparecem ao atualizar
  });

  it("filtros por tipo, projeto, leitura e pendência; resolvidas permanecem no histórico", async () => {
    const ctx = setup();
    seed(ctx, [
      { id: "a1", kind: "PREVENTIVE", projectId: "p1", createdAt: new Date(SAME.getTime() - 1000) },
      { id: "a2", kind: "OVERDUE", projectId: "p1", createdAt: new Date(SAME.getTime() - 2000), resolved: true },
      { id: "a3", kind: "ESCALATION", projectId: "p2", createdAt: new Date(SAME.getTime() - 3000) },
    ]);
    ctx.notifications.deliveries.find((delivery) => delivery.notificationId === "a1")!.readAt = SAME;
    const list = (filter: object) => ctx.useCases.listNotifications(pmo, { limit: 10, ...filter }).then((page) => page.data.map((item) => item.id));
    assert.deepEqual(await list({}), ["a1", "a2", "a3"]);
    assert.deepEqual(await list({ kind: "ESCALATION" }), ["a3"]);
    assert.deepEqual(await list({ projectId: "p1" }), ["a1", "a2"]);
    assert.deepEqual(await list({ resolved: true }), ["a2"]);
    assert.deepEqual(await list({ resolved: false }), ["a1", "a3"]); // resolvida não some: só muda de filtro
    assert.deepEqual(await list({ unread: true }), ["a2", "a3"]);
    assert.deepEqual(await list({ unread: false }), ["a1"]);
    const mine = (filter: object) => ctx.useCases.listInbox(pmo, { limit: 10, ...filter }).then((page) => page.data.map((item) => item.notification.id));
    assert.deepEqual(await mine({ read: false }), ["a2", "a3"]);
    assert.deepEqual(await mine({ read: true }), ["a1"]);
    assert.deepEqual(await mine({ unread: true }), ["a2", "a3"]); // compatível com a versão anterior
    assert.deepEqual(await mine({ kind: "OVERDUE", resolved: true }), ["a2"]);
    assert.deepEqual(await mine({ projectId: "p2" }), ["a3"]);
    // Ler não resolve: a1 foi lida e continua pendente.
    assert.equal(ctx.notifications.notifications.find((row) => row.id === "a1")!.resolvedAt, null);
  });

  it("o contador de não lidas é exato (sem teto) e independe da página e dos filtros", async () => {
    const ctx = setup();
    seed(ctx, ids(1100).map((id) => ({ id, createdAt: SAME })));
    const page = await ctx.useCases.listInbox(pmo, { limit: 5, kind: "PREVENTIVE" });
    assert.equal(page.unread, 1100);
    assert.equal(page.data.length, 0);
  });

  it("cursor inválido ou adulterado é recusado; o cursor de uma pessoa não revela dados de outra", async () => {
    const ctx = setup();
    seed(ctx, ids(12).map((id) => ({ id, createdAt: SAME })), [{ userId: "pmo-1" }, { userId: "coord-1", visibility: "CC" }]);
    for (const bad of ["lixo", Buffer.from("{}").toString("base64url"), Buffer.from(JSON.stringify({ ts: "ontem", id: "x" })).toString("base64url")]) {
      await assert.rejects(() => ctx.useCases.listNotifications(pmo, { cursor: bad, limit: 5 }), rejects(400, "NOTIFICATIONS_INVALID_CURSOR"));
      await assert.rejects(() => ctx.useCases.listInbox(pmo, { cursor: bad, limit: 5 }), rejects(400, "NOTIFICATIONS_INVALID_CURSOR"));
    }
    const page = await ctx.useCases.listInbox(pmo, { limit: 5 });
    const asCoord = await ctx.useCases.listInbox(coordinator, { cursor: page.nextCursor ?? undefined, limit: 50 });
    assert.ok(asCoord.data.every((item) => item.deliveryId.endsWith("coord-1")));
    assert.equal((await ctx.useCases.listInbox(other, { limit: 50 })).data.length, 0);
  });

  it("detalhe: ADMIN e PMO veem os destinatários e a leitura de cada um; os demais perfis recebem 403", async () => {
    const ctx = setup();
    seed(ctx, [{ id: "d1", createdAt: SAME }], [
      { userId: "coord-1", visibility: "TO", readAt: SAME },
      { userId: "pmo-1", visibility: "CC" },
    ]);
    for (const viewer of [admin, pmo]) {
      const detail = await ctx.useCases.getNotification(viewer, "d1");
      assert.equal(detail.title, "Título d1");
      assert.equal(detail.body, "Corpo congelado d1"); // conteúdo congelado, sem reescrita
      assert.equal(detail.recipients, 2);
      assert.equal(detail.unread, 1);
      assert.deepEqual(detail.deliveries.map((delivery) => [delivery.userId, delivery.visibility, delivery.readAt !== null]), [["coord-1", "TO", true], ["pmo-1", "CC", false]]);
    }
    for (const viewer of [coordinator, other]) {
      await assert.rejects(() => ctx.useCases.getNotification(viewer, "d1"), rejects(403, "NOTIFICATIONS_FORBIDDEN"));
    }
    await assert.rejects(() => ctx.useCases.getNotification(admin, "nao-existe"), rejects(404, "NOTIFICATION_NOT_FOUND"));
  });
});
