import "dotenv/config";

import { spawn, execSync } from "node:child_process";

import { sql } from "drizzle-orm";

import { buildApp } from "../app";
import { createDatabase } from "../db";
import type { Database } from "../db/types";
import { runNotificationGenerator } from "../modules/notifications/notification-generator";
import { DEFAULT_SCHEDULER_CONFIG, NotificationScheduler, type SchedulerConfig, type SchedulerDeps } from "../modules/notifications/notification-scheduler";
import { makeNotificationDeps } from "../modules/notifications/notifications.routes";
import { makeNotificationUseCases } from "../modules/notifications/notifications.use-cases";
import { deriveSchedulerHealth } from "../modules/notifications/scheduler-health";
import { DrizzleSchedulerRepository } from "../modules/notifications/scheduler.repository";

/**
 * Ensaio do agendador (migration 0030 + módulo) em BANCO ISOLADO — nunca no desenvolvimento. Recusa-se a rodar se o
 * banco não for de ensaio (nome iniciado por "gp_iso"). Usa conexões distintas por instância para exercitar a
 * concorrência de verdade no Postgres.
 *
 *   DATABASE_URL=postgresql://.../gp_iso_34 pnpm tsx src/scripts/scheduler-db-rehearsal.ts
 */
if (!/\/gp_iso[^/]*$/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Recusado: este ensaio só roda em banco isolado (nome iniciado por gp_iso).");
  process.exit(2);
}
const URL = process.env.DATABASE_URL!;

