import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createBusinessCalendar, type CalendarDayInput } from "../business-calendar/business-days";
import { createEapInMemoryStore, makeEapInMemoryRepos, makeProject, makeUser } from "../eap/test/in-memory";
import { runNotificationGenerator, type GeneratorDeps } from "./notification-generator";
import {
  DEFAULT_SCHEDULER_CONFIG,
  NotificationScheduler,
  readSchedulerConfig,
  SCHEDULER_FAILURE_KEY,
  type SchedulerConfig,
  type SchedulerDeps,
  type SchedulerLogger,
} from "./notification-scheduler";
import { InMemoryNotificationRepository } from "./notifications.in-memory";
import { InMemorySchedulerRepository } from "./scheduler.in-memory";

const at = (value: string) => new Date(value);
// Quinta 12/11/2026, 10h em Belém: dia útil, dentro da janela. Corte: quinta 22/10; ativação: 20/10.
const THURSDAY_10H = at("2026-11-12T10:00:00-03:00");
const CUTOFF = "2026-10-22";
const ACTIVATED = at("2026-10-20T12:00:00-03:00");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Configuração de teste: tempos curtos de verdade (renovação em milissegundos); a validade da reserva usa o relógio simulado do "banco". */
const TEST_CONFIG: SchedulerConfig = {
  ...DEFAULT_SCHEDULER_CONFIG,
  renewSeconds: 0.02,
  pollSeconds: 0.01,
  heartbeatSeconds: 0.02,
  startupJitterMs: 0,
};

const silent: SchedulerLogger & { errors: string[] } = {
  errors: [],
  info: () => undefined,
  warn: () => undefined,
  error(message) {
    this.errors.push(message);
  },
};

function world(options: { holidays?: CalendarDayInput[]; validated?: number[]; activation?: boolean } = {}) {
  const notifications = new InMemoryNotificationRepository();
  const scheduler = new InMemorySchedulerRepository();
  notifications.fenceValid = (token) => scheduler.tokenValid(token);
  notifications.users = [
    { id: "pmo-1", name: "PMO Um", email: "pmo1@igepps.test", role: "PMO", isActive: true },
    { id: "coord-1", name: "Coordenador CTIN", email: "coord@igepps.test", role: "COORDENADOR", isActive: true },
  ];
  notifications.projectList = [{ id: "p1", name: "Projeto Um", status: "EM_EXECUCAO" }];
  const rule = (id: string, kind: string, source: string, target: { role?: string; userId?: string }, visibility: string) => ({
    id, kind, source, role: target.role ?? null, userId: target.userId ?? null, visibility, enabled: true,
    createdBy: "admin-1", createdAt: THURSDAY_10H, updatedBy: "admin-1", updatedAt: THURSDAY_10H,
  });
  notifications.rules = [
    rule("r1", "PREVENTIVE", "ROLE", { role: "PMO" }, "TO"),
    rule("r2", "OVERDUE", "ROLE", { role: "PMO" }, "TO"),
    rule("r3", "ESCALATION", "USER", { userId: "coord-1" }, "TO"),
    rule("r4", "ESCALATION", "ROLE", { role: "PMO" }, "CC"),
  ];
  const enabled = options.activation !== false;
  if (enabled) {
    notifications.settings = { id: "GLOBAL", activationEnabled: true, activationCutoff: CUTOFF, activatedAt: ACTIVATED, activatedBy: "admin-1", updatedAt: ACTIVATED };
  }
  scheduler.activationEnabled = enabled;
  const store = createEapInMemoryStore({
    users: [makeUser({ id: "admin-1", role: "ADMIN" })],
    projects: [makeProject({ id: "p1", ownerId: "admin-1", status: "EM_EXECUCAO" })],
  });
  store.auditLogs.push({
    id: "start", projectId: "p1", entityType: "PROJECT", entityId: "p1", action: "STATUS_CHANGE", summary: "início",
    payload: { automatic: false, from: "NAO_INICIADO", to: "EM_EXECUCAO" }, actorId: "admin-1", createdAt: at("2026-09-01T10:00:00-03:00"),
  } as never);
  const validated = new Set(options.validated ?? [2026]);
  const generator: GeneratorDeps = {
    notifications,
    eap: makeEapInMemoryRepos(store),
    loadCalendar: async () => createBusinessCalendar(options.holidays ?? [], validated),
    validatedCalendarYears: async () => validated,
  };
  let clockNow = THURSDAY_10H;
  const make = (extra: Partial<SchedulerDeps> = {}) =>
    new NotificationScheduler({
      mode: "WORKER",
      config: TEST_CONFIG,
      scheduler,
      notifications,
      generator,
      clock: () => clockNow,
      logger: silent,
      ...extra,
    });
  const addValidation = (cycleStart: string, kind: "REGULAR" | "EXTRAORDINARY") =>
    store.executiveSummaries.push({ id: `v-${cycleStart}-${kind}`, projectId: "p1", cycleStart, cycleEnd: cycleStart, kind, validatedBy: "admin-1", validatedAt: THURSDAY_10H, fingerprint: "x", unchanged: false, observation: null, snapshot: {}, snapshotVersion: 1 } as never);
  return { notifications, scheduler, generator, make, setClock: (value: Date) => (clockNow = value), validated, addValidation };
}

