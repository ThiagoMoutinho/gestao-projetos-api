import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addCalendarDays,
  calendarReadiness,
  CalendarIncompleteError,
  createBusinessCalendar,
  weekdayOf,
  type CalendarDayInput,
} from "./business-days";
import { easterSunday, nationalHolidaySuggestions } from "./national-holidays";

const holiday = (day: string, observed = true): CalendarDayInput => ({ day, kind: "FERIADO", observed });
const validated = new Set([2025, 2026, 2027]);

describe("Dias úteis do calendário institucional", () => {
  it("calcula o escalonamento: 10 dias corridos após o fim do ciclo e o primeiro dia útil depois (exemplos do planejamento)", () => {
    const calendar = createBusinessCalendar([], validated);
    // Ciclo 29/10 a 04/11/2026: +10 = sábado 14/11 → segunda 16/11.
    assert.equal(weekdayOf("2026-11-14"), 6);
    assert.equal(calendar.firstBusinessDayAfter(addCalendarDays("2026-11-04", 10)), "2026-11-16");
    // Ciclo 05/11 a 11/11/2026: +10 = sábado 21/11 → segunda 23/11.
    assert.equal(calendar.firstBusinessDayAfter(addCalendarDays("2026-11-11", 10)), "2026-11-23");
  });

  it("pula feriado observado na segunda-feira seguinte (aniversário de Belém cadastrado como exemplo) e cruza o ano", () => {
    const calendar = createBusinessCalendar([holiday("2026-01-12")], validated);
    // Ciclo 25/12/2025 a 31/12/2025: +10 = sábado 10/01/2026; segunda 12/01 é feriado → terça 13/01.
    assert.equal(addCalendarDays("2025-12-31", 10), "2026-01-10");
    assert.equal(calendar.firstBusinessDayAfter("2026-01-10"), "2026-01-13");
  });

  it("encadeia feriado de sexta, fim de semana e feriado de segunda", () => {
    const calendar = createBusinessCalendar([holiday("2026-11-20"), holiday("2026-11-23")], validated);
    assert.equal(calendar.firstBusinessDayAfter("2026-11-19"), "2026-11-24");
    assert.equal(calendar.isBusinessDay("2026-11-20"), false);
    assert.equal(calendar.isBusinessDay("2026-11-21"), false);
    assert.equal(calendar.isBusinessDay("2026-11-24"), true);
  });

  it("antecipa o alerta quando a terça não é útil: dia útil anterior, inclusive atravessando outro feriado", () => {
    const tuesday = "2026-11-03";
    assert.equal(createBusinessCalendar([], validated).onOrBeforeBusinessDay(tuesday), tuesday);
    assert.equal(createBusinessCalendar([holiday(tuesday)], validated).onOrBeforeBusinessDay(tuesday), "2026-11-02");
    assert.equal(createBusinessCalendar([holiday(tuesday), holiday("2026-11-02")], validated).onOrBeforeBusinessDay(tuesday), "2026-10-30");
  });

  it("adia a notificação de atraso quando a quinta não é útil, sem alterar a data original", () => {
    const thursday = "2026-11-05";
    const calendar = createBusinessCalendar([holiday(thursday)], validated);
    assert.equal(calendar.onOrAfterBusinessDay(thursday), "2026-11-06");
    assert.equal(createBusinessCalendar([holiday(thursday), holiday("2026-11-06")], validated).onOrAfterBusinessDay(thursday), "2026-11-09");
    assert.equal(thursday, "2026-11-05");
  });

  it("ponto facultativo só é dia não útil quando observado", () => {
    const optional = (observed: boolean): CalendarDayInput => ({ day: "2026-06-04", kind: "PONTO_FACULTATIVO", observed });
    assert.equal(createBusinessCalendar([optional(false)], validated).isBusinessDay("2026-06-04"), true);
    assert.equal(createBusinessCalendar([optional(true)], validated).isBusinessDay("2026-06-04"), false);
  });

  it("dia não útil institucional e exceção de expediente", () => {
    const calendar = createBusinessCalendar(
      [
        { day: "2026-09-04", kind: "NAO_UTIL_INSTITUCIONAL", observed: true },
        { day: "2026-09-05", kind: "EXPEDIENTE_EXCECAO", observed: true },
        holiday("2026-09-07"),
        { day: "2026-09-07", kind: "EXPEDIENTE_EXCECAO", observed: true },
        { day: "2026-09-12", kind: "EXPEDIENTE_EXCECAO", observed: false },
      ],
      validated,
    );
    assert.equal(calendar.isBusinessDay("2026-09-04"), false, "dia não útil institucional");
    assert.equal(calendar.isBusinessDay("2026-09-05"), true, "sábado com expediente");
    assert.equal(calendar.isBusinessDay("2026-09-07"), true, "feriado com expediente excepcional");
    assert.equal(calendar.isBusinessDay("2026-09-12"), false, "exceção não observada é ignorada");
  });

  it("recusa o cálculo quando o calendário do ano não está validado (nunca supõe dia de semana como útil)", () => {
    const calendar = createBusinessCalendar([holiday("2026-01-12")], new Set([2025]));
    assert.throws(() => calendar.firstBusinessDayAfter("2026-01-10"), (error: unknown) => error instanceof CalendarIncompleteError && error.years.join() === "2026");
    assert.throws(() => calendar.isBusinessDay("2026-03-02"), CalendarIncompleteError);
    assert.throws(() => createBusinessCalendar([], new Set()).onOrBeforeBusinessDay("2025-12-30"), CalendarIncompleteError);
    // A busca que cruza para um ano não validado também recusa.
    assert.throws(() => createBusinessCalendar([], new Set([2025])).firstBusinessDayAfter("2025-12-31"), (error: unknown) => error instanceof CalendarIncompleteError && error.years.join() === "2026");
  });

  it("informa os anos que faltam validar em um intervalo", () => {
    assert.deepEqual(calendarReadiness("2026-12-20", "2027-01-15", new Set([2026])), { ready: false, missingYears: [2027] });
    assert.deepEqual(calendarReadiness("2026-03-01", "2026-03-31", new Set([2026])), { ready: true, missingYears: [] });
  });

  it("soma dias corridos entre meses e em ano bissexto", () => {
    assert.equal(addCalendarDays("2028-02-27", 3), "2028-03-01");
    assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addCalendarDays("2026-03-01", -1), "2026-02-28");
  });
});

describe("Feriados nacionais sugeridos", () => {
  it("calcula a Sexta-feira Santa", () => {
    assert.equal(easterSunday(2026), "2026-04-05");
    assert.equal(easterSunday(2024), "2024-03-31");
    const goodFriday = (year: number) => nationalHolidaySuggestions(year).find((item) => item.description === "Sexta-feira Santa")?.day;
    assert.equal(goodFriday(2026), "2026-04-03");
    assert.equal(goodFriday(2025), "2025-04-18");
    assert.equal(goodFriday(2027), "2027-03-26");
  });

  it("20 de novembro só é nacional a partir de 2024 e carnaval e corpus christi não são sugeridos", () => {
    const has = (year: number, day: string) => nationalHolidaySuggestions(year).some((item) => item.day === day);
    assert.equal(has(2023, "2023-11-20"), false);
    assert.equal(has(2024, "2024-11-20"), true);
    assert.equal(nationalHolidaySuggestions(2026).length, 10);
    assert.ok(nationalHolidaySuggestions(2026).every((item) => !/carnaval|corpus/i.test(item.description)));
  });
});
