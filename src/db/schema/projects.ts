import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth-schema";

export const projectStatusEnum = pgEnum("project_status", [
  "NAO_INICIADO",
  "EM_EXECUCAO",
  "EM_ATENCAO",
  "CRITICO",
  "EM_VALIDACAO",
  "CONCLUIDO",
  "SUSPENSO",
]);

export const projectMemberRoleEnum = pgEnum("project_member_role", [
  "DONO_PROJETO",
  "GESTOR",
  "PO",
  "DESENVOLVEDOR",
  "RESPONSAVEL_TECNICO",
  "FORNECEDOR",
  "OBSERVADOR",
]);

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    glpiTicketId: text("glpi_ticket_id"),
    /** Chamado GLPI da solicitação formal de abertura feita ao Escritório de Projetos (opcional). */
    pmoGlpiTicketId: text("pmo_glpi_ticket_id"),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id),
    status: projectStatusEnum("status").default("NAO_INICIADO").notNull(),
    /** Planejamento original, gravado na primeira definição e nunca sobrescrito por reprogramação. */
    baselineStartAt: timestamp("baseline_start_at"),
    baselineEndAt: timestamp("baseline_end_at"),
    plannedStartAt: timestamp("planned_start_at"),
    plannedEndAt: timestamp("planned_end_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("projects_owner_id_idx").on(table.ownerId),
    check(
      "projects_planned_dates_chk",
      sql`${table.plannedEndAt} IS NULL OR ${table.plannedStartAt} IS NULL OR ${table.plannedEndAt} >= ${table.plannedStartAt}`,
    ),
    check(
      "projects_baseline_dates_chk",
      sql`${table.baselineEndAt} IS NULL OR ${table.baselineStartAt} IS NULL OR ${table.baselineEndAt} >= ${table.baselineStartAt}`,
    ),
  ],
);

/**
 * Catálogo único do instituto de funções de participante que não são papéis de acesso (ex.: Stakeholder). A função é só um
 * rótulo: quem a recebe tem o acesso de Observador (leitura). Criada por ADMIN ou PMO; desativar não apaga o histórico.
 */
export const projectMemberFunctions = pgTable(
  "project_member_functions",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** Nome sem acento, em minúsculas e sem espaços repetidos: impede duplicatas ("Stakeholder" = "stakeholder "). */
    nameKey: text("name_key").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("project_member_functions_name_key_uq").on(table.nameKey),
    check("project_member_functions_name_chk", sql`char_length(btrim(${table.name})) BETWEEN 2 AND 60`),
  ],
);

export const projectMembers = pgTable(
  "project_members",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    role: projectMemberRoleEnum("role").notNull(),
    /** Função do catálogo (rótulo). Só existe junto do acesso de Observador; nula nos papéis de acesso comuns. */
    functionId: text("function_id").references(() => projectMemberFunctions.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("project_members_project_user_role_unique").on(
      table.projectId,
      table.userId,
      table.role,
    ),
    index("project_members_project_id_idx").on(table.projectId),
    index("project_members_user_id_idx").on(table.userId),
    index("project_members_function_id_idx").on(table.functionId),
    check("project_members_function_role_chk", sql`${table.functionId} IS NULL OR ${table.role} = 'OBSERVADOR'`),
  ],
);

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(user, {
    fields: [projects.ownerId],
    references: [user.id],
  }),
  members: many(projectMembers),
}));

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, {
    fields: [projectMembers.projectId],
    references: [projects.id],
  }),
  user: one(user, {
    fields: [projectMembers.userId],
    references: [user.id],
  }),
}));
