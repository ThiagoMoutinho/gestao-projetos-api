import type { AuthUser } from "../../../lib/session";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import { syncPhaseStatus } from "./phase-rollup";
import {
  assertCanDeleteItem,
  assertCanView,
  deleteBlockedError,
  loadPhaseInProject,
  loadProjectAccess,
  taskNotFoundError,
} from "./shared";

export function makeDeleteTaskUseCase(deps: {
  repos: EapRepos;
  runInTransaction: EapTransactionRunner;
}) {
  return async function deleteTask(
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    taskId: string,
  ) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    assertCanDeleteItem(context);

    await loadPhaseInProject(deps.repos, projectId, phaseId);

    await deps.runInTransaction(async (txRepos) => {
      const task = await txRepos.tasks.findByIdAndPhase(taskId, phaseId);
      if (!task) {
        throw taskNotFoundError();
      }

      if (task.status === "CONCLUIDA") {
        throw deleteBlockedError(
          "Não é possível excluir uma tarefa concluída. A conclusão faz parte do histórico de execução do projeto.",
          "TASK_DELETE_CONCLUDED",
        );
      }

      const evidences = await txRepos.evidences.listByProject(projectId, { taskId });
      const impediments = await txRepos.tasks.countImpediments(taskId);
      const scheduleRequests = await txRepos.scheduleRequests.countByTarget({ taskId });
      if (evidences.length > 0 || impediments > 0 || scheduleRequests > 0) {
        throw deleteBlockedError(
          "Não é possível excluir esta tarefa porque ela possui evidências, impedimentos ou replanejamentos registrados. Se ela não será mais executada, use a ação Cancelar tarefa.",
          "TASK_DELETE_HAS_HISTORY",
        );
      }

      const deleted = await txRepos.tasks.delete(taskId, phaseId);
      if (!deleted) {
        throw taskNotFoundError();
      }

      await txRepos.audit.create({
        id: crypto.randomUUID(),
        projectId,
        entityType: "TASK",
        entityId: task.id,
        action: "DELETE",
        summary: `Tarefa "${task.title}" excluída.`,
        payload: {
          phaseId,
          title: task.title,
          status: task.status,
          progressPercent: task.progressPercent,
          assigneeId: task.assigneeId,
          baselineStartAt: task.baselineStartAt,
          baselineEndAt: task.baselineEndAt,
          plannedStartAt: task.plannedStartAt,
          plannedEndAt: task.plannedEndAt,
          createdBy: task.createdBy,
        },
        actorId: actor.id,
      });

      await syncPhaseStatus(txRepos, {
        projectId,
        phaseId,
        actorId: actor.id,
        cause: `Tarefa "${task.title}" excluída.`,
      });
    });
  };
}
