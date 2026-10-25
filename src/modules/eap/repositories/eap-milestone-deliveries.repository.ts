import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { eapMilestoneDeliveries, eapMilestones, eapPhases, user } from "../../../db/schema";
import type { DbClient } from "../../../db/types";
import type {
  EapMilestoneDeliveriesRepository,
  EapMilestoneDeliveryDecisionRecord,
  EapMilestoneDeliveryResubmissionRecord,
  NewEapMilestoneDeliveryRecord,
} from "./contracts";

export class DrizzleEapMilestoneDeliveriesRepository implements EapMilestoneDeliveriesRepository {
  constructor(private readonly client: DbClient) {}

  async listByMilestone(milestoneId: string) {
    const submitter = alias(user, "submitter");
    const decider = alias(user, "decider");
    const authorizer = alias(user, "authorizer");
    const rows = await this.client
      .select({
        delivery: eapMilestoneDeliveries,
        submittedByName: submitter.name,
        decidedByName: decider.name,
        resubmissionAuthorizedByName: authorizer.name,
      })
      .from(eapMilestoneDeliveries)
      .leftJoin(submitter, eq(eapMilestoneDeliveries.submittedBy, submitter.id))
      .leftJoin(decider, eq(eapMilestoneDeliveries.decidedBy, decider.id))
      .leftJoin(authorizer, eq(eapMilestoneDeliveries.resubmissionAuthorizedBy, authorizer.id))
      .where(eq(eapMilestoneDeliveries.milestoneId, milestoneId))
      .orderBy(asc(eapMilestoneDeliveries.round));

    return rows.map((row) => ({
      ...row.delivery,
      submittedByName: row.submittedByName,
      decidedByName: row.decidedByName,
      resubmissionAuthorizedByName: row.resubmissionAuthorizedByName,
    }));
  }

  async listByProject(projectId: string) {
    const rows = await this.client
      .select({ delivery: eapMilestoneDeliveries })
      .from(eapMilestoneDeliveries)
      .innerJoin(eapMilestones, eq(eapMilestoneDeliveries.milestoneId, eapMilestones.id))
      .innerJoin(eapPhases, eq(eapMilestones.phaseId, eapPhases.id))
      .where(eq(eapPhases.projectId, projectId))
      .orderBy(asc(eapMilestoneDeliveries.milestoneId), asc(eapMilestoneDeliveries.round));

    return rows.map((row) => row.delivery);
  }

  async findLatest(milestoneId: string) {
    const [row] = await this.client
      .select()
      .from(eapMilestoneDeliveries)
      .where(eq(eapMilestoneDeliveries.milestoneId, milestoneId))
      .orderBy(desc(eapMilestoneDeliveries.round))
      .limit(1);

    return row ?? null;
  }

  async create(data: NewEapMilestoneDeliveryRecord) {
    const [row] = await this.client.insert(eapMilestoneDeliveries).values(data).returning();
    return row;
  }

  async decide(deliveryId: string, data: EapMilestoneDeliveryDecisionRecord) {
    const [row] = await this.client
      .update(eapMilestoneDeliveries)
      .set(data)
      .where(
        and(
          eq(eapMilestoneDeliveries.id, deliveryId),
          eq(eapMilestoneDeliveries.status, "EM_ANALISE"),
        ),
      )
      .returning();

    return row ?? null;
  }

  async authorizeResubmission(deliveryId: string, data: EapMilestoneDeliveryResubmissionRecord) {
    const [row] = await this.client
      .update(eapMilestoneDeliveries)
      .set(data)
      .where(
        and(
          eq(eapMilestoneDeliveries.id, deliveryId),
          eq(eapMilestoneDeliveries.status, "REJEITADA"),
          isNull(eapMilestoneDeliveries.resubmissionAuthorizedAt),
        ),
      )
      .returning();

    return row ?? null;
  }
}
