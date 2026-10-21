import { and, asc, eq, max } from "drizzle-orm";

import { eapPhases } from "../../../db/schema";
import type { DbClient } from "../../../db/types";
import {
  isUniqueViolation,
  UniqueConstraintError,
} from "../../../lib/postgres-errors";
import type {
  EapPhaseUpdateRecord,
  EapPhasesRepository,
  NewEapPhaseRecord,
} from "./contracts";

export class DrizzleEapPhasesRepository implements EapPhasesRepository {
  constructor(private readonly client: DbClient) {}

  async listByProject(projectId: string) {
    return this.client
      .select()
      .from(eapPhases)
      .where(eq(eapPhases.projectId, projectId))
      .orderBy(asc(eapPhases.sortOrder), asc(eapPhases.createdAt));
  }

  async findById(phaseId: string) {
    const [row] = await this.client
      .select()
      .from(eapPhases)
      .where(eq(eapPhases.id, phaseId))
      .limit(1);

    return row ?? null;
  }

  async findByIdAndProject(phaseId: string, projectId: string) {
    const [row] = await this.client
      .select()
      .from(eapPhases)
      .where(and(eq(eapPhases.id, phaseId), eq(eapPhases.projectId, projectId)))
      .limit(1);

    return row ?? null;
  }

  async findMaxSortOrder(projectId: string) {
    const [row] = await this.client
      .select({ value: max(eapPhases.sortOrder) })
      .from(eapPhases)
      .where(eq(eapPhases.projectId, projectId));

    return row?.value ?? null;
  }

  async create(data: NewEapPhaseRecord) {
    try {
      const [row] = await this.client.insert(eapPhases).values(data).returning();
      return row;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new UniqueConstraintError();
      }

      throw error;
    }
  }

  async update(phaseId: string, projectId: string, data: EapPhaseUpdateRecord) {
    try {
      const [row] = await this.client
        .update(eapPhases)
        .set(data)
        .where(and(eq(eapPhases.id, phaseId), eq(eapPhases.projectId, projectId)))
        .returning();

      return row ?? null;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new UniqueConstraintError();
      }

      throw error;
    }
  }

  async replaceSortOrders(
    projectId: string,
    items: Array<{ phaseId: string; sortOrder: number }>,
    updatedBy: string,
    updatedAt: Date,
  ) {
    const current = await this.listByProject(projectId);
    const maxCurrent = current.reduce((maxValue, phase) => Math.max(maxValue, phase.sortOrder), -1);
    const maxTarget = items.reduce((maxValue, item) => Math.max(maxValue, item.sortOrder), -1);
    const tempBase = Math.max(maxCurrent, maxTarget) + 1;

    for (const [index, item] of items.entries()) {
      await this.client
        .update(eapPhases)
        .set({
          sortOrder: tempBase + index,
          updatedBy,
          updatedAt,
        })
        .where(and(eq(eapPhases.id, item.phaseId), eq(eapPhases.projectId, projectId)));
    }

    for (const item of items) {
      await this.client
        .update(eapPhases)
        .set({
          sortOrder: item.sortOrder,
          updatedBy,
          updatedAt,
        })
        .where(and(eq(eapPhases.id, item.phaseId), eq(eapPhases.projectId, projectId)));
    }

    return this.listByProject(projectId);
  }
}
