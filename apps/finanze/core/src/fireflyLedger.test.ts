import { describe, expect, it } from "vitest";
import { prepareDataset, type LifebookData } from "./dataset";
import { computeLivingCost } from "./livingCost";
import { fireflyLedger, ledgerCovered } from "./fireflyLedger";
import { account, emptyData, salary, spendingAccount, fireflySnap } from "./testkit";
import type { FireflyMovement, Warning } from "./types";

const movement = (
  type: string,
  amount: number,
  from: string | null,
  to: string | null,
  date = "2026-02-10",
  categoryName: string | null = null,
): FireflyMovement => ({ type, amount, fromAccountId: from, toAccountId: to, date, categoryName });
function data(): LifebookData {
  return {
    ...emptyData(),
    accounts: [spendingAccount("cash"), account("broker", "brokerage")],
    snapshots: [
      fireflySnap("cash", "2026-01-31", 1000),
      fireflySnap("cash", "2026-02-28", 2700),
      fireflySnap("broker", "2026-01-31", 10000),
      fireflySnap("broker", "2026-02-28", 11170),
    ],
    fireflyCoverage: ["cash", "broker"].map((accountId) => ({
      accountId,
      from: "2026-02-01",
      to: "2026-02-28",
    })),
    fireflyMovements: [
      movement("deposit", 3000, null, "cash"),
      movement("withdrawal", 300, "cash", null),
      movement("transfer", 1000, "cash", "broker"),
      movement("deposit", 200, null, "broker", "2026-02-11", "Rendita Investimenti"),
      movement("withdrawal", 30, "broker", null),
    ],
    transfers: [{ date: "2026-02-10", amount: 1000, fromAccountId: "cash", toAccountId: "broker" }],
    contributions: [{ accountId: "broker", date: "2026-02-10", amount: 1000 }],
  };
}
const result = (d: LifebookData) => computeLivingCost(prepareDataset(d, "2026-02-28"));
describe("complete Firefly journal", () => {
  it("uses receipts without manual income, includes investment fees, excludes transfers and gains", () => {
    const r = result(data());
    expect(r.periods[0]).toMatchObject({ source: "firefly", income: 3000, spending: 330 });
    expect(r.referenceMonthly).toBe(330);
    expect(r.warnings.some((w) => w.code === "firefly_balance_discrepancy")).toBe(false);
  });
  it("does not double count recurring income and preserves it for non-imported periods", () => {
    const d = data();
    d.incomeItems = [salary(7000, "2026-01-01")];
    expect(result(d).periods[0]!.income).toBe(3000);
    expect(result(d).warnings.some((w) => w.code === "firefly_manual_income_ignored")).toBe(true);
    d.fireflyCoverage = [];
    expect(result(d).periods[0]).toMatchObject({ source: "balances", income: 7000 });
  });
  it("an imported month with no receipts or spending stays zero instead of inventing salary", () => {
    const d = data();
    d.fireflyMovements = [];
    d.incomeItems = [salary(7000, "2026-01-01")];
    expect(result(d).periods[0]).toMatchObject({ income: 0, spending: 0, source: "firefly" });
  });
  it("falls back on incomplete coverage and does not count future movements", () => {
    const d = data();
    d.fireflyCoverage = d.fireflyCoverage!.slice(0, 1);
    expect(result(d).periods[0]!.source).toBe("balances");
    expect(result(d).warnings.some((w) => w.code === "firefly_partial_coverage")).toBe(true);
    const full = data();
    full.fireflyMovements!.push(movement("withdrawal", 999, "cash", null, "2026-03-01"));
    expect(result(full).referenceMonthly).toBe(330);
  });
  it("detects edited balances and excludes explicitly categorized investment losses", () => {
    const d = data();
    d.fireflyMovements!.push(
      movement("withdrawal", 500, "broker", null, "2026-02-12", "Rendita Investimenti"),
    );
    expect(result(d).referenceMonthly).toBe(330);
    expect(result(d).warnings.map((w) => w.code)).toContain("firefly_valuation_excluded");
    expect(result(d).warnings.map((w) => w.code)).toContain("firefly_balance_discrepancy");
  });
  it("combines adjacent coverage ranges but rejects gaps", () => {
    const d = data();
    d.fireflyCoverage = [
      { accountId: "cash", from: "2026-02-01", to: "2026-02-14" },
      { accountId: "cash", from: "2026-02-15", to: "2026-02-28" },
    ];
    expect(ledgerCovered(prepareDataset(d, "2026-02-28"), "cash", "2026-01-31", "2026-02-28")).toBe(
      true,
    );
    d.fireflyCoverage[1]!.from = "2026-02-16";
    expect(ledgerCovered(prepareDataset(d, "2026-02-28"), "cash", "2026-01-31", "2026-02-28")).toBe(
      false,
    );
  });
  it("measures the first imported month even without a prior snapshot or spending flags", () => {
    const d = data();
    d.accounts.forEach((a) => {
      a.params = [];
    });
    d.snapshots = d.snapshots.filter((s) => s.date === "2026-02-28");
    expect(result(d).periods[0]).toMatchObject({
      from: "2026-01-31",
      spending: 330,
      source: "firefly",
    });
  });
  it("includes liability installments only when configured as living cost", () => {
    const d = data();
    d.accounts.push(account("loan", "liability"));
    d.fireflyCoverage!.push({ accountId: "loan", from: "2026-02-01", to: "2026-02-28" });
    d.fireflyMovements!.push(movement("transfer", 100, "cash", "loan"));
    const warnings: Warning[] = [];
    expect(
      fireflyLedger(prepareDataset(d, "2026-02-28"), "2026-01-31", "2026-02-28", warnings)
        ?.spending,
    ).toBe(430);
    d.accounts[2]!.countsAsLivingCost = false;
    expect(result(d).referenceMonthly).toBe(330);
  });
});
