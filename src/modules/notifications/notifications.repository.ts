import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import {
  executiveFollowupNotifications,
  notificationDeliveries,
  notificationIssues,
  notificationRecipientRules,
  notificationRuns,
  notificationSettings,
  notificationSettingsChanges,
  projects,
  user,
} from "../../db/schema";
import type { Database, DbClient } from "../../db/types";
import type { NotificationKind, OpenNotification, RecipientUser, ResolutionReason } from "./notification-planning";

export type SettingsRow = typeof notificationSettings.$inferSelect;
export type RuleRow = typeof notificationRecipientRules.$inferSelect;
export type RunRow = typeof notificationRuns.$inferSelect;
export type NotificationRow = typeof executiveFollowupNotifications.$inferSelect;
export type DeliveryRow = typeof notificationDeliveries.$inferSelect;
export type IssueRow = typeof notificationIssues.$inferSelect;
export type SettingsChangeRow = typeof notificationSettingsChanges.$inferSelect & { actorName: string | null };

/** `cursorTs`: data de criação com precisão de microssegundos (texto), para a paginação por cursor não perder nem repetir registros. */
export type NotificationListItem = NotificationRow & { projectName: string; recipients: number; unread: number; cursorTs: string };
export type InboxItem = { delivery: DeliveryRow; notification: NotificationRow; projectName: string; cursorTs: string };
export type NotificationDetail = { notification: NotificationRow; projectName: string; deliveries: DeliveryRow[] };
/** Posição estável na lista: (data com microssegundos, id). Novos registros entram sempre antes do primeiro cursor. */
export type PageCursor = { ts: string; id: string };

export type NewRule = {
  id: string;
  kind: NotificationKind;
  source: "ROLE" | "USER";
  role: string | null;
  userId: string | null;
  visibility: "TO" | "CC";
  createdBy: string;
};

export type NewSettingsChange = {
  id: string;
  action: "ACTIVATE" | "DEACTIVATE" | "RULE_CREATE" | "RULE_UPDATE";
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  justification: string;
  actorId: string;
};

export type NewRun = {
  id: string;
  mode: "DRY_RUN" | "ACTIVE";
  origin: "CLI" | "API" | "SCHEDULER";
  actorId: string | null;
  asOf: Date;
  simulatedCutoff: string | null;
};

export type RunPatch = Partial<
  Pick<RunRow, "status" | "finishedAt" | "evaluatedProjects" | "createdNotifications" | "resolvedNotifications" | "issuesSeen" | "summary" | "error">
>;

export type NewNotification = {
  id: string;
  projectId: string;
  kind: NotificationKind;
  cycleStart: string;
  sequenceStart: string | null;
  dueDate: string;
  scheduledFor: Date;
  dedupeKey: string;
  title: string;
  body: string;
  followupSnapshot: Record<string, unknown>;
  runId: string;
};

export type NewDelivery = {
  id: string;
  userId: string;
  recipientName: string;
  recipientEmail: string;
  recipientRole: string;
  visibility: "TO" | "CC";
};

export type IssueInput = {
  id: string;
  kind: IssueRow["kind"];
  dedupeKey: string;
  year: number | null;
  details: Record<string, unknown>;
};

/** Já existe uma regra igual (mesmo tipo, origem, alvo e visibilidade). */
export class RuleConflictError extends Error {}

/** A reserva do agendador foi perdida: quem a perdeu não pode mais gravar (barreira contra execução zumbi). */
export class LeaseLostError extends Error {
  constructor(message = "Reserva do agendador perdida.") {
    super(message);
    this.name = "LeaseLostError";
  }
}

/** Barreira de gravação: o token da reserva precisa continuar válido na própria transação que grava. */
export type Fence = { token: string };

export interface NotificationStore {
  getSettings(): Promise<SettingsRow>;
  updateSettings(patch: Partial<Pick<SettingsRow, "activationEnabled" | "activationCutoff" | "activatedAt" | "activatedBy">>): Promise<SettingsRow>;
  appendSettingsChange(change: NewSettingsChange): Promise<void>;
  listSettingsChanges(limit: number): Promise<SettingsChangeRow[]>;

  listRules(): Promise<RuleRow[]>;
  getRule(id: string): Promise<RuleRow | null>;
  insertRule(rule: NewRule): Promise<RuleRow>;
  updateRule(id: string, patch: { enabled?: boolean; visibility?: "TO" | "CC"; updatedBy: string }): Promise<RuleRow | null>;

