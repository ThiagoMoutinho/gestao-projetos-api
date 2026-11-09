import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../lib/http-error";
import type { AuthUser } from "../../lib/session";
import { createBusinessCalendar } from "../business-calendar/business-days";
import { createEapInMemoryStore, makeEapInMemoryRepos, makeProject, makeUser } from "../eap/test/in-memory";
import { deliveryWindowAt } from "./delivery-window";
import { InMemoryNotificationRepository } from "./notifications.in-memory";
import { makeNotificationUseCases } from "./notifications.use-cases";
import { deriveSchedulerHealth } from "./scheduler-health";
import { InMemorySchedulerRepository } from "./scheduler.in-memory";

const at = (value: string) => new Date(value);
const instance = { instanceId: "w1", mode: "WORKER" as const, hostname: "h", pid: 1, intervalSeconds: 600 };

async function snapshotOf(setup: (repo: InMemorySchedulerRepository) => Promise<void> | void) {
  const repo = new InMemorySchedulerRepository();
  await setup(repo);
  return repo.readSnapshot();
}

const success = (repo: InMemorySchedulerRepository, status: "RAN" | "IDLE_ACTIVATION_OFF" = "RAN") => {
  repo.state.lastSuccessAt = repo.dbNow;
  repo.state.lastFinishedAt = repo.dbNow;
  repo.state.lastStatus = status;
};

