import { asc, eq, sql } from "drizzle-orm";

import { projectMemberFunctions } from "../../db/schema";
import type { DbClient } from "../../db/types";
import { isUniqueViolation, UniqueConstraintError } from "../../lib/postgres-errors";
import type { MemberFunctionUsage } from "./member-functions.schema";

export type MemberFunctionRow = typeof projectMemberFunctions.$inferSelect;

export type MemberFunctionPatch = { name?: string; nameKey?: string; isActive?: boolean };

export interface MemberFunctionsRepository {
  list(includeInactive: boolean): Promise<MemberFunctionRow[]>;
  findById(id: string): Promise<MemberFunctionRow | null>;
  findByKey(nameKey: string): Promise<MemberFunctionRow | null>;
  create(data: { id: string; name: string; nameKey: string; createdBy: string }): Promise<MemberFunctionRow>;
  update(id: string, patch: MemberFunctionPatch): Promise<MemberFunctionRow | null>;
  /** Participantes atuais e registros de histórico que citam cada função (por id). */
  usage(ids: readonly string[]): Promise<Map<string, MemberFunctionUsage>>;
  /** Exclui só se nenhuma linha de participante nem registro de histórico a referencia. Devolve se excluiu. */
  deleteIfUnused(id: string): Promise<boolean>;
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

  async update(id: string, patch: MemberFunctionPatch) {
    const set: MemberFunctionPatch = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.nameKey !== undefined) set.nameKey = patch.nameKey;
    if (patch.isActive !== undefined) set.isActive = patch.isActive;
    try {
      const [row] = await this.client.update(projectMemberFunctions).set(set).where(eq(projectMemberFunctions.id, id)).returning();
      return row ?? null;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new UniqueConstraintError();
      }
      throw error;
    }
  }

  async usage(ids: readonly string[]) {
    const result = new Map<string, MemberFunctionUsage>();
    if (ids.length === 0) {
      return result;
    }
    const rows = await this.client.execute(
      sql`select f.id,
          (select count(*) from project_members m where m.function_id = f.id)::int as members,
          (select count(*) from eap_audit_logs a
             where a.payload @> jsonb_build_object('functionId', f.id)
                or a.payload @> jsonb_build_object('toFunctionId', f.id)
                or a.payload @> jsonb_build_object('fromFunctionId', f.id))::int as history
        from project_member_functions f
        where f.id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`,
    );
    for (const row of rows.rows as Array<{ id: string; members: number; history: number }>) {
      result.set(row.id, { members: Number(row.members), history: Number(row.history) });
    }
    return result;
  }

  async deleteIfUnused(id: string) {
    const rows = await this.client.execute(
      sql`delete from project_member_functions f
        where f.id = ${id}
          and not exists (select 1 from project_members m where m.function_id = f.id)
          and not exists (select 1 from eap_audit_logs a
                           where a.payload @> jsonb_build_object('functionId', f.id)
                              or a.payload @> jsonb_build_object('toFunctionId', f.id)
                              or a.payload @> jsonb_build_object('fromFunctionId', f.id))
        returning f.id`,
    );
    return rows.rows.length > 0;
  }
}
