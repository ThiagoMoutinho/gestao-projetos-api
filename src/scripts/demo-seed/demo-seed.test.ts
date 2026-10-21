import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDemoCatalog } from "./catalog";
import { formatCleanupPreview, planCleanup } from "./clean-plan";
import { addBusinessDays, atBelemNoon, civilToday, previousBusinessDay } from "./dates";
import { assessDemoDatabase, cleanConfirmationMode } from "./guard";
import { emptySnapshot, planSeed, snapshotAfterSeed } from "./plan";

const NOW = new Date("2026-10-19T15:00:00.000Z");

describe("proteção do seed fictício", () => {
  it("aceita somente desenvolvimento, localhost e o banco gestao-projetos com alvo explícito", () => {
    const accepted = assessDemoDatabase(environment());

    assert.equal(accepted.ok, true);
    assert.equal(assessDemoDatabase(environment({ NODE_ENV: "production" })).ok, false);
    assert.equal(assessDemoDatabase(environment({ NODE_ENV: "homologacao" })).ok, false);
    assert.equal(assessDemoDatabase(environment({ NODE_ENV: "test" })).ok, false);
    assert.equal(
      assessDemoDatabase(
        environment({
          DATABASE_URL: "postgresql://postgres:password@localhost:5432/gestao-projetos-prod",
        }),
      ).ok,
      false,
    );
    assert.equal(
      assessDemoDatabase(
        environment({
          DATABASE_URL: "postgresql://postgres:password@db.interno:5432/gestao-projetos",
        }),
      ).ok,
      false,
    );
    assert.equal(
      assessDemoDatabase(
        environment({
          DATABASE_URL: "postgresql://postgres:password@localhost:5432/gestao-projetos?sslmode=require",
        }),
      ).ok,
      false,
    );
    assert.equal(assessDemoDatabase(environment({ DEMO_SEED_TARGET: undefined })).ok, false);

    const ipv6 = assessDemoDatabase(
      environment({
        DATABASE_URL: "postgresql://postgres:password@[::1]:5432/gestao-projetos",
        BETTER_AUTH_URL: "http://[::1]:3000",
      }),
    );

    assert.equal(ipv6.ok, true);

    const refused = assessDemoDatabase(environment({ NODE_ENV: "production" }));

    assert.equal(refused.ok, false);

    if (!refused.ok) {
      assert.equal(refused.reason.includes("password"), false);
      assert.equal(refused.reason.includes("DATABASE_URL"), false);
    }
  });

  it("exige a frase exata para apagar e mostra prévia sem ela", () => {
    assert.equal(cleanConfirmationMode(undefined), "preview");
    assert.equal(cleanConfirmationMode(""), "preview");
    assert.equal(cleanConfirmationMode("APAGAR-CATALOGO-FICTICIO"), "confirmed");
    assert.equal(cleanConfirmationMode("sim"), "rejected");
  });
});

describe("catálogo e idempotência", () => {
  it("monta os cenários pedidos sem identificador repetido", () => {
    const catalog = buildDemoCatalog(NOW);
    const today = civilToday(NOW);

    assert.equal(catalog.projects.length, 10);
    assert.equal(catalog.users.length, 8);
    assert.equal(catalog.projects.some((item) => item.status === "SUSPENSO"), true);
    assert.equal(catalog.phases.some((item) => item.status === "SUSPENSA"), true);
    assert.equal(catalog.tasks.some((item) => item.status === "CANCELADA"), true);
    assert.equal(catalog.tasks.some((item) => item.status === "IMPEDIDA" && item.hasImpediment), true);
    assert.equal(catalog.tasks.some((item) => item.status === "CONCLUIDA" && item.progressPercent === 100), true);
    assert.equal(catalog.milestones.some((item) => item.status === "ENTREGUE" && item.validatedBy === null), true);
    assert.equal(catalog.scheduleRequests.some((item) => item.status === "PENDENTE"), true);
    assert.equal(catalog.scheduleRequests.some((item) => item.status === "APROVADA"), true);
    assert.equal(catalog.users.some((item) => item.email === "pmo.teste@exemplo.com"), false);

    const warning = catalog.tasks.find((item) => item.id === "demo-task-01-aviso");
    const late = catalog.tasks.find((item) => item.id === "demo-task-02-atraso");

    assert.equal(warning?.plannedEndAt.toISOString(), atBelemNoon(addBusinessDays(today, 5)).toISOString());
    assert.equal(late?.plannedEndAt.toISOString(), atBelemNoon(previousBusinessDay(today)).toISOString());
  });

  it("reexecuta sem inserir de novo e não cobre registro que saiu do catálogo", () => {
    const catalog = buildDemoCatalog(NOW);
    const first = planSeed(emptySnapshot(), catalog);
    const seeded = snapshotAfterSeed(emptySnapshot(), catalog, first);
    const second = planSeed(seeded, catalog);

    assert.equal(first.filter((action) => action.op === "insert").length > 0, true);
    assert.equal(second.filter((action) => action.op === "insert").length, 0);
    assert.equal(new Set(seeded.projects.map((item) => item.id)).size, 10);

    const manual = snapshotAfterSeed(emptySnapshot(), catalog, first);
    const project = manual.projects.find((item) => item.id === "demo-proj-01");

    assert.ok(project);
    project.description = "Projeto manual";

    const actions = planSeed(manual, catalog);
    const next = snapshotAfterSeed(manual, catalog, actions);

    assert.equal(actions.find((action) => action.id === "demo-proj-01")?.op, "skip");
    assert.equal(actions.find((action) => action.id === "demo-phase-01")?.op, "skip");
    assert.equal(next.projects.find((item) => item.id === "demo-proj-01")?.description, "Projeto manual");
  });
});

