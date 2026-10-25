import { eapAuditLogs } from "../../../db/schema";
import type { DbClient } from "../../../db/types";
import type { NewProjectAuditRecord, ProjectAuditRepository } from "./contracts";

export class DrizzleProjectAuditRepository implements ProjectAuditRepository {
  constructor(private readonly client: DbClient) {}

  async create(data: NewProjectAuditRecord) {
    await this.client.insert(eapAuditLogs).values({ id: crypto.randomUUID(), ...data });
  }
}
