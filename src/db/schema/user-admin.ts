import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth-schema";

/**
 * Histórico de ativação e desativação de usuários (só inserção: o banco bloqueia alteração e exclusão).
 * A justificativa é obrigatória; sessions_revoked conta as sessões encerradas na desativação.
 */
export const userActivationChanges = pgTable(
  "user_activation_changes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    sessionsRevoked: integer("sessions_revoked").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    check("user_activation_changes_action_chk", sql`${table.action} IN ('ACTIVATE', 'DEACTIVATE')`),
    check("user_activation_changes_reason_chk", sql`length(btrim(${table.reason})) > 0`),
    index("user_activation_changes_user_idx").on(table.userId, table.createdAt),
  ],
);
