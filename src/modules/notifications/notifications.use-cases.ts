import { HttpError } from "../../lib/http-error";
import type { AuthUser } from "../../lib/session";
import { addCalendarDays, calendarReadiness } from "../business-calendar/business-days";
import { civilDay } from "../eap/use-cases/executive-cycle";
import { runNotificationGenerator, type GeneratorDeps } from "./notification-generator";
import { NOTIFICATION_KINDS, resolveRecipients, type RecipientUser } from "./notification-planning";
import { RuleConflictError, type PageCursor, type InboxItem, type IssueRow, type NotificationListItem, type NotificationRepository, type RuleRow, type RunRow } from "./notifications.repository";
import { deriveSchedulerHealth, LIVE_SECONDS } from "./scheduler-health";
import type { SchedulerRepository } from "./scheduler.repository";
import type { ActivateInput, CreateRuleInput, DeactivateInput, UpdateRuleInput } from "./notifications.schema";

/** Só o ADMIN altera a configuração, as regras de destinatários e as ocorrências. */
export function canManageNotifications(actor: AuthUser) {
  return actor.role === "ADMIN";
}

/** ADMIN e PMO consultam a configuração, os avisos de todos os projetos, as ocorrências e as execuções. */
export function canReadNotificationsAdmin(actor: AuthUser) {
  return actor.role === "ADMIN" || actor.role === "PMO";
}

const forbiddenManage = () => new HttpError(403, "Somente o ADMIN altera a configuração das notificações.", "NOTIFICATIONS_FORBIDDEN");
const forbiddenRead = () => new HttpError(403, "Você não tem permissão para consultar a administração das notificações.", "NOTIFICATIONS_FORBIDDEN");

const iso = (value: Date | null) => (value ? value.toISOString() : null);

/** A data (AAAA-MM-DD) cai numa quinta-feira? */
function isThursday(day: string) {
  return new Date(`${day}T00:00:00.000Z`).getUTCDay() === 4;
}

/** Janela do calendário necessária ao início da operação: de hoje até 45 dias depois do corte (primeiros avisos e escalonamento). */
const ACTIVATION_CALENDAR_AHEAD_DAYS = 45;

export function toNotificationItem(row: NotificationListItem) {
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.projectName,
    kind: row.kind as "PREVENTIVE" | "OVERDUE" | "ESCALATION",
    cycleStart: row.cycleStart,
    sequenceStart: row.sequenceStart,
    dueDate: row.dueDate,
    scheduledFor: row.scheduledFor.toISOString(),
    title: row.title,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: iso(row.resolvedAt),
    resolutionReason: row.resolutionReason,
    recipients: row.recipients,
    unread: row.unread,
  };
}

function toInboxItem(item: InboxItem) {
  const { notification } = item;
  return {
    deliveryId: item.delivery.id,
    visibility: item.delivery.visibility as "TO" | "CC",
    deliveredAt: item.delivery.deliveredAt.toISOString(),
    readAt: iso(item.delivery.readAt),
    notification: {
      id: notification.id,
      projectId: notification.projectId,
      projectName: item.projectName,
      kind: notification.kind as "PREVENTIVE" | "OVERDUE" | "ESCALATION",
      cycleStart: notification.cycleStart,
      sequenceStart: notification.sequenceStart,
      dueDate: notification.dueDate,
      scheduledFor: notification.scheduledFor.toISOString(),
      title: notification.title,
      body: notification.body,
      createdAt: notification.createdAt.toISOString(),
      resolvedAt: iso(notification.resolvedAt),
      resolutionReason: notification.resolutionReason,
    },
  };
}

function toIssue(row: IssueRow) {
  return {
    id: row.id,
    kind: row.kind as "CALENDAR_NOT_VALIDATED" | "NO_RECIPIENT" | "RECIPIENT_INACTIVE" | "RULE_MISSING",
    year: row.year,
    details: row.details as Record<string, unknown>,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    occurrences: row.occurrences,
    resolvedAt: iso(row.resolvedAt),
    resolution: row.resolution as "AUTO" | "MANUAL" | null,
    resolutionNote: row.resolutionNote,
  };
}

function toRun(row: RunRow) {
  return {
    id: row.id,
    mode: row.mode as "DRY_RUN" | "ACTIVE",
    origin: row.origin as "CLI" | "API",
    status: row.status as "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED_LOCKED",
    startedAt: row.startedAt.toISOString(),
    finishedAt: iso(row.finishedAt),
    asOf: row.asOf.toISOString(),
    simulatedCutoff: row.simulatedCutoff,
    createdNotifications: row.createdNotifications,
    resolvedNotifications: row.resolvedNotifications,
    issuesSeen: row.issuesSeen,
    summary: row.summary ?? null,
    error: row.error,
  };
}

