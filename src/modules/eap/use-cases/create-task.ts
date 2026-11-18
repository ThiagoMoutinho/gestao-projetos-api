import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import type { CreateTaskInput } from "../dtos/eap-tasks.dto";
import { toEapTaskDto } from "../dtos/eap-tasks.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import { syncPhaseStatus } from "./phase-rollup";
import { extendPhaseToCover } from "./reschedule";
import {
  assertCanRescheduleEap,
  assertCanCreateItems,
  assertCanView,
  assertRequiredPlannedRange,
  assertValidTaskAssignees,
  loadMilestoneInPhase,
  loadPhaseInProject,
  loadProjectAccess,
  parseOptionalDate,
} from "./shared";

const CORRECTION_STATUSES = new Set(["AJUSTES_SOLICITADOS", "REJEITADO"]);

export function makeCreateTaskUseCase(deps: {
  repos: EapRepos;
  runInTransaction: EapTransactionRunner;
}) {
  return async function createTask(
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    input: CreateTaskInput,
  ) {
    const { project, context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    assertCanCreateItems(context);
    if (input.extendPhase) {
      assertCanRescheduleEap(context);
    }
    await loadPhaseInProject(deps.repos, projectId, phaseId);

    // Subtarefa: a superior é da mesma fase, está ativa e não é, ela mesma, uma subtarefa (a EAP tem 1 nível de subordinação).
    const parentTaskId = input.parentTaskId ?? null;
    if (parentTaskId) {
      const parent = await deps.repos.tasks.findByIdAndPhase(parentTaskId, phaseId);
      if (!parent) {
        throw new HttpError(404, "Tarefa superior não encontrada nesta fase.", "TASK_PARENT_NOT_FOUND");
      }
      if (parent.parentTaskId) {
        throw new HttpError(
          409,
          "Uma subtarefa não pode ter subtarefas: a EAP aceita apenas um nível de subordinação.",
          "TASK_PARENT_IS_SUBTASK",
        );
      }
      if (parent.status === "CANCELADA") {
        throw new HttpError(409, "Não é possível criar subtarefa em uma tarefa cancelada. Reative a tarefa antes.", "TASK_PARENT_CANCELLED");
      }
    }

    const plannedStartAt = parseOptionalDate(input.plannedStartAt);
    const plannedEndAt = parseOptionalDate(input.plannedEndAt);
    // O planejamento da tarefa pode ser definido depois, nos detalhes; quando informado, vem completo.
    if (plannedStartAt || plannedEndAt) {
      assertRequiredPlannedRange(plannedStartAt, plannedEndAt);
    }

    await assertValidTaskAssignees(deps.repos, projectId, project.ownerId, input.assigneeId, input.secondaryAssigneeId);

    const correctiveMilestoneId = input.correctiveMilestoneId ?? null;
    if (correctiveMilestoneId) {
      const milestone = await loadMilestoneInPhase(deps.repos, phaseId, correctiveMilestoneId);
      if (!CORRECTION_STATUSES.has(milestone.status)) {
        throw new HttpError(
          409,
          "Tarefas corretivas só podem ser vinculadas a marcos com correções necessárias ou rejeitados.",
          "TASK_CORRECTIVE_MILESTONE_INVALID",
        );
      }
    }

    const created = await deps.runInTransaction(async (txRepos) => {
      const [taskMax, milestoneMax] = await Promise.all([
        txRepos.tasks.findMaxSortOrder(phaseId),
        txRepos.milestones.findMaxSortOrder(phaseId),
      ]);
      const task = await txRepos.tasks.create({
        id: crypto.randomUUID(),
        phaseId,
        parentTaskId,
        title: input.title,
        description: input.description ?? null,
        sortOrder: Math.max(taskMax ?? -1, milestoneMax ?? -1) + 1,
        assigneeId: input.assigneeId ?? null,
        secondaryAssigneeId: input.secondaryAssigneeId ?? null,
        status: "NAO_INICIADA",
        progressPercent: 0,
        weight: input.weight ?? 1,
        priority: input.priority ?? "NORMAL",
        plannedStartAt,
        plannedEndAt,
        baselineStartAt: plannedStartAt,
        baselineEndAt: plannedEndAt,
        correctiveMilestoneId,
        createdBy: actor.id,
        updatedBy: actor.id,
      });

      await txRepos.audit.create({
        id: crypto.randomUUID(),
        projectId,
        entityType: "TASK",
        entityId: task.id,
        action: "CREATE",
        summary: parentTaskId ? `Subtarefa "${task.title}" criada.` : `Tarefa "${task.title}" criada.`,
        payload: {
          phaseId,
          parentTaskId,
          assigneeId: task.assigneeId,
          secondaryAssigneeId: task.secondaryAssigneeId,
          weight: task.weight,
          priority: task.priority,
          status: task.status,
          plannedStartAt: task.plannedStartAt?.toISOString() ?? null,
          plannedEndAt: task.plannedEndAt?.toISOString() ?? null,
          baselineStartAt: task.baselineStartAt?.toISOString() ?? null,
          baselineEndAt: task.baselineEndAt?.toISOString() ?? null,
          correctiveMilestoneId,
        },
        actorId: actor.id,
      });

      if (input.extendPhase) {
        await extendPhaseToCover(txRepos, project, actor, {
          phaseId,
          item: { startAt: plannedStartAt, endAt: plannedEndAt },
          itemLabel: `a tarefa "${task.title}"`,
          justification: input.justification?.trim() || null,
        });
      }

      await syncPhaseStatus(txRepos, {
        projectId,
        phaseId,
        actorId: actor.id,
        cause: `Tarefa "${task.title}" criada.`,
      });

      return task;
    });

    return toEapTaskDto(created);
  };
}
