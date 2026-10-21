import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { toEapMilestoneDto } from "../dtos/eap-milestones.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import {
  assertCanDeliverMilestone,
  assertCanView,
  loadMilestoneInPhase,
  loadPhaseInProject,
  loadProjectAccess,
  milestoneNotFoundError,
  milestoneTransitionError,
} from "./shared";

export function makeDeliverMilestoneUseCase(deps: {
  repos: EapRepos;
  runInTransaction: EapTransactionRunner;
}) {
  return async function deliverMilestone(
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    milestoneId: string,
  ) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    await loadPhaseInProject(deps.repos, projectId, phaseId);
    const current = await loadMilestoneInPhase(deps.repos, phaseId, milestoneId);
    assertCanDeliverMilestone(context);

    if (current.type !== "ENTREGA") {
      throw new HttpError(
        409,
        "Somente marcos do tipo ENTREGA podem ter entrega registrada.",
        "MILESTONE_DELIVER_TYPE_INVALID",
      );
    }

    if (current.status !== "PENDENTE" && current.status !== "REJEITADO") {
      throw milestoneTransitionError();
    }

    return deps.runInTransaction(async (txRepos) => {
      const updated = await txRepos.milestones.update(milestoneId, phaseId, {
        status: "ENTREGUE",
        actualAt: new Date(),
        deliveredBy: actor.id,
        validatedBy: null,
        validationNote: null,
        updatedBy: actor.id,
        updatedAt: new Date(),
      });

      if (!updated) {
        throw milestoneNotFoundError();
      }

      await txRepos.audit.create({
        id: crypto.randomUUID(),
        projectId,
        entityType: "MILESTONE",
        entityId: updated.id,
        action: "STATUS_CHANGE",
        summary: `Entrega do marco "${updated.title}" registrada.`,
        payload: {
          kind: "DELIVER",
          from: current.status,
          to: "ENTREGUE",
          deliveredBy: actor.id,
          actualAt: updated.actualAt?.toISOString() ?? null,
        },
        actorId: actor.id,
      });

      return toEapMilestoneDto(updated);
    });
  };
}
