import type { AuthUser } from "../../../lib/session";
import { toEapMilestoneDto } from "../dtos/eap-milestones.dto";
import type { EapRepos } from "../repositories/contracts";
import { assertCanView, loadPhaseInProject, loadProjectAccess } from "./shared";

export function makeListMilestonesUseCase(deps: { repos: EapRepos }) {
  return async function listMilestones(
    actor: AuthUser,
    projectId: string,
    phaseId: string,
  ) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    await loadPhaseInProject(deps.repos, projectId, phaseId);

    const milestones = await deps.repos.milestones.listByPhase(phaseId);
    return { data: milestones.map(toEapMilestoneDto) };
  };
}
