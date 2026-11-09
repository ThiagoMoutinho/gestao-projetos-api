import "dotenv/config";

import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Client } from "pg";

import { createDatabase } from "../db";

/**
 * Auxiliar do ensaio de resiliência do acesso ao banco (só em banco isolado). Abre uma transação, o servidor encerra a
 * conexão dela e o processo precisa sobreviver (modo `new`, a fábrica atual) ou não (modo `old`, o `drizzle(url)` simples
 * que existia antes — usado só para provar por que o tratador é necessário).
 */
if (!/\/gp_iso[^/]*$/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Recusado: só roda em banco isolado (nome iniciado por gp_iso).");
  process.exit(2);
}
const url = process.env.DATABASE_URL!;
const mode = process.argv[2];
const database = mode === "old" ? drizzle(url) : createDatabase(url);

try {
  await database.transaction(async (tx) => {
    const pid = Number((await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0].pid);
    const admin = new Client({ connectionString: url });
    await admin.connect();
    await admin.query("select pg_terminate_backend($1)", [pid]);
    await admin.end();
    await new Promise((resolve) => setTimeout(resolve, 800));
    await tx.execute(sql`select 1`);
  });
  console.log("TX_CONCLUIDA_INDEVIDAMENTE");
  process.exit(3);
} catch (error) {
  console.log(`TX_REJEITADA: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(0);
}
