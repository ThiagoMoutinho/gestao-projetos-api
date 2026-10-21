export type CivilDate = {
  year: number;
  month: number;
  day: number;
};

const BELEM = "America/Belem";

export function civilToday(now: Date, timeZone = BELEM): CivilDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
  };
}

export function addBusinessDays(civil: CivilDate, amount: number): CivilDate {
  const cursor = new Date(Date.UTC(civil.year, civil.month - 1, civil.day));
  let left = amount;
  const step = amount >= 0 ? 1 : -1;

  while (left !== 0) {
    cursor.setUTCDate(cursor.getUTCDate() + step);

    if (isWeekday(cursor)) {
      left -= step;
    }
  }

  return {
    year: cursor.getUTCFullYear(),
    month: cursor.getUTCMonth() + 1,
    day: cursor.getUTCDate(),
  };
}

export function previousBusinessDay(civil: CivilDate): CivilDate {
  return addBusinessDays(civil, -1);
}

export function atBelemNoon(civil: CivilDate): Date {
  const month = String(civil.month).padStart(2, "0");
  const day = String(civil.day).padStart(2, "0");

  return new Date(`${civil.year}-${month}-${day}T12:00:00.000-03:00`);
}

function isWeekday(cursor: Date) {
  const day = cursor.getUTCDay();

  return day !== 0 && day !== 6;
}
