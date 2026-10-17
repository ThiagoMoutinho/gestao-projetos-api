import { HttpError } from "../../../lib/http-error";
import { UniqueConstraintError } from "../../../lib/postgres-errors";
import type { AuthUser } from "../../../lib/session";
import { toProjectMemberDto } from "../dtos/projects.dto";
import { isProtectedOwnerMembership } from "../projects.authorization";
import type { ProjectRepos } from "../repositories/contracts";
import type { ProjectMemberRole } from "../schemas/projects.schema";
import {
  assertCanManageMembers,
  duplicateMemberError,
  loadProjectAccess,
} from "./shared";

export function makeUpdateProjectMemberUseCase(deps: { repos: ProjectRepos }) {
  return async function updateProjectMember(
    actor: AuthUser,
    projectId: string,
    memberId: string,
    input: { role: ProjectMemberRole },
  ) {
    const { project, context } = await loadProjectAccess(
      deps.repos,
      actor,
      projectId,
    );
    assertCanManageMembers(context);

    const member = await deps.repos.members.findByIdAndProject(memberId, projectId);
    if (!member) {
      throw new HttpError(
        404,
        "Participante não encontrado.",
        "PROJECT_MEMBER_NOT_FOUND",
      );
    }

    if (isProtectedOwnerMembership(project.ownerId, member.userId, member.role)) {
      throw new HttpError(
        409,
        "A função de dono principal não pode ser alterada por este endpoint. Transfira a titularidade do projeto.",
        "PROJECT_OWNER_ROLE_PROTECTED",
      );
    }

    const duplicate = await deps.repos.members.findByProjectUserRole(
      projectId,
      member.userId,
      input.role,
    );

    if (duplicate && duplicate.id !== member.id) {
      throw duplicateMemberError();
    }

    try {
      const updated = await deps.repos.members.updateRole(memberId, input.role);
      const memberUser = await deps.repos.users.findById(updated.userId);
      if (!memberUser) {
        throw new HttpError(404, "Usuário não encontrado.", "USER_NOT_FOUND");
      }

      return toProjectMemberDto(updated, memberUser);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw duplicateMemberError();
      }

      throw error;
    }
  };
}
