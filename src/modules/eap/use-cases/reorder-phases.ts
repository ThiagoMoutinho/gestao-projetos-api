import type { AuthUser } from "../../../lib/session";
import type { ReorderPhaseItem } from "../dtos/eap-phases.dto";
import { presentPhaseList } from "./phase-rollup";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import {
  assertCanManagePhases,
  assertCanView,
  loadProjectAccess,
  reorderInvalidError,
} from "./shared";

export function makeReorderPhasesUseCase(deps: {
  repos: EapRepos;
  runInTransaction: EapTransactionRunner;
}) {
  return async function reorderPhases(
    actor: AuthUser,
    projectId: string,
    items: ReorderPhaseItem[],
  ) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    assertCanManagePhases(context);

    const current = await deps.repos.phases.listByProject(projectId);
    const currentIds = new Set(current.map((phase) => phase.id));
    const incomingIds = items.map((item) => item.phaseId);
    const uniqueIncomingIds = new Set(incomingIds);
    const uniqueSortOrders = new Set(items.map((item) => item.sortOrder));

    if (
      incomingIds.length !== current.length ||
      uniqueIncomingIds.size !== current.length ||
      uniqueSortOrders.size !== items.length ||
      incomingIds.some((id) => !currentIds.has(id))
    ) {
      throw reorderInvalidError();
    }

    const updated = await deps.runInTransaction(async (txRepos) => {
      const phases = await txRepos.phases.replaceSortOrders(
        projectId,
        items,
        actor.id,
        new Date(),
      );

      await txRepos.audit.create({
        id: crypto.randomUUID(),
        projectId,
        entityType: "PHASE_ORDER",
        entityId: projectId,
        action: "UPDATE",
        summary: "Fases reordenadas.",
        payload: {
          items,
        },
        actorId: actor.id,
      });

      return phases;
    });

    return presentPhaseList(deps.repos, projectId, updated);
  };
}
