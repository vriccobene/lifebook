import { expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@lifebook/finanze-core";
import type { Account, FireflyMovement, Snapshot } from "../api/types";
import { defaultAnalyticsFilters } from "./analyticsFilters";
import { computeAnalyticsReport } from "./analyticsReport";
const account: Account = {
  id: "bank",
  ownerId: "u",
  name: "Banca",
  institution: null,
  type: "checking",
  realEstateUse: null,
  contributionsMode: "declared",
  countsAsLivingCost: false,
  archivedAt: null,
  params: [{ id: "p", validFrom: "2020-01-01", inInvestableCapital: true }],
};
const snapshot: Snapshot = {
  id: "s",
  accountId: "bank",
  date: "2026-01-01",
  balance: 10000,
  source: "manual",
};
const expense: FireflyMovement = {
  id: "e",
  externalId: "e",
  date: "2026-01-10",
  type: "withdrawal",
  amount: 310,
  fromAccountId: "bank",
  toAccountId: null,
  fromName: "Banca",
  toName: "Negozio",
  description: "Spesa",
  categoryName: "Casa",
};
const filters = defaultAnalyticsFilters("2026-01-01", "2026-01-31");
const compute = (rows: FireflyMovement[], f = filters) =>
  computeAnalyticsReport(
    rows,
    [account],
    [snapshot, { ...snapshot, id: "future", date: "2026-02-01", balance: 999999 }],
    [],
    f,
  );
it("recalculates costs, buffer and methods from category-filtered cash flows, retaining actual balances", () => {
  const rows = [
    expense,
    { ...expense, id: "other", categoryName: "Viaggi", amount: 620 },
    { ...expense, id: "salary", type: "deposit", categoryName: "Stipendio", amount: 2000 },
  ];
  const all = compute(rows);
  const report = compute(rows, { ...filters, category: "Casa" });
  expect(report.livingCost.referenceMonthly).toBe(310);
  expect(report.livingCost.incomeMonthly).toBe(0);
  expect(report.capital.netWorth).toBe(10000);
  expect(report.capital.emergencyBuffer).toBe(310 * DEFAULT_SETTINGS.emergencyBufferMonths);
  expect(report.methods.find((m) => m.id === "swr")?.coverage).not.toBe(
    all.methods.find((m) => m.id === "swr")?.coverage,
  );
});
it("includes empty calendar months in the average and normalizes partial months", () => {
  expect(compute([expense], { ...filters, to: "2026-02-28" }).livingCost.referenceMonthly).toBe(
    155,
  );
  expect(
    compute([{ ...expense, date: "2026-01-01", amount: 10 }], { ...filters, to: "2026-01-01" })
      .livingCost.referenceMonthly,
  ).toBe(310);
});
it("does not infer zero living costs or a green verdict from an empty report", () => {
  const report = compute([], filters);
  expect(report.livingCost.referenceMonthly).toBeNull();
  expect(report.verdict.status).toBe("missing_data");
});
it("respects account exclusions, excluded annotations and transfers", () => {
  const report = compute([
    expense,
    { ...expense, id: "transfer", type: "transfer", amount: 10000 },
    {
      ...expense,
      id: "excluded",
      annotation: {
        tags: [],
        included: false,
        spendingClass: "unclassified",
        isYield: false,
        grossAmount: null,
      },
    },
  ]);
  expect(report.livingCost.referenceMonthly).toBe(310);
  expect(compute([expense], { ...filters, excludedAccounts: ["Banca"] }).capital.balances).toEqual(
    [],
  );
});

it("annualizes selected net yields using the receipt-date tax, without future settings", () => {
  const investment = {
    ...account,
    type: "brokerage" as const,
    params: [{ id: "p", validFrom: "2020-01-01", taxRate: 0.26, inInvestableCapital: true }],
  };
  const report = computeAnalyticsReport(
    [
      expense,
      {
        ...expense,
        id: "yield",
        type: "deposit",
        amount: 100,
        categoryName: "Dividendi",
        toAccountId: "bank",
      },
    ],
    [investment],
    [snapshot],
    [{ validFrom: "2027-01-01", emergencyBufferMonths: 100 }],
    filters,
  );
  expect(report.totals.yieldNet).toBe(74);
  expect(report.capital.passiveNetAnnual).toBe(888);
  expect(report.capital.safeFlowsNetAnnual).toBe(0);
  expect(report.capital.emergencyBuffer).toBe(310 * DEFAULT_SETTINGS.emergencyBufferMonths);
  expect(report.essential).toBeNull();
});
it("includes the union of chosen categories and still applies exclusions", () => {
  const rows = [
    expense,
    { ...expense, id: "b", categoryName: "Bollette", amount: 100 },
    { ...expense, id: "v", categoryName: "Viaggi", amount: 1000 },
  ];
  expect(
    compute(rows, { ...filters, includedCategories: ["Casa", "Bollette"] }).totals.spending,
  ).toBe(410);
  expect(
    compute(rows, {
      ...filters,
      includedCategories: ["Casa", "Bollette"],
      excludedCategories: ["Casa"],
    }).totals.spending,
  ).toBe(100);
});
