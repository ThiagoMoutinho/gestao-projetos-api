import { HttpError } from "../../lib/http-error";
import type { AuthUser } from "../../lib/session";
import { addCalendarDays, calendarReadiness, createBusinessCalendar, yearOf, type CalendarDayInput } from "./business-days";
import {
  CalendarDayConflictError,
  type CalendarChangeAction,
  type CalendarDayRow,
  type CalendarKind,
  type CalendarRepository,
  type CalendarScope,
  type CalendarStore,
  type CalendarYearRow,
} from "./business-calendar.repository";
import type { CreateCalendarDayInput, UpdateCalendarDayInput, ValidateCalendarYearInput } from "./business-calendar.schema";
import { nationalHolidaySuggestions } from "./national-holidays";

/** Só o ADMIN altera e valida o calendário. */
export function canManageCalendar(actor: AuthUser) {
  return actor.role === "ADMIN";
}

/** O PMO consulta o calendário (sem alterar). */
export function canReadCalendar(actor: AuthUser) {
  return actor.role === "ADMIN" || actor.role === "PMO";
}

const forbiddenManage = () => new HttpError(403, "Somente o ADMIN altera o calendário institucional.", "CALENDAR_FORBIDDEN");
const forbiddenRead = () => new HttpError(403, "Você não tem permissão para consultar o calendário institucional.", "CALENDAR_FORBIDDEN");
const invalid = (message: string) => new HttpError(400, message, "CALENDAR_INVALID_DAY");
const notFound = () => new HttpError(404, "Dia do calendário não encontrado.", "CALENDAR_DAY_NOT_FOUND");
const conflict = () =>
  new HttpError(409, "Já existe esse dia, com o mesmo escopo e tipo, no calendário.", "CALENDAR_DAY_CONFLICT");

const INSTITUTIONAL_KINDS = new Set<CalendarKind>(["NAO_UTIL_INSTITUCIONAL", "EXPEDIENTE_EXCECAO"]);

/** Dia não útil por padrão, exceto ponto facultativo (decisão do IGEPPS, nunca automática). */
function defaultObserved(kind: CalendarKind) {
  return kind !== "PONTO_FACULTATIVO";
}

function assertCoherent(scope: CalendarScope, kind: CalendarKind, legalBasis: string | null) {
  if (INSTITUTIONAL_KINDS.has(kind) !== (scope === "INSTITUCIONAL")) {
    throw invalid(
      "Dia não útil institucional e exceção de expediente usam o escopo institucional, e o escopo institucional só admite esses tipos.",
    );
  }
  if (scope !== "NACIONAL" && !legalBasis?.trim()) {
    throw invalid("Informe a base legal ou o ato institucional do dia (obrigatório fora do escopo nacional).");
  }
}

function snapshotOf(row: CalendarDayRow) {
  return {
    day: row.day,
    scope: row.scope,
    kind: row.kind,
    observed: row.observed,
    description: row.description,
    legalBasis: row.legalBasis,
  };
}

function yearDto(row: CalendarYearRow, actor: AuthUser) {
  return {
    year: row.year,
    status: row.status as "DRAFT" | "VALIDATED",
    nationalChecked: row.nationalChecked,
    stateChecked: row.stateChecked,
    municipalChecked: row.municipalChecked,
    sourceNote: row.sourceNote,
    validatedBy: row.validatedBy,
    validatedAt: row.validatedAt?.toISOString() ?? null,
    canManage: canManageCalendar(actor),
  };
}

