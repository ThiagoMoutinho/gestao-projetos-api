import type { AuthUser } from "../../../lib/session";
import type { UpdatePhaseInput } from "../dtos/eap-phases.dto";
import { toEapPhaseDto } from "../dtos/eap-phases.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import {
  assertCanEditPhase,
  assertCanView,
  loadProjectAccess,
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
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);

    const current = await deps.repos.phases.findByIdAndProject(phaseId, projectId);
    if (!current) {
      throw phaseNotFoundError();
    }
    assertCanEditPhase(context, current.createdBy);

    return deps.runInTransaction(async (txRepos) => {
      const updated = await txRepos.phases.update(phaseId, projectId, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
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
        },
        actorId: actor.id,
      });

      return toEapPhaseDto(updated);
    });
  };
}
