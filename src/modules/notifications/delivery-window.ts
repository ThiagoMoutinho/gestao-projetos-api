import { CalendarIncompleteError, type BusinessCalendar } from "../business-calendar/business-days";
import { civilDay } from "../eap/use-cases/executive-cycle";

/**
 * Janela de entrega das notificações: dias úteis (calendário institucional validado), de 9h00 a 17h59 no horário de
 * Belém. Fora dela só o processamento técnico (avaliação, conciliação, ocorrências, telemetria) pode acontecer.
 */
export const DELIVERY_FIRST_HOUR = 9;
/** Última hora cheia da janela: 17h59 ainda entrega, 18h00 não. */
export const DELIVERY_LAST_HOUR = 17;

export type DeliveryWindow =
  | { open: true; reason: "OPEN" }
  | { open: false; reason: "OUTSIDE_HOURS" | "NOT_BUSINESS_DAY" }
  | { open: false; reason: "CALENDAR_NOT_VALIDATED"; calendarYears: number[] };

export function belemHour(now: Date) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Belem", hour: "2-digit", hourCycle: "h23" }).format(now));
}

export function deliveryWindowAt(now: Date, calendar: BusinessCalendar): DeliveryWindow {
  const hour = belemHour(now);
  if (hour < DELIVERY_FIRST_HOUR || hour > DELIVERY_LAST_HOUR) {
    return { open: false, reason: "OUTSIDE_HOURS" };
  }
  try {
    return calendar.isBusinessDay(civilDay(now)) ? { open: true, reason: "OPEN" } : { open: false, reason: "NOT_BUSINESS_DAY" };
  } catch (error) {
    if (error instanceof CalendarIncompleteError) {
      return { open: false, reason: "CALENDAR_NOT_VALIDATED", calendarYears: error.years };
    }
    throw error;
  }
}
