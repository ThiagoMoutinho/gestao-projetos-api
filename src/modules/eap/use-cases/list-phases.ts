import type { AuthUser } from "../../../lib/session";
import { toEapPhaseDto } from "../dtos/eap-phases.dto";
import type { EapRepos } from "../repositories/contracts";
import { assertCanView, loadProjectAccess } from "./shared";

export function makeListPhasesUseCase(deps: { repos: EapRepos }) {
  return async function listPhases(actor: AuthUser, projectId: string) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);

    const phases = await deps.repos.phases.listByProject(projectId);
    return { data: phases.map(toEapPhaseDto) };
  };
}
