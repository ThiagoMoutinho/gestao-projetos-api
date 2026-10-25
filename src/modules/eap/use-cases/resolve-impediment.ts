import type { AuthUser } from "../../../lib/session";
import type { EapImpedimentChangeDto, ResolveImpedimentInput } from "../dtos/eap-impediments.dto";
import { toEapImpedimentDto } from "../dtos/eap-impediments.dto";
import { toEapTaskDto } from "../dtos/eap-tasks.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import { impedimentNotOpenError, loadTaskForImpediment } from "./impediment-access";
import { taskNotFoundError } from "./shared";

export function makeResolveImpedimentUseCase(deps: {
  repos: EapRepos;
  runInTransaction: EapTransactionRunner;
}) {
  return async function resolveImpediment(
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    taskId: string,
    input: ResolveImpedimentInput,
  ): Promise<EapImpedimentChangeDto> {
    const current = await loadTaskForImpediment(deps.repos, actor, projectId, phaseId, taskId);

    return deps.runInTransaction(async (txRepos) => {
      const open = await txRepos.impediments.findOpenByTask(taskId);
      // Marcações antigas não têm registro próprio: resolve a marcação sem inventar o motivo original.
      if (!open && !current.hasImpediment) {
        throw impedimentNotOpenError();
      }

      const resolvedAt = new Date();
      const resolved = open
        ? await txRepos.impediments.update(open.id, {
            resolvedBy: actor.id,
            resolvedAt,
            resolutionNote: input.resolutionNote,
          })
        : null;

      const task = await txRepos.tasks.update(taskId, phaseId, {
        hasImpediment: false,
        updatedBy: actor.id,
        updatedAt: resolvedAt,
      });
      if (!task) {
        throw taskNotFoundError();
      }

      await txRepos.audit.create({
        id: crypto.randomUUID(),
        projectId,
        entityType: "TASK",
        entityId: taskId,
        action: "CLEAR_IMPEDIMENT",
        summary: `Impedimento da tarefa "${task.title}" resolvido.`,
        payload: {
          kind: "IMPEDIMENT_RESOLVE",
          impedimentId: open?.id ?? null,
          description: open?.description ?? null,
          resolutionNote: input.resolutionNote,
          openedAt: open?.openedAt.toISOString() ?? null,
          openMinutes: open
            ? Math.max(0, Math.round((resolvedAt.getTime() - open.openedAt.getTime()) / 60000))
            : null,
        },
        actorId: actor.id,
      });

      return { task: toEapTaskDto(task), impediment: resolved ? toEapImpedimentDto(resolved) : null };
    });
  };
}
