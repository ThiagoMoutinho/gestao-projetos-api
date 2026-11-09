import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth-schema";
import { projects } from "./projects";

/**
 * Conformidade de Entrega. O sistema não guarda arquivos: registra links do SharePoint e referências de tag ou release do
 * GitLab. As rodadas de avaliação continuam em `eap_milestone_deliveries` (que ganha o vínculo com a versão lógica).
 * Textos de situação usam CHECK, como nas demais tabelas do projeto, para evitar alterar enums em evoluções futuras.
 */

/** Um modelo por natureza do projeto (SISTEMAS, INFRAESTRUTURA, PROCESSOS). */
export const deliveryChecklistTemplates = pgTable(
  "delivery_checklist_templates",
  {
    id: text("id").primaryKey(),
    nature: text("nature").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("delivery_checklist_templates_nature_uq").on(table.nature),
    check("delivery_checklist_templates_nature_chk", sql`${table.nature} IN ('SISTEMAS', 'INFRAESTRUTURA', 'PROCESSOS')`),
  ],
);

/**
 * Revisões do modelo. Revisão PUBLICADA é imutável: versões de entrega copiam os itens no momento da criação e nada que se
 * publique depois altera retroativamente o checklist já usado. No máximo um rascunho por modelo.
 */
export const deliveryChecklistTemplateRevisions = pgTable(
  "delivery_checklist_template_revisions",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => deliveryChecklistTemplates.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    status: text("status").default("RASCUNHO").notNull(),
    /** Proposta sujeita à validação da CTIN (Infraestrutura e Processos). */
    isProposal: boolean("is_proposal").default(false).notNull(),
    sourceNote: text("source_note"),
    notes: text("notes"),
    createdBy: text("created_by").references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    publishedBy: text("published_by").references(() => user.id),
    publishedAt: timestamp("published_at"),
  },
  (table) => [
    uniqueIndex("delivery_checklist_template_revisions_rev_uq").on(table.templateId, table.revision),
    uniqueIndex("delivery_checklist_template_revisions_draft_uq")
      .on(table.templateId)
      .where(sql`${table.status} = 'RASCUNHO'`),
    index("delivery_checklist_template_revisions_template_idx").on(table.templateId, table.revision),
    check("delivery_checklist_template_revisions_status_chk", sql`${table.status} IN ('RASCUNHO', 'PUBLICADA')`),
    check("delivery_checklist_template_revisions_rev_chk", sql`${table.revision} >= 1`),
    check(
      "delivery_checklist_template_revisions_published_chk",
      sql`(${table.status} = 'RASCUNHO' AND ${table.publishedAt} IS NULL) OR (${table.status} = 'PUBLICADA' AND ${table.publishedAt} IS NOT NULL)`,
    ),
  ],
);