  listUsers(): Promise<RecipientUser[]>;
  getUser(id: string): Promise<RecipientUser | null>;
  listProjects(): Promise<Array<{ id: string; name: string; status: string }>>;

  insertRun(run: NewRun): Promise<RunRow>;
  updateRun(id: string, patch: RunPatch): Promise<void>;
  listRuns(limit: number): Promise<RunRow[]>;

  findNotificationByKey(dedupeKey: string): Promise<NotificationRow | null>;
  /** Grava a notificação e as entregas juntas. `false` quando a chave já existia (duplicidade evitada). */
  createNotification(notification: NewNotification, deliveries: NewDelivery[], fence?: Fence): Promise<boolean>;
  listOpenNotifications(): Promise<OpenNotification[]>;
  resolveNotification(id: string, data: { reason: ResolutionReason; validationId: string | null; runId: string; at: Date }, fence?: Fence): Promise<void>;
  listNotifications(filter: { kind?: string; projectId?: string; resolved?: boolean; unread?: boolean; cursor?: PageCursor; limit: number }): Promise<NotificationListItem[]>;
  getNotificationDetail(id: string): Promise<NotificationDetail | null>;

  listInbox(
    userId: string,
    filter: { read?: boolean; kind?: string; projectId?: string; resolved?: boolean; cursor?: PageCursor; limit: number },
  ): Promise<InboxItem[]>;
  /** Total de não lidas do usuário (contagem exata, sem teto). */
  countUnread(userId: string): Promise<number>;
  getDelivery(id: string): Promise<DeliveryRow | null>;
  markDeliveryRead(id: string, at: Date): Promise<DeliveryRow | null>;

  upsertIssue(issue: IssueInput, at: Date, fence?: Fence): Promise<void>;
  listIssues(filter: { open?: boolean; limit: number }): Promise<IssueRow[]>;
  getIssue(id: string): Promise<IssueRow | null>;
  resolveIssue(id: string, data: { resolution: "AUTO" | "MANUAL"; resolvedBy: string | null; note: string | null; at: Date }, fence?: Fence): Promise<IssueRow | null>;
  /** Execuções reais que ficaram em RUNNING (processo interrompido). Só chamar com a trava global em mãos. Só atualiza o status. */
  failOrphanRuns(exceptRunId: string, at: Date): Promise<number>;
}

export interface NotificationRepository extends NotificationStore {
  transaction<T>(fn: (store: NotificationStore) => Promise<T>): Promise<T>;
  /** Serializa execuções do gerador: quem não obtém a trava sai sem fazer nada. */
  withGlobalLock<T>(fn: () => Promise<T>): Promise<{ acquired: true; value: T } | { acquired: false }>;
}

/** Chave fixa da trava consultiva que impede duas execuções simultâneas do gerador. */
const GENERATOR_LOCK_KEY = 4_270_330_001;

/** Confere, dentro da transação, que a reserva do agendador ainda é a da execução (e não venceu). */
async function assertFence(client: DbClient, fence: Fence) {
  const rows = await client.execute(
    sql`select 1 as ok from notification_scheduler_state where id = 'GLOBAL' and claim_token = ${fence.token} and claimed_until > (now() at time zone 'utc') for share`,
  );
  if (rows.rows.length === 0) {
    throw new LeaseLostError();
  }
}

class DrizzleNotificationStore implements NotificationStore {
  constructor(protected readonly client: DbClient) {}

  /** Executa a gravação dentro de uma transação que antes confere a barreira (quando há). */
  protected async fenced<T>(fence: Fence | undefined, write: (client: DbClient) => Promise<T>): Promise<T> {
    if (!fence) return write(this.client);
    const run = async (tx: DbClient) => {
      await assertFence(tx, fence);
      return write(tx);
    };
    return "transaction" in this.client ? (this.client as Database).transaction((tx) => run(tx)) : run(this.client);
  }

  async getSettings() {
    const [row] = await this.client.select().from(notificationSettings).where(eq(notificationSettings.id, "GLOBAL"));
    if (!row) {
      throw new Error("Configuração de notificações ausente (migration 0029 não aplicada?).");
    }
    return row;
  }

