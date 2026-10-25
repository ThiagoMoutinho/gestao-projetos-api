import type { AuthUser } from "../../../lib/session";
import type { UpdateMilestoneInput } from "../dtos/eap-milestones.dto";
import { toEapMilestoneDto } from "../dtos/eap-milestones.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import {
  assertCanEditMilestone,
  assertCanView,
  assertValidMilestoneReviewer,
  loadMilestoneInPhase,
  loadPhaseInProject,
  loadProjectAccess,
  milestoneNotFoundError,
} from "./shared";

export function makeUpdateMilestoneUseCase(deps: {
  repos: EapRepos;
  runInTransaction: EapTransactionRunner;
}) {
  return async function updateMilestone(
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    milestoneId: string,
    input: UpdateMilestoneInput,
  ) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    await loadPhaseInProject(deps.repos, projectId, phaseId);
    const current = await loadMilestoneInPhase(deps.repos, phaseId, milestoneId);
    assertCanEditMilestone(context, current.createdBy);
    await assertValidMilestoneReviewer(deps.repos, context, projectId, input.reviewerId);

    return deps.runInTransaction(async (txRepos) => {
      const updated = await txRepos.milestones.update(milestoneId, phaseId, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.reviewerId !== undefined ? { reviewerId: input.reviewerId } : {}),
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
        action: "UPDATE",
        summary: `Marco "${updated.title}" atualizado.`,
        payload: {
          kind: "STRUCTURE",
          title: input.title,
          description: input.description,
          ...(input.reviewerId !== undefined
            ? { reviewerId: input.reviewerId, previousReviewerId: current.reviewerId }
            : {}),
        },
        actorId: actor.id,
      });

      return toEapMilestoneDto(updated);
    });
  };
}
