import type { AuthUser } from "../../../lib/session";
import { toEapImpedimentEntryDto } from "../dtos/eap-impediments.dto";
import type { EapRepos } from "../repositories/contracts";
import { assertCanView, loadPhaseInProject, loadProjectAccess, loadTaskInPhase } from "./shared";

export function makeListImpedimentsUseCase(deps: { repos: EapRepos }) {
  return async function listImpediments(
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    taskId: string,
  ) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    await loadPhaseInProject(deps.repos, projectId, phaseId);
    await loadTaskInPhase(deps.repos, phaseId, taskId);

    const rows = await deps.repos.impediments.listByTask(taskId);
    return { data: rows.map(toEapImpedimentEntryDto) };
  };
}
