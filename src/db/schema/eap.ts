import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth-schema";
import { projects } from "./projects";

export const eapPhaseStatusEnum = pgEnum("eap_phase_status", [
  "NAO_INICIADA",
  "EM_ANDAMENTO",
  "CONCLUIDA",
  "SUSPENSA",
]);

export const eapTaskStatusEnum = pgEnum("eap_task_status", [
  "NAO_INICIADA",
  "EM_ANDAMENTO",
  "IMPEDIDA",
  "CONCLUIDA",
  "CANCELADA",
]);

export const eapMilestoneTypeEnum = pgEnum("eap_milestone_type", [
  "ENTREGA",
  "APROVACAO",
  "HOMOLOGACAO",
]);

export const eapMilestoneStatusEnum = pgEnum("eap_milestone_status", [
  "PENDENTE",
  "ENTREGUE",
  "APROVADO",
  "REJEITADO",
  "AJUSTES_SOLICITADOS",
]);

export const eapMilestoneDeliveryStatusEnum = pgEnum("eap_milestone_delivery_status", [
  "EM_ANALISE",
  "ACEITA",
  "AJUSTES_SOLICITADOS",
  "REJEITADA",
]);

export const eapScheduleFieldEnum = pgEnum("eap_schedule_field", [
  "PLANNED_START_AT",
  "PLANNED_END_AT",
  "PLANNED_AT",
]);

export const eapScheduleRequestStatusEnum = pgEnum("eap_schedule_request_status", [
  "PENDENTE",
  "APROVADA",
  "REJEITADA",
  "CANCELADA",
  "CANCELADA_CONFLITO",
]);

export const eapAuditActionEnum = pgEnum("eap_audit_action", [
  "CREATE",
  "UPDATE",
  "STATUS_CHANGE",
  "SCHEDULE_REQUEST",
  "SCHEDULE_APPROVE",
  "SCHEDULE_REJECT",
  "SCHEDULE_CANCEL",
  "SCHEDULE_STALE",
  "SCHEDULE_CHANGE",
  "VALIDATE",
  "IMPEDE",
  "CLEAR_IMPEDIMENT",
  "DELETE",
  "MEMBER_ADD",
  "MEMBER_UPDATE",
  "MEMBER_REMOVE",
  "OWNER_TRANSFER",
]);

const exclusiveScheduleTargetChk = (
  name: string,
  phaseId: unknown,
  taskId: unknown,
  milestoneId: unknown,
  field: unknown,
) =>
  check(
    name,
    sql`(
      (
        ${phaseId} IS NOT NULL
        AND ${taskId} IS NULL
        AND ${milestoneId} IS NULL
        AND ${field} IN ('PLANNED_START_AT', 'PLANNED_END_AT')
      ) OR (
        ${phaseId} IS NULL
        AND ${taskId} IS NOT NULL
        AND ${milestoneId} IS NULL
        AND ${field} IN ('PLANNED_START_AT', 'PLANNED_END_AT')
      ) OR (
        ${phaseId} IS NULL
        AND ${taskId} IS NULL
        AND ${milestoneId} IS NOT NULL
        AND ${field} = 'PLANNED_AT'
      )
    )`,
  );

export const eapPhases = pgTable(
  "eap_phases",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull(),
    status: eapPhaseStatusEnum("status").default("NAO_INICIADA").notNull(),
    baselineStartAt: timestamp("baseline_start_at"),
    baselineEndAt: timestamp("baseline_end_at"),
    plannedStartAt: timestamp("planned_start_at"),
    plannedEndAt: timestamp("planned_end_at"),
    actualStartAt: timestamp("actual_start_at"),
    actualEndAt: timestamp("actual_end_at"),
    responsibleId: text("responsible_id").references(() => user.id),
    completionCriteria: text("completion_criteria"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("eap_phases_project_sort_order_unique").on(table.projectId, table.sortOrder),
    index("eap_phases_project_id_idx").on(table.projectId),
    index("eap_phases_responsible_id_idx").on(table.responsibleId),
    check("eap_phases_sort_order_chk", sql`${table.sortOrder} >= 0`),
    check(
      "eap_phases_planned_dates_chk",
      sql`${table.plannedEndAt} IS NULL OR ${table.plannedStartAt} IS NULL OR ${table.plannedEndAt} >= ${table.plannedStartAt}`,
    ),
    check(
      "eap_phases_baseline_dates_chk",
      sql`${table.baselineEndAt} IS NULL OR ${table.baselineStartAt} IS NULL OR ${table.baselineEndAt} >= ${table.baselineStartAt}`,
    ),
    check(
      "eap_phases_actual_dates_chk",
      sql`${table.actualEndAt} IS NULL OR (${table.actualStartAt} IS NOT NULL AND ${table.actualEndAt} >= ${table.actualStartAt})`,
    ),
  ],
);

