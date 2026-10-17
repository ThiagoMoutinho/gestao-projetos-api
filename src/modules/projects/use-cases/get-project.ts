import type { AuthUser } from "../../../lib/session";
import { toProjectDetail } from "../dtos/projects.dto";
import type { ProjectRepos } from "../repositories/contracts";
import { assertCanView, loadProjectAccess, ownerNotFoundError } from "./shared";

export function makeGetProjectUseCase(deps: { repos: ProjectRepos }) {
  return async function getProject(actor: AuthUser, projectId: string) {
    const { project, context } = await loadProjectAccess(
      deps.repos,
      actor,
      projectId,
    );
    assertCanView(context);

    const owner = await deps.repos.users.findById(project.ownerId);
    if (!owner) {
      throw ownerNotFoundError();
    }

    return toProjectDetail(project, owner, actor.id, [...context.memberRoles]);
  };
}
