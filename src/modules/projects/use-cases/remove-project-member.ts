import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { isProtectedOwnerMembership } from "../projects.authorization";
import type { ProjectRepos } from "../repositories/contracts";
import { assertCanManageMembers, loadProjectAccess } from "./shared";

export function makeRemoveProjectMemberUseCase(deps: { repos: ProjectRepos }) {
  return async function removeProjectMember(
    actor: AuthUser,
    projectId: string,
    memberId: string,
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
        "O dono principal não pode ser removido enquanto for titular do projeto.",
        "PROJECT_OWNER_MEMBER_PROTECTED",
      );
    }

    await deps.repos.members.deleteById(memberId);
  };
}