const keys = (w: ReturnType<typeof world>) => w.notifications.notifications.map((row) => row.dedupeKey).sort();

describe("agendador: desligado e com notificações desativadas", () => {
  it("com a ativação desligada o tick só registra telemetria: não calcula, não cria aviso, entrega nem ocorrência", async () => {
    const w = world({ activation: false });
    let generatorCalls = 0;
    const scheduler = w.make({ run: async (deps, options) => (generatorCalls++, runNotificationGenerator(deps, options)) });
    const result = await scheduler.tick();
    assert.equal(result.status, "IDLE_ACTIVATION_OFF");
    assert.equal(generatorCalls, 0);
    assert.equal(w.notifications.notifications.length + w.notifications.deliveries.length + w.notifications.issues.length + w.notifications.runs.length, 0);
    assert.equal(w.scheduler.state.lastStatus, "IDLE_ACTIVATION_OFF");
    assert.ok(w.scheduler.state.lastSuccessAt !== null); // registra o último ciclo bem-sucedido, mesmo sem trabalho
    assert.equal(w.scheduler.state.claimToken, null); // reserva liberada
    assert.deepEqual((await scheduler.tick()).status, "NOT_DUE"); // respeita o ritmo de 10 minutos
    w.scheduler.advance(601);
    assert.equal((await scheduler.tick()).status, "IDLE_ACTIVATION_OFF");
  });

  it("a configuração respeita os mínimos (intervalo ≥ 5 min, reserva ≥ 60 s, renovação ≤ metade da reserva)", () => {
    assert.equal(readSchedulerConfig({}).config.intervalSeconds, 600);
    assert.equal(readSchedulerConfig({}).config.leaseSeconds, 120);
    assert.equal(readSchedulerConfig({}).config.renewSeconds, 30);
    const clamped = readSchedulerConfig({ NOTIFICATIONS_SCHEDULER_INTERVAL_MINUTES: "2", NOTIFICATIONS_SCHEDULER_LEASE_SECONDS: "30", NOTIFICATIONS_SCHEDULER_RENEW_SECONDS: "100" });
    assert.equal(clamped.config.intervalSeconds, 300);
    assert.equal(clamped.config.leaseSeconds, 60);
    assert.equal(clamped.config.renewSeconds, 30);
    assert.equal(clamped.warnings.length, 3);
    assert.equal(readSchedulerConfig({ NOTIFICATIONS_SCHEDULER_INTERVAL_MINUTES: "15" }).config.intervalSeconds, 900);
    assert.equal(readSchedulerConfig({ NOTIFICATIONS_SCHEDULER_INTERVAL_MINUTES: "abc" }).config.intervalSeconds, 600);
  });
});

