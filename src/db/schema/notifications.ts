import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth-schema";
import { projectExecutiveSummaryValidations } from "./executive-summary";
import { projects } from "./projects";

/**
 * Notificações internas do acompanhamento semanal do resumo executivo. Nada é gerado enquanto a ativação estiver
 * desligada: o banco recusa a inserção (gatilhos), independente da aplicação. O conteúdo de uma notificação é
 * imutável; leitura (por destinatário) e resolução (da pendência) são registradas separadamente e nada é excluído.
 */

/** Configuração institucional (linha única). Ativação desligada por padrão; ligar exige corte (quinta-feira) e auditoria. */
export const notificationSettings = pgTable(
  "notification_settings",
  {
    id: text("id").primaryKey(),
    activationEnabled: boolean("activation_enabled").default(false).notNull(),
    /** Início (quinta-feira) do primeiro ciclo cobrável: nada anterior gera aviso. */
    activationCutoff: date("activation_cutoff", { mode: "string" }),
    activatedAt: timestamp("activated_at"),
    activatedBy: text("activated_by").references(() => user.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    check("notification_settings_singleton_chk", sql`${table.id} = 'GLOBAL'`),
    check(
      "notification_settings_enabled_chk",
      sql`NOT ${table.activationEnabled} OR (${table.activationCutoff} IS NOT NULL AND ${table.activatedAt} IS NOT NULL AND ${table.activatedBy} IS NOT NULL)`,
    ),
    check("notification_settings_cutoff_thursday_chk", sql`${table.activationCutoff} IS NULL OR EXTRACT(DOW FROM ${table.activationCutoff}) = 4`),
  ],
);

/** Histórico imutável de ativação, desativação e regras de destinatários. */
export const notificationSettingsChanges = pgTable(
  "notification_settings_changes",
  {
    id: text("id").primaryKey(),
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    justification: text("justification").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    check("notification_settings_changes_action_chk", sql`${table.action} IN ('ACTIVATE', 'DEACTIVATE', 'RULE_CREATE', 'RULE_UPDATE')`),
    check("notification_settings_changes_justification_chk", sql`length(btrim(${table.justification})) > 0`),
  ],
);

/**
 * Quem recebe cada tipo de aviso. Por perfil (somente PMO ou ADMIN; o perfil global COORDENADOR é proibido) ou por
 * usuário específico (o coordenador da CTIN, escolhido pelo ADMIN). TO = destinatário; CC = cópia para visibilidade.
 */
export const notificationRecipientRules = pgTable(
  "notification_recipient_rules",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    source: text("source").notNull(),
    role: text("role"),
    userId: text("user_id").references(() => user.id, { onDelete: "restrict" }),
    visibility: text("visibility").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    check("notification_recipient_rules_kind_chk", sql`${table.kind} IN ('PREVENTIVE', 'OVERDUE', 'ESCALATION')`),
    check("notification_recipient_rules_source_chk", sql`${table.source} IN ('ROLE', 'USER')`),
    check("notification_recipient_rules_visibility_chk", sql`${table.visibility} IN ('TO', 'CC')`),
    check("notification_recipient_rules_role_chk", sql`${table.role} IS NULL OR ${table.role} IN ('PMO', 'ADMIN')`),
    check(
      "notification_recipient_rules_target_chk",
      sql`(${table.source} = 'ROLE' AND ${table.role} IS NOT NULL AND ${table.userId} IS NULL) OR (${table.source} = 'USER' AND ${table.userId} IS NOT NULL AND ${table.role} IS NULL)`,
    ),
    uniqueIndex("notification_recipient_rules_target_uq").on(
      table.kind,
      table.source,
      sql`coalesce(${table.role}, '')`,
      sql`coalesce(${table.userId}, '')`,
      table.visibility,
    ),
  ],
);

