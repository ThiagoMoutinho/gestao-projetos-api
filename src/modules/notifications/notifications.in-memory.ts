import type { OpenNotification, RecipientUser, ResolutionReason } from "./notification-planning";
import {
  LeaseLostError,
  RuleConflictError,
  type Fence,
  type DeliveryRow,
  type InboxItem,
  type NotificationDetail,
  type PageCursor,
  type IssueInput,
  type IssueRow,
  type NewDelivery,
  type NewNotification,
  type NewRule,
  type NewRun,
  type NewSettingsChange,
  type NotificationListItem,
  type NotificationRepository,
  type NotificationRow,
  type NotificationStore,
  type RuleRow,
  type RunPatch,
  type RunRow,
  type SettingsChangeRow,
  type SettingsRow,
} from "./notifications.repository";

/**
 * Repositório em memória para testes. Reproduz as regras do banco: chave de duplicidade única, gatilhos de ativação e de
 * "sem retroativo", entrega única por destinatário, resolução gravada uma vez e a trava global do gerador.
 */
export class InMemoryNotificationRepository implements NotificationRepository {
  settings: SettingsRow = { id: "GLOBAL", activationEnabled: false, activationCutoff: null, activatedAt: null, activatedBy: null, updatedAt: new Date() };
  rules: RuleRow[] = [];
  users: RecipientUser[] = [];
  projectList: Array<{ id: string; name: string; status: string }> = [];
  runs: RunRow[] = [];
  notifications: NotificationRow[] = [];
  deliveries: DeliveryRow[] = [];
  issues: IssueRow[] = [];
  changes: SettingsChangeRow[] = [];
  locked = false;
  /** Em testes do agendador: diz se o token da reserva ainda vale (emula a verificação transacional do banco). */
  fenceValid: (token: string) => boolean = () => true;

  private assertFence(fence?: Fence) {
    if (fence && !this.fenceValid(fence.token)) throw new LeaseLostError();
  }

  async failOrphanRuns(exceptRunId: string, at: Date) {
    let count = 0;
    this.runs = this.runs.map((run) => {
      if (run.status === "RUNNING" && run.mode === "ACTIVE" && run.id !== exceptRunId) {
        count += 1;
        return { ...run, status: "FAILED", finishedAt: at, error: "INTERROMPIDA: o processo que executava esta rodada terminou sem concluir." };
      }
      return run;
    });
    return count;
  }

  async getSettings() {
    return this.settings;
  }

  async updateSettings(patch: Parameters<NotificationStore["updateSettings"]>[0]) {
    this.settings = { ...this.settings, ...patch, updatedAt: new Date() };
    return this.settings;
  }

  async appendSettingsChange(change: NewSettingsChange) {
    this.changes.push({ ...change, createdAt: new Date(), actorName: this.users.find((item) => item.id === change.actorId)?.name ?? null });
  }

  async listSettingsChanges(limit: number) {
    return [...this.changes].reverse().slice(0, limit);
  }

  async listRules() {
    return [...this.rules];
  }

  async getRule(id: string) {
    return this.rules.find((rule) => rule.id === id) ?? null;
  }

  private conflicts(candidate: Pick<RuleRow, "id" | "kind" | "source" | "role" | "userId" | "visibility">) {
    return this.rules.some(
      (rule) =>
        rule.id !== candidate.id &&
        rule.kind === candidate.kind &&
        rule.source === candidate.source &&
        (rule.role ?? "") === (candidate.role ?? "") &&
        (rule.userId ?? "") === (candidate.userId ?? "") &&
        rule.visibility === candidate.visibility,
    );
  }

  async insertRule(rule: NewRule) {
    if (rule.role === "COORDENADOR") throw new Error("CHECK: perfil COORDENADOR proibido");
    if (this.conflicts({ ...rule })) throw new RuleConflictError();
    const now = new Date();
    const row: RuleRow = { ...rule, enabled: true, createdAt: now, updatedBy: rule.createdBy, updatedAt: now };
    this.rules.push(row);
    return row;
  }

