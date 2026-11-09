import { sql } from "drizzle-orm";

import type { Database } from "../../db/types";

/** Relógio do banco, em UTC: todas as comparações de reserva e de batimento usam ele (nunca o relógio das instâncias). */
const UTC_NOW = sql`(now() at time zone 'utc')`;

export type SchedulerOutcome = "SUCCESS" | "FAILURE" | "NEUTRAL";
export type SchedulerStatus =
  | "IDLE_ACTIVATION_OFF"
  | "IDLE_NOTHING_TO_DO"
  | "TECHNICAL_ONLY"
  | "RAN"
  | "FAILED"
  | "ABORTED_LEASE_LOST"
  | "SKIPPED_LOCKED"
  | "SKIPPED_STANDBY";

export type InstanceInfo = { instanceId: string; mode: "PLUGIN" | "WORKER"; hostname: string; pid: number; intervalSeconds: number };

/** Foto do estado do agendador com todas as idades calculadas pelo relógio do banco (segundos). */
export type SchedulerSnapshot = {
  activationEnabled: boolean;
  state: {
    lastStatus: SchedulerStatus | null;
    lastError: string | null;
    consecutiveFailures: number;
    consecutiveSuccesses: number;
    lastStartedAgeSeconds: number | null;
    lastFinishedAgeSeconds: number | null;
    lastSuccessAgeSeconds: number | null;
    /** Segundos até o próximo tick (negativo = atrasado). */
    nextDueInSeconds: number | null;
    claimedBy: string | null;
    claimedForSeconds: number | null;
    lastRunId: string | null;
  } | null;
  instances: Array<{
    instanceId: string;
    mode: "PLUGIN" | "WORKER";
    hostname: string;
    pid: number;
    intervalSeconds: number;
    startedAgeSeconds: number;
    lastSeenAgeSeconds: number;
    stoppedAgeSeconds: number | null;
    stopReason: string | null;
  }>;
  failureIssueOpen: boolean;
};

export interface SchedulerRepository {
  registerInstance(info: InstanceInfo): Promise<void>;
  /** Batimento: atualiza a linha da instância ou a recria se tiver sido removida (uma instância viva nunca fica invisível). */
  heartbeat(info: InstanceInfo): Promise<void>;
  markStopped(instanceId: string, reason: string): Promise<void>;
  /** Limpeza controlada: só registros técnicos de instâncias antigas (nunca execuções, avisos ou ocorrências). */
  pruneInstances(olderThanDays: number): Promise<number>;
  hasLiveWorker(excludeInstanceId: string, withinSeconds: number): Promise<boolean>;
  /** Reserva a vez de executar. `force` ignora o ritmo (next_due_at) mas nunca uma reserva ainda válida. */
  claim(input: { instanceId: string; token: string; leaseSeconds: number; force: boolean }): Promise<boolean>;
  /** Renova a reserva. Falso quando o token não é mais o dono ou a reserva já venceu. */
  renew(token: string, leaseSeconds: number): Promise<boolean>;
  /** Encerra o tick: libera a reserva e registra o resultado. Nulo se o token já não era o dono. */
  complete(
    token: string,
    input: { status: SchedulerStatus; error: string | null; runId: string | null; outcome: SchedulerOutcome; intervalSeconds: number; maxBackoffSeconds: number },
  ): Promise<{ consecutiveFailures: number; consecutiveSuccesses: number } | null>;
  readSnapshot(): Promise<SchedulerSnapshot>;
}

const n = (value: unknown) => (value === null || value === undefined ? null : Number(value));

export class DrizzleSchedulerRepository implements SchedulerRepository {
  constructor(private readonly database: Database) {}

