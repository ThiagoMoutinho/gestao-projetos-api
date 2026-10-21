import { and, asc, eq, max } from "drizzle-orm";

import { eapTasks } from "../../../db/schema";
import type { DbClient } from "../../../db/types";
import type { EapTasksRepository, EapTaskUpdateRecord, NewEapTaskRecord } from "./contracts";

export class DrizzleEapTasksRepository implements EapTasksRepository {
  constructor(private readonly client: DbClient) {}

  async listByPhase(phaseId: string) {
    return this.client
      .select()
      .from(eapTasks)
      .where(eq(eapTasks.phaseId, phaseId))
      .orderBy(asc(eapTasks.sortOrder), asc(eapTasks.createdAt));
  }

  async findById(taskId: string) {
    const [row] = await this.client
      .select()
      .from(eapTasks)
      .where(eq(eapTasks.id, taskId))
      .limit(1);

    return row ?? null;
  }

  async findByIdAndPhase(taskId: string, phaseId: string) {
    const [row] = await this.client
      .select()
      .from(eapTasks)
      .where(and(eq(eapTasks.id, taskId), eq(eapTasks.phaseId, phaseId)))
      .limit(1);

    return row ?? null;
  }

  async findMaxSortOrder(phaseId: string) {
    const [row] = await this.client
      .select({ value: max(eapTasks.sortOrder) })
      .from(eapTasks)
      .where(eq(eapTasks.phaseId, phaseId));

    return row?.value ?? null;
  }

  async replaceSortOrders(
    phaseId: string,
    items: Array<{ taskId: string; sortOrder: number }>,
    updatedBy: string,
    updatedAt: Date,
  ) {
    const current = await this.listByPhase(phaseId);
    const maxCurrent = current.reduce((maxValue, task) => Math.max(maxValue, task.sortOrder), -1);
    const maxTarget = items.reduce((maxValue, item) => Math.max(maxValue, item.sortOrder), -1);
    const tempBase = Math.max(maxCurrent, maxTarget) + 1;

    for (const [index, item] of items.entries()) {
      await this.client
        .update(eapTasks)
        .set({ sortOrder: tempBase + index, updatedBy, updatedAt })
        .where(and(eq(eapTasks.id, item.taskId), eq(eapTasks.phaseId, phaseId)));
    }

    for (const item of items) {
      await this.client
        .update(eapTasks)
        .set({ sortOrder: item.sortOrder, updatedBy, updatedAt })
        .where(and(eq(eapTasks.id, item.taskId), eq(eapTasks.phaseId, phaseId)));
    }

    return this.listByPhase(phaseId);
  }

  async create(data: NewEapTaskRecord) {
    const [row] = await this.client.insert(eapTasks).values(data).returning();
    return row;
  }

  async update(taskId: string, phaseId: string, data: EapTaskUpdateRecord) {
    const [row] = await this.client
      .update(eapTasks)
      .set(data)
      .where(and(eq(eapTasks.id, taskId), eq(eapTasks.phaseId, phaseId)))
      .returning();

    return row ?? null;
  }
}
