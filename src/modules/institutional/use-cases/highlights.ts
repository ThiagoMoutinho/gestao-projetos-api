import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { toHighlightDto } from "../dtos/institutional.dto";
import type { InstitutionalRepos, InstitutionalTransactionRunner } from "../repositories/contracts";
import {
  assertCanEditInstitutional,
  loadViewableProject,
  milestoneNotFoundError,
  recordInstitutionalAudit,
} from "./shared";

type Deps = { repos: InstitutionalRepos; runInTransaction: InstitutionalTransactionRunner };

/**
 * Destaca um marco real da EAP para a apresentação institucional. O marco original não é alterado e só marcos
 * aprovados (evolução efetivamente obtida) podem ser destacados. Repetir a operação é inofensivo.
 */
export function makeSetHighlightUseCase(deps: Deps) {
  return async function setHighlight(actor: AuthUser, projectId: string, milestoneId: string) {
    const { context } = await loadViewableProject(deps.repos, actor, projectId);
    assertCanEditInstitutional(context);

    const milestone = await deps.repos.institutional.findMilestoneInProject(projectId, milestoneId);
    if (!milestone) {
      throw milestoneNotFoundError();
    }
    if (milestone.status !== "APROVADO") {
      throw new HttpError(
        409,
        "Somente marcos aprovados podem ser destacados como evolução.",
        "HIGHLIGHT_REQUIRES_APPROVED_MILESTONE",
      );
    }

    const row = await deps.runInTransaction(async (txRepos) => {
      const existing = await txRepos.institutional.findHighlight(projectId, milestoneId);
      if (existing) {
        return existing;
      }
      const created = await txRepos.institutional.addHighlight({
        id: crypto.randomUUID(),
        projectId,
        milestoneId,
        actorId: actor.id,
      });
      await recordInstitutionalAudit(txRepos, {
        projectId,
        actorId: actor.id,
        entityType: "PROJECT_HIGHLIGHT",
        entityId: milestoneId,
        action: "CREATE",
        summary: `Marco "${milestone.title}" destacado na apresentação institucional.`,
        payload: { kind: "HIGHLIGHT_ADD", milestoneId, title: milestone.title },
      });
      return created;
    });

    return toHighlightDto(row);
  };
}

export function makeRemoveHighlightUseCase(deps: Deps) {
  return async function removeHighlight(actor: AuthUser, projectId: string, milestoneId: string) {
    const { context } = await loadViewableProject(deps.repos, actor, projectId);
    assertCanEditInstitutional(context);

    await deps.runInTransaction(async (txRepos) => {
      const removed = await txRepos.institutional.removeHighlight(projectId, milestoneId);
      if (!removed) {
        throw new HttpError(404, "Este marco não está destacado.", "HIGHLIGHT_NOT_FOUND");
      }
      await recordInstitutionalAudit(txRepos, {
        projectId,
        actorId: actor.id,
        entityType: "PROJECT_HIGHLIGHT",
        entityId: milestoneId,
        action: "DELETE",
        summary: "Destaque do marco removido da apresentação institucional.",
        payload: { kind: "HIGHLIGHT_REMOVE", milestoneId },
      });
    });
  };
}