describe("agendador: execução, janela de entrega e dia útil", () => {
  it("planeja primeiro: sem trabalho não cria linha técnica; com trabalho executa e entrega", async () => {
    const quiet = world();
    quiet.notifications.projectList = [{ id: "p1", name: "Projeto Um", status: "NAO_INICIADO" }];
    assert.equal((await quiet.make().tick()).status, "IDLE_NOTHING_TO_DO");
    assert.equal(quiet.notifications.runs.length, 0); // tick vazio não deixa rastro de execução

    const w = world();
    const result = await w.make().tick();
    assert.equal(result.status, "RAN");
    assert.deepEqual(keys(w), ["ESCALATION:p1:2026-10-22", "OVERDUE:p1:2026-11-05"]);
    assert.equal(w.notifications.runs.length, 1);
    assert.equal(w.notifications.runs[0].origin, "SCHEDULER");
    assert.equal(w.notifications.runs[0].status, "COMPLETED");
    assert.equal(w.scheduler.state.lastStatus, "RAN");
    assert.equal(w.scheduler.state.lastRunId, w.notifications.runs[0].id);
    // Uma nova verificação não encontra trabalho: nada de linha técnica nova nem aviso duplicado.
    w.scheduler.advance(601);
    assert.equal((await w.make().tick()).status, "IDLE_NOTHING_TO_DO");
    assert.equal(w.notifications.runs.length, 1);
    assert.equal(w.notifications.notifications.length, 2);
  });

  it("fora da janela (antes das 9h00, a partir das 18h00) só há processamento técnico; a entrega acontece na janela", async () => {
    const w = world();
    const scheduler = w.make();
    for (const outside of ["2026-11-12T08:59:59-03:00", "2026-11-12T18:00:00-03:00", "2026-11-12T23:30:00-03:00", "2026-11-12T02:00:00-03:00"]) {
      w.setClock(at(outside));
      w.scheduler.advance(601);
      assert.equal((await scheduler.tick()).status, "TECHNICAL_ONLY", outside);
      assert.equal(w.notifications.notifications.length, 0, `nenhum aviso entregue às ${outside}`);
    }
    w.setClock(at("2026-11-12T09:00:00-03:00"));
    w.scheduler.advance(601);
    assert.equal((await scheduler.tick()).status, "RAN");
    assert.equal(w.notifications.notifications.length, 2);
    // 17h59 ainda entrega (aviso novo numa instância separada).
    const late = world();
    late.setClock(at("2026-11-12T17:59:59-03:00"));
    assert.equal((await late.make().tick()).status, "RAN");
    assert.equal(late.notifications.notifications.length, 2);
  });

  it("entrega só em dia útil: sábado, domingo e feriado adiam; segunda-feira entrega", async () => {
    const w = world({ holidays: [{ day: "2026-11-16", kind: "FERIADO", observed: true }] });
    const scheduler = w.make();
    for (const nonBusiness of ["2026-11-14T10:00:00-03:00", "2026-11-15T10:00:00-03:00", "2026-11-16T10:00:00-03:00"]) {
      w.setClock(at(nonBusiness));
      w.scheduler.advance(601);
      assert.equal((await scheduler.tick()).status, "TECHNICAL_ONLY", nonBusiness);
    }
    assert.equal(w.notifications.notifications.length, 0);
    w.setClock(at("2026-11-17T10:00:00-03:00"));
    w.scheduler.advance(601);
    assert.equal((await scheduler.tick()).status, "RAN");
    assert.equal(w.notifications.notifications.length >= 2, true);
  });

  it("calendário não validado: a entrega é adiada e a ocorrência é registrada (nunca entrega às cegas)", async () => {
    const w = world({ validated: [] });
    const result = await w.make().tick();
    assert.equal(result.status, "RAN"); // houve trabalho técnico: abrir a ocorrência
    assert.equal(w.notifications.notifications.length, 0);
    assert.deepEqual(w.notifications.issues.filter((item) => item.resolvedAt === null).map((item) => item.dedupeKey), ["CALENDAR_NOT_VALIDATED:2026"]);
    w.validated.add(2026);
    w.scheduler.advance(601);
    assert.equal((await w.make().tick()).status, "RAN");
    assert.equal(w.notifications.notifications.length, 2);
    assert.ok(w.notifications.issues.every((item) => item.resolution === "AUTO"));
  });

  it("conciliação (resolver pendências) continua fora da janela, sem entregar nada", async () => {
    const w = world();
    const scheduler = w.make();
    await scheduler.tick();
    assert.equal(w.notifications.notifications.length, 2);
    // O PMO valida o ciclo atual; às 22h (fora da janela de entrega) a conciliação resolve as pendências.
    w.addValidation("2026-11-12", "REGULAR");
    w.setClock(at("2026-11-13T22:00:00-03:00"));
    w.scheduler.advance(601);
    assert.equal((await scheduler.tick()).status, "RAN");
    assert.equal(w.notifications.notifications.length, 2); // nada novo entregue
    assert.ok(w.notifications.notifications.every((row) => row.resolutionReason === "VALIDATED"));
    assert.equal(w.notifications.notifications.length, 2); // nada foi apagado
  });
});

