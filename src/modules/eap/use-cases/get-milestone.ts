import type { AuthUser } from "../../../lib/session";
import { toEapMilestoneDto } from "../dtos/eap-milestones.dto";
import type { EapRepos } from "../repositories/contracts";
import {
  assertCanView,
  loadMilestoneInPhase,
  loadPhaseInProject,
  loadProjectAccess,
} from "./shared";

export function makeGetMilestoneUseCase(deps: { repos: EapRepos }) {
  return async function getMilestone(
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    milestoneId: string,
  ) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    await loadPhaseInProject(deps.repos, projectId, phaseId);
    const milestone = await loadMilestoneInPhase(deps.repos, phaseId, milestoneId);

    return toEapMilestoneDto(milestone);
  };
}
