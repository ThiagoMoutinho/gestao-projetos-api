import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import type { DecisionInput } from "../dtos/institutional.dto";
import type { InstitutionalRepos, InstitutionalTransactionRunner } from "../repositories/contracts";
import {
  assertCanRegisterResults,
  assertCanValidateResults,
  loadViewableProject,
  noPendingChangeError,
  recordInstitutionalAudit,
  resultNotFoundError,
  selfValidationError,
} from "./shared";
import { presentResult } from "./save-result";

type Deps = { repos: InstitutionalRepos; runInTransaction: InstitutionalTransactionRunner };

/**
 * Valida ou rejeita um resultado alcançado (independente da homologação de marcos). Só PMO, COORDENADOR e o gestor
 * do projeto decidem, nunca o autor da alteração. A rejeição exige justificativa e mantém o rascunho para correção
 * e reenvio ("Correções solicitadas"); a versão validada anterior é preservada. Esperados não passam por validação.
 */
export function makeDecideResultUseCase(deps: Deps) {
  return async function decideResult(actor: AuthUser, projectId: string, resultId: string, input: DecisionInput) {
    const { context } = await loadViewableProject(deps.repos, actor, projectId);
    assertCanValidateResults(context);

    const saved = await deps.runInTransaction(async (txRepos) => {
      const row = await txRepos.institutional.findResult(projectId, resultId, true);
      if (!row || row.archivedAt) {
        throw resultNotFoundError();
      }
      if (row.type === "ESPERADO") {
        throw new HttpError(
          409,
          "Resultados esperados são publicados diretamente e não passam por validação.",
          "RESULT_EXPECTED_NO_VALIDATION",
        );
      }
      if (row.draftText === null || row.draftBy === null) {
        throw noPendingChangeError();
      }
      // Valores lidos antes da decisão: a auditoria registra o que foi validado ou rejeitado.
      const pendingText = row.draftText;
      const pendingAuthor = row.draftBy;
      const previousPublishedText = row.publishedText;
      const at = new Date();

      if (input.decision === "REJECT") {
        const corrected = await txRepos.institutional.requestResultCorrections(resultId, input.reason ?? "", actor.id, at);
        if (!corrected) {
          throw noPendingChangeError();
        }
        await recordInstitutionalAudit(txRepos, {
          projectId,
          actorId: actor.id,
          entityType: "PROJECT_RESULT",
          entityId: resultId,
          action: "INSTITUTIONAL_VALIDATE",
          summary: "Correções solicitadas no resultado alcançado.",
          payload: {
            kind: "RESULT_REJECT",
            decision: "CORRECTIONS_REQUESTED",
            reason: input.reason,
            rejectedText: pendingText,
            authorId: pendingAuthor,
          },
        });
        return corrected;
      }

      if (pendingAuthor === actor.id) {
        throw selfValidationError();
      }
      const published = await txRepos.institutional.publishResultDraft(row, actor.id, at);
      if (!published) {
        throw noPendingChangeError();
      }
      await recordInstitutionalAudit(txRepos, {
        projectId,
        actorId: actor.id,
        entityType: "PROJECT_RESULT",
        entityId: resultId,
        action: "INSTITUTIONAL_VALIDATE",
        summary: "Resultado alcançado validado e publicado.",
        payload: {
          kind: "RESULT_VALIDATE",
          decision: "VALIDATED",
          text: pendingText,
          authorId: pendingAuthor,
          previousPublishedText,
        },
      });
      return published;
    });

    return presentResult(deps.repos, projectId, saved);
  };
}

/**
 * Arquivamento lógico: o resultado deixa de ser exibido, mas o registro e o histórico institucional são
 * preservados. Nunca há exclusão física. O fornecedor só arquiva o que cadastrou.
 */
export function makeArchiveResultUseCase(deps: Deps) {
  return async function archiveResult(actor: AuthUser, projectId: string, resultId: string) {
    const { context } = await loadViewableProject(deps.repos, actor, projectId);
    assertCanRegisterResults(context);

    await deps.runInTransaction(async (txRepos) => {
      const row = await txRepos.institutional.findResult(projectId, resultId, true);
      if (!row) {
        throw resultNotFoundError();
      }
      assertCanRegisterResults(context, row.createdBy, actor.id);
      if (row.archivedAt) {
        throw new HttpError(409, "Este resultado já está arquivado.", "PROJECT_RESULT_ALREADY_ARCHIVED");
      }
      const archived = await txRepos.institutional.archiveResult(resultId, actor.id, new Date());
      if (!archived) {
        throw resultNotFoundError();
      }
      await recordInstitutionalAudit(txRepos, {
        projectId,
        actorId: actor.id,
        entityType: "PROJECT_RESULT",
        entityId: resultId,
        action: "UPDATE",
        summary: "Resultado arquivado.",
        payload: {
          kind: "RESULT_ARCHIVE",
          type: row.type,
          publishedText: row.publishedText,
          draftText: row.draftText,
        },
      });
    });
  };
}
