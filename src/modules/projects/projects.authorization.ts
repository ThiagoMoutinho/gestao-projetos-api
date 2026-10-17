import type { UserRole } from "../../lib/session";
import type { ProjectMemberRole } from "./schemas/projects.schema";

const PROJECT_MANAGER_ROLES: readonly ProjectMemberRole[] = [
  "DONO_PROJETO",
  "GESTOR",
];

export type ProjectAccessContext = {
  globalRole: UserRole;
  userId: string;
  ownerId: string;
  memberRoles: readonly ProjectMemberRole[];
};

export function canListAllProjects(role: UserRole): boolean {
  return role === "ADMIN" || role === "PMO" || role === "COORDENADOR";
}

export function canCreateProject(role: UserRole): boolean {
  return role === "ADMIN" || role === "PMO";
}

export function canAssignProjectOwner(role: UserRole): boolean {
  return role === "ADMIN" || role === "PMO" || role === "COORDENADOR";
}

export function isProjectOwner(userId: string, ownerId: string): boolean {
  return userId === ownerId;
}

export function isProjectMember(memberRoles: readonly ProjectMemberRole[]): boolean {
  return memberRoles.length > 0;
}

export function hasProjectManagementRole(
  memberRoles: readonly ProjectMemberRole[],
): boolean {
  return PROJECT_MANAGER_ROLES.some((role) => memberRoles.includes(role));
}

export function canViewProject(context: ProjectAccessContext): boolean {
  if (canListAllProjects(context.globalRole)) {
    return true;
  }

  return (
    isProjectOwner(context.userId, context.ownerId) ||
    isProjectMember(context.memberRoles)
  );
}

export function canUpdateProject(context: ProjectAccessContext): boolean {
  if (
    context.globalRole === "ADMIN" ||
    context.globalRole === "PMO" ||
    context.globalRole === "COORDENADOR"
  ) {
    return true;
  }

  return (
    isProjectOwner(context.userId, context.ownerId) ||
    hasProjectManagementRole(context.memberRoles)
  );
}

export function canManageProjectMembers(context: ProjectAccessContext): boolean {
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

export function canTransferOwnership(context: ProjectAccessContext): boolean {
  if (
    context.globalRole === "ADMIN" ||
    context.globalRole === "PMO" ||
    context.globalRole === "COORDENADOR"
  ) {
    return true;
  }

  return isProjectOwner(context.userId, context.ownerId);
}

export function isProtectedOwnerMembership(
  ownerId: string,
  memberUserId: string,
  memberRole: ProjectMemberRole,
): boolean {
  return memberUserId === ownerId && memberRole === "DONO_PROJETO";
}
