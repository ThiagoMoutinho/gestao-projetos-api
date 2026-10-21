import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import type { ReviewMilestoneInput } from "../dtos/eap-milestones.dto";
import { toEapMilestoneDto } from "../dtos/eap-milestones.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import {
  assertCanReviewMilestone,
  assertCanView,
  loadMilestoneInPhase,
  loadPhaseInProject,
  loadProjectAccess,
  milestoneDeliveredByMissingError,
  milestoneNotFoundError,
  milestoneSelfReviewError,
  milestoneTransitionError,
} from "./shared";

export function makeReviewMilestoneUseCase(deps: {
  repos: EapRepos;
  runInTransaction: EapTransactionRunner;
}) {
  return async function reviewMilestone(
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    milestoneId: string,
    input: ReviewMilestoneInput,
  ) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    await loadPhaseInProject(deps.repos, projectId, phaseId);
    const current = await loadMilestoneInPhase(deps.repos, phaseId, milestoneId);
    assertCanReviewMilestone(context);

    if (current.type === "ENTREGA" && current.status !== "ENTREGUE") {
      throw milestoneTransitionError();
    }

    if (
      current.type === "APROVACAO" &&
      current.status !== "PENDENTE" &&
      current.status !== "REJEITADO"
    ) {
      throw milestoneTransitionError();
    }

    if (current.type === "ENTREGA" && current.status === "ENTREGUE" && !current.deliveredBy) {
      throw milestoneDeliveredByMissingError();
    }

    if (current.deliveredBy && current.deliveredBy === actor.id) {
      throw milestoneSelfReviewError();
    }

    const validationNote = input.note?.trim() ? input.note.trim() : null;

    if (input.decision === "REJEITADO" && (!validationNote || validationNote.length < 10)) {
      throw new HttpError(
        400,
        "A rejeição exige justificativa com ao menos 10 caracteres.",
        "MILESTONE_REJECTION_NOTE_REQUIRED",
      );
    }

    return deps.runInTransaction(async (txRepos) => {
      const updated = await txRepos.milestones.update(milestoneId, phaseId, {
        status: input.decision,
        validatedBy: actor.id,
        validationNote,
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
        action: "VALIDATE",
        summary: `Marco "${updated.title}" ${input.decision === "APROVADO" ? "aprovado" : "rejeitado"}.`,
        payload: {
          kind: "REVIEW",
          from: current.status,
          to: input.decision,
          note: validationNote,
          deliveredBy: current.deliveredBy,
        },
        actorId: actor.id,
      });

      return toEapMilestoneDto(updated);
    });
  };
}
