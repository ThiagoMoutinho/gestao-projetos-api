import {
  CalendarDayConflictError,
  type CalendarChangeRow,
  type CalendarDayPatch,
  type CalendarDayRow,
  type CalendarRepository,
  type CalendarStore,
  type CalendarYearRow,
  type NewCalendarChange,
  type NewCalendarDay,
} from "./business-calendar.repository";

/**
 * Repositório em memória para testes. Reproduz as regras do banco: unicidade de dia, escopo e tipo; ano obrigatório
 * (FK) coerente com a data; e o gatilho que devolve um ano validado a rascunho quando algum dia dele muda.
 */
export class InMemoryCalendarRepository implements CalendarRepository {
  years: CalendarYearRow[] = [];
  days: CalendarDayRow[] = [];
  changes: CalendarChangeRow[] = [];
  users = new Map<string, string>();

  async getYear(year: number) {
    return this.years.find((row) => row.year === year) ?? null;
  }

  async listYears() {
    return [...this.years].sort((a, b) => a.year - b.year);
  }

  async ensureYear(year: number) {
    const existing = await this.getYear(year);
    if (existing) {
      return existing;
    }
    const now = new Date();
    const row: CalendarYearRow = {
      year,
      status: "DRAFT",
      nationalChecked: false,
      stateChecked: false,
      municipalChecked: false,
      sourceNote: null,
      validatedBy: null,
      validatedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.years.push(row);
    return row;
  }

  async listDays(year: number) {
    return this.days.filter((row) => row.year === year).sort((a, b) => a.day.localeCompare(b.day) || a.scope.localeCompare(b.scope));
  }

  async getDay(id: string) {
    return this.days.find((row) => row.id === id) ?? null;
  }

  /** Linhas são substituídas (nunca alteradas no lugar): quem já leu uma linha continua com o valor anterior, como no banco. */
  private revert(year: number) {
    const index = this.years.findIndex((item) => item.year === year);
    if (index >= 0 && this.years[index].status === "VALIDATED") {
      this.years[index] = {
        ...this.years[index],
        status: "DRAFT",
        validatedBy: null,
        validatedAt: null,
        nationalChecked: false,
        stateChecked: false,
        municipalChecked: false,
        updatedAt: new Date(),
      };
    }
  }

  async insertDay(data: NewCalendarDay) {
    if (!this.years.some((row) => row.year === data.year)) {
      throw new Error("FK: ano inexistente");
    }
    if (Number(data.day.slice(0, 4)) !== data.year) {
      throw new Error("CHECK: ano diferente da data");
    }
    if (this.days.some((row) => row.day === data.day && row.scope === data.scope && row.kind === data.kind)) {
      throw new CalendarDayConflictError();
    }
    const now = new Date();
    const row: CalendarDayRow = { ...data, createdAt: now, updatedBy: null, updatedAt: now };
    this.days.push(row);
    this.revert(data.year);
    return row;
  }

  async updateDay(id: string, patch: CalendarDayPatch) {
    const index = this.days.findIndex((item) => item.id === id);
    if (index < 0) {
      return null;
    }
    const next = { ...this.days[index], ...patch, updatedAt: new Date() };
    if (this.days.some((item) => item.id !== id && item.day === next.day && item.scope === next.scope && item.kind === next.kind)) {
      throw new CalendarDayConflictError();
    }
    this.days[index] = next;
    this.revert(next.year);
    return next;
  }

  async deleteDay(id: string) {
    const index = this.days.findIndex((item) => item.id === id);
    if (index < 0) {
      return null;
    }
    const [row] = this.days.splice(index, 1);
    this.revert(row.year);
    return row;
  }

  async validateYear(year: number, data: { validatedBy: string; sourceNote: string }) {
    const index = this.years.findIndex((item) => item.year === year);
    const next: CalendarYearRow = {
      ...this.years[index],
      status: "VALIDATED",
      nationalChecked: true,
      stateChecked: true,
      municipalChecked: true,
      sourceNote: data.sourceNote,
      validatedBy: data.validatedBy,
      validatedAt: new Date(),
      updatedAt: new Date(),
    };
    this.years[index] = next;
    return next;
  }

  async appendChange(change: NewCalendarChange) {
    this.changes.push({ ...change, at: new Date(), actorName: this.users.get(change.actorId) ?? null });
  }

  async listChanges(year: number, limit: number) {
    return this.changes.filter((row) => row.year === year).slice().reverse().slice(0, limit);
  }

  /** Sem isolamento real: desfaz tudo se a função falhar (cópia do estado antes). */
  async transaction<T>(fn: (store: CalendarStore) => Promise<T>) {
    const snapshot = {
      years: this.years.map((row) => ({ ...row })),
      days: this.days.map((row) => ({ ...row })),
      changes: [...this.changes],
    };
    try {
      return await fn(this);
    } catch (error) {
      this.years = snapshot.years;
      this.days = snapshot.days;
      this.changes = snapshot.changes;
      throw error;
    }
  }
}
