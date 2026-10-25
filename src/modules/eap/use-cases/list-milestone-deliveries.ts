import type { AuthUser } from "../../../lib/session";
import { toEapMilestoneDeliveryDto } from "../dtos/eap-milestone-deliveries.dto";
import type { EapRepos } from "../repositories/contracts";
import { assertCanView, loadMilestoneInPhase, loadPhaseInProject, loadProjectAccess } from "./shared";

export function makeListMilestoneDeliveriesUseCase(deps: { repos: EapRepos }) {
  return async function listMilestoneDeliveries(
    actor: AuthUser,
    projectId: string,
    phaseId: string,
    milestoneId: string,
  ) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    await loadPhaseInProject(deps.repos, projectId, phaseId);
    await loadMilestoneInPhase(deps.repos, phaseId, milestoneId);

    const rows = await deps.repos.deliveries.listByMilestone(milestoneId);
    return { data: rows.map(toEapMilestoneDeliveryDto) };
  };
}