describe("limpeza do catálogo", () => {
  it("apaga só o catálogo e preserva tarefa manual, projeto real e o PMO de teste", () => {
    const catalog = buildDemoCatalog(NOW);
    const seeded = snapshotAfterSeed(emptySnapshot(), catalog, planSeed(emptySnapshot(), catalog));
    const full = planCleanup(seeded, catalog);
    const catalogIds = new Set([
      ...catalog.users.map((item) => item.id),
      ...catalog.projects.map((item) => item.id),
      ...catalog.members.map((item) => item.id),
      ...catalog.phases.map((item) => item.id),
      ...catalog.tasks.map((item) => item.id),
      ...catalog.milestones.map((item) => item.id),
      ...catalog.evidences.map((item) => item.id),
      ...catalog.scheduleRequests.map((item) => item.id),
      ...catalog.scheduleChanges.map((item) => item.id),
      ...catalog.impediments.map((item) => item.id),
    ]);

    assert.equal(full.deletions.length, catalogIds.size);
    assert.equal(full.deletions.every((item) => catalogIds.has(item.id)), true);
    assert.equal(formatCleanupPreview(full).includes("TRUNCATE"), false);
    assert.equal(formatCleanupPreview(full).includes("Nenhum registro foi apagado"), true);

    const mixed = snapshotAfterSeed(emptySnapshot(), catalog, planSeed(emptySnapshot(), catalog));
    mixed.tasks.push({
      id: "tarefa-manual",
      phaseId: "demo-phase-01",
      description: "Feita à mão",
      assigneeId: null,
      createdBy: "demo-user-pmo",
      updatedBy: "demo-user-pmo",
    });
    mixed.projects.push({
      id: "proj-real",
      description: "Projeto real",
      ownerId: "demo-user-sistemas",
    });
    const pmo = mixed.users.find((item) => item.id === "demo-user-pmo");

    assert.ok(pmo);
    pmo.email = "pmo.teste@exemplo.com";

    const plan = planCleanup(mixed, catalog);

    assert.equal(plan.deletions.some((item) => item.id === "demo-proj-01"), false);
    assert.equal(plan.deletions.some((item) => item.id === "demo-phase-01"), false);
    assert.equal(plan.deletions.some((item) => item.id === "tarefa-manual"), false);
    assert.equal(plan.deletions.some((item) => item.id === "proj-real"), false);
    assert.equal(plan.deletions.some((item) => item.id === "demo-proj-02"), true);
    assert.equal(plan.deletions.some((item) => item.id === "demo-user-pmo"), false);
    assert.equal(plan.deletions.some((item) => item.id === "demo-user-sistemas"), false);
    assert.equal(plan.deletions.some((item) => item.id === "demo-user-norte"), true);
  });
});

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://postgres:password@localhost:5432/gestao-projetos",
    BETTER_AUTH_URL: "http://localhost:3000",
    DEMO_SEED_TARGET: "gestao-projetos",
    ...overrides,
  };
}
