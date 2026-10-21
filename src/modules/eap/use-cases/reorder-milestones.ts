import type { AuthUser } from "../../../lib/session";
import { toEapMilestoneDto } from "../dtos/eap-milestones.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import {
  assertCanStructureMilestones,
  assertCanView,
  loadPhaseInProject,
  loadProjectAccess,
  milestoneReorderInvalidError,
} from "./shared";

export type ReorderMilestoneItem = {
  milestoneId: string;
  sortOrder: number;
};

export function makeReorderMilestonesUseCase(deps: {
  repos: EapRepos;
  runInTransaction: EapTransactionRunner;
}) {
  return async function reorderMilestones(
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    items: ReorderMilestoneItem[],
  ) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    assertCanStructureMilestones(context);
    await loadPhaseInProject(deps.repos, projectId, phaseId);

    const current = await deps.repos.milestones.listByPhase(phaseId);
    const currentIds = new Set(current.map((milestone) => milestone.id));
    const incomingIds = items.map((item) => item.milestoneId);
    const uniqueIncomingIds = new Set(incomingIds);
    const uniqueSortOrders = new Set(items.map((item) => item.sortOrder));

    if (
      incomingIds.length !== current.length ||
      uniqueIncomingIds.size !== current.length ||
      uniqueSortOrders.size !== items.length ||
      incomingIds.some((id) => !currentIds.has(id))
    ) {
      throw milestoneReorderInvalidError();
    }

    const updated = await deps.runInTransaction(async (txRepos) => {
      const milestones = await txRepos.milestones.replaceSortOrders(
        phaseId,
        items,
        actor.id,
        new Date(),
      );

      await txRepos.audit.create({
        id: crypto.randomUUID(),
        projectId,
        entityType: "MILESTONE_ORDER",
        entityId: phaseId,
        action: "UPDATE",
        summary: "Marcos reordenados.",
        payload: { phaseId, items },
        actorId: actor.id,
      });

      return milestones;
    });

    return { data: updated.map(toEapMilestoneDto) };
  };
}
