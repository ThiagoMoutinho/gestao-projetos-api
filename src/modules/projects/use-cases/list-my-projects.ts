import type { AuthUser } from "../../../lib/session";
import { toProjectListItem } from "../dtos/projects.dto";
import type { ProjectMemberRole } from "../schemas/projects.schema";
import type { ProjectRepos } from "../repositories/contracts";

export function makeListMyProjectsUseCase(deps: { repos: ProjectRepos }) {
  return async function listMyProjects(actor: AuthUser) {
    const memberships = await deps.repos.members.listByUser(actor.id);
    const memberProjectIds = [...new Set(memberships.map((row) => row.projectId))];
    const rows = await deps.repos.projects.listByOwnerOrIds(
      actor.id,
      memberProjectIds,
    );

    const rolesByProject = new Map<string, ProjectMemberRole[]>();
    for (const membership of memberships) {
      const current = rolesByProject.get(membership.projectId) ?? [];
      current.push(membership.role);
      rolesByProject.set(membership.projectId, current);
    }

    return {
      data: rows.map((project) =>
        toProjectListItem(project, actor.id, rolesByProject.get(project.id) ?? []),
      ),
    };
  };
}
