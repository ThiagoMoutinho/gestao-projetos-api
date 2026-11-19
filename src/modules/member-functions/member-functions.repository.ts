import { asc, eq } from "drizzle-orm";

import { projectMemberFunctions } from "../../db/schema";
import type { DbClient } from "../../db/types";
import { isUniqueViolation, UniqueConstraintError } from "../../lib/postgres-errors";

export type MemberFunctionRow = typeof projectMemberFunctions.$inferSelect;

export interface MemberFunctionsRepository {
  list(includeInactive: boolean): Promise<MemberFunctionRow[]>;
  findById(id: string): Promise<MemberFunctionRow | null>;
  findByKey(nameKey: string): Promise<MemberFunctionRow | null>;
  create(data: { id: string; name: string; nameKey: string; createdBy: string }): Promise<MemberFunctionRow>;
  setActive(id: string, isActive: boolean): Promise<MemberFunctionRow | null>;
}

export class DrizzleMemberFunctionsRepository implements MemberFunctionsRepository {
  constructor(private readonly client: DbClient) {}

  async list(includeInactive: boolean) {
    const query = this.client.select().from(projectMemberFunctions);
    return includeInactive
      ? query.orderBy(asc(projectMemberFunctions.nameKey))
      : query.where(eq(projectMemberFunctions.isActive, true)).orderBy(asc(projectMemberFunctions.nameKey));
  }

  async findById(id: string) {
    const [row] = await this.client.select().from(projectMemberFunctions).where(eq(projectMemberFunctions.id, id)).limit(1);
    return row ?? null;
  }

  async findByKey(nameKey: string) {
    const [row] = await this.client.select().from(projectMemberFunctions).where(eq(projectMemberFunctions.nameKey, nameKey)).limit(1);
    return row ?? null;
  }

  async create(data: { id: string; name: string; nameKey: string; createdBy: string }) {
    try {
      const [row] = await this.client.insert(projectMemberFunctions).values(data).returning();
      return row;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new UniqueConstraintError();
      }
      throw error;
    }
  }

  async setActive(id: string, isActive: boolean) {
    const [row] = await this.client.update(projectMemberFunctions).set({ isActive }).where(eq(projectMemberFunctions.id, id)).returning();
    return row ?? null;
  }
}
