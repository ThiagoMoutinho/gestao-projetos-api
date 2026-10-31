import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthUser } from "../../../lib/session";
import {
  createEapInMemoryStore,
  makeEapInMemoryRepos,
  makeEapInMemoryTransactionRunner,
  makeProject,
  makeUser,
} from "../test/in-memory";
import { makeCreateMilestoneUseCase } from "./create-milestone";
import { makeCreatePhaseUseCase } from "./create-phase";
import { makeCreateTaskUseCase } from "./create-task";
import { makeDeleteMilestoneUseCase } from "./delete-milestone";
import { makeDeleteTaskUseCase } from "./delete-task";

const pmo: AuthUser = { id: "pmo-1", name: "PMO", email: "pmo-1@igepps.test", role: "PMO" };

const day = (value: string) => value.slice(0, 10);

async function setup() {
  const store = createEapInMemoryStore({
    users: [makeUser({ id: "pmo-1", role: "PMO" })],
    projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
  });
  const repos = makeEapInMemoryRepos(store);
  const deps = { repos, runInTransaction: makeEapInMemoryTransactionRunner(repos, store) };
  const phase = await makeCreatePhaseUseCase(deps)(pmo, "project-1", { name: "Fase" });
  const createTask = (title: string, start: string, end: string, extend = false) =>
    makeCreateTaskUseCase(deps)(pmo, "project-1", phase.id, {
      title,
      plannedStartAt: `${start}T15:00:00.000Z`,
      plannedEndAt: `${end}T15:00:00.000Z`,
      ...(extend ? { extendPhase: true, justification: "Ajuste automático para o teste." } : {}),
    });
  const phaseNow = () => store.phases.find((row) => row.id === phase.id)!;
  return { store, phase, phaseNow, createTask, deps };
}

describe("Exclusão recolhe o período da fase", () => {
  it("volta o término da fase para a última data restante quando o item removido o definia", async () => {
    const { createTask, phaseNow, deps, phase, store } = await setup();
    await createTask("Base", "2026-10-27", "2026-11-02", true);
    const extra = await createTask("Extra", "2026-10-27", "2026-11-17", true);
    assert.equal(day(phaseNow().plannedEndAt!.toISOString()), "2026-11-17");

    await makeDeleteTaskUseCase(deps)(pmo, "project-1", phase.id, extra.id);

    assert.equal(day(phaseNow().plannedEndAt!.toISOString()), "2026-11-02");
    assert.equal(day(phaseNow().plannedStartAt!.toISOString()), "2026-10-27");
    assert.ok(store.auditLogs.some((log) => log.action === "SCHEDULE_CHANGE" && (log.payload as { justification?: string }).justification?.includes("exclusão")));
  });

  it("não corta a fase quando o item removido não definia o término", async () => {
    const { createTask, phaseNow, deps, phase } = await setup();
    await createTask("Longa", "2026-10-27", "2026-11-17", true);
    const curta = await createTask("Curta", "2026-10-28", "2026-11-02");

    await makeDeleteTaskUseCase(deps)(pmo, "project-1", phase.id, curta.id);

    assert.equal(day(phaseNow().plannedEndAt!.toISOString()), "2026-11-17");
  });

  it("não altera a fase quando não restam itens com data", async () => {
    const { createTask, phaseNow, deps, phase } = await setup();
    const only = await createTask("Única", "2026-10-27", "2026-11-17", true);

    await makeDeleteTaskUseCase(deps)(pmo, "project-1", phase.id, only.id);

    assert.equal(day(phaseNow().plannedEndAt!.toISOString()), "2026-11-17");
  });

  it("vale também para marco que definia o término", async () => {
    const { createTask, phaseNow, deps, phase } = await setup();
    await createTask("Base", "2026-10-27", "2026-11-02", true);
    const marco = await makeCreateMilestoneUseCase(deps)(pmo, "project-1", phase.id, {
      title: "Marco",
      type: "ENTREGA",
      plannedAt: "2026-11-17T15:00:00.000Z",
      extendPhase: true,
      justification: "Ajuste automático para o teste.",
    });
    assert.equal(day(phaseNow().plannedEndAt!.toISOString()), "2026-11-17");

    await makeDeleteMilestoneUseCase(deps)(pmo, "project-1", phase.id, marco.id);

    assert.equal(day(phaseNow().plannedEndAt!.toISOString()), "2026-11-02");
  });
});
