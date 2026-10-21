import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import type { ProjectAccessContext } from "../../projects/projects.authorization";
import {
  canCreateEapItems,
  canDeliverEapMilestone,
  canEditEapItem,
  canManageEapPhases,
  canRegisterEapEvidence,
  canRegisterEapEvidenceOn,
  canReviewEapMilestone,
  canStructureEapMilestones,
  canStructureEapTasks,
  canUpdateEapTaskProgress,
  canViewProject,
  type EapEvidenceParentAccess,
} from "../eap.authorization";
import type { EapRepos } from "../repositories/contracts";

export async function loadProjectAccess(
  repos: EapRepos,
  actor: AuthUser,
  projectId: string,
) {
  const project = await repos.projects.findById(projectId);

  if (!project) {
    throw new HttpError(404, "Projeto não encontrado.", "PROJECT_NOT_FOUND");
  }

  const memberRoles = await repos.members.findRoles(project.id, actor.id);
  const context: ProjectAccessContext = {
    globalRole: actor.role,
    userId: actor.id,
    ownerId: project.ownerId,
    memberRoles,
  };

  return { project, context };
}

export function assertCanView(context: ProjectAccessContext) {
  if (!canViewProject(context)) {
    throw new HttpError(
      403,
      "Você não tem permissão para consultar este projeto.",
      "PROJECT_FORBIDDEN",
    );
  }
}

export function assertCanManagePhases(context: ProjectAccessContext) {
  if (!canManageEapPhases(context)) {
    throw new HttpError(
      403,
      "Você não tem permissão para gerenciar as fases deste projeto.",
      "PHASE_MANAGE_FORBIDDEN",
    );
  }
}

export function assertCanStructureTasks(context: ProjectAccessContext) {
  if (!canStructureEapTasks(context)) {
    throw new HttpError(
      403,
      "Você não tem permissão para estruturar as tarefas deste projeto.",
      "TASK_STRUCTURE_FORBIDDEN",
    );
  }
}

export function assertCanCreateItems(context: ProjectAccessContext) {
  if (!canCreateEapItems(context)) {
    throw new HttpError(
      403,
      "Você não tem permissão para criar itens na EAP deste projeto.",
      "EAP_CREATE_FORBIDDEN",
    );
  }
}

export function assertCanEditPhase(context: ProjectAccessContext, createdBy: string) {
  if (!canEditEapItem(context, createdBy)) {
    throw new HttpError(
      403,
      "Você não tem permissão para gerenciar as fases deste projeto.",
      "PHASE_MANAGE_FORBIDDEN",
    );
  }
}

export function assertCanEditTask(context: ProjectAccessContext, createdBy: string) {
  if (!canEditEapItem(context, createdBy)) {
    throw new HttpError(
      403,
      "Você não tem permissão para estruturar as tarefas deste projeto.",
      "TASK_STRUCTURE_FORBIDDEN",
    );
  }
}

export function assertCanEditMilestone(context: ProjectAccessContext, createdBy: string) {
  if (!canEditEapItem(context, createdBy)) {
    throw new HttpError(
      403,
      "Você não tem permissão para estruturar os marcos deste projeto.",
      "MILESTONE_STRUCTURE_FORBIDDEN",
    );
  }
}

export function assertCanRegisterEvidenceOn(
  context: ProjectAccessContext,
  parent: EapEvidenceParentAccess | null,
) {
  if (!canRegisterEapEvidenceOn(context, parent)) {
    throw new HttpError(
      403,
      "Você não tem permissão para registrar evidências neste projeto.",
      "EVIDENCE_MANAGE_FORBIDDEN",
    );
  }
}

export function assertCanUpdateTaskProgress(
  context: ProjectAccessContext,
  task: { assigneeId: string | null; createdBy: string },
) {
  if (!canUpdateEapTaskProgress(context, task)) {
    throw new HttpError(
      403,
      "Você não tem permissão para atualizar a execução desta tarefa.",
      "TASK_PROGRESS_FORBIDDEN",
    );
  }
}

export async function loadPhaseInProject(
  repos: EapRepos,
  projectId: string,
  phaseId: string,
) {
  const phase = await repos.phases.findByIdAndProject(phaseId, projectId);
  if (!phase) {
    throw phaseNotFoundError();
  }

  return phase;
}

export async function loadTaskInPhase(repos: EapRepos, phaseId: string, taskId: string) {
  const task = await repos.tasks.findByIdAndPhase(taskId, phaseId);
  if (!task) {
    throw taskNotFoundError();
  }

  return task;
}

export function assertCanStructureMilestones(context: ProjectAccessContext) {
  if (!canStructureEapMilestones(context)) {
    throw new HttpError(
      403,
      "Você não tem permissão para estruturar os marcos deste projeto.",
      "MILESTONE_STRUCTURE_FORBIDDEN",
    );
  }
}

export function assertCanDeliverMilestone(context: ProjectAccessContext) {
  if (!canDeliverEapMilestone(context)) {
    throw new HttpError(
      403,
      "Você não tem permissão para registrar a entrega deste marco.",
      "MILESTONE_DELIVER_FORBIDDEN",
    );
  }
}

