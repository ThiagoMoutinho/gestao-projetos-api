import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import type { TaskStatusDecisionInput } from "../dtos/eap-tasks.dto";
import { toEapTaskDto } from "../dtos/eap-tasks.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import { syncPhaseStatus } from "./phase-rollup";
import {
  assertCanDecideTaskStatus,
  assertCanView,
  loadPhaseInProject,
  loadProjectAccess,
  taskNotFoundError,
} from "./shared";

export function makeCancelTaskUseCase(deps: {
  repos: EapRepos;
  runInTransaction: EapTransactionRunner;
}) {
  return async function cancelTask(
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

      if (current.status === "CANCELADA") {
        throw new HttpError(409, "Esta tarefa já está cancelada.", "TASK_ALREADY_CANCELLED");
      }
      if (current.status === "CONCLUIDA" || current.progressPercent === 100) {
        throw new HttpError(
          409,
          "Não é possível cancelar uma tarefa concluída. A conclusão faz parte do histórico de execução do projeto.",
          "TASK_CANCEL_CONCLUDED",
        );
      }

      const updated = await txRepos.tasks.update(taskId, phaseId, {
        status: "CANCELADA",
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
        summary: `Tarefa "${updated.title}" cancelada.`,
        payload: {
          automatic: false,
          from: current.status,
          to: "CANCELADA",
          justification: input.justification,
        },
        actorId: actor.id,
      });

      await syncPhaseStatus(txRepos, {
        projectId,
        phaseId,
        actorId: actor.id,
        cause: `Tarefa "${updated.title}" cancelada.`,
      });

      return toEapTaskDto(updated);
    });
  };
}
