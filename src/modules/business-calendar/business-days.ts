/**
 * Cálculo de dias úteis do calendário institucional (funções puras, sem banco). Datas civis no formato AAAA-MM-DD
 * (fuso de Belém, onde a data civil é a que a pessoa vê). Só vale para anos validados pelo ADMIN: com o calendário
 * necessário incompleto o cálculo recusa (CalendarIncompleteError) em vez de supor que todo dia de semana é útil.
 */

export type CalendarDayKind = "FERIADO" | "PONTO_FACULTATIVO" | "NAO_UTIL_INSTITUCIONAL" | "EXPEDIENTE_EXCECAO";

export type CalendarDayInput = { day: string; kind: CalendarDayKind; observed: boolean };

/** Há dias de anos sem validação no cálculo pedido: alertas que dependem de dia útil não podem ser calculados. */
export class CalendarIncompleteError extends Error {
  constructor(readonly years: number[]) {
    super(`Calendário institucional não validado para ${years.join(", ")}.`);
    this.name = "CalendarIncompleteError";
  }
}

const SEARCH_LIMIT_DAYS = 60;

function toUtc(day: string) {
  return new Date(`${day}T00:00:00.000Z`);
}

export function addCalendarDays(day: string, days: number) {
  const date = toUtc(day);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 0 = domingo … 6 = sábado. */
export function weekdayOf(day: string) {
  return toUtc(day).getUTCDay();
}

export function yearOf(day: string) {
  return Number(day.slice(0, 4));
}

export function createBusinessCalendar(days: ReadonlyArray<CalendarDayInput>, validatedYears: ReadonlySet<number>) {
  const byDay = new Map<string, CalendarDayInput[]>();
  for (const entry of days) {
    byDay.set(entry.day, [...(byDay.get(entry.day) ?? []), entry]);
  }

  function assertValidated(years: Iterable<number>) {
    const missing = [...new Set(years)].filter((year) => !validatedYears.has(year)).sort((a, b) => a - b);
    if (missing.length > 0) {
      throw new CalendarIncompleteError(missing);
    }
  }

  /** Regra do dia: exceção de expediente observada torna o dia útil; feriado, ponto facultativo ou dia não útil observados, não; senão, segunda a sexta. */
  function rule(day: string) {
    const rows = (byDay.get(day) ?? []).filter((row) => row.observed);
    if (rows.some((row) => row.kind === "EXPEDIENTE_EXCECAO")) {
      return true;
    }
    if (rows.some((row) => row.kind === "FERIADO" || row.kind === "PONTO_FACULTATIVO" || row.kind === "NAO_UTIL_INSTITUCIONAL")) {
      return false;
    }
    const weekday = weekdayOf(day);
    return weekday >= 1 && weekday <= 5;
  }

  function isBusinessDay(day: string) {
    assertValidated([yearOf(day)]);
    return rule(day);
  }

  /** Procura a partir de `start` (inclusive), andando `step` dias, e valida todos os anos tocados. */
  function search(start: string, step: 1 | -1) {
    let current = start;
    const years = new Set<number>([yearOf(start)]);
    for (let i = 0; i <= SEARCH_LIMIT_DAYS; i += 1) {
      years.add(yearOf(current));
      if (rule(current)) {
        assertValidated(years);
        return current;
      }
      current = addCalendarDays(current, step);
    }
    throw new Error("Não foi encontrado dia útil no intervalo de busca; confira o calendário.");
  }

  return {
    isBusinessDay,
    /** O próprio dia, se for útil; senão o dia útil imediatamente anterior (alerta preventivo quando a terça não é útil). */
    onOrBeforeBusinessDay: (day: string) => search(day, -1),
    /** O próprio dia, se for útil; senão o próximo dia útil (notificação de atraso quando a quinta não é útil). */
    onOrAfterBusinessDay: (day: string) => search(day, 1),
    /** O primeiro dia útil estritamente depois de `day` (escalonamento depois do prazo de 10 dias corridos). */
    firstBusinessDayAfter: (day: string) => search(addCalendarDays(day, 1), 1),
  };
}

export type BusinessCalendar = ReturnType<typeof createBusinessCalendar>;

/** Anos entre duas datas (inclusive) que ainda não estão validados. */
export function calendarReadiness(from: string, to: string, validatedYears: ReadonlySet<number>) {
  const missing: number[] = [];
  for (let year = yearOf(from); year <= yearOf(to); year += 1) {
    if (!validatedYears.has(year)) {
      missing.push(year);
    }
  }
  return { ready: missing.length === 0, missingYears: missing };
}