export const deliveryChecklistTemplateItems = pgTable(
  "delivery_checklist_template_items",
  {
    id: text("id").primaryKey(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => deliveryChecklistTemplateRevisions.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    documentType: text("document_type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    required: boolean("required").default(true).notNull(),
  },
  (table) => [
    uniqueIndex("delivery_checklist_template_items_pos_uq").on(table.revisionId, table.position),
    check("delivery_checklist_template_items_pos_chk", sql`${table.position} >= 1`),
    check("delivery_checklist_template_items_title_chk", sql`char_length(btrim(${table.title})) >= 3`),
  ],
);

/** Versão lógica do produto ou solução (1.0, 1.1, 2.0). Não é a rodada de avaliação do marco. */
export const projectDeliveryVersions = pgTable(
  "project_delivery_versions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    versionLabel: text("version_label").notNull(),
    nature: text("nature").notNull(),
    /** Revisão do modelo cujos itens foram copiados para esta versão. */
    templateRevisionId: text("template_revision_id")
      .notNull()
      .references(() => deliveryChecklistTemplateRevisions.id, { onDelete: "restrict" }),
    notes: text("notes"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("project_delivery_versions_label_uq").on(table.projectId, table.versionLabel),
    index("project_delivery_versions_project_idx").on(table.projectId, table.createdAt),
    check("project_delivery_versions_nature_chk", sql`${table.nature} IN ('SISTEMAS', 'INFRAESTRUTURA', 'PROCESSOS')`),
    check("project_delivery_versions_label_chk", sql`${table.versionLabel} ~ '^[0-9]+(\\.[0-9]+){0,2}$'`),
  ],
);

/** Item do checklist da versão (cópia do item do modelo) com a evidência e a situação da validação. */
export const projectDeliveryVersionItems = pgTable(
  "project_delivery_version_items",
  {
    id: text("id").primaryKey(),
    versionId: text("version_id")
      .notNull()
      .references(() => projectDeliveryVersions.id, { onDelete: "restrict" }),
    templateItemId: text("template_item_id").references(() => deliveryChecklistTemplateItems.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    documentType: text("document_type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    required: boolean("required").default(true).notNull(),
    status: text("status").default("PENDENTE").notNull(),
    evidenceKind: text("evidence_kind"),
    /** Link do SharePoint ou referência de tag/release do GitLab. */
    evidenceRef: text("evidence_ref"),
    submittedBy: text("submitted_by").references(() => user.id),
    submittedAt: timestamp("submitted_at"),
    /** Validador designado para o item; se vazio, vale o responsável técnico designado no marco. */
    validatorId: text("validator_id").references(() => user.id),
    decidedBy: text("decided_by").references(() => user.id),
    decidedAt: timestamp("decided_at"),
    /** Justificativa da rejeição ou da dispensa (mínimo de 10 caracteres). */
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("project_delivery_version_items_pos_uq").on(table.versionId, table.position),
    index("project_delivery_version_items_version_idx").on(table.versionId, table.status),
    check(
      "project_delivery_version_items_status_chk",
      sql`${table.status} IN ('PENDENTE', 'ENVIADO', 'APROVADO', 'REJEITADO', 'DISPENSADO')`,
    ),
    check(
      "project_delivery_version_items_evidence_kind_chk",
      sql`${table.evidenceKind} IS NULL OR ${table.evidenceKind} IN ('SHAREPOINT', 'GITLAB_TAG', 'GITLAB_RELEASE', 'OUTRO')`,
    ),
    check(
      "project_delivery_version_items_evidence_chk",
      sql`(${table.evidenceRef} IS NULL AND ${table.evidenceKind} IS NULL) OR (${table.evidenceRef} IS NOT NULL AND ${table.evidenceKind} IS NOT NULL AND char_length(btrim(${table.evidenceRef})) BETWEEN 1 AND 1000)`,
    ),
    check(
      "project_delivery_version_items_decision_chk",
      sql`(
        (${table.status} = 'PENDENTE' AND ${table.evidenceRef} IS NULL AND ${table.submittedBy} IS NULL AND ${table.submittedAt} IS NULL AND ${table.decidedBy} IS NULL AND ${table.decidedAt} IS NULL)
        OR (${table.status} = 'ENVIADO' AND ${table.evidenceRef} IS NOT NULL AND ${table.submittedBy} IS NOT NULL AND ${table.submittedAt} IS NOT NULL AND ${table.decidedBy} IS NULL AND ${table.decidedAt} IS NULL)
        OR (${table.status} = 'APROVADO' AND ${table.evidenceRef} IS NOT NULL AND ${table.submittedBy} IS NOT NULL AND ${table.decidedBy} IS NOT NULL AND ${table.decidedAt} IS NOT NULL AND ${table.decidedBy} <> ${table.submittedBy})
        OR (${table.status} = 'REJEITADO' AND ${table.evidenceRef} IS NOT NULL AND ${table.submittedBy} IS NOT NULL AND ${table.decidedBy} IS NOT NULL AND ${table.decidedAt} IS NOT NULL AND char_length(btrim(${table.decisionNote})) >= 10)
        OR (${table.status} = 'DISPENSADO' AND ${table.decidedBy} IS NOT NULL AND ${table.decidedAt} IS NOT NULL AND char_length(btrim(${table.decisionNote})) >= 10)
      )`,
    ),
  ],
);

/** Histórico de envio e validação de cada item: só recebe registros novos. */
export const projectDeliveryItemEvents = pgTable(
  "project_delivery_item_events",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => projectDeliveryVersionItems.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    evidenceKind: text("evidence_kind"),
    evidenceRef: text("evidence_ref"),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("project_delivery_item_events_item_idx").on(table.itemId, table.createdAt),
    check("project_delivery_item_events_action_chk", sql`${table.action} IN ('ENVIO', 'APROVACAO', 'REJEICAO', 'DISPENSA')`),
  ],
);
