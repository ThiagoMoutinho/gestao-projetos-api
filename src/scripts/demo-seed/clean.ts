import "dotenv/config";

import { buildDemoCatalog } from "./catalog";
import { formatCleanupPreview, planCleanup } from "./clean-plan";
import { assessDemoDatabase, cleanConfirmationMode, DemoSeedRefused } from "./guard";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main() {
  const assessment = assessDemoDatabase(process.env);

  if (!assessment.ok) {
    fail(assessment.reason);
  }

  const mode = cleanConfirmationMode(process.env.DEMO_SEED_CLEAN_CONFIRM);

  if (mode === "rejected") {
    fail("Limpeza bloqueada: a confirmação não confere. Nenhum registro foi apagado.");
  }

  console.log("Ambiente: development");
  console.log(`Banco: ${assessment.databaseName}`);
  console.log(`Host: ${assessment.host}`);

  const { executeCleanup, loadDemoSnapshot } = await import("./execute");
  const catalog = buildDemoCatalog(new Date());
  const snapshot = await loadDemoSnapshot(catalog);
  const plan = planCleanup(snapshot, catalog);

  console.log(formatCleanupPreview(plan));

  if (mode === "preview") {
    console.log("Para apagar somente essa lista, execute de novo com DEMO_SEED_CLEAN_CONFIRM=APAGAR-CATALOGO-FICTICIO.");
    return;
  }

  await executeCleanup(catalog, plan);
  console.log(`Limpeza concluída. Registros apagados do catálogo: ${plan.deletions.length}.`);
}

main().catch((error: unknown) => {
  const message = error instanceof DemoSeedRefused || error instanceof Error
    ? error.message
    : "Falha ao limpar o seed fictício.";

  console.error(message);
  process.exit(1);
});
