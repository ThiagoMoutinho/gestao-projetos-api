import type { AuthUser } from "../../../lib/session";
import type { UpdateEvidenceInput } from "../dtos/eap-evidences.dto";
import { toEapEvidenceDto } from "../dtos/eap-evidences.dto";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import { assertEvidenceParentInProject } from "./evidence-parent";
import {
  assertCanRegisterEvidenceOn,
  assertCanView,
  evidenceNotFoundError,
  loadProjectAccess,
} from "./shared";

export function makeUpdateEvidenceUseCase(deps: {
  repos: EapRepos;
  runInTransaction: EapTransactionRunner;
}) {
  return async function updateEvidence(
    actor: AuthUser,
    projectId: string,
    evidenceId: string,
    input: UpdateEvidenceInput,
  ) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);

    const current = await deps.repos.evidences.findByIdAndProject(evidenceId, projectId);
    if (!current) {
      throw evidenceNotFoundError();
    }
    const parent = await assertEvidenceParentInProject(deps.repos, projectId, current);
    assertCanRegisterEvidenceOn(context, parent);

    return deps.runInTransaction(async (txRepos) => {
      const stillThere = await txRepos.evidences.findByIdAndProject(evidenceId, projectId);
      if (!stillThere) {
        throw evidenceNotFoundError();
      }

      const updated = await txRepos.evidences.update(evidenceId, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.url !== undefined ? { url: input.url } : {}),
      });

      if (!updated) {
        throw evidenceNotFoundError();
      }

      await txRepos.audit.create({
        id: crypto.randomUUID(),
        projectId,
        entityType: "EVIDENCE",
        entityId: updated.id,
        action: "UPDATE",
        summary: `Evidência "${updated.title}" atualizada.`,
        payload: {
          phaseId: updated.phaseId,
          taskId: updated.taskId,
          milestoneId: updated.milestoneId,
          scheduleRequestId: updated.scheduleRequestId,
          title: input.title,
          url: input.url,
        },
        actorId: actor.id,
      });

      return toEapEvidenceDto(updated);
    });
  };
}
