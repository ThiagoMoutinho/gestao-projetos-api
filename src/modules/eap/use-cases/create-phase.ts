import { UniqueConstraintError } from "../../../lib/postgres-errors";
import type { AuthUser } from "../../../lib/session";
import type { CreatePhaseInput } from "../dtos/eap-phases.dto";
import { toEapPhaseDto } from "../dtos/eap-phases.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import {
  assertCanCreateItems,
  assertCanView,
  assertValidAssignee,
  duplicateSortOrderError,
  loadProjectAccess,
  normalizeOptionalText,
} from "./shared";

export function makeCreatePhaseUseCase(deps: {
  repos: EapRepos;
  runInTransaction: EapTransactionRunner;
}) {
  return async function createPhase(
    actor: AuthUser,
    projectId: string,
    input: CreatePhaseInput,
  ) {
    const { project, context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    assertCanCreateItems(context);

    const responsibleId = input.responsibleId ?? null;
    await assertValidAssignee(
      deps.repos,
      projectId,
      project.ownerId,
      responsibleId,
      "PHASE_RESPONSIBLE_NOT_MEMBER",
    );
    const completionCriteria = normalizeOptionalText(input.completionCriteria) ?? null;

    try {
      const created = await deps.runInTransaction(async (txRepos) => {
        const sortOrder =
          input.sortOrder ??
          ((await txRepos.phases.findMaxSortOrder(projectId)) ?? -1) + 1;

        const phase = await txRepos.phases.create({
          id: crypto.randomUUID(),
          projectId,
          name: input.name,
          description: input.description ?? null,
          sortOrder,
          status: "NAO_INICIADA",
          responsibleId,
          completionCriteria,
          // As datas da fase são calculadas pelas tarefas e marcos (syncPhaseStatus).
          plannedStartAt: null,
          plannedEndAt: null,
          baselineStartAt: null,
          baselineEndAt: null,
          createdBy: actor.id,
          updatedBy: actor.id,
        });

        await txRepos.audit.create({
          id: crypto.randomUUID(),
          projectId,
          entityType: "PHASE",
          entityId: phase.id,
          action: "CREATE",
          summary: `Fase "${phase.name}" criada.`,
          payload: {
            sortOrder: phase.sortOrder,
            responsibleId: phase.responsibleId,
            completionCriteria: phase.completionCriteria,
          },
          actorId: actor.id,
        });

        return phase;
      });

      return toEapPhaseDto(created, {
        calculatedStatus: "NAO_INICIADA",
        progress: { state: "EMPTY", basisPoints: null },
        dates: { plannedStartAt: null, plannedEndAt: null, actualStartAt: null, actualEndAt: null },
      });
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw duplicateSortOrderError();
      }

      throw error;
    }
  };
}
