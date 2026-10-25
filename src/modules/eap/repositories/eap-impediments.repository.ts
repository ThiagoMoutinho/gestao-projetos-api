import { and, desc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { eapImpediments, user } from "../../../db/schema";
import type { DbClient } from "../../../db/types";
import {
  isUniqueViolation,
  UniqueConstraintError,
} from "../../../lib/postgres-errors";
import type {
  EapImpedimentsRepository,
  EapImpedimentUpdateRecord,
  NewEapImpedimentRecord,
} from "./contracts";

export class DrizzleEapImpedimentsRepository implements EapImpedimentsRepository {
  constructor(private readonly client: DbClient) {}

  async listByTask(taskId: string) {
    const opener = alias(user, "opener");
    const resolver = alias(user, "resolver");
    const rows = await this.client
      .select({ impediment: eapImpediments, openedByName: opener.name, resolvedByName: resolver.name })
      .from(eapImpediments)
      .leftJoin(opener, eq(eapImpediments.openedBy, opener.id))
      .leftJoin(resolver, eq(eapImpediments.resolvedBy, resolver.id))
      .where(eq(eapImpediments.taskId, taskId))
      .orderBy(desc(eapImpediments.openedAt));

    return rows.map((row) => ({
      ...row.impediment,
      openedByName: row.openedByName,
      resolvedByName: row.resolvedByName,
    }));
  }

  async findOpenByTask(taskId: string) {
    const [row] = await this.client
      .select()
      .from(eapImpediments)
      .where(and(eq(eapImpediments.taskId, taskId), isNull(eapImpediments.resolvedAt)))
      .limit(1);

    return row ?? null;
  }

  async create(data: NewEapImpedimentRecord) {
    try {
      const [row] = await this.client.insert(eapImpediments).values(data).returning();
      return row;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new UniqueConstraintError();
      }

      throw error;
    }
  }

  async update(impedimentId: string, data: EapImpedimentUpdateRecord) {
    const [row] = await this.client
      .update(eapImpediments)
      .set(data)
      .where(eq(eapImpediments.id, impedimentId))
      .returning();

    return row ?? null;
  }
}
