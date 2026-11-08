import { asc, desc, eq } from "drizzle-orm";

import { businessCalendarChanges, businessCalendarDays, businessCalendarYears, user } from "../../db/schema";
import type { Database, DbClient } from "../../db/types";

export type CalendarYearStatus = "DRAFT" | "VALIDATED";
export type CalendarScope = "NACIONAL" | "ESTADUAL_PA" | "MUNICIPAL_BELEM" | "INSTITUCIONAL";
export type CalendarKind = "FERIADO" | "PONTO_FACULTATIVO" | "NAO_UTIL_INSTITUCIONAL" | "EXPEDIENTE_EXCECAO";
export type CalendarChangeAction = "DAY_CREATE" | "DAY_UPDATE" | "DAY_DELETE" | "YEAR_VALIDATE" | "YEAR_REVERT_TO_DRAFT";

export type CalendarYearRow = typeof businessCalendarYears.$inferSelect;
export type CalendarDayRow = typeof businessCalendarDays.$inferSelect;
export type CalendarChangeRow = typeof businessCalendarChanges.$inferSelect & { actorName: string | null };

export type NewCalendarDay = {
  id: string;
  year: number;
  day: string;
  scope: CalendarScope;
  kind: CalendarKind;
  observed: boolean;
  description: string;
  legalBasis: string | null;
  createdBy: string;
};

export type CalendarDayPatch = Partial<Pick<NewCalendarDay, "day" | "year" | "scope" | "kind" | "observed" | "description" | "legalBasis">> & {
  updatedBy: string;
};

export type NewCalendarChange = {
  id: string;
  year: number;
  dayId: string | null;
  action: CalendarChangeAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  note: string | null;
  actorId: string;
};

/** Já existe o mesmo dia, escopo e tipo no calendário. */
export class CalendarDayConflictError extends Error {}

export interface CalendarStore {
  getYear(year: number): Promise<CalendarYearRow | null>;
  listYears(): Promise<CalendarYearRow[]>;
  /** Cria o ano em preparação (DRAFT) se ainda não existir. */
  ensureYear(year: number): Promise<CalendarYearRow>;
  listDays(year: number): Promise<CalendarDayRow[]>;
  getDay(id: string): Promise<CalendarDayRow | null>;
  insertDay(data: NewCalendarDay): Promise<CalendarDayRow>;
  updateDay(id: string, patch: CalendarDayPatch): Promise<CalendarDayRow | null>;
  deleteDay(id: string): Promise<CalendarDayRow | null>;
  validateYear(year: number, data: { validatedBy: string; sourceNote: string }): Promise<CalendarYearRow>;
  appendChange(change: NewCalendarChange): Promise<void>;
  listChanges(year: number, limit: number): Promise<CalendarChangeRow[]>;
}

export interface CalendarRepository extends CalendarStore {
  transaction<T>(fn: (store: CalendarStore) => Promise<T>): Promise<T>;
}

function isUniqueViolation(error: unknown) {
  const direct = (error as { code?: string } | null)?.code;
  const wrapped = (error as { cause?: { code?: string } } | null)?.cause?.code;
  return (direct ?? wrapped) === "23505";
}

class DrizzleCalendarStore implements CalendarStore {
  constructor(protected readonly client: DbClient) {}

  async getYear(year: number) {
    const [row] = await this.client.select().from(businessCalendarYears).where(eq(businessCalendarYears.year, year)).limit(1);
    return row ?? null;
  }

  listYears() {
    return this.client.select().from(businessCalendarYears).orderBy(asc(businessCalendarYears.year));
  }

  async ensureYear(year: number) {
    await this.client.insert(businessCalendarYears).values({ year }).onConflictDoNothing();
    return (await this.getYear(year)) as CalendarYearRow;
  }

  listDays(year: number) {
    return this.client.select().from(businessCalendarDays).where(eq(businessCalendarDays.year, year)).orderBy(asc(businessCalendarDays.day), asc(businessCalendarDays.scope));
  }

  async getDay(id: string) {
    const [row] = await this.client.select().from(businessCalendarDays).where(eq(businessCalendarDays.id, id)).limit(1);
    return row ?? null;
  }

  async insertDay(data: NewCalendarDay) {
    try {
      const [row] = await this.client.insert(businessCalendarDays).values(data).returning();
      return row;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new CalendarDayConflictError();
      }
      throw error;
    }
  }

  async updateDay(id: string, patch: CalendarDayPatch) {
    try {
      const [row] = await this.client
        .update(businessCalendarDays)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(businessCalendarDays.id, id))
        .returning();
      return row ?? null;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new CalendarDayConflictError();
      }
      throw error;
    }
  }

  async deleteDay(id: string) {
    const [row] = await this.client.delete(businessCalendarDays).where(eq(businessCalendarDays.id, id)).returning();
    return row ?? null;
  }

  async validateYear(year: number, data: { validatedBy: string; sourceNote: string }) {
    const [row] = await this.client
      .update(businessCalendarYears)
      .set({
        status: "VALIDATED",
        nationalChecked: true,
        stateChecked: true,
        municipalChecked: true,
        sourceNote: data.sourceNote,
        validatedBy: data.validatedBy,
        validatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(businessCalendarYears.year, year))
      .returning();
    return row;
  }

  async appendChange(change: NewCalendarChange) {
    await this.client.insert(businessCalendarChanges).values(change);
  }

  async listChanges(year: number, limit: number) {
    const rows = await this.client
      .select({ change: businessCalendarChanges, actorName: user.name })
      .from(businessCalendarChanges)
      .leftJoin(user, eq(businessCalendarChanges.actorId, user.id))
      .where(eq(businessCalendarChanges.year, year))
      .orderBy(desc(businessCalendarChanges.at), desc(businessCalendarChanges.id))
      .limit(limit);
    return rows.map((row) => ({ ...row.change, actorName: row.actorName }));
  }
}

export class DrizzleCalendarRepository extends DrizzleCalendarStore implements CalendarRepository {
  constructor(private readonly database: Database) {
    super(database);
  }

  transaction<T>(fn: (store: CalendarStore) => Promise<T>) {
    return this.database.transaction((tx) => fn(new DrizzleCalendarStore(tx)));
  }
}