export const eapTasks = pgTable(
  "eap_tasks",
  {
    id: text("id").primaryKey(),
    phaseId: text("phase_id")
      .notNull()
      .references(() => eapPhases.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull(),
    assigneeId: text("assignee_id").references(() => user.id),
    status: eapTaskStatusEnum("status").default("NAO_INICIADA").notNull(),
    progressPercent: integer("progress_percent").default(0).notNull(),
    weight: integer("weight").default(1).notNull(),
    baselineStartAt: timestamp("baseline_start_at"),
    baselineEndAt: timestamp("baseline_end_at"),
    plannedStartAt: timestamp("planned_start_at"),
    plannedEndAt: timestamp("planned_end_at"),
    actualStartAt: timestamp("actual_start_at"),
    actualEndAt: timestamp("actual_end_at"),
    hasImpediment: boolean("has_impediment").default(false).notNull(),
    /** Tarefa corretiva aberta para atender às correções solicitadas na homologação do marco. */
    correctiveMilestoneId: text("corrective_milestone_id").references(
      (): AnyPgColumn => eapMilestones.id,
      { onDelete: "set null" },
    ),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("eap_tasks_phase_sort_order_unique").on(table.phaseId, table.sortOrder),
    check("eap_tasks_sort_order_chk", sql`${table.sortOrder} >= 0`),
    index("eap_tasks_phase_id_idx").on(table.phaseId),
    index("eap_tasks_assignee_id_idx").on(table.assigneeId),
    index("eap_tasks_corrective_milestone_id_idx").on(table.correctiveMilestoneId),
    index("eap_tasks_status_planned_end_idx").on(table.status, table.plannedEndAt),
    check(
      "eap_tasks_progress_percent_chk",
      sql`${table.progressPercent} >= 0 AND ${table.progressPercent} <= 100`,
    ),
    check(
      "eap_tasks_concluded_progress_chk",
      sql`${table.status} <> 'CONCLUIDA' OR ${table.progressPercent} = 100`,
    ),
    check("eap_tasks_weight_chk", sql`${table.weight} >= 1`),
    check(
      "eap_tasks_planned_dates_chk",
      sql`${table.plannedEndAt} IS NULL OR ${table.plannedStartAt} IS NULL OR ${table.plannedEndAt} >= ${table.plannedStartAt}`,
    ),
    check(
      "eap_tasks_baseline_dates_chk",
      sql`${table.baselineEndAt} IS NULL OR ${table.baselineStartAt} IS NULL OR ${table.baselineEndAt} >= ${table.baselineStartAt}`,
    ),
    check(
      "eap_tasks_actual_dates_chk",
      sql`${table.actualEndAt} IS NULL OR (${table.actualStartAt} IS NOT NULL AND ${table.actualEndAt} >= ${table.actualStartAt})`,
    ),
  ],
);

export const eapMilestones = pgTable(
  "eap_milestones",
  {
    id: text("id").primaryKey(),
    phaseId: text("phase_id")
      .notNull()
      .references(() => eapPhases.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull(),
    type: eapMilestoneTypeEnum("type").notNull(),
    status: eapMilestoneStatusEnum("status").default("PENDENTE").notNull(),
    baselineAt: timestamp("baseline_at"),
    plannedAt: timestamp("planned_at"),
    actualAt: timestamp("actual_at"),
    deliveredBy: text("delivered_by").references(() => user.id),
    validatedBy: text("validated_by").references(() => user.id),
    validationNote: text("validation_note"),
    validatedAt: timestamp("validated_at"),
    /** Gestor validador: aceita ou rejeita o marco. */
    reviewerId: text("reviewer_id").references(() => user.id),
    /** Pessoa designada para apresentar o marco ao gestor validador. */
    presenterId: text("presenter_id").references(() => user.id),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("eap_milestones_phase_sort_order_unique").on(table.phaseId, table.sortOrder),
    check("eap_milestones_sort_order_chk", sql`${table.sortOrder} >= 0`),
    index("eap_milestones_phase_id_idx").on(table.phaseId),
    index("eap_milestones_status_planned_at_idx").on(table.status, table.plannedAt),
    index("eap_milestones_delivered_by_idx").on(table.deliveredBy),
    index("eap_milestones_reviewer_id_idx").on(table.reviewerId),
    index("eap_milestones_presenter_id_idx").on(table.presenterId),
  ],
);

/**
 * Rodadas de homologação de marcos de entrega. Cada envio gera uma rodada; decisões e autorizações
 * de reenvio são gravadas na própria rodada e nunca sobrescrevem rodadas anteriores.
 * `legacy` identifica a rodada criada a partir de uma entrega anterior ao controle de rodadas.
 */
export const eapMilestoneDeliveries = pgTable(
  "eap_milestone_deliveries",
  {
    id: text("id").primaryKey(),
    milestoneId: text("milestone_id")
      .notNull()
      .references(() => eapMilestones.id, { onDelete: "cascade" }),
    round: integer("round").notNull(),
    legacy: boolean("legacy").default(false).notNull(),
    status: eapMilestoneDeliveryStatusEnum("status").default("EM_ANALISE").notNull(),
    submittedBy: text("submitted_by")
      .notNull()
      .references(() => user.id),
    submittedAt: timestamp("submitted_at"),
    note: text("note"),
    decidedBy: text("decided_by").references(() => user.id),
    decidedAt: timestamp("decided_at"),
    decisionNote: text("decision_note"),
    nonconformities: text("nonconformities"),
    adjustments: text("adjustments"),
    resubmissionAuthorizedBy: text("resubmission_authorized_by").references(() => user.id),
    resubmissionAuthorizedAt: timestamp("resubmission_authorized_at"),
    resubmissionNote: text("resubmission_note"),
  },
  (table) => [
    unique("eap_milestone_deliveries_round_unique").on(table.milestoneId, table.round),
    index("eap_milestone_deliveries_milestone_id_idx").on(table.milestoneId),
    uniqueIndex("eap_milestone_deliveries_open_idx")
      .on(table.milestoneId)
      .where(sql`${table.status} = 'EM_ANALISE'`),
    check("eap_milestone_deliveries_round_chk", sql`${table.round} >= 1`),
    check(
      "eap_milestone_deliveries_submitted_at_chk",
      sql`${table.legacy} OR ${table.submittedAt} IS NOT NULL`,
    ),
    check(
      "eap_milestone_deliveries_decision_chk",
      sql`(
        (
          ${table.status} = 'EM_ANALISE'
          AND ${table.decidedBy} IS NULL
          AND ${table.decidedAt} IS NULL
        ) OR (
          ${table.status} = 'ACEITA'
          AND ${table.decidedBy} IS NOT NULL
          AND ${table.decidedAt} IS NOT NULL
        ) OR (
          ${table.status} IN ('AJUSTES_SOLICITADOS', 'REJEITADA')
          AND ${table.decidedBy} IS NOT NULL
          AND ${table.decidedAt} IS NOT NULL
          AND char_length(btrim(${table.decisionNote})) >= 10
        )
      )`,
    ),
    check(
      "eap_milestone_deliveries_resubmission_chk",
      sql`(
        ${table.resubmissionAuthorizedAt} IS NULL
        AND ${table.resubmissionAuthorizedBy} IS NULL
        AND ${table.resubmissionNote} IS NULL
      ) OR (
        ${table.status} = 'REJEITADA'
        AND ${table.resubmissionAuthorizedAt} IS NOT NULL
        AND ${table.resubmissionAuthorizedBy} IS NOT NULL
        AND char_length(btrim(${table.resubmissionNote})) >= 10
      )`,
    ),
  ],
);

export const eapScheduleRequests = pgTable(
  "eap_schedule_requests",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    phaseId: text("phase_id").references(() => eapPhases.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => eapTasks.id, { onDelete: "cascade" }),
    milestoneId: text("milestone_id").references(() => eapMilestones.id, {
      onDelete: "cascade",
    }),
    field: eapScheduleFieldEnum("field").notNull(),
    baselineValue: timestamp("baseline_value"),
    expectedCurrentValue: timestamp("expected_current_value"),
    proposedValue: timestamp("proposed_value").notNull(),
    justification: text("justification").notNull(),
    status: eapScheduleRequestStatusEnum("status").default("PENDENTE").notNull(),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => user.id),
    requestedAt: timestamp("requested_at").defaultNow().notNull(),
    reviewedBy: text("reviewed_by").references(() => user.id),
    reviewedAt: timestamp("reviewed_at"),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("eap_schedule_requests_project_status_idx").on(table.projectId, table.status),
    index("eap_schedule_requests_phase_id_idx").on(table.phaseId),
    index("eap_schedule_requests_task_id_idx").on(table.taskId),
    index("eap_schedule_requests_milestone_id_idx").on(table.milestoneId),
    uniqueIndex("eap_schedule_requests_pending_phase_field_idx")
      .on(table.phaseId, table.field)
      .where(sql`${table.status} = 'PENDENTE' AND ${table.phaseId} IS NOT NULL`),
    uniqueIndex("eap_schedule_requests_pending_task_field_idx")
      .on(table.taskId, table.field)
      .where(sql`${table.status} = 'PENDENTE' AND ${table.taskId} IS NOT NULL`),
    uniqueIndex("eap_schedule_requests_pending_milestone_field_idx")
      .on(table.milestoneId, table.field)
      .where(sql`${table.status} = 'PENDENTE' AND ${table.milestoneId} IS NOT NULL`),
    check(
      "eap_schedule_requests_justification_chk",
      sql`char_length(btrim(${table.justification})) >= 10`,
    ),
    exclusiveScheduleTargetChk(
      "eap_schedule_requests_target_chk",
      table.phaseId,
      table.taskId,
      table.milestoneId,
      table.field,
    ),
    check(
      "eap_schedule_requests_status_review_chk",
      sql`(
        (
          ${table.status} = 'PENDENTE'
          AND ${table.reviewedBy} IS NULL
          AND ${table.reviewedAt} IS NULL
          AND ${table.decisionNote} IS NULL
        ) OR (
          ${table.status} = 'APROVADA'
          AND ${table.reviewedBy} IS NOT NULL
          AND ${table.reviewedAt} IS NOT NULL
        ) OR (
          ${table.status} = 'REJEITADA'
          AND ${table.reviewedBy} IS NOT NULL
          AND ${table.reviewedAt} IS NOT NULL
          AND ${table.decisionNote} IS NOT NULL
          AND char_length(btrim(${table.decisionNote})) >= 10
        ) OR (
          ${table.status} = 'CANCELADA'
          AND ${table.reviewedBy} IS NULL
          AND ${table.reviewedAt} IS NOT NULL
        ) OR (
          ${table.status} = 'CANCELADA_CONFLITO'
          AND ${table.reviewedBy} IS NULL
          AND ${table.reviewedAt} IS NOT NULL
          AND ${table.decisionNote} IS NOT NULL
          AND char_length(btrim(${table.decisionNote})) >= 10
        )
      )`,
    ),
  ],
);

