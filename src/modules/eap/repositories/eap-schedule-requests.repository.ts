import { count, eq } from "drizzle-orm";

import { eapScheduleChanges, eapScheduleRequests } from "../../../db/schema";
import type { DbClient } from "../../../db/types";
import type {
  EapScheduleRequestsRepository,
  ScheduleRequestChangeRow,
  ScheduleRequestHistoryRow,
  ScheduleRequestTarget,
} from "./contracts";

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

  async listByProject(projectId: string): Promise<ScheduleRequestHistoryRow[]> {
    const rows = await this.client
      .select({
        id: eapScheduleRequests.id,
        phaseId: eapScheduleRequests.phaseId,
        taskId: eapScheduleRequests.taskId,
        milestoneId: eapScheduleRequests.milestoneId,
        field: eapScheduleRequests.field,
        baselineValue: eapScheduleRequests.baselineValue,
        expectedCurrentValue: eapScheduleRequests.expectedCurrentValue,
        proposedValue: eapScheduleRequests.proposedValue,
        justification: eapScheduleRequests.justification,
        status: eapScheduleRequests.status,
        requestedBy: eapScheduleRequests.requestedBy,
        requestedAt: eapScheduleRequests.requestedAt,
        reviewedBy: eapScheduleRequests.reviewedBy,
        reviewedAt: eapScheduleRequests.reviewedAt,
        decisionNote: eapScheduleRequests.decisionNote,
      })
      .from(eapScheduleRequests)
      .where(eq(eapScheduleRequests.projectId, projectId));

    return rows;
  }

  async listChangesByProject(projectId: string): Promise<ScheduleRequestChangeRow[]> {
    return this.client
      .select({
        requestId: eapScheduleChanges.requestId,
        field: eapScheduleChanges.field,
        oldValue: eapScheduleChanges.oldValue,
        newValue: eapScheduleChanges.newValue,
        createdAt: eapScheduleChanges.createdAt,
      })
      .from(eapScheduleChanges)
      .where(eq(eapScheduleChanges.projectId, projectId));
  }
}
