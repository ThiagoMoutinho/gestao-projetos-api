import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";

import {
  eapMilestones,
  eapPhases,
  projectHighlights,
  projectProfileFields,
  projectResultLinks,
  projectResults,
} from "../../../db/schema";
import type { DbClient } from "../../../db/types";
import type {
  EvolutionRow,
  InstitutionalRepository,
  ProfileField,
  ProfileFieldRow,
  ResultContent,
  ResultRow,
  ResultType,
} from "./contracts";

export class DrizzleInstitutionalRepository implements InstitutionalRepository {
  constructor(private readonly client: DbClient) {}

  async listProfileFields(projectId: string) {
    return this.client.select().from(projectProfileFields).where(eq(projectProfileFields.projectId, projectId));
  }

  async findProfileField(projectId: string, field: ProfileField, lock = false) {
    const query = this.client
      .select()
      .from(projectProfileFields)
      .where(and(eq(projectProfileFields.projectId, projectId), eq(projectProfileFields.field, field)))
      .limit(1);
    const [row] = lock ? await query.for("update") : await query;
    return row ?? null;
  }

  async saveProfileDraft(data: {
    id: string;
    projectId: string;
    field: ProfileField;
    value: string;
    actorId: string;
    at: Date;
  }) {
    const draft = { draftValue: data.value, draftBy: data.actorId, draftAt: data.at };
    const [row] = await this.client
      .insert(projectProfileFields)
      .values({ id: data.id, projectId: data.projectId, field: data.field, ...draft })
      .onConflictDoUpdate({
        target: [projectProfileFields.projectId, projectProfileFields.field],
        set: draft,
      })
      .returning();
    return row;
  }

  async publishProfileDirect(data: {
    id: string;
    projectId: string;
    field: ProfileField;
    value: string;
    actorId: string;
    at: Date;
  }) {
    const published = {
      publishedValue: data.value,
      publishedBy: data.actorId,
      publishedAt: data.at,
      validatedBy: null,
      validatedAt: null,
      draftValue: null,
      draftBy: null,
      draftAt: null,
    };
    const [row] = await this.client
      .insert(projectProfileFields)
      .values({ id: data.id, projectId: data.projectId, field: data.field, ...published })
      .onConflictDoUpdate({
        target: [projectProfileFields.projectId, projectProfileFields.field],
        set: published,
      })
      .returning();
    return row;
  }

  async publishProfileDraft(row: ProfileFieldRow, validatorId: string, at: Date) {
    const [updated] = await this.client
      .update(projectProfileFields)
      .set({
        publishedValue: sql`${projectProfileFields.draftValue}`,
        publishedBy: sql`${projectProfileFields.draftBy}`,
        publishedAt: sql`${projectProfileFields.draftAt}`,
        validatedBy: validatorId,
        validatedAt: at,
        draftValue: null,
        draftBy: null,
        draftAt: null,
      })
      .where(
        and(
          eq(projectProfileFields.id, row.id),
          isNotNull(projectProfileFields.draftValue),
          ne(projectProfileFields.draftBy, validatorId),
        ),
      )
      .returning();
    return updated ?? null;
  }

  async discardProfileDraft(row: ProfileFieldRow) {
    if (row.publishedValue === null) {
      await this.client.delete(projectProfileFields).where(eq(projectProfileFields.id, row.id));
      return;
    }
    await this.client
      .update(projectProfileFields)
      .set({ draftValue: null, draftBy: null, draftAt: null })
      .where(eq(projectProfileFields.id, row.id));
  }

  async listResults(projectId: string) {
    return this.client
      .select()
      .from(projectResults)
      .where(and(eq(projectResults.projectId, projectId), isNull(projectResults.archivedAt)))
      .orderBy(asc(projectResults.createdAt));
  }

  async findResult(projectId: string, resultId: string, lock = false) {
    const query = this.client
      .select()
      .from(projectResults)
      .where(and(eq(projectResults.id, resultId), eq(projectResults.projectId, projectId)))
      .limit(1);
    const [row] = lock ? await query.for("update") : await query;
    return row ?? null;
  }

