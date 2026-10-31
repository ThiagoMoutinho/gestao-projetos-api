import { sql } from "drizzle-orm";
import {
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
} from "drizzle-orm/pg-core";

import { user } from "./auth-schema";
import { eapMilestones } from "./eap";
import { projects } from "./projects";

export const projectProfileFieldEnum = pgEnum("project_profile_field", [
  "PURPOSE",
  "SCOPE",
  "PROBLEM",
  "REQUESTING_AREA",
  "RESPONSIBLE_COMPANY",
  "BENEFITED_SECTORS",
  "SYSTEM_DESCRIPTION",
  "RESULTS_SUMMARY",
]);

export const projectResultTypeEnum = pgEnum("project_result_type", ["ESPERADO", "ALCANCADO"]);

/**
 * Campos institucionais manuais do projeto, um registro por campo.
 *
 * Cada registro tem dois espaços independentes: a versão publicada (validada) e o rascunho aguardando
 * validação. Editar grava só o rascunho, então a última versão validada continua sendo a exibida até que
 * outro usuário valide a alteração. O histórico completo fica em `eap_audit_logs` (PROJECT_PROFILE).
 */
export const projectProfileFields = pgTable(
  "project_profile_fields",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    field: projectProfileFieldEnum("field").notNull(),
    publishedValue: text("published_value"),
    /** Quem redigiu a versão publicada. */
    publishedBy: text("published_by").references(() => user.id),
    publishedAt: timestamp("published_at"),
    validatedBy: text("validated_by").references(() => user.id),
    validatedAt: timestamp("validated_at"),
    draftValue: text("draft_value"),
    draftBy: text("draft_by").references(() => user.id),
    draftAt: timestamp("draft_at"),
  },
  (table) => [
    unique("project_profile_fields_project_field_unique").on(table.projectId, table.field),
    index("project_profile_fields_project_id_idx").on(table.projectId),
    check(
      "project_profile_fields_published_complete_chk",
      // Campos de preenchimento direto pelo gestor (empresa responsável e setores) são publicados sem validador.
      sql`(
        (${table.publishedValue} IS NULL) = (${table.publishedBy} IS NULL)
        AND (${table.publishedValue} IS NULL) = (${table.publishedAt} IS NULL)
        AND (${table.validatedBy} IS NULL) = (${table.validatedAt} IS NULL)
        AND (${table.validatedBy} IS NULL OR ${table.publishedValue} IS NOT NULL)
      )`,
    ),
    check(
      "project_profile_fields_draft_complete_chk",
      sql`(
        (CASE WHEN ${table.draftValue} IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN ${table.draftBy} IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN ${table.draftAt} IS NULL THEN 0 ELSE 1 END)
      ) IN (0, 3)`,
    ),
    check(
      "project_profile_fields_has_version_chk",
      sql`${table.publishedValue} IS NOT NULL OR ${table.draftValue} IS NOT NULL`,
    ),
    check(
      "project_profile_fields_no_self_validation_chk",
      sql`${table.validatedBy} IS NULL OR ${table.validatedBy} <> ${table.publishedBy}`,
    ),
    check(
      "project_profile_fields_text_chk",
      sql`(${table.publishedValue} IS NULL OR btrim(${table.publishedValue}) <> '')
        AND (${table.draftValue} IS NULL OR btrim(${table.draftValue}) <> '')`,
    ),
  ],
);

/** Campos estruturados opcionais de um resultado; todos podem faltar. */
export type ResultDetails = {
  target?: string | null;
  indicator?: string | null;
  dueDate?: string | null;
  obtainedValue?: string | null;
  observation?: string | null;
};

