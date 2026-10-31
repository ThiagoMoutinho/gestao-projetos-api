import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { toProfileFieldView } from "../dtos/institutional.dto";
import type { InstitutionalTransactionRunner, ProfileField, InstitutionalRepos } from "../repositories/contracts";
import {
  assertCanEditInstitutional,
  DIRECT_PUBLISH_FIELDS,
  FIELD_LABELS,
  loadNames,
  loadViewableProject,
  profileMaxLength,
  recordInstitutionalAudit,
  unchangedValueError,
} from "./shared";

/**
 * Salva a edição de um campo de "Sobre o projeto". O próprio gestor informa esses campos, então a alteração é
 * publicada na hora (a auditoria registra autor, valor anterior e novo). Só rascunhos antigos, anteriores a esta
 * regra, ainda podem aguardar validação do PMO.
 */
export function makeSaveProfileFieldUseCase(deps: {
  repos: InstitutionalRepos;
  runInTransaction: InstitutionalTransactionRunner;
}) {
  return async function saveProfileField(actor: AuthUser, projectId: string, field: ProfileField, value: string) {
    const { context } = await loadViewableProject(deps.repos, actor, projectId);
    assertCanEditInstitutional(context);
    const max = profileMaxLength(field);
    if (value.length > max) {
      throw new HttpError(400, `${FIELD_LABELS[field]} aceita até ${max} caracteres.`, "PROFILE_VALUE_TOO_LONG");
    }

    const saved = await deps.runInTransaction(async (txRepos) => {
      const current = await txRepos.institutional.findProfileField(projectId, field, true);
      const direct = DIRECT_PUBLISH_FIELDS.has(field);
      const latest = direct ? (current?.publishedValue ?? null) : (current?.draftValue ?? current?.publishedValue ?? null);
      if (latest === value) {
        throw unchangedValueError();
      }

      if (direct) {
        // Valores lidos antes de gravar: a auditoria registra o que existia.
        const previousPublished = current?.publishedValue ?? null;
        const discardedDraft = current?.draftValue ?? null;
        const published = await txRepos.institutional.publishProfileDirect({
          id: crypto.randomUUID(),
          projectId,
          field,
          value,
          actorId: actor.id,
          at: new Date(),
        });
        await recordInstitutionalAudit(txRepos, {
          projectId,
          actorId: actor.id,
          entityType: "PROJECT_PROFILE",
          entityId: projectId,
          action: current ? "UPDATE" : "CREATE",
          summary: `${FIELD_LABELS[field]} informado pelo gestor.`,
          payload: {
            kind: "PROFILE_DIRECT",
            field,
            value,
            previousPublished,
            discardedDraft,
          },
        });
        return published;
      }

      const row = await txRepos.institutional.saveProfileDraft({
        id: crypto.randomUUID(),
        projectId,
        field,
        value,
        actorId: actor.id,
        at: new Date(),
      });
      await recordInstitutionalAudit(txRepos, {
        projectId,
        actorId: actor.id,
        entityType: "PROJECT_PROFILE",
        entityId: projectId,
        action: current ? "UPDATE" : "CREATE",
        summary: `${FIELD_LABELS[field]} salvo como rascunho, aguardando validação.`,
        payload: {
          kind: "PROFILE_DRAFT",
          field,
          value,
          previousDraft: current?.draftValue ?? null,
          previousDraftBy: current?.draftBy ?? null,
          publishedValue: current?.publishedValue ?? null,
        },
      });
      return row;
    });

    const names = await loadNames(deps.repos, [saved.publishedBy, saved.validatedBy, saved.draftBy]);
    return toProfileFieldView(field, saved, names, true);
  };
}
