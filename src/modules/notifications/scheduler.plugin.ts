import type { FastifyPluginAsync } from "fastify";

import type { Database } from "../../db/types";
import { NotificationScheduler, readSchedulerConfig, type SchedulerLogger } from "./notification-scheduler";
import { makeNotificationDeps } from "./notifications.routes";
import { DrizzleSchedulerRepository } from "./scheduler.repository";

/** Monta o agendador com as dependências reais (usado pelo plugin da API e pelo processo dedicado). */
export function createNotificationScheduler(database: Database, mode: "PLUGIN" | "WORKER", logger?: SchedulerLogger, env: NodeJS.ProcessEnv = process.env) {
  const { config, warnings } = readSchedulerConfig(env);
  for (const warning of warnings) (logger ?? console).warn(warning);
  const deps = makeNotificationDeps(database);
  return new NotificationScheduler({
    mode,
    config,
    scheduler: new DrizzleSchedulerRepository(database),
    notifications: deps.notifications,
    generator: deps,
    logger,
  });
}

/**
 * Plugin do agendador dentro da API. DESLIGADO por padrão: só liga com NOTIFICATIONS_SCHEDULER_IN_API=on. Quando houver um
 * processo dedicado saudável, o plugin aguarda (a segurança contra concorrência não depende dessa preferência). Erros do
 * agendador ficam no log e nunca chegam às rotas.
 */
export function makeNotificationSchedulerPlugin(database: Database, env: NodeJS.ProcessEnv = process.env): FastifyPluginAsync {
  return async (app) => {
    if (env.NOTIFICATIONS_SCHEDULER_IN_API !== "on") {
      app.log.info("agendador de notificações desligado na API (NOTIFICATIONS_SCHEDULER_IN_API != on)");
      return;
    }
    const logger: SchedulerLogger = {
      info: (message, data) => app.log.info({ ...data }, message),
      warn: (message, data) => app.log.warn({ ...data }, message),
      error: (message, data) => app.log.error({ ...data }, message),
    };
    const scheduler = createNotificationScheduler(database, "PLUGIN", logger, env);
    app.addHook("onReady", async () => {
      await scheduler.start();
    });
    app.addHook("onClose", async () => {
      await scheduler.stop("GRACEFUL");
    });
  };
}