  async createResult(data: {
    id: string;
    projectId: string;
    type: ResultType;
    content: ResultContent;
    direct: boolean;
    unforeseen: boolean;
    actorId: string;
    at: Date;
  }) {
    const slot = data.direct
      ? {
          publishedText: data.content.text,
          publishedResultDate: data.content.resultDate,
          publishedMilestoneId: data.content.milestoneId,
          publishedDetails: data.content.details,
          publishedBy: data.actorId,
          publishedAt: data.at,
        }
      : {
          draftText: data.content.text,
          draftResultDate: data.content.resultDate,
          draftMilestoneId: data.content.milestoneId,
          draftDetails: data.content.details,
          draftBy: data.actorId,
          draftAt: data.at,
        };
    const [row] = await this.client
      .insert(projectResults)
      .values({
        id: data.id,
        projectId: data.projectId,
        type: data.type,
        createdBy: data.actorId,
        createdAt: data.at,
        unforeseen: data.unforeseen,
        ...slot,
      })
      .returning();
    return row;
  }

  async saveResultDraft(resultId: string, content: ResultContent, actorId: string, at: Date) {
    const [row] = await this.client
      .update(projectResults)
      .set({
        draftText: content.text,
        draftResultDate: content.resultDate,
        draftMilestoneId: content.milestoneId,
        draftDetails: content.details,
        draftBy: actorId,
        draftAt: at,
        correctionReason: null,
        correctionBy: null,
        correctionAt: null,
      })
      .where(and(eq(projectResults.id, resultId), isNull(projectResults.archivedAt)))
      .returning();
    return row ?? null;
  }

  async publishResultDirect(resultId: string, content: ResultContent, actorId: string, at: Date) {
    const [row] = await this.client
      .update(projectResults)
      .set({
        publishedText: content.text,
        publishedResultDate: content.resultDate,
        publishedMilestoneId: content.milestoneId,
        publishedDetails: content.details,
        publishedBy: actorId,
        publishedAt: at,
        validatedBy: null,
        validatedAt: null,
        draftText: null,
        draftResultDate: null,
        draftMilestoneId: null,
        draftDetails: null,
        draftBy: null,
        draftAt: null,
      })
      .where(and(eq(projectResults.id, resultId), isNull(projectResults.archivedAt)))
      .returning();
    return row ?? null;
  }

  async publishResultDraft(row: ResultRow, validatorId: string, at: Date) {
    const [updated] = await this.client
      .update(projectResults)
      .set({
        publishedText: sql`${projectResults.draftText}`,
        publishedResultDate: sql`${projectResults.draftResultDate}`,
        publishedMilestoneId: sql`${projectResults.draftMilestoneId}`,
        publishedDetails: sql`${projectResults.draftDetails}`,
        publishedBy: sql`${projectResults.draftBy}`,
        publishedAt: sql`${projectResults.draftAt}`,
        validatedBy: validatorId,
        validatedAt: at,
        draftText: null,
        draftResultDate: null,
        draftMilestoneId: null,
        draftDetails: null,
        draftBy: null,
        draftAt: null,
        correctionReason: null,
        correctionBy: null,
        correctionAt: null,
      })
      .where(
        and(
          eq(projectResults.id, row.id),
          isNull(projectResults.archivedAt),
          isNotNull(projectResults.draftText),
          ne(projectResults.draftBy, validatorId),
        ),
      )
      .returning();
    return updated ?? null;
  }

  async requestResultCorrections(resultId: string, reason: string, actorId: string, at: Date) {
    const [row] = await this.client
      .update(projectResults)
      .set({ correctionReason: reason, correctionBy: actorId, correctionAt: at })
      .where(and(eq(projectResults.id, resultId), isNull(projectResults.archivedAt), isNotNull(projectResults.draftText)))
      .returning();
    return row ?? null;
  }

  async setResultUnforeseen(resultId: string, unforeseen: boolean) {
    await this.client.update(projectResults).set({ unforeseen }).where(eq(projectResults.id, resultId));
  }