/** Execução do gerador. A simulação (DRY_RUN) grava somente aqui. */
export const notificationRuns = pgTable(
  "notification_runs",
  {
    id: text("id").primaryKey(),
    mode: text("mode").notNull(),
    origin: text("origin").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
    actorId: text("actor_id").references(() => user.id, { onDelete: "restrict" }),
    /** Instante de referência da avaliação (permite reproduzir uma simulação). */
    asOf: timestamp("as_of").notNull(),
    /** Corte usado numa simulação com a ativação desligada. */
    simulatedCutoff: date("simulated_cutoff", { mode: "string" }),
    evaluatedProjects: integer("evaluated_projects").default(0).notNull(),
    createdNotifications: integer("created_notifications").default(0).notNull(),
    resolvedNotifications: integer("resolved_notifications").default(0).notNull(),
    issuesSeen: integer("issues_seen").default(0).notNull(),
    summary: jsonb("summary"),
    error: text("error"),
  },
  (table) => [
    check("notification_runs_mode_chk", sql`${table.mode} IN ('DRY_RUN', 'ACTIVE')`),
    check("notification_runs_origin_chk", sql`${table.origin} IN ('CLI', 'API', 'SCHEDULER')`),
    check("notification_runs_status_chk", sql`${table.status} IN ('RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED_LOCKED')`),
    index("notification_runs_started_idx").on(table.startedAt),
  ],
);

/** Aviso gerado para um projeto e ciclo. dedupe_key único impede duplicação, inclusive em execuções concorrentes. */
export const executiveFollowupNotifications = pgTable(
  "executive_followup_notifications",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    cycleStart: date("cycle_start", { mode: "string" }).notNull(),
    /** Início da sequência de ciclos sem validação (obrigatório no escalonamento). */
    sequenceStart: date("sequence_start", { mode: "string" }),
    /** Vencimento original; nunca muda mesmo que o envio seja adiado para um dia útil. */
    dueDate: date("due_date", { mode: "string" }).notNull(),
    scheduledFor: timestamp("scheduled_for").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    followupSnapshot: jsonb("followup_snapshot").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => notificationRuns.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at"),
    resolutionReason: text("resolution_reason"),
    resolvedValidationId: text("resolved_validation_id").references(() => projectExecutiveSummaryValidations.id, { onDelete: "restrict" }),
    resolvedRunId: text("resolved_run_id").references(() => notificationRuns.id, { onDelete: "restrict" }),
  },
  (table) => [
    check("executive_followup_notifications_kind_chk", sql`${table.kind} IN ('PREVENTIVE', 'OVERDUE', 'ESCALATION')`),
    check("executive_followup_notifications_sequence_chk", sql`${table.kind} <> 'ESCALATION' OR ${table.sequenceStart} IS NOT NULL`),
    check(
      "executive_followup_notifications_resolution_chk",
      sql`(${table.resolvedAt} IS NULL) = (${table.resolutionReason} IS NULL)`,
    ),
    check(
      "executive_followup_notifications_reason_chk",
      sql`${table.resolutionReason} IS NULL OR ${table.resolutionReason} IN ('VALIDATED', 'PROJECT_SUSPENDED', 'PROJECT_CONCLUDED', 'CYCLE_EXPIRED')`,
    ),
    check(
      "executive_followup_notifications_validated_chk",
      sql`${table.resolutionReason} IS DISTINCT FROM 'VALIDATED' OR ${table.resolvedValidationId} IS NOT NULL`,
    ),
    uniqueIndex("executive_followup_notifications_dedupe_uq").on(table.dedupeKey),
    index("executive_followup_notifications_project_idx").on(table.projectId, table.kind, table.cycleStart),
    index("executive_followup_notifications_open_idx").on(table.projectId).where(sql`${table.resolvedAt} IS NULL`),
  ],
);

/** Um destinatário de uma notificação. Guarda cópia de nome, e-mail e perfil da época. */
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: text("id").primaryKey(),
    notificationId: text("notification_id")
      .notNull()
      .references(() => executiveFollowupNotifications.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    recipientName: text("recipient_name").notNull(),
    recipientEmail: text("recipient_email").notNull(),
    recipientRole: text("recipient_role").notNull(),
    visibility: text("visibility").notNull(),
    deliveredAt: timestamp("delivered_at").defaultNow().notNull(),
    readAt: timestamp("read_at"),
  },
  (table) => [
    check("notification_deliveries_visibility_chk", sql`${table.visibility} IN ('TO', 'CC')`),
    uniqueIndex("notification_deliveries_recipient_uq").on(table.notificationId, table.userId),
    index("notification_deliveries_inbox_idx").on(table.userId, table.readAt),
  ],
);

