import type { AuthUser } from "../../../lib/session";
import type { UpdateTaskInput } from "../dtos/eap-tasks.dto";
import { toEapTaskDto } from "../dtos/eap-tasks.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import {
  assertCanEditTask,
  assertCanView,
  assertValidAssignee,
  loadPhaseInProject,
  loadProjectAccess,
  loadTaskInPhase,
  taskNotFoundError,
} from "./shared";

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

    if (input.assigneeId !== undefined) {
      await assertValidAssignee(deps.repos, projectId, project.ownerId, input.assigneeId);
    }

    return deps.runInTransaction(async (txRepos) => {
      const updated = await txRepos.tasks.update(taskId, phaseId, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        ...(input.weight !== undefined ? { weight: input.weight } : {}),
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
        summary: `Tarefa "${updated.title}" atualizada.`,
        payload: {
          kind: "STRUCTURE",
          title: input.title,
          description: input.description,
          assigneeId: input.assigneeId,
          weight: input.weight,
        },
        actorId: actor.id,
      });

      return toEapTaskDto(updated);
    });
  };
}