  async registerInstance(info: InstanceInfo) {
    await this.database.execute(sql`
      insert into notification_scheduler_instances (instance_id, mode, hostname, pid, interval_seconds, started_at, last_seen_at, stopped_at, stop_reason)
      values (${info.instanceId}, ${info.mode}, ${info.hostname}, ${info.pid}, ${info.intervalSeconds}, ${UTC_NOW}, ${UTC_NOW}, null, null)
      on conflict (instance_id) do update set mode = excluded.mode, hostname = excluded.hostname, pid = excluded.pid,
        interval_seconds = excluded.interval_seconds, started_at = excluded.started_at, last_seen_at = excluded.last_seen_at,
        stopped_at = null, stop_reason = null`);
  }

  async heartbeat(info: InstanceInfo) {
    await this.database.execute(sql`
      insert into notification_scheduler_instances (instance_id, mode, hostname, pid, interval_seconds, started_at, last_seen_at, stopped_at, stop_reason)
      values (${info.instanceId}, ${info.mode}, ${info.hostname}, ${info.pid}, ${info.intervalSeconds}, ${UTC_NOW}, ${UTC_NOW}, null, null)
      on conflict (instance_id) do update set last_seen_at = excluded.last_seen_at
        where notification_scheduler_instances.stopped_at is null`);
  }

  async markStopped(instanceId: string, reason: string) {
    await this.database.execute(sql`update notification_scheduler_instances set stopped_at = ${UTC_NOW}, stop_reason = ${reason}, last_seen_at = ${UTC_NOW} where instance_id = ${instanceId}`);
  }

  async pruneInstances(olderThanDays: number) {
    const result = await this.database.execute(sql`
      delete from notification_scheduler_instances
      where last_seen_at < ${UTC_NOW} - make_interval(days => ${olderThanDays})
         or (stopped_at is not null and stopped_at < ${UTC_NOW} - make_interval(days => ${olderThanDays}))`);
    return result.rowCount ?? 0;
  }

  async hasLiveWorker(excludeInstanceId: string, withinSeconds: number) {
    const result = await this.database.execute(sql`
      select 1 from notification_scheduler_instances
      where mode = 'WORKER' and instance_id <> ${excludeInstanceId} and stopped_at is null
        and last_seen_at > ${UTC_NOW} - make_interval(secs => ${withinSeconds}) limit 1`);
    return result.rows.length > 0;
  }

  async claim(input: { instanceId: string; token: string; leaseSeconds: number; force: boolean }) {
    const result = await this.database.execute(sql`
      update notification_scheduler_state
         set claim_token = ${input.token}, claimed_by = ${input.instanceId},
             claimed_until = ${UTC_NOW} + make_interval(secs => ${input.leaseSeconds}),
             last_started_at = ${UTC_NOW}, updated_at = ${UTC_NOW}
       where id = 'GLOBAL'
         and (${input.force} or next_due_at is null or next_due_at <= ${UTC_NOW})
         and (claimed_until is null or claimed_until < ${UTC_NOW})
      returning claim_token`);
    return result.rows.length > 0;
  }

  async renew(token: string, leaseSeconds: number) {
    const result = await this.database.execute(sql`
      update notification_scheduler_state
         set claimed_until = ${UTC_NOW} + make_interval(secs => ${leaseSeconds}), updated_at = ${UTC_NOW}
       where id = 'GLOBAL' and claim_token = ${token} and claimed_until > ${UTC_NOW}
      returning claim_token`);
    return result.rows.length > 0;
  }

