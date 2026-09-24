/** Calendar date as `YYYY-MM-DD`. No time zones: dates are plain calendar days. */
export type IsoDate = string;
/** Calendar month as `YYYY-MM`. */
export type IsoMonth = string;

export const DAYS_PER_MONTH = 365.25 / 12;
export const DAYS_PER_YEAR = 365;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export function dayNumber(date: IsoDate): number {
  const match = DATE_RE.exec(date);
  if (!match) throw new RangeError(`Invalid ISO date: ${date}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid ISO date: ${date}`);
  }
  return ms / MS_PER_DAY;
}

export function isIsoDate(value: string): boolean {
  try {
    dayNumber(value);
    return true;
  } catch {
    return false;
  }
}

export function fromDayNumber(n: number): IsoDate {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return dayNumber(b) - dayNumber(a);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromDayNumber(dayNumber(date) + days);
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Adds calendar months keeping the day of month, clamped to the last day of the target month. */
export function addMonths(date: IsoDate, months: number): IsoDate {
  dayNumber(date);
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const index = year * 12 + (month - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  const d = Math.min(day, daysInMonth(y, m));
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function monthOf(date: IsoDate): IsoMonth {
  dayNumber(date);
  return date.slice(0, 7);
}

export function endOfMonth(month: IsoMonth): IsoDate {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new RangeError(`Invalid ISO month: ${month}`);
  const year = Number(match[1]);
  const m = Number(match[2]);
  if (m < 1 || m > 12) throw new RangeError(`Invalid ISO month: ${month}`);
  return `${match[1]}-${match[2]}-${String(daysInMonth(year, m)).padStart(2, "0")}`;
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a >= b ? a : b;
}
