import { count, eq } from "drizzle-orm";

import { eapScheduleRequests } from "../../../db/schema";
import type { DbClient } from "../../../db/types";
import type { EapScheduleRequestsRepository, ScheduleRequestTarget } from "./contracts";

export class DrizzleEapScheduleRequestsRepository implements EapScheduleRequestsRepository {
  constructor(private readonly client: DbClient) {}

  async findById(id: string) {
    const [row] = await this.client
      .select({
        id: eapScheduleRequests.id,
        projectId: eapScheduleRequests.projectId,
      })
      .from(eapScheduleRequests)
      .where(eq(eapScheduleRequests.id, id))
      .limit(1);

    return row ?? null;
  }

  async countByTarget(target: ScheduleRequestTarget) {
    const condition =
      "phaseId" in target
        ? eq(eapScheduleRequests.phaseId, target.phaseId)
        : "taskId" in target
          ? eq(eapScheduleRequests.taskId, target.taskId)
          : eq(eapScheduleRequests.milestoneId, target.milestoneId);

    const [row] = await this.client
      .select({ total: count() })
      .from(eapScheduleRequests)
      .where(condition);

    return row?.total ?? 0;
  }
}
