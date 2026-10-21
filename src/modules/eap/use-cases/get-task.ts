import type { AuthUser } from "../../../lib/session";
import { toEapTaskDto } from "../dtos/eap-tasks.dto";
import type { EapRepos } from "../repositories/contracts";
import {
  assertCanView,
  loadPhaseInProject,
  loadProjectAccess,
  loadTaskInPhase,
} from "./shared";

export function makeGetTaskUseCase(deps: { repos: EapRepos }) {
  return async function getTask(
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    taskId: string,
  ) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    await loadPhaseInProject(deps.repos, projectId, phaseId);
    const task = await loadTaskInPhase(deps.repos, phaseId, taskId);

    return toEapTaskDto(task);
  };
}