  async complete(
    token: string,
    input: { status: SchedulerStatus; error: string | null; runId: string | null; outcome: SchedulerOutcome; intervalSeconds: number; maxBackoffSeconds: number },
  ) {
    const result = await this.database.execute(sql`
      update notification_scheduler_state
         set claim_token = null, claimed_by = null, claimed_until = null,
             last_finished_at = ${UTC_NOW}, last_status = ${input.status}, last_error = ${input.error},
             last_run_id = coalesce(${input.runId}, last_run_id),
             consecutive_failures = case ${input.outcome} when 'FAILURE' then consecutive_failures + 1 when 'SUCCESS' then 0 else consecutive_failures end,
             consecutive_successes = case ${input.outcome} when 'SUCCESS' then consecutive_successes + 1 when 'FAILURE' then 0 else consecutive_successes end,
             last_success_at = case ${input.outcome} when 'SUCCESS' then ${UTC_NOW} else last_success_at end,
             next_due_at = ${UTC_NOW} + make_interval(secs => case ${input.outcome}
               when 'FAILURE' then least(${input.maxBackoffSeconds}::double precision, ${input.intervalSeconds}::double precision * power(2, least(consecutive_failures, 10)))
               else ${input.intervalSeconds}::double precision end),
             updated_at = ${UTC_NOW}
       where id = 'GLOBAL' and claim_token = ${token}
      returning consecutive_failures, consecutive_successes`);
    const row = result.rows[0] as { consecutive_failures: number; consecutive_successes: number } | undefined;
    return row ? { consecutiveFailures: Number(row.consecutive_failures), consecutiveSuccesses: Number(row.consecutive_successes) } : null;
  }

  async readSnapshot(): Promise<SchedulerSnapshot> {
    const age = (column: string) => sql.raw(`extract(epoch from ((now() at time zone 'utc') - ${column}))`);
    const [stateRows, instanceRows, settingsRows, issueRows] = await Promise.all([
      this.database.execute(sql`
        select last_status, last_error, consecutive_failures, consecutive_successes, claimed_by, last_run_id,
               ${age("last_started_at")} as started_age, ${age("last_finished_at")} as finished_age, ${age("last_success_at")} as success_age,
               extract(epoch from (next_due_at - (now() at time zone 'utc'))) as next_due_in,
               extract(epoch from (claimed_until - (now() at time zone 'utc'))) as claimed_for
          from notification_scheduler_state where id = 'GLOBAL'`),
      this.database.execute(sql`
        select instance_id, mode, hostname, pid, interval_seconds, stop_reason,
               ${age("started_at")} as started_age, ${age("last_seen_at")} as seen_age, ${age("stopped_at")} as stopped_age
          from notification_scheduler_instances order by last_seen_at desc limit 50`),
      this.database.execute(sql`select activation_enabled from notification_settings where id = 'GLOBAL'`),
      this.database.execute(sql`select 1 from notification_issues where kind = 'SCHEDULER_FAILURE' and resolved_at is null limit 1`),
    ]);
    const state = stateRows.rows[0] as Record<string, unknown> | undefined;
    return {
      activationEnabled: Boolean((settingsRows.rows[0] as { activation_enabled?: boolean } | undefined)?.activation_enabled),
      state: state
        ? {
            lastStatus: (state.last_status as SchedulerStatus | null) ?? null,
            lastError: (state.last_error as string | null) ?? null,
            consecutiveFailures: Number(state.consecutive_failures),
            consecutiveSuccesses: Number(state.consecutive_successes),
            lastStartedAgeSeconds: n(state.started_age),
            lastFinishedAgeSeconds: n(state.finished_age),
            lastSuccessAgeSeconds: n(state.success_age),
            nextDueInSeconds: n(state.next_due_in),
            claimedBy: (state.claimed_by as string | null) ?? null,
            claimedForSeconds: n(state.claimed_for),
            lastRunId: (state.last_run_id as string | null) ?? null,
          }
        : null,
      instances: (instanceRows.rows as Array<Record<string, unknown>>).map((row) => ({
        instanceId: String(row.instance_id),
        mode: row.mode as "PLUGIN" | "WORKER",
        hostname: String(row.hostname),
        pid: Number(row.pid),
        intervalSeconds: Number(row.interval_seconds),
        startedAgeSeconds: Number(row.started_age),
        lastSeenAgeSeconds: Number(row.seen_age),
        stoppedAgeSeconds: n(row.stopped_age),
        stopReason: (row.stop_reason as string | null) ?? null,
      })),
      failureIssueOpen: issueRows.rows.length > 0,
    };
  }
}
