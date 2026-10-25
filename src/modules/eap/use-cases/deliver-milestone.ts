import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import type { DeliverMilestoneInput } from "../dtos/eap-milestone-deliveries.dto";
import { toEapMilestoneDto } from "../dtos/eap-milestones.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import { syncPhaseStatus } from "./phase-rollup";
import {
  assertCanDeliverMilestone,
  assertCanView,
  loadMilestoneInPhase,
  loadPhaseInProject,
  loadProjectAccess,
  milestoneNotFoundError,
  milestoneResubmissionNotAuthorizedError,
  milestoneTransitionError,
  usesDeliveryRounds,
} from "./shared";

const DELIVERABLE_STATUSES = new Set(["PENDENTE", "AJUSTES_SOLICITADOS", "REJEITADO"]);

/**
 * Cada envio abre uma nova rodada de homologação e vincula a ela as evidências ainda sem rodada.
 * Após rejeição, o reenvio exige autorização registrada na rodada rejeitada. Prazos não são alterados.
 * No marco de homologação, a data efetiva só é gravada no aceite.
 */
export function makeDeliverMilestoneUseCase(deps: {
  repos: EapRepos;
  runInTransaction: EapTransactionRunner;
}) {
  return async function deliverMilestone(
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    milestoneId: string,
    input: DeliverMilestoneInput = {},
  ) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    await loadPhaseInProject(deps.repos, projectId, phaseId);
    const current = await loadMilestoneInPhase(deps.repos, phaseId, milestoneId);
    assertCanDeliverMilestone(context, current);

    if (!usesDeliveryRounds(current.type)) {
      throw new HttpError(
        409,
        "Somente marcos de entrega ou de homologação podem ter entrega registrada.",
        "MILESTONE_DELIVER_TYPE_INVALID",
      );
    }

    if (!DELIVERABLE_STATUSES.has(current.status)) {
      throw milestoneTransitionError();
    }

    const note = input.note?.trim() ? input.note.trim() : null;

    return deps.runInTransaction(async (txRepos) => {
      const latest = await txRepos.deliveries.findLatest(milestoneId);

      if (current.status === "REJEITADO" && latest && !latest.resubmissionAuthorizedAt) {
        throw milestoneResubmissionNotAuthorizedError();
      }

      const submittedAt = new Date();
      const delivery = await txRepos.deliveries.create({
        id: crypto.randomUUID(),
        milestoneId,
        round: (latest?.round ?? 0) + 1,
        legacy: false,
        submittedBy: actor.id,
        submittedAt,
        note,
      });
      const evidenceIds = await txRepos.evidences.linkToDelivery(milestoneId, delivery.id);

      const updated = await txRepos.milestones.update(milestoneId, phaseId, {
        status: "ENTREGUE",
        actualAt: current.type === "HOMOLOGACAO" ? null : submittedAt,
        deliveredBy: actor.id,
        validatedBy: null,
        validationNote: null,
        validatedAt: null,
        updatedBy: actor.id,
        updatedAt: submittedAt,
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
        summary: `Entrega ${delivery.round} do marco "${updated.title}" registrada.`,
        payload: {
          kind: "DELIVER",
          from: current.status,
          to: "ENTREGUE",
          deliveryId: delivery.id,
          round: delivery.round,
          note,
          evidenceIds,
          deliveredBy: actor.id,
          submittedAt: submittedAt.toISOString(),
        },
        actorId: actor.id,
      });

      await syncPhaseStatus(txRepos, {
        projectId,
        phaseId,
        actorId: actor.id,
        cause: `Entrega ${delivery.round} do marco "${updated.title}" registrada.`,
      });

      return toEapMilestoneDto(updated);
    });
  };
}
