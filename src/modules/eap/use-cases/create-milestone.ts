import type { AuthUser } from "../../../lib/session";
import type { CreateMilestoneInput } from "../dtos/eap-milestones.dto";
import { toEapMilestoneDto } from "../dtos/eap-milestones.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import { syncPhaseStatus } from "./phase-rollup";
import {
  assertCanCreateItems,
  assertCanView,
  assertRequiredPlannedDate,
  assertValidMilestoneReviewer,
  loadPhaseInProject,
  loadProjectAccess,
  parseOptionalDate,
} from "./shared";

export function makeCreateMilestoneUseCase(deps: {
  repos: EapRepos;
  runInTransaction: EapTransactionRunner;
}) {
  return async function createMilestone(
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    input: CreateMilestoneInput,
  ) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    assertCanCreateItems(context);
    await loadPhaseInProject(deps.repos, projectId, phaseId);
    await assertValidMilestoneReviewer(deps.repos, context, projectId, input.reviewerId);

    const plannedAt = parseOptionalDate(input.plannedAt);
    assertRequiredPlannedDate(plannedAt);

    const created = await deps.runInTransaction(async (txRepos) => {
      const [taskMax, milestoneMax] = await Promise.all([
        txRepos.tasks.findMaxSortOrder(phaseId),
        txRepos.milestones.findMaxSortOrder(phaseId),
      ]);
      const milestone = await txRepos.milestones.create({
        id: crypto.randomUUID(),
        phaseId,
        title: input.title,
        description: input.description ?? null,
        sortOrder: Math.max(taskMax ?? -1, milestoneMax ?? -1) + 1,
        type: input.type,
        status: "PENDENTE",
        plannedAt,
        baselineAt: plannedAt,
        reviewerId: input.reviewerId ?? null,
        createdBy: actor.id,
        updatedBy: actor.id,
      });

      await txRepos.audit.create({
        id: crypto.randomUUID(),
        projectId,
        entityType: "MILESTONE",
        entityId: milestone.id,
        action: "CREATE",
        summary: `Marco "${milestone.title}" criado.`,
        payload: {
          phaseId,
          type: milestone.type,
          plannedAt: milestone.plannedAt?.toISOString() ?? null,
          baselineAt: milestone.baselineAt?.toISOString() ?? null,
          reviewerId: milestone.reviewerId,
        },
        actorId: actor.id,
      });

      await syncPhaseStatus(txRepos, {
        projectId,
        phaseId,
        actorId: actor.id,
        cause: `Marco "${milestone.title}" criado.`,
      });

      return milestone;
    });

    return toEapMilestoneDto(created);
  };
}
