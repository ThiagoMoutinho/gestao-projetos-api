import { eq } from "drizzle-orm";

import { eapScheduleRequests } from "../../../db/schema";
import type { DbClient } from "../../../db/types";
import type { EapScheduleRequestsRepository } from "./contracts";

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
}