/** Resultados para o IGEPPS, esperados e alcançados separados por tipo; mesma lógica de publicado e rascunho. */
export const projectResults = pgTable(
  "project_results",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    type: projectResultTypeEnum("type").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    publishedText: text("published_text"),
    publishedResultDate: timestamp("published_result_date"),
    publishedMilestoneId: text("published_milestone_id").references(() => eapMilestones.id, {
      onDelete: "set null",
    }),
    publishedBy: text("published_by").references(() => user.id),
    publishedAt: timestamp("published_at"),
    validatedBy: text("validated_by").references(() => user.id),
    validatedAt: timestamp("validated_at"),
    draftText: text("draft_text"),
    draftResultDate: timestamp("draft_result_date"),
    draftMilestoneId: text("draft_milestone_id").references(() => eapMilestones.id, {
      onDelete: "set null",
    }),
    draftBy: text("draft_by").references(() => user.id),
    draftAt: timestamp("draft_at"),
    /** Meta, indicador, prazo, valor obtido e observações; versionados junto com o texto (publicado e rascunho). */
    publishedDetails: jsonb("published_details").$type<ResultDetails>(),
    draftDetails: jsonb("draft_details").$type<ResultDetails>(),
    /** Resultado alcançado não previsto entre os esperados. */
    unforeseen: boolean("unforeseen").default(false).notNull(),
    /** Correções solicitadas na rejeição de um alcançado: o rascunho é mantido para o reenvio. */
    correctionReason: text("correction_reason"),
    correctionBy: text("correction_by").references(() => user.id),
    correctionAt: timestamp("correction_at"),
    /** Arquivamento lógico: o resultado deixa de ser exibido, mas o histórico institucional é preservado. */
    archivedBy: text("archived_by").references(() => user.id),
    archivedAt: timestamp("archived_at"),
  },
  (table) => [
    index("project_results_project_id_idx").on(table.projectId),
    check(
      "project_results_archived_complete_chk",
      sql`(${table.archivedBy} IS NULL) = (${table.archivedAt} IS NULL)`,
    ),
    check(
      "project_results_published_complete_chk",
      // Resultados esperados são publicados direto (sem validador); alcançados só publicam validados (regra do caso de uso).
      sql`(
        (${table.publishedText} IS NULL) = (${table.publishedBy} IS NULL)
        AND (${table.publishedText} IS NULL) = (${table.publishedAt} IS NULL)
        AND (${table.validatedBy} IS NULL) = (${table.validatedAt} IS NULL)
        AND (${table.validatedBy} IS NULL OR ${table.publishedText} IS NOT NULL)
      )`,
    ),
    check(
      "project_results_correction_complete_chk",
      sql`(
        (CASE WHEN ${table.correctionReason} IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN ${table.correctionBy} IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN ${table.correctionAt} IS NULL THEN 0 ELSE 1 END)
      ) IN (0, 3)`,
    ),
    check(
      "project_results_draft_complete_chk",
      sql`(
        (CASE WHEN ${table.draftText} IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN ${table.draftBy} IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN ${table.draftAt} IS NULL THEN 0 ELSE 1 END)
      ) IN (0, 3)`,
    ),
    check(
      "project_results_has_version_chk",
      sql`${table.publishedText} IS NOT NULL OR ${table.draftText} IS NOT NULL`,
    ),
    check(
      "project_results_no_self_validation_chk",
      sql`${table.validatedBy} IS NULL OR ${table.validatedBy} <> ${table.publishedBy}`,
    ),
    check(
      "project_results_text_chk",
      sql`(${table.publishedText} IS NULL OR btrim(${table.publishedText}) <> '')
        AND (${table.draftText} IS NULL OR btrim(${table.draftText}) <> '')`,
    ),
  ],
);

/** Vínculos entre resultados alcançados e esperados: um esperado pode ter várias aferições ao longo do tempo. */
export const projectResultLinks = pgTable(
  "project_result_links",
  {
    id: text("id").primaryKey(),
    achievedId: text("achieved_id")
      .notNull()
      .references(() => projectResults.id, { onDelete: "cascade" }),
    expectedId: text("expected_id")
      .notNull()
      .references(() => projectResults.id, { onDelete: "cascade" }),
    linkedBy: text("linked_by")
      .notNull()
      .references(() => user.id),
    linkedAt: timestamp("linked_at").defaultNow().notNull(),
  },
  (table) => [
    unique("project_result_links_pair_unique").on(table.achievedId, table.expectedId),
    index("project_result_links_expected_idx").on(table.expectedId),
    check("project_result_links_distinct_chk", sql`${table.achievedId} <> ${table.expectedId}`),
  ],
);

/** Evoluções (marcos da EAP) destacadas para a apresentação institucional; não altera o marco original. */
export const projectHighlights = pgTable(
  "project_highlights",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    milestoneId: text("milestone_id")
      .notNull()
      .references(() => eapMilestones.id, { onDelete: "cascade" }),
    highlightedBy: text("highlighted_by")
      .notNull()
      .references(() => user.id),
    highlightedAt: timestamp("highlighted_at").defaultNow().notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
  },
  (table) => [
    unique("project_highlights_project_milestone_unique").on(table.projectId, table.milestoneId),
    index("project_highlights_project_id_idx").on(table.projectId),
    check("project_highlights_sort_order_chk", sql`${table.sortOrder} >= 0`),
  ],
);
