import { and, asc, desc, eq } from "drizzle-orm";

import {
  deliveryChecklistTemplateItems,
  deliveryChecklistTemplateRevisions,
  deliveryChecklistTemplates,
} from "../../../db/schema";
import type { DbClient } from "../../../db/types";
import type {
  ChecklistRevisionRow,
  ChecklistRevisionWithItems,
  ChecklistTemplateItemRow,
  ChecklistTemplateRow,
  DeliveryComplianceRepository,
  DeliveryNature,
  SaveChecklistDraftInput,
} from "./delivery-compliance.contract";

type RevisionJoin = { revision: typeof deliveryChecklistTemplateRevisions.$inferSelect; nature: string };

function toRevision({ revision, nature }: RevisionJoin): ChecklistRevisionRow {
  return {
    id: revision.id,
    templateId: revision.templateId,
    nature: nature as DeliveryNature,
    revision: revision.revision,
    status: revision.status as ChecklistRevisionRow["status"],
    isProposal: revision.isProposal,
    sourceNote: revision.sourceNote,
    notes: revision.notes,
    createdBy: revision.createdBy,
    createdAt: revision.createdAt,
    publishedBy: revision.publishedBy,
    publishedAt: revision.publishedAt,
  };
}

export class DrizzleDeliveryComplianceRepository implements DeliveryComplianceRepository {
  constructor(private readonly client: DbClient) {}

  async listTemplates(): Promise<ChecklistTemplateRow[]> {
    const rows = await this.client.select().from(deliveryChecklistTemplates).orderBy(asc(deliveryChecklistTemplates.name));
    return rows.map((row) => ({ id: row.id, nature: row.nature as DeliveryNature, name: row.name }));
  }

  private revisionQuery() {
    return this.client
      .select({ revision: deliveryChecklistTemplateRevisions, nature: deliveryChecklistTemplates.nature })
      .from(deliveryChecklistTemplateRevisions)
      .innerJoin(deliveryChecklistTemplates, eq(deliveryChecklistTemplates.id, deliveryChecklistTemplateRevisions.templateId));
  }

  private async withItems(row: RevisionJoin | undefined): Promise<ChecklistRevisionWithItems | null> {
    if (!row) return null;
    const items = await this.client
      .select()
      .from(deliveryChecklistTemplateItems)
      .where(eq(deliveryChecklistTemplateItems.revisionId, row.revision.id))
      .orderBy(asc(deliveryChecklistTemplateItems.position));
    return { ...toRevision(row), items: items as ChecklistTemplateItemRow[] };
  }

  async listRevisions(nature: DeliveryNature) {
    const rows = await this.revisionQuery()
      .where(eq(deliveryChecklistTemplates.nature, nature))
      .orderBy(desc(deliveryChecklistTemplateRevisions.revision));
    return rows.map(toRevision);
  }

  async getRevision(revisionId: string) {
    const [row] = await this.revisionQuery().where(eq(deliveryChecklistTemplateRevisions.id, revisionId)).limit(1);
    return this.withItems(row);
  }

  async getLatestPublished(nature: DeliveryNature) {
    const [row] = await this.revisionQuery()
      .where(and(eq(deliveryChecklistTemplates.nature, nature), eq(deliveryChecklistTemplateRevisions.status, "PUBLICADA")))
      .orderBy(desc(deliveryChecklistTemplateRevisions.revision))
      .limit(1);
    return this.withItems(row);
  }

  async getDraft(nature: DeliveryNature) {
    const [row] = await this.revisionQuery()
      .where(and(eq(deliveryChecklistTemplates.nature, nature), eq(deliveryChecklistTemplateRevisions.status, "RASCUNHO")))
      .limit(1);
    return this.withItems(row);
  }

  async saveDraft(input: SaveChecklistDraftInput) {
    const [template] = await this.client
      .select()
      .from(deliveryChecklistTemplates)
      .where(eq(deliveryChecklistTemplates.nature, input.nature))
      .limit(1);
    if (!template) {
      throw new Error(`Modelo de checklist inexistente: ${input.nature}`);
    }

    const existing = await this.getDraft(input.nature);
    let revisionId: string;
    if (existing) {
      revisionId = existing.id;
      await this.client
        .update(deliveryChecklistTemplateRevisions)
        .set({ notes: input.notes, isProposal: input.isProposal, sourceNote: input.sourceNote })
        .where(eq(deliveryChecklistTemplateRevisions.id, revisionId));
      // Itens de rascunho nunca são referenciados por versões de entrega, então podem ser substituídos.
      await this.client.delete(deliveryChecklistTemplateItems).where(eq(deliveryChecklistTemplateItems.revisionId, revisionId));
    } else {
      const [latest] = await this.client
        .select({ revision: deliveryChecklistTemplateRevisions.revision })
        .from(deliveryChecklistTemplateRevisions)
        .where(eq(deliveryChecklistTemplateRevisions.templateId, template.id))
        .orderBy(desc(deliveryChecklistTemplateRevisions.revision))
        .limit(1);
      revisionId = crypto.randomUUID();
      await this.client.insert(deliveryChecklistTemplateRevisions).values({
        id: revisionId,
        templateId: template.id,
        revision: (latest?.revision ?? 0) + 1,
        status: "RASCUNHO",
        isProposal: input.isProposal,
        sourceNote: input.sourceNote,
        notes: input.notes,
        createdBy: input.actorId,
        createdAt: input.now,
      });
    }

    await this.client.insert(deliveryChecklistTemplateItems).values(
      input.items.map((item, index) => ({
        id: crypto.randomUUID(),
        revisionId,
        position: index + 1,
        documentType: item.documentType,
        title: item.title,
        description: item.description,
        required: item.required,
      })),
    );

    return (await this.getRevision(revisionId)) as ChecklistRevisionWithItems;
  }

  async publishDraft(nature: DeliveryNature, actorId: string, now: Date) {
    const draft = await this.getDraft(nature);
    if (!draft) return null;
    await this.client
      .update(deliveryChecklistTemplateRevisions)
      .set({ status: "PUBLICADA", publishedBy: actorId, publishedAt: now })
      .where(and(eq(deliveryChecklistTemplateRevisions.id, draft.id), eq(deliveryChecklistTemplateRevisions.status, "RASCUNHO")));
    return this.getRevision(draft.id);
  }
}
