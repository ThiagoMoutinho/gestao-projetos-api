import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import type { ProjectAccessContext } from "../../projects/projects.authorization";
import {
  canAuthorizeEapMilestoneResubmission,
  canBeEapMilestoneReviewer,
  canCreateEapItems,
  canDecideEapTaskStatus,
  canDeleteEapItem,
  canSuspendEapPhase,
  canDeliverEapMilestone,
  canEditEapItem,
  canHomologateEapMilestone,
  canManageEapPhases,
  canRegisterEapEvidence,
  canRegisterEapEvidenceOn,
  canRescheduleEap,
  canStructureEapMilestones,
  canStructureEapTasks,
  canUpdateEapTaskProgress,
  canViewProject,
  type EapEvidenceParentAccess,
} from "../eap.authorization";
import type { EapMilestoneRow } from "../dtos/eap-milestones.dto";
import type { EapRepos } from "../repositories/contracts";
import { civilDayKey, isFutureCivilDate } from "./eap-status";

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

export function assertCanDeleteItem(context: ProjectAccessContext) {
  if (!canDeleteEapItem(context)) {
    throw new HttpError(
      403,
      "Somente a gestão do projeto pode excluir itens da EAP.",
      "EAP_DELETE_FORBIDDEN",
    );
  }
}

export function assertCanDecideTaskStatus(context: ProjectAccessContext) {
  if (!canDecideEapTaskStatus(context)) {
    throw new HttpError(
      403,
      "Somente a gestão do projeto pode cancelar ou reativar tarefas.",
      "TASK_STATUS_DECISION_FORBIDDEN",
    );
  }
}

