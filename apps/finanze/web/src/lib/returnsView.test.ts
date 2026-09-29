import { describe, expect, it } from "vitest";
import type { ReturnsPayload } from "../api/types";
import { accountSummaries, totalSummary } from "./returnsView";

const record = (
  accountId: string,
  from: string,
  to: string,
  days: number,
  grossPct: number,
  netPct: number,
  passiveNet = 0,
) => ({
  accountId,
  from,
  to,
  days,
  method: "declared",
  opening: 100,
  closing: 100,
  contributions: 0,
  grossGain: 0,
  tax: 0,
  netGain: 0,
  base: 100,
  grossPct,
  netPct,
  grossAnnualized: null,
  netAnnualized: null,
  passiveGross: passiveNet,
  passiveNet,
});
const returns = {
  asOf: "2026-03-31",
  records: [
    record("a", "2026-01-01", "2026-01-31", 30, 0.1, 0.08, 5),
    record("a", "2026-01-31", "2026-03-02", 30, 0.1, 0.08, 7),
    record("b", "2026-01-01", "2026-01-31", 30, -0.05, -0.05),
  ],
  totals: [
    {
      date: "2026-01-31",
      grossGain: 0,
      netGain: 0,
      base: 0,
      grossPct: 0.05,
      netPct: 0.04,
      passiveNet: 5,
    },
    {
      date: "2026-03-02",
      grossGain: 0,
      netGain: 0,
      base: 0,
      grossPct: 0.1,
      netPct: 0.08,
      passiveNet: 7,
    },
  ],
} as unknown as ReturnsPayload;
const all = { from: "2000-01-01", to: "2100-01-01" };

describe("returns summary", () => {
  it("chains the period returns of each account and adds up the passive income", () => {
    const [a, b] = accountSummaries(returns, all);
    expect(a!.gross).toBeCloseTo(1.1 * 1.1 - 1, 12);
    expect(a!.net).toBeCloseTo(1.08 * 1.08 - 1, 12);
    expect(a!.passiveNet).toBe(12);
    expect(b!.gross).toBeCloseTo(-0.05, 12);
  });

  it("only counts the periods inside the range", () => {
    const [a] = accountSummaries(returns, { from: "2026-02-01", to: "2026-12-31" });
    expect(a!.periods).toBe(1);
    expect(a!.gross).toBeCloseTo(0.1, 12);
  });

  it("chains the totals and annualises over the whole span", () => {
    const total = totalSummary(returns, all)!;
    expect(total.gross).toBeCloseTo(1.05 * 1.1 - 1, 12);
    expect(total.grossAnnualized).toBeCloseTo(Math.pow(1.05 * 1.1, 365 / 60) - 1, 9);
    expect(totalSummary(returns, { from: "2030-01-01", to: "2031-01-01" })).toBeNull();
  });
});
