import { describe, expect, it } from "vitest";
import { incomeBetween } from "./income";
import type { IncomeItem } from "./types";

const recurring = (
  periodicity: "monthly" | "quarterly" | "yearly",
  startDate: string,
  endDate: string | null = null,
  amount = 100,
): IncomeItem => ({
  id: periodicity,
  name: periodicity,
  amount,
  kind: "recurring",
  periodicity,
  startDate,
  endDate,
});

describe("income in a period", () => {
  it("counts one-off items with the period start excluded and end included", () => {
    const item: IncomeItem = {
      id: "b",
      name: "Bonus",
      amount: 500,
      kind: "one_off",
      date: "2026-03-31",
    };
    expect(incomeBetween([item], "2026-02-28", "2026-03-31")).toBe(500);
    expect(incomeBetween([item], "2026-03-31", "2026-04-30")).toBe(0);
  });

  it("counts monthly occurrences, clamping the day to short months", () => {
    const item = recurring("monthly", "2026-01-31");
    // Feb 28 (clamped), Mar 31, Apr 30
    expect(incomeBetween([item], "2026-01-31", "2026-04-30")).toBe(300);
    expect(incomeBetween([item], "2026-02-27", "2026-02-28")).toBe(100);
  });

  it("counts several occurrences inside a long period (a missing round)", () => {
    const item = recurring("monthly", "2026-01-31");
    expect(incomeBetween([item], "2026-01-31", "2026-03-31")).toBe(200);
  });

  it("handles quarterly and yearly items (e.g. a thirteenth salary)", () => {
    const quarterly = recurring("quarterly", "2026-01-15");
    const yearly = recurring("yearly", "2026-12-15", null, 2000);
    expect(incomeBetween([quarterly], "2025-12-31", "2026-12-31")).toBe(400);
    expect(incomeBetween([yearly], "2026-11-30", "2026-12-31")).toBe(2000);
    expect(incomeBetween([yearly], "2026-12-31", "2027-11-30")).toBe(0);
    expect(incomeBetween([yearly], "2026-12-31", "2027-12-31")).toBe(2000);
  });

  it("stops at the end date and ignores occurrences before the start", () => {
    const item = recurring("monthly", "2026-03-10", "2026-05-10");
    expect(incomeBetween([item], "2026-01-01", "2026-12-31")).toBe(300);
    expect(incomeBetween([item], "2026-01-01", "2026-03-09")).toBe(0);
  });

  it("sums several items", () => {
    const items = [
      recurring("monthly", "2026-01-31", null, 2000),
      recurring("yearly", "2026-06-30", null, 1000),
    ];
    expect(incomeBetween(items, "2026-05-31", "2026-06-30")).toBe(3000);
  });
});