/** Ocorrências administrativas (calendário não validado, sem destinatário...). Uma aberta por chave. */
export const notificationIssues = pgTable(
  "notification_issues",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    year: integer("year"),
    details: jsonb("details").notNull(),
    firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
    occurrences: integer("occurrences").default(1).notNull(),
    resolvedAt: timestamp("resolved_at"),
    /** AUTO (a causa deixou de existir) ou MANUAL (ADMIN, com nota). */
    resolution: text("resolution"),
    resolvedBy: text("resolved_by").references(() => user.id, { onDelete: "restrict" }),
    resolutionNote: text("resolution_note"),
  },
  (table) => [
    check(
      "notification_issues_kind_chk",
      sql`${table.kind} IN ('CALENDAR_NOT_VALIDATED', 'NO_RECIPIENT', 'RECIPIENT_INACTIVE', 'RULE_MISSING', 'SCHEDULER_FAILURE')`,
    ),
    check("notification_issues_resolution_chk", sql`(${table.resolvedAt} IS NULL) = (${table.resolution} IS NULL)`),
    check("notification_issues_resolution_kind_chk", sql`${table.resolution} IS NULL OR ${table.resolution} IN ('AUTO', 'MANUAL')`),
    check("notification_issues_manual_chk", sql`${table.resolution} IS DISTINCT FROM 'MANUAL' OR (${table.resolvedBy} IS NOT NULL AND length(btrim(${table.resolutionNote})) > 0)`),
    uniqueIndex("notification_issues_open_uq").on(table.dedupeKey).where(sql`${table.resolvedAt} IS NULL`),
    index("notification_issues_open_idx").on(table.kind).where(sql`${table.resolvedAt} IS NULL`),
  ],
);

/**
 * Estado do agendador (linha única). A reserva (claim_token / claimed_until) controla o ritmo (uma instância por intervalo)
 * e serve de barreira contra execução zumbi: toda gravação confere o token na própria transação. A prova de que alguém está
 * executando de fato é a trava consultiva do Postgres, não o relógio. Os horários usam o relógio do banco (UTC).
 */
export const notificationSchedulerState = pgTable(
  "notification_scheduler_state",
  {
    id: text("id").primaryKey(),
    nextDueAt: timestamp("next_due_at"),
    claimToken: text("claim_token"),
    claimedBy: text("claimed_by"),
    claimedUntil: timestamp("claimed_until"),
    lastStartedAt: timestamp("last_started_at"),
    lastFinishedAt: timestamp("last_finished_at"),
    lastSuccessAt: timestamp("last_success_at"),
    lastStatus: text("last_status"),
    lastError: text("last_error"),
    consecutiveFailures: integer("consecutive_failures").default(0).notNull(),
    consecutiveSuccesses: integer("consecutive_successes").default(0).notNull(),
    lastRunId: text("last_run_id").references(() => notificationRuns.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    check("notification_scheduler_state_singleton_chk", sql`${table.id} = 'GLOBAL'`),
    check(
      "notification_scheduler_state_status_chk",
      sql`${table.lastStatus} IS NULL OR ${table.lastStatus} IN ('IDLE_ACTIVATION_OFF', 'IDLE_NOTHING_TO_DO', 'TECHNICAL_ONLY', 'RAN', 'FAILED', 'ABORTED_LEASE_LOST', 'SKIPPED_LOCKED', 'SKIPPED_STANDBY')`,
    ),
    check("notification_scheduler_state_counters_chk", sql`${table.consecutiveFailures} >= 0 AND ${table.consecutiveSuccesses} >= 0`),
  ],
);

/** Batimentos das instâncias do agendador (plugin da API ou processo dedicado). Registros técnicos: a limpeza é controlada. */
export const notificationSchedulerInstances = pgTable(
  "notification_scheduler_instances",
  {
    instanceId: text("instance_id").primaryKey(),
    mode: text("mode").notNull(),
    hostname: text("hostname").notNull(),
    pid: integer("pid").notNull(),
    intervalSeconds: integer("interval_seconds").notNull(),
    startedAt: timestamp("started_at").notNull(),
    lastSeenAt: timestamp("last_seen_at").notNull(),
    stoppedAt: timestamp("stopped_at"),
    stopReason: text("stop_reason"),
  },
  (table) => [
    check("notification_scheduler_instances_mode_chk", sql`${table.mode} IN ('PLUGIN', 'WORKER')`),
    index("notification_scheduler_instances_seen_idx").on(table.lastSeenAt),
  ],
);
