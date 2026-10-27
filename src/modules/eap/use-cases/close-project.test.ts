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
import { makeCloseProjectUseCase } from "./close-project";
import { makeCreateMilestoneUseCase } from "./create-milestone";
import { makeCreatePhaseUseCase } from "./create-phase";
import { makeCreateTaskUseCase } from "./create-task";
import { loadProjectSituation } from "./project-situation";
import { makeReviewMilestoneUseCase } from "./review-milestone";
import { makeUpdateTaskProgressUseCase } from "./update-task-progress";

function actor(role: AuthUser["role"], id: string): AuthUser {
  return { id, name: id, email: `${id}@igepps.test`, role };
}

const pmo = actor("PMO", "pmo-1");
const coordinator = actor("COORDENADOR", "coord-1");
const owner = actor("GESTOR", "owner-1");
const supplier = actor("FORNECEDOR", "forn-1");
const collaborator = actor("COLABORADOR", "obs-1");
const day = (value: string) => `${value}T15:00:00.000Z`;
const rejects = (code: string) => (error: unknown) => error instanceof HttpError && error.code === code;

/** Projeto com uma fase, uma tarefa e um marco de aprovação; `finish` conclui a tarefa e aceita o marco. */
async function setup({ finish = true } = {}) {
  const store = createEapInMemoryStore({
    users: [
      makeUser({ id: "pmo-1", role: "PMO" }),
      makeUser({ id: "coord-1", role: "COORDENADOR" }),
      makeUser({ id: "owner-1", role: "GESTOR" }),
      makeUser({ id: "forn-1", role: "FORNECEDOR" }),
      makeUser({ id: "obs-1", role: "COLABORADOR" }),
    ],
    projects: [makeProject({ id: "project-1", ownerId: "owner-1" })],
    members: [
      makeMember({ id: "m-forn", projectId: "project-1", userId: "forn-1", role: "FORNECEDOR" }),
      makeMember({ id: "m-obs", projectId: "project-1", userId: "obs-1", role: "OBSERVADOR" }),
    ],
  });
  const repos = makeEapInMemoryRepos(store);
  const deps = { repos, runInTransaction: makeEapInMemoryTransactionRunner(repos, store) };
  const phase = await makeCreatePhaseUseCase(deps)(pmo, "project-1", { name: "Fase", responsibleId: "obs-1" });
  const task = await makeCreateTaskUseCase(deps)(pmo, "project-1", phase.id, {
    title: "Tarefa",
    assigneeId: "forn-1",
    plannedStartAt: day("2026-06-01"),
    plannedEndAt: day("2026-06-30"),
  });
  const milestone = await makeCreateMilestoneUseCase(deps)(pmo, "project-1", phase.id, {
    title: "Aprovação", description: "Aprovação final.", type: "APROVACAO", plannedAt: day("2026-06-30"), reviewerId: "obs-1",
  });
  if (finish) {
    await makeUpdateTaskProgressUseCase(deps)(supplier, "project-1", phase.id, task.id, {
      progressPercent: 100,
      actualStartAt: day("2026-06-02"),
      actualEndAt: day("2026-06-20"),
    });
    await makeReviewMilestoneUseCase(deps)(collaborator, "project-1", phase.id, milestone.id, { decision: "APROVADO" });
  }
  const project = () => store.projects.find((row) => row.id === "project-1")!;
  return { store, repos, closeProject: makeCloseProjectUseCase(deps), project };
}

describe("Encerramento formal do projeto", () => {
  it("só gestão do projeto, coordenação ou PMO encerram; fornecedor e colaborador não", async () => {
    const ctx = await setup();
    await assert.rejects(() => ctx.closeProject(supplier, "project-1"), rejects("PROJECT_CLOSE_FORBIDDEN"));
    await assert.rejects(() => ctx.closeProject(collaborator, "project-1"), rejects("PROJECT_CLOSE_FORBIDDEN"));
    assert.notEqual(ctx.project().status, "CONCLUIDO");

    assert.equal((await ctx.closeProject(coordinator, "project-1")).status, "CONCLUIDO");
    const byOwner = await setup();
    assert.equal((await byOwner.closeProject(owner, "project-1")).status, "CONCLUIDO");
  });

  it("encerra projeto apto, registra o evento no histórico e passa a valer como decisão formal", async () => {
    const ctx = await setup();
    assert.equal((await loadProjectSituation(ctx.repos, ctx.project())).readyForClosure, true);
    const phasesBefore = JSON.stringify(ctx.store.phases);

    const result = await ctx.closeProject(pmo, "project-1");

    assert.deepEqual([result.status, result.closedBy], ["CONCLUIDO", "pmo-1"]);
    assert.equal(ctx.project().status, "CONCLUIDO");
    const entry = ctx.store.auditLogs.findLast((log) => log.entityType === "PROJECT");
    assert.deepEqual([entry?.action, entry?.actorId, (entry?.payload as { kind: string }).kind], ["STATUS_CHANGE", "pmo-1", "PROJECT_CLOSURE"]);
    const situation = await loadProjectSituation(ctx.repos, ctx.project());
    assert.deepEqual([situation.status, situation.readyForClosure], ["CONCLUIDO", false]);
    assert.equal(JSON.stringify(ctx.store.phases), phasesBefore);
  });

  it("recusa projeto não apto, sem alterar a situação", async () => {
    const ctx = await setup({ finish: false });
    await assert.rejects(() => ctx.closeProject(pmo, "project-1"), rejects("PROJECT_NOT_READY_FOR_CLOSURE"));
    assert.notEqual(ctx.project().status, "CONCLUIDO");
    assert.equal(ctx.store.auditLogs.filter((log) => log.entityType === "PROJECT").length, 0);
  });

  it("recusa projeto suspenso, mesmo com a EAP concluída", async () => {
    const ctx = await setup();
    ctx.project().status = "SUSPENSO";
    await ctx.repos.audit.create({
      id: "suspensao",
      projectId: "project-1",
      entityType: "PROJECT",
      entityId: "project-1",
      action: "STATUS_CHANGE",
      summary: "Projeto suspenso.",
      payload: { automatic: false, from: "EM_EXECUCAO", to: "SUSPENSO" },
      actorId: "pmo-1",
    });
    await assert.rejects(() => ctx.closeProject(pmo, "project-1"), rejects("PROJECT_SUSPENDED"));
    assert.equal(ctx.project().status, "SUSPENSO");
  });

  it("impede encerramento duplicado", async () => {
    const ctx = await setup();
    await ctx.closeProject(pmo, "project-1");
    await assert.rejects(() => ctx.closeProject(pmo, "project-1"), rejects("PROJECT_ALREADY_CLOSED"));
    assert.equal(ctx.store.auditLogs.filter((log) => (log.payload as { kind?: string } | null)?.kind === "PROJECT_CLOSURE").length, 1);
  });
});
