import "dotenv/config";

import { createDatabase, createTestDatabase } from "./create-database";
import { isTestMode } from "./test-database-guard";

export { createDatabase, createTestDatabase };

/**
 * Em testes (executor do Node, NODE_ENV=test ou `force-test-mode`), o acesso só nasce com um banco de testes autorizado e
 * nunca usa o `DATABASE_URL` de desenvolvimento; sem isso o import falha antes de qualquer conexão.
 */
export const db = isTestMode(process.env) ? createTestDatabase() : createDatabase(process.env.DATABASE_URL!);
