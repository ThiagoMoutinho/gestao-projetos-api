import type { AuthUser } from "../../../lib/session";
import { toEapMilestoneDto } from "../dtos/eap-milestones.dto";
import { toEapTaskDto } from "../dtos/eap-tasks.dto";
import type { EapTaskRow } from "../dtos/eap-tasks.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import { presentPhase, syncPhaseStatus } from "./phase-rollup";
import {
  assertCanCreateItems,
  assertCanView,
  loadMilestoneInPhase,
  loadPhaseInProject,
  loadProjectAccess,
  loadTaskInPhase,
} from "./shared";

/**
 * Duplicar cria uma cópia limpa do planejamento: nome com "(cópia)", descrição, responsável, prioridade, peso e datas
 * planejadas (que passam a ser também a linha de base da cópia). A cópia nasce "Não iniciada", com 0% de andamento e
 * sem datas reais, evidências, impedimentos, decisões, entregas, reprogramações ou histórico do original. A tarefa
 * leva as subtarefas e a fase leva as tarefas e os marcos. Mesmas permissões e histórico da criação.
 */
const COPY_SUFFIX = " (cópia)";

export function copyTitle(title: string, maxLength = 255) {
  return `${title.slice(0, Math.max(0, maxLength - COPY_SUFFIX.length))}${COPY_SUFFIX}`;
}

type CopyTaskInput = {
  source: EapTaskRow;
  phaseId: string;
  parentTaskId: string | null;
  title: string;
  sortOrder: number;
  actorId: string;
};

function newTaskRecord({ source, phaseId, parentTaskId, title, sortOrder, actorId }: CopyTaskInput) {
  return {
    id: crypto.randomUUID(),
    phaseId,
    parentTaskId,
    title,
    description: source.description,
    sortOrder,
    assigneeId: source.assigneeId,
    status: "NAO_INICIADA" as const,
    progressPercent: 0,
    weight: source.weight,
    priority: source.priority,
    plannedStartAt: source.plannedStartAt,
    plannedEndAt: source.plannedEndAt,
    baselineStartAt: source.plannedStartAt,
    baselineEndAt: source.plannedEndAt,
    correctiveMilestoneId: null,
    createdBy: actorId,
    updatedBy: actorId,
  };
}

async function nextSortOrder(repos: EapRepos, phaseId: string) {
  const [taskMax, milestoneMax] = await Promise.all([
    repos.tasks.findMaxSortOrder(phaseId),
    repos.milestones.findMaxSortOrder(phaseId),
  ]);
  return Math.max(taskMax ?? -1, milestoneMax ?? -1) + 1;
}

/** Copia a tarefa e as subtarefas dela para a fase indicada. Devolve a cópia da tarefa de nível principal. */
async function copyTaskTree(
  repos: EapRepos,
  input: { projectId: string; actorId: string; phaseId: string; source: EapTaskRow; subtasks: EapTaskRow[]; title: string; parentTaskId: string | null; sortOrder: number },
) {
  const root = await repos.tasks.create(
    newTaskRecord({
      source: input.source,
      phaseId: input.phaseId,
      parentTaskId: input.parentTaskId,
      title: input.title,
      sortOrder: input.sortOrder,
      actorId: input.actorId,
    }),
  );
  await repos.audit.create({
    id: crypto.randomUUID(),
    projectId: input.projectId,
    entityType: "TASK",
    entityId: root.id,
    action: "CREATE",
    summary: `${input.parentTaskId ? "Subtarefa" : "Tarefa"} "${root.title}" criada por duplicação de "${input.source.title}".`,
    payload: { phaseId: input.phaseId, parentTaskId: input.parentTaskId, duplicatedFromId: input.source.id },
    actorId: input.actorId,
  });

  let order = input.sortOrder;
  for (const subtask of input.subtasks) {
    order += 1;
    const copy = await repos.tasks.create(
      newTaskRecord({
        source: subtask,
        phaseId: input.phaseId,
        parentTaskId: root.id,
        title: subtask.title,
        sortOrder: order,
        actorId: input.actorId,
      }),
    );
    await repos.audit.create({
      id: crypto.randomUUID(),
      projectId: input.projectId,
      entityType: "TASK",
      entityId: copy.id,
      action: "CREATE",
      summary: `Subtarefa "${copy.title}" criada por duplicação.`,
      payload: { phaseId: input.phaseId, parentTaskId: root.id, duplicatedFromId: subtask.id },
      actorId: input.actorId,
    });
  }
  return root;
}

export function makeDuplicateTaskUseCase(deps: { repos: EapRepos; runInTransaction: EapTransactionRunner }) {
  return async function duplicateTask(actor: AuthUser, projectId: string, phaseId: string, taskId: string) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    assertCanCreateItems(context);
    await loadPhaseInProject(deps.repos, projectId, phaseId);
    const source = await loadTaskInPhase(deps.repos, phaseId, taskId);

    const created = await deps.runInTransaction(async (txRepos) => {
      const all = await txRepos.tasks.listByPhase(phaseId);
      const subtasks = all.filter((task) => task.parentTaskId === source.id);
      const first = await nextSortOrder(txRepos, phaseId);
      const root = await copyTaskTree(txRepos, {
        projectId,
        actorId: actor.id,
        phaseId,
        source,
        subtasks,
        title: copyTitle(source.title),
        // Duplicar uma subtarefa gera outra subtarefa da mesma tarefa superior.
        parentTaskId: source.parentTaskId,
        sortOrder: first,
      });
      await syncPhaseStatus(txRepos, {
        projectId,
        phaseId,
        actorId: actor.id,
        cause: `Tarefa "${root.title}" criada por duplicação.`,
      });
      return (await txRepos.tasks.findByIdAndPhase(root.id, phaseId)) ?? root;
    });

    return toEapTaskDto(created);
  };
}