  async listResultLinks(projectId: string) {
    const ids = await this.client.select({ id: projectResults.id }).from(projectResults).where(eq(projectResults.projectId, projectId));
    if (ids.length === 0) {
      return [];
    }
    return this.client
      .select()
      .from(projectResultLinks)
      .where(inArray(projectResultLinks.achievedId, ids.map((item) => item.id)));
  }

  async replaceResultLinks(achievedId: string, expectedIds: string[], actorId: string, at: Date) {
    await this.client.delete(projectResultLinks).where(eq(projectResultLinks.achievedId, achievedId));
    if (expectedIds.length > 0) {
      await this.client.insert(projectResultLinks).values(
        expectedIds.map((expectedId) => ({ id: crypto.randomUUID(), achievedId, expectedId, linkedBy: actorId, linkedAt: at })),
      );
    }
  }

  async archiveResult(resultId: string, actorId: string, at: Date) {
    const [row] = await this.client
      .update(projectResults)
      .set({ archivedBy: actorId, archivedAt: at })
      .where(and(eq(projectResults.id, resultId), isNull(projectResults.archivedAt)))
      .returning();
    return row ?? null;
  }

  async listHighlights(projectId: string) {
    return this.client
      .select()
      .from(projectHighlights)
      .where(eq(projectHighlights.projectId, projectId))
      .orderBy(asc(projectHighlights.sortOrder), asc(projectHighlights.highlightedAt));
  }

  async findHighlight(projectId: string, milestoneId: string) {
    const [row] = await this.client
      .select()
      .from(projectHighlights)
      .where(and(eq(projectHighlights.projectId, projectId), eq(projectHighlights.milestoneId, milestoneId)))
      .limit(1);
    return row ?? null;
  }

  async addHighlight(data: { id: string; projectId: string; milestoneId: string; actorId: string }) {
    const [{ next }] = await this.client
      .select({ next: sql<number>`coalesce(max(${projectHighlights.sortOrder}), -1) + 1` })
      .from(projectHighlights)
      .where(eq(projectHighlights.projectId, data.projectId));
    const [row] = await this.client
      .insert(projectHighlights)
      .values({
        id: data.id,
        projectId: data.projectId,
        milestoneId: data.milestoneId,
        highlightedBy: data.actorId,
        sortOrder: Number(next),
      })
      .returning();
    return row;
  }

  async removeHighlight(projectId: string, milestoneId: string) {
    const rows = await this.client
      .delete(projectHighlights)
      .where(and(eq(projectHighlights.projectId, projectId), eq(projectHighlights.milestoneId, milestoneId)))
      .returning({ id: projectHighlights.id });
    return rows.length > 0;
  }

  async findMilestoneInProject(projectId: string, milestoneId: string) {
    const [row] = await this.client
      .select({ id: eapMilestones.id, title: eapMilestones.title, status: eapMilestones.status })
      .from(eapMilestones)
      .innerJoin(eapPhases, eq(eapMilestones.phaseId, eapPhases.id))
      .where(and(eq(eapMilestones.id, milestoneId), eq(eapPhases.projectId, projectId)))
      .limit(1);
    return row ?? null;
  }

  async listApprovedMilestones(projectId: string): Promise<EvolutionRow[]> {
    return this.client
      .select({
        milestoneId: eapMilestones.id,
        title: eapMilestones.title,
        phaseId: eapPhases.id,
        phaseName: eapPhases.name,
        type: eapMilestones.type,
        status: eapMilestones.status,
        plannedAt: eapMilestones.plannedAt,
        actualAt: eapMilestones.actualAt,
        validatedAt: eapMilestones.validatedAt,
      })
      .from(eapMilestones)
      .innerJoin(eapPhases, eq(eapMilestones.phaseId, eapPhases.id))
      .where(and(eq(eapPhases.projectId, projectId), eq(eapMilestones.status, "APROVADO")))
      .orderBy(asc(eapMilestones.actualAt), asc(eapMilestones.plannedAt));
  }
}
