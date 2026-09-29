import { describe, expect, it } from "vitest";
import { prepareDataset } from "./dataset";
import { accruedInterest, computeLivingCost } from "./livingCost";
import {
  MONTH_ENDS_2026,
  account,
  contribution,
  emptyData,
  salary,
  snap,
  spendingAccount,
  steadyLife,
} from "./testkit";
import type { LifebookData } from "./dataset";
import type { IsoDate } from "./dates";

function livingCost(data: LifebookData, asOf: IsoDate = "2026-12-31") {
  return computeLivingCost(prepareDataset(data, asOf));
}

describe("living cost: spending of a period", () => {
  it("is income minus the change of the spending accounts", () => {
    const result = livingCost(steadyLife({ months: 3 }));
    expect(result.periods).toHaveLength(3);
    for (const period of result.periods) expect(period.spending).toBe(1500);
    expect(result.periods[0]!.months).toBe(1);
    expect(result.periods[0]!.monthlySpending).toBe(1500); // a 31-day month is not scaled
  });

  it("ignores market moves on declared accounts (regression: a loss is not spending)", () => {
    const build = (brokerBalance: number): LifebookData => {
      const data = emptyData();
      data.accounts.push(spendingAccount(), account("bro", "brokerage"));
      data.incomeItems.push(salary(2000, "2026-01-31"));
      // chk: +2000 income -1500 spending -300 sent to the broker
      data.snapshots.push(snap("chk", "2025-12-31", 1000), snap("chk", "2026-01-31", 1200));
      data.snapshots.push(
        snap("bro", "2025-12-31", 5000),
        snap("bro", "2026-01-31", brokerBalance),
      );
      data.contributions.push(contribution("bro", "2026-01-15", 300));
      return data;
    };
    expect(livingCost(build(4900)).periods[0]!.spending).toBe(1500); // market loss
    expect(livingCost(build(6000)).periods[0]!.spending).toBe(1500); // market gain
  });

  it("subtracts a withdrawal from a declared account (money back into spending)", () => {
    const data = emptyData();
    data.accounts.push(spendingAccount(), account("bro", "brokerage"));
    data.incomeItems.push(salary(2000, "2026-01-31"));
    // chk: +2000 income -1500 spending +500 withdrawn from the broker
    data.snapshots.push(snap("chk", "2025-12-31", 1000), snap("chk", "2026-01-31", 2000));
    data.contributions.push(contribution("bro", "2026-01-20", -500));
    expect(livingCost(data).periods[0]!.spending).toBe(1500);
  });

  it("infers deposit transfers from the balance change net of interest", () => {
    const data = emptyData();
    const taxRate = 0.26;
    data.accounts.push(
      spendingAccount(),
      account("dep", "deposit", { params: { interestRate: 0.05, taxRate } }),
    );
    data.incomeItems.push(salary(2000, "2026-02-28"));
    const netInterest = accruedInterest(10_000, 0.05, 28) * (1 - taxRate);
    // 2026-02-28: chk +2000 income -1500 spending -500 moved to the deposit
    data.snapshots.push(
      snap("chk", "2026-01-31", 1000),
      snap("chk", "2026-02-28", 1000),
      snap("dep", "2026-01-31", 10_000),
      snap("dep", "2026-02-28", 10_000 + 500 + netInterest),
    );
    expect(livingCost(data).periods[0]!.spending).toBeCloseTo(1500, 9);
  });

  it("applies the tax rate to inferred interest (Section 13: net of taxRate)", () => {
    const build = (taxRate: number): LifebookData => {
      const data = emptyData();
      data.accounts.push(
        spendingAccount(),
        account("dep", "deposit", { params: { interestRate: 0.05, taxRate } }),
      );
      data.snapshots.push(
        snap("chk", "2026-01-31", 1000),
        snap("chk", "2026-02-28", 1000),
        snap("dep", "2026-01-31", 10_000),
        snap("dep", "2026-02-28", 10_040),
      );
      return data;
    };
    // The same balances imply a smaller transfer when more interest is credited.
    const gross = livingCost(build(0)).periods[0]!.transfers;
    const taxed = livingCost(build(0.26)).periods[0]!.transfers;
    expect(taxed).toBeGreaterThan(gross);
  });

  it("ignores real estate revaluations", () => {
    const data = steadyLife({ months: 2 });
    data.accounts.push(account("home", "real_estate", { realEstateUse: "primary_residence" }));
    data.snapshots.push(
      snap("home", "2025-12-31", 200_000),
      snap("home", "2026-01-31", 230_000),
      snap("home", "2026-02-28", 180_000),
    );
    expect(livingCost(data).periods.map((p) => p.spending)).toEqual([1500, 1500]);
  });

  it("cancels transfers between two spending accounts", () => {
    const data = steadyLife({ months: 1 });
    data.accounts.push(spendingAccount("chk2"));
    // 300 moved from chk to chk2: chk shows the salary +500 -300, chk2 +300
    data.snapshots = [
      snap("chk", "2025-12-31", 1000),
      snap("chk", "2026-01-31", 1200),
      snap("chk2", "2025-12-31", 100),
      snap("chk2", "2026-01-31", 400),
    ];
    const period = livingCost(data).periods[0]!;
    // chk: +2000 - 1500 spending - 300 to chk2 = +200; chk2 +300
    expect(period.spendingAccountsDelta).toBe(500);
    expect(period.spending).toBe(1500);
  });

  it("flags a negative spending period", () => {
    const data = emptyData();
    data.accounts.push(spendingAccount());
    data.snapshots.push(snap("chk", "2026-01-31", 1000), snap("chk", "2026-02-28", 5000));
    const result = livingCost(data);
    expect(result.periods[0]!.spending).toBe(-4000);
    expect(result.warnings.map((w) => w.code)).toContain("negative_spending");
  });
});

