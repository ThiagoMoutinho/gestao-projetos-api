import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { canManageDeliveryTemplates } from "../eap.authorization";
import type { ChecklistRevisionWithItems, DeliveryNature } from "../repositories/delivery-compliance.contract";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import type { ChecklistRevisionDto, ChecklistTemplateDto, SaveChecklistDraftBody } from "../schemas/eap-delivery-compliance.schema";

export function toChecklistRevisionDto(revision: ChecklistRevisionWithItems): ChecklistRevisionDto {
  return {
    id: revision.id,
    revision: revision.revision,
    status: revision.status,
    isProposal: revision.isProposal,
    sourceNote: revision.sourceNote,
    notes: revision.notes,
    createdBy: revision.createdBy,
    createdAt: revision.createdAt.toISOString(),
    publishedBy: revision.publishedBy,
    publishedAt: revision.publishedAt?.toISOString() ?? null,
    items: revision.items.map((item) => ({
      id: item.id,
      position: item.position,
      documentType: item.documentType,
      title: item.title,
      description: item.description,
      required: item.required,
    })),
  };
}

function assertCanManage(actor: AuthUser) {
  if (!canManageDeliveryTemplates(actor.role)) {
    throw new HttpError(403, "Somente ADMIN e PMO gerenciam os modelos de checklist de entrega.", "DELIVERY_TEMPLATE_FORBIDDEN");
  }
}

/**
 * Modelos de checklist da Conformidade de Entrega. Qualquer usuário autenticado consulta a revisão publicada; só ADMIN e PMO
 * veem o rascunho, criam e publicam revisões. Revisão publicada nunca é alterada: versões de entrega já criadas guardam a sua
 * própria cópia dos itens, então publicar uma revisão nova não muda retroativamente nenhum checklist em uso.
 */
export function makeDeliveryChecklistTemplateUseCases(deps: { repos: EapRepos; runInTransaction: EapTransactionRunner }) {
  return {
    async listTemplates(actor: AuthUser): Promise<{ data: ChecklistTemplateDto[] }> {
      const canManage = canManageDeliveryTemplates(actor.role);
      const templates = await deps.repos.deliveryCompliance.listTemplates();
      const data = await Promise.all(
        templates.map(async (template) => {
          const [published, draft, revisions] = await Promise.all([
            deps.repos.deliveryCompliance.getLatestPublished(template.nature),
            canManage ? deps.repos.deliveryCompliance.getDraft(template.nature) : Promise.resolve(null),
            deps.repos.deliveryCompliance.listRevisions(template.nature),
          ]);
          return {
            nature: template.nature,
            name: template.name,
            published: published ? toChecklistRevisionDto(published) : null,
            draft: draft ? toChecklistRevisionDto(draft) : null,
            revisions: revisions
              .filter((revision) => canManage || revision.status === "PUBLICADA")
              .map((revision) => ({
                revision: revision.revision,
                status: revision.status,
                isProposal: revision.isProposal,
                publishedAt: revision.publishedAt?.toISOString() ?? null,
              })),
          };
        }),
      );
      return { data };
    },

    async saveDraft(actor: AuthUser, nature: DeliveryNature, body: SaveChecklistDraftBody): Promise<ChecklistRevisionDto> {
      assertCanManage(actor);
      const types = body.items.map((item) => item.documentType);
      const duplicated = types.find((type, index) => types.indexOf(type) !== index);
      if (duplicated) {
        throw new HttpError(400, `Tipo de documento repetido no modelo: ${duplicated}.`, "DELIVERY_TEMPLATE_DUPLICATED_TYPE");
      }

      return deps.runInTransaction(async (repos) => {
        const draft = await repos.deliveryCompliance.getDraft(nature);
        const base = draft ?? (await repos.deliveryCompliance.getLatestPublished(nature));
        // A marca de proposta só cai com a confirmação expressa da validação pela CTIN.
        const isProposal = body.ctinValidated === true ? false : (base?.isProposal ?? true);
        const saved = await repos.deliveryCompliance.saveDraft({
          nature,
          actorId: actor.id,
          notes: body.notes?.trim() ? body.notes.trim() : null,
          isProposal,
          sourceNote: body.sourceNote !== undefined ? (body.sourceNote?.trim() ? body.sourceNote.trim() : null) : (base?.sourceNote ?? null),
          items: body.items.map((item) => ({
            documentType: item.documentType,
            title: item.title,
            description: item.description?.trim() ? item.description.trim() : null,
            required: item.required,
          })),
          now: new Date(),
        });
        return toChecklistRevisionDto(saved);
      });
    },

    async publishDraft(actor: AuthUser, nature: DeliveryNature): Promise<ChecklistRevisionDto> {
      assertCanManage(actor);
      return deps.runInTransaction(async (repos) => {
        const published = await repos.deliveryCompliance.publishDraft(nature, actor.id, new Date());
        if (!published) {
          throw new HttpError(409, "Não há rascunho para publicar neste modelo.", "DELIVERY_TEMPLATE_NO_DRAFT");
        }
        return toChecklistRevisionDto(published);
      });
    },
  };
}

export type DeliveryChecklistTemplateUseCases = ReturnType<typeof makeDeliveryChecklistTemplateUseCases>;
