import type { AuthUser } from "../../../lib/session";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import {
  assertCanDeleteItem,
  assertCanView,
  deleteBlockedError,
  loadPhaseInProject,
  loadProjectAccess,
  phaseNotFoundError,
} from "./shared";

export function makeDeletePhaseUseCase(deps: {
  repos: EapRepos;
  runInTransaction: EapTransactionRunner;
}) {
  return async function deletePhase(actor: AuthUser, projectId: string, phaseId: string) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    assertCanDeleteItem(context);

    await loadPhaseInProject(deps.repos, projectId, phaseId);

    await deps.runInTransaction(async (txRepos) => {
      const phase = await txRepos.phases.findByIdAndProject(phaseId, projectId);
      if (!phase) {
        throw phaseNotFoundError();
      }

      const tasks = await txRepos.tasks.listByPhase(phaseId);
      const milestones = await txRepos.milestones.listByPhase(phaseId);
      if (tasks.length > 0 || milestones.length > 0) {
        throw deleteBlockedError(
          "Não é possível excluir esta fase porque existem tarefas ou marcos vinculados. Mova ou trate os itens subordinados antes de continuar.",
          "PHASE_DELETE_HAS_CHILDREN",
        );
      }

      const evidences = await txRepos.evidences.listByProject(projectId, { phaseId });
      const scheduleRequests = await txRepos.scheduleRequests.countByTarget({ phaseId });
      if (evidences.length > 0 || scheduleRequests > 0) {
        throw deleteBlockedError(
          "Não é possível excluir esta fase porque ela possui evidências ou replanejamentos registrados. Esses registros fazem parte do histórico do projeto.",
          "PHASE_DELETE_HAS_HISTORY",
        );
      }

      const deleted = await txRepos.phases.delete(phaseId, projectId);
      if (!deleted) {
        throw phaseNotFoundError();
      }

      await txRepos.audit.create({
        id: crypto.randomUUID(),
        projectId,
        entityType: "PHASE",
        entityId: phase.id,
        action: "DELETE",
        summary: `Fase "${phase.name}" excluída.`,
        payload: {
          name: phase.name,
          status: phase.status,
          sortOrder: phase.sortOrder,
          responsibleId: phase.responsibleId,
          baselineStartAt: phase.baselineStartAt,
          baselineEndAt: phase.baselineEndAt,
          plannedStartAt: phase.plannedStartAt,
          plannedEndAt: phase.plannedEndAt,
          createdBy: phase.createdBy,
        },
        actorId: actor.id,
      });
    });
  };
}
