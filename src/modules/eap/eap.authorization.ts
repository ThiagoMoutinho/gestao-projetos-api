import {
  canViewProject,
  hasProjectManagementRole,
  isProjectOwner,
  type ProjectAccessContext,
} from "../projects/projects.authorization";

export { canViewProject };
export type { ProjectAccessContext } from "../projects/projects.authorization";

/**
 * Histórico de governança do projeto (participantes, titularidade e situação): ADMIN, PMO,
 * COORDENADOR e a gestão do projeto. Fornecedores, colaboradores e observadores não consultam.
 */
export function canViewProjectGovernanceAudit(context: ProjectAccessContext): boolean {
  if (
    context.globalRole === "ADMIN" ||
    context.globalRole === "PMO" ||
    context.globalRole === "COORDENADOR"
  ) {
    return true;
  }

  if (context.globalRole === "FORNECEDOR" || context.memberRoles.includes("FORNECEDOR")) {
    return false;
  }

  return (
    isProjectOwner(context.userId, context.ownerId) ||
    hasProjectManagementRole(context.memberRoles)
  );
}

export function canManageEapPhases(context: ProjectAccessContext): boolean {
  if (
    context.globalRole === "ADMIN" ||
    context.globalRole === "PMO" ||
    context.globalRole === "COORDENADOR"
  ) {
    return true;
  }

  if (context.globalRole === "FORNECEDOR" || context.globalRole === "COLABORADOR") {
    return false;
  }

  return (
    isProjectOwner(context.userId, context.ownerId) ||
    hasProjectManagementRole(context.memberRoles)
  );
}

const EAP_CREATOR_ROLES = [
  "DONO_PROJETO",
  "GESTOR",
  "PO",
  "RESPONSAVEL_TECNICO",
  "DESENVOLVEDOR",
  "FORNECEDOR",
] as const;

export function canCreateEapItems(context: ProjectAccessContext): boolean {
  if (
    context.globalRole === "ADMIN" ||
    context.globalRole === "PMO" ||
    context.globalRole === "COORDENADOR"
  ) {
    return true;
  }

  if (isProjectOwner(context.userId, context.ownerId)) {
    return true;
  }

  return context.memberRoles.some((role) =>
    (EAP_CREATOR_ROLES as readonly string[]).includes(role),
  );
}

export function canEditEapItem(context: ProjectAccessContext, createdBy: string): boolean {
  if (canManageEapPhases(context)) {
    return true;
  }

  return createdBy === context.userId && canCreateEapItems(context);
}

/** Exclusão é restrita à gestão do projeto, inclusive para itens criados pelo próprio usuário. */
export function canDeleteEapItem(context: ProjectAccessContext): boolean {
  return canManageEapPhases(context);
}

/** Cancelar ou reativar tarefa é decisão explícita da gestão; o responsável apenas registra andamento. */
export function canDecideEapTaskStatus(context: ProjectAccessContext): boolean {
  return canManageEapPhases(context);
}

export function canSuspendEapPhase(context: ProjectAccessContext): boolean {
  return canManageEapPhases(context);
}

export function canStructureEapTasks(context: ProjectAccessContext): boolean {
  return canManageEapPhases(context);
}

export function canStructureEapMilestones(context: ProjectAccessContext): boolean {
  return canManageEapPhases(context);
}

/** Entrega: a gestão, o apresentador designado no marco ou fornecedor vinculado ao projeto. */
export function canDeliverEapMilestone(
  context: ProjectAccessContext,
  milestone?: { presenterId: string | null },
): boolean {
  if (canStructureEapMilestones(context)) {
    return true;
  }

  if (!canViewProject(context)) {
    return false;
  }

  if (milestone?.presenterId && milestone.presenterId === context.userId) {
    return true;
  }

  return (
    context.globalRole === "FORNECEDOR" || context.memberRoles.includes("FORNECEDOR")
  );
}

/**
 * Homologa o marco o gestor designado nele; sem designação, o dono ou quem tem DONO_PROJETO/GESTOR
 * no projeto. Perfis globais (inclusive ADMIN e PMO) não bastam, e fornecedor nunca homologa.
 */
export function canHomologateEapMilestone(
  context: ProjectAccessContext,
  milestone: { reviewerId: string | null },
): boolean {
  if (
    !canViewProject(context) ||
    context.globalRole === "FORNECEDOR" ||
    context.memberRoles.includes("FORNECEDOR")
  ) {
    return false;
  }

  if (milestone.reviewerId) {
    return milestone.reviewerId === context.userId;
  }

  return (
    isProjectOwner(context.userId, context.ownerId) ||
    hasProjectManagementRole(context.memberRoles)
  );
}

