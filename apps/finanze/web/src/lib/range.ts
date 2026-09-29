import { addMonths } from "./dates";

export type RangeKey = "3m" | "1y" | "all" | "custom";

export const RANGE_LABELS: Record<RangeKey, string> = {
  "3m": "3 mesi",
  "1y": "1 anno",
  all: "Tutto",
  custom: "Personalizzato",
};

export interface DateRange {
  from: string;
  to: string;
}

/** Interval shared by all the dashboard charts. `earliest` is the oldest reading, for "Tutto". */
export function resolveRange(
  key: RangeKey,
  today: string,
  earliest: string | null,
  custom: DateRange,
): DateRange {
  switch (key) {
    case "3m":
      return { from: addMonths(today, -3), to: today };
    case "1y":
      return { from: addMonths(today, -12), to: today };
    case "all":
      return { from: earliest ?? addMonths(today, -12), to: today };
    case "custom":
      return custom.from <= custom.to ? custom : { from: custom.to, to: custom.from };
  }
}

export function inRange(date: string, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}
