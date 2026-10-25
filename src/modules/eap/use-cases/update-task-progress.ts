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
  assertCorrectionJustification,
  correctedActualDates,
  loadPhaseInProject,
  loadProjectAccess,
  loadTaskInPhase,
  normalizeJustification,
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
    const justification = normalizeJustification(input.justification);
    const completing = progressPercent === 100 && current.progressPercent < 100;
    const reopening = current.progressPercent === 100 && progressPercent < 100;
    if (reopening && (!justification || justification.length < 10)) {
      throw new HttpError(
        400,
        "Reabrir uma tarefa concluída exige justificativa com ao menos 10 caracteres.",
        "TASK_REOPEN_JUSTIFICATION_REQUIRED",
      );
    }

    const informedStart =
      input.actualStartAt !== undefined ? parseOptionalDate(input.actualStartAt) : undefined;
    const informedEnd =
      input.actualEndAt !== undefined ? parseOptionalDate(input.actualEndAt) : undefined;
    assertActualDateNotFuture(informedStart ?? null);
    assertActualDateNotFuture(informedEnd ?? null);

    const corrected = correctedActualDates(current, {
      actualStartAt: informedStart,
      actualEndAt: informedEnd,
    });
    assertCorrectionJustification(corrected, justification);

    let actualStartAt = informedStart !== undefined ? informedStart : current.actualStartAt;
    let actualEndAt = informedEnd !== undefined ? informedEnd : current.actualEndAt;
    const automaticDates: Record<string, string | null> = {};
    const today = civilToday();

    // A conclusão nunca preenche datas reais sozinha: início e término precisam ser confirmados.
    if (!completing && progressPercent > 0 && !actualStartAt && informedStart === undefined) {
      actualStartAt = today;
      automaticDates.actualStartAt = today.toISOString();
    }
    if (progressPercent === 100 && (!actualStartAt || !actualEndAt)) {
      throw new HttpError(
        400,
        "Para concluir a tarefa, informe as datas reais de início e de término.",
        "TASK_COMPLETION_ACTUAL_DATES_REQUIRED",
      );
    }
    if (reopening && actualEndAt && informedEnd === undefined) {
      automaticDates.previousActualEndAt = actualEndAt.toISOString();
      automaticDates.actualEndAt = null;
      actualEndAt = null;
    }
    assertActualDates(actualStartAt, actualEndAt);
    const progressChanged = progressPercent !== current.progressPercent;

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
        summary: completing
          ? `Tarefa "${updated.title}" concluída.`
          : reopening
            ? `Tarefa "${updated.title}" reaberta: andamento de 100% para ${progressPercent}%.`
            : progressChanged
            ? `Progresso da tarefa "${updated.title}" atualizado.`
            : corrected.length > 0
              ? `Datas reais da tarefa "${updated.title}" corrigidas.`
              : `Datas reais da tarefa "${updated.title}" registradas.`,
        payload: {
          kind: progressChanged ? "PROGRESS" : "ACTUAL_DATES",
          ...(completing ? { completed: true } : {}),
          ...(reopening ? { reopened: true } : {}),
          ...(input.progressPercent !== undefined
            ? { previousProgressPercent: current.progressPercent }
            : {}),
          progressPercent: input.progressPercent,
          actualStartAt: input.actualStartAt,
          actualEndAt: input.actualEndAt,
          ...(input.actualStartAt !== undefined
            ? { previousActualStartAt: current.actualStartAt?.toISOString() ?? null }
            : {}),
          ...(input.actualEndAt !== undefined
            ? { previousActualEndAt: current.actualEndAt?.toISOString() ?? null }
            : {}),
          ...(corrected.length > 0 ? { correctedFields: corrected } : {}),
          ...(justification ? { justification } : {}),
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
