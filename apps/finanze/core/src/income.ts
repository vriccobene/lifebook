import { addMonths, type IsoDate } from "./dates";
import type { IncomeItem, Periodicity } from "./types";

const STEP_MONTHS: Record<Periodicity, number> = { monthly: 1, quarterly: 3, yearly: 12 };

/** Occurrence dates of a recurring item: the start date plus multiples of the period, day-of-month clamped. */
function occurrences(item: Extract<IncomeItem, { kind: "recurring" }>, upTo: IsoDate): IsoDate[] {
  const dates: IsoDate[] = [];
  const step = STEP_MONTHS[item.periodicity];
  for (let k = 0; ; k++) {
    const date = addMonths(item.startDate, k * step);
    if (date > upTo || (item.endDate !== null && date > item.endDate)) break;
    dates.push(date);
  }
  return dates;
}

/** Net income received with `from < date <= to`. */
export function incomeBetween(items: readonly IncomeItem[], from: IsoDate, to: IsoDate): number {
  let total = 0;
  for (const item of items) {
    if (item.kind === "one_off") {
      if (item.date > from && item.date <= to) total += item.amount;
    } else {
      total += occurrences(item, to).filter((d) => d > from).length * item.amount;
    }
  }
  return total;
}
