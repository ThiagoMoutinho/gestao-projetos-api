import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth-schema";

/**
 * Calendário institucional de dias úteis (feriados e dias não úteis), mantido pelo ADMIN. Cada ano só vale para os
 * cálculos que dependem de dia útil depois de validado (VALIDATED); qualquer alteração nos dias de um ano validado o
 * devolve a DRAFT (gatilho do banco, independente da API).
 */
export const businessCalendarYears = pgTable(
  "business_calendar_years",
  {
    year: integer("year").primaryKey(),
    /** DRAFT (em preparação) ou VALIDATED (conferido pelo ADMIN). */
    status: text("status").default("DRAFT").notNull(),
    nationalChecked: boolean("national_checked").default(false).notNull(),
    stateChecked: boolean("state_checked").default(false).notNull(),
    municipalChecked: boolean("municipal_checked").default(false).notNull(),
    /** Fonte consultada (decretos, calendário oficial) informada na validação. */
    sourceNote: text("source_note"),
    validatedBy: text("validated_by").references(() => user.id),
    validatedAt: timestamp("validated_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    check("business_calendar_years_status_chk", sql`${table.status} IN ('DRAFT', 'VALIDATED')`),
    check(
      "business_calendar_years_validated_chk",
      sql`${table.status} = 'DRAFT' OR (${table.validatedBy} IS NOT NULL AND ${table.validatedAt} IS NOT NULL AND ${table.nationalChecked} AND ${table.stateChecked} AND ${table.municipalChecked})`,
    ),
    check("business_calendar_years_year_chk", sql`${table.year} BETWEEN 2000 AND 2200`),
  ],
);

/**
 * Dia do calendário. É dia NÃO ÚTIL o que tem uma linha observada (observed) de FERIADO, PONTO_FACULTATIVO ou
 * NAO_UTIL_INSTITUCIONAL. Ponto facultativo nasce não observado (não vira dia não útil sozinho). EXPEDIENTE_EXCECAO
 * observado torna o dia ÚTIL mesmo que seja fim de semana ou feriado (exceção de expediente institucional).
 */
export const businessCalendarDays = pgTable(
  "business_calendar_days",
  {
    id: text("id").primaryKey(),
    /** Ano do dia: FK explícita para o ano do calendário e conferido com a data (business_calendar_days_year_chk). */
    year: integer("year")
      .notNull()
      .references(() => businessCalendarYears.year, { onDelete: "restrict" }),
    day: date("day", { mode: "string" }).notNull(),
    scope: text("scope").notNull(),
    kind: text("kind").notNull(),
    observed: boolean("observed").notNull(),
    description: text("description").notNull(),
    /** Decreto, lei ou ato institucional que fundamenta o dia (obrigatório fora do escopo nacional). */
    legalBasis: text("legal_basis"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedBy: text("updated_by").references(() => user.id),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("business_calendar_days_day_scope_kind_uq").on(table.day, table.scope, table.kind),
    index("business_calendar_days_year_idx").on(table.year, table.day),
    check("business_calendar_days_scope_chk", sql`${table.scope} IN ('NACIONAL', 'ESTADUAL_PA', 'MUNICIPAL_BELEM', 'INSTITUCIONAL')`),
    check(
      "business_calendar_days_kind_chk",
      sql`${table.kind} IN ('FERIADO', 'PONTO_FACULTATIVO', 'NAO_UTIL_INSTITUCIONAL', 'EXPEDIENTE_EXCECAO')`,
    ),
    check(
      "business_calendar_days_institutional_chk",
      sql`${table.kind} NOT IN ('NAO_UTIL_INSTITUCIONAL', 'EXPEDIENTE_EXCECAO') OR ${table.scope} = 'INSTITUCIONAL'`,
    ),
    check("business_calendar_days_year_chk", sql`${table.year} = EXTRACT(YEAR FROM ${table.day})::int`),
    check(
      "business_calendar_days_legal_basis_chk",
      sql`${table.scope} = 'NACIONAL' OR (${table.legalBasis} IS NOT NULL AND btrim(${table.legalBasis}) <> '')`,
    ),
  ],
);

/**
 * Histórico das alterações do calendário (só inserção: gatilho bloqueia UPDATE, DELETE e TRUNCATE). Não tem FK para o
 * dia, para que a exclusão de um dia não apague o seu registro; `before` e `after` guardam o conteúdo.
 */
export const businessCalendarChanges = pgTable(
  "business_calendar_changes",
  {
    id: text("id").primaryKey(),
    year: integer("year").notNull(),
    dayId: text("day_id"),
    action: text("action").notNull(),
    before: jsonb("before").$type<Record<string, unknown> | null>(),
    after: jsonb("after").$type<Record<string, unknown> | null>(),
    note: text("note"),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    at: timestamp("at").defaultNow().notNull(),
  },
  (table) => [
    index("business_calendar_changes_year_idx").on(table.year, table.at),
    check(
      "business_calendar_changes_action_chk",
      sql`${table.action} IN ('DAY_CREATE', 'DAY_UPDATE', 'DAY_DELETE', 'YEAR_VALIDATE', 'YEAR_REVERT_TO_DRAFT')`,
    ),
  ],
);