describe("living cost: liabilities", () => {
  const build = (countsAsLivingCost: boolean): LifebookData => {
    const data = emptyData();
    data.accounts.push(
      spendingAccount(),
      account("mortgage", "liability", {
        countsAsLivingCost,
        params: { monthlyPayment: 450, interestRate: 0.03 },
      }),
    );
    data.incomeItems.push(salary(2000, "2026-02-28"));
    // chk: +2000 income -1000 other spending -450 installment (400 capital + 50 interest)
    data.snapshots.push(snap("chk", "2026-01-31", 1000), snap("chk", "2026-02-28", 1550));
    data.snapshots.push(
      snap("mortgage", "2026-01-31", -100_000),
      snap("mortgage", "2026-02-28", -99_600),
    );
    data.contributions.push(contribution("mortgage", "2026-02-10", 400));
    return data;
  };

  it("counts the whole installment as living cost when countsAsLivingCost is on", () => {
    expect(livingCost(build(true)).periods[0]!.spending).toBe(1450);
  });

  it("excludes the whole installment, interest included, when it is off", () => {
    expect(livingCost(build(false)).periods[0]!.spending).toBe(1000);
  });

  it("computes the regime cost without installments ending before the target age", () => {
    const data = build(true);
    data.accounts[1]!.params.push({ validFrom: "2000-01-01", paymentEndDate: "2028-01-31" });
    data.settings.push({ validFrom: "2000-01-01", currentAge: 45, targetRetirementAge: 50 });
    const result = livingCost(data, "2026-02-28");
    expect(result.referenceMonthly).toBeCloseTo(result.regimeMonthly! + 450, 9);
  });

  it("keeps installments that end after the target age in the regime cost", () => {
    const data = build(true);
    data.accounts[1]!.params.push({ validFrom: "2000-01-01", paymentEndDate: "2040-01-31" });
    data.settings.push({ validFrom: "2000-01-01", currentAge: 45, targetRetirementAge: 50 });
    const result = livingCost(data, "2026-02-28");
    expect(result.regimeMonthly).toBe(result.referenceMonthly);
  });
});

