import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import {
  createEapInMemoryStore,
  makeEapInMemoryRepos,
  makeEapInMemoryTransactionRunner,
  makeMember,
  makeProject,
  makeUser,
} from "../test/in-memory";
import { makeCreateMilestoneUseCase } from "./create-milestone";
import { makeCreatePhaseUseCase } from "./create-phase";
import { makeCreateTaskUseCase } from "./create-task";
import { makeListProjectReschedulesUseCase } from "./list-project-reschedules";
import { makeRescheduleUseCase } from "./reschedule";

function actor(role: AuthUser["role"], id: string): AuthUser {
  return { id, name: id, email: `${id}@igepps.test`, role };
}

const pmo = actor("PMO", "pmo-1");
const manager = actor("GESTOR", "gestor-1");
const outsider = actor("GESTOR", "gestor-fora");

const day = (value: string) => `${value}T15:00:00.000Z`;

async function setup() {
  const store = createEapInMemoryStore({
    users: [
      makeUser({ id: "pmo-1", role: "PMO" }),
      makeUser({ id: "gestor-1", role: "GESTOR" }),
      makeUser({ id: "gestor-fora", role: "GESTOR" }),
    ],
    projects: [makeProject({ id: "project-1", name: "Portal", ownerId: "gestor-1" })],
    members: [makeMember({ id: "m-gestor", projectId: "project-1", userId: "gestor-1", role: "GESTOR" })],
  });
  const repos = makeEapInMemoryRepos(store);
  const deps = { repos, runInTransaction: makeEapInMemoryTransactionRunner(repos, store) };
  const phase = await makeCreatePhaseUseCase(deps)(pmo, "project-1", { name: "Construção" });
  const task = await makeCreateTaskUseCase(deps)(pmo, "project-1", phase.id, {
    title: "API de integração",
    plannedStartAt: day("2030-02-10"),
    plannedEndAt: day("2030-03-10"),
  });
  const milestone = await makeCreateMilestoneUseCase(deps)(pmo, "project-1", phase.id, {
    title: "Homologação final",
    type: "HOMOLOGACAO",
    plannedAt: day("2030-04-01"),
  });
  return {
    store,
    task,
    milestone,
    phase,
    reschedule: makeRescheduleUseCase(deps),
    list: makeListProjectReschedulesUseCase(deps),
  };
}

describe("reprogramações no nível do projeto", () => {
  it("sem reprogramação devolve total 0, sem data da última e lista vazia", async () => {
    const ctx = await setup();
    const result = await ctx.list(manager, "project-1", {});
    assert.deepEqual(result, { total: 0, lastAt: null, data: [] });
  });

  it("não conta a primeira definição de datas, lista da mais recente à mais antiga e traz item, datas, justificativa e autor", async () => {
    const ctx = await setup();
    const target = { entityType: "TASK" as const, phaseId: ctx.phase.id, taskId: ctx.task.id };
    await ctx.reschedule(manager, "project-1", target, {
      plannedStartAt: day("2030-02-10"),
      plannedEndAt: day("2030-03-20"),
      justification: "Fornecedor atrasou a entrega do ambiente.",
    });
    await ctx.reschedule(
      pmo,
      "project-1",
      { entityType: "MILESTONE", phaseId: ctx.phase.id, milestoneId: ctx.milestone.id },
      { plannedAt: day("2030-04-20"), justification: "Marco acompanha a nova data da tarefa." },
    );

    const result = await ctx.list(manager, "project-1", {});

    assert.equal(result.total, 2);
    assert.equal(result.data.length, 2);
    assert.equal(result.lastAt, result.data[0].createdAt);
    const [latest, earlier] = result.data;
    assert.equal(latest.entityType, "MILESTONE");
    assert.equal(latest.entityTitle, "Homologação final");
    assert.equal(latest.actorId, "pmo-1");
    assert.equal(latest.justification, "Marco acompanha a nova data da tarefa.");
    assert.equal(earlier.entityType, "TASK");
    assert.equal(earlier.entityTitle, "API de integração");
    assert.equal(earlier.previous.endAt, day("2030-03-10"));
    assert.equal(earlier.next.endAt, day("2030-03-20"));
    assert.equal(earlier.kind, "RESCHEDULE");
    // Somente reprogramações efetivadas: o contrato não traz situação de solicitação.
    assert.ok(result.data.every((entry) => entry.kind === "RESCHEDULE"));
  });

  it("limit reduz só a lista: total e última data continuam valendo para todo o histórico", async () => {
    const ctx = await setup();
    const target = { entityType: "TASK" as const, phaseId: ctx.phase.id, taskId: ctx.task.id };
    for (const end of ["2030-03-15", "2030-03-20", "2030-03-25"]) {
      await ctx.reschedule(manager, "project-1", target, {
        plannedStartAt: day("2030-02-10"),
        plannedEndAt: day(end),
        justification: `Novo prazo ${end} por replanejamento da entrega.`,
      });
    }

    const limited = await ctx.list(manager, "project-1", { limit: 2 });
    assert.equal(limited.total, 3);
    assert.equal(limited.data.length, 2);
    assert.equal(limited.data[0].next.endAt, day("2030-03-25"));
    assert.equal(limited.lastAt, limited.data[0].createdAt);

    const all = await ctx.list(manager, "project-1", {});
    assert.equal(all.data.length, 3);
  });

  it("não altera nem remove a auditoria", async () => {
    const ctx = await setup();
    const target = { entityType: "TASK" as const, phaseId: ctx.phase.id, taskId: ctx.task.id };
    await ctx.reschedule(manager, "project-1", target, {
      plannedStartAt: day("2030-02-10"),
      plannedEndAt: day("2030-03-20"),
      justification: "Fornecedor atrasou a entrega do ambiente.",
    });
    const before = JSON.stringify(ctx.store.auditLogs);
    await ctx.list(manager, "project-1", {});
    await ctx.list(manager, "project-1", { limit: 1 });
    assert.equal(JSON.stringify(ctx.store.auditLogs), before);
  });

  it("quem não vê o projeto não consulta o histórico", async () => {
    const ctx = await setup();
    await assert.rejects(
      () => ctx.list(outsider, "project-1", {}),
      (error: unknown) => error instanceof HttpError && [403, 404].includes(error.statusCode),
    );
  });
});
