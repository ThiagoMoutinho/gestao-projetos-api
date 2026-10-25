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
import { makeDeleteMilestoneUseCase } from "./delete-milestone";
import { makeDeletePhaseUseCase } from "./delete-phase";
import { makeDeleteTaskUseCase } from "./delete-task";

function actor(role: AuthUser["role"], id = "actor-1"): AuthUser {
  return { id, name: "Actor", email: `${id}@igepps.test`, role };
}

const pmo = actor("PMO", "pmo-1");

function rejectsWith(status: number, code: string) {
  return (error: unknown) =>
    error instanceof HttpError && error.statusCode === status && error.code === code;
}

async function setup() {
  const store = createEapInMemoryStore({
    users: [
      makeUser({ id: "pmo-1", role: "PMO" }),
      makeUser({ id: "dev-1", role: "COLABORADOR" }),
    ],
    projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
    members: [
      makeMember({ id: "member-dev", projectId: "project-1", userId: "dev-1", role: "DESENVOLVEDOR" }),
    ],
  });
  const repos = makeEapInMemoryRepos(store);
  const deps = { repos, runInTransaction: makeEapInMemoryTransactionRunner(repos, store) };
  const phase = await makeCreatePhaseUseCase(deps)(pmo, "project-1", { name: "Fase 1" , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"});

  return {
    store,
    phase,
    createTask: (title = "Tarefa") =>
      makeCreateTaskUseCase(deps)(pmo, "project-1", phase.id, { title , plannedStartAt: "2026-06-01T15:00:00.000Z", plannedEndAt: "2026-06-30T15:00:00.000Z"}),
    createMilestone: (title = "Marco") =>
      makeCreateMilestoneUseCase(deps)(pmo, "project-1", phase.id, { title, type: "ENTREGA" , plannedAt: "2026-06-15T15:00:00.000Z"}),
    deletePhase: makeDeletePhaseUseCase(deps),
    deleteTask: makeDeleteTaskUseCase(deps),
    deleteMilestone: makeDeleteMilestoneUseCase(deps),
  };
}

describe("Exclusão de itens da EAP", () => {
  it("exclui tarefa criada por engano e registra a exclusão no histórico", async () => {
    const ctx = await setup();
    const task = await ctx.createTask("Criada por engano");

    await ctx.deleteTask(pmo, "project-1", ctx.phase.id, task.id);

    assert.equal(ctx.store.tasks.length, 0);
    const log = ctx.store.auditLogs.at(-1);
    assert.equal(log?.action, "DELETE");
    assert.equal(log?.entityType, "TASK");
    assert.equal(log?.entityId, task.id);
    assert.equal((log?.payload as { title?: string }).title, "Criada por engano");
  });

  it("bloqueia exclusão para quem não é da gestão do projeto", async () => {
    const ctx = await setup();
    const task = await ctx.createTask();

    await assert.rejects(
      () => ctx.deleteTask(actor("COLABORADOR", "dev-1"), "project-1", ctx.phase.id, task.id),
      rejectsWith(403, "EAP_DELETE_FORBIDDEN"),
    );
    assert.equal(ctx.store.tasks.length, 1);
  });

  it("bloqueia fase com tarefas ou marcos vinculados", async () => {
    const ctx = await setup();
    await ctx.createMilestone();

    await assert.rejects(
      () => ctx.deletePhase(pmo, "project-1", ctx.phase.id),
      (error: unknown) =>
        rejectsWith(409, "PHASE_DELETE_HAS_CHILDREN")(error) &&
        (error as HttpError).message ===
          "Não é possível excluir esta fase porque existem tarefas ou marcos vinculados. Mova ou trate os itens subordinados antes de continuar.",
    );
    assert.equal(ctx.store.phases.length, 1);
  });

  it("exclui fase vazia sem histórico formal", async () => {
    const ctx = await setup();

    await ctx.deletePhase(pmo, "project-1", ctx.phase.id);

    assert.equal(ctx.store.phases.length, 0);
    assert.equal(ctx.store.auditLogs.at(-1)?.action, "DELETE");
  });

  it("bloqueia fase com evidência própria", async () => {
    const ctx = await setup();
    ctx.store.evidences.push({
      id: "ev-1",
      phaseId: ctx.phase.id,
      taskId: null,
      milestoneId: null,
      scheduleRequestId: null,
      title: "Ata",
      url: "https://exemplo.com/ata",
      deliveryId: null,
      createdBy: "pmo-1",
      createdAt: new Date(),
    });

    await assert.rejects(
      () => ctx.deletePhase(pmo, "project-1", ctx.phase.id),
      rejectsWith(409, "PHASE_DELETE_HAS_HISTORY"),
    );
  });

  it("bloqueia tarefa concluída", async () => {
    const ctx = await setup();
    const task = await ctx.createTask();
    ctx.store.tasks[0].status = "CONCLUIDA";

    await assert.rejects(
      () => ctx.deleteTask(pmo, "project-1", ctx.phase.id, task.id),
      rejectsWith(409, "TASK_DELETE_CONCLUDED"),
    );
  });

  it("bloqueia tarefa com evidência, impedimento ou replanejamento", async () => {
    const ctx = await setup();
    const withImpediment = await ctx.createTask("Com impedimento");
    const withRequest = await ctx.createTask("Com replanejamento");
    ctx.store.impediments.push({
      id: "imp-1",
      taskId: withImpediment.id,
      description: "Ambiente de homologação indisponível.",
      openedBy: "pmo-1",
      openedAt: new Date(),
      resolvedBy: null,
      resolvedAt: null,
      resolutionNote: null,
    });
    ctx.store.scheduleRequests.push({ id: "req-1", projectId: "project-1", taskId: withRequest.id });

    for (const task of [withImpediment, withRequest]) {
      await assert.rejects(
        () => ctx.deleteTask(pmo, "project-1", ctx.phase.id, task.id),
        rejectsWith(409, "TASK_DELETE_HAS_HISTORY"),
      );
    }
    assert.equal(ctx.store.tasks.length, 2);
  });

  it("bloqueia marco entregue ou homologado e permite marco pendente", async () => {
    const ctx = await setup();
    const delivered = await ctx.createMilestone("Entregue");
    const pending = await ctx.createMilestone("Pendente");
    ctx.store.milestones.find((row) => row.id === delivered.id)!.status = "APROVADO";

    await assert.rejects(
      () => ctx.deleteMilestone(pmo, "project-1", ctx.phase.id, delivered.id),
      rejectsWith(409, "MILESTONE_DELETE_FORMALIZED"),
    );
    await ctx.deleteMilestone(pmo, "project-1", ctx.phase.id, pending.id);

    assert.deepEqual(
      ctx.store.milestones.map((row) => row.title),
      ["Entregue"],
    );
  });

  it("retorna 404 para item de outra fase", async () => {
    const ctx = await setup();

    await assert.rejects(
      () => ctx.deleteTask(pmo, "project-1", ctx.phase.id, "inexistente"),
      rejectsWith(404, "TASK_NOT_FOUND"),
    );
  });
});
