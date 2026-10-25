import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import type { TaskStatusDecisionInput } from "../dtos/eap-tasks.dto";
import { toEapTaskDto } from "../dtos/eap-tasks.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import { deriveTaskStatus } from "./eap-status";
import { syncPhaseStatus } from "./phase-rollup";
import {
  assertCanDecideTaskStatus,
  assertCanView,
  loadPhaseInProject,
  loadProjectAccess,
  taskNotFoundError,
} from "./shared";

export function makeReactivateTaskUseCase(deps: {
  repos: EapRepos;
  runInTransaction: EapTransactionRunner;
}) {
  return async function reactivateTask(
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    taskId: string,
    input: TaskStatusDecisionInput,
  ) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    assertCanDecideTaskStatus(context);
    await loadPhaseInProject(deps.repos, projectId, phaseId);

    return deps.runInTransaction(async (txRepos) => {
      const current = await txRepos.tasks.findByIdAndPhase(taskId, phaseId);
      if (!current) {
        throw taskNotFoundError();
      }

      if (current.status !== "CANCELADA") {
        throw new HttpError(
          409,
          "Somente tarefas canceladas podem ser reativadas.",
          "TASK_NOT_CANCELLED",
        );
      }

      const status = deriveTaskStatus(current.progressPercent);
      const updated = await txRepos.tasks.update(taskId, phaseId, {
        status,
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
        action: "STATUS_CHANGE",
        summary: `Tarefa "${updated.title}" reativada.`,
        payload: {
          automatic: false,
          from: "CANCELADA",
          to: status,
          justification: input.justification,
        },
        actorId: actor.id,
      });

      await syncPhaseStatus(txRepos, {
        projectId,
        phaseId,
        actorId: actor.id,
        cause: `Tarefa "${updated.title}" reativada.`,
      });

      return toEapTaskDto(updated);
    });
  };
}
