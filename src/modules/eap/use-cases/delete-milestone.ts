import type { AuthUser } from "../../../lib/session";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import { syncPhaseStatus } from "./phase-rollup";
import {
  assertCanDeleteItem,
  assertCanView,
  deleteBlockedError,
  loadPhaseInProject,
  loadProjectAccess,
  milestoneNotFoundError,
} from "./shared";

export function makeDeleteMilestoneUseCase(deps: {
  repos: EapRepos;
  runInTransaction: EapTransactionRunner;
}) {
  return async function deleteMilestone(
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    milestoneId: string,
  ) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    assertCanDeleteItem(context);

    await loadPhaseInProject(deps.repos, projectId, phaseId);

    await deps.runInTransaction(async (txRepos) => {
      const milestone = await txRepos.milestones.findByIdAndPhase(milestoneId, phaseId);
      if (!milestone) {
        throw milestoneNotFoundError();
      }

      if (milestone.status !== "PENDENTE") {
        throw deleteBlockedError(
          "Não é possível excluir um marco já entregue ou homologado. A entrega e a decisão formal fazem parte do histórico do projeto.",
          "MILESTONE_DELETE_FORMALIZED",
        );
      }

      const evidences = await txRepos.evidences.listByProject(projectId, { milestoneId });
      const scheduleRequests = await txRepos.scheduleRequests.countByTarget({ milestoneId });
      if (evidences.length > 0 || scheduleRequests > 0) {
        throw deleteBlockedError(
          "Não é possível excluir este marco porque ele possui evidências ou replanejamentos registrados. Esses registros fazem parte do histórico do projeto.",
          "MILESTONE_DELETE_HAS_HISTORY",
        );
      }

      const deleted = await txRepos.milestones.delete(milestoneId, phaseId);
      if (!deleted) {
        throw milestoneNotFoundError();
      }

      await txRepos.audit.create({
        id: crypto.randomUUID(),
        projectId,
        entityType: "MILESTONE",
        entityId: milestone.id,
        action: "DELETE",
        summary: `Marco "${milestone.title}" excluído.`,
        payload: {
          phaseId,
          title: milestone.title,
          type: milestone.type,
          status: milestone.status,
          baselineAt: milestone.baselineAt,
          plannedAt: milestone.plannedAt,
          createdBy: milestone.createdBy,
        },
        actorId: actor.id,
      });

      await syncPhaseStatus(txRepos, {
        projectId,
        phaseId,
        actorId: actor.id,
        cause: `Marco "${milestone.title}" excluído.`,
      });
    });
  };
}