export function assertCanRegisterEvidence(context: ProjectAccessContext) {
  if (!canRegisterEapEvidence(context)) {
    throw new HttpError(
      403,
      "Você não tem permissão para registrar evidências neste projeto.",
      "EVIDENCE_MANAGE_FORBIDDEN",
    );
  }
}

export function assertCanReviewMilestone(context: ProjectAccessContext) {
  if (!canReviewEapMilestone(context)) {
    throw new HttpError(
      403,
      "Você não tem permissão para decidir sobre este marco.",
      "MILESTONE_REVIEW_FORBIDDEN",
    );
  }
}

export async function loadMilestoneInPhase(
  repos: EapRepos,
  phaseId: string,
  milestoneId: string,
) {
  const milestone = await repos.milestones.findByIdAndPhase(milestoneId, phaseId);
  if (!milestone) {
    throw milestoneNotFoundError();
  }

  return milestone;
}

export async function assertValidAssignee(
  repos: EapRepos,
  projectId: string,
  ownerId: string,
  assigneeId: string | null | undefined,
) {
  if (assigneeId == null) {
    return;
  }

  const assignee = await repos.users.findById(assigneeId);
  if (!assignee) {
    throw new HttpError(404, "Usuário não encontrado.", "USER_NOT_FOUND");
  }

  if (assigneeId === ownerId) {
    return;
  }

  const memberRoles = await repos.members.findRoles(projectId, assigneeId);
  if (memberRoles.length === 0) {
    throw new HttpError(
      400,
      "O responsável deve ser um participante habilitado do projeto.",
      "TASK_ASSIGNEE_NOT_MEMBER",
    );
  }
}

export function parseOptionalDate(value: string | null | undefined): Date | null {
  if (value == null) {
    return null;
  }

  return new Date(value);
}

export function assertPlannedDates(start: Date | null, end: Date | null) {
  if (start && end && end < start) {
    throw new HttpError(
      400,
      "A data de término planejada não pode ser anterior à data de início.",
      "PHASE_DATES_INVALID",
    );
  }
}

export function assertActualDates(start: Date | null, end: Date | null) {
  if (end && !start) {
    throw new HttpError(
      400,
      "A data real de término exige uma data real de início.",
      "TASK_ACTUAL_DATES_INVALID",
    );
  }

  if (start && end && end < start) {
    throw new HttpError(
      400,
      "A data real de término não pode ser anterior à data de início.",
      "TASK_ACTUAL_DATES_INVALID",
    );
  }
}

export function assertConcludedProgress(status: string, progressPercent: number) {
  if (status === "CONCLUIDA" && progressPercent !== 100) {
    throw new HttpError(
      400,
      "Tarefa concluída deve ter percentual 100.",
      "TASK_CONCLUDED_PROGRESS_INVALID",
    );
  }
}

export const phaseNotFoundError = () =>
  new HttpError(404, "Fase não encontrada neste projeto.", "PHASE_NOT_FOUND");

export const taskNotFoundError = () =>
  new HttpError(404, "Tarefa não encontrada nesta fase.", "TASK_NOT_FOUND");

export const milestoneNotFoundError = () =>
  new HttpError(404, "Marco não encontrado nesta fase.", "MILESTONE_NOT_FOUND");

export const milestoneTransitionError = () =>
  new HttpError(
    409,
    "A transição de status deste marco não é permitida.",
    "MILESTONE_TRANSITION_INVALID",
  );

export const milestoneSelfReviewError = () =>
  new HttpError(
    409,
    "Quem registrou a entrega não pode aprovar ou rejeitar o mesmo marco.",
    "MILESTONE_SELF_REVIEW_FORBIDDEN",
  );

export const evidenceNotFoundError = () =>
  new HttpError(404, "Evidência não encontrada neste projeto.", "EVIDENCE_NOT_FOUND");

export const evidenceParentNotFoundError = () =>
  new HttpError(
    404,
    "O vínculo informado não pertence a este projeto.",
    "EVIDENCE_PARENT_NOT_FOUND",
  );

export const milestoneDeliveredByMissingError = () =>
  new HttpError(
    409,
    "A entrega atual não possui responsável registrado. A decisão foi bloqueada.",
    "MILESTONE_DELIVERED_BY_MISSING",
  );

export const duplicateSortOrderError = () =>
  new HttpError(
    409,
    "Já existe uma fase com esta ordem neste projeto.",
    "PHASE_SORT_ORDER_DUPLICATE",
  );

export const reorderInvalidError = () =>
  new HttpError(
    400,
    "A reordenação deve incluir todas as fases do projeto, sem duplicar identificadores ou ordens.",
    "PHASE_REORDER_INVALID",
  );

export const milestoneReorderInvalidError = () =>
  new HttpError(
    400,
    "A reordenação deve incluir todos os marcos da fase, sem duplicar identificadores ou ordens.",
    "MILESTONE_REORDER_INVALID",
  );

export const taskReorderInvalidError = () =>
  new HttpError(
    400,
    "A reordenação deve incluir todas as tarefas da fase, sem duplicar identificadores ou ordens.",
    "TASK_REORDER_INVALID",
  );
