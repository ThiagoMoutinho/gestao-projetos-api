import { hostname } from "node:os";

import { runNotificationGenerator, type GeneratorDeps, type GeneratorResult, type GeneratorSummary } from "./notification-generator";
import { LeaseLostError, type NotificationRepository } from "./notifications.repository";
import type { SchedulerOutcome, SchedulerRepository, SchedulerStatus } from "./scheduler.repository";

/**
 * Agendador das notificações do acompanhamento semanal. Reaproveita integralmente o gerador da Etapa 3.3; este módulo só
 * decide QUANDO executar e garante que apenas uma instância execute por vez:
 *
 *  - reserva (claim_token + claimed_until, renovada durante o processamento) = ritmo e barreira contra execução zumbi;
 *  - trava consultiva do Postgres dentro do gerador = prova de que alguém executa de fato;
 *  - chave de duplicidade e índices únicos = última linha de defesa.
 *
 * Desligado por padrão (o plugin da API só liga com NOTIFICATIONS_SCHEDULER_IN_API=on). Com as notificações desativadas, o
 * tick só registra telemetria: nunca cria aviso, entrega nem ocorrência operacional.
 */
export type SchedulerConfig = {
  intervalSeconds: number;
  leaseSeconds: number;
  renewSeconds: number;
  /** Duração máxima de um tick; passado disso a execução é cancelada. */
  tickMaxSeconds: number;
  heartbeatSeconds: number;
  /** De quanto em quanto tempo a instância tenta reservar a vez (a reserva só é concedida quando vence o intervalo). */
  pollSeconds: number;
  startupJitterMs: number;
  maxBackoffSeconds: number;
  pruneAfterDays: number;
};

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  intervalSeconds: 600,
  leaseSeconds: 120,
  renewSeconds: 30,
  tickMaxSeconds: 480,
  heartbeatSeconds: 60,
  pollSeconds: 30,
  startupJitterMs: 60_000,
  maxBackoffSeconds: 3600,
  pruneAfterDays: 30,
};

const MIN_INTERVAL_MINUTES = 5;
const MIN_LEASE_SECONDS = 60;
const MIN_RENEW_SECONDS = 10;

/** Lê a configuração do ambiente, aplicando os mínimos (intervalo ≥ 5 min, reserva ≥ 60 s, renovação ≤ metade da reserva). */
export function readSchedulerConfig(env: NodeJS.ProcessEnv = process.env): { config: SchedulerConfig; warnings: string[] } {
  const warnings: string[] = [];
  const number = (name: string, fallback: number, min: number) => {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      warnings.push(`${name} inválido ("${raw}"): usando ${fallback}.`);
      return fallback;
    }
    if (value < min) {
      warnings.push(`${name}=${value} abaixo do mínimo: usando ${min}.`);
      return min;
    }
    return value;
  };
  const intervalMinutes = number("NOTIFICATIONS_SCHEDULER_INTERVAL_MINUTES", DEFAULT_SCHEDULER_CONFIG.intervalSeconds / 60, MIN_INTERVAL_MINUTES);
  const leaseSeconds = number("NOTIFICATIONS_SCHEDULER_LEASE_SECONDS", DEFAULT_SCHEDULER_CONFIG.leaseSeconds, MIN_LEASE_SECONDS);
  let renewSeconds = number("NOTIFICATIONS_SCHEDULER_RENEW_SECONDS", DEFAULT_SCHEDULER_CONFIG.renewSeconds, MIN_RENEW_SECONDS);
  if (renewSeconds > leaseSeconds / 2) {
    warnings.push(`NOTIFICATIONS_SCHEDULER_RENEW_SECONDS deve ser no máximo metade da reserva: usando ${leaseSeconds / 2}.`);
    renewSeconds = leaseSeconds / 2;
  }
  return { config: { ...DEFAULT_SCHEDULER_CONFIG, intervalSeconds: intervalMinutes * 60, leaseSeconds, renewSeconds }, warnings };
}

export type SchedulerLogger = {
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
};

export const consoleLogger: SchedulerLogger = {
  info: (message, data) => console.log(`[agendador] ${message}`, data ?? ""),
  warn: (message, data) => console.warn(`[agendador] ${message}`, data ?? ""),
  error: (message, data) => console.error(`[agendador] ${message}`, data ?? ""),
};

export type SchedulerDeps = {
  mode: "PLUGIN" | "WORKER";
  instanceId?: string;
  config: SchedulerConfig;
  scheduler: SchedulerRepository;
  notifications: NotificationRepository;
  generator: GeneratorDeps;
  /** Injetáveis para teste. */
  run?: (deps: GeneratorDeps, options: Parameters<typeof runNotificationGenerator>[1]) => Promise<GeneratorResult>;
  clock?: () => Date;
  logger?: SchedulerLogger;
};

export type TickResult =
  | { status: "NOT_DUE" | "SKIPPED_STANDBY" }
  | { status: SchedulerStatus; runId: string | null; summary: GeneratorSummary | null; error: string | null };

