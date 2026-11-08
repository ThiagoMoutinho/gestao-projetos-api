import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { GuardedTestPool } from "./guarded-test-pool";
import * as schema from "./schema";
import { assessTestDatabase, TestDatabaseRefused } from "./test-database-guard";


/**
 * Cria o acesso ao banco com tratadores de erro nas conexões. Sem eles, uma conexão encerrada pelo servidor (reinício do
 * Postgres, queda de rede, administrador) enquanto está emprestada e sem consulta em andamento — por exemplo, no meio de
 * uma transação — gera um evento `error` sem ouvinte, que derruba o processo inteiro. Com os tratadores o erro é só
 * registrado no log e a próxima operação falha normalmente (e pode ser tratada por quem a chamou).
 */
function withErrorHandlers(pool: Pool) {
  pool.on("error", (error) => {
    console.error("[db] erro em conexão ociosa do pool:", error.message);
  });
  pool.on("connect", (client) => {
    client.on("error", (error) => {
      console.error("[db] erro de conexão:", error.message);
    });
  });
  return drizzle(pool, { schema });
}

export function createDatabase(url: string, options: { applicationName?: string } = {}) {
  return withErrorHandlers(
    new Pool({ connectionString: url, ...(options.applicationName ? { application_name: options.applicationName } : {}) }),
  );
}

/**
 * Acesso ao banco para testes. Só nasce com um banco de testes autorizado (`TEST_DATABASE_URL`, nome `gp_test*` e
 * `TEST_DATABASE_CONFIRM` com o nome exato); caso contrário lança `TestDatabaseRefused` antes de qualquer conexão. O
 * `DATABASE_URL` de desenvolvimento nunca é usado como origem. O pool ainda confere o nome do banco realmente conectado
 * antes da primeira operação (ver `guarded-test-pool.ts`).
 */
export function createTestDatabase(env: NodeJS.ProcessEnv = process.env) {
  const assessment = assessTestDatabase(env);
  if (!assessment.ok) {
    throw new TestDatabaseRefused(assessment.reason);
  }
  if (env === process.env) {
    // Nada, em nenhum caminho do processo de teste, deve enxergar a URL do desenvolvimento.
    env.DATABASE_URL = assessment.url;
  }
  return withErrorHandlers(new GuardedTestPool(assessment.url, assessment.databaseName));
}