export function assertCanSuspendPhase(context: ProjectAccessContext) {
  if (!canSuspendEapPhase(context)) {
    throw new HttpError(
      403,
      "Somente a gestão do projeto pode suspender ou retomar a fase.",
      "PHASE_SUSPEND_FORBIDDEN",
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

export function assertCanDeliverMilestone(
  context: ProjectAccessContext,
  milestone?: { presenterId: string | null },
) {
  if (!canDeliverEapMilestone(context, milestone)) {
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

export function assertCanHomologateMilestone(
  context: ProjectAccessContext,
  milestone: { reviewerId: string | null },
) {
  if (!canHomologateEapMilestone(context, milestone)) {
    throw new HttpError(
      403,
      milestone.reviewerId
        ? "Somente o homologador designado pode decidir sobre este marco."
        : "Somente a gestão vinculada ao projeto pode decidir sobre este marco.",
      "MILESTONE_REVIEW_FORBIDDEN",
    );
  }
}

export function assertCanAuthorizeResubmission(context: ProjectAccessContext) {
  if (!canAuthorizeEapMilestoneResubmission(context)) {
    throw new HttpError(
      403,
      "Somente o PMO ou a gestão do projeto pode autorizar nova submissão.",
      "MILESTONE_RESUBMISSION_FORBIDDEN",
    );
  }
}

export function assertCanRescheduleEap(context: ProjectAccessContext) {
  if (!canRescheduleEap(context)) {
    throw new HttpError(
      403,
      "Somente o PMO, o administrador ou a gestão do projeto pode reprogramar prazos.",
      "SCHEDULE_RESCHEDULE_FORBIDDEN",
    );
  }
}

/** Entrega e homologação seguem rodadas de envio e decisão; aprovação é decidida diretamente. */
export function usesDeliveryRounds(type: EapMilestoneRow["type"]) {
  return type === "ENTREGA" || type === "HOMOLOGACAO";
}

/** A designação de homologador é decisão da gestão e exige participante que não seja fornecedor. */
export async function assertValidMilestoneReviewer(
  repos: EapRepos,
  context: ProjectAccessContext,
  projectId: string,
  reviewerId: string | null | undefined,
) {
  if (reviewerId === undefined) {
    return;
  }

  if (!canStructureEapMilestones(context)) {
    throw new HttpError(
      403,
      "Somente a gestão do projeto pode designar o homologador do marco.",
      "MILESTONE_REVIEWER_FORBIDDEN",
    );
  }

  if (reviewerId === null) {
    return;
  }

  const reviewer = await repos.users.findById(reviewerId);
  if (!reviewer) {
    throw new HttpError(404, "Usuário não encontrado.", "USER_NOT_FOUND");
  }

  const memberRoles = await repos.members.findRoles(projectId, reviewerId);
  const eligible = canBeEapMilestoneReviewer({
    globalRole: reviewer.role,
    isOwner: reviewerId === context.ownerId,
    memberRoles,
  });
  if (!eligible) {
    throw new HttpError(
      400,
      "O homologador deve participar do projeto e não pode atuar como fornecedor.",
      "MILESTONE_REVIEWER_INVALID",
    );
  }
}

/**
 * O apresentador do marco é designado pela gestão e precisa participar do projeto (o dono ou qualquer
 * função, inclusive fornecedor), sendo diferente do gestor validador.
 */
export async function assertValidMilestonePresenter(
  repos: EapRepos,
  context: ProjectAccessContext,
  projectId: string,
  presenterId: string | undefined,
  reviewerId: string | null,
) {
  if (presenterId === undefined) {
    return;
  }

  if (!canStructureEapMilestones(context)) {
    throw new HttpError(
      403,
      "Somente a gestão do projeto pode designar quem apresenta o marco.",
      "MILESTONE_PRESENTER_FORBIDDEN",
    );
  }

  const presenter = await repos.users.findById(presenterId);
  if (!presenter) {
    throw new HttpError(404, "Usuário não encontrado.", "USER_NOT_FOUND");
  }

  const memberRoles = await repos.members.findRoles(projectId, presenterId);
  if (presenterId !== context.ownerId && memberRoles.length === 0) {
    throw new HttpError(
      400,
      "Quem apresenta o marco deve participar do projeto.",
      "MILESTONE_PRESENTER_INVALID",
    );
  }

  if (presenterId === reviewerId) {
    throw new HttpError(
      400,
      "Quem apresenta o marco não pode ser o gestor que vai validá-lo.",
      "MILESTONE_PRESENTER_IS_REVIEWER",
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
  notMemberCode = "TASK_ASSIGNEE_NOT_MEMBER",
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
      notMemberCode,
    );
  }
}

export function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined) {
    return undefined;
  }

  return value && value.length > 0 ? value : null;
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

/** Criação de fase ou tarefa. Registros antigos sem datas seguem pelo fluxo de planejamento. */
export function assertRequiredPlannedRange(start: Date | null, end: Date | null) {
  if (!start || !end) {
    throw new HttpError(
      400,
      "Informe o início e o término planejados.",
      "PLANNED_DATES_REQUIRED",
    );
  }

  assertPlannedDates(start, end);
}

/** Criação de marco. A primeira definição posterior continua disponível para registros antigos. */
export function assertRequiredPlannedDate(value: Date | null) {
  if (!value) {
    throw new HttpError(400, "Informe a data planejada.", "PLANNED_DATE_REQUIRED");
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

export function assertActualDateNotFuture(value: Date | null) {
  if (value && isFutureCivilDate(value)) {
    throw new HttpError(
      400,
      "Datas realizadas não podem estar no futuro.",
      "TASK_ACTUAL_DATE_FUTURE",
    );
  }
}

export type ActualDateField = "actualStartAt" | "actualEndAt";

/**
 * Datas reais que já estavam registradas e foram alteradas ou apagadas. O primeiro registro
 * de uma data não é correção; mudar o horário dentro do mesmo dia civil também não.
 */
export function correctedActualDates(
  current: Record<ActualDateField, Date | null>,
  informed: Partial<Record<ActualDateField, Date | null>>,
): ActualDateField[] {
  return (["actualStartAt", "actualEndAt"] as const).filter((field) => {
    const previous = current[field];
    const next = informed[field];
    return (
      next !== undefined &&
      previous !== null &&
      (next === null || civilDayKey(next) !== civilDayKey(previous))
    );
  });
}

export function assertCorrectionJustification(
  corrected: readonly ActualDateField[],
  justification: string | null,
) {
  if (corrected.length > 0 && (!justification || justification.length < 10)) {
    throw new HttpError(
      400,
      "A correção de uma data real já registrada exige justificativa com ao menos 10 caracteres.",
      "ACTUAL_DATE_CORRECTION_JUSTIFICATION_REQUIRED",
    );
  }
}

/** Item concluído (fase concluída, tarefa concluída ou marco aceito) fica somente leitura. */
export const concludedItemLockedError = (item: "fase" | "tarefa" | "marco") =>
  new HttpError(
    409,
    item === "marco"
      ? "Marco aceito não pode ser alterado."
      : `${item === "fase" ? "Fase concluída" : "Tarefa concluída"} não pode ser alterada. Ela volta a ser editável quando retornar para andamento.`,
    "ITEM_CONCLUDED_LOCKED",
  );

export function normalizeJustification(value: string | null | undefined) {
  return value?.trim() ? value.trim() : null;
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

export const milestoneResubmissionNotAuthorizedError = () =>
  new HttpError(
    409,
    "A entrega foi rejeitada. Uma nova submissão depende de autorização do PMO ou da gestão do projeto.",
    "MILESTONE_RESUBMISSION_NOT_AUTHORIZED",
  );

export const evidenceLockedError = () =>
  new HttpError(
    409,
    "Evidência enviada em uma rodada de homologação não pode ser alterada. Registre uma nova evidência.",
    "EVIDENCE_LOCKED",
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

export const deleteBlockedError = (message: string, code: string) =>
  new HttpError(409, message, code);

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