export function makeDuplicateMilestoneUseCase(deps: { repos: EapRepos; runInTransaction: EapTransactionRunner }) {
  return async function duplicateMilestone(actor: AuthUser, projectId: string, phaseId: string, milestoneId: string) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    assertCanCreateItems(context);
    await loadPhaseInProject(deps.repos, projectId, phaseId);
    const source = await loadMilestoneInPhase(deps.repos, phaseId, milestoneId);

    const created = await deps.runInTransaction(async (txRepos) => {
      const milestone = await txRepos.milestones.create({
        id: crypto.randomUUID(),
        phaseId,
        title: copyTitle(source.title),
        description: source.description,
        sortOrder: await nextSortOrder(txRepos, phaseId),
        type: source.type,
        status: "PENDENTE",
        plannedAt: source.plannedAt,
        baselineAt: source.plannedAt,
        reviewerId: source.reviewerId,
        presenterId: source.presenterId,
        createdBy: actor.id,
        updatedBy: actor.id,
      });
      await txRepos.audit.create({
        id: crypto.randomUUID(),
        projectId,
        entityType: "MILESTONE",
        entityId: milestone.id,
        action: "CREATE",
        summary: `Marco "${milestone.title}" criado por duplicação de "${source.title}".`,
        payload: { phaseId, duplicatedFromId: source.id, type: milestone.type, plannedAt: milestone.plannedAt?.toISOString() ?? null },
        actorId: actor.id,
      });
      await syncPhaseStatus(txRepos, {
        projectId,
        phaseId,
        actorId: actor.id,
        cause: `Marco "${milestone.title}" criado por duplicação.`,
      });
      return milestone;
    });

    return toEapMilestoneDto(created);
  };
}

export function makeDuplicatePhaseUseCase(deps: { repos: EapRepos; runInTransaction: EapTransactionRunner }) {
  return async function duplicatePhase(actor: AuthUser, projectId: string, phaseId: string) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    assertCanCreateItems(context);
    const source = await loadPhaseInProject(deps.repos, projectId, phaseId);

    return deps.runInTransaction(async (txRepos) => {
      const phase = await txRepos.phases.create({
        id: crypto.randomUUID(),
        projectId,
        name: copyTitle(source.name),
        description: source.description,
        sortOrder: ((await txRepos.phases.findMaxSortOrder(projectId)) ?? -1) + 1,
        status: "NAO_INICIADA",
        responsibleId: source.responsibleId,
        completionCriteria: source.completionCriteria,
        // As datas da fase são calculadas pelas tarefas e marcos (syncPhaseStatus), como na criação.
        plannedStartAt: null,
        plannedEndAt: null,
        baselineStartAt: null,
        baselineEndAt: null,
        createdBy: actor.id,
        updatedBy: actor.id,
      });
      await txRepos.audit.create({
        id: crypto.randomUUID(),
        projectId,
        entityType: "PHASE",
        entityId: phase.id,
        action: "CREATE",
        summary: `Fase "${phase.name}" criada por duplicação de "${source.name}".`,
        payload: { sortOrder: phase.sortOrder, responsibleId: phase.responsibleId, duplicatedFromId: source.id },
        actorId: actor.id,
      });

      // Mantém a ordem dos itens do original (tarefas e marcos intercalados) em uma sequência nova.
      const [tasks, milestones] = await Promise.all([
        txRepos.tasks.listByPhase(source.id),
        txRepos.milestones.listByPhase(source.id),
      ]);
      const topLevel = [
        ...tasks.filter((task) => !task.parentTaskId).map((task) => ({ kind: "task" as const, task, order: task.sortOrder })),
        ...milestones.map((milestone) => ({ kind: "milestone" as const, milestone, order: milestone.sortOrder })),
      ].sort((a, b) => a.order - b.order);

      // As subtarefas ficam depois dos itens de nível principal (a ordem delas segue a da tarefa superior).
      let sortOrder = 0;
      const subtaskJobs: Array<{ parent: EapTaskRow; copyId: string }> = [];
      for (const item of topLevel) {
        if (item.kind === "task") {
          const root = await copyTaskTree(txRepos, {
            projectId,
            actorId: actor.id,
            phaseId: phase.id,
            source: item.task,
            subtasks: [],
            title: item.task.title,
            parentTaskId: null,
            sortOrder,
          });
          subtaskJobs.push({ parent: item.task, copyId: root.id });
        } else {
          await txRepos.milestones.create({
            id: crypto.randomUUID(),
            phaseId: phase.id,
            title: item.milestone.title,
            description: item.milestone.description,
            sortOrder,
            type: item.milestone.type,
            status: "PENDENTE",
            plannedAt: item.milestone.plannedAt,
            baselineAt: item.milestone.plannedAt,
            reviewerId: item.milestone.reviewerId,
            presenterId: item.milestone.presenterId,
            createdBy: actor.id,
            updatedBy: actor.id,
          });
        }
        sortOrder += 1;
      }
      for (const job of subtaskJobs) {
        for (const subtask of tasks.filter((task) => task.parentTaskId === job.parent.id)) {
          await txRepos.tasks.create(
            newTaskRecord({
              source: subtask,
              phaseId: phase.id,
              parentTaskId: job.copyId,
              title: subtask.title,
              sortOrder,
              actorId: actor.id,
            }),
          );
          sortOrder += 1;
        }
      }

      await syncPhaseStatus(txRepos, {
        projectId,
        phaseId: phase.id,
        actorId: actor.id,
        cause: `Fase "${phase.name}" criada por duplicação.`,
      });
      const fresh = (await txRepos.phases.findByIdAndProject(phase.id, projectId)) ?? phase;
      return presentPhase(txRepos, fresh);
    });
  };
}