  async updateSettings(patch: Parameters<NotificationStore["updateSettings"]>[0]) {
    const [row] = await this.client
      .update(notificationSettings)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(notificationSettings.id, "GLOBAL"))
      .returning();
    return row;
  }

  async appendSettingsChange(change: NewSettingsChange) {
    await this.client.insert(notificationSettingsChanges).values(change);
  }

  async listSettingsChanges(limit: number) {
    const rows = await this.client
      .select({ change: notificationSettingsChanges, actorName: user.name })
      .from(notificationSettingsChanges)
      .leftJoin(user, eq(user.id, notificationSettingsChanges.actorId))
      .orderBy(desc(notificationSettingsChanges.createdAt))
      .limit(limit);
    return rows.map((row) => ({ ...row.change, actorName: row.actorName }));
  }

  listRules() {
    return this.client.select().from(notificationRecipientRules).orderBy(asc(notificationRecipientRules.kind), asc(notificationRecipientRules.createdAt));
  }

  async getRule(id: string) {
    const [row] = await this.client.select().from(notificationRecipientRules).where(eq(notificationRecipientRules.id, id));
    return row ?? null;
  }

  async insertRule(rule: NewRule) {
    try {
      const [row] = await this.client.insert(notificationRecipientRules).values({ ...rule, updatedBy: rule.createdBy }).returning();
      return row;
    } catch (error) {
      if ((error as { code?: string; cause?: { code?: string } }).code === "23505" || (error as { cause?: { code?: string } }).cause?.code === "23505") {
        throw new RuleConflictError();
      }
      throw error;
    }
  }

  async updateRule(id: string, patch: { enabled?: boolean; visibility?: "TO" | "CC"; updatedBy: string }) {
    try {
      const [row] = await this.client
        .update(notificationRecipientRules)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(notificationRecipientRules.id, id))
        .returning();
      return row ?? null;
    } catch (error) {
      if ((error as { code?: string }).code === "23505" || (error as { cause?: { code?: string } }).cause?.code === "23505") {
        throw new RuleConflictError();
      }
      throw error;
    }
  }

  async listUsers() {
    const rows = await this.client.select({ id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive }).from(user);
    return rows as RecipientUser[];
  }

  async getUser(id: string) {
    const [row] = await this.client
      .select({ id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive })
      .from(user)
      .where(eq(user.id, id));
    return (row as RecipientUser | undefined) ?? null;
  }

  listProjects() {
    return this.client.select({ id: projects.id, name: projects.name, status: projects.status }).from(projects).orderBy(asc(projects.id));
  }

  async insertRun(run: NewRun) {
    const [row] = await this.client.insert(notificationRuns).values({ ...run, status: "RUNNING" }).returning();
    return row;
  }

  async updateRun(id: string, patch: RunPatch) {
    await this.client.update(notificationRuns).set(patch).where(eq(notificationRuns.id, id));
  }

  listRuns(limit: number) {
    return this.client.select().from(notificationRuns).orderBy(desc(notificationRuns.startedAt)).limit(limit);
  }

  async findNotificationByKey(dedupeKey: string) {
    const [row] = await this.client.select().from(executiveFollowupNotifications).where(eq(executiveFollowupNotifications.dedupeKey, dedupeKey));
    return row ?? null;
  }

  async createNotification(notification: NewNotification, deliveries: NewDelivery[], fence?: Fence) {
    return this.fenced(fence, (client) => this.insertNotification(client, notification, deliveries));
  }

  protected async insertNotification(client: DbClient, notification: NewNotification, deliveries: NewDelivery[]) {
    const inserted = await client
      .insert(executiveFollowupNotifications)
      .values(notification)
      .onConflictDoNothing({ target: executiveFollowupNotifications.dedupeKey })
      .returning({ id: executiveFollowupNotifications.id });
    if (inserted.length === 0) {
      return false;
    }
    if (deliveries.length > 0) {
      await client.insert(notificationDeliveries).values(deliveries.map((delivery) => ({ ...delivery, notificationId: notification.id })));
    }
    return true;
  }

  async listOpenNotifications() {
    const rows = await this.client
      .select({
        id: executiveFollowupNotifications.id,
        projectId: executiveFollowupNotifications.projectId,
        kind: executiveFollowupNotifications.kind,
        cycleStart: executiveFollowupNotifications.cycleStart,
        sequenceStart: executiveFollowupNotifications.sequenceStart,
        dueDate: executiveFollowupNotifications.dueDate,
      })
      .from(executiveFollowupNotifications)
      .where(isNull(executiveFollowupNotifications.resolvedAt));
    return rows as OpenNotification[];
  }

  async resolveNotification(id: string, data: { reason: ResolutionReason; validationId: string | null; runId: string; at: Date }, fence?: Fence) {
    await this.fenced(fence, (client) =>
      client
        .update(executiveFollowupNotifications)
        .set({ resolvedAt: data.at, resolutionReason: data.reason, resolvedValidationId: data.validationId, resolvedRunId: data.runId })
        .where(and(eq(executiveFollowupNotifications.id, id), isNull(executiveFollowupNotifications.resolvedAt))),
    );
  }

  async listNotifications(filter: { kind?: string; projectId?: string; resolved?: boolean; unread?: boolean; cursor?: PageCursor; limit: number }) {
    const n = executiveFollowupNotifications;
    const unreadExists = sql`exists (select 1 from ${notificationDeliveries} d where d.notification_id = ${n.id} and d.read_at is null)`;
    const conditions = [
      filter.kind ? eq(n.kind, filter.kind) : undefined,
      filter.projectId ? eq(n.projectId, filter.projectId) : undefined,
      filter.resolved === undefined ? undefined : filter.resolved ? sql`${n.resolvedAt} IS NOT NULL` : isNull(n.resolvedAt),
      filter.unread === undefined ? undefined : filter.unread ? unreadExists : sql`not ${unreadExists}`,
      filter.cursor ? sql`(${n.createdAt}, ${n.id}) < (${filter.cursor.ts}::timestamp, ${filter.cursor.id})` : undefined,
    ].filter((condition) => condition !== undefined);
    const rows = await this.client
      .select({
        notification: n,
        projectName: projects.name,
        recipients: sql<number>`(select count(*)::int from ${notificationDeliveries} d where d.notification_id = ${n.id})`,
        unread: sql<number>`(select count(*)::int from ${notificationDeliveries} d where d.notification_id = ${n.id} and d.read_at is null)`,
        cursorTs: sql<string>`to_char(${n.createdAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US')`,
      })
      .from(n)
      .innerJoin(projects, eq(projects.id, n.projectId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(n.createdAt), desc(n.id))
      .limit(filter.limit);
    return rows.map((row) => ({ ...row.notification, projectName: row.projectName, recipients: row.recipients, unread: row.unread, cursorTs: row.cursorTs }));
  }

  async getNotificationDetail(id: string) {
    const [row] = await this.client
      .select({ notification: executiveFollowupNotifications, projectName: projects.name })
      .from(executiveFollowupNotifications)
      .innerJoin(projects, eq(projects.id, executiveFollowupNotifications.projectId))
      .where(eq(executiveFollowupNotifications.id, id));
    if (!row) return null;
    const deliveries = await this.client
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.notificationId, id))
      .orderBy(desc(notificationDeliveries.visibility), asc(notificationDeliveries.recipientName));
    return { notification: row.notification, projectName: row.projectName, deliveries };
  }

  async listInbox(
    userId: string,
    filter: { read?: boolean; kind?: string; projectId?: string; resolved?: boolean; cursor?: PageCursor; limit: number },
  ) {
    const d = notificationDeliveries;
    const n = executiveFollowupNotifications;
    const conditions = [
      eq(d.userId, userId),
      filter.read === undefined ? undefined : filter.read ? sql`${d.readAt} IS NOT NULL` : isNull(d.readAt),
      filter.kind ? eq(n.kind, filter.kind) : undefined,
      filter.projectId ? eq(n.projectId, filter.projectId) : undefined,
      filter.resolved === undefined ? undefined : filter.resolved ? sql`${n.resolvedAt} IS NOT NULL` : isNull(n.resolvedAt),
      filter.cursor ? sql`(${d.deliveredAt}, ${d.id}) < (${filter.cursor.ts}::timestamp, ${filter.cursor.id})` : undefined,
    ].filter((condition) => condition !== undefined);
    const rows = await this.client
      .select({ delivery: d, notification: n, projectName: projects.name, cursorTs: sql<string>`to_char(${d.deliveredAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US')` })
      .from(d)
      .innerJoin(n, eq(n.id, d.notificationId))
      .innerJoin(projects, eq(projects.id, n.projectId))
      .where(and(...conditions))
      .orderBy(desc(d.deliveredAt), desc(d.id))
      .limit(filter.limit);
    return rows;
  }

  async countUnread(userId: string) {
    const [row] = await this.client
      .select({ total: sql<number>`count(*)::int` })
      .from(notificationDeliveries)
      .where(and(eq(notificationDeliveries.userId, userId), isNull(notificationDeliveries.readAt)));
    return Number(row?.total ?? 0);
  }

  async getDelivery(id: string) {
    const [row] = await this.client.select().from(notificationDeliveries).where(eq(notificationDeliveries.id, id));
    return row ?? null;
  }

  async markDeliveryRead(id: string, at: Date) {
    const [row] = await this.client
      .update(notificationDeliveries)
      .set({ readAt: at })
      .where(and(eq(notificationDeliveries.id, id), isNull(notificationDeliveries.readAt)))
      .returning();
    return row ?? null;
  }

  async upsertIssue(issue: IssueInput, at: Date, fence?: Fence) {
    await this.fenced(fence, (client) =>
      client
        .insert(notificationIssues)
        .values({ ...issue, firstSeenAt: at, lastSeenAt: at })
        .onConflictDoUpdate({
          target: notificationIssues.dedupeKey,
          targetWhere: isNull(notificationIssues.resolvedAt),
          set: { lastSeenAt: at, occurrences: sql`${notificationIssues.occurrences} + 1`, details: issue.details },
        }),
    );
  }

  listIssues(filter: { open?: boolean; limit: number }) {
    return this.client
      .select()
      .from(notificationIssues)
      .where(filter.open === undefined ? undefined : filter.open ? isNull(notificationIssues.resolvedAt) : sql`${notificationIssues.resolvedAt} IS NOT NULL`)
      .orderBy(desc(notificationIssues.lastSeenAt))
      .limit(filter.limit);
  }

  async getIssue(id: string) {
    const [row] = await this.client.select().from(notificationIssues).where(eq(notificationIssues.id, id));
    return row ?? null;
  }

  async resolveIssue(id: string, data: { resolution: "AUTO" | "MANUAL"; resolvedBy: string | null; note: string | null; at: Date }, fence?: Fence) {
    const [row] = await this.fenced(fence, (client) =>
      client
        .update(notificationIssues)
        .set({ resolvedAt: data.at, resolution: data.resolution, resolvedBy: data.resolvedBy, resolutionNote: data.note })
        .where(and(eq(notificationIssues.id, id), isNull(notificationIssues.resolvedAt)))
        .returning(),
    );
    return row ?? null;
  }

  async failOrphanRuns(exceptRunId: string, at: Date) {
    const rows = await this.client
      .update(notificationRuns)
      .set({ status: "FAILED", finishedAt: at, error: "INTERROMPIDA: o processo que executava esta rodada terminou sem concluir." })
      .where(and(eq(notificationRuns.status, "RUNNING"), eq(notificationRuns.mode, "ACTIVE"), sql`${notificationRuns.id} <> ${exceptRunId}`))
      .returning({ id: notificationRuns.id });
    return rows.length;
  }
}

export class DrizzleNotificationRepository extends DrizzleNotificationStore implements NotificationRepository {
  constructor(private readonly database: Database) {
    super(database);
  }

  transaction<T>(fn: (store: NotificationStore) => Promise<T>) {
    return this.database.transaction((tx) => fn(new DrizzleNotificationStore(tx)));
  }

  async withGlobalLock<T>(fn: () => Promise<T>) {
    return this.database.transaction(async (tx) => {
      const result = await tx.execute(sql`select pg_try_advisory_xact_lock(${GENERATOR_LOCK_KEY}) as ok`);
      if (!(result.rows[0] as { ok: boolean }).ok) {
        return { acquired: false as const };
      }
      return { acquired: true as const, value: await fn() };
    });
  }

  /** Grava a notificação sob trava por chave: duas execuções concorrentes nunca duplicam o aviso. */
  override createNotification(notification: NewNotification, deliveries: NewDelivery[], fence?: Fence) {
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${notification.dedupeKey}))`);
      if (fence) await assertFence(tx, fence);
      return new DrizzleNotificationStore(tx).createNotification(notification, deliveries);
    });
  }
}
