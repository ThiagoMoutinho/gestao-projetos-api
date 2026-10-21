import { UniqueConstraintError } from "../../../lib/postgres-errors";
import type { AuthUser } from "../../../lib/session";
import type { CreatePhaseInput } from "../dtos/eap-phases.dto";
import { toEapPhaseDto } from "../dtos/eap-phases.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import {
  assertCanCreateItems,
  assertCanView,
  assertPlannedDates,
  duplicateSortOrderError,
  loadProjectAccess,
  parseOptionalDate,
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
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    assertCanCreateItems(context);

    const plannedStartAt = parseOptionalDate(input.plannedStartAt);
    const plannedEndAt = parseOptionalDate(input.plannedEndAt);
    assertPlannedDates(plannedStartAt, plannedEndAt);

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
          status: input.status ?? "NAO_INICIADA",
          plannedStartAt,
          plannedEndAt,
          baselineStartAt: plannedStartAt,
          baselineEndAt: plannedEndAt,
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
            plannedStartAt: phase.plannedStartAt?.toISOString() ?? null,
            plannedEndAt: phase.plannedEndAt?.toISOString() ?? null,
            baselineStartAt: phase.baselineStartAt?.toISOString() ?? null,
            baselineEndAt: phase.baselineEndAt?.toISOString() ?? null,
          },
          actorId: actor.id,
        });

        return phase;
      });

      return toEapPhaseDto(created);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw duplicateSortOrderError();
      }

      throw error;
    }
  };
}
