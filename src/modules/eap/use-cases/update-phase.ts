import type { AuthUser } from "../../../lib/session";
import type { UpdatePhaseInput } from "../dtos/eap-phases.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import { presentPhase, syncPhaseStatus } from "./phase-rollup";
import {
  assertCanEditPhase,
  assertCanSuspendPhase,
  assertCanView,
  assertValidAssignee,
  loadProjectAccess,
  normalizeOptionalText,
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

    if (input.responsibleId !== undefined) {
      await assertValidAssignee(
        deps.repos,
        projectId,
        project.ownerId,
        input.responsibleId,
        "PHASE_RESPONSIBLE_NOT_MEMBER",
      );
    }
    const completionCriteria = normalizeOptionalText(input.completionCriteria);
    const hasFieldChanges =
      input.name !== undefined ||
      input.description !== undefined ||
      input.responsibleId !== undefined ||
      completionCriteria !== undefined;

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
          payload: { automatic: false, from: updated.status, to: "SUSPENSA" },
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
