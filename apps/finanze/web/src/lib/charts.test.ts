import { describe, expect, it } from "vitest";
import type { MethodsPayload, NetWorthPayload, ReturnsPayload, Snapshot } from "../api/types";
import {
  balanceRows,
  costRows,
  coverageRows,
  essentialRows,
  incomeVsCostRows,
  netWorthRows,
  returnsRows,
  savingsRows,
  trafficStrip,
} from "./charts";

const range = { from: "2026-01-01", to: "2026-12-31" };
const period = (to: string, income: number, spending: number, months = 1) => ({
  from: "2025-12-31",
  to,
  days: 30,
  months,
  income,
  spendingAccountsDelta: 0,
  transfers: 0,
  transfersByAccount: [],
  spending,
  monthlySpending: spending / months,
  warnings: [],
});
const living = (periods: ReturnType<typeof period>[]) => ({
  asOf: "2026-12-31",
  periods,
  averages: { 3: null, 6: null, 12: null },
  referenceWindow: 12 as const,
  referenceMonthly: 1,
  incomeMonthly: 1,
  regimeMonthly: 1,
  warnings: [],
});

describe("chart data", () => {
  it("builds the net worth rows with the composition by account type", () => {
    const point = {
      asOf: "2026-01-31",
      netWorth: 100,
      netWorthByType: {
        checking: 10,
        deposit: 0,
        brokerage: 90,
        external_investment: 0,
        pension_fund: 0,
        real_estate: 200,
        liability: -200,
      },
    } as unknown as NetWorthPayload;
    expect(netWorthRows([point])[0]).toMatchObject({
      date: "2026-01-31",
      total: 100,
      real_estate: 200,
      liability: -200,
    });
  });

  it("pivots balances by date and account, keeping only the range", () => {
    const s = (accountId: string, date: string, balance: number): Snapshot => ({
      id: accountId + date,
      accountId,
      date,
      balance,
      source: "manual",
    });
    const rows = balanceRows(
      [
        s("a", "2026-02-28", 2),
        s("b", "2026-02-28", 5),
        s("a", "2026-01-31", 1),
        s("a", "2025-01-31", 99),
      ],
      range,
    );
    expect(rows).toEqual([
      { date: "2026-01-31", a: 1 },
      { date: "2026-02-28", a: 2, b: 5 },
    ]);
  });

  it("puts the moving averages as of each period end next to the monthly cost", () => {
    const l = living([period("2026-02-28", 3000, 2000), period("2026-03-31", 3000, 2200)]);
    const series = [
      { asOf: "2026-03-31", livingCost: { ...l, averages: { 3: 2100, 6: 2100, 12: 2100 } } },
    ];
    const rows = costRows(l, series, range);
    expect(rows[0]).toMatchObject({ date: "2026-02-28", monthly: 2000, ma3: null });
    expect(rows[1]).toMatchObject({ date: "2026-03-31", monthly: 2200, ma3: 2100, ma12: 2100 });
  });

  it("shows income and cost per month, also for a period covering several months", () => {
    const rows = incomeVsCostRows(living([period("2026-03-31", 6000, 3000, 2)]), range);
    expect(rows).toEqual([{ date: "2026-03-31", income: 3000, cost: 1500 }]);
  });

  it("keeps the essential split of the months inside the range", () => {
    const split = [
      { month: "2025-12", livingCost: 1, essential: 1, discretionary: 0, exceedsLivingCost: false },
      {
        month: "2026-03",
        livingCost: 2000,
        essential: 1500,
        discretionary: 500,
        exceedsLivingCost: false,
      },
    ];
    expect(essentialRows(split, range).map((r) => r.date)).toEqual(["2026-03"]);
  });

  it("selects the total or one account for the returns", () => {
    const returns = {
      asOf: "2026-12-31",
      totals: [
        {
          date: "2026-02-28",
          grossPct: 0.02,
          netPct: 0.01,
          grossGain: 0,
          netGain: 0,
          base: 0,
          passiveNet: 0,
        },
      ],
      records: [
        { accountId: "a", to: "2026-02-28", grossPct: 0.03, netPct: 0.02 },
        { accountId: "b", to: "2026-02-28", grossPct: 0.5, netPct: 0.5 },
      ],
    } as unknown as ReturnsPayload;
    expect(returnsRows(returns, null, range)).toEqual([
      { date: "2026-02-28", gross: 0.02, net: 0.01 },
    ]);
    expect(returnsRows(returns, "a", range)).toEqual([
      { date: "2026-02-28", gross: 0.03, net: 0.02 },
    ]);
  });

  it("extracts the savings rate, the coverage and the traffic light of each method over time", () => {
    const point = (asOf: string, status: string, coverage: number | null): MethodsPayload =>
      ({
        asOf,
        publicPensionEnabled: false,
        warnings: [],
        methods: [
          {
            id: "swr",
            family: "A",
            status,
            coverage,
            distance: { eur: 0, kind: "capital", years: null },
            metric: null,
            details: {},
            variants: [],
            missing: [],
          },
          {
            id: "savings_rate",
            family: "E",
            status: "info",
            coverage: null,
            distance: { eur: null, kind: null, years: null },
            metric: { value: 0.3, unit: "ratio" },
            details: {},
            variants: [],
            missing: [],
          },
        ],
      }) as unknown as MethodsPayload;
    const points = [point("2026-01-31", "red", 0.5), point("2026-02-28", "green", 1.1)];
    expect(savingsRows(points)).toEqual([
      { date: "2026-01-31", rate: 0.3 },
      { date: "2026-02-28", rate: 0.3 },
    ]);
    expect(coverageRows(points)).toEqual([
      { date: "2026-01-31", swr: 0.5 },
      { date: "2026-02-28", swr: 1.1 },
    ]);
    expect(coverageRows(points)[0]).not.toHaveProperty("savings_rate"); // monitoring metrics have no traffic light
    expect(trafficStrip(points, "swr").map((c) => c.status)).toEqual(["red", "green"]);
  });
});
