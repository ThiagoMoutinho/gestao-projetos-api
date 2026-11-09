import { and, asc, count, desc, eq, inArray } from "drizzle-orm";

import {
  deliveryChecklistTemplateItems,
  deliveryChecklistTemplateRevisions,
  deliveryChecklistTemplates,
  eapMilestoneDeliveries,
  projectDeliveryItemEvents,
  projectDeliveryVersionItems,
  projectDeliveryVersions,
} from "../../../db/schema";
import type { DbClient } from "../../../db/types";
import type {
  ChecklistRevisionRow,
  ChecklistRevisionWithItems,
  ChecklistTemplateItemRow,
  ChecklistTemplateRow,
  CreateDeliveryVersionInput,
  DecideDeliveryItemInput,
  DeliveryComplianceRepository,
  DeliveryItemEventRow,
  DeliveryNature,
  DeliveryVersionItemRow,
  DeliveryVersionRow,
  SaveChecklistDraftInput,
  SubmitDeliveryItemInput,
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

function toVersion(row: typeof projectDeliveryVersions.$inferSelect): DeliveryVersionRow {
  return { ...row, nature: row.nature as DeliveryNature };
}

function toVersionItem(row: typeof projectDeliveryVersionItems.$inferSelect): DeliveryVersionItemRow {
  return {
    ...row,
    status: row.status as DeliveryVersionItemRow["status"],
    evidenceKind: row.evidenceKind as DeliveryVersionItemRow["evidenceKind"],
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

  async listVersions(projectId: string) {
    const rows = await this.client
      .select()
      .from(projectDeliveryVersions)
      .where(eq(projectDeliveryVersions.projectId, projectId))
      .orderBy(desc(projectDeliveryVersions.createdAt), desc(projectDeliveryVersions.versionLabel));
    return rows.map(toVersion);
  }

  async getVersion(versionId: string) {
    const [row] = await this.client.select().from(projectDeliveryVersions).where(eq(projectDeliveryVersions.id, versionId)).limit(1);
    return row ? toVersion(row) : null;
  }

  async findVersionByLabel(projectId: string, versionLabel: string) {
    const [row] = await this.client
      .select()
      .from(projectDeliveryVersions)
      .where(and(eq(projectDeliveryVersions.projectId, projectId), eq(projectDeliveryVersions.versionLabel, versionLabel)))
      .limit(1);
    return row ? toVersion(row) : null;
  }

  async createVersion(input: CreateDeliveryVersionInput) {
    const id = crypto.randomUUID();
    const [version] = await this.client
      .insert(projectDeliveryVersions)
      .values({
        id,
        projectId: input.projectId,
        versionLabel: input.versionLabel,
        nature: input.nature,
        templateRevisionId: input.revision.id,
        notes: input.notes,
        createdBy: input.createdBy,
        createdAt: input.now,
      })
      .returning();
    const items = input.revision.items.length
      ? await this.client
          .insert(projectDeliveryVersionItems)
          .values(
            input.revision.items.map((item) => ({
              id: crypto.randomUUID(),
              versionId: id,
              templateItemId: item.id,
              position: item.position,
              documentType: item.documentType,
              title: item.title,
              description: item.description,
              required: item.required,
              createdAt: input.now,
              updatedAt: input.now,
            })),
          )
          .returning()
      : [];
    return { version: toVersion(version), items: items.map(toVersionItem).sort((left, right) => left.position - right.position) };
  }

  async listItems(versionIds: string[]) {
    if (versionIds.length === 0) return [];
    const rows = await this.client
      .select()
      .from(projectDeliveryVersionItems)
      .where(inArray(projectDeliveryVersionItems.versionId, versionIds))
      .orderBy(asc(projectDeliveryVersionItems.versionId), asc(projectDeliveryVersionItems.position));
    return rows.map(toVersionItem);
  }

  async countRoundsByVersion(versionIds: string[]) {
    if (versionIds.length === 0) return {};
    const rows = await this.client
      .select({ versionId: eapMilestoneDeliveries.deliveryVersionId, total: count() })
      .from(eapMilestoneDeliveries)
      .where(inArray(eapMilestoneDeliveries.deliveryVersionId, versionIds))
      .groupBy(eapMilestoneDeliveries.deliveryVersionId);
    return Object.fromEntries(rows.flatMap((row) => (row.versionId ? [[row.versionId, row.total]] : [])));
  }

  async getItem(itemId: string) {
    const [row] = await this.client.select().from(projectDeliveryVersionItems).where(eq(projectDeliveryVersionItems.id, itemId)).limit(1);
    return row ? toVersionItem(row) : null;
  }

  async submitItem(itemId: string, data: SubmitDeliveryItemInput) {
    const [row] = await this.client
      .update(projectDeliveryVersionItems)
      .set({
        status: "ENVIADO",
        evidenceKind: data.evidenceKind,
        evidenceRef: data.evidenceRef,
        submittedBy: data.submittedBy,
        submittedAt: data.submittedAt,
        decidedBy: null,
        decidedAt: null,
        decisionNote: null,
        updatedAt: data.submittedAt,
      })
      .where(and(eq(projectDeliveryVersionItems.id, itemId), inArray(projectDeliveryVersionItems.status, ["PENDENTE", "REJEITADO"])))
      .returning();
    return row ? toVersionItem(row) : null;
  }

  async decideItem(itemId: string, data: DecideDeliveryItemInput) {
    const allowed = data.status === "DISPENSADO" ? ["PENDENTE", "ENVIADO", "REJEITADO"] : ["ENVIADO"];
    const [row] = await this.client
      .update(projectDeliveryVersionItems)
      .set({
        status: data.status,
        decidedBy: data.decidedBy,
        decidedAt: data.decidedAt,
        decisionNote: data.decisionNote,
        updatedAt: data.decidedAt,
      })
      .where(and(eq(projectDeliveryVersionItems.id, itemId), inArray(projectDeliveryVersionItems.status, allowed)))
      .returning();
    return row ? toVersionItem(row) : null;
  }

  async setItemValidator(itemId: string, validatorId: string | null) {
    const [row] = await this.client
      .update(projectDeliveryVersionItems)
      .set({ validatorId })
      .where(eq(projectDeliveryVersionItems.id, itemId))
      .returning();
    return row ? toVersionItem(row) : null;
  }

  async addItemEvent(event: DeliveryItemEventRow) {
    await this.client.insert(projectDeliveryItemEvents).values({ ...event });
  }

  async listItemEvents(itemId: string) {
    const rows = await this.client
      .select()
      .from(projectDeliveryItemEvents)
      .where(eq(projectDeliveryItemEvents.itemId, itemId))
      .orderBy(asc(projectDeliveryItemEvents.createdAt), asc(projectDeliveryItemEvents.id));
    return rows.map((row) => ({
      ...row,
      action: row.action as DeliveryItemEventRow["action"],
      evidenceKind: row.evidenceKind as DeliveryItemEventRow["evidenceKind"],
    }));
  }
}
