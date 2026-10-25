import { HttpError } from "../../../lib/http-error";
import { UniqueConstraintError } from "../../../lib/postgres-errors";
import type { AuthUser } from "../../../lib/session";
import type { EapImpedimentChangeDto, RegisterImpedimentInput } from "../dtos/eap-impediments.dto";
import { toEapImpedimentDto } from "../dtos/eap-impediments.dto";
import { toEapTaskDto } from "../dtos/eap-tasks.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import { impedimentAlreadyOpenError, loadTaskForImpediment } from "./impediment-access";
import { taskNotFoundError } from "./shared";

export function makeRegisterImpedimentUseCase(deps: {
  repos: EapRepos;
  runInTransaction: EapTransactionRunner;
}) {
  return async function registerImpediment(
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    taskId: string,
    input: RegisterImpedimentInput,
  ): Promise<EapImpedimentChangeDto> {
    const current = await loadTaskForImpediment(deps.repos, actor, projectId, phaseId, taskId);

    if (current.status === "CANCELADA" || current.status === "CONCLUIDA") {
      throw new HttpError(
        409,
        "Não é possível registrar impedimento em tarefa cancelada ou concluída.",
        "IMPEDIMENT_TASK_CLOSED",
      );
    }

    return deps.runInTransaction(async (txRepos) => {
      if (await txRepos.impediments.findOpenByTask(taskId)) {
        throw impedimentAlreadyOpenError();
      }

      const impediment = await txRepos.impediments
        .create({
          id: crypto.randomUUID(),
          taskId,
          description: input.description,
          openedBy: actor.id,
        })
        .catch((error: unknown) => {
          throw error instanceof UniqueConstraintError ? impedimentAlreadyOpenError() : error;
        });

      const task = await txRepos.tasks.update(taskId, phaseId, {
        hasImpediment: true,
        updatedBy: actor.id,
        updatedAt: new Date(),
      });
      if (!task) {
        throw taskNotFoundError();
      }

      await txRepos.audit.create({
        id: crypto.randomUUID(),
        projectId,
        entityType: "TASK",
        entityId: taskId,
        action: "IMPEDE",
        summary: `Impedimento registrado na tarefa "${task.title}".`,
        payload: {
          kind: "IMPEDIMENT_OPEN",
          impedimentId: impediment.id,
          description: impediment.description,
        },
        actorId: actor.id,
      });

      return { task: toEapTaskDto(task), impediment: toEapImpedimentDto(impediment) };
    });
  };
}
