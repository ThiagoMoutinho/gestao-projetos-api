import type { AuthUser } from "../../../lib/session";
import type { UpdateTaskInput } from "../dtos/eap-tasks.dto";
import { toEapTaskDto } from "../dtos/eap-tasks.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import { calculatedTaskStatus } from "./eap-status";
import { syncPhaseStatus } from "./phase-rollup";
import {
  assertCanEditTask,
  assertCanView,
  assertTaskAssigneePair,
  assertValidAssignee,
  concludedItemLockedError,
  loadPhaseInProject,
  loadProjectAccess,
  loadTaskInPhase,
  taskNotFoundError,
} from "./shared";

const PRIORITY_LABELS = { CRITICA: "Crítica", ALTA: "Alta", NORMAL: "Normal", BAIXA: "Baixa" } as const;

export function makeUpdateTaskUseCase(deps: {
  repos: EapRepos;
  runInTransaction: EapTransactionRunner;
}) {
  return async function updateTask(
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    taskId: string,
    input: UpdateTaskInput,
  ) {
    const { project, context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    await loadPhaseInProject(deps.repos, projectId, phaseId);
    const current = await loadTaskInPhase(deps.repos, phaseId, taskId);
    assertCanEditTask(context, current.createdBy);
    // Tarefa concluída só volta a ser editável depois de reaberta (andamento abaixo de 100%, com justificativa).
    if (calculatedTaskStatus(current) === "CONCLUIDA") {
      throw concludedItemLockedError("tarefa");
    }

    if (input.assigneeId !== undefined || input.secondaryAssigneeId !== undefined) {
      // Só quem está sendo informado é conferido como participante: o outro responsável, já gravado, não bloqueia uma
      // edição sem relação (por exemplo, tarefa antiga cujo responsável deixou o projeto). O par resultante é validado.
      if (input.assigneeId !== undefined) {
        await assertValidAssignee(deps.repos, projectId, project.ownerId, input.assigneeId);
      }
      if (input.secondaryAssigneeId !== undefined) {
        await assertValidAssignee(deps.repos, projectId, project.ownerId, input.secondaryAssigneeId);
      }
      assertTaskAssigneePair(
        input.assigneeId !== undefined ? input.assigneeId : current.assigneeId,
        input.secondaryAssigneeId !== undefined ? input.secondaryAssigneeId : current.secondaryAssigneeId,
      );
    }

    const priorityChanged = input.priority !== undefined && input.priority !== current.priority;

    return deps.runInTransaction(async (txRepos) => {
      const updated = await txRepos.tasks.update(taskId, phaseId, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        ...(input.secondaryAssigneeId !== undefined ? { secondaryAssigneeId: input.secondaryAssigneeId } : {}),
        ...(input.weight !== undefined ? { weight: input.weight } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
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
        summary: priorityChanged
          ? `Prioridade da tarefa "${updated.title}" alterada de ${PRIORITY_LABELS[current.priority]} para ${PRIORITY_LABELS[updated.priority]}.`
          : `Tarefa "${updated.title}" atualizada.`,
        payload: {
          kind: "STRUCTURE",
          title: input.title,
          description: input.description,
          assigneeId: input.assigneeId,
          secondaryAssigneeId: input.secondaryAssigneeId,
          weight: input.weight,
          priority: priorityChanged ? updated.priority : undefined,
          previousPriority: priorityChanged ? current.priority : undefined,
        },
        actorId: actor.id,
      });

      // O peso da subtarefa entra na média que calcula o andamento da tarefa superior.
      if (input.weight !== undefined && input.weight !== current.weight && current.parentTaskId) {
        await syncPhaseStatus(txRepos, {
          projectId,
          phaseId,
          actorId: actor.id,
          cause: `Peso da subtarefa "${updated.title}" alterado.`,
        });
      }

      return toEapTaskDto(updated);
    });
  };
}
