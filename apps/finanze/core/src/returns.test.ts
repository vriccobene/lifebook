import { describe, expect, it } from "vitest";
import { prepareDataset } from "./dataset";
import { accruedInterest } from "./livingCost";
import { computeReturns, linkReturns } from "./returns";
import { account, contribution, emptyData, snap, spendingAccount } from "./testkit";
import type { LifebookData } from "./dataset";

const returns = (data: LifebookData, asOf = "2026-12-31") =>
  computeReturns(prepareDataset(data, asOf));

describe("returns: Modified Dietz", () => {
  it("weights a contribution by the time it was invested", () => {
    const data = emptyData();
    data.accounts.push(account("bro", "brokerage", { params: { taxRate: 0.26 } }));
    // 30-day period, 5000 added on day 15 (weight 15/30)
    data.snapshots.push(snap("bro", "2026-01-01", 10_000), snap("bro", "2026-01-31", 16_000));
    data.contributions.push(contribution("bro", "2026-01-16", 5_000));
    const [record] = returns(data).records;
    expect(record!.grossGain).toBe(1_000);
    expect(record!.base).toBe(12_500);
    expect(record!.grossPct).toBeCloseTo(0.08, 12);
    expect(record!.tax).toBeCloseTo(260, 9);
    expect(record!.netPct).toBeCloseTo(740 / 12_500, 12);
  });

  it("does not tax losses", () => {
    const data = emptyData();
    data.accounts.push(account("bro", "brokerage", { params: { taxRate: 0.26 } }));
    data.snapshots.push(snap("bro", "2026-01-01", 10_000), snap("bro", "2026-01-31", 9_000));
    const [record] = returns(data).records;
    expect(record!.tax).toBe(0);
    expect(record!.netGain).toBe(-1_000);
    expect(record!.netPct).toBeCloseTo(-0.1, 12);
  });

  it("annualises with compounding over the actual days", () => {
    const data = emptyData();
    data.accounts.push(account("bro", "brokerage"));
    data.snapshots.push(snap("bro", "2026-01-01", 10_000), snap("bro", "2026-01-31", 10_100));
    const [record] = returns(data).records;
    expect(record!.grossAnnualized).toBeCloseTo(Math.pow(1.01, 365 / 30) - 1, 12);
  });

  it("does not divide by zero on an empty account", () => {
    const data = emptyData();
    data.accounts.push(account("bro", "brokerage"));
    data.snapshots.push(snap("bro", "2026-01-01", 0), snap("bro", "2026-01-31", 0));
    expect(returns(data).records[0]!.grossPct).toBeNull();
  });

  it("reports the passive part (dividends) net of tax", () => {
    const data = emptyData();
    data.accounts.push(
      account("bro", "brokerage", { params: { taxRate: 0.26, passiveYield: 0.03 } }),
    );
    data.snapshots.push(snap("bro", "2026-01-01", 100_000), snap("bro", "2027-01-01", 105_000));
    const [record] = returns(data, "2027-01-01").records;
    expect(record!.passiveGross).toBeCloseTo(3_000, 9);
    expect(record!.passiveNet).toBeCloseTo(3_000 * 0.74, 9);
  });
});

