import type { AuthUser } from "../../../lib/session";
import { toProfileFieldView, type DecisionInput } from "../dtos/institutional.dto";
import type { InstitutionalRepos, InstitutionalTransactionRunner, ProfileField } from "../repositories/contracts";
import {
  assertCanValidateInstitutional,
  FIELD_LABELS,
  loadNames,
  loadViewableProject,
  noPendingChangeError,
  recordInstitutionalAudit,
  selfValidationError,
} from "./shared";

/**
 * Valida (publica) ou rejeita a alteração pendente de um campo. Só PMO ou administração decidem, e quem
 * redigiu a alteração não a valida. A rejeição exige motivo e preserva a última versão publicada.
 */
export function makeDecideProfileFieldUseCase(deps: {
  repos: InstitutionalRepos;
  runInTransaction: InstitutionalTransactionRunner;
}) {
  return async function decideProfileField(
    actor: AuthUser,
    projectId: string,
    field: ProfileField,
    input: DecisionInput,
  ) {
    const { context } = await loadViewableProject(deps.repos, actor, projectId);
    assertCanValidateInstitutional(context);

    const saved = await deps.runInTransaction(async (txRepos) => {
      const row = await txRepos.institutional.findProfileField(projectId, field, true);
      if (!row || row.draftValue === null || row.draftBy === null) {
        throw noPendingChangeError();
      }
      const at = new Date();
      // Valores lidos antes da decisão: a auditoria registra o que foi validado ou rejeitado.
      const pendingValue = row.draftValue;
      const pendingAuthor = row.draftBy;
      const previousPublished = row.publishedValue;

      if (input.decision === "REJECT") {
        await txRepos.institutional.discardProfileDraft(row);
        await recordInstitutionalAudit(txRepos, {
          projectId,
          actorId: actor.id,
          entityType: "PROJECT_PROFILE",
          entityId: projectId,
          action: "INSTITUTIONAL_VALIDATE",
          summary: `Alteração de "${FIELD_LABELS[field]}" rejeitada.`,
          payload: {
            kind: "PROFILE_REJECT",
            decision: "REJECTED",
            field,
            reason: input.reason,
            rejectedValue: pendingValue,
            authorId: pendingAuthor,
          },
        });
        return txRepos.institutional.findProfileField(projectId, field);
      }

      if (pendingAuthor === actor.id) {
        throw selfValidationError();
      }
      const published = await txRepos.institutional.publishProfileDraft(row, actor.id, at);
      if (!published) {
        throw noPendingChangeError();
      }
      await recordInstitutionalAudit(txRepos, {
        projectId,
        actorId: actor.id,
        entityType: "PROJECT_PROFILE",
        entityId: projectId,
        action: "INSTITUTIONAL_VALIDATE",
        summary: `"${FIELD_LABELS[field]}" validado e publicado.`,
        payload: {
          kind: "PROFILE_VALIDATE",
          decision: "VALIDATED",
          field,
          value: pendingValue,
          authorId: pendingAuthor,
          previousPublished,
        },
      });
      return published;
    });

    const names = await loadNames(deps.repos, [saved?.publishedBy, saved?.validatedBy, saved?.draftBy]);
    return toProfileFieldView(field, saved ?? undefined, names, true);
  };
}
