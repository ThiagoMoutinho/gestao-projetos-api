import { and, asc, eq, max } from "drizzle-orm";

import { eapMilestones, eapPhases } from "../../../db/schema";
import type { DbClient } from "../../../db/types";
import type {
  EapMilestonesRepository,
  EapMilestoneUpdateRecord,
  NewEapMilestoneRecord,
} from "./contracts";

export class DrizzleEapMilestonesRepository implements EapMilestonesRepository {
  constructor(private readonly client: DbClient) {}

  async listByPhase(phaseId: string) {
    return this.client
      .select()
      .from(eapMilestones)
      .where(eq(eapMilestones.phaseId, phaseId))
      .orderBy(asc(eapMilestones.sortOrder), asc(eapMilestones.createdAt));
  }

  async listByProject(projectId: string) {
    const rows = await this.client
      .select({ milestone: eapMilestones })
      .from(eapMilestones)
      .innerJoin(eapPhases, eq(eapPhases.id, eapMilestones.phaseId))
      .where(eq(eapPhases.projectId, projectId))
      .orderBy(asc(eapMilestones.sortOrder), asc(eapMilestones.createdAt));

    return rows.map((row) => row.milestone);
  }

  async findById(milestoneId: string) {
    const [row] = await this.client
      .select()
      .from(eapMilestones)
      .where(eq(eapMilestones.id, milestoneId))
      .limit(1);

    return row ?? null;
  }

  async findByIdAndPhase(milestoneId: string, phaseId: string) {
    const [row] = await this.client
      .select()
      .from(eapMilestones)
      .where(and(eq(eapMilestones.id, milestoneId), eq(eapMilestones.phaseId, phaseId)))
      .limit(1);

    return row ?? null;
  }

  async findMaxSortOrder(phaseId: string) {
    const [row] = await this.client
      .select({ value: max(eapMilestones.sortOrder) })
      .from(eapMilestones)
      .where(eq(eapMilestones.phaseId, phaseId));

    return row?.value ?? null;
  }

  async replaceSortOrders(
    phaseId: string,
    items: Array<{ milestoneId: string; sortOrder: number }>,
    updatedBy: string,
    updatedAt: Date,
  ) {
    const current = await this.listByPhase(phaseId);
    const maxCurrent = current.reduce((maxValue, milestone) => Math.max(maxValue, milestone.sortOrder), -1);
    const maxTarget = items.reduce((maxValue, item) => Math.max(maxValue, item.sortOrder), -1);
    const tempBase = Math.max(maxCurrent, maxTarget) + 1;

    for (const [index, item] of items.entries()) {
      await this.client
        .update(eapMilestones)
        .set({ sortOrder: tempBase + index, updatedBy, updatedAt })
        .where(and(eq(eapMilestones.id, item.milestoneId), eq(eapMilestones.phaseId, phaseId)));
    }

    for (const item of items) {
      await this.client
        .update(eapMilestones)
        .set({ sortOrder: item.sortOrder, updatedBy, updatedAt })
        .where(and(eq(eapMilestones.id, item.milestoneId), eq(eapMilestones.phaseId, phaseId)));
    }

    return this.listByPhase(phaseId);
  }

  async create(data: NewEapMilestoneRecord) {
    const [row] = await this.client.insert(eapMilestones).values(data).returning();
    return row;
  }

  async update(milestoneId: string, phaseId: string, data: EapMilestoneUpdateRecord) {
    const [row] = await this.client
      .update(eapMilestones)
      .set(data)
      .where(and(eq(eapMilestones.id, milestoneId), eq(eapMilestones.phaseId, phaseId)))
      .returning();

    return row ?? null;
  }

  async delete(milestoneId: string, phaseId: string) {
    const rows = await this.client
      .delete(eapMilestones)
      .where(and(eq(eapMilestones.id, milestoneId), eq(eapMilestones.phaseId, phaseId)))
      .returning({ id: eapMilestones.id });

    return rows.length > 0;
  }
}
