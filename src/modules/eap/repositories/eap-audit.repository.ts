import { and, desc, eq } from "drizzle-orm";

import { eapAuditLogs } from "../../../db/schema";
import type { DbClient } from "../../../db/types";
import type { EapAuditRepository, NewEapAuditLogRecord } from "./contracts";

export class DrizzleEapAuditRepository implements EapAuditRepository {
  constructor(private readonly client: DbClient) {}

  async create(data: NewEapAuditLogRecord) {
    const [row] = await this.client.insert(eapAuditLogs).values(data).returning();
    return row;
  }

  async findLatestByEntityAction(entityType: string, entityId: string, action: NewEapAuditLogRecord["action"]) {
    const [row] = await this.client
      .select()
      .from(eapAuditLogs)
      .where(
        and(
          eq(eapAuditLogs.entityType, entityType),
          eq(eapAuditLogs.entityId, entityId),
          eq(eapAuditLogs.action, action),
        ),
      )
      .orderBy(desc(eapAuditLogs.createdAt))
      .limit(1);

    return row ?? null;
  }
}
