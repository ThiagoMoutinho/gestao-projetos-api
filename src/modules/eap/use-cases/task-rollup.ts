import type { EapTaskRow } from "../dtos/eap-tasks.dto";
import type { EapRepos } from "../repositories/contracts";
import { deriveTaskStatus, parentTaskProgress } from "./eap-status";

function iso(value: Date | null) {
  return value?.toISOString() ?? null;
}

function earliest(values: ReadonlyArray<Date | null>) {
  return values.reduce<Date | null>((min, value) => (value && (!min || value < min) ? value : min), null);
}

function latest(values: ReadonlyArray<Date | null>) {
  return values.reduce<Date | null>((max, value) => (value && (!max || value > max) ? value : max), null);
}

/**
 * Recalcula, na mesma transação, o andamento e a situação das tarefas que têm subtarefas (decisão do PMO: a superior
 * é calculada pelas subtarefas, média ponderada pelo peso, sem as canceladas). As datas reais só são preenchidas quando
 * vazias, como na fase. Tarefa superior cancelada ou impedida mantém a situação decidida; o andamento acompanha.
 * Cada mudança fica no histórico como automática. Rodar de novo sem mudança nas subtarefas não grava nada.
 */
export async function syncParentTasks(
  repos: EapRepos,
  input: { projectId: string; phaseId: string; actorId: string; cause: string },
) {
  const tasks = await repos.tasks.listByPhase(input.phaseId);
  const subtasksByParent = new Map<string, EapTaskRow[]>();
  for (const task of tasks) {
    if (task.parentTaskId) {
      subtasksByParent.set(task.parentTaskId, [...(subtasksByParent.get(task.parentTaskId) ?? []), task]);
    }
  }

  for (const [parentId, subtasks] of subtasksByParent) {
    const parent = tasks.find((task) => task.id === parentId);
    if (!parent || parent.status === "CANCELADA") {
      continue;
    }
    const progress = parentTaskProgress(subtasks);
    if (progress === null) {
      continue;
    }
    const eligible = subtasks.filter((task) => task.status !== "CANCELADA");
    const status = parent.status === "IMPEDIDA" ? parent.status : deriveTaskStatus(progress);
    const concluded = status === "CONCLUIDA";
    const actualStartAt = parent.actualStartAt ?? earliest(eligible.map((task) => task.actualStartAt));
    const calculatedEnd = concluded ? (parent.actualEndAt ?? latest(eligible.map((task) => task.actualEndAt))) : null;
    // Reabrir a superior (uma subtarefa nova ou reaberta) remove o término real, que deixa de valer.
    const actualEndAt = concluded && actualStartAt && calculatedEnd && calculatedEnd >= actualStartAt ? calculatedEnd : null;

    const changed =
      progress !== parent.progressPercent ||
      status !== parent.status ||
      iso(actualStartAt) !== iso(parent.actualStartAt) ||
      iso(actualEndAt) !== iso(parent.actualEndAt);
    if (!changed) {
      continue;
    }

    await repos.tasks.update(parent.id, input.phaseId, {
      progressPercent: progress,
      status,
      actualStartAt,
      actualEndAt,
      updatedBy: input.actorId,
      updatedAt: new Date(),
    });
    await repos.audit.create({
      id: crypto.randomUUID(),
      projectId: input.projectId,
      entityType: "TASK",
      entityId: parent.id,
      action: parent.status !== status ? "STATUS_CHANGE" : "UPDATE",
      summary: `Andamento da tarefa "${parent.title}" recalculado pelas subtarefas.`,
      payload: {
        automatic: true,
        kind: "CALCULATED_FROM_SUBTASKS",
        progress: { previous: parent.progressPercent, next: progress },
        ...(parent.status !== status ? { from: parent.status, to: status } : {}),
        cause: input.cause,
      },
      actorId: input.actorId,
    });
  }
}
