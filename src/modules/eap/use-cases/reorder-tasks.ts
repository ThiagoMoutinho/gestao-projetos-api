import type { AuthUser } from "../../../lib/session";
import { toEapTaskDto } from "../dtos/eap-tasks.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import {
  assertCanStructureTasks,
  assertCanView,
  loadPhaseInProject,
  loadProjectAccess,
  taskReorderInvalidError,
} from "./shared";

export type ReorderTaskItem = {
  taskId: string;
  sortOrder: number;
};

export function makeReorderTasksUseCase(deps: {
  repos: EapRepos;
  runInTransaction: EapTransactionRunner;
}) {
  return async function reorderTasks(
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    items: ReorderTaskItem[],
  ) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    assertCanStructureTasks(context);
    await loadPhaseInProject(deps.repos, projectId, phaseId);

    const current = await deps.repos.tasks.listByPhase(phaseId);
    const currentIds = new Set(current.map((task) => task.id));
    const incomingIds = items.map((item) => item.taskId);
    const uniqueIncomingIds = new Set(incomingIds);
    const uniqueSortOrders = new Set(items.map((item) => item.sortOrder));

    if (
      incomingIds.length !== current.length ||
      uniqueIncomingIds.size !== current.length ||
      uniqueSortOrders.size !== items.length ||
      incomingIds.some((id) => !currentIds.has(id))
    ) {
      throw taskReorderInvalidError();
    }

    const updated = await deps.runInTransaction(async (txRepos) => {
      const tasks = await txRepos.tasks.replaceSortOrders(phaseId, items, actor.id, new Date());

      await txRepos.audit.create({
        id: crypto.randomUUID(),
        projectId,
        entityType: "TASK_ORDER",
        entityId: phaseId,
        action: "UPDATE",
        summary: "Tarefas reordenadas.",
        payload: { phaseId, items },
        actorId: actor.id,
      });

      return tasks;
    });

    return { data: updated.map(toEapTaskDto) };
  };
}
