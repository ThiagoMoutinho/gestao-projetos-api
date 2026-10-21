import "dotenv/config";

import { buildDemoCatalog } from "./catalog";
import { assessDemoDatabase, DemoSeedRefused } from "./guard";
import { planSeed } from "./plan";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readPassword() {
  const password = process.env.DEMO_SEED_PASSWORD;

  if (!password) {
    fail("Informe DEMO_SEED_PASSWORD no ambiente. Não passe a senha como argumento do comando.");
  }

  if (password.length < 8 || password.length > 128) {
    fail("A senha precisa ter entre 8 e 128 caracteres.");
  }

  return password;
}

async function main() {
  const assessment = assessDemoDatabase(process.env);

  if (!assessment.ok) {
    fail(assessment.reason);
  }

  const password = readPassword();

  console.log("Ambiente: development");
  console.log(`Banco: ${assessment.databaseName}`);
  console.log(`Host: ${assessment.host}`);
  console.log("O seed grava somente registros do catálogo fictício.");

  const { executeSeed, loadDemoSnapshot } = await import("./execute");
  const catalog = buildDemoCatalog(new Date());
  const snapshot = await loadDemoSnapshot(catalog);
  const actions = planSeed(snapshot, catalog);
  const counts = countActions(actions);

  console.log(
    `Inserir: ${counts.insert}. Atualizar: ${counts.update}. Sem mudança: ${counts.unchanged}. Ignorar: ${counts.skip}.`,
  );

  for (const action of actions.filter((item) => item.op === "skip")) {
    console.log(`Ignorado ${action.table} ${action.id}: ${action.reason}`);
  }

  await executeSeed(catalog, actions, password);
  console.log("Seed fictício concluído.");
}

function countActions(actions: { op: string }[]) {
  return {
    insert: actions.filter((item) => item.op === "insert").length,
    update: actions.filter((item) => item.op === "update").length,
    unchanged: actions.filter((item) => item.op === "unchanged").length,
    skip: actions.filter((item) => item.op === "skip").length,
  };
}

main().catch((error: unknown) => {
  const password = process.env.DEMO_SEED_PASSWORD ?? "";
  const message = error instanceof DemoSeedRefused || error instanceof Error
    ? error.message
    : "Falha ao executar o seed fictício.";

  console.error(password ? message.split(password).join("[redigido]") : message);
  process.exit(1);
});
