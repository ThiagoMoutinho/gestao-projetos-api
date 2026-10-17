import { HttpError } from "../../../lib/http-error";
import { UniqueConstraintError } from "../../../lib/postgres-errors";
import type { AuthUser } from "../../../lib/session";
import type { AddProjectMemberInput } from "../dtos/projects.dto";
import { toProjectMemberDto } from "../dtos/projects.dto";
import type { ProjectRepos } from "../repositories/contracts";
import {
  assertCanManageMembers,
  duplicateMemberError,
  loadProjectAccess,
} from "./shared";

export function makeAddProjectMemberUseCase(deps: { repos: ProjectRepos }) {
  return async function addProjectMember(
    actor: AuthUser,
    projectId: string,
    input: AddProjectMemberInput,
  ) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanManageMembers(context);

    const memberUser = await deps.repos.users.findById(input.userId);
    if (!memberUser) {
      throw new HttpError(404, "Usuário não encontrado.", "USER_NOT_FOUND");
    }

    const duplicate = await deps.repos.members.findByProjectUserRole(
      projectId,
      input.userId,
      input.role,
    );

    if (duplicate) {
      throw duplicateMemberError();
    }

    try {
      const created = await deps.repos.members.create({
        id: crypto.randomUUID(),
        projectId,
        userId: input.userId,
        role: input.role,
      });

      return toProjectMemberDto(created, memberUser);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw duplicateMemberError();
      }

      throw error;
    }
  };
}