export const eapScheduleChanges = pgTable(
  "eap_schedule_changes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    requestId: text("request_id")
      .notNull()
      .references(() => eapScheduleRequests.id, { onDelete: "cascade" }),
    phaseId: text("phase_id").references(() => eapPhases.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => eapTasks.id, { onDelete: "cascade" }),
    milestoneId: text("milestone_id").references(() => eapMilestones.id, {
      onDelete: "cascade",
    }),
    field: eapScheduleFieldEnum("field").notNull(),
    baselineValue: timestamp("baseline_value"),
    oldValue: timestamp("old_value"),
    newValue: timestamp("new_value").notNull(),
    changedBy: text("changed_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("eap_schedule_changes_project_id_idx").on(table.projectId),
    index("eap_schedule_changes_request_id_idx").on(table.requestId),
    index("eap_schedule_changes_phase_id_idx").on(table.phaseId),
    index("eap_schedule_changes_task_id_idx").on(table.taskId),
    index("eap_schedule_changes_milestone_id_idx").on(table.milestoneId),
    exclusiveScheduleTargetChk(
      "eap_schedule_changes_target_chk",
      table.phaseId,
      table.taskId,
      table.milestoneId,
      table.field,
    ),
  ],
);

export const eapEvidences = pgTable(
  "eap_evidences",
  {
    id: text("id").primaryKey(),
    phaseId: text("phase_id").references(() => eapPhases.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => eapTasks.id, { onDelete: "cascade" }),
    milestoneId: text("milestone_id").references(() => eapMilestones.id, {
      onDelete: "cascade",
    }),
    scheduleRequestId: text("schedule_request_id").references(
      () => eapScheduleRequests.id,
      { onDelete: "cascade" },
    ),
    title: text("title").notNull(),
    url: text("url").notNull(),
    deliveryId: text("delivery_id").references(() => eapMilestoneDeliveries.id, {
      onDelete: "set null",
    }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("eap_evidences_delivery_id_idx").on(table.deliveryId),
    index("eap_evidences_phase_id_idx").on(table.phaseId),
    index("eap_evidences_task_id_idx").on(table.taskId),
    index("eap_evidences_milestone_id_idx").on(table.milestoneId),
    index("eap_evidences_schedule_request_id_idx").on(table.scheduleRequestId),
    check(
      "eap_evidences_exactly_one_parent_chk",
      sql`(
        (CASE WHEN ${table.phaseId} IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN ${table.taskId} IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN ${table.milestoneId} IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN ${table.scheduleRequestId} IS NULL THEN 0 ELSE 1 END)
      ) = 1`,
    ),
  ],
);

export const eapImpediments = pgTable(
  "eap_impediments",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => eapTasks.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    openedBy: text("opened_by")
      .notNull()
      .references(() => user.id),
    openedAt: timestamp("opened_at").defaultNow().notNull(),
    resolvedBy: text("resolved_by").references(() => user.id),
    resolvedAt: timestamp("resolved_at"),
    resolutionNote: text("resolution_note"),
  },
  (table) => [
    index("eap_impediments_task_id_idx").on(table.taskId),
    uniqueIndex("eap_impediments_open_task_idx")
      .on(table.taskId)
      .where(sql`${table.resolvedAt} IS NULL`),
    check(
      "eap_impediments_resolution_chk",
      sql`(
        (
          ${table.resolvedAt} IS NULL
          AND ${table.resolvedBy} IS NULL
          AND ${table.resolutionNote} IS NULL
        ) OR (
          ${table.resolvedAt} IS NOT NULL
          AND ${table.resolvedBy} IS NOT NULL
          AND ${table.resolvedAt} >= ${table.openedAt}
        )
      )`,
    ),
  ],
);

