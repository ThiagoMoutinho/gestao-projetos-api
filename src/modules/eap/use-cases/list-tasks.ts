import type { AuthUser } from "../../../lib/session";
import { toEapTaskDto } from "../dtos/eap-tasks.dto";
import type { EapRepos } from "../repositories/contracts";
import { assertCanView, loadPhaseInProject, loadProjectAccess } from "./shared";

export function makeListTasksUseCase(deps: { repos: EapRepos }) {
  return async function listTasks(actor: AuthUser, projectId: string, phaseId: string) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    await loadPhaseInProject(deps.repos, projectId, phaseId);

    const tasks = await deps.repos.tasks.listByPhase(phaseId);
    return { data: tasks.map(toEapTaskDto) };
  };
}
