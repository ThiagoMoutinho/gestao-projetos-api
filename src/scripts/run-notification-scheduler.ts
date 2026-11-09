import "dotenv/config";

import { db } from "../db";
import { runNotificationGenerator } from "../modules/notifications/notification-generator";
import { deriveSchedulerHealth } from "../modules/notifications/scheduler-health";
import { createNotificationScheduler } from "../modules/notifications/scheduler.plugin";
import { makeNotificationDeps } from "../modules/notifications/notifications.routes";
import { DrizzleSchedulerRepository } from "../modules/notifications/scheduler.repository";

/**
 * Processo dedicado do agendador de notificações (para rodar sob supervisão: Docker, pm2, serviço do Windows).
 *
 *   pnpm notifications:worker                 laço contínuo (padrão)
 *   pnpm notifications:worker --once          um único ciclo, forçado (diagnóstico manual), e termina
 *   pnpm notifications:worker --dry-run [--cutoff=AAAA-MM-DD] [--as-of=...]
 *                                             só planeja e imprime; não reserva, não grava, não entrega
 *   pnpm notifications:worker --healthcheck   sai com 0 se FUNCIONANDO ou DESLIGADO; 1 caso contrário
 *
 * Usa exatamente o mesmo código do plugin da API. Nunca ativa as notificações: com a ativação desligada ele só registra
 * telemetria. Encerra de forma limpa com SIGTERM/SIGINT (espera o ciclo em andamento).
 */
function arg(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  if (process.argv.includes("--healthcheck")) {
    const health = deriveSchedulerHealth(await new DrizzleSchedulerRepository(db).readSnapshot());
    console.log(JSON.stringify(health));
    process.exit(health.technicalState === "FUNCIONANDO" || health.technicalState === "DESLIGADO" ? 0 : 1);
  }

  if (process.argv.includes("--dry-run")) {
    const cutoff = arg("cutoff") ?? null;
    if (cutoff && new Date(`${cutoff}T00:00:00.000Z`).getUTCDay() !== 4) throw new Error("--cutoff deve ser uma quinta-feira (AAAA-MM-DD).");
    const asOf = arg("as-of");
    const now = asOf ? new Date(asOf) : new Date();
    if (Number.isNaN(now.getTime())) throw new Error("--as-of inválido.");
    const result = await runNotificationGenerator(makeNotificationDeps(db), {
      mode: "DRY_RUN",
      origin: "SCHEDULER",
      actorId: null,
      now,
      simulatedCutoff: cutoff,
      applyDeliveryWindow: true,
      persistRun: false,
    });
    console.log(JSON.stringify(result.summary, null, 2));
    process.exit(0);
  }

  const scheduler = createNotificationScheduler(db, "WORKER");
  if (process.argv.includes("--once")) {
    await scheduler.register();
    const result = await scheduler.tick({ force: true });
    await scheduler.stop("ONCE");
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.status === "FAILED" ? 1 : 0);
  }

  await scheduler.start();
  const shutdown = async (signal: string) => {
    console.log(`[agendador] ${signal} recebido: encerrando...`);
    await scheduler.stop("GRACEFUL");
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  console.error("[agendador] erro fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
