import type { AuthUser } from "../../../lib/session";
import { toEapEvidenceDto } from "../dtos/eap-evidences.dto";
import type { EapRepos } from "../repositories/contracts";
import { assertCanView, evidenceNotFoundError, loadProjectAccess } from "./shared";

export function makeGetEvidenceUseCase(deps: { repos: EapRepos }) {
  return async function getEvidence(actor: AuthUser, projectId: string, evidenceId: string) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);

    const evidence = await deps.repos.evidences.findByIdAndProject(evidenceId, projectId);
    if (!evidence) {
      throw evidenceNotFoundError();
    }

    return toEapEvidenceDto(evidence);
  };
}