export const eapAuditLogs = pgTable(
  "eap_audit_logs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: eapAuditActionEnum("action").notNull(),
    summary: text("summary").notNull(),
    payload: jsonb("payload"),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("eap_audit_logs_project_id_idx").on(table.projectId),
    index("eap_audit_logs_entity_idx").on(table.entityType, table.entityId),
    index("eap_audit_logs_created_at_idx").on(table.createdAt),
  ],
);

export const eapPhasesRelations = relations(eapPhases, ({ one, many }) => ({
  project: one(projects, {
    fields: [eapPhases.projectId],
    references: [projects.id],
  }),
  tasks: many(eapTasks),
  milestones: many(eapMilestones),
  scheduleRequests: many(eapScheduleRequests),
  evidences: many(eapEvidences),
  responsible: one(user, {
    fields: [eapPhases.responsibleId],
    references: [user.id],
    relationName: "eap_phases_responsible",
  }),
  createdByUser: one(user, {
    fields: [eapPhases.createdBy],
    references: [user.id],
    relationName: "eap_phases_created_by",
  }),
  updatedByUser: one(user, {
    fields: [eapPhases.updatedBy],
    references: [user.id],
    relationName: "eap_phases_updated_by",
  }),
}));

export const eapTasksRelations = relations(eapTasks, ({ one, many }) => ({
  phase: one(eapPhases, {
    fields: [eapTasks.phaseId],
    references: [eapPhases.id],
  }),
  assignee: one(user, {
    fields: [eapTasks.assigneeId],
    references: [user.id],
    relationName: "eap_tasks_assignee",
  }),
  impediments: many(eapImpediments),
  evidences: many(eapEvidences),
  scheduleRequests: many(eapScheduleRequests),
}));

