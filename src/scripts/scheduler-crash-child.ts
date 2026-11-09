import "dotenv/config";

import { createDatabase } from "../db";
import { NotificationScheduler, DEFAULT_SCHEDULER_CONFIG } from "../modules/notifications/notification-scheduler";
import { makeNotificationDeps } from "../modules/notifications/notifications.routes";
import { DrizzleSchedulerRepository } from "../modules/notifications/scheduler.repository";

/**
 * Auxiliar do ensaio de queda do processo (só em banco isolado): executa um tick real e, já DENTRO da execução (linha
 * RUNNING gravada e trava consultiva em mãos), fica parado para o ensaio matar o processo à força.
 */
if (!/\/gp_iso[^/]*$/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Recusado: só roda em banco isolado (nome iniciado por gp_iso).");
  process.exit(2);
}

const database = createDatabase(process.env.DATABASE_URL!);
const deps = makeNotificationDeps(database);
let calls = 0;
const hold = new Proxy(deps.notifications, {
  get: (target, prop, receiver) =>
    prop === "listProjects"
      ? async () => {
          calls += 1;
          if (calls < 2) return target.listProjects(); // 1ª chamada = planejamento; a pausa é na execução real
          console.log("READY");
          await new Promise((resolve) => setTimeout(resolve, 120_000));
          return target.listProjects();
        }
      : Reflect.get(target, prop, receiver),
});

const scheduler = new NotificationScheduler({
  mode: "WORKER",
  instanceId: "crash-child",
  config: DEFAULT_SCHEDULER_CONFIG,
  scheduler: new DrizzleSchedulerRepository(database),
  notifications: deps.notifications,
  generator: { ...deps, notifications: hold },
  clock: () => new Date(process.env.REHEARSAL_NOW ?? "2026-11-26T10:00:00-03:00"),
});

await scheduler.register();
await scheduler.tick({ force: true });