  async updateRule(id: string, patch: { enabled?: boolean; visibility?: "TO" | "CC"; updatedBy: string }) {
    const index = this.rules.findIndex((rule) => rule.id === id);
    if (index < 0) return null;
    const next = { ...this.rules[index], ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}), ...(patch.visibility ? { visibility: patch.visibility } : {}), updatedBy: patch.updatedBy, updatedAt: new Date() };
    if (this.conflicts(next)) throw new RuleConflictError();
    this.rules[index] = next;
    return next;
  }

  async listUsers() {
    return [...this.users];
  }

  async getUser(id: string) {
    return this.users.find((item) => item.id === id) ?? null;
  }

  async listProjects() {
    return [...this.projectList];
  }

  async insertRun(run: NewRun) {
    const row: RunRow = {
      ...run,
      status: "RUNNING",
      startedAt: new Date(),
      finishedAt: null,
      evaluatedProjects: 0,
      createdNotifications: 0,
      resolvedNotifications: 0,
      issuesSeen: 0,
      summary: null,
      error: null,
    };
    this.runs.push(row);
    return row;
  }

  async updateRun(id: string, patch: RunPatch) {
    const index = this.runs.findIndex((run) => run.id === id);
    this.runs[index] = { ...this.runs[index], ...patch };
  }

  async listRuns(limit: number) {
    return [...this.runs].reverse().slice(0, limit);
  }

  async findNotificationByKey(dedupeKey: string) {
    return this.notifications.find((row) => row.dedupeKey === dedupeKey) ?? null;
  }

  async createNotification(notification: NewNotification, deliveries: NewDelivery[], fence?: Fence) {
    this.assertFence(fence);
    const s = this.settings;
    if (!s.activationEnabled) throw new Error("restrict_violation: notificações desativadas");
    if ((s.activatedAt && notification.scheduledFor < s.activatedAt) || (s.activationCutoff && notification.cycleStart < s.activationCutoff)) {
      throw new Error("restrict_violation: retroativa");
    }
    if (this.notifications.some((row) => row.dedupeKey === notification.dedupeKey)) return false;
    const now = new Date();
    this.notifications.push({ ...notification, createdAt: now, resolvedAt: null, resolutionReason: null, resolvedValidationId: null, resolvedRunId: null });
    for (const delivery of deliveries) {
      this.deliveries.push({ ...delivery, notificationId: notification.id, deliveredAt: now, readAt: null });
    }
    return true;
  }

  async listOpenNotifications() {
    return this.notifications
      .filter((row) => row.resolvedAt === null)
      .map((row) => ({ id: row.id, projectId: row.projectId, kind: row.kind, cycleStart: row.cycleStart, sequenceStart: row.sequenceStart, dueDate: row.dueDate }) as OpenNotification);
  }

  async resolveNotification(id: string, data: { reason: ResolutionReason; validationId: string | null; runId: string; at: Date }, fence?: Fence) {
    this.assertFence(fence);
    const index = this.notifications.findIndex((row) => row.id === id && row.resolvedAt === null);
    if (index < 0) return;
    this.notifications[index] = { ...this.notifications[index], resolvedAt: data.at, resolutionReason: data.reason, resolvedValidationId: data.validationId, resolvedRunId: data.runId };
  }

  /** Mesmo formato do banco (microssegundos): o milissegundo da data seguido de 000. */
  private ts(date: Date) {
    return date.toISOString().slice(0, -1) + "000";
  }

  private beforeCursor(ts: string, id: string, cursor?: PageCursor) {
    return !cursor || ts < cursor.ts || (ts === cursor.ts && id < cursor.id);
  }

  private withProject(row: NotificationRow): NotificationListItem {
    const mine = this.deliveries.filter((delivery) => delivery.notificationId === row.id);
    return {
      ...row,
      projectName: this.projectList.find((item) => item.id === row.projectId)?.name ?? row.projectId,
      recipients: mine.length,
      unread: mine.filter((delivery) => delivery.readAt === null).length,
      cursorTs: this.ts(row.createdAt),
    };
  }

  async listNotifications(filter: { kind?: string; projectId?: string; resolved?: boolean; unread?: boolean; cursor?: PageCursor; limit: number }) {
    return this.notifications
      .map((row) => this.withProject(row))
      .filter(
        (row) =>
          (!filter.kind || row.kind === filter.kind) &&
          (!filter.projectId || row.projectId === filter.projectId) &&
          (filter.resolved === undefined || (row.resolvedAt !== null) === filter.resolved) &&
          (filter.unread === undefined || (row.unread > 0) === filter.unread) &&
          this.beforeCursor(row.cursorTs, row.id, filter.cursor),
      )
      .sort((a, b) => (a.cursorTs === b.cursorTs ? (a.id < b.id ? 1 : -1) : a.cursorTs < b.cursorTs ? 1 : -1))
      .slice(0, filter.limit);
  }

  async getNotificationDetail(id: string): Promise<NotificationDetail | null> {
    const notification = this.notifications.find((row) => row.id === id);
    if (!notification) return null;
    return {
      notification,
      projectName: this.projectList.find((item) => item.id === notification.projectId)?.name ?? notification.projectId,
      deliveries: this.deliveries.filter((delivery) => delivery.notificationId === id),
    };
  }

  async listInbox(
    userId: string,
    filter: { read?: boolean; kind?: string; projectId?: string; resolved?: boolean; cursor?: PageCursor; limit: number },
  ): Promise<InboxItem[]> {
    return this.deliveries
      .map((delivery) => ({ delivery, notification: this.notifications.find((row) => row.id === delivery.notificationId)!, cursorTs: this.ts(delivery.deliveredAt) }))
      .filter(
        ({ delivery, notification, cursorTs }) =>
          delivery.userId === userId &&
          (filter.read === undefined || (delivery.readAt !== null) === filter.read) &&
          (!filter.kind || notification.kind === filter.kind) &&
          (!filter.projectId || notification.projectId === filter.projectId) &&
          (filter.resolved === undefined || (notification.resolvedAt !== null) === filter.resolved) &&
          this.beforeCursor(cursorTs, delivery.id, filter.cursor),
      )
      .sort((a, b) => (a.cursorTs === b.cursorTs ? (a.delivery.id < b.delivery.id ? 1 : -1) : a.cursorTs < b.cursorTs ? 1 : -1))
      .slice(0, filter.limit)
      .map(({ delivery, notification, cursorTs }) => ({
        delivery,
        notification,
        cursorTs,
        projectName: this.projectList.find((item) => item.id === notification.projectId)?.name ?? notification.projectId,
      }));
  }

  async countUnread(userId: string) {
    return this.deliveries.filter((delivery) => delivery.userId === userId && delivery.readAt === null).length;
  }

  async getDelivery(id: string) {
    return this.deliveries.find((row) => row.id === id) ?? null;
  }

  async markDeliveryRead(id: string, at: Date) {
    const index = this.deliveries.findIndex((row) => row.id === id && row.readAt === null);
    if (index < 0) return null;
    this.deliveries[index] = { ...this.deliveries[index], readAt: at };
    return this.deliveries[index];
  }

  async upsertIssue(issue: IssueInput, at: Date, fence?: Fence) {
    this.assertFence(fence);
    if (!this.settings.activationEnabled) throw new Error("restrict_violation: notificações desativadas");
    const open = this.issues.findIndex((row) => row.dedupeKey === issue.dedupeKey && row.resolvedAt === null);
    if (open >= 0) {
      this.issues[open] = { ...this.issues[open], lastSeenAt: at, occurrences: this.issues[open].occurrences + 1, details: issue.details };
      return;
    }
    this.issues.push({ ...issue, firstSeenAt: at, lastSeenAt: at, occurrences: 1, resolvedAt: null, resolution: null, resolvedBy: null, resolutionNote: null });
  }

  async listIssues(filter: { open?: boolean; limit: number }) {
    return this.issues.filter((row) => filter.open === undefined || (row.resolvedAt === null) === filter.open).slice(0, filter.limit);
  }

  async getIssue(id: string) {
    return this.issues.find((row) => row.id === id) ?? null;
  }

  async resolveIssue(id: string, data: { resolution: "AUTO" | "MANUAL"; resolvedBy: string | null; note: string | null; at: Date }, fence?: Fence) {
    this.assertFence(fence);
    const index = this.issues.findIndex((row) => row.id === id && row.resolvedAt === null);
    if (index < 0) return null;
    this.issues[index] = { ...this.issues[index], resolvedAt: data.at, resolution: data.resolution, resolvedBy: data.resolvedBy, resolutionNote: data.note };
    return this.issues[index];
  }

  async transaction<T>(fn: (store: NotificationStore) => Promise<T>) {
    const snapshot = { settings: this.settings, rules: [...this.rules], changes: [...this.changes] };
    try {
      return await fn(this);
    } catch (error) {
      this.settings = snapshot.settings;
      this.rules = snapshot.rules;
      this.changes = snapshot.changes;
      throw error;
    }
  }

  async withGlobalLock<T>(fn: () => Promise<T>) {
    if (this.locked) return { acquired: false as const };
    this.locked = true;
    try {
      return { acquired: true as const, value: await fn() };
    } finally {
      this.locked = false;
    }
  }
}
