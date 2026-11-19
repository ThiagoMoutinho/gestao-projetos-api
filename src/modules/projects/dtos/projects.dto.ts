import type { projectMembers, projects, user } from "../../../db/schema";
import type { ProjectMemberRole } from "../schemas/projects.schema";

export type ProjectRow = typeof projects.$inferSelect;
/** Linha de participante. `functionId` é opcional aqui para os testes e fixtures que não usam funções do catálogo. */
export type ProjectMemberRow = Omit<typeof projectMembers.$inferSelect, "functionId"> & { functionId?: string | null };
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
  pmoGlpiTicketId?: string | null;
  ownerId?: string;
  status?: ProjectRow["status"];
};

export type AddProjectMemberInput = {
  userId: string;
  role: ProjectMemberRole;
  /** Função do catálogo (só com o acesso de Observador). */
  functionId?: string | null;
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
  pmoGlpiTicketId: string | null;
  ownerId: string;
  status: ProjectRow["status"];
  baselineStartAt: string | null;
  baselineEndAt: string | null;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
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
  /** Função do catálogo exibida no lugar do rótulo do acesso; nula nos papéis de acesso comuns. */
  function: { id: string; name: string } | null;
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
    pmoGlpiTicketId: row.pmoGlpiTicketId,
    ownerId: row.ownerId,
    status: row.status,
    baselineStartAt: row.baselineStartAt?.toISOString() ?? null,
    baselineEndAt: row.baselineEndAt?.toISOString() ?? null,
    plannedStartAt: row.plannedStartAt?.toISOString() ?? null,
    plannedEndAt: row.plannedEndAt?.toISOString() ?? null,
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
  fn: { id: string; name: string } | null = null,
): ProjectMemberDto {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    role: row.role,
    function: fn,
    createdAt: row.createdAt.toISOString(),
    user: toUserSummary(memberUser),
  };
}
