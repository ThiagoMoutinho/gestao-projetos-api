import "dotenv/config";

import { spawnSync } from "node:child_process";

import { sql } from "drizzle-orm";
import { Client } from "pg";

import { createDatabase } from "../db";

/**
 * Ensaio do tratamento de erros de conexão do PostgreSQL (src/db/index.ts) em BANCO ISOLADO. Recusa-se a rodar fora de um
 * banco de ensaio (nome iniciado por "gp_iso").
 *
 *   DATABASE_URL=postgresql://.../gp_iso_34 pnpm tsx src/scripts/db-resilience-rehearsal.ts
 */
if (!/\/gp_iso[^/]*$/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Recusado: este ensaio só roda em banco isolado (nome iniciado por gp_iso).");
  process.exit(2);
}
const URL = process.env.DATABASE_URL!;
const log: string[] = [];
const ok = (condition: boolean, message: string) => log.push(`${condition ? "OK    " : "FALHA "}${message}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Qualquer exceção não tratada durante o ensaio é uma falha (o processo não pode cair).
const uncaught: string[] = [];
process.on("uncaughtException", (error) => uncaught.push(String(error)));
process.on("unhandledRejection", (error) => uncaught.push(String(error)));

// Captura o que o tratador escreve no log (os erros não podem ser ocultados).
const logged: string[] = [];
const originalError = console.error;
console.error = (...args: unknown[]) => {
  logged.push(args.map(String).join(" "));
};

const admin = new Client({ connectionString: URL });
const terminate = async (where: string) => {
  const result = await admin.query(`select count(*)::int as n from (select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and ${where}) t`);
  return Number(result.rows[0].n);
};
async function failureOf(fn: () => Promise<unknown>) {
  try {
    await fn();
    return null;
  } catch (error) {
    const e = error as { message?: string; code?: string; cause?: { message?: string; code?: string } };
    return { message: `${e.message ?? ""} ${e.cause?.message ?? ""}`, code: e.code ?? e.cause?.code ?? "" };
  }
}

async function main() {
  await admin.connect();
  await admin.query("create table if not exists resilience_probe (id text primary key)");
  await admin.query("truncate resilience_probe");
  const count = async (id: string) => Number((await admin.query("select count(*)::int as n from resilience_probe where id = $1", [id])).rows[0].n);

  // ---- 1. Por que o tratador é necessário: sem ele o processo cai; com ele, a transação é rejeitada ----
  const run = (mode: "old" | "new") =>
    spawnSync("npx", ["tsx", "src/scripts/db-resilience-child.ts", mode], { env: process.env, encoding: "utf8", shell: true, timeout: 90_000 });
  const before = run("old");
  ok(before.status !== 0 && /Unhandled 'error' event|terminating connection/.test(`${before.stdout}${before.stderr}`) && !/TX_REJEITADA/.test(before.stdout), `SEM o tratador (comportamento anterior): o processo cai (saída ${before.status})`);
  const after = run("new");
  ok(after.status === 0 && /TX_REJEITADA/.test(after.stdout), `COM o tratador: a transação é rejeitada e o processo sobrevive (saída ${after.status}): ${after.stdout.trim().slice(0, 90)}`);

  // ---- 2. Conexões ociosas encerradas pelo servidor ----
  const db = createDatabase(URL, { applicationName: "resil" });
  const pool = (db as unknown as { $client: { totalCount: number; idleCount: number; options: { max?: number } } }).$client;
  await Promise.all(Array.from({ length: 8 }, () => db.execute(sql`select pg_sleep(0.3)`)));
  const killedIdle = await terminate("application_name = 'resil'");
  await sleep(300);
  ok(killedIdle >= 1, `servidor encerrou ${killedIdle} conexão(ões) ociosa(s) do pool`);
  ok(uncaught.length === 0, "o processo sobreviveu (nenhuma exceção não tratada)");
  const afterIdle = await Promise.all(Array.from({ length: 30 }, () => failureOf(() => db.execute(sql`select 1`))));
  ok(afterIdle.every((item) => item === null), "as consultas seguintes funcionam (conexões novas são abertas)");
  ok(logged.some((line) => line.includes("[db]")), `o erro não foi ocultado: registrado no log (${logged.filter((l) => l.includes("[db]")).length} linha(s))`);

  // ---- 3. Transação interrompida no meio nunca é tratada como concluída ----
  logged.length = 0;
  const midTx = await failureOf(() =>
    db.transaction(async (tx) => {
      await tx.execute(sql`insert into resilience_probe (id) values ('meio')`);
      const pid = Number((await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0].pid);
      await admin.query("select pg_terminate_backend($1)", [pid]);
      await sleep(400);
      await tx.execute(sql`insert into resilience_probe (id) values ('meio-2')`);
    }),
  );
  ok(midTx !== null && /terminat|Connection|connection/i.test(midTx.message), `queda no meio da transação: rejeitada com o erro real ("${midTx?.message.trim().slice(0, 70)}")`);
  ok((await count("meio")) === 0 && (await count("meio-2")) === 0, "nada da transação interrompida foi gravado");

  const beforeCommit = await failureOf(() =>
    db.transaction(async (tx) => {
      await tx.execute(sql`insert into resilience_probe (id) values ('antes-do-commit')`);
      const pid = Number((await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0].pid);
      await admin.query("select pg_terminate_backend($1)", [pid]);
      await sleep(400);
      // retorna sem outra consulta: o COMMIT é que encontra a conexão morta
    }),
  );
  ok(beforeCommit !== null, "queda imediatamente antes do COMMIT: a transação é rejeitada (não é dada como concluída)");
  ok((await count("antes-do-commit")) === 0, "e a linha não foi gravada");

  // ---- 4. Conexões inválidas não são reutilizadas ----
  const burst = await Promise.all(Array.from({ length: 60 }, () => failureOf(() => db.execute(sql`select pg_backend_pid()`))));
  ok(burst.every((item) => item === null), "60 consultas paralelas depois das quedas: nenhuma falhou por conexão morta (nenhuma conexão inválida reutilizada)");
  ok(pool.totalCount <= (pool.options.max ?? 10), `o pool respeita o limite (${pool.totalCount}/${pool.options.max ?? 10})`);

  // ---- 5. Comportamento normal preservado ----
  const syntax = await failureOf(() => db.execute(sql`selec 1`));
  ok(syntax?.code === "42601", `erro de SQL continua chegando a quem chamou (código ${syntax?.code})`);
  await db.execute(sql`insert into resilience_probe (id) values ('unico')`);
  const duplicate = await failureOf(() => db.transaction(async (tx) => { await tx.execute(sql`insert into resilience_probe (id) values ('outro')`); await tx.execute(sql`insert into resilience_probe (id) values ('unico')`); }));
  ok(duplicate?.code === "23505" && (await count("outro")) === 0, "violação de unicidade: erro original e transação desfeita (rollback normal)");
  await db.transaction(async (tx) => { await tx.execute(sql`insert into resilience_probe (id) values ('commit-ok')`); });
  ok((await count("commit-ok")) === 1, "transação normal continua confirmando (commit)");
  const rollback = await failureOf(() => db.transaction(async (tx) => { await tx.execute(sql`insert into resilience_probe (id) values ('desfeita')`); throw new Error("erro de negócio"); }));
  ok(/erro de negócio/.test(rollback?.message ?? "") && (await count("desfeita")) === 0, "erro de negócio dentro da transação: propagado e desfeito");
  const appName = (await db.execute(sql`show application_name`)).rows[0] as { application_name: string };
  const plain = createDatabase(URL);
  const plainName = (await plain.execute(sql`show application_name`)).rows[0] as { application_name: string };
  ok(appName.application_name === "resil" && plainName.application_name !== "resil", "application_name só é definido quando informado (padrão inalterado)");

  // ---- 6. Banco inalcançável ----
  const unreachable = createDatabase("postgresql://x:x@127.0.0.1:1/x");
  const refused = await failureOf(() => unreachable.execute(sql`select 1`));
  ok(refused !== null && /ECONNREFUSED|connect/i.test(`${refused.message}${refused.code}`), `banco inalcançável: a consulta é rejeitada com o erro real (${refused?.code || refused?.message.trim().slice(0, 40)})`);
  ok(uncaught.length === 0, "nenhuma exceção não tratada em todo o ensaio");

  await admin.query("drop table resilience_probe");
  await admin.end();
  console.error = originalError;
  console.log(log.join("\n"));
  console.log(`\nTOTAL: ${log.filter((l) => l.startsWith("OK")).length} OK, ${log.filter((l) => l.startsWith("FALHA")).length} FALHA`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error = originalError;
    console.log(log.join("\n"));
    console.error("ERRO NO ENSAIO:", error instanceof Error ? error.stack : error);
    process.exit(1);
  });