describe("saúde do agendador: estado técnico separado do operacional", () => {
  it("DESCONHECIDO quando não há dados suficientes (sem instância nem sucesso, ou sem leitura)", async () => {
    assert.deepEqual(deriveSchedulerHealth(null).technicalState, "DESCONHECIDO");
    const empty = await snapshotOf(() => undefined);
    assert.deepEqual(deriveSchedulerHealth(empty), { technicalState: "DESCONHECIDO", operationalState: "DESATIVADAS", reasons: ["NO_DATA"] });
  });

  it("batimentos saudáveis com notificações desativadas = FUNCIONANDO com operação DESATIVADA", async () => {
    const snapshot = await snapshotOf(async (repo) => {
      await repo.registerInstance(instance);
      success(repo, "IDLE_ACTIVATION_OFF");
    });
    assert.deepEqual(deriveSchedulerHealth(snapshot), { technicalState: "FUNCIONANDO", operationalState: "DESATIVADAS", reasons: [] });
  });

  it("FUNCIONANDO com operação ATIVADA; recém-iniciado ainda sem tick = FUNCIONANDO (aguardando o primeiro)", async () => {
    const running = await snapshotOf(async (repo) => {
      repo.activationEnabled = true;
      await repo.registerInstance(instance);
      success(repo);
    });
    assert.deepEqual(deriveSchedulerHealth(running), { technicalState: "FUNCIONANDO", operationalState: "ATIVADAS", reasons: [] });
    const fresh = await snapshotOf(async (repo) => {
      repo.activationEnabled = true;
      await repo.registerInstance(instance);
    });
    assert.deepEqual(deriveSchedulerHealth(fresh).reasons, ["WAITING_FIRST_TICK"]);
    assert.equal(deriveSchedulerHealth(fresh).technicalState, "FUNCIONANDO");
  });

  it("EM_FALHA: falhas seguidas, tick travado (batimento vivo, nenhum sucesso há 3 intervalos) e nenhum sucesso desde o início", async () => {
    const failing = await snapshotOf(async (repo) => {
      repo.activationEnabled = true;
      await repo.registerInstance(instance);
      success(repo);
      repo.state.consecutiveFailures = 2;
      repo.state.lastStatus = "FAILED";
    });
    assert.deepEqual(deriveSchedulerHealth(failing).reasons, ["TICK_FAILING"]);
    assert.equal(deriveSchedulerHealth(failing).technicalState, "EM_FALHA");

    const stalled = await snapshotOf(async (repo) => {
      repo.activationEnabled = true;
      await repo.registerInstance(instance);
      success(repo);
      for (let minute = 0; minute < 40; minute += 1) {
        repo.advance(60);
        await repo.heartbeat(instance); // vivo, mas sem concluir ciclos
      }
    });
    assert.equal(deriveSchedulerHealth(stalled).technicalState, "EM_FALHA");
    assert.deepEqual(deriveSchedulerHealth(stalled).reasons, ["TICK_STALLED"]);

    const neverRan = await snapshotOf(async (repo) => {
      await repo.registerInstance(instance);
      for (let minute = 0; minute < 40; minute += 1) {
        repo.advance(60);
        await repo.heartbeat(instance);
      }
    });
    assert.deepEqual(deriveSchedulerHealth(neverRan).reasons, ["NO_SUCCESSFUL_TICK"]);
  });

  it("SEM_SINAL: nenhum batimento recente (processo morto) ou desligamento limpo com as notificações ativadas", async () => {
    const dead = await snapshotOf(async (repo) => {
      repo.activationEnabled = true;
      await repo.registerInstance(instance);
      success(repo);
      repo.advance(600); // 10 min sem batimento
    });
    assert.deepEqual(deriveSchedulerHealth(dead), { technicalState: "SEM_SINAL", operationalState: "ATIVADAS", reasons: ["NO_HEARTBEAT"] });

    const stoppedWhileActive = await snapshotOf(async (repo) => {
      repo.activationEnabled = true;
      await repo.registerInstance(instance);
      success(repo);
      await repo.markStopped("w1", "GRACEFUL");
    });
    assert.deepEqual(deriveSchedulerHealth(stoppedWhileActive).reasons, ["STOPPED_WHILE_ACTIVE"]);
    assert.equal(deriveSchedulerHealth(stoppedWhileActive).technicalState, "SEM_SINAL");

    // Instâncias podadas, mas já houve sucesso: sem sinal (e não "desconhecido").
    const pruned = await snapshotOf((repo) => success(repo));
    assert.equal(deriveSchedulerHealth(pruned).technicalState, "SEM_SINAL");
  });

  it("DESLIGADO: desligamento limpo com as notificações desativadas; uma instância viva anula o 'sem sinal' das outras", async () => {
    const off = await snapshotOf(async (repo) => {
      await repo.registerInstance(instance);
      success(repo, "IDLE_ACTIVATION_OFF");
      await repo.markStopped("w1", "GRACEFUL");
    });
    assert.deepEqual(deriveSchedulerHealth(off), { technicalState: "DESLIGADO", operationalState: "DESATIVADAS", reasons: ["GRACEFUL_STOP"] });

    const mixed = await snapshotOf(async (repo) => {
      repo.activationEnabled = true;
      await repo.registerInstance(instance);
      await repo.registerInstance({ ...instance, instanceId: "plugin", mode: "PLUGIN" });
      success(repo);
      await repo.markStopped("plugin", "GRACEFUL");
    });
    assert.equal(deriveSchedulerHealth(mixed).technicalState, "FUNCIONANDO");
  });
});

