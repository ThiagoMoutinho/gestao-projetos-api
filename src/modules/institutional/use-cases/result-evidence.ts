import type { AuthUser } from "../../../lib/session";
import { toEapEvidenceDto } from "../../eap/dtos/eap-evidences.dto";
import type { InstitutionalRepos, InstitutionalTransactionRunner } from "../repositories/contracts";
import { assertCanRegisterResults, loadViewableProject, recordInstitutionalAudit, resultNotFoundError } from "./shared";

/**
 * Registra o link de um documento que comprova um resultado (por exemplo, o relatório comparativo do GLPI).
 * Mesma regra de edição dos resultados: o fornecedor só anexa aos resultados que cadastrou.
 */
export function makeRegisterResultEvidenceUseCase(deps: {
  repos: InstitutionalRepos;
  runInTransaction: InstitutionalTransactionRunner;
}) {
  return async function registerResultEvidence(
    actor: AuthUser,
    projectId: string,
    resultId: string,
    input: { title: string; url: string },
  ) {
    const { context } = await loadViewableProject(deps.repos, actor, projectId);
    assertCanRegisterResults(context);

    const created = await deps.runInTransaction(async (txRepos) => {
      const result = await txRepos.institutional.findResult(projectId, resultId);
      if (!result || result.archivedAt) {
        throw resultNotFoundError();
      }
      assertCanRegisterResults(context, result.createdBy, actor.id);
      const evidence = await txRepos.evidences.create({
        id: crypto.randomUUID(),
        phaseId: null,
        taskId: null,
        milestoneId: null,
        scheduleRequestId: null,
        projectId: null,
        projectResultId: resultId,
        title: input.title,
        url: input.url,
        createdBy: actor.id,
      });
      await recordInstitutionalAudit(txRepos, {
        projectId,
        actorId: actor.id,
        entityType: "PROJECT_RESULT",
        entityId: resultId,
        action: "UPDATE",
        summary: `Evidência "${input.title}" vinculada ao resultado.`,
        payload: { kind: "RESULT_EVIDENCE", evidenceId: evidence.id, title: input.title, url: input.url },
      });
      return evidence;
    });

    return toEapEvidenceDto(created);
  };
}