describe("agendador: concorrência e plugin x processo dedicado", () => {
  it("quatro instâncias concorrentes: uma única executa e não há aviso duplicado", async () => {
    const w = world();
    const instances = [1, 2, 3, 4].map((index) => w.make({ instanceId: `inst-${index}`, mode: index % 2 ? "WORKER" : "PLUGIN" }));
    const results = await Promise.all(instances.map((instance) => instance.tick({ force: true })));
    assert.equal(results.filter((item) => item.status === "RAN").length, 1);
    assert.equal(results.filter((item) => item.status === "NOT_DUE" || item.status === "SKIPPED_STANDBY").length, 3);
    assert.equal(w.notifications.notifications.length, 2);
    assert.equal(w.notifications.deliveries.length, 3);
    assert.equal(w.notifications.runs.filter((run) => run.origin === "SCHEDULER").length, 1);
  });

  it("plugin aguarda enquanto houver processo dedicado saudável e assume quando ele some", async () => {
    const w = world();
    const worker = w.make({ instanceId: "worker-1", mode: "WORKER" });
    const plugin = w.make({ instanceId: "plugin-1", mode: "PLUGIN" });
    await worker.register();
    assert.equal((await plugin.tick()).status, "SKIPPED_STANDBY");
    assert.equal(w.notifications.notifications.length, 0);
    assert.equal(w.scheduler.state.lastStatus, null); // aguardar não grava resultado
    w.scheduler.advance(400); // sem batimento do dedicado há mais de 5 min
    assert.equal((await plugin.tick()).status, "RAN");
    assert.equal(w.notifications.notifications.length, 2);
  });

  it("plugin e processo dedicado simultâneos (sem a preferência): ainda sem duplicidade", async () => {
    const w = world();
    const worker = w.make({ instanceId: "worker-1", mode: "WORKER" });
    const plugin = w.make({ instanceId: "plugin-1", mode: "PLUGIN" });
    await worker.register();
    // `force` desliga a espera do plugin: os dois executam ao mesmo tempo.
    const results = await Promise.all([worker.tick({ force: true }), plugin.tick({ force: true })]);
    assert.equal(results.filter((item) => item.status === "RAN").length, 1);
    assert.equal(w.notifications.notifications.length, 2);
  });
});

