import { describe, expect, it } from "vitest";
import { resolveEssentialForMonth } from "./essential";
import type { EssentialSpendingEntry } from "./types";

describe("essential spending precedence (Section 4)", () => {
  const entries: EssentialSpendingEntry[] = [
    { mode: "amount", value: 1000, validFrom: "2026-01-01" },
    { mode: "amount", value: 1200, validFrom: "2026-04-01" },
    { mode: "month_amount", value: 1500, month: "2026-05" },
  ];

  it("has no default: nothing entered means no value", () => {
    expect(resolveEssentialForMonth([], "2026-05", 2000)).toEqual({ monthly: null, source: null });
  });

  it("prefers the month amount of that month over any fixed amount", () => {
    expect(resolveEssentialForMonth(entries, "2026-05", 2000)).toEqual({
      monthly: 1500,
      source: "month_amount",
    });
  });

  it("uses the latest amount not after the month otherwise", () => {
    expect(resolveEssentialForMonth(entries, "2026-03", 2000)).toEqual({
      monthly: 1000,
      source: "amount",
    });
    expect(resolveEssentialForMonth(entries, "2026-06", 2000)).toEqual({
      monthly: 1200,
      source: "amount",
    });
  });

  it("does not apply a month amount to other months", () => {
    expect(resolveEssentialForMonth(entries, "2026-06", 2000).source).toBe("amount");
  });

  it("returns null before the first validFrom", () => {
    expect(resolveEssentialForMonth(entries, "2025-12", 2000).monthly).toBeNull();
  });

  it("applies a fixed amount from the month that contains validFrom", () => {
    const mid: EssentialSpendingEntry[] = [{ mode: "amount", value: 900, validFrom: "2026-04-20" }];
    expect(resolveEssentialForMonth(mid, "2026-04", null).monthly).toBe(900);
    expect(resolveEssentialForMonth(mid, "2026-03", null).monthly).toBeNull();
  });

  it("applies a percentage to the deduced living cost", () => {
    const pct: EssentialSpendingEntry[] = [{ mode: "percent", value: 60, validFrom: "2026-01-01" }];
    expect(resolveEssentialForMonth(pct, "2026-05", 2000)).toEqual({
      monthly: 1200,
      source: "percent",
    });
  });

  it("has no value for a percentage when the living cost is unknown", () => {
    const pct: EssentialSpendingEntry[] = [{ mode: "percent", value: 60, validFrom: "2026-01-01" }];
    expect(resolveEssentialForMonth(pct, "2026-05", null)).toEqual({
      monthly: null,
      source: "percent",
    });
  });

  it("lets the latest of amount and percent win", () => {
    const mixed: EssentialSpendingEntry[] = [
      { mode: "amount", value: 900, validFrom: "2026-01-01" },
      { mode: "percent", value: 50, validFrom: "2026-03-01" },
    ];
    expect(resolveEssentialForMonth(mixed, "2026-02", 2000).monthly).toBe(900);
    expect(resolveEssentialForMonth(mixed, "2026-03", 2000).monthly).toBe(1000);
  });

  it("uses the entry inserted last when two share the same date", () => {
    const tie: EssentialSpendingEntry[] = [
      { mode: "amount", value: 900, validFrom: "2026-01-01" },
      { mode: "amount", value: 950, validFrom: "2026-01-01" },
    ];
    expect(resolveEssentialForMonth(tie, "2026-02", null).monthly).toBe(950);
  });
});
