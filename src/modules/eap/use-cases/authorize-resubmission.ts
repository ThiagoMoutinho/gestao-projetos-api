import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import type { AuthorizeResubmissionInput } from "../dtos/eap-milestone-deliveries.dto";
import { toEapMilestoneDto } from "../dtos/eap-milestones.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import {
  assertCanAuthorizeResubmission,
  assertCanView,
  loadMilestoneInPhase,
  loadPhaseInProject,
  loadProjectAccess,
  usesDeliveryRounds,
} from "./shared";

const resubmissionInvalidError = () =>
  new HttpError(
    409,
    "Somente a última entrega rejeitada, ainda sem autorização, pode receber autorização de nova submissão.",
    "MILESTONE_RESUBMISSION_INVALID",
  );

/** Autoriza nova submissão após rejeição. A situação do marco continua "Rejeitado" até o reenvio. */
export function makeAuthorizeResubmissionUseCase(deps: {
  repos: EapRepos;
  runInTransaction: EapTransactionRunner;
}) {
  return async function authorizeResubmission(
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    milestoneId: string,
    input: AuthorizeResubmissionInput,
  ) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    await loadPhaseInProject(deps.repos, projectId, phaseId);
    const milestone = await loadMilestoneInPhase(deps.repos, phaseId, milestoneId);
    assertCanAuthorizeResubmission(context);

    const justification = input.justification.trim();
    if (justification.length < 10) {
      throw new HttpError(
        400,
        "A autorização exige justificativa com ao menos 10 caracteres.",
        "MILESTONE_RESUBMISSION_NOTE_REQUIRED",
      );
    }

    if (!usesDeliveryRounds(milestone.type) || milestone.status !== "REJEITADO") {
      throw resubmissionInvalidError();
    }

    return deps.runInTransaction(async (txRepos) => {
      const latest = await txRepos.deliveries.findLatest(milestoneId);
      if (!latest) {
        throw resubmissionInvalidError();
      }

      const authorizedAt = new Date();
      const delivery = await txRepos.deliveries.authorizeResubmission(latest.id, {
        resubmissionAuthorizedBy: actor.id,
        resubmissionAuthorizedAt: authorizedAt,
        resubmissionNote: justification,
      });
      if (!delivery) {
        throw resubmissionInvalidError();
      }

      await txRepos.audit.create({
        id: crypto.randomUUID(),
        projectId,
        entityType: "MILESTONE",
        entityId: milestone.id,
        action: "UPDATE",
        summary: `Nova submissão do marco "${milestone.title}" autorizada após a entrega ${delivery.round}.`,
        payload: {
          kind: "AUTHORIZE_RESUBMISSION",
          deliveryId: delivery.id,
          round: delivery.round,
          justification,
          authorizedAt: authorizedAt.toISOString(),
        },
        actorId: actor.id,
      });

      return toEapMilestoneDto(milestone);
    });
  };
}
