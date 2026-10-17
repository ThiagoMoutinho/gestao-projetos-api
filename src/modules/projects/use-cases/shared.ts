import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import type { ProjectAccessContext } from "../projects.authorization";
import {
  canManageProjectMembers,
  canUpdateProject,
  canViewProject,
} from "../projects.authorization";
import type { ProjectRepos } from "../repositories/contracts";

export async function loadProjectAccess(
  repos: ProjectRepos,
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

export function assertCanUpdate(context: ProjectAccessContext) {
  if (!canUpdateProject(context)) {
    throw new HttpError(
      403,
      "Você não tem permissão para atualizar este projeto.",
      "PROJECT_UPDATE_FORBIDDEN",
    );
  }
}

export function assertCanManageMembers(context: ProjectAccessContext) {
  if (!canManageProjectMembers(context)) {
    throw new HttpError(
      403,
      "Você não tem permissão para gerenciar participantes deste projeto.",
      "PROJECT_MEMBERS_FORBIDDEN",
    );
  }
}

export const duplicateMemberError = () =>
  new HttpError(
    409,
    "Este usuário já possui essa função neste projeto.",
    "PROJECT_MEMBER_DUPLICATE",
  );

export const ownerNotFoundError = () =>
  new HttpError(404, "Dono do projeto não encontrado.", "OWNER_NOT_FOUND");