describe("living cost: missing rounds and moving averages", () => {
  it("lengthens the period and normalises on the months it covers when a month is missing", () => {
    const data = steadyLife({ months: 3 });
    data.snapshots = data.snapshots.filter((s) => s.date !== "2026-02-28");
    const result = livingCost(data);
    expect(result.periods).toHaveLength(2);
    const long = result.periods[1]!;
    expect(long.months).toBe(2);
    expect(long.days).toBe(59);
    expect(long.spending).toBe(3000);
    expect(long.monthlySpending).toBe(1500);
  });

  it("computes 3, 6 and 12 month averages as total spending over the months covered", () => {
    const data = steadyLife({ months: 12 });
    // make the last three months more expensive
    let balance = 1000;
    data.snapshots = [{ ...data.snapshots[0]! }];
    MONTH_ENDS_2026.forEach((date, i) => {
      balance += 2000 - (i >= 9 ? 2100 : 1500);
      data.snapshots.push(snap("chk", date, balance));
    });
    const result = livingCost(data);
    expect(result.averages[3]).toBeCloseTo(2100, 9);
    expect(result.averages[6]).toBeCloseTo((3 * 1500 + 3 * 2100) / 6, 9);
    expect(result.averages[12]).toBeCloseTo((9 * 1500 + 3 * 2100) / 12, 9);
  });

  it("keeps the window a whole number of months even from a short month (regression)", () => {
    // Window ends on Feb 28: three months are Dec, Jan, Feb, never four
    const data = steadyLife({ months: 2 });
    data.snapshots.unshift(snap("chk", "2025-11-30", 1000));
    data.snapshots = data.snapshots.map((s) =>
      s.date === "2025-12-31" ? { ...s, balance: 0 } : s,
    );
    const periods = livingCost(data, "2026-02-28").periods;
    expect(periods.map((p) => p.months)).toEqual([1, 1, 1]);
    const spent = periods.map((p) => p.spending);
    expect(livingCost(data, "2026-02-28").averages[3]).toBeCloseTo(
      spent.reduce((a, b) => a + b, 0) / 3,
      9,
    );
  });

  it("uses the window chosen in the settings as the reference (default 12)", () => {
    const data = steadyLife({ months: 12 });
    expect(livingCost(data).referenceWindow).toBe(12);
    data.settings.push({ validFrom: "2026-01-01", livingCostWindow: 3 });
    const result = livingCost(data);
    expect(result.referenceWindow).toBe(3);
    expect(result.referenceMonthly).toBe(result.averages[3]);
  });

  it("warns when the history is shorter than the reference window", () => {
    const result = livingCost(steadyLife({ months: 2 }));
    expect(result.referenceMonthly).not.toBeNull();
    expect(result.warnings.map((w) => w.code)).toContain("insufficient_history");
  });

  it("returns no cost with fewer than two rounds", () => {
    const result = livingCost(steadyLife({ months: 0 }));
    expect(result.periods).toEqual([]);
    expect(result.referenceMonthly).toBeNull();
  });
});

describe("living cost: dated parameters and archived accounts", () => {
  it("uses the tax rate in force at the end of each period", () => {
    const data = emptyData();
    data.accounts.push(
      spendingAccount(),
      account("dep", "deposit", {
        params: { interestRate: 0.05, taxRate: 0.26 },
      }),
    );
    data.accounts[1]!.params.push({ validFrom: "2026-02-01", taxRate: 0.125 });
    for (const [date, chk, dep] of [
      ["2026-01-31", 1000, 10_000],
      ["2026-02-28", 1000, 10_000],
      ["2026-03-31", 1000, 10_000],
    ] as const) {
      data.snapshots.push(snap("chk", date, chk), snap("dep", date, dep));
    }
    const result = livingCost(data);
    // No deposits were made, so a wrong rate shows up as a non-zero transfer difference.
    const feb = result.periods[0]!.transfers;
    expect(feb).toBeCloseTo(-accruedInterest(10_000, 0.05, 28) * (1 - 0.125), 9);
  });

  it("stops counting an account once it is archived", () => {
    const data = steadyLife({ months: 2 });
    data.accounts.push(account("old", "brokerage", { archivedAt: "2026-01-31" }));
    data.snapshots.push(snap("old", "2025-12-31", 1000));
    data.contributions.push(contribution("old", "2026-02-15", 700));
    // Archived on Jan 31: the February contribution must not be subtracted.
    expect(livingCost(data).periods.map((p) => p.spending)).toEqual([1500, 1500]);
  });

  it("does not use a spending account archived before the period", () => {
    const data = steadyLife({ months: 2 });
    data.accounts.push(spendingAccount("old"));
    data.accounts[1]!.archivedAt = "2026-01-31";
    data.snapshots.push(snap("old", "2025-12-31", 900), snap("old", "2026-01-31", 0));
    // Closed on Jan 31: its balance vanishing is not spending.
    const result = livingCost(data);
    expect(result.periods.map((p) => p.spending)).toEqual([1500, 1500]);
  });
});