export const eapMilestonesRelations = relations(eapMilestones, ({ one, many }) => ({
  phase: one(eapPhases, {
    fields: [eapMilestones.phaseId],
    references: [eapPhases.id],
  }),
  deliverer: one(user, {
    fields: [eapMilestones.deliveredBy],
    references: [user.id],
    relationName: "eap_milestones_delivered_by",
  }),
  validator: one(user, {
    fields: [eapMilestones.validatedBy],
    references: [user.id],
    relationName: "eap_milestones_validated_by",
  }),
  reviewer: one(user, {
    fields: [eapMilestones.reviewerId],
    references: [user.id],
    relationName: "eap_milestones_reviewer",
  }),
  presenter: one(user, {
    fields: [eapMilestones.presenterId],
    references: [user.id],
    relationName: "eap_milestones_presenter",
  }),
  deliveries: many(eapMilestoneDeliveries),
  evidences: many(eapEvidences),
  scheduleRequests: many(eapScheduleRequests),
}));

export const eapMilestoneDeliveriesRelations = relations(
  eapMilestoneDeliveries,
  ({ one, many }) => ({
    milestone: one(eapMilestones, {
      fields: [eapMilestoneDeliveries.milestoneId],
      references: [eapMilestones.id],
    }),
    evidences: many(eapEvidences),
  }),
);

