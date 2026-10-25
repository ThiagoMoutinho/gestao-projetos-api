import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import type { EapImpedimentChangeDto, UpdateImpedimentInput } from "../dtos/eap-impediments.dto";
import { toEapImpedimentDto } from "../dtos/eap-impediments.dto";
import { toEapTaskDto } from "../dtos/eap-tasks.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import { impedimentNotOpenError, loadTaskForImpediment } from "./impediment-access";

export function makeUpdateImpedimentUseCase(deps: {
  repos: EapRepos;
  runInTransaction: EapTransactionRunner;
}) {
  return async function updateImpediment(
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    taskId: string,
    impedimentId: string,
    input: UpdateImpedimentInput,
  ): Promise<EapImpedimentChangeDto> {
    const task = await loadTaskForImpediment(deps.repos, actor, projectId, phaseId, taskId);

    return deps.runInTransaction(async (txRepos) => {
      const open = await txRepos.impediments.findOpenByTask(taskId);
      if (!open) {
        throw impedimentNotOpenError();
      }
      if (open.id !== impedimentId) {
        throw new HttpError(
          409,
          "Somente o impedimento em aberto pode ter o motivo atualizado.",
          "IMPEDIMENT_NOT_OPEN",
        );
      }
      if (open.description === input.description) {
        return { task: toEapTaskDto(task), impediment: toEapImpedimentDto(open) };
      }

      const updated = await txRepos.impediments.update(open.id, { description: input.description });
      if (!updated) {
        throw impedimentNotOpenError();
      }

      await txRepos.audit.create({
        id: crypto.randomUUID(),
        projectId,
        entityType: "TASK",
        entityId: taskId,
        action: "UPDATE",
        summary: `Motivo do impedimento da tarefa "${task.title}" atualizado.`,
        payload: {
          kind: "IMPEDIMENT_UPDATE",
          impedimentId: open.id,
          previousDescription: open.description,
          description: updated.description,
        },
        actorId: actor.id,
      });

      return { task: toEapTaskDto(task), impediment: toEapImpedimentDto(updated) };
    });
  };
}
