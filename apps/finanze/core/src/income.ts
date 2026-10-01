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

/** Each net income payment with `from < date <= to`. */
export function incomeReceipts(
  items: readonly IncomeItem[],
  from: IsoDate,
  to: IsoDate,
): { date: IsoDate; amount: number }[] {
  const receipts: { date: IsoDate; amount: number }[] = [];
  for (const item of items) {
    const dates = item.kind === "one_off" ? [item.date] : occurrences(item, to);
    for (const date of dates)
      if (date > from && date <= to) receipts.push({ date, amount: item.amount });
  }
  return receipts;
}

/** Net income received with `from < date <= to`. */
export function incomeBetween(items: readonly IncomeItem[], from: IsoDate, to: IsoDate): number {
  let total = 0;
  for (const receipt of incomeReceipts(items, from, to)) total += receipt.amount;
  return total;
}
