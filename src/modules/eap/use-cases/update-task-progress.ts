import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import type { UpdateTaskProgressInput } from "../dtos/eap-tasks.dto";
import { toEapTaskDto } from "../dtos/eap-tasks.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import { civilToday, deriveTaskStatus } from "./eap-status";
import { syncPhaseStatus } from "./phase-rollup";
import {
  assertActualDateNotFuture,
  assertActualDates,
  assertCanUpdateTaskProgress,
  assertCanView,
  loadPhaseInProject,
  loadProjectAccess,
  loadTaskInPhase,
  parseOptionalDate,
  taskNotFoundError,
} from "./shared";

function sameDate(a: Date | null, b: Date | null) {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

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

    if (current.status === "CANCELADA") {
      throw new HttpError(
        409,
        "Esta tarefa está cancelada. A gestão precisa reativá-la antes de registrar andamento.",
        "TASK_CANCELLED",
      );
    }

    const progressPercent = input.progressPercent ?? current.progressPercent;
    const status = deriveTaskStatus(progressPercent);

    const informedStart =
      input.actualStartAt !== undefined ? parseOptionalDate(input.actualStartAt) : undefined;
    const informedEnd =
      input.actualEndAt !== undefined ? parseOptionalDate(input.actualEndAt) : undefined;
    assertActualDateNotFuture(informedStart ?? null);
    assertActualDateNotFuture(informedEnd ?? null);

    let actualStartAt = informedStart !== undefined ? informedStart : current.actualStartAt;
    let actualEndAt = informedEnd !== undefined ? informedEnd : current.actualEndAt;
    const automaticDates: Record<string, string | null> = {};
    const today = civilToday();

    if (progressPercent > 0 && !actualStartAt && informedStart === undefined) {
      actualStartAt = today;
      automaticDates.actualStartAt = today.toISOString();
    }
    if (progressPercent === 100 && !actualEndAt && informedEnd === undefined) {
      actualEndAt = today;
      automaticDates.actualEndAt = today.toISOString();
    }
    const reopened = current.progressPercent === 100 && progressPercent < 100;
    if (reopened && actualEndAt && informedEnd === undefined) {
      automaticDates.previousActualEndAt = actualEndAt.toISOString();
      automaticDates.actualEndAt = null;
      actualEndAt = null;
    }
    assertActualDates(actualStartAt, actualEndAt);

    return deps.runInTransaction(async (txRepos) => {
      const updated = await txRepos.tasks.update(taskId, phaseId, {
        ...(progressPercent !== current.progressPercent ? { progressPercent } : {}),
        ...(status !== current.status ? { status } : {}),
        ...(!sameDate(actualStartAt, current.actualStartAt) ? { actualStartAt } : {}),
        ...(!sameDate(actualEndAt, current.actualEndAt) ? { actualEndAt } : {}),
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
          ...(input.progressPercent !== undefined
            ? { previousProgressPercent: current.progressPercent }
            : {}),
          progressPercent: input.progressPercent,
          actualStartAt: input.actualStartAt,
          actualEndAt: input.actualEndAt,
          ...(Object.keys(automaticDates).length > 0 ? { automaticDates } : {}),
        },
        actorId: actor.id,
      });

      if (status !== current.status) {
        await txRepos.audit.create({
          id: crypto.randomUUID(),
          projectId,
          entityType: "TASK",
          entityId: updated.id,
          action: "STATUS_CHANGE",
          summary: `Situação da tarefa "${updated.title}" atualizada automaticamente.`,
          payload: {
            automatic: true,
            from: current.status,
            to: status,
            cause: `Andamento passou de ${current.progressPercent}% para ${progressPercent}%.`,
          },
          actorId: actor.id,
        });
      }

      await syncPhaseStatus(txRepos, {
        projectId,
        phaseId,
        actorId: actor.id,
        cause: `Andamento da tarefa "${updated.title}" atualizado para ${progressPercent}%.`,
      });

      return toEapTaskDto(updated);
    });
  };
}
