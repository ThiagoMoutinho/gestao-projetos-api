import type { InstanceInfo, SchedulerOutcome, SchedulerRepository, SchedulerSnapshot, SchedulerStatus } from "./scheduler.repository";

type InstanceRow = InstanceInfo & { startedAt: number; lastSeenAt: number; stoppedAt: number | null; stopReason: string | null };

/**
 * Repositório do agendador em memória, para testes. Reproduz as regras do banco: reserva única com token e validade,
 * renovação só pelo dono, encerramento só pelo dono e recuo progressivo. O relógio do "banco" é controlado pelo teste.
 */
export class InMemorySchedulerRepository implements SchedulerRepository {
  /** Relógio do banco, em milissegundos. */
  dbNow = Date.UTC(2026, 10, 12, 13, 0, 0);
  activationEnabled = false;
  failureIssueOpen = false;
  instances = new Map<string, InstanceRow>();
  state = {
    nextDueAt: null as number | null,
    claimToken: null as string | null,
    claimedBy: null as string | null,
    claimedUntil: null as number | null,
    lastStartedAt: null as number | null,
    lastFinishedAt: null as number | null,
    lastSuccessAt: null as number | null,
    lastStatus: null as SchedulerStatus | null,
    lastError: null as string | null,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    lastRunId: null as string | null,
  };
  /** Falha injetada: simula o banco indisponível. */
  failWith: Error | null = null;

  private guard() {
    if (this.failWith) throw this.failWith;
  }

  advance(seconds: number) {
    this.dbNow += seconds * 1000;
  }

  /** O token ainda é o dono e a reserva não venceu? (usado como barreira de gravação nos testes) */
  tokenValid(token: string) {
    return this.state.claimToken === token && this.state.claimedUntil !== null && this.state.claimedUntil > this.dbNow;
  }

  async registerInstance(info: InstanceInfo) {
    this.guard();
    this.instances.set(info.instanceId, { ...info, startedAt: this.dbNow, lastSeenAt: this.dbNow, stoppedAt: null, stopReason: null });
  }

  async heartbeat(info: InstanceInfo) {
    this.guard();
    const row = this.instances.get(info.instanceId);
    if (!row) {
      this.instances.set(info.instanceId, { ...info, startedAt: this.dbNow, lastSeenAt: this.dbNow, stoppedAt: null, stopReason: null });
    } else if (row.stoppedAt === null) {
      row.lastSeenAt = this.dbNow;
    }
  }

  async markStopped(instanceId: string, reason: string) {
    this.guard();
    const row = this.instances.get(instanceId);
    if (row) {
      row.stoppedAt = this.dbNow;
      row.stopReason = reason;
      row.lastSeenAt = this.dbNow;
    }
  }

  async pruneInstances(olderThanDays: number) {
    this.guard();
    const limit = this.dbNow - olderThanDays * 86_400_000;
    let removed = 0;
    for (const [id, row] of this.instances) {
      if (row.lastSeenAt < limit || (row.stoppedAt !== null && row.stoppedAt < limit)) {
        this.instances.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  async hasLiveWorker(excludeInstanceId: string, withinSeconds: number) {
    this.guard();
    return [...this.instances.values()].some(
      (row) => row.mode === "WORKER" && row.instanceId !== excludeInstanceId && row.stoppedAt === null && row.lastSeenAt > this.dbNow - withinSeconds * 1000,
    );
  }

  async claim(input: { instanceId: string; token: string; leaseSeconds: number; force: boolean }) {
    this.guard();
    const s = this.state;
    const due = input.force || s.nextDueAt === null || s.nextDueAt <= this.dbNow;
    const free = s.claimedUntil === null || s.claimedUntil < this.dbNow;
    if (!due || !free) return false;
    Object.assign(s, { claimToken: input.token, claimedBy: input.instanceId, claimedUntil: this.dbNow + input.leaseSeconds * 1000, lastStartedAt: this.dbNow });
    return true;
  }

  async renew(token: string, leaseSeconds: number) {
    this.guard();
    if (!this.tokenValid(token)) return false;
    this.state.claimedUntil = this.dbNow + leaseSeconds * 1000;
    return true;
  }

  async complete(
    token: string,
    input: { status: SchedulerStatus; error: string | null; runId: string | null; outcome: SchedulerOutcome; intervalSeconds: number; maxBackoffSeconds: number },
  ) {
    this.guard();
    const s = this.state;
    if (s.claimToken !== token) return null;
    const previousFailures = s.consecutiveFailures;
    s.claimToken = null;
    s.claimedBy = null;
    s.claimedUntil = null;
    s.lastFinishedAt = this.dbNow;
    s.lastStatus = input.status;
    s.lastError = input.error;
    s.lastRunId = input.runId ?? s.lastRunId;
    if (input.outcome === "FAILURE") {
      s.consecutiveFailures += 1;
      s.consecutiveSuccesses = 0;
    } else if (input.outcome === "SUCCESS") {
      s.consecutiveFailures = 0;
      s.consecutiveSuccesses += 1;
      s.lastSuccessAt = this.dbNow;
    }
    const wait = input.outcome === "FAILURE" ? Math.min(input.maxBackoffSeconds, input.intervalSeconds * 2 ** Math.min(previousFailures, 10)) : input.intervalSeconds;
    s.nextDueAt = this.dbNow + wait * 1000;
    return { consecutiveFailures: s.consecutiveFailures, consecutiveSuccesses: s.consecutiveSuccesses };
  }

  async readSnapshot(): Promise<SchedulerSnapshot> {
    this.guard();
    const s = this.state;
    const age = (value: number | null) => (value === null ? null : (this.dbNow - value) / 1000);
    return {
      activationEnabled: this.activationEnabled,
      state: {
        lastStatus: s.lastStatus,
        lastError: s.lastError,
        consecutiveFailures: s.consecutiveFailures,
        consecutiveSuccesses: s.consecutiveSuccesses,
        lastStartedAgeSeconds: age(s.lastStartedAt),
        lastFinishedAgeSeconds: age(s.lastFinishedAt),
        lastSuccessAgeSeconds: age(s.lastSuccessAt),
        nextDueInSeconds: s.nextDueAt === null ? null : (s.nextDueAt - this.dbNow) / 1000,
        claimedBy: s.claimedBy,
        claimedForSeconds: s.claimedUntil === null ? null : (s.claimedUntil - this.dbNow) / 1000,
        lastRunId: s.lastRunId,
      },
      instances: [...this.instances.values()]
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
        .map((row) => ({
          instanceId: row.instanceId,
          mode: row.mode,
          hostname: row.hostname,
          pid: row.pid,
          intervalSeconds: row.intervalSeconds,
          startedAgeSeconds: (this.dbNow - row.startedAt) / 1000,
          lastSeenAgeSeconds: (this.dbNow - row.lastSeenAt) / 1000,
          stoppedAgeSeconds: age(row.stoppedAt),
          stopReason: row.stopReason,
        })),
      failureIssueOpen: this.failureIssueOpen,
    };
  }
}