function ruleSnapshot(rule: RuleRow) {
  return { id: rule.id, kind: rule.kind, source: rule.source, role: rule.role, userId: rule.userId, visibility: rule.visibility, enabled: rule.enabled };
}

/** Cursor opaco: posição (data com microssegundos + id) codificada; o cliente só o devolve. */
export function encodeCursor(cursor: PageCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(raw: string | undefined): PageCursor | undefined {
  if (raw === undefined) return undefined;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<PageCursor>;
    if (typeof value.ts === "string" && typeof value.id === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/.test(value.ts) && value.id.length > 0 && value.id.length <= 100) {
      return { ts: value.ts, id: value.id };
    }
  } catch {
    // cai no erro abaixo
  }
  throw new HttpError(400, "Cursor de paginação inválido.", "NOTIFICATIONS_INVALID_CURSOR");
}

export function makeNotificationUseCases(deps: GeneratorDeps & { scheduler?: SchedulerRepository }) {
  const repo: NotificationRepository = deps.notifications;

  async function toRuleDto(rule: RuleRow, users: ReadonlyMap<string, RecipientUser>) {
    return {
      id: rule.id,
      kind: rule.kind as "PREVENTIVE" | "OVERDUE" | "ESCALATION",
      source: rule.source as "ROLE" | "USER",
      role: rule.role,
      userId: rule.userId,
      userName: rule.userId ? (users.get(rule.userId)?.name ?? null) : null,
      visibility: rule.visibility as "TO" | "CC",
      enabled: rule.enabled,
    };
  }

  const usersMap = async () => new Map((await repo.listUsers()).map((item) => [item.id, item]));

  return {
    async getSettings(actor: AuthUser) {
      if (!canReadNotificationsAdmin(actor)) throw forbiddenRead();
      const settings = await repo.getSettings();
      return {
        activationEnabled: settings.activationEnabled,
        activationCutoff: settings.activationCutoff,
        activatedAt: iso(settings.activatedAt),
        canManage: canManageNotifications(actor),
      };
    },

    async listSettingsChanges(actor: AuthUser) {
      if (!canManageNotifications(actor)) throw forbiddenManage();
      const rows = await repo.listSettingsChanges(100);
      return {
        data: rows.map((row) => ({
          id: row.id,
          action: row.action,
          before: row.before ?? null,
          after: row.after ?? null,
          justification: row.justification,
          actorId: row.actorId,
          actorName: row.actorName,
          createdAt: row.createdAt.toISOString(),
        })),
      };
    },

    /**
     * Liga as notificações. Exige confirmação, justificativa, corte numa quinta-feira de hoje em diante (nunca retroage),
     * destinatário ativo em TO para cada tipo de aviso e calendário validado para o período inicial da operação.
     */
    async activate(actor: AuthUser, input: ActivateInput, now = new Date()) {
      if (!canManageNotifications(actor)) throw forbiddenManage();
      const today = civilDay(now);
      if (!isThursday(input.cutoff)) {
        throw new HttpError(400, "O corte de ativação deve ser uma quinta-feira, início de um ciclo semanal.", "NOTIFICATIONS_CUTOFF_NOT_THURSDAY");
      }
      if (input.cutoff < today) {
        throw new HttpError(400, "O corte de ativação não pode retroagir: informe a quinta-feira de hoje ou futura.", "NOTIFICATIONS_CUTOFF_IN_PAST");
      }
      const current = await repo.getSettings();
      if (current.activationEnabled) {
        throw new HttpError(409, "As notificações já estão ativadas. Desative antes de definir um novo corte.", "NOTIFICATIONS_ALREADY_ACTIVE");
      }

      const [rules, users] = await Promise.all([repo.listRules(), usersMap()]);
      const missing = NOTIFICATION_KINDS.filter((kind) => resolveRecipients(kind, rules, users).to.length === 0);
      if (missing.length > 0) {
        throw new HttpError(
          422,
          `Cadastre ao menos um destinatário ativo em TO para: ${missing.join(", ")}.`,
          "NOTIFICATIONS_RECIPIENTS_MISSING",
        );
      }

      const readiness = calendarReadiness(today, addCalendarDays(input.cutoff, ACTIVATION_CALENDAR_AHEAD_DAYS), await deps.validatedCalendarYears());
      if (!readiness.ready) {
        throw new HttpError(
          409,
          `Calendário institucional não validado para ${readiness.missingYears.join(", ")}, necessário ao início da operação.`,
          "NOTIFICATIONS_CALENDAR_NOT_READY",
        );
      }

      return repo.transaction(async (store) => {
        const settings = await store.updateSettings({ activationEnabled: true, activationCutoff: input.cutoff, activatedAt: now, activatedBy: actor.id });
        await store.appendSettingsChange({
          id: crypto.randomUUID(),
          action: "ACTIVATE",
          before: { activationEnabled: false, activationCutoff: current.activationCutoff },
          after: { activationEnabled: true, activationCutoff: input.cutoff },
          justification: input.justification,
          actorId: actor.id,
        });
        return { activationEnabled: settings.activationEnabled, activationCutoff: settings.activationCutoff, activatedAt: iso(settings.activatedAt), canManage: true };
      });
    },

    async deactivate(actor: AuthUser, input: DeactivateInput) {
      if (!canManageNotifications(actor)) throw forbiddenManage();
      const current = await repo.getSettings();
      if (!current.activationEnabled) {
        throw new HttpError(409, "As notificações já estão desativadas.", "NOTIFICATIONS_ALREADY_INACTIVE");
      }
      return repo.transaction(async (store) => {
        const settings = await store.updateSettings({ activationEnabled: false });
        await store.appendSettingsChange({
          id: crypto.randomUUID(),
          action: "DEACTIVATE",
          before: { activationEnabled: true, activationCutoff: current.activationCutoff },
          after: { activationEnabled: false },
          justification: input.justification,
          actorId: actor.id,
        });
        return { activationEnabled: settings.activationEnabled, activationCutoff: settings.activationCutoff, activatedAt: iso(settings.activatedAt), canManage: true };
      });
    },

    async listRules(actor: AuthUser) {
      if (!canReadNotificationsAdmin(actor)) throw forbiddenRead();
      const [rules, users] = await Promise.all([repo.listRules(), usersMap()]);
      return { data: await Promise.all(rules.map((rule) => toRuleDto(rule, users))), canManage: canManageNotifications(actor) };
    },

    async createRule(actor: AuthUser, input: CreateRuleInput) {
      if (!canManageNotifications(actor)) throw forbiddenManage();
      if (input.source === "USER") {
        const target = await repo.getUser(input.userId!);
        if (!target) throw new HttpError(404, "Usuário não encontrado.", "NOTIFICATIONS_USER_NOT_FOUND");
        if (!target.isActive) throw new HttpError(409, "Usuário inativo não pode ser destinatário.", "NOTIFICATIONS_USER_INACTIVE");
        if (input.kind === "ESCALATION" && input.visibility === "TO" && target.role !== "COORDENADOR") {
          throw new HttpError(400, "O destinatário do escalonamento deve ser o coordenador da CTIN (usuário com perfil COORDENADOR).", "NOTIFICATIONS_ESCALATION_NOT_COORDINATOR");
        }
      }
      try {
        return await repo.transaction(async (store) => {
          const rule = await store.insertRule({
            id: crypto.randomUUID(),
            kind: input.kind,
            source: input.source,
            role: input.role ?? null,
            userId: input.userId ?? null,
            visibility: input.visibility,
            createdBy: actor.id,
          });
          await store.appendSettingsChange({
            id: crypto.randomUUID(),
            action: "RULE_CREATE",
            before: null,
            after: ruleSnapshot(rule),
            justification: input.justification,
            actorId: actor.id,
          });
          return toRuleDto(rule, await usersMap());
        });
      } catch (error) {
        if (error instanceof RuleConflictError) {
          throw new HttpError(409, "Já existe uma regra igual.", "NOTIFICATIONS_RULE_CONFLICT");
        }
        throw error;
      }
    },

    async updateRule(actor: AuthUser, id: string, input: UpdateRuleInput) {
      if (!canManageNotifications(actor)) throw forbiddenManage();
      const current = await repo.getRule(id);
      if (!current) throw new HttpError(404, "Regra não encontrada.", "NOTIFICATIONS_RULE_NOT_FOUND");
      try {
        return await repo.transaction(async (store) => {
          const updated = await store.updateRule(id, { enabled: input.enabled, visibility: input.visibility, updatedBy: actor.id });
          if (!updated) throw new HttpError(404, "Regra não encontrada.", "NOTIFICATIONS_RULE_NOT_FOUND");
          await store.appendSettingsChange({
            id: crypto.randomUUID(),
            action: "RULE_UPDATE",
            before: ruleSnapshot(current),
            after: ruleSnapshot(updated),
            justification: input.justification,
            actorId: actor.id,
          });
          return toRuleDto(updated, await usersMap());
        });
      } catch (error) {
        if (error instanceof RuleConflictError) {
          throw new HttpError(409, "Já existe uma regra igual.", "NOTIFICATIONS_RULE_CONFLICT");
        }
        throw error;
      }
    },

    /** Todas as notificações (ADMIN e PMO), mais recentes primeiro, paginadas por cursor estável (sem repetir nem perder). */
    async listNotifications(
      actor: AuthUser,
      filter: { kind?: string; projectId?: string; resolved?: boolean; unread?: boolean; cursor?: string; limit: number },
    ) {
      if (!canReadNotificationsAdmin(actor)) throw forbiddenRead();
      const { cursor, limit, ...rest } = filter;
      const rows = await repo.listNotifications({ ...rest, cursor: decodeCursor(cursor), limit: limit + 1 });
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return { data: page.map(toNotificationItem), nextCursor: rows.length > limit && last ? encodeCursor({ ts: last.cursorTs, id: last.id }) : null };
    },

    /** Detalhe de uma notificação, com cada destinatário e a leitura dele (ADMIN e PMO). */
    async getNotification(actor: AuthUser, id: string) {
      if (!canReadNotificationsAdmin(actor)) throw forbiddenRead();
      const detail = await repo.getNotificationDetail(id);
      if (!detail) throw new HttpError(404, "Notificação não encontrada.", "NOTIFICATION_NOT_FOUND");
      const { notification, projectName, deliveries } = detail;
      return {
        ...toNotificationItem({
          ...notification,
          projectName,
          recipients: deliveries.length,
          unread: deliveries.filter((delivery) => delivery.readAt === null).length,
          cursorTs: "",
        }),
        resolvedValidationId: notification.resolvedValidationId,
        runId: notification.runId,
        deliveries: deliveries.map((delivery) => ({
          deliveryId: delivery.id,
          userId: delivery.userId,
          recipientName: delivery.recipientName,
          recipientEmail: delivery.recipientEmail,
          recipientRole: delivery.recipientRole,
          visibility: delivery.visibility as "TO" | "CC",
          deliveredAt: delivery.deliveredAt.toISOString(),
          readAt: iso(delivery.readAt),
        })),
      };
    },

    /** Caixa de entrada: cada pessoa lê apenas as próprias entregas. Paginada por cursor estável; `unread` é o total exato. */
    async listInbox(
      actor: AuthUser,
      filter: { read?: boolean; unread?: boolean; kind?: string; projectId?: string; resolved?: boolean; cursor?: string; limit: number },
    ) {
      const { cursor, limit, unread, ...rest } = filter;
      // Compatibilidade: unread=true = só não lidas; unread=false sempre significou "sem filtro".
      const read = rest.read ?? (unread === true ? false : undefined);
      const [rows, total] = await Promise.all([
        repo.listInbox(actor.id, { ...rest, read, cursor: decodeCursor(cursor), limit: limit + 1 }),
        repo.countUnread(actor.id),
      ]);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return { data: page.map(toInboxItem), unread: total, nextCursor: rows.length > limit && last ? encodeCursor({ ts: last.cursorTs, id: last.delivery.id }) : null };
    },

    /** Marca como lida (uma vez); resolução da pendência é registrada à parte. Repetir a chamada não muda nada. */
    async markRead(actor: AuthUser, deliveryId: string, now = new Date()) {
      const delivery = await repo.getDelivery(deliveryId);
      if (!delivery || delivery.userId !== actor.id) {
        throw new HttpError(404, "Notificação não encontrada.", "NOTIFICATION_DELIVERY_NOT_FOUND");
      }
      const updated = (await repo.markDeliveryRead(deliveryId, now)) ?? delivery;
      return { deliveryId, readAt: (updated.readAt ?? now).toISOString() };
    },

    async listIssues(actor: AuthUser, filter: { open?: boolean; limit: number }) {
      if (!canReadNotificationsAdmin(actor)) throw forbiddenRead();
      return { data: (await repo.listIssues(filter)).map(toIssue), canManage: canManageNotifications(actor) };
    },

    async resolveIssue(actor: AuthUser, id: string, note: string, now = new Date()) {
      if (!canManageNotifications(actor)) throw forbiddenManage();
      const issue = await repo.getIssue(id);
      if (!issue) throw new HttpError(404, "Ocorrência não encontrada.", "NOTIFICATIONS_ISSUE_NOT_FOUND");
      if (issue.resolvedAt) throw new HttpError(409, "A ocorrência já foi resolvida.", "NOTIFICATIONS_ISSUE_RESOLVED");
      const resolved = await repo.resolveIssue(id, { resolution: "MANUAL", resolvedBy: actor.id, note, at: now });
      if (!resolved) throw new HttpError(409, "A ocorrência já foi resolvida.", "NOTIFICATIONS_ISSUE_RESOLVED");
      return toIssue(resolved);
    },

    /**
     * Saúde do agendador, só de batimentos e resultados gravados (nunca de uma configuração "habilitada"). O estado técnico
     * (agendador) e o operacional (notificações) são independentes. Sem a migration 0030 aplicada, devolve DESCONHECIDO.
     */
    async getSchedulerHealth(actor: AuthUser) {
      if (!canReadNotificationsAdmin(actor)) throw forbiddenRead();
      const empty = { lastStatus: null, lastError: null, consecutiveFailures: 0, lastSuccessSecondsAgo: null, lastFinishedSecondsAgo: null, nextDueInSeconds: null, claimedBy: null, lastRunId: null, failureIssueOpen: false, instances: [] };
      let snapshot = null;
      try {
        snapshot = deps.scheduler ? await deps.scheduler.readSnapshot() : null;
      } catch (error) {
        const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
        if (code !== "42P01") throw error; // tabela inexistente = migration pendente; qualquer outro erro é real
        return { ...empty, technicalState: "DESCONHECIDO" as const, operationalState: "DESATIVADAS" as const, reasons: ["MIGRATION_PENDING"] };
      }
      const health = deriveSchedulerHealth(snapshot);
      return {
        ...health,
        lastStatus: snapshot?.state?.lastStatus ?? null,
        lastError: snapshot?.state?.lastError ?? null,
        consecutiveFailures: snapshot?.state?.consecutiveFailures ?? 0,
        lastSuccessSecondsAgo: snapshot?.state?.lastSuccessAgeSeconds ?? null,
        lastFinishedSecondsAgo: snapshot?.state?.lastFinishedAgeSeconds ?? null,
        nextDueInSeconds: snapshot?.state?.nextDueInSeconds ?? null,
        claimedBy: snapshot?.state?.claimedBy ?? null,
        lastRunId: snapshot?.state?.lastRunId ?? null,
        failureIssueOpen: snapshot?.failureIssueOpen ?? false,
        instances: (snapshot?.instances ?? []).map((item) => ({
          instanceId: item.instanceId,
          mode: item.mode,
          hostname: item.hostname,
          pid: item.pid,
          intervalSeconds: item.intervalSeconds,
          startedSecondsAgo: item.startedAgeSeconds,
          lastSeenSecondsAgo: item.lastSeenAgeSeconds,
          stoppedSecondsAgo: item.stoppedAgeSeconds,
          stopReason: item.stopReason,
          alive: item.stoppedAgeSeconds === null && item.lastSeenAgeSeconds <= LIVE_SECONDS,
        })),
      };
    },

    async listRuns(actor: AuthUser) {
      if (!canReadNotificationsAdmin(actor)) throw forbiddenRead();
      return { data: (await repo.listRuns(50)).map(toRun) };
    },

    /** Simulação pela API (nunca grava avisos, entregas nem ocorrências): só o histórico técnico da execução. */
    async dryRun(actor: AuthUser, input: { cutoff?: string }, now = new Date()) {
      if (!canManageNotifications(actor)) throw forbiddenManage();
      if (input.cutoff !== undefined && !isThursday(input.cutoff)) {
        throw new HttpError(400, "O corte simulado deve ser uma quinta-feira.", "NOTIFICATIONS_CUTOFF_NOT_THURSDAY");
      }
      const result = await runNotificationGenerator(deps, { mode: "DRY_RUN", origin: "API", actorId: actor.id, now, simulatedCutoff: input.cutoff ?? null });
      const run = (await repo.listRuns(5)).find((row) => row.id === result.runId);
      return toRun(run!);
    },
  };
}

export type NotificationUseCases = ReturnType<typeof makeNotificationUseCases>;

