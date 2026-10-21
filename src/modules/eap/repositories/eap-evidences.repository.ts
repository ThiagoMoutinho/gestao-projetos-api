import { and, asc, eq, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { eapEvidences, eapMilestones, eapPhases, eapScheduleRequests, eapTasks } from "../../../db/schema";
import type { DbClient } from "../../../db/types";
import type {
  EapEvidencesRepository,
  EapEvidenceUpdateRecord,
  EvidenceParentFilter,
  NewEapEvidenceRecord,
} from "./contracts";

const taskPhases = alias(eapPhases, "evidence_task_phases");
const milestonePhases = alias(eapPhases, "evidence_milestone_phases");

export class DrizzleEapEvidencesRepository implements EapEvidencesRepository {
  constructor(private readonly client: DbClient) {}

  private projectScope(projectId: string) {
    return or(
      eq(taskPhases.projectId, projectId),
      eq(milestonePhases.projectId, projectId),
      eq(eapScheduleRequests.projectId, projectId),
    );
  }

  private scopedQuery(projectId: string, filter: EvidenceParentFilter, evidenceId?: string) {
    const conditions = [this.projectScope(projectId)];
    if (evidenceId) {
      conditions.push(eq(eapEvidences.id, evidenceId));
    }
    if (filter.taskId) {
      conditions.push(eq(eapEvidences.taskId, filter.taskId));
    }
    if (filter.milestoneId) {
      conditions.push(eq(eapEvidences.milestoneId, filter.milestoneId));
    }
    if (filter.scheduleRequestId) {
      conditions.push(eq(eapEvidences.scheduleRequestId, filter.scheduleRequestId));
    }

    return this.client
      .select({ evidence: eapEvidences })
      .from(eapEvidences)
      .leftJoin(eapTasks, eq(eapEvidences.taskId, eapTasks.id))
      .leftJoin(taskPhases, eq(eapTasks.phaseId, taskPhases.id))
      .leftJoin(eapMilestones, eq(eapEvidences.milestoneId, eapMilestones.id))
      .leftJoin(milestonePhases, eq(eapMilestones.phaseId, milestonePhases.id))
      .leftJoin(eapScheduleRequests, eq(eapEvidences.scheduleRequestId, eapScheduleRequests.id))
      .where(and(...conditions))
      .orderBy(asc(eapEvidences.createdAt), asc(eapEvidences.title));
  }

  async listByProject(projectId: string, filter: EvidenceParentFilter) {
    const rows = await this.scopedQuery(projectId, filter);
    return rows.map((row) => row.evidence);
  }

  async findByIdAndProject(evidenceId: string, projectId: string) {
    const rows = await this.scopedQuery(projectId, {}, evidenceId).limit(1);
    return rows[0]?.evidence ?? null;
  }

  async create(data: NewEapEvidenceRecord) {
    const [row] = await this.client.insert(eapEvidences).values(data).returning();
    return row;
  }

  async update(evidenceId: string, data: EapEvidenceUpdateRecord) {
    const [row] = await this.client
      .update(eapEvidences)
      .set(data)
      .where(eq(eapEvidences.id, evidenceId))
      .returning();

    return row ?? null;
  }
}
