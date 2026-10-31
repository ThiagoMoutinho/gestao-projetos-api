import type { AuthUser } from "../../../lib/session";
import type { UpdateTaskInput } from "../dtos/eap-tasks.dto";
import { toEapTaskDto } from "../dtos/eap-tasks.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import { calculatedTaskStatus } from "./eap-status";
import {
  assertCanEditTask,
  assertCanView,
  assertValidAssignee,
  concludedItemLockedError,
  loadPhaseInProject,
  loadProjectAccess,
  loadTaskInPhase,
  taskNotFoundError,
} from "./shared";

const PRIORITY_LABELS = { CRITICA: "Crítica", ALTA: "Alta", NORMAL: "Normal", BAIXA: "Baixa" } as const;

export function makeUpdateTaskUseCase(deps: {
  repos: EapRepos;
  runInTransaction: EapTransactionRunner;
}) {
  return async function updateTask(
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    taskId: string,
    input: UpdateTaskInput,
  ) {
    const { project, context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    await loadPhaseInProject(deps.repos, projectId, phaseId);
    const current = await loadTaskInPhase(deps.repos, phaseId, taskId);
    assertCanEditTask(context, current.createdBy);
    // Tarefa concluída só volta a ser editável depois de reaberta (andamento abaixo de 100%, com justificativa).
    if (calculatedTaskStatus(current) === "CONCLUIDA") {
      throw concludedItemLockedError("tarefa");
    }

    if (input.assigneeId !== undefined) {
      await assertValidAssignee(deps.repos, projectId, project.ownerId, input.assigneeId);
    }

    const priorityChanged = input.priority !== undefined && input.priority !== current.priority;

    return deps.runInTransaction(async (txRepos) => {
      const updated = await txRepos.tasks.update(taskId, phaseId, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        ...(input.weight !== undefined ? { weight: input.weight } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        updatedBy: actor.id,
        updatedAt: new Date(),
      });

      if (!updated) {
        throw taskNotFoundError();
      }

      await txRepos.audit.create({
        id: crypto.randomUUID(),
        projectId,
        entityType: "TASK",
        entityId: updated.id,
        action: "UPDATE",
        summary: priorityChanged
          ? `Prioridade da tarefa "${updated.title}" alterada de ${PRIORITY_LABELS[current.priority]} para ${PRIORITY_LABELS[updated.priority]}.`
          : `Tarefa "${updated.title}" atualizada.`,
        payload: {
          kind: "STRUCTURE",
          title: input.title,
          description: input.description,
          assigneeId: input.assigneeId,
          weight: input.weight,
          priority: priorityChanged ? updated.priority : undefined,
          previousPriority: priorityChanged ? current.priority : undefined,
        },
        actorId: actor.id,
      });

      return toEapTaskDto(updated);
    });
  };
}
