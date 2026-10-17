import type { AuthUser } from "../../../lib/session";
import { toProjectMemberDto } from "../dtos/projects.dto";
import type { ProjectRepos } from "../repositories/contracts";
import { assertCanView, loadProjectAccess } from "./shared";

export function makeListProjectMembersUseCase(deps: { repos: ProjectRepos }) {
  return async function listProjectMembers(actor: AuthUser, projectId: string) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);

    const rows = await deps.repos.members.listByProject(projectId);
    return {
      data: rows.map((row) => toProjectMemberDto(row.member, row.user)),
    };
  };
}
