import "dotenv/config";

import { db } from "../db";
import { runNotificationGenerator } from "../modules/notifications/notification-generator";
import { makeNotificationDeps } from "../modules/notifications/notifications.routes";

/**
 * Gera ou simula os avisos do acompanhamento semanal, sob comando.
 *
 *   pnpm notifications:run --dry-run [--cutoff=AAAA-MM-DD] [--as-of=AAAA-MM-DDTHH:MM:SS-03:00]
 *   pnpm notifications:run            (geração real: exige a ativação ligada pelo ADMIN)
 *
 * A simulação não cria avisos, entregas nem ocorrências (só o histórico técnico da execução). --cutoff e --as-of
 * valem apenas na simulação. Nenhum agendador é iniciado por este comando.
 */
function arg(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const cutoff = arg("cutoff");
  const asOf = arg("as-of");
  if (!dryRun && (cutoff || asOf)) {
    throw new Error("--cutoff e --as-of só podem ser usados com --dry-run.");
  }
  if (cutoff && new Date(`${cutoff}T00:00:00.000Z`).getUTCDay() !== 4) {
    throw new Error("--cutoff deve ser uma quinta-feira (AAAA-MM-DD).");
  }
  const now = asOf ? new Date(asOf) : new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error("--as-of inválido.");
  }
  const result = await runNotificationGenerator(makeNotificationDeps(db), {
    mode: dryRun ? "DRY_RUN" : "ACTIVE",
    origin: "CLI",
    actorId: null,
    now,
    simulatedCutoff: cutoff ?? null,
  });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