/** Após uma rejeição, a nova submissão depende do PMO/ADMIN ou da gestão do projeto. */
export function canAuthorizeEapMilestoneResubmission(context: ProjectAccessContext): boolean {
  if (context.globalRole === "ADMIN" || context.globalRole === "PMO") {
    return true;
  }

  if (context.globalRole === "FORNECEDOR" || !canViewProject(context)) {
    return false;
  }

  return (
    isProjectOwner(context.userId, context.ownerId) ||
    hasProjectManagementRole(context.memberRoles)
  );
}

/**
 * Reprogramar prazo é decisão de ADMIN, PMO ou da gestão do projeto (dono, DONO_PROJETO, GESTOR).
 * COORDENADOR e GESTOR global sem vínculo de gestão no projeto não reprogramam.
 */
/** Encerramento formal: PMO, coordenação ou administração, ou a gestão responsável pelo projeto. Nunca fornecedor ou colaborador. */
export function canCloseProject(context: ProjectAccessContext): boolean {
  if (context.globalRole === "ADMIN" || context.globalRole === "PMO" || context.globalRole === "COORDENADOR") {
    return true;
  }

  if (context.globalRole === "FORNECEDOR" || context.globalRole === "COLABORADOR") {
    return false;
  }

  return (
    isProjectOwner(context.userId, context.ownerId) ||
    hasProjectManagementRole(context.memberRoles)
  );
}

export function canRescheduleEap(context: ProjectAccessContext): boolean {
  if (context.globalRole === "ADMIN" || context.globalRole === "PMO") {
    return true;
  }

  if (context.globalRole === "FORNECEDOR" || context.globalRole === "COLABORADOR") {
    return false;
  }

  return (
    isProjectOwner(context.userId, context.ownerId) ||
    hasProjectManagementRole(context.memberRoles)
  );
}

/** Pode ser designado homologador quem participa do projeto e não atua como fornecedor. */
export function canBeEapMilestoneReviewer(candidate: {
  globalRole: string;
  isOwner: boolean;
  memberRoles: ProjectAccessContext["memberRoles"];
}): boolean {
  if (candidate.globalRole === "FORNECEDOR" || candidate.memberRoles.includes("FORNECEDOR")) {
    return false;
  }

  return candidate.isOwner || candidate.memberRoles.length > 0;
}

const EVIDENCE_CONTRIBUTOR_ROLES = [
  "DONO_PROJETO",
  "GESTOR",
  "PO",
  "DESENVOLVEDOR",
  "RESPONSAVEL_TECNICO",
  "FORNECEDOR",
] as const;

export function canRegisterEapEvidence(context: ProjectAccessContext): boolean {
  if (!canViewProject(context)) {
    return false;
  }

  if (
    context.globalRole === "ADMIN" ||
    context.globalRole === "PMO" ||
    context.globalRole === "COORDENADOR"
  ) {
    return true;
  }

  if (isProjectOwner(context.userId, context.ownerId) || hasProjectManagementRole(context.memberRoles)) {
    return true;
  }

  return context.memberRoles.some((role) =>
    (EVIDENCE_CONTRIBUTOR_ROLES as readonly string[]).includes(role),
  );
}

export type EapEvidenceParentAccess = {
  createdBy: string;
  assigneeId: string | null;
};

export function canRegisterEapEvidenceOn(
  context: ProjectAccessContext,
  parent: EapEvidenceParentAccess | null,
): boolean {
  if (canRegisterEapEvidence(context)) {
    return true;
  }

  if (!parent || !canViewProject(context)) {
    return false;
  }

  return (
    isAssignedTo(context, parent.assigneeId) || canEditEapItem(context, parent.createdBy)
  );
}

export function canUpdateEapTaskProgress(
  context: ProjectAccessContext,
  task: { assigneeId: string | null; createdBy: string },
): boolean {
  if (canEditEapItem(context, task.createdBy)) {
    return true;
  }

  return canViewProject(context) && isAssignedTo(context, task.assigneeId);
}

function isAssignedTo(context: ProjectAccessContext, assigneeId: string | null): boolean {
  return assigneeId != null && assigneeId === context.userId;
}
