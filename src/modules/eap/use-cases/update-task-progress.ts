import type { AuthUser } from "../../../lib/session";
import type { UpdateTaskProgressInput } from "../dtos/eap-tasks.dto";
import { toEapTaskDto } from "../dtos/eap-tasks.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import {
  assertActualDates,
  assertCanUpdateTaskProgress,
  assertCanView,
  assertConcludedProgress,
  loadPhaseInProject,
  loadProjectAccess,
  loadTaskInPhase,
  parseOptionalDate,
  taskNotFoundError,
} from "./shared";

export function makeUpdateTaskProgressUseCase(deps: {
  repos: EapRepos;
  runInTransaction: EapTransactionRunner;
}) {
  return async function updateTaskProgress(
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    taskId: string,
    input: UpdateTaskProgressInput,
  ) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    await loadPhaseInProject(deps.repos, projectId, phaseId);
    const current = await loadTaskInPhase(deps.repos, phaseId, taskId);
    assertCanUpdateTaskProgress(context, current);

    const status = input.status ?? current.status;
    const progressPercent =
      input.progressPercent ?? (input.status === "CONCLUIDA" ? 100 : current.progressPercent);
    assertConcludedProgress(status, progressPercent);

    const actualStartAt =
      input.actualStartAt !== undefined
        ? parseOptionalDate(input.actualStartAt)
        : current.actualStartAt;
    const actualEndAt =
      input.actualEndAt !== undefined
        ? parseOptionalDate(input.actualEndAt)
        : current.actualEndAt;
    assertActualDates(actualStartAt, actualEndAt);

    return deps.runInTransaction(async (txRepos) => {
      const updated = await txRepos.tasks.update(taskId, phaseId, {
        ...(input.progressPercent !== undefined || input.status === "CONCLUIDA"
          ? { progressPercent }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.actualStartAt !== undefined ? { actualStartAt } : {}),
        ...(input.actualEndAt !== undefined ? { actualEndAt } : {}),
        ...(input.hasImpediment !== undefined ? { hasImpediment: input.hasImpediment } : {}),
        updatedBy: actor.id,
        updatedAt: new Date(),
      });

      if (!updated) {
        throw taskNotFoundError();
      }

      await txRepos.audit.create({
        id: crypto.randomUUID(),
        projectId,
        entityType: "TASK",
        entityId: updated.id,
        action: "UPDATE",
        summary: `Progresso da tarefa "${updated.title}" atualizado.`,
        payload: {
          kind: "PROGRESS",
          progressPercent: input.progressPercent,
          status: input.status,
          actualStartAt: input.actualStartAt,
          actualEndAt: input.actualEndAt,
          hasImpediment: input.hasImpediment,
        },
        actorId: actor.id,
      });

      return toEapTaskDto(updated);
    });
  };
}