describe("agendador: reserva, renovação, perda e execução zumbi", () => {
  it("execução maior que a reserva inicial: a reserva é renovada, ninguém assume e a execução termina sem duplicar", async () => {
    const w = world();
    let started: () => void = () => undefined;
    const running = new Promise<void>((resolve) => (started = resolve));
    const slow = w.make({
      instanceId: "slow",
      run: async (deps, options) => {
        if (options.mode === "ACTIVE") {
          started();
          // 5 x 100 s de "banco": bem além dos 120 s da reserva, mas a renovação (a cada 20 ms) acompanha.
          for (let step = 0; step < 5; step += 1) {
            w.scheduler.advance(100);
            await sleep(60);
          }
        }
        return runNotificationGenerator(deps, options);
      },
    });
    const first = slow.tick({ force: true });
    await running;
    const rival = w.make({ instanceId: "rival" });
    assert.equal((await rival.tick({ force: true })).status, "NOT_DUE"); // reserva válida: não é abandono
    const result = await first;
    assert.equal(result.status, "RAN");
    assert.equal(w.notifications.notifications.length, 2);
    assert.equal(w.notifications.runs.filter((run) => run.status === "RUNNING").length, 0);
    assert.equal(w.notifications.runs[0].status, "COMPLETED");
  });

  it("reserva perdida: o tick é cancelado de forma cooperativa e nada é gravado depois", async () => {
    const w = world();
    const victim = w.make({
      instanceId: "victim",
      run: async (deps, options) => {
        if (options.mode === "ACTIVE") {
          w.scheduler.state.claimedUntil = w.scheduler.dbNow - 1; // a reserva venceu (ex.: outra instância assumirá)
          await sleep(80); // a renovação falha e aciona o cancelamento
        }
        return runNotificationGenerator(deps, options);
      },
    });
    const result = await victim.tick({ force: true });
    assert.equal(result.status, "ABORTED_LEASE_LOST");
    assert.equal(w.notifications.notifications.length, 0);
    assert.equal(w.notifications.deliveries.length, 0);
    const run = w.notifications.runs[0];
    assert.equal(run.status, "FAILED");
    assert.match(run.error ?? "", /ABORTADA/);
    assert.equal(w.scheduler.state.consecutiveFailures, 0); // perder a reserva não conta como falha de negócio
  });

  it("processo zumbi: pausado além da reserva, outra instância assume e a primeira não consegue gravar ao acordar", async () => {
    const w = world();
    let release: () => void = () => undefined;
    const paused = new Promise<void>((resolve) => (release = resolve));
    let zombieStarted: () => void = () => undefined;
    const zombieReady = new Promise<void>((resolve) => (zombieStarted = resolve));
    // O zumbi leu "ainda não existe" e congelou antes de gravar; renovação praticamente desligada (processo parado).
    const zombie = w.make({
      instanceId: "zombie",
      config: { ...TEST_CONFIG, renewSeconds: 3600 },
      run: async (deps, options) => {
        if (options.mode !== "ACTIVE") return runNotificationGenerator(deps, options);
        let first = true;
        const stale = new Proxy(deps.notifications, {
          get: (target, prop, receiver) =>
            prop === "findNotificationByKey"
              ? async (key: string) => {
                  if (first) {
                    first = false;
                    zombieStarted();
                    await paused;
                    return null;
                  }
                  return target.findNotificationByKey(key);
                }
              : Reflect.get(target, prop, receiver),
        });
        return runNotificationGenerator({ ...deps, notifications: stale }, options);
      },
    });
    const zombieTick = zombie.tick({ force: true });
    await zombieReady;
    w.scheduler.advance(500); // a reserva do zumbi vence
    w.notifications.locked = false; // a sessão dele caiu no servidor (partição de rede): a trava consultiva foi liberada
    const taker = w.make({ instanceId: "taker" });
    let takerStatus: string;
    try {
      takerStatus = (await taker.tick({ force: true })).status;
    } finally {
      release(); // o zumbi acorda e tenta gravar com a leitura velha (liberado mesmo se a asserção abaixo falhar)
    }
    const created = keys(w);
    assert.equal(takerStatus, "RAN");
    assert.equal(created.length, 2);
    const zombieResult = await zombieTick;
    assert.equal(zombieResult.status, "ABORTED_LEASE_LOST");
    assert.deepEqual(keys(w), created); // nenhum aviso a mais
    assert.equal(w.notifications.deliveries.length, 3);
  });

  it("encerramento inesperado: a execução órfã é reconciliada (só o status) e nada é duplicado nem apagado", async () => {
    const w = world();
    // Um processo anterior caiu no meio: deixou a execução em RUNNING e já criou um dos avisos.
    w.notifications.runs.push({
      id: "orphan", mode: "ACTIVE", origin: "SCHEDULER", status: "RUNNING", startedAt: at("2026-11-12T09:00:00-03:00"), finishedAt: null,
      actorId: null, asOf: at("2026-11-12T09:00:00-03:00"), simulatedCutoff: null, evaluatedProjects: 0, createdNotifications: 0,
      resolvedNotifications: 0, issuesSeen: 0, summary: null, error: null,
    });
    w.notifications.runs.push({ ...w.notifications.runs[0], id: "dry", mode: "DRY_RUN", origin: "API" }); // simulação RUNNING: não é tocada
    await w.notifications.createNotification(
      { id: "n-prev", projectId: "p1", kind: "OVERDUE", cycleStart: "2026-11-05", sequenceStart: null, dueDate: "2026-11-11", scheduledFor: at("2026-11-12T12:00:00Z"), dedupeKey: "OVERDUE:p1:2026-11-05", title: "t", body: "b", followupSnapshot: {}, runId: "orphan" },
      [{ id: "d-prev", userId: "pmo-1", recipientName: "PMO Um", recipientEmail: "pmo1@igepps.test", recipientRole: "PMO", visibility: "TO" }],
    );
    const result = await w.make().tick({ force: true });
    assert.equal(result.status, "RAN");
    const orphan = w.notifications.runs.find((run) => run.id === "orphan")!;
    assert.equal(orphan.status, "FAILED");
    assert.match(orphan.error ?? "", /INTERROMPIDA/);
    assert.equal(w.notifications.runs.find((run) => run.id === "dry")!.status, "RUNNING");
    assert.deepEqual(keys(w), ["ESCALATION:p1:2026-10-22", "OVERDUE:p1:2026-11-05"]); // o aviso já criado não foi repetido
    assert.equal(w.notifications.notifications.length, 2);
    assert.equal(w.notifications.deliveries.filter((d) => d.notificationId === "n-prev").length, 1);
  });

  it("execução legítima e longa nunca é confundida com abandonada: quem espera a trava não a reconcilia", async () => {
    const w = world();
    let started: () => void = () => undefined;
    const running = new Promise<void>((resolve) => (started = resolve));
    let finish: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => (finish = resolve));
    const live = w.make({
      instanceId: "live",
      run: async (deps, options) => {
        if (options.mode === "ACTIVE") {
          return runNotificationGenerator({ ...deps, notifications: new Proxy(deps.notifications, { get: (target, prop, receiver) => (prop === "listProjects" ? async () => (started(), await hold, target.listProjects()) : Reflect.get(target, prop, receiver)) }) }, options);
        }
        return runNotificationGenerator(deps, options);
      },
    });
    const liveTick = live.tick({ force: true });
    await running;
    // Execução manual (CLI) enquanto a legítima segura a trava: nada é reconciliado e a linha RUNNING continua intacta.
    const manual = await runNotificationGenerator(w.generator, { mode: "ACTIVE", origin: "CLI", actorId: null, now: THURSDAY_10H });
    assert.equal(manual.status, "SKIPPED_LOCKED");
    const liveRow = w.notifications.runs.find((run) => run.origin === "SCHEDULER" && run.mode === "ACTIVE")!;
    assert.equal(liveRow.status, "RUNNING");
    finish();
    assert.equal((await liveTick).status, "RAN");
    assert.equal(w.notifications.runs.find((run) => run.id === liveRow.id)!.status, "COMPLETED");
    assert.equal(w.notifications.notifications.length, 2);
  });
});