describe("returns: by account kind", () => {
  it("uses the declared interest rate for inferred accounts", () => {
    const data = emptyData();
    data.accounts.push(
      account("dep", "deposit", { params: { interestRate: 0.03, taxRate: 0.26 } }),
    );
    data.snapshots.push(snap("dep", "2026-01-01", 50_000), snap("dep", "2026-02-01", 50_500));
    const [record] = returns(data).records;
    const gross = accruedInterest(50_000, 0.03, 31);
    expect(record!.method).toBe("inferred");
    expect(record!.grossGain).toBeCloseTo(gross, 9);
    expect(record!.netGain).toBeCloseTo(gross * 0.74, 9);
    expect(record!.passiveNet).toBeCloseTo(gross * 0.74, 9);
  });

  it("adds net rent to the revaluation for an income property, taxing only the rent", () => {
    const data = emptyData();
    data.accounts.push(
      account("flat", "real_estate", {
        realEstateUse: "income",
        params: { passiveYield: 0.04, taxRate: 0.21 },
      }),
    );
    data.snapshots.push(snap("flat", "2026-01-01", 200_000), snap("flat", "2027-01-01", 210_000));
    const [record] = returns(data, "2027-01-01").records;
    const rent = (200_000 * 0.04 * 365) / 365;
    expect(record!.method).toBe("real_estate_income");
    expect(record!.grossGain).toBeCloseTo(10_000 + rent, 9);
    expect(record!.tax).toBeCloseTo(rent * 0.21, 9);
    expect(record!.passiveGross).toBeCloseTo(rent, 9);
  });

  it("reports only the revaluation for the primary residence", () => {
    const data = emptyData();
    data.accounts.push(
      account("home", "real_estate", {
        realEstateUse: "primary_residence",
        params: { passiveYield: 0.04 },
      }),
    );
    data.snapshots.push(snap("home", "2026-01-01", 200_000), snap("home", "2026-06-01", 204_000));
    const [record] = returns(data).records;
    expect(record!.method).toBe("appreciation");
    expect(record!.grossGain).toBe(4_000);
    expect(record!.passiveGross).toBe(0);
  });

  it("skips spending accounts and liabilities", () => {
    const data = emptyData();
    data.accounts.push(spendingAccount(), account("loan", "liability"));
    data.snapshots.push(
      snap("chk", "2026-01-01", 1_000),
      snap("chk", "2026-02-01", 1_500),
      snap("loan", "2026-01-01", -5_000),
      snap("loan", "2026-02-01", -4_800),
    );
    expect(returns(data).records).toEqual([]);
  });

  it("computes a stale account over its own two readings", () => {
    const data = emptyData();
    data.accounts.push(account("bro", "brokerage"));
    data.snapshots.push(snap("bro", "2026-01-31", 1_000), snap("bro", "2026-04-30", 1_090));
    const [record] = returns(data).records;
    expect(record!.days).toBe(89);
    expect(record!.grossPct).toBeCloseTo(0.09, 12);
  });

  it("stops at the archive date", () => {
    const data = emptyData();
    data.accounts.push(account("bro", "brokerage", { archivedAt: "2026-03-01" }));
    data.snapshots.push(
      snap("bro", "2026-01-01", 1_000),
      snap("bro", "2026-02-01", 1_100),
      snap("bro", "2026-03-01", 1_200),
    );
    expect(returns(data).records).toHaveLength(1);
  });

  it("uses the tax rate in force at the end of the interval", () => {
    const data = emptyData();
    data.accounts.push(account("bro", "brokerage", { params: { taxRate: 0.26 } }));
    data.accounts[0]!.params.push({ validFrom: "2026-02-01", taxRate: 0.1 });
    data.snapshots.push(
      snap("bro", "2026-01-01", 1_000),
      snap("bro", "2026-02-01", 1_100),
      snap("bro", "2026-03-01", 1_200),
    );
    const taxes = returns(data).records.map((r) => r.tax);
    expect(taxes[0]).toBeCloseTo(10, 9); // interval ending on 02-01 already uses 10%
    expect(taxes[1]).toBeCloseTo(10, 9);
  });
});

describe("returns: totals and linking", () => {
  it("weights the total by the capital base of each account", () => {
    const data = emptyData();
    data.accounts.push(account("a", "brokerage"), account("b", "brokerage"));
    data.snapshots.push(
      snap("a", "2026-01-01", 10_000),
      snap("a", "2026-02-01", 11_000), // +10%
      snap("b", "2026-01-01", 90_000),
      snap("b", "2026-02-01", 90_000), // 0%
    );
    const [total] = returns(data).totals;
    expect(total!.grossPct).toBeCloseTo(0.01, 12); // 1000 / 100000, not the 5% simple average
  });

  it("chain-links period returns", () => {
    const data = emptyData();
    data.accounts.push(account("a", "brokerage"));
    data.snapshots.push(
      snap("a", "2026-01-01", 100),
      snap("a", "2026-02-01", 110),
      snap("a", "2026-03-01", 99),
    );
    const linked = linkReturns(returns(data).records);
    expect(linked.gross).toBeCloseTo(-0.01, 12);
    expect(linked.days).toBe(59);
  });

  it("ignores data after the as-of date", () => {
    const data = emptyData();
    data.accounts.push(account("a", "brokerage"));
    data.snapshots.push(
      snap("a", "2026-01-01", 100),
      snap("a", "2026-02-01", 110),
      snap("a", "2026-03-01", 500),
    );
    expect(returns(data, "2026-02-15").records).toHaveLength(1);
  });
});
