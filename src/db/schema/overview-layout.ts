import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth-schema";

/**
 * Layout pessoal da Visão Geral do projeto: ordem e largura de cada widget. É preferência de interface do próprio
 * usuário (um registro por usuário, vale para todos os projetos) e não altera nenhum dado do projeto.
 */
export const userOverviewLayouts = pgTable("user_overview_layouts", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** Lista ordenada: [{ id, wide, height? }]. Ids e alturas aceitos são validados na API; sem height vale "auto". */
  widgets: jsonb("widgets").$type<{ id: string; wide: boolean; height?: string }[]>().notNull(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