function dayDto(row: CalendarDayRow) {
  return {
    id: row.id,
    year: row.year,
    day: row.day,
    scope: row.scope as CalendarScope,
    kind: row.kind as CalendarKind,
    observed: row.observed,
    description: row.description,
    legalBasis: row.legalBasis,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Registra o histórico e, se a alteração devolveu um ano validado a DRAFT, registra isso também (mesma transação). */
async function recordChange(
  store: CalendarStore,
  actor: AuthUser,
  input: {
    year: number;
    dayId: string | null;
    action: CalendarChangeAction;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    yearBefore: CalendarYearRow | null;
    note?: string | null;
  },
) {
  await store.appendChange({
    id: crypto.randomUUID(),
    year: input.year,
    dayId: input.dayId,
    action: input.action,
    before: input.before,
    after: input.after,
    note: input.note ?? null,
    actorId: actor.id,
  });
  const yearAfter = await store.getYear(input.year);
  if (input.yearBefore?.status === "VALIDATED" && yearAfter?.status === "DRAFT") {
    await store.appendChange({
      id: crypto.randomUUID(),
      year: input.year,
      dayId: null,
      action: "YEAR_REVERT_TO_DRAFT",
      before: { status: "VALIDATED" },
      after: { status: "DRAFT" },
      note: "Calendário do ano alterado: nova validação do ADMIN é necessária.",
      actorId: actor.id,
    });
  }
}

export function makeBusinessCalendarUseCases(repository: CalendarRepository) {
  return {
    async listYears(actor: AuthUser) {
      if (!canReadCalendar(actor)) {
        throw forbiddenRead();
      }
      return { data: (await repository.listYears()).map((row) => yearDto(row, actor)) };
    },

    async getYear(actor: AuthUser, year: number) {
      if (!canReadCalendar(actor)) {
        throw forbiddenRead();
      }
      const row = (await repository.getYear(year)) ?? {
        year,
        status: "DRAFT",
        nationalChecked: false,
        stateChecked: false,
        municipalChecked: false,
        sourceNote: null,
        validatedBy: null,
        validatedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      return { ...yearDto(row, actor), days: (await repository.listDays(year)).map(dayDto) };
    },

    async createDay(actor: AuthUser, year: number, input: CreateCalendarDayInput) {
      if (!canManageCalendar(actor)) {
        throw forbiddenManage();
      }
      if (yearOf(input.day) !== year) {
        throw invalid("A data informada não pertence ao ano do calendário.");
      }
      const legalBasis = input.legalBasis?.trim() || null;
      assertCoherent(input.scope, input.kind, legalBasis);

      return repository.transaction(async (store) => {
        const yearBefore = await store.ensureYear(year);
        try {
          const created = await store.insertDay({
            id: crypto.randomUUID(),
            year,
            day: input.day,
            scope: input.scope,
            kind: input.kind,
            observed: input.observed ?? defaultObserved(input.kind),
            description: input.description,
            legalBasis,
            createdBy: actor.id,
          });
          await recordChange(store, actor, { year, dayId: created.id, action: "DAY_CREATE", before: null, after: snapshotOf(created), yearBefore });
          return dayDto(created);
        } catch (error) {
          if (error instanceof CalendarDayConflictError) {
            throw conflict();
          }
          throw error;
        }
      });
    },

    async updateDay(actor: AuthUser, dayId: string, input: UpdateCalendarDayInput) {
      if (!canManageCalendar(actor)) {
        throw forbiddenManage();
      }
      return repository.transaction(async (store) => {
        const current = await store.getDay(dayId);
        if (!current) {
          throw notFound();
        }
        if (input.day !== undefined && yearOf(input.day) !== current.year) {
          throw invalid("O dia não pode mudar de ano: exclua e cadastre no calendário do outro ano.");
        }
        const next = {
          scope: input.scope ?? (current.scope as CalendarScope),
          kind: input.kind ?? (current.kind as CalendarKind),
          legalBasis: input.legalBasis === undefined ? current.legalBasis : input.legalBasis?.trim() || null,
        };
        assertCoherent(next.scope, next.kind, next.legalBasis);
        const yearBefore = await store.getYear(current.year);
        try {
          const updated = await store.updateDay(dayId, {
            ...(input.day !== undefined ? { day: input.day } : {}),
            ...(input.scope !== undefined ? { scope: input.scope } : {}),
            ...(input.kind !== undefined ? { kind: input.kind } : {}),
            ...(input.observed !== undefined ? { observed: input.observed } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.legalBasis !== undefined ? { legalBasis: next.legalBasis } : {}),
            updatedBy: actor.id,
          });
          if (!updated) {
            throw notFound();
          }
          await recordChange(store, actor, { year: current.year, dayId, action: "DAY_UPDATE", before: snapshotOf(current), after: snapshotOf(updated), yearBefore });
          return dayDto(updated);
        } catch (error) {
          if (error instanceof CalendarDayConflictError) {
            throw conflict();
          }
          throw error;
        }
      });
    },

    async deleteDay(actor: AuthUser, dayId: string) {
      if (!canManageCalendar(actor)) {
        throw forbiddenManage();
      }
      await repository.transaction(async (store) => {
        const current = await store.getDay(dayId);
        if (!current) {
          throw notFound();
        }
        const yearBefore = await store.getYear(current.year);
        await store.deleteDay(dayId);
        await recordChange(store, actor, { year: current.year, dayId, action: "DAY_DELETE", before: snapshotOf(current), after: null, yearBefore });
      });
    },

    /** Feriados nacionais sugeridos para o ano, com a indicação de quais já estão cadastrados (não grava nada). */
    async suggestNational(actor: AuthUser, year: number) {
      if (!canManageCalendar(actor)) {
        throw forbiddenManage();
      }
      const existing = await repository.listDays(year);
      return {
        data: nationalHolidaySuggestions(year).map((item) => ({
          ...item,
          exists: existing.some((row) => row.day === item.day && row.scope === "NACIONAL" && row.kind === "FERIADO"),
        })),
      };
    },

    /** Cadastra, por ação explícita do ADMIN, os feriados nacionais sugeridos que ainda faltam. */
    async applyNational(actor: AuthUser, year: number) {
      if (!canManageCalendar(actor)) {
        throw forbiddenManage();
      }
      return repository.transaction(async (store) => {
        const yearBefore = await store.ensureYear(year);
        const existing = await store.listDays(year);
        const created: CalendarDayRow[] = [];
        for (const item of nationalHolidaySuggestions(year)) {
          if (existing.some((row) => row.day === item.day && row.scope === "NACIONAL" && row.kind === "FERIADO")) {
            continue;
          }
          const row = await store.insertDay({
            id: crypto.randomUUID(),
            year,
            day: item.day,
            scope: "NACIONAL",
            kind: "FERIADO",
            observed: true,
            description: item.description,
            legalBasis: null,
            createdBy: actor.id,
          });
          created.push(row);
          await recordChange(store, actor, {
            year,
            dayId: row.id,
            action: "DAY_CREATE",
            before: null,
            after: snapshotOf(row),
            yearBefore,
            note: "Feriado nacional sugerido e confirmado pelo ADMIN.",
          });
        }
        return { data: created.map(dayDto) };
      });
    },

    /** Valida o ano (somente ADMIN): exige as declarações de conferência e os feriados nacionais obrigatórios cadastrados. */
    async validateYear(actor: AuthUser, year: number, input: ValidateCalendarYearInput) {
      if (!canManageCalendar(actor)) {
        throw forbiddenManage();
      }
      return repository.transaction(async (store) => {
        const current = await store.ensureYear(year);
        if (current.status === "VALIDATED") {
          throw new HttpError(409, "O calendário deste ano já está validado.", "CALENDAR_YEAR_ALREADY_VALIDATED");
        }
        const days = await store.listDays(year);
        const missing = nationalHolidaySuggestions(year)
          .filter((item) => !days.some((row) => row.day === item.day && row.scope === "NACIONAL" && row.kind === "FERIADO" && row.observed))
          .map((item) => item.day);
        if (missing.length > 0) {
          throw new HttpError(
            409,
            `Faltam feriados nacionais no calendário de ${year}: ${missing.join(", ")}.`,
            "CALENDAR_YEAR_INCOMPLETE",
          );
        }
        const validated = await store.validateYear(year, { validatedBy: actor.id, sourceNote: input.sourceNote.trim() });
        await store.appendChange({
          id: crypto.randomUUID(),
          year,
          dayId: null,
          action: "YEAR_VALIDATE",
          before: { status: "DRAFT" },
          after: { status: "VALIDATED", sourceNote: validated.sourceNote, days: days.length },
          note: null,
          actorId: actor.id,
        });
        return yearDto(validated, actor);
      });
    },

    async listChanges(actor: AuthUser, year: number) {
      if (!canManageCalendar(actor)) {
        throw forbiddenManage();
      }
      const rows = await repository.listChanges(year, 200);
      return {
        data: rows.map((row) => ({
          id: row.id,
          year: row.year,
          dayId: row.dayId,
          action: row.action as CalendarChangeAction,
          before: row.before,
          after: row.after,
          note: row.note,
          actorId: row.actorId,
          actorName: row.actorName,
          at: row.at.toISOString(),
        })),
      };
    },

    /** Quais anos do intervalo ainda não estão validados (alertas que dependem de dia útil não podem ser calculados neles). */
    async readiness(actor: AuthUser, from: string, to: string) {
      if (!canReadCalendar(actor)) {
        throw forbiddenRead();
      }
      return calendarReadiness(from, to, await validatedYears(repository));
    },
  };
}

export type BusinessCalendarUseCases = ReturnType<typeof makeBusinessCalendarUseCases>;

export async function validatedYears(store: Pick<CalendarStore, "listYears">) {
  return new Set((await store.listYears()).filter((row) => row.status === "VALIDATED").map((row) => row.year));
}

/**
 * Monta o calendário de dias úteis (cálculo puro) para as datas de um intervalo, para uso interno das próximas etapas
 * (verificação periódica). Só os anos validados são considerados completos; os demais recusam o cálculo.
 */
export async function loadBusinessCalendar(store: CalendarStore, from: string, to: string) {
  // A busca por dia útil anda até ~60 dias além do intervalo: carrega os anos dessa margem.
  const years: number[] = [];
  for (let year = yearOf(addCalendarDays(from, -70)); year <= yearOf(addCalendarDays(to, 70)); year += 1) {
    years.push(year);
  }
  const days: CalendarDayInput[] = [];
  for (const year of years) {
    for (const row of await store.listDays(year)) {
      days.push({ day: row.day, kind: row.kind as CalendarKind, observed: row.observed });
    }
  }
  return createBusinessCalendar(days, await validatedYears(store));
}
