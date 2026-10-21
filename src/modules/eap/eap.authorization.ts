import {
  canViewProject,
  hasProjectManagementRole,
  isProjectOwner,
  type ProjectAccessContext,
} from "../projects/projects.authorization";

export { canViewProject };
export type { ProjectAccessContext } from "../projects/projects.authorization";

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

export function canStructureEapTasks(context: ProjectAccessContext): boolean {
  return canManageEapPhases(context);
}

export function canStructureEapMilestones(context: ProjectAccessContext): boolean {
  return canManageEapPhases(context);
}

export function canDeliverEapMilestone(context: ProjectAccessContext): boolean {
  if (canStructureEapMilestones(context)) {
    return true;
  }

  if (!canViewProject(context)) {
    return false;
  }

  return (
    context.globalRole === "FORNECEDOR" || context.memberRoles.includes("FORNECEDOR")
  );
}

export function canReviewEapMilestone(context: ProjectAccessContext): boolean {
  return canStructureEapMilestones(context);
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
