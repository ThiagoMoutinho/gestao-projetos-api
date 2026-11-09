import { and, desc, eq } from "drizzle-orm";

import { projectExecutiveSummaryValidations, user } from "../../../db/schema";
import type { DbClient } from "../../../db/types";
import {
  ExecutiveSummaryRegularConflictError,
  type EapExecutiveSummariesRepository,
  type ExecutiveSummaryValidationRow,
  type NewExecutiveSummaryValidationRecord,
} from "./contracts";

const table = projectExecutiveSummaryValidations;

function isUniqueViolation(error: unknown) {
  const direct = (error as { code?: string } | null)?.code;
  const wrapped = (error as { cause?: { code?: string } } | null)?.cause?.code;
  return (direct ?? wrapped) === "23505";
}

export class DrizzleEapExecutiveSummariesRepository implements EapExecutiveSummariesRepository {
  constructor(private readonly client: DbClient) {}

  private selection() {
    return this.client.select({ row: table, validatedByName: user.name }).from(table).leftJoin(user, eq(table.validatedBy, user.id));
  }

  async create(data: NewExecutiveSummaryValidationRecord) {
    try {
      const [created] = await this.client.insert(table).values(data).returning();
      const [name] = await this.client.select({ name: user.name }).from(user).where(eq(user.id, created.validatedBy)).limit(1);
      return { ...created, validatedByName: name?.name ?? null };
    } catch (error) {
      // Duas validações regulares simultâneas do mesmo ciclo: o índice único deixa passar só a primeira.
      if (data.kind === "REGULAR" && isUniqueViolation(error)) {
        throw new ExecutiveSummaryRegularConflictError();
      }
      throw error;
    }
  }

  async findLatestByProject(projectId: string): Promise<ExecutiveSummaryValidationRow | null> {
    const rows = await this.selection().where(eq(table.projectId, projectId)).orderBy(desc(table.validatedAt), desc(table.id)).limit(1);
    return rows[0] ? { ...rows[0].row, validatedByName: rows[0].validatedByName } : null;
  }

  async findRegularInCycle(projectId: string, cycleStart: string): Promise<ExecutiveSummaryValidationRow | null> {
    const rows = await this.selection()
      .where(and(eq(table.projectId, projectId), eq(table.cycleStart, cycleStart), eq(table.kind, "REGULAR")))
      .limit(1);
    return rows[0] ? { ...rows[0].row, validatedByName: rows[0].validatedByName } : null;
  }

  async listByProject(projectId: string, limit: number) {
    const rows = await this.selection().where(eq(table.projectId, projectId)).orderBy(desc(table.validatedAt), desc(table.id)).limit(limit);
    return rows.map((item) => ({ ...item.row, validatedByName: item.validatedByName }));
  }

  async findByIdAndProject(validationId: string, projectId: string) {
    const rows = await this.selection().where(and(eq(table.id, validationId), eq(table.projectId, projectId))).limit(1);
    return rows[0] ? { ...rows[0].row, validatedByName: rows[0].validatedByName } : null;
  }
}
