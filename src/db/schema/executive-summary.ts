import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth-schema";
import { projects } from "./projects";

/**
 * Validações do Resumo Executivo pelo PMO: cada linha é um retrato (snapshot) dos indicadores no momento em que o PMO
 * validou, com o ciclo semanal (quinta a quarta, fuso de Belém) e o responsável. O histórico é imutável: um gatilho do
 * banco impede UPDATE, DELETE e TRUNCATE (a manutenção excepcional exige liberar a sessão de forma explícita).
 * Os indicadores automáticos continuam sendo calculados na hora da consulta; esta tabela guarda só o que foi validado.
 */
export const projectExecutiveSummaryValidations = pgTable(
  "project_executive_summary_validations",
  {
    id: text("id").primaryKey(),
    /** RESTRICT: o histórico institucional não pode ser apagado junto com o projeto. */
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    /** Quinta-feira em que o ciclo começou e quarta-feira em que termina (datas civis de Belém). */
    cycleStart: date("cycle_start", { mode: "string" }).notNull(),
    cycleEnd: date("cycle_end", { mode: "string" }).notNull(),
    /** REGULAR (uma por projeto e ciclo) ou EXTRAORDINARY (adicional, com observação obrigatória). */
    kind: text("kind").notNull(),
    /** Indicadores, síntese, próximas entregas e movimentações do momento da validação (calculados no servidor). */
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    snapshotVersion: integer("snapshot_version").default(1).notNull(),
    /** Impressão digital do conteúdo relevante do snapshot (ignora a hora de geração). */
    fingerprint: text("fingerprint").notNull(),
    /** Validação "sem alterações": os indicadores são iguais aos da validação anterior (conferido no servidor). */
    unchanged: boolean("unchanged").default(false).notNull(),
    observation: text("observation"),
    validatedBy: text("validated_by")
      .notNull()
      .references(() => user.id),
    /** Data e hora reais da validação (gravadas pelo servidor, nunca informadas pelo cliente). */
    validatedAt: timestamp("validated_at").defaultNow().notNull(),
  },
  (table) => [
    index("project_executive_summary_validations_project_idx").on(table.projectId, table.validatedAt),
    uniqueIndex("project_executive_summary_validations_regular_cycle_uq")
      .on(table.projectId, table.cycleStart)
      .where(sql`${table.kind} = 'REGULAR'`),
    check("project_executive_summary_validations_kind_chk", sql`${table.kind} IN ('REGULAR', 'EXTRAORDINARY')`),
    check("project_executive_summary_validations_cycle_chk", sql`${table.cycleEnd} = ${table.cycleStart} + 6`),
    check(
      "project_executive_summary_validations_observation_chk",
      sql`(${table.kind} = 'REGULAR' OR (${table.observation} IS NOT NULL AND btrim(${table.observation}) <> '')) AND (${table.observation} IS NULL OR char_length(${table.observation}) <= 2000)`,
    ),
  ],
);