export const eapScheduleRequestsRelations = relations(
  eapScheduleRequests,
  ({ one, many }) => ({
    project: one(projects, {
      fields: [eapScheduleRequests.projectId],
      references: [projects.id],
    }),
    phase: one(eapPhases, {
      fields: [eapScheduleRequests.phaseId],
      references: [eapPhases.id],
    }),
    task: one(eapTasks, {
      fields: [eapScheduleRequests.taskId],
      references: [eapTasks.id],
    }),
    milestone: one(eapMilestones, {
      fields: [eapScheduleRequests.milestoneId],
      references: [eapMilestones.id],
    }),
    requester: one(user, {
      fields: [eapScheduleRequests.requestedBy],
      references: [user.id],
      relationName: "eap_schedule_requests_requested_by",
    }),
    reviewer: one(user, {
      fields: [eapScheduleRequests.reviewedBy],
      references: [user.id],
      relationName: "eap_schedule_requests_reviewed_by",
    }),
    changes: many(eapScheduleChanges),
    evidences: many(eapEvidences),
  }),
);

export const eapScheduleChangesRelations = relations(eapScheduleChanges, ({ one }) => ({
  project: one(projects, {
    fields: [eapScheduleChanges.projectId],
    references: [projects.id],
  }),
  request: one(eapScheduleRequests, {
    fields: [eapScheduleChanges.requestId],
    references: [eapScheduleRequests.id],
  }),
  phase: one(eapPhases, {
    fields: [eapScheduleChanges.phaseId],
    references: [eapPhases.id],
  }),
  task: one(eapTasks, {
    fields: [eapScheduleChanges.taskId],
    references: [eapTasks.id],
  }),
  milestone: one(eapMilestones, {
    fields: [eapScheduleChanges.milestoneId],
    references: [eapMilestones.id],
  }),
  changedByUser: one(user, {
    fields: [eapScheduleChanges.changedBy],
    references: [user.id],
    relationName: "eap_schedule_changes_changed_by",
  }),
}));

export const eapEvidencesRelations = relations(eapEvidences, ({ one }) => ({
  phase: one(eapPhases, {
    fields: [eapEvidences.phaseId],
    references: [eapPhases.id],
  }),
  task: one(eapTasks, {
    fields: [eapEvidences.taskId],
    references: [eapTasks.id],
  }),
  milestone: one(eapMilestones, {
    fields: [eapEvidences.milestoneId],
    references: [eapMilestones.id],
  }),
  scheduleRequest: one(eapScheduleRequests, {
    fields: [eapEvidences.scheduleRequestId],
    references: [eapScheduleRequests.id],
  }),
  delivery: one(eapMilestoneDeliveries, {
    fields: [eapEvidences.deliveryId],
    references: [eapMilestoneDeliveries.id],
  }),
  createdByUser: one(user, {
    fields: [eapEvidences.createdBy],
    references: [user.id],
    relationName: "eap_evidences_created_by",
  }),
}));

export const eapImpedimentsRelations = relations(eapImpediments, ({ one }) => ({
  task: one(eapTasks, {
    fields: [eapImpediments.taskId],
    references: [eapTasks.id],
  }),
}));

export const eapAuditLogsRelations = relations(eapAuditLogs, ({ one }) => ({
  project: one(projects, {
    fields: [eapAuditLogs.projectId],
    references: [projects.id],
  }),
  actor: one(user, {
    fields: [eapAuditLogs.actorId],
    references: [user.id],
    relationName: "eap_audit_logs_actor",
  }),
}));
