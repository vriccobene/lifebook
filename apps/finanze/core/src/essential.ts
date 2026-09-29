import { monthOf, type IsoMonth } from "./dates";
import type { EssentialSpendingEntry } from "./types";

export interface EssentialForMonth {
  /** Monthly essential spending in euro, or null when nothing applies (or a percent has no cost to apply to). */
  monthly: number | null;
  source: "month_amount" | "amount" | "percent" | null;
}

/**
 * Precedence for a month: the `month_amount` of that month, otherwise the latest `amount` or
 * `percent` whose `validFrom` is not after the month. Among equal dates the later entry wins.
 * A percent applies to `livingCost`, the deduced monthly living cost.
 */
export function resolveEssentialForMonth(
  entries: readonly EssentialSpendingEntry[],
  month: IsoMonth,
  livingCost: number | null,
): EssentialForMonth {
  let monthAmount: number | null = null;
  for (const entry of entries) {
    if (entry.mode === "month_amount" && entry.month === month) monthAmount = entry.value;
  }
  if (monthAmount !== null) return { monthly: monthAmount, source: "month_amount" };

  let latest: { entry: EssentialSpendingEntry & { validFrom: string }; index: number } | null =
    null;
  entries.forEach((entry, index) => {
    if (entry.mode === "month_amount") return;
    if (monthOf(entry.validFrom) > month) return;
    if (
      latest === null ||
      entry.validFrom > latest.entry.validFrom ||
      (entry.validFrom === latest.entry.validFrom && index > latest.index)
    ) {
      latest = { entry, index };
    }
  });
  if (latest === null) return { monthly: null, source: null };
  const { entry } = latest as {
    entry: Extract<EssentialSpendingEntry, { mode: "percent" | "amount" }>;
  };
  if (entry.mode === "amount") return { monthly: entry.value, source: "amount" };
  return {
    monthly: livingCost === null ? null : (livingCost * entry.value) / 100,
    source: "percent",
  };
}