describe("agendador: falhas, ocorrência e recuperação", () => {
  const failing = (w: ReturnType<typeof world>, fail: { on: boolean }) =>
    w.make({
      instanceId: "flaky",
      run: async (deps, options) => {
        if (fail.on) throw new Error("falha simulada");
        return runNotificationGenerator(deps, options);
      },
    });

  it("recuo progressivo (10, 20, 40, 60 min) e ocorrência SCHEDULER_FAILURE idempotente só após 3 falhas seguidas", async () => {
    const w = world();
    const fail = { on: true };
    const scheduler = failing(w, fail);
    const waits: number[] = [];
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const result = await scheduler.tick({ force: true });
      assert.equal(result.status, "FAILED");
      waits.push(Math.round(((w.scheduler.state.nextDueAt ?? 0) - w.scheduler.dbNow) / 60_000));
      const issues = w.notifications.issues.filter((item) => item.dedupeKey === SCHEDULER_FAILURE_KEY && item.resolvedAt === null);
      assert.equal(issues.length, attempt >= 3 ? 1 : 0, `tentativa ${attempt}`);
    }
    assert.deepEqual(waits, [10, 20, 40, 60, 60]);
    assert.equal(w.notifications.issues.length, 1); // idempotente
    assert.equal(w.notifications.issues[0].occurrences, 3);
    assert.equal(w.notifications.runs.length, 0); // o planejamento silencioso falhou antes de qualquer gravação
    assert.equal(w.notifications.notifications.length, 0);
  });

  it("a conciliação comum não resolve a ocorrência do agendador; só a recuperação efetiva (2 sucessos seguidos) a resolve", async () => {
    const w = world();
    const fail = { on: true };
    const scheduler = failing(w, fail);
    for (let attempt = 0; attempt < 3; attempt += 1) await scheduler.tick({ force: true });
    const open = () => w.notifications.issues.find((item) => item.dedupeKey === SCHEDULER_FAILURE_KEY)!;
    assert.equal(open().resolvedAt, null);

    // Uma execução comum do gerador não pode resolvê-la.
    await runNotificationGenerator(w.generator, { mode: "ACTIVE", origin: "CLI", actorId: null, now: THURSDAY_10H });
    assert.equal(open().resolvedAt, null);

    fail.on = false;
    assert.equal((await scheduler.tick({ force: true })).status, "IDLE_NOTHING_TO_DO"); // a execução comum acima já entregou tudo
    assert.equal(open().resolvedAt, null, "um único sucesso ainda não é recuperação efetiva");
    assert.equal((await scheduler.tick({ force: true })).status, "IDLE_NOTHING_TO_DO");
    assert.equal(open().resolution, "AUTO");
    assert.equal(w.scheduler.state.consecutiveFailures, 0);
  });

  it("sem notificações ativadas a falha não abre ocorrência operacional", async () => {
    const w = world({ activation: false });
    w.scheduler.failWith = null;
    const scheduler = w.make({ run: async () => { throw new Error("nunca chamado"); } });
    for (let attempt = 0; attempt < 4; attempt += 1) await scheduler.tick({ force: true });
    assert.equal(w.notifications.issues.length, 0);
  });

  it("banco indisponível: o laço registra no log, recua, não derruba nada e se recupera sozinho", async () => {
    const w = world();
    const logger = { ...silent, errors: [] as string[] };
    const scheduler = w.make({ logger, config: { ...TEST_CONFIG, pollSeconds: 0.01 } });
    w.scheduler.failWith = new Error("conexão recusada");
    await scheduler.start();
    await sleep(150);
    assert.ok(logger.errors.length > 0, "o erro foi registrado no log mesmo sem banco");
    assert.equal(w.notifications.notifications.length, 0);
    w.scheduler.failWith = null; // o banco volta
    await scheduler.register();
    await sleep(900); // o recuo local chega a algumas centenas de milissegundos
    await scheduler.stop();
    assert.equal(w.notifications.notifications.length, 2); // recuperou e entregou, uma vez só
    assert.equal(w.scheduler.instances.get(scheduler.instanceId)!.stopReason, "GRACEFUL");
  });

  it("reinício: a nova instância recupera o que venceu, sem retroativo e sem repetir", async () => {
    const w = world();
    // Agendador antigo caiu antes de qualquer envio; o novo sobe horas depois, ainda na janela.
    w.setClock(at("2026-11-12T15:30:00-03:00"));
    const reborn = w.make({ instanceId: "reborn" });
    assert.equal((await reborn.tick({ force: true })).status, "RAN");
    assert.deepEqual(keys(w), ["ESCALATION:p1:2026-10-22", "OVERDUE:p1:2026-11-05"]);
    // Nada anterior à ativação: com ativação posterior aos agendamentos, as escalações antigas não são geradas.
    const late = world();
    late.notifications.settings = { ...late.notifications.settings, activatedAt: at("2026-11-12T08:00:00-03:00") };
    assert.equal((await late.make().tick({ force: true })).status, "RAN");
    assert.deepEqual(keys(late), ["OVERDUE:p1:2026-11-05"]);
  });

  it("encerramento limpo: espera o tick em andamento e registra o desligamento", async () => {
    const w = world();
    let started: () => void = () => undefined;
    const running = new Promise<void>((resolve) => (started = resolve));
    const scheduler = w.make({
      instanceId: "graceful",
      run: async (deps, options) => {
        if (options.mode === "ACTIVE") {
          started();
          await sleep(100);
        }
        return runNotificationGenerator(deps, options);
      },
    });
    await scheduler.register();
    const tick = scheduler.tick({ force: true });
    await running;
    await scheduler.stop("GRACEFUL", 5000);
    assert.equal((await tick).status, "RAN");
    const row = w.scheduler.instances.get("graceful")!;
    assert.equal(row.stopReason, "GRACEFUL");
    assert.ok(row.stoppedAt !== null);
  });
});
