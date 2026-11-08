import { addCalendarDays } from "./business-days";

/** Domingo de Páscoa (calendário gregoriano, algoritmo de Meeus/Jones/Butcher). */
export function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export type NationalHoliday = { day: string; description: string };

/**
 * Feriados nacionais sugeridos para o ADMIN conferir (nunca gravados sozinhos): os fixos de lei federal e a
 * Sexta-feira Santa (móvel). Carnaval e Corpus Christi são pontos facultativos e ficam de fora. O Dia da Consciência
 * Negra (20/11) é nacional a partir de 2024. Feriados do Pará e de Belém não são sugeridos: dependem de ato próprio.
 */
export function nationalHolidaySuggestions(year: number): NationalHoliday[] {
  const fixed: Array<[string, string]> = [
    ["01-01", "Confraternização Universal"],
    ["04-21", "Tiradentes"],
    ["05-01", "Dia do Trabalho"],
    ["09-07", "Independência do Brasil"],
    ["10-12", "Nossa Senhora Aparecida"],
    ["11-02", "Finados"],
    ["11-15", "Proclamação da República"],
    ["12-25", "Natal"],
  ];
  const list: NationalHoliday[] = fixed.map(([monthDay, description]) => ({ day: `${year}-${monthDay}`, description }));
  if (year >= 2024) {
    list.push({ day: `${year}-11-20`, description: "Dia Nacional de Zumbi e da Consciência Negra" });
  }
  list.push({ day: addCalendarDays(easterSunday(year), -2), description: "Sexta-feira Santa" });
  return list.sort((left, right) => left.day.localeCompare(right.day));
}