describe("living cost: validations", () => {
  it("warns about a spending account without a reading in the period", () => {
    const data = steadyLife({ months: 2 });
    data.accounts.push(spendingAccount("chk2"));
    data.snapshots.push(snap("chk2", "2025-12-31", 500), snap("chk2", "2026-01-31", 500));
    const codes = livingCost(data).warnings.map((w) => w.code);
    expect(codes).toContain("spending_account_missing_reading");
  });

  it("warns when a new spending account has no opening balance", () => {
    const data = steadyLife({ months: 1 });
    data.accounts.push(spendingAccount("chk2"));
    data.snapshots.push(snap("chk2", "2026-01-31", 5000));
    const result = livingCost(data);
    expect(result.warnings.map((w) => w.code)).toContain("account_no_opening_balance");
    expect(result.periods[0]!.spending).toBe(1500);
  });

  it("warns when a declared account moved a lot without contributions", () => {
    const data = steadyLife({ months: 1 });
    data.accounts.push(account("bro", "brokerage"));
    data.snapshots.push(snap("bro", "2025-12-31", 1000), snap("bro", "2026-01-31", 1500));
    expect(livingCost(data).warnings.map((w) => w.code)).toContain(
      "declared_contributions_missing",
    );
  });

  it("does not warn when the movement is small", () => {
    const data = steadyLife({ months: 1 });
    data.accounts.push(account("bro", "brokerage"));
    data.snapshots.push(snap("bro", "2025-12-31", 1000), snap("bro", "2026-01-31", 1050));
    expect(livingCost(data).warnings.map((w) => w.code)).not.toContain(
      "declared_contributions_missing",
    );
  });

  it("flags a period far from the average", () => {
    const data = steadyLife({ months: 6 });
    // an unusually expensive month: drop 3000 from the March balance onwards
    data.snapshots = data.snapshots.map((s) =>
      s.date >= "2026-03-31" ? { ...s, balance: s.balance - 3000 } : s,
    );
    const outliers = livingCost(data).warnings.filter((w) => w.code === "spending_outlier");
    expect(outliers.map((w) => w.to)).toEqual(["2026-03-31"]);
  });

  it("reports stale accounts relative to the newest reading", () => {
    const data = steadyLife({ months: 4 });
    data.accounts.push(account("bro", "brokerage"));
    data.snapshots.push(snap("bro", "2026-01-31", 1000));
    const stale = livingCost(data).warnings.find((w) => w.code === "stale_account");
    expect(stale?.accountId).toBe("bro");
    expect(stale?.detail).toBe(89); // Jan 31 -> Apr 30: 28 + 31 + 30 days
  });

  it("reports when there is no spending account", () => {
    const data = emptyData();
    data.accounts.push(account("bro", "brokerage"));
    data.snapshots.push(snap("bro", "2026-01-31", 1000));
    expect(livingCost(data).warnings.map((w) => w.code)).toContain("no_spending_account");
  });
});