/** Chave da ocorrência única de falha do agendador (idempotente: uma aberta por vez). */
export const SCHEDULER_FAILURE_KEY = "SCHEDULER_FAILURE:scheduler";
const FAILURES_BEFORE_ISSUE = 3;
/** Sucessos consecutivos exigidos para considerar a recuperação efetiva e resolver a ocorrência. */
const SUCCESSES_TO_RECOVER = 2;
/** Um processo dedicado com batimento dentro deste prazo faz o plugin da API aguardar. */
const WORKER_LIVE_SECONDS = 300;

export class NotificationScheduler {
  readonly instanceId: string;
  private readonly run: NonNullable<SchedulerDeps["run"]>;
  private readonly clock: () => Date;
  private readonly logger: SchedulerLogger;
  private started = false;
  private loopTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private current: { promise: Promise<TickResult>; abort: (reason: string) => void } | null = null;
  private loopFailures = 0;

  constructor(private readonly deps: SchedulerDeps) {
    this.instanceId = deps.instanceId ?? `${deps.mode.toLowerCase()}-${hostname()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
    this.run = deps.run ?? runNotificationGenerator;
    this.clock = deps.clock ?? (() => new Date());
    this.logger = deps.logger ?? consoleLogger;
  }

  private get config() {
    return this.deps.config;
  }

  private get info() {
    return { instanceId: this.instanceId, mode: this.deps.mode, hostname: hostname(), pid: process.pid, intervalSeconds: this.config.intervalSeconds };
  }

  async register() {
    await this.deps.scheduler.registerInstance(this.info);
  }

  /** Um ciclo de verificação. `force` ignora o ritmo (diagnóstico manual), nunca uma reserva ainda válida. */
  tick(options: { force?: boolean } = {}): Promise<TickResult> {
    if (this.current) return this.current.promise;
    const controller = new AbortController();
    const promise = this.doTick(options, controller).finally(() => {
      this.current = null;
    });
    this.current = { promise, abort: (reason) => controller.abort(reason) };
    return promise;
  }

  private async doTick(options: { force?: boolean }, controller: AbortController): Promise<TickResult> {
    const { scheduler, notifications, config } = this.deps;
    const now = this.clock();

    // Plugin: se há um processo dedicado saudável, aguarda (a preferência não é requisito de segurança: a reserva,
    // a trava e as chaves únicas impedem duplicidade mesmo se os dois executarem).
    if (this.deps.mode === "PLUGIN" && !options.force && (await scheduler.hasLiveWorker(this.instanceId, WORKER_LIVE_SECONDS))) {
      return { status: "SKIPPED_STANDBY" };
    }

    const token = crypto.randomUUID();
    const claimed = await scheduler.claim({ instanceId: this.instanceId, token, leaseSeconds: config.leaseSeconds, force: options.force === true });
    if (!claimed) return { status: "NOT_DUE" };

    let leaseLost = false;
    let renewFailures = 0;
    const renewal = setInterval(async () => {
      try {
        if (await scheduler.renew(token, config.leaseSeconds)) {
          renewFailures = 0;
          return;
        }
        leaseLost = true;
        controller.abort("Reserva do agendador perdida.");
      } catch (error) {
        renewFailures += 1;
        this.logger.warn("falha ao renovar a reserva", { error: String(error), renewFailures });
        if (renewFailures >= 2) {
          leaseLost = true;
          controller.abort("Reserva do agendador perdida (banco indisponível na renovação).");
        }
      }
    }, config.renewSeconds * 1000);
    let timedOut = false;
    const cap = setTimeout(() => {
      timedOut = true;
      controller.abort(`Duração máxima do tick (${config.tickMaxSeconds}s) excedida.`);
    }, config.tickMaxSeconds * 1000);

    let status: SchedulerStatus;
    let outcome: SchedulerOutcome = "SUCCESS";
    let error: string | null = null;
    let runId: string | null = null;
    let summary: GeneratorSummary | null = null;
    try {
      const settings = await notifications.getSettings();
      if (!settings.activationEnabled) {
        // Telemetria apenas: nada operacional é calculado nem gravado enquanto as notificações estiverem desativadas.
        status = "IDLE_ACTIVATION_OFF";
      } else {
        const common = { origin: "SCHEDULER" as const, actorId: null, now, applyDeliveryWindow: true, signal: controller.signal };
        const plan = await this.run(this.deps.generator, { ...common, mode: "DRY_RUN", persistRun: false });
        const planned = plan.summary!;
        const work = planned.wouldCreate.length > 0 || planned.resolved.length > 0 || planned.issueChanges > 0;
        if (!work) {
          status = planned.deferredDelivery > 0 ? "TECHNICAL_ONLY" : "IDLE_NOTHING_TO_DO";
        } else {
          const result = await this.run(this.deps.generator, { ...common, mode: "ACTIVE", fence: { token }, recordSkipped: false });
          if (result.status === "SKIPPED_LOCKED") {
            status = "SKIPPED_LOCKED";
            outcome = "NEUTRAL";
          } else {
            status = "RAN";
            runId = result.runId;
            summary = result.summary;
          }
        }
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      if (leaseLost || (caught instanceof LeaseLostError && !timedOut)) {
        status = "ABORTED_LEASE_LOST";
        outcome = "NEUTRAL";
      } else {
        status = "FAILED";
        outcome = "FAILURE";
      }
      this.logger.error("falha no tick", { status, error });
    } finally {
      clearInterval(renewal);
      clearTimeout(cap);
    }

    let counters: { consecutiveFailures: number; consecutiveSuccesses: number } | null = null;
    try {
      counters = await scheduler.complete(token, {
        status,
        error: error ? error.slice(0, 500) : null,
        runId,
        outcome,
        intervalSeconds: config.intervalSeconds,
        maxBackoffSeconds: config.maxBackoffSeconds,
      });
    } catch (caught) {
      this.logger.error("não foi possível registrar o resultado do tick", { status, error: String(caught) });
    }
    if (counters) await this.handleFailureIssue(counters, error, now);
    return { status, runId, summary, error };
  }

  /** Abre (idempotente) a ocorrência após 3 falhas seguidas e a resolve após recuperação efetiva (2 sucessos seguidos). */
  private async handleFailureIssue(counters: { consecutiveFailures: number; consecutiveSuccesses: number }, error: string | null, now: Date) {
    const { notifications } = this.deps;
    try {
      if (counters.consecutiveFailures >= FAILURES_BEFORE_ISSUE) {
        const settings = await notifications.getSettings();
        if (settings.activationEnabled) {
          await notifications.upsertIssue(
            {
              id: crypto.randomUUID(),
              kind: "SCHEDULER_FAILURE",
              dedupeKey: SCHEDULER_FAILURE_KEY,
              year: null,
              details: { consecutiveFailures: counters.consecutiveFailures, lastError: error, instanceId: this.instanceId },
            },
            now,
          );
        }
      } else if (counters.consecutiveSuccesses >= SUCCESSES_TO_RECOVER) {
        const open = (await notifications.listIssues({ open: true, limit: 1000 })).find((item) => item.dedupeKey === SCHEDULER_FAILURE_KEY);
        if (open) await notifications.resolveIssue(open.id, { resolution: "AUTO", resolvedBy: null, note: null, at: now });
      }
    } catch (caught) {
      this.logger.error("não foi possível atualizar a ocorrência de falha do agendador", { error: String(caught) });
    }
  }

  /** Liga o laço: registra a instância, envia batimentos e tenta reservar a vez periodicamente. */
  async start() {
    if (this.started) return;
    this.started = true;
    try {
      await this.register();
      await this.deps.scheduler.pruneInstances(this.config.pruneAfterDays);
    } catch (error) {
      this.logger.error("não foi possível registrar a instância (o laço continua e tenta de novo)", { error: String(error) });
    }
    this.heartbeatTimer = setInterval(() => {
      this.deps.scheduler.heartbeat(this.info).catch((error) => this.logger.warn("falha no batimento", { error: String(error) }));
    }, this.config.heartbeatSeconds * 1000);
    this.heartbeatTimer.unref?.();
    this.schedule(Math.floor(Math.random() * this.config.startupJitterMs));
    this.logger.info("agendador iniciado", { instanceId: this.instanceId, mode: this.deps.mode, intervalSeconds: this.config.intervalSeconds });
  }

  private schedule(delayMs: number) {
    if (!this.started) return;
    this.loopTimer = setTimeout(async () => {
      try {
        await this.tick();
        this.loopFailures = 0;
      } catch (error) {
        // Banco indisponível ou erro inesperado: registra no log e recua; a API principal não é afetada.
        this.loopFailures += 1;
        this.logger.error("erro no laço do agendador", { error: String(error), failures: this.loopFailures });
      }
      const base = this.config.pollSeconds * 1000;
      const delay = this.loopFailures > 0 ? Math.min(base * 2 ** this.loopFailures, 300_000) : base;
      this.schedule(delay * (0.9 + Math.random() * 0.2));
    }, delayMs);
    this.loopTimer.unref?.();
  }

  /** Para o laço, espera o tick em andamento (até o prazo) e registra o desligamento limpo. */
  async stop(reason = "GRACEFUL", graceMs = 30_000) {
    this.started = false;
    if (this.loopTimer) clearTimeout(this.loopTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    const current = this.current;
    if (current) {
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, graceMs).unref?.());
      await Promise.race([current.promise.then(() => undefined, () => undefined), timeout]);
      if (this.current) {
        current.abort("Encerramento do processo.");
        await current.promise.then(() => undefined, () => undefined);
      }
    }
    try {
      await this.deps.scheduler.markStopped(this.instanceId, reason);
    } catch (error) {
      this.logger.error("não foi possível registrar o desligamento da instância", { error: String(error) });
    }
  }
}
