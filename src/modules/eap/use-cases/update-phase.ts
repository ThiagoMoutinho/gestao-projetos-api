import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import type { UpdatePhaseInput } from "../dtos/eap-phases.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import { civilDayKey } from "./eap-status";
import { presentPhase, syncPhaseStatus } from "./phase-rollup";
import {
  assertActualDateNotFuture,
  assertActualDates,
  assertCanEditPhase,
  assertCanRescheduleEap,
  assertCanSuspendPhase,
  assertCanView,
  assertValidAssignee,
  concludedItemLockedError,
  loadProjectAccess,
  normalizeJustification,
  normalizeOptionalText,
  parseOptionalDate,
  phaseNotFoundError,
} from "./shared";

export function makeUpdatePhaseUseCase(deps: {
  repos: EapRepos;
  runInTransaction: EapTransactionRunner;
}) {
  return async function updatePhase(
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    input: UpdatePhaseInput,
  ) {
    const { project, context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);

    const current = await deps.repos.phases.findByIdAndProject(phaseId, projectId);
    if (!current) {
      throw phaseNotFoundError();
    }
    assertCanEditPhase(context, current.createdBy);
    if (input.suspended !== undefined) {
      assertCanSuspendPhase(context);
    }
    const justification = normalizeJustification(input.justification);
    const suspending = input.suspended === true && current.status !== "SUSPENSA";
    if (suspending && (!justification || justification.length < 10)) {
      throw new HttpError(
        400,
        "Suspender a fase exige justificativa com ao menos 10 caracteres.",
        "PHASE_SUSPEND_JUSTIFICATION_REQUIRED",
      );
    }

    if (input.responsibleId !== undefined) {
      await assertValidAssignee(
        deps.repos,
        projectId,
        project.ownerId,
        input.responsibleId,
        "PHASE_RESPONSIBLE_NOT_MEMBER",
      );
    }
    // Correção explícita das datas reais registradas: autorizada, justificada e auditada.
    const informedStart =
      input.actualStartAt !== undefined ? parseOptionalDate(input.actualStartAt) : undefined;
    const informedEnd =
      input.actualEndAt !== undefined ? parseOptionalDate(input.actualEndAt) : undefined;
    const actualStartAt = informedStart !== undefined ? informedStart : current.actualStartAt;
    const actualEndAt = informedEnd !== undefined ? informedEnd : current.actualEndAt;
    const changedActualDates = (["actualStartAt", "actualEndAt"] as const).filter((field) => {
      const next = field === "actualStartAt" ? actualStartAt : actualEndAt;
      const previous = current[field];
      return (next === null) !== (previous === null) || (next !== null && previous !== null && civilDayKey(next) !== civilDayKey(previous));
    });
    if (changedActualDates.length > 0) {
      assertCanRescheduleEap(context);
      if (!justification || justification.length < 10) {
        throw new HttpError(
          400,
          "Corrigir as datas reais da fase exige justificativa com ao menos 10 caracteres.",
          "ACTUAL_DATE_CORRECTION_JUSTIFICATION_REQUIRED",
        );
      }
      assertActualDateNotFuture(actualStartAt);
      assertActualDateNotFuture(actualEndAt);
      assertActualDates(actualStartAt, actualEndAt);
      if (actualEndAt && current.status !== "CONCLUIDA") {
        throw new HttpError(
          400,
          "O término real só pode ser registrado em fase concluída.",
          "PHASE_ACTUAL_END_REQUIRES_CONCLUSION",
        );
      }
    }

    const completionCriteria = normalizeOptionalText(input.completionCriteria);
    const hasFieldChanges =
      input.name !== undefined ||
      input.description !== undefined ||
      input.responsibleId !== undefined ||
      completionCriteria !== undefined;
    // Fase concluída fica somente leitura; volta a ser editável quando algum item reabre a execução.
    if (current.status === "CONCLUIDA" && (hasFieldChanges || suspending)) {
      throw concludedItemLockedError("fase");
    }

    return deps.runInTransaction(async (txRepos) => {
      let updated = current;

      if (hasFieldChanges) {
        const changed = await txRepos.phases.update(phaseId, projectId, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.responsibleId !== undefined ? { responsibleId: input.responsibleId } : {}),
          ...(completionCriteria !== undefined ? { completionCriteria } : {}),
          updatedBy: actor.id,
          updatedAt: new Date(),
        });
        if (!changed) {
          throw phaseNotFoundError();
        }
        updated = changed;

        await txRepos.audit.create({
          id: crypto.randomUUID(),
          projectId,
          entityType: "PHASE",
          entityId: updated.id,
          action: "UPDATE",
          summary: `Fase "${updated.name}" atualizada.`,
          payload: {
            name: input.name,
            description: input.description,
            responsibleId: input.responsibleId,
            completionCriteria,
          },
          actorId: actor.id,
        });
      }

      if (changedActualDates.length > 0) {
        const corrected = await txRepos.phases.update(phaseId, projectId, {
          actualStartAt,
          actualEndAt,
          updatedBy: actor.id,
          updatedAt: new Date(),
        });
        if (!corrected) {
          throw phaseNotFoundError();
        }

        await txRepos.audit.create({
          id: crypto.randomUUID(),
          projectId,
          entityType: "PHASE",
          entityId: updated.id,
          action: "UPDATE",
          summary: `Datas reais da fase "${updated.name}" corrigidas.`,
          payload: {
            automatic: false,
            kind: "ACTUAL_DATES_CORRECTION",
            justification,
            dates: Object.fromEntries(
              changedActualDates.map((field) => [
                field,
                { previous: updated[field]?.toISOString() ?? null, next: corrected[field]?.toISOString() ?? null },
              ]),
            ),
          },
          actorId: actor.id,
        });
        updated = corrected;
      }

      if (input.suspended === true && updated.status !== "SUSPENSA") {
        const suspended = await txRepos.phases.update(phaseId, projectId, {
          status: "SUSPENSA",
          updatedBy: actor.id,
          updatedAt: new Date(),
        });
        if (!suspended) {
          throw phaseNotFoundError();
        }

        await txRepos.audit.create({
          id: crypto.randomUUID(),
          projectId,
          entityType: "PHASE",
          entityId: updated.id,
          action: "STATUS_CHANGE",
          summary: `Fase "${updated.name}" suspensa.`,
          payload: { automatic: false, from: updated.status, to: "SUSPENSA", justification },
          actorId: actor.id,
        });
        updated = suspended;
      }

      if (input.suspended === false && updated.status === "SUSPENSA") {
        const resumed = await syncPhaseStatus(txRepos, {
          projectId,
          phaseId,
          actorId: actor.id,
          cause: "Fase retomada pela gestão.",
          resume: true,
        });
        if (!resumed) {
          throw phaseNotFoundError();
        }
        updated = resumed;
      }

      return presentPhase(txRepos, updated);
    });
  };
}
