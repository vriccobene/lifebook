import { addMonths, endOfMonth, monthOf } from "@lifebook/core";

export { addMonths, endOfMonth, monthOf };

const pad = (n: number) => String(n).padStart(2, "0");

/** Today in the user's time zone as `YYYY-MM-DD`. */
export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The sensible reference date of a monthly round: the end of the current month. */
export function defaultRoundDate(today: string): string {
  return endOfMonth(monthOf(today));
}
