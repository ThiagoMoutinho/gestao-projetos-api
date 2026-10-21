import type { AuthUser } from "../../../lib/session";
import type { ListEvidencesQuery } from "../dtos/eap-evidences.dto";
import { toEapEvidenceDto } from "../dtos/eap-evidences.dto";
import type { EapRepos } from "../repositories/contracts";
import { assertEvidenceParentInProject } from "./evidence-parent";
import { assertCanView, loadProjectAccess } from "./shared";

export function makeListEvidencesUseCase(deps: { repos: EapRepos }) {
  return async function listEvidences(
    actor: AuthUser,
    projectId: string,
    query: ListEvidencesQuery,
  ) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);

    if (query.taskId || query.milestoneId || query.scheduleRequestId) {
      await assertEvidenceParentInProject(deps.repos, projectId, query);
    }

    const evidences = await deps.repos.evidences.listByProject(projectId, query);
    return { data: evidences.map(toEapEvidenceDto) };
  };
}
