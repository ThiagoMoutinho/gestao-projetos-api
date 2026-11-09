/**
 * Ciclo semanal do resumo executivo: de quinta-feira a quarta-feira, no fuso America/Belem. A validação sempre pertence
 * ao ciclo em que ela efetivamente acontece (não há validação retroativa nem data informada pelo cliente).
 */
export type ExecutiveCycle = {
  /** Quinta-feira em que o ciclo começa (AAAA-MM-DD, data civil de Belém). */
  start: string;
  /** Quarta-feira em que o ciclo termina (AAAA-MM-DD). */
  end: string;
  /** Último instante do ciclo (quarta-feira 23:59:59.999 em Belém), em ISO UTC. */
  deadlineAt: string;
};

const THURSDAY = 4;
const BELEM_OFFSET = "-03:00";

export function civilDay(now: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Belem", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addCivilDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function executiveCycleOf(now: Date): ExecutiveCycle {
  const today = civilDay(now);
  const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  return cycleFromStart(addCivilDays(today, -((weekday - THURSDAY + 7) % 7)));
}

/** Instante em que o dia civil de Belém começa (00:00), em ISO UTC. */
export function belemDayStartIso(day: string) {
  return new Date(`${day}T00:00:00.000${BELEM_OFFSET}`).toISOString();
}

/** Ciclo que começa na quinta-feira informada (AAAA-MM-DD). */
export function cycleFromStart(start: string): ExecutiveCycle {
  const end = addCivilDays(start, 6);
  const deadlineAt = new Date(new Date(belemDayStartIso(addCivilDays(end, 1))).getTime() - 1).toISOString();
  return { start, end, deadlineAt };
}
