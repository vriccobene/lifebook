import { describe, expect, it } from "vitest";
import { contributionRole, resolveAccountParams } from "./params";
import { DEFAULT_SETTINGS, resolveSettings, toRealRate } from "./settings";
import { account } from "./testkit";

describe("account parameters over time", () => {
  it("uses the value in force at each date, not the current one", () => {
    const acc = account("dep", "deposit", { params: { taxRate: 0.26, interestRate: 0.02 } });
    acc.params.push({ validFrom: "2026-03-01", taxRate: 0.125 });
    expect(resolveAccountParams(acc, "2026-02-28").taxRate).toBe(0.26);
    expect(resolveAccountParams(acc, "2026-03-01").taxRate).toBe(0.125);
    expect(resolveAccountParams(acc, "2027-01-01").taxRate).toBe(0.125);
  });

  it("keeps fields that a later patch does not mention", () => {
    const acc = account("dep", "deposit", { params: { taxRate: 0.26, interestRate: 0.02 } });
    acc.params.push({ validFrom: "2026-03-01", interestRate: 0.03 });
    const later = resolveAccountParams(acc, "2026-04-01");
    expect(later.interestRate).toBe(0.03);
    expect(later.taxRate).toBe(0.26);
  });

  it("lets a retroactive entry override only from its own date", () => {
    const acc = account("bro", "brokerage", { params: { taxRate: 0.26 } });
    acc.params.push({ validFrom: "2026-06-01", taxRate: 0.2 });
    acc.params.push({ validFrom: "2026-01-01", isSpendingAccount: true }); // inserted afterwards, dated earlier
    expect(resolveAccountParams(acc, "2026-02-01").isSpendingAccount).toBe(true);
    expect(resolveAccountParams(acc, "2026-07-01").taxRate).toBe(0.2);
    expect(resolveAccountParams(acc, "2026-07-01").isSpendingAccount).toBe(true);
  });

  it("falls back to type-based defaults", () => {
    expect(resolveAccountParams(account("l", "liability"), "2026-01-01").inInvestableCapital).toBe(
      false,
    );
    expect(resolveAccountParams(account("b", "brokerage"), "2026-01-01").inInvestableCapital).toBe(
      true,
    );
    const income = account("r", "real_estate", { realEstateUse: "income" });
    expect(resolveAccountParams(income, "2026-01-01").inInvestableCapital).toBe(true);
    const home = account("h", "real_estate", { realEstateUse: "primary_residence" });
    expect(resolveAccountParams(home, "2026-01-01").inInvestableCapital).toBe(false);
  });

  it("never counts the primary residence as investable, even if flagged", () => {
    const home = account("h", "real_estate", {
      realEstateUse: "primary_residence",
      params: { inInvestableCapital: true },
    });
    expect(resolveAccountParams(home, "2026-01-01").inInvestableCapital).toBe(false);
  });
});

describe("settings over time", () => {
  it("has the defaults of the spec", () => {
    const s = resolveSettings([], "2026-01-01");
    expect(s.inflationRate).toBe(0.02);
    expect(s.safeWithdrawalRate).toBe(0.035);
    expect(s.emergencyBufferMonths).toBe(6);
    expect(s.publicPension.enabled).toBe(false);
    expect(s.publicPension).toEqual({ enabled: false, startAge: 67, netMonthlyAmount: 0 });
    expect(s.endOfPlanAge).toBe(90);
    expect(s.trafficLight).toEqual({ greenAt: 1, yellowAt: 0.8 });
    expect(s.verdict.minGreenMethods).toBe(3);
    expect(s.livingCostWindow).toBe(12);
  });

  it("merges nested patches without losing sibling fields", () => {
    const s = resolveSettings(
      [
        { validFrom: "2026-01-01", publicPension: { netMonthlyAmount: 900 } },
        { validFrom: "2026-06-01", publicPension: { enabled: true } },
      ],
      "2026-07-01",
    );
    expect(s.publicPension).toEqual({ enabled: true, startAge: 67, netMonthlyAmount: 900 });
  });

  it("resolves the value valid at the requested date", () => {
    const entries = [
      { validFrom: "2026-01-01", safeWithdrawalRate: 0.04 },
      { validFrom: "2026-06-01", safeWithdrawalRate: 0.03 },
    ];
    expect(resolveSettings(entries, "2025-12-31").safeWithdrawalRate).toBe(
      DEFAULT_SETTINGS.safeWithdrawalRate,
    );
    expect(resolveSettings(entries, "2026-05-31").safeWithdrawalRate).toBe(0.04);
    expect(resolveSettings(entries, "2026-06-01").safeWithdrawalRate).toBe(0.03);
  });

  it("does not mutate the defaults", () => {
    resolveSettings([{ validFrom: "2026-01-01", publicPension: { enabled: true } }], "2026-02-01");
    expect(DEFAULT_SETTINGS.publicPension.enabled).toBe(false);
  });

  it("converts nominal rates to real ones", () => {
    expect(toRealRate(0.05, 0.02)).toBeCloseTo(0.029411764, 8);
    expect(toRealRate(0.02, 0.02)).toBeCloseTo(0, 12);
  });
});

describe("pension fund accounts", () => {
  it("is out of the investable capital by default, and the user can include it", () => {
    const fund = account("fund", "pension_fund");
    expect(resolveAccountParams(fund, "2026-01-01").inInvestableCapital).toBe(false);
    fund.params.push({ validFrom: "2026-06-01", inInvestableCapital: true });
    expect(resolveAccountParams(fund, "2026-05-31").inInvestableCapital).toBe(false);
    expect(resolveAccountParams(fund, "2026-06-01").inInvestableCapital).toBe(true);
  });
});

describe("contribution role", () => {
  it("tells which accounts get declared contributions for a transfer", () => {
    const date = "2026-01-31";
    expect(contributionRole(account("b", "brokerage"), date)).toBe("declared");
    expect(contributionRole(account("p", "pension_fund"), date)).toBe("declared");
    expect(contributionRole(account("l", "liability"), date)).toBe("declared");
    expect(
      contributionRole(account("l2", "liability", { contributionsMode: "inferred" }), date),
    ).toBe("declared");
    expect(contributionRole(account("d", "deposit"), date)).toBe("inferred");
    expect(contributionRole(account("h", "real_estate"), date)).toBe("none");
    expect(
      contributionRole(account("c", "checking", { params: { isSpendingAccount: true } }), date),
    ).toBe("spending");
  });

  it("follows the spending flag in force at the date", () => {
    const acc = account("c", "checking", {
      params: { validFrom: "2026-06-01", isSpendingAccount: true },
    });
    expect(contributionRole(acc, "2026-05-31")).toBe("declared");
    expect(contributionRole(acc, "2026-06-30")).toBe("spending");
  });
});
