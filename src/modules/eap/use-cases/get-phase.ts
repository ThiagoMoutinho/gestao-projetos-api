import type { AuthUser } from "../../../lib/session";
import type { EapRepos } from "../repositories/contracts";
import { presentPhase } from "./phase-rollup";
import { assertCanView, loadProjectAccess, phaseNotFoundError } from "./shared";

export function makeGetPhaseUseCase(deps: { repos: EapRepos }) {
  return async function getPhase(actor: AuthUser, projectId: string, phaseId: string) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);

    const phase = await deps.repos.phases.findByIdAndProject(phaseId, projectId);
    if (!phase) {
      throw phaseNotFoundError();
    }

    return presentPhase(deps.repos, phase);
  };
}
