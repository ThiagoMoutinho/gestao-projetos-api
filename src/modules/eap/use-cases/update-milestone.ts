import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import type { UpdateMilestoneInput } from "../dtos/eap-milestones.dto";
import { toEapMilestoneDto } from "../dtos/eap-milestones.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import {
  assertCanEditMilestone,
  assertCanView,
  assertValidMilestonePresenter,
  assertValidMilestoneReviewer,
  concludedItemLockedError,
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
    if (current.status === "APROVADO") {
      throw concludedItemLockedError("marco");
    }
    await assertValidMilestoneReviewer(deps.repos, context, projectId, input.reviewerId);
    const nextReviewerId = input.reviewerId !== undefined ? input.reviewerId : current.reviewerId;
    await assertValidMilestonePresenter(deps.repos, context, projectId, input.presenterId, nextReviewerId);
    if (input.reviewerId && input.presenterId === undefined && input.reviewerId === current.presenterId) {
      throw new HttpError(
        400,
        "O gestor validador não pode ser quem apresenta o marco.",
        "MILESTONE_PRESENTER_IS_REVIEWER",
      );
    }

    return deps.runInTransaction(async (txRepos) => {
      const updated = await txRepos.milestones.update(milestoneId, phaseId, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.reviewerId !== undefined ? { reviewerId: input.reviewerId } : {}),
        ...(input.presenterId !== undefined ? { presenterId: input.presenterId } : {}),
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
          ...(input.presenterId !== undefined
            ? { presenterId: input.presenterId, previousPresenterId: current.presenterId }
            : {}),
        },
        actorId: actor.id,
      });

      return toEapMilestoneDto(updated);
    });
  };
}
