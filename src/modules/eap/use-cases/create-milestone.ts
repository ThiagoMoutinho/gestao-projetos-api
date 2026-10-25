import type { AuthUser } from "../../../lib/session";
import type { CreateMilestoneInput } from "../dtos/eap-milestones.dto";
import { toEapMilestoneDto } from "../dtos/eap-milestones.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import { syncPhaseStatus } from "./phase-rollup";
import { extendPhaseToCover } from "./reschedule";
import {
  assertCanCreateItems,
  assertCanRescheduleEap,
  assertCanView,
  assertRequiredPlannedDate,
  assertValidMilestonePresenter,
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
    const { project, context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    assertCanCreateItems(context);
    if (input.extendPhase) {
      assertCanRescheduleEap(context);
    }
    await loadPhaseInProject(deps.repos, projectId, phaseId);
    await assertValidMilestoneReviewer(deps.repos, context, projectId, input.reviewerId);
    await assertValidMilestonePresenter(
      deps.repos,
      context,
      projectId,
      input.presenterId ?? undefined,
      input.reviewerId ?? null,
    );

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
        presenterId: input.presenterId ?? null,
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
          presenterId: milestone.presenterId,
        },
        actorId: actor.id,
      });

      if (input.extendPhase) {
        await extendPhaseToCover(txRepos, project, actor, {
          phaseId,
          item: { startAt: null, endAt: plannedAt },
          itemLabel: `o marco "${milestone.title}"`,
          justification: input.justification?.trim() || null,
        });
      }

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
