import type { AuthUser } from "../../../lib/session";
import type { CreateTaskInput } from "../dtos/eap-tasks.dto";
import { toEapTaskDto } from "../dtos/eap-tasks.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import {
  assertCanCreateItems,
  assertCanView,
  assertConcludedProgress,
  assertPlannedDates,
  assertValidAssignee,
  loadPhaseInProject,
  loadProjectAccess,
  parseOptionalDate,
} from "./shared";

export function makeCreateTaskUseCase(deps: {
  repos: EapRepos;
  runInTransaction: EapTransactionRunner;
}) {
  return async function createTask(
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    input: CreateTaskInput,
  ) {
    const { project, context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    assertCanCreateItems(context);
    await loadPhaseInProject(deps.repos, projectId, phaseId);

    const plannedStartAt = parseOptionalDate(input.plannedStartAt);
    const plannedEndAt = parseOptionalDate(input.plannedEndAt);
    assertPlannedDates(plannedStartAt, plannedEndAt);

    const status = input.status ?? "NAO_INICIADA";
    const progressPercent = status === "CONCLUIDA" ? 100 : 0;
    assertConcludedProgress(status, progressPercent);

    await assertValidAssignee(deps.repos, projectId, project.ownerId, input.assigneeId);

    const created = await deps.runInTransaction(async (txRepos) => {
      const [taskMax, milestoneMax] = await Promise.all([
        txRepos.tasks.findMaxSortOrder(phaseId),
        txRepos.milestones.findMaxSortOrder(phaseId),
      ]);
      const task = await txRepos.tasks.create({
        id: crypto.randomUUID(),
        phaseId,
        title: input.title,
        description: input.description ?? null,
        sortOrder: Math.max(taskMax ?? -1, milestoneMax ?? -1) + 1,
        assigneeId: input.assigneeId ?? null,
        status,
        progressPercent,
        weight: input.weight ?? 1,
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
        entityType: "TASK",
        entityId: task.id,
        action: "CREATE",
        summary: `Tarefa "${task.title}" criada.`,
        payload: {
          phaseId,
          assigneeId: task.assigneeId,
          weight: task.weight,
          status: task.status,
          plannedStartAt: task.plannedStartAt?.toISOString() ?? null,
          plannedEndAt: task.plannedEndAt?.toISOString() ?? null,
          baselineStartAt: task.baselineStartAt?.toISOString() ?? null,
          baselineEndAt: task.baselineEndAt?.toISOString() ?? null,
        },
        actorId: actor.id,
      });

      return task;
    });

    return toEapTaskDto(created);
  };
}