const log: string[] = [];
const ok = (condition: boolean, message: string) => log.push(`${condition ? "OK    " : "FALHA "}${message}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const at = (value: string) => new Date(value);
const T = at("2026-11-26T10:00:00-03:00"); // quinta, dia útil, dentro da janela de entrega

const pools: Database[] = [];
const newDb = (applicationName?: string): Database => {
  const database = createDatabase(URL, { applicationName });
  pools.push(database);
  return database;
};
const admin = newDb();
const q = async (query: string) => (await admin.execute(sql.raw(query))).rows as Array<Record<string, unknown>>;
const count = async (table: string, where = "true") => Number((await q(`select count(*)::int as n from ${table} where ${where}`))[0].n);
async function failure(query: string) {
  try {
    await admin.execute(sql.raw(query));
    return null;
  } catch (error) {
    const e = error as { message?: string; cause?: { message?: string } };
    return `${e.message ?? ""} ${e.cause?.message ?? ""}`;
  }
}

const CONFIG: SchedulerConfig = { ...DEFAULT_SCHEDULER_CONFIG, startupJitterMs: 0 };
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
let clock = T;

function instance(id: string, mode: "WORKER" | "PLUGIN", extra: Partial<SchedulerDeps> = {}, config: SchedulerConfig = CONFIG) {
  const database = newDb(id);
  const deps = makeNotificationDeps(database);
  return new NotificationScheduler({
    mode,
    instanceId: id,
    config,
    scheduler: new DrizzleSchedulerRepository(database),
    notifications: deps.notifications,
    generator: deps,
    clock: () => clock,
    logger: silent,
    ...extra,
  });
}

let projectSeq = 0;
/** Projeto novo com início auditado: em `T` gera um aviso de atraso e um escalonamento (trabalho para o agendador). */
async function freshWork() {
  const id = `iso34-p${++projectSeq}`;
  await q(`insert into projects (id, name, owner_id, status) values ('${id}', 'Projeto ${id}', 'iso-admin', 'EM_EXECUCAO')`);
  await q(`insert into eap_audit_logs (id, project_id, entity_type, entity_id, action, summary, payload, actor_id, created_at)
           values ('ev-${id}', '${id}', 'PROJECT', '${id}', 'STATUS_CHANGE', 'início', '{"automatic": false, "from": "NAO_INICIADO", "to": "EM_EXECUCAO"}', 'iso-admin', '2026-09-01 13:00:00')`);
  return id;
}
const notifsOf = (id: string) => count("executive_followup_notifications", `project_id = '${id}'`);
const dupes = async () => Number((await q(`select count(*)::int as n from (select dedupe_key from executive_followup_notifications group by 1 having count(*) > 1) d`))[0].n);
const expireLease = () => q(`update notification_scheduler_state set claimed_until = (now() at time zone 'utc') - interval '1 second'`);
const resetDue = () => q(`update notification_scheduler_state set next_due_at = null`);

async function main() {
  // ---- Dados de ensaio ----
  for (const [id, role] of [["iso-admin", "ADMIN"], ["iso-admin2", "ADMIN"], ["iso-pmo", "PMO"], ["iso-coord", "COORDENADOR"]] as const) {
    await q(`insert into "user" (id, name, email, role) values ('${id}', '${id}', '${id}@x.test', '${role}')`);
  }
  await q(`insert into business_calendar_years (year, status, national_checked, state_checked, municipal_checked, validated_by, validated_at, source_note)
           values (2026, 'VALIDATED', true, true, true, 'iso-admin', now(), 'ensaio')`);
  const baseline = {
    users: await count(`"user"`),
    projects: await count("projects"),
    audit: await count("eap_audit_logs"),
    runs: await count("notification_runs"),
    migrations: await count("drizzle.__drizzle_migrations"),
  };

  // ---- 1. Migration 0030 ----
  ok(baseline.migrations === 31, "31 migrations aplicadas (0030 incluída)");
  ok((await count("notification_scheduler_state", "id = 'GLOBAL' and claim_token is null and next_due_at is null and consecutive_failures = 0")) === 1, "estado do agendador criado vazio (uma linha)");
  ok((await count("notification_scheduler_instances")) === 0, "nenhuma instância registrada");
  ok((await failure(`insert into notification_runs (id, mode, origin, status, as_of) values ('o-ok', 'DRY_RUN', 'SCHEDULER', 'COMPLETED', now())`)) === null, "origem SCHEDULER aceita em notification_runs");
  ok(/violates check/.test((await failure(`insert into notification_runs (id, mode, origin, status, as_of) values ('o-bad', 'DRY_RUN', 'OUTRA', 'COMPLETED', now())`)) ?? ""), "origem inválida continua recusada");
  ok(/desativadas/.test((await failure(`insert into notification_issues (id, kind, dedupe_key, details) values ('i-sf', 'SCHEDULER_FAILURE', 'k', '{}')`)) ?? ""), "SCHEDULER_FAILURE: ocorrência operacional continua barrada pelo gatilho com a ativação desligada");
  const kindCheck = String((await q(`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'notification_issues_kind_chk'`))[0].d);
  ok(kindCheck.includes("SCHEDULER_FAILURE") && !kindCheck.includes("OUTRO") && kindCheck.includes("CALENDAR_NOT_VALIDATED"), "constraint de tipo de ocorrência ampliada (e os tipos anteriores preservados)");
  const originCheck = String((await q(`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'notification_runs_origin_chk'`))[0].d);
  ok(originCheck.includes("SCHEDULER") && originCheck.includes("'CLI'") && originCheck.includes("'API'"), "constraint de origem ampliada (CLI e API preservadas)");
  ok(/Registro histórico/.test((await failure(`delete from notification_scheduler_state`)) ?? ""), "estado do agendador não pode ser excluído");
  ok(/Registro histórico/.test((await failure(`truncate notification_scheduler_state`)) ?? ""), "estado do agendador não pode ser truncado");
  ok((await count("notification_runs", "id = 'o-ok'")) === 1, "histórico de execuções preservado (a linha técnica de teste permanece)");

  // ---- 2. Telemetria com as notificações desativadas ----
  const runsMark = await count("notification_runs");
  const off = instance("tele-1", "WORKER");
  await off.register();
  const offResult = await off.tick({ force: true });
  ok(offResult.status === "IDLE_ACTIVATION_OFF", "ativação desligada: o tick só registra telemetria");
  ok((await count("executive_followup_notifications")) + (await count("notification_deliveries")) + (await count("notification_issues")) === 0, "nenhum aviso, entrega ou ocorrência operacional");
  ok((await count("notification_runs")) === runsMark, "nenhuma linha de execução criada");
  const snapOff = await new DrizzleSchedulerRepository(admin).readSnapshot();
  const healthOff = deriveSchedulerHealth(snapOff);
  ok(healthOff.technicalState === "FUNCIONANDO" && healthOff.operationalState === "DESATIVADAS", `saúde: ${healthOff.technicalState} / operação ${healthOff.operationalState}`);
  ok(snapOff.state?.lastStatus === "IDLE_ACTIVATION_OFF" && (snapOff.state?.lastSuccessAgeSeconds ?? 99) < 30, "último ciclo bem-sucedido registrado mesmo sem trabalho");
  ok((await off.tick()).status === "NOT_DUE", "respeita o ritmo: segundo tick sem força = NOT_DUE");
  await off.stop("GRACEFUL");
  const healthStopped = deriveSchedulerHealth(await new DrizzleSchedulerRepository(admin).readSnapshot());
  ok(healthStopped.technicalState === "DESLIGADO", `desligamento limpo com notificações desativadas = ${healthStopped.technicalState}`);

  // ---- 3. Ativação (via casos de uso, como o ADMIN faria) e quatro instâncias concorrentes ----
  const useCases = makeNotificationUseCases(makeNotificationDeps(admin));
  const adminUser = { id: "iso-admin", name: "Admin", email: "a@x.test", role: "ADMIN" as const };
  await useCases.createRule(adminUser, { kind: "PREVENTIVE", source: "ROLE", role: "PMO", visibility: "TO", justification: "Aviso ao PMO." });
  await useCases.createRule(adminUser, { kind: "OVERDUE", source: "ROLE", role: "PMO", visibility: "TO", justification: "Atraso ao PMO." });
  await useCases.createRule(adminUser, { kind: "ESCALATION", source: "USER", userId: "iso-coord", visibility: "TO", justification: "Coordenador da CTIN." });
  await useCases.createRule(adminUser, { kind: "ESCALATION", source: "ROLE", role: "PMO", visibility: "CC", justification: "Cópia ao PMO." });
  await useCases.activate(adminUser, { cutoff: "2026-11-05", justification: "Ensaio isolado.", confirm: "ATIVAR" }, at("2026-11-01T10:00:00-03:00"));
  await resetDue();

  const p1 = await freshWork();
  const four = [instance("c1", "WORKER"), instance("c2", "PLUGIN"), instance("c3", "WORKER"), instance("c4", "PLUGIN")];
  const results = await Promise.all(four.map((item) => item.tick({ force: true })));
  const statuses = results.map((item) => item.status).sort();
  ok(statuses.filter((s) => s === "RAN").length === 1, `4 instâncias concorrentes: ${JSON.stringify(statuses)} — exatamente uma executou`);
  ok((await notifsOf(p1)) === 2 && (await dupes()) === 0, "e o projeto recebeu exatamente os 2 avisos, sem duplicidade");
  ok((await count("notification_runs", "origin = 'SCHEDULER' and mode = 'ACTIVE' and status = 'COMPLETED'")) === 1, "uma única linha técnica de execução real");
  const recipientsOk = await count("notification_deliveries", `notification_id in (select id from executive_followup_notifications where project_id = '${p1}')`);
  ok(recipientsOk >= 3, `entregas gravadas (${recipientsOk}) — PMO e coordenador`);
  const runsBeforeIdle = await count("notification_runs");
  const idle = await instance("c5", "WORKER").tick({ force: true });
  ok(idle.status === "IDLE_NOTHING_TO_DO" && (await count("notification_runs")) === runsBeforeIdle, "sem trabalho: tick ocioso e nenhuma linha de execução nova");

  // ---- 4. Plugin e processo dedicado simultâneos ----
  const worker = instance("worker-1", "WORKER");
  const plugin = instance("plugin-1", "PLUGIN");
  await worker.register();
  await plugin.register();
  await resetDue();
  const p2 = await freshWork();
  ok((await plugin.tick()).status === "SKIPPED_STANDBY", "plugin aguarda enquanto há processo dedicado saudável");
  ok((await notifsOf(p2)) === 0, "e nada é entregue por ele");
  await resetDue();
  const both = await Promise.all([worker.tick({ force: true }), plugin.tick({ force: true })]);
  ok(both.filter((item) => item.status === "RAN").length === 1 && (await notifsOf(p2)) === 2 && (await dupes()) === 0, `plugin e dedicado simultâneos (sem a preferência): ${both.map((b) => b.status).join(" + ")}, 2 avisos, sem duplicidade`);

  // ---- 5. Execução maior que a reserva inicial ----
  await resetDue();
  const p3 = await freshWork();
  const longConfig: SchedulerConfig = { ...CONFIG, leaseSeconds: 3, renewSeconds: 1 };
  const slow = instance("slow", "WORKER", {
    run: async (deps, options) => {
      if (options.mode === "ACTIVE") await sleep(8000); // 8 s com reserva de 3 s: só a renovação segura a vez
      return runNotificationGenerator(deps, options);
    },
  }, longConfig);
  const slowTick = slow.tick({ force: true });
  await sleep(5000);
  const rival = await instance("rival", "WORKER", {}, longConfig).tick({ force: true });
  const claimedDuring = (await q(`select claimed_by from notification_scheduler_state`))[0].claimed_by;
  ok(rival.status === "NOT_DUE" && claimedDuring === "slow", `aos 5 s (reserva de 3 s) a reserva continua com "${claimedDuring}"; rival: ${rival.status}`);
  const slowResult = await slowTick;
  ok(slowResult.status === "RAN" && (await notifsOf(p3)) === 2 && (await dupes()) === 0, "execução longa termina sem duplicar nada");
  ok((await count("notification_runs", "status = 'RUNNING'")) === 0, "nenhuma execução ficou como abandonada");

  // ---- 6. Perda de reserva e processo zumbi ----
  await resetDue();
  const p4 = await freshWork();
  let zombieReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => (zombieReady = resolve));
  let release: () => void = () => undefined;
  const paused = new Promise<void>((resolve) => (release = resolve));
  const zombie = instance("zombie", "WORKER", {
    config: { ...CONFIG, renewSeconds: 3600 },
    run: async (deps, options) => {
      if (options.mode !== "ACTIVE") return runNotificationGenerator(deps, options);
      let first = true;
      const stale = new Proxy(deps.notifications, {
        get: (target, prop, receiver) =>
          prop === "findNotificationByKey"
            ? async (key: string) => {
                if (first) {
                  first = false;
                  zombieReady();
                  await paused;
                  return null; // leitura velha: "ainda não existe"
                }
                return target.findNotificationByKey(key);
              }
            : Reflect.get(target, prop, receiver),
      });
      return runNotificationGenerator({ ...deps, notifications: stale }, options);
    },
  });
  const zombieTick = zombie.tick({ force: true });
  await ready;
  // A conexão do zumbi caiu no servidor (partição de rede): reserva vencida e trava consultiva liberada.
  await q(`select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and state = 'idle in transaction'`);
  await expireLease();
  const taker = await instance("taker", "WORKER").tick({ force: true });
  const createdByTaker = await notifsOf(p4);
  release();
  const zombieOutcome = await zombieTick.catch((error) => ({ status: "ERRO", error: String(error) }));
  ok(taker.status === "RAN" && createdByTaker === 2, "outra instância assumiu e entregou os 2 avisos");
  ok((await notifsOf(p4)) === 2 && (await dupes()) === 0, "o zumbi, ao acordar com leitura velha, não gravou nada (barreira do token na transação)");
  ok(["ABORTED_LEASE_LOST", "FAILED", "ERRO"].includes(zombieOutcome.status), `resultado do zumbi: ${zombieOutcome.status}`);

  // Perda de reserva com cancelamento cooperativo (renovação ativa, reserva vencida no meio do tick)
  await resetDue();
  const p5 = await freshWork();
  const victim = instance("victim", "WORKER", {
    run: async (deps, options) => {
      if (options.mode === "ACTIVE") {
        await expireLease();
        await sleep(2500); // a renovação (1 s) falha e cancela o tick
      }
      return runNotificationGenerator(deps, options);
    },
  }, { ...CONFIG, leaseSeconds: 3, renewSeconds: 1 });
  const victimResult = await victim.tick({ force: true });
  ok(victimResult.status === "ABORTED_LEASE_LOST" && (await notifsOf(p5)) === 0, "reserva perdida no meio do tick: cancelado e nada gravado depois");
  ok((await count("notification_runs", "status = 'FAILED' and error like 'ABORTADA%'")) >= 1, "a execução cancelada ficou registrada (FAILED / ABORTADA), sem apagar histórico");

  // ---- 7. Encerramento inesperado do processo (kill -9) ----
  await resetDue();
  await expireLease();
  const p6 = await freshWork();
  const runsBefore = await count("notification_runs");
  const child = spawn("npx", ["tsx", "src/scripts/scheduler-crash-child.ts"], { env: { ...process.env, REHEARSAL_NOW: T.toISOString() }, shell: true });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("processo filho não chegou à execução")), 60_000);
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("READY")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", () => reject(new Error("processo filho terminou antes da hora")));
  });
  const running = await count("notification_runs", "status = 'RUNNING' and mode = 'ACTIVE'");
  const lockedWhileAlive = await new DrizzleSchedulerRepository(admin).claim({ instanceId: "probe", token: "t", leaseSeconds: 5, force: true });
  ok(running === 1 && lockedWhileAlive === false, "processo vivo no meio da execução: linha RUNNING legítima e reserva dele intacta");
  const liveManual = await runNotificationGenerator(makeNotificationDeps(admin), { mode: "ACTIVE", origin: "CLI", actorId: null, now: T, recordSkipped: false });
  ok(liveManual.status === "SKIPPED_LOCKED" && (await count("notification_runs", "status = 'RUNNING' and mode = 'ACTIVE'")) === 1, "outra execução enquanto ele vive não o reconcilia (trava ocupada)");
  execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "ignore" });
  let freed = false;
  for (let attempt = 0; attempt < 40 && !freed; attempt += 1) {
    freed = (await makeNotificationDeps(admin).notifications.withGlobalLock(async () => true)).acquired;
    if (!freed) await sleep(500);
  }
  ok(freed, "processo morto: a trava consultiva foi liberada pelo servidor (conexão encerrada)");
  const orphaned = await count("notification_runs", "status = 'RUNNING' and mode = 'ACTIVE'");
  ok(orphaned === 1, "a execução órfã continua RUNNING até alguém assumir (nada foi apagado)");
  ok((await notifsOf(p6)) === 0, "o processo morto não entregou nada");
  await expireLease();
  const recoverer = await instance("recoverer", "WORKER").tick({ force: true });
  ok(recoverer.status === "RAN" && (await notifsOf(p6)) === 2 && (await dupes()) === 0, "recuperação: nova instância entregou os 2 avisos, uma vez só");
  const orphanRow = (await q(`select status, error from notification_runs where mode = 'ACTIVE' and origin = 'SCHEDULER' and error like 'INTERROMPIDA%'`))[0];
  ok(orphanRow?.status === "FAILED", "a execução órfã foi reconciliada: FAILED / INTERROMPIDA");
  ok((await count("notification_runs")) >= runsBefore + 2, "o histórico de execuções só cresceu (nada apagado)");
  ok((await count("notification_runs", "status = 'RUNNING' and mode = 'ACTIVE'")) === 0, "nenhuma execução real permanece em RUNNING");

  // ---- 8. Indisponibilidade temporária do banco ----
  await resetDue();
  const p7 = await freshWork();
  const flakyDb = newDb();
  const flaky = instance("flaky", "WORKER", {
    run: async (deps, options) => {
      if (options.mode === "ACTIVE") {
        // O servidor derruba todas as conexões dessa instância no meio da execução.
        await q(`select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and application_name = 'flaky'`);
        await sleep(300);
      }
      return runNotificationGenerator(deps, options);
    },
  });
  void flakyDb;
  const flakyResult = await flaky.tick({ force: true }).catch((error) => ({ status: "ERRO", error: String(error) }));
  ok(["FAILED", "RAN", "ERRO", "ABORTED_LEASE_LOST"].includes(flakyResult.status), `queda de conexões no meio da execução: ${flakyResult.status} (sem derrubar o processo)`);
  ok((await dupes()) === 0, "sem duplicidade após a queda");
  // Banco inalcançável: o tick rejeita (o laço registra no log e recua), sem tocar em nada.
  const unreachable = new NotificationScheduler({
    mode: "WORKER",
    instanceId: "unreachable",
    config: CONFIG,
    scheduler: new DrizzleSchedulerRepository(createDatabase("postgresql://x:x@127.0.0.1:1/x")),
    notifications: makeNotificationDeps(admin).notifications,
    generator: makeNotificationDeps(admin),
    clock: () => clock,
    logger: silent,
  });
  const unreachableResult = await unreachable.tick({ force: true }).then(() => "sem erro", () => "rejeitado");
  ok(unreachableResult === "rejeitado", "banco inalcançável: o tick rejeita e o erro fica para o log/laço");
  await resetDue();
  await expireLease();
  const afterOutage = await instance("after-outage", "WORKER").tick({ force: true });
  ok((["RAN", "IDLE_NOTHING_TO_DO"].includes(afterOutage.status)) && (await notifsOf(p7)) === 2 && (await dupes()) === 0, `após a normalização: ${afterOutage.status}; projeto com exatamente 2 avisos`);

  // ---- 9. Falhas consecutivas e ocorrência SCHEDULER_FAILURE ----
  await resetDue();
  await expireLease();
  const brokenRun = instance("broken", "WORKER", { run: async () => { throw new Error("falha simulada"); } });
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await resetDue();
    const result = await brokenRun.tick({ force: true });
    if (result.status !== "FAILED") ok(false, `tentativa ${attempt}: esperado FAILED, veio ${result.status}`);
  }
  ok((await count("notification_issues", "dedupe_key = 'SCHEDULER_FAILURE:scheduler' and resolved_at is null")) === 1, "após 3+ falhas seguidas: uma única ocorrência SCHEDULER_FAILURE (idempotente)");
  ok(Number((await q(`select occurrences from notification_issues where dedupe_key = 'SCHEDULER_FAILURE:scheduler'`))[0].occurrences) >= 2, "e ela acumula as ocorrências sem duplicar");
  const healthFail = deriveSchedulerHealth(await new DrizzleSchedulerRepository(admin).readSnapshot());
  ok(healthFail.technicalState === "EM_FALHA", `saúde durante as falhas: ${healthFail.technicalState} (${healthFail.reasons.join(",")})`);
  // A conciliação comum não resolve a ocorrência do agendador.
  await resetDue();
  await runNotificationGenerator(makeNotificationDeps(admin), { mode: "ACTIVE", origin: "CLI", actorId: null, now: T });
  ok((await count("notification_issues", "dedupe_key = 'SCHEDULER_FAILURE:scheduler' and resolved_at is null")) === 1, "uma execução comum do gerador não resolve a ocorrência do agendador");
  const healthy = instance("healthy", "WORKER");
  await resetDue();
  await healthy.tick({ force: true });
  ok((await count("notification_issues", "dedupe_key = 'SCHEDULER_FAILURE:scheduler' and resolved_at is null")) === 1, "um primeiro sucesso ainda não é recuperação efetiva");
  await resetDue();
  await healthy.tick({ force: true });
  ok((await count("notification_issues", "dedupe_key = 'SCHEDULER_FAILURE:scheduler' and resolution = 'AUTO'")) === 1, "após 2 sucessos seguidos a ocorrência foi resolvida (AUTO)");

  // ---- 10. Dia útil e horário de entrega ----
  await resetDue();
  const p8 = await freshWork();
  const windowed = instance("windowed", "WORKER");
  const probe = async (when: string) => {
    clock = at(when);
    await resetDue();
    return windowed.tick({ force: true });
  };
  for (const outside of ["2026-11-26T08:59:59-03:00", "2026-11-26T18:00:00-03:00", "2026-11-28T10:00:00-03:00", "2026-11-29T10:00:00-03:00"]) {
    const result = await probe(outside);
    ok(result.status === "TECHNICAL_ONLY" && (await notifsOf(p8)) === 0, `${outside}: só processamento técnico (${result.status}), nada entregue`);
  }
  const inside = await probe("2026-11-26T09:00:00-03:00");
  ok(inside.status === "RAN" && (await notifsOf(p8)) === 2, "09:00:00 em dia útil: entrega os 2 avisos adiados");
  await q(`update business_calendar_years set status = 'DRAFT', validated_by = null, validated_at = null, national_checked = false, state_checked = false, municipal_checked = false where year = 2026`);
  const p9 = await freshWork();
  const noCalendar = await probe("2026-11-26T10:00:00-03:00");
  ok(noCalendar.status === "RAN" && (await notifsOf(p9)) === 0, "calendário não validado: nada é entregue; a ocorrência é aberta");
  ok((await count("notification_issues", "dedupe_key = 'CALENDAR_NOT_VALIDATED:2026' and resolved_at is null")) === 1, "ocorrência de calendário registrada para o ADMIN");
  await q(`update business_calendar_years set status = 'VALIDATED', validated_by = 'iso-admin', validated_at = now(), national_checked = true, state_checked = true, municipal_checked = true where year = 2026`);
  const revalidated = await probe("2026-11-26T10:05:00-03:00");
  ok(revalidated.status === "RAN" && (await notifsOf(p9)) === 2, "ao validar o calendário o agendador entrega o que ficou adiado");
  clock = T;

  // ---- 11. Com a ativação desligada de novo: só telemetria ----
  await useCases.deactivate(adminUser, { justification: "Fim do ensaio." });
  const p10 = await freshWork();
  const beforeOff = { n: await count("executive_followup_notifications"), d: await count("notification_deliveries"), i: await count("notification_issues") };
  await resetDue();
  const offAgain = await instance("off-again", "WORKER").tick({ force: true });
  const afterOff = { n: await count("executive_followup_notifications"), d: await count("notification_deliveries"), i: await count("notification_issues") };
  ok(offAgain.status === "IDLE_ACTIVATION_OFF" && JSON.stringify(beforeOff) === JSON.stringify(afterOff) && (await notifsOf(p10)) === 0, "ativação desligada de novo: o agendador só registra telemetria");
  ok(/desativadas/.test((await failure(`insert into notification_issues (id, kind, dedupe_key, details) values ('i-x', 'SCHEDULER_FAILURE', 'x', '{}')`)) ?? ""), "e o banco continua recusando ocorrência operacional");

  // ---- 12. Plugin Fastify: desligado por padrão; liga só com a variável; desligamento limpo no onClose ----
  delete process.env.NOTIFICATIONS_SCHEDULER_IN_API;
  const instancesBefore = await count("notification_scheduler_instances");
  const appOff = await buildApp();
  await appOff.ready();
  await appOff.close();
  ok((await count("notification_scheduler_instances")) === instancesBefore, "sem NOTIFICATIONS_SCHEDULER_IN_API o plugin não registra instância nem cria temporizador");
  process.env.NOTIFICATIONS_SCHEDULER_IN_API = "on";
  const appOn = await buildApp();
  await appOn.ready();
  await sleep(500);
  const pluginRows = await q(`select instance_id, mode, stopped_at from notification_scheduler_instances where mode = 'PLUGIN' and instance_id like 'plugin-%-${process.pid}-%' and stopped_at is null`);
  ok(pluginRows.length === 1, `com a variável ligada o plugin registrou a instância (${pluginRows.map((r) => r.instance_id).join(", ")})`);
  await appOn.close();
  const stoppedRows = await q(`select stop_reason from notification_scheduler_instances where instance_id = '${pluginRows[0]?.instance_id}'`);
  ok(stoppedRows[0]?.stop_reason === "GRACEFUL", "ao fechar a API o plugin registrou o desligamento limpo");
  delete process.env.NOTIFICATIONS_SCHEDULER_IN_API;

  // ---- 13. Limpeza controlada só de instâncias antigas ----
  await q(`update notification_scheduler_instances set last_seen_at = (now() at time zone 'utc') - interval '40 days', stopped_at = (now() at time zone 'utc') - interval '40 days' where instance_id = 'tele-1'`);
  const runsNow = await count("notification_runs");
  const issuesNow = await count("notification_issues");
  const pruned = await new DrizzleSchedulerRepository(admin).pruneInstances(30);
  ok(pruned >= 1 && (await count("notification_scheduler_instances", "instance_id = 'tele-1'")) === 0, `limpeza controlada removeu ${pruned} instância(s) antiga(s)`);
  ok((await count("notification_runs")) === runsNow && (await count("notification_issues")) === issuesNow, "a limpeza não tocou em execuções, avisos nem ocorrências");

  // ---- 14. Dados anteriores intactos ----
  ok((await count(`"user"`)) === baseline.users, "usuários inalterados");
  ok((await count("projects", "id not like 'iso34-%'")) === baseline.projects, "projetos existentes inalterados");

  console.log(log.join("\n"));
  console.log(`\nTOTAL: ${log.filter((l) => l.startsWith("OK")).length} OK, ${log.filter((l) => l.startsWith("FALHA")).length} FALHA`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.log(log.join("\n"));
    console.error("ERRO NO ENSAIO:", error instanceof Error ? error.stack : error);
    process.exit(1);
  });
