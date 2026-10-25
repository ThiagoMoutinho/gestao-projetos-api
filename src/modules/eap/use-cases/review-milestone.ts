import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import type { EapMilestoneDeliveryRow } from "../dtos/eap-milestone-deliveries.dto";
import type { EapMilestoneRow, ReviewMilestoneInput } from "../dtos/eap-milestones.dto";
import { toEapMilestoneDto } from "../dtos/eap-milestones.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import { syncPhaseStatus } from "./phase-rollup";
import {
  assertCanHomologateMilestone,
  assertCanView,
  loadMilestoneInPhase,
  loadPhaseInProject,
  loadProjectAccess,
  milestoneDeliveredByMissingError,
  milestoneNotFoundError,
  milestoneSelfReviewError,
  milestoneTransitionError,
  usesDeliveryRounds,
} from "./shared";

const DELIVERY_STATUS = {
  APROVADO: "ACEITA",
  AJUSTES_SOLICITADOS: "AJUSTES_SOLICITADOS",
  REJEITADO: "REJEITADA",
} as const;

const DECISION_TEXT = {
  APROVADO: "aceito",
  AJUSTES_SOLICITADOS: "devolvido com correções necessárias",
  REJEITADO: "rejeitado",
} as const;

function textOrNull(value: string | null | undefined) {
  return value?.trim() ? value.trim() : null;
}

/**
 * Decisão do homologador sobre a rodada em análise. Entrega anterior ao controle de rodadas ganha,
 * no momento da decisão, uma rodada marcada como legado com os dados já gravados no marco.
 * Somente o aceite leva o marco a 100% e, em homologação e aprovação, grava a data efetiva.
 * Nenhuma decisão altera prazos ou linha de base; evidências da decisão já nascem travadas na rodada.
 */
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
    assertCanHomologateMilestone(context, current);

    const note = textOrNull(input.note);
    const approved = input.decision === "APROVADO";
    const nonconformities = approved ? null : textOrNull(input.nonconformities);
    const adjustments = approved ? null : textOrNull(input.adjustments);
    const evidences = input.evidences ?? [];

    if (current.type === "APROVACAO") {
      if (input.decision === "AJUSTES_SOLICITADOS") {
        throw new HttpError(
          400,
          "Marcos de aprovação admitem somente aceite ou rejeição.",
          "MILESTONE_DECISION_INVALID",
        );
      }
      if (current.status !== "PENDENTE" && current.status !== "REJEITADO") {
        throw milestoneTransitionError();
      }
    } else {
      if (current.status !== "ENTREGUE") {
        throw milestoneTransitionError();
      }
      if (!current.deliveredBy) {
        throw milestoneDeliveredByMissingError();
      }
    }

    if (input.decision !== "APROVADO" && (!note || note.length < 10)) {
      throw new HttpError(
        400,
        input.decision === "REJEITADO"
          ? "A rejeição exige justificativa com ao menos 10 caracteres."
          : "A solicitação de correções exige justificativa com ao menos 10 caracteres.",
        input.decision === "REJEITADO"
          ? "MILESTONE_REJECTION_NOTE_REQUIRED"
          : "MILESTONE_ADJUSTMENTS_NOTE_REQUIRED",
      );
    }

    return deps.runInTransaction(async (txRepos) => {
      const decidedAt = new Date();
      let delivery: EapMilestoneDeliveryRow | null = null;
      let linkedEvidenceIds: string[] = [];

      if (usesDeliveryRounds(current.type)) {
        const opened = await openRound(txRepos, current);
        if (opened.round.submittedBy === actor.id || current.deliveredBy === actor.id) {
          throw milestoneSelfReviewError();
        }
        linkedEvidenceIds = opened.linkedEvidenceIds;
        delivery = await txRepos.deliveries.decide(opened.round.id, {
          status: DELIVERY_STATUS[input.decision],
          decidedBy: actor.id,
          decidedAt,
          decisionNote: note,
          nonconformities,
          adjustments,
        });
        if (!delivery) {
          throw milestoneTransitionError();
        }
      }

      const decisionEvidenceIds: string[] = [];
      for (const evidence of evidences) {
        const created = await txRepos.evidences.create({
          id: crypto.randomUUID(),
          phaseId: null,
          taskId: null,
          milestoneId,
          scheduleRequestId: null,
          deliveryId: delivery?.id ?? null,
          title: evidence.title.trim(),
          url: evidence.url.trim(),
          createdBy: actor.id,
        });
        decisionEvidenceIds.push(created.id);
      }

      const updated = await txRepos.milestones.update(milestoneId, phaseId, {
        status: input.decision,
        validatedBy: actor.id,
        validationNote: note,
        validatedAt: decidedAt,
        ...(approved && current.type !== "ENTREGA" ? { actualAt: decidedAt } : {}),
        updatedBy: actor.id,
        updatedAt: decidedAt,
      });

      if (!updated) {
        throw milestoneNotFoundError();
      }

      const summary = delivery
        ? `Entrega ${delivery.round} do marco "${updated.title}": ${DECISION_TEXT[input.decision]}.`
        : `Marco "${updated.title}" ${DECISION_TEXT[input.decision]}.`;

      await txRepos.audit.create({
        id: crypto.randomUUID(),
        projectId,
        entityType: "MILESTONE",
        entityId: updated.id,
        action: "VALIDATE",
        summary,
        payload: {
          kind: "REVIEW",
          from: current.status,
          to: input.decision,
          note,
          nonconformities,
          adjustments,
          deliveryId: delivery?.id ?? null,
          round: delivery?.round ?? null,
          legacyRound: delivery?.legacy ?? false,
          linkedEvidenceIds,
          decisionEvidenceIds,
          ...(approved && current.type !== "ENTREGA"
            ? { actualAt: decidedAt.toISOString() }
            : {}),
          deliveredBy: current.deliveredBy,
          validatedAt: decidedAt.toISOString(),
          ...(input.decision === "REJEITADO" ? { escalatedToPmo: true } : {}),
        },
        actorId: actor.id,
      });

      await syncPhaseStatus(txRepos, {
        projectId,
        phaseId,
        actorId: actor.id,
        cause: summary,
      });

      return toEapMilestoneDto(updated);
    });
  };
}

/** Rodada em análise; sem ela, a entrega é anterior ao controle e a rodada nasce como legado. */
async function openRound(repos: EapRepos, milestone: EapMilestoneRow) {
  const latest = await repos.deliveries.findLatest(milestone.id);
  if (latest?.status === "EM_ANALISE") {
    return { round: latest, linkedEvidenceIds: [] as string[] };
  }

  const round = await repos.deliveries.create({
    id: crypto.randomUUID(),
    milestoneId: milestone.id,
    round: (latest?.round ?? 0) + 1,
    legacy: true,
    submittedBy: milestone.deliveredBy as string,
    submittedAt: milestone.actualAt,
    note: null,
  });
  const linkedEvidenceIds = milestone.actualAt
    ? await repos.evidences.linkToDelivery(milestone.id, round.id, milestone.actualAt)
    : [];

  return { round, linkedEvidenceIds };
}