describe("living cost: periods are calendar months", () => {
  const monthlyReadings = (days: string[]): LifebookData => {
    // 2000 salary on the last day of the month, 1500 spent: the balance grows 500 a month
    const data = emptyData();
    data.accounts.push(spendingAccount());
    data.incomeItems.push(salary(2000, "2026-01-31"));
    data.snapshots.push(snap("chk", "2025-12-31", 1000));
    days.forEach((date, i) => data.snapshots.push(snap("chk", date, 1000 + 500 * (i + 1))));
    return data;
  };

  it("makes no difference whether the reading is on the 29th or the 31st (regression)", () => {
    const result = livingCost(monthlyReadings(["2026-01-31", "2026-02-27", "2026-03-31"]));
    expect(result.periods.map((p) => p.months)).toEqual([1, 1, 1]);
    // no short periods: one per month
    expect(result.periods.map((p) => p.to)).toEqual(["2026-01-31", "2026-02-27", "2026-03-31"]);
  });

  it("never creates a period shorter than a month from two spending accounts read on different days", () => {
    const data = steadyLife({ months: 3 });
    data.accounts.push(spendingAccount("chk2"));
    data.snapshots.push(
      snap("chk2", "2025-12-30", 100),
      snap("chk2", "2026-01-29", 100),
      snap("chk2", "2026-02-26", 100),
      snap("chk2", "2026-03-30", 100),
    );
    const result = livingCost(data);
    // one boundary per month, on the latest reading of that month
    expect(result.periods.map((p) => p.to)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(result.periods.every((p) => p.months === 1)).toBe(true);
  });

  it("recovers a late or early reading the following month", () => {
    // True spending is 1500 every month. February is read on the 20th, before the salary of the 28th.
    const data = emptyData();
    data.accounts.push(spendingAccount());
    data.incomeItems.push(salary(2000, "2026-01-31"));
    data.snapshots.push(
      snap("chk", "2025-12-31", 1000),
      snap("chk", "2026-01-31", 1500),
      snap("chk", "2026-02-20", 1500 - 1500 * (20 / 28) + 0), // partway through February
      snap("chk", "2026-03-31", 2500),
    );
    const result = livingCost(data);
    expect(result.periods.map((p) => p.months)).toEqual([1, 1, 1]);
    // whatever one month mis-states is recovered by the next: the two months add up to the truth
    const [, feb, mar] = result.periods;
    expect(feb!.spending + mar!.spending).toBeCloseTo(3000, 6);
  });

  it("counts income between the two cut-off dates, so a salary is neither lost nor counted twice", () => {
    const data = emptyData();
    data.accounts.push(spendingAccount());
    // salary on the 25th; readings on the 10th of each month
    data.incomeItems.push(salary(2000, "2026-01-25"));
    data.snapshots.push(
      snap("chk", "2026-01-10", 0),
      snap("chk", "2026-02-10", 2000),
      snap("chk", "2026-03-10", 4000),
    );
    const result = livingCost(data);
    expect(result.periods.map((p) => p.income)).toEqual([2000, 2000]);
  });

  it("uses the number of calendar months, not the days, to spread a month without readings", () => {
    const data = steadyLife({ months: 4 });
    data.snapshots = data.snapshots.filter(
      (s) => s.date !== "2026-02-28" && s.date !== "2026-03-31",
    );
    const [first, long] = livingCost(data).periods;
    expect(first!.months).toBe(1);
    expect(long!.months).toBe(3);
    expect(long!.monthlySpending).toBe(1500);
  });
});

describe("living cost: pension fund contributions", () => {
  it("are transfers, not spending, exactly like other declared accounts (regression)", () => {
    const data = steadyLife({ months: 2, salary: 2000, monthlySpending: 1500 });
    data.accounts.push(account("fund", "pension_fund"));
    // 200 a month leave the spending account for the fund: it grows by 300 instead of 500
    data.snapshots = data.snapshots.filter((s) => s.accountId !== "chk");
    data.snapshots.push(
      snap("chk", "2025-12-31", 1000),
      snap("chk", "2026-01-31", 1300),
      snap("chk", "2026-02-28", 1600),
      snap("fund", "2025-12-31", 10_000),
      snap("fund", "2026-01-31", 10_200),
      snap("fund", "2026-02-28", 10_400),
    );
    data.contributions.push(
      contribution("fund", "2026-01-20", 200),
      contribution("fund", "2026-02-20", 200),
    );
    expect(livingCost(data).periods.map((p) => p.spending)).toEqual([1500, 1500]);
  });
});
