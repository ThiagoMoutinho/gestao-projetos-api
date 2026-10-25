import type {
  ProjectMemberRow,
  ProjectRow,
  UserRow,
} from "../dtos/projects.dto";
import type { ProjectMemberRole } from "../schemas/projects.schema";

export type NewProjectRecord = {
  id: string;
  name: string;
  description: string | null;
  glpiTicketId: string | null;
  ownerId: string;
  status: ProjectRow["status"];
};

export type ProjectUpdateRecord = {
  name?: string;
  description?: string | null;
  glpiTicketId?: string | null;
  ownerId?: string;
  status?: ProjectRow["status"];
  baselineStartAt?: Date | null;
  baselineEndAt?: Date | null;
  plannedStartAt?: Date | null;
  plannedEndAt?: Date | null;
  updatedAt?: Date;
};

export type NewProjectMemberRecord = {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectMemberRole;
};

export type UserMembership = {
  projectId: string;
  role: ProjectMemberRole;
};

export type ProjectMemberWithUser = {
  member: ProjectMemberRow;
  user: UserRow;
};

export interface ProjectsRepository {
  findById(id: string): Promise<ProjectRow | null>;
  create(data: NewProjectRecord): Promise<ProjectRow>;
  update(id: string, data: ProjectUpdateRecord): Promise<ProjectRow | null>;
  listAll(): Promise<ProjectRow[]>;
  listByOwnerOrIds(ownerId: string, projectIds: string[]): Promise<ProjectRow[]>;
}

export interface ProjectMembersRepository {
  findRoles(projectId: string, userId: string): Promise<ProjectMemberRole[]>;
  listByUser(userId: string): Promise<UserMembership[]>;
  listByProject(projectId: string): Promise<ProjectMemberWithUser[]>;
  findByProjectUserRole(
    projectId: string,
    userId: string,
    role: ProjectMemberRole,
  ): Promise<ProjectMemberRow | null>;
  findByIdAndProject(
    memberId: string,
    projectId: string,
  ): Promise<ProjectMemberRow | null>;
  create(data: NewProjectMemberRecord): Promise<ProjectMemberRow>;
  updateRole(memberId: string, role: ProjectMemberRole): Promise<ProjectMemberRow>;
  deleteById(memberId: string): Promise<void>;
  deleteOwnerRole(projectId: string, userId: string): Promise<void>;
  ensureOwnerMembership(
    projectId: string,
    ownerId: string,
  ): Promise<ProjectMemberRow>;
}

export interface UsersRepository {
  findById(id: string): Promise<UserRow | null>;
}

export type ProjectAuditAction =
  | "STATUS_CHANGE"
  | "MEMBER_ADD"
  | "MEMBER_UPDATE"
  | "MEMBER_REMOVE"
  | "OWNER_TRANSFER";

/** Registro de auditoria do projeto, gravado na mesma trilha imutável da EAP. */
export type NewProjectAuditRecord = {
  projectId: string;
  entityType: "PROJECT" | "PROJECT_MEMBER";
  entityId: string;
  action: ProjectAuditAction;
  summary: string;
  payload: Record<string, unknown>;
  actorId: string;
};

export interface ProjectAuditRepository {
  create(data: NewProjectAuditRecord): Promise<void>;
}

export type ProjectRepos = {
  projects: ProjectsRepository;
  members: ProjectMembersRepository;
  users: UsersRepository;
  audit: ProjectAuditRepository;
};

export type TransactionRunner = <T>(
  fn: (repos: ProjectRepos) => Promise<T>,
) => Promise<T>;
