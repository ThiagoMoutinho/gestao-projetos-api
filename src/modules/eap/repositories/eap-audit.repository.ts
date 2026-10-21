import { and, desc, eq, or, sql } from "drizzle-orm";

import { eapAuditLogs, user } from "../../../db/schema";
import type { DbClient } from "../../../db/types";
import type {
  EapAuditEntityFilter,
  EapAuditRepository,
  NewEapAuditLogRecord,
} from "./contracts";

const evidenceParentKeys: Record<string, string> = {
  PHASE: "phaseId",
  TASK: "taskId",
  MILESTONE: "milestoneId",
};

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

  async listByEntity(filter: EapAuditEntityFilter) {
    const ownEntries = and(
      eq(eapAuditLogs.entityType, filter.entityType),
      eq(eapAuditLogs.entityId, filter.entityId),
    );
    const parentKey = evidenceParentKeys[filter.entityType];
    const scope =
      filter.includeEvidences && parentKey
        ? or(
            ownEntries,
            and(
              eq(eapAuditLogs.entityType, "EVIDENCE"),
              sql`${eapAuditLogs.payload} ->> ${parentKey} = ${filter.entityId}`,
            ),
          )
        : ownEntries;

    const rows = await this.client
      .select({ log: eapAuditLogs, actorName: user.name })
      .from(eapAuditLogs)
      .leftJoin(user, eq(eapAuditLogs.actorId, user.id))
      .where(and(eq(eapAuditLogs.projectId, filter.projectId), scope))
      .orderBy(desc(eapAuditLogs.createdAt), desc(eapAuditLogs.id))
      .limit(filter.limit);

    return rows.map((row) => ({ ...row.log, actorName: row.actorName }));
  }
}
