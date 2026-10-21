import type { AuthUser } from "../../../lib/session";
import type { UpdatePhaseInput } from "../dtos/eap-phases.dto";
import { toEapPhaseDto } from "../dtos/eap-phases.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import {
  assertCanEditPhase,
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

    return deps.runInTransaction(async (txRepos) => {
      const updated = await txRepos.phases.update(phaseId, projectId, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.responsibleId !== undefined ? { responsibleId: input.responsibleId } : {}),
        ...(completionCriteria !== undefined ? { completionCriteria } : {}),
        updatedBy: actor.id,
        updatedAt: new Date(),
      });

      if (!updated) {
        throw phaseNotFoundError();
      }

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
          status: input.status,
          responsibleId: input.responsibleId,
          completionCriteria,
        },
        actorId: actor.id,
      });

      return toEapPhaseDto(updated);
    });
  };
}
