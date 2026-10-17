import type { projectMembers, projects, user } from "../../../db/schema";
import type { ProjectMemberRole } from "../schemas/projects.schema";

export type ProjectRow = typeof projects.$inferSelect;
export type ProjectMemberRow = typeof projectMembers.$inferSelect;
export type UserRow = typeof user.$inferSelect;

export type CreateProjectInput = {
  name: string;
  description?: string | null;
  glpiTicketId?: string | null;
  ownerId?: string;
  status?: ProjectRow["status"];
};

export type UpdateProjectInput = {
  name?: string;
  description?: string | null;
  glpiTicketId?: string | null;
  ownerId?: string;
  status?: ProjectRow["status"];
};

export type AddProjectMemberInput = {
  userId: string;
  role: ProjectMemberRole;
};

export type UserSummaryDto = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type ProjectDto = {
  id: string;
  name: string;
  description: string | null;
  glpiTicketId: string | null;
  ownerId: string;
  status: ProjectRow["status"];
  createdAt: string;
  updatedAt: string;
};

export type ProjectListItemDto = ProjectDto & {
  isOwner: boolean;
  roles: ProjectMemberRole[];
};

export type ProjectDetailDto = ProjectDto & {
  owner: UserSummaryDto;
  isOwner: boolean;
  roles: ProjectMemberRole[];
};

export type ProjectMemberDto = {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectMemberRole;
  createdAt: string;
  user: UserSummaryDto;
};

export function uniqueRoles(roles: ProjectMemberRole[]): ProjectMemberRole[] {
  return [...new Set(roles)];
}

export function toUserSummary(row: UserRow): UserSummaryDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
  };
}

export function toProjectDto(row: ProjectRow): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    glpiTicketId: row.glpiTicketId,
    ownerId: row.ownerId,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toProjectListItem(
  row: ProjectRow,
  actorId: string,
  roles: ProjectMemberRole[],
): ProjectListItemDto {
  return {
    ...toProjectDto(row),
    isOwner: row.ownerId === actorId,
    roles: uniqueRoles(roles),
  };
}

export function toProjectDetail(
  row: ProjectRow,
  owner: UserRow,
  actorId: string,
  roles: ProjectMemberRole[],
): ProjectDetailDto {
  return {
    ...toProjectDto(row),
    owner: toUserSummary(owner),
    isOwner: row.ownerId === actorId,
    roles: uniqueRoles(roles),
  };
}

export function toProjectMemberDto(
  row: ProjectMemberRow,
  memberUser: UserRow,
): ProjectMemberDto {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    user: toUserSummary(memberUser),
  };
}