describe("janela de entrega: dia útil, 9h00 a 17h59 em Belém", () => {
  const calendar = createBusinessCalendar([{ day: "2026-11-16", kind: "FERIADO", observed: true }], new Set([2026]));

  it("fronteiras de horário no fuso de Belém", () => {
    assert.equal(deliveryWindowAt(at("2026-11-12T08:59:59-03:00"), calendar).open, false);
    assert.equal(deliveryWindowAt(at("2026-11-12T09:00:00-03:00"), calendar).open, true);
    assert.equal(deliveryWindowAt(at("2026-11-12T17:59:59-03:00"), calendar).open, true);
    assert.deepEqual(deliveryWindowAt(at("2026-11-12T18:00:00-03:00"), calendar), { open: false, reason: "OUTSIDE_HOURS" });
    // 12:00 UTC = 09:00 em Belém; 11:59:59 UTC = 08:59:59.
    assert.equal(deliveryWindowAt(at("2026-11-12T12:00:00Z"), calendar).open, true);
    assert.equal(deliveryWindowAt(at("2026-11-12T11:59:59Z"), calendar).open, false);
    // 23h em Belém já é o dia seguinte em UTC: continua fora da janela.
    assert.equal(deliveryWindowAt(at("2026-11-13T02:30:00Z"), calendar).open, false);
  });

  it("dia útil: fim de semana e feriado fecham a janela; calendário não validado também (com os anos)", () => {
    assert.deepEqual(deliveryWindowAt(at("2026-11-14T10:00:00-03:00"), calendar), { open: false, reason: "NOT_BUSINESS_DAY" });
    assert.deepEqual(deliveryWindowAt(at("2026-11-15T10:00:00-03:00"), calendar), { open: false, reason: "NOT_BUSINESS_DAY" });
    assert.deepEqual(deliveryWindowAt(at("2026-11-16T10:00:00-03:00"), calendar), { open: false, reason: "NOT_BUSINESS_DAY" });
    assert.equal(deliveryWindowAt(at("2026-11-17T10:00:00-03:00"), calendar).open, true);
    assert.deepEqual(deliveryWindowAt(at("2026-11-12T10:00:00-03:00"), createBusinessCalendar([], new Set())), {
      open: false,
      reason: "CALENDAR_NOT_VALIDATED",
      calendarYears: [2026],
    });
  });
});

describe("endpoint de saúde: permissões e migration pendente", () => {
  const actor = (role: AuthUser["role"]): AuthUser => ({ id: `${role}-1`, name: role, email: `${role}@x.test`, role });
  function build(scheduler?: InMemorySchedulerRepository | { readSnapshot: () => Promise<unknown> }) {
    const store = createEapInMemoryStore({ users: [makeUser({ id: "a", role: "ADMIN" })], projects: [makeProject({ id: "p", ownerId: "a" })] });
    return makeNotificationUseCases({
      notifications: new InMemoryNotificationRepository(),
      eap: makeEapInMemoryRepos(store),
      loadCalendar: async () => createBusinessCalendar([], new Set([2026])),
      validatedCalendarYears: async () => new Set([2026]),
      scheduler: scheduler as never,
    });
  }

  it("ADMIN e PMO consultam; os demais perfis recebem 403", async () => {
    const repo = new InMemorySchedulerRepository();
    await repo.registerInstance(instance);
    success(repo, "IDLE_ACTIVATION_OFF");
    const useCases = build(repo);
    for (const role of ["ADMIN", "PMO"] as const) {
      const health = await useCases.getSchedulerHealth(actor(role));
      assert.equal(health.technicalState, "FUNCIONANDO");
      assert.equal(health.operationalState, "DESATIVADAS");
      assert.equal(health.instances[0].alive, true);
      assert.equal(health.lastStatus, "IDLE_ACTIVATION_OFF");
    }
    for (const role of ["COORDENADOR", "GESTOR", "FORNECEDOR", "COLABORADOR"] as const) {
      await assert.rejects(() => useCases.getSchedulerHealth(actor(role)), (error: unknown) => error instanceof HttpError && error.statusCode === 403);
    }
  });

  it("sem a migration 0030 devolve DESCONHECIDO (MIGRATION_PENDING); outros erros do banco não são escondidos", async () => {
    const pending = build({ readSnapshot: async () => Promise.reject(Object.assign(new Error("relation does not exist"), { cause: { code: "42P01" } })) });
    const health = await pending.getSchedulerHealth(actor("ADMIN"));
    assert.equal(health.technicalState, "DESCONHECIDO");
    assert.deepEqual(health.reasons, ["MIGRATION_PENDING"]);
    const broken = build({ readSnapshot: async () => Promise.reject(new Error("conexão perdida")) });
    await assert.rejects(() => broken.getSchedulerHealth(actor("ADMIN")), /conexão perdida/);
    assert.equal((await build(undefined).getSchedulerHealth(actor("PMO"))).technicalState, "DESCONHECIDO");
  });
});
