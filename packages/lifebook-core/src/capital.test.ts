import { describe, expect, it } from "vitest";
import { computeCapital } from "./capital";
import { prepareDataset } from "./dataset";
import { computeLivingCost } from "./livingCost";
import { account, emptyData, richScenario, snap, spendingAccount } from "./testkit";
import type { LifebookData } from "./dataset";

function capital(data: LifebookData, asOf = "2026-12-31") {
  const ds = prepareDataset(data, asOf);
  return computeCapital(ds, computeLivingCost(ds));
}

describe("net worth", () => {
  it("is assets minus liabilities: a 200k home with a 100k mortgage is worth 100k", () => {
    const data = emptyData();
    data.accounts.push(
      account("home", "real_estate", { realEstateUse: "primary_residence" }),
      account("mortgage", "liability"),
    );
    data.snapshots.push(
      snap("home", "2026-01-31", 200_000),
      snap("mortgage", "2026-01-31", -100_000),
    );
    expect(capital(data).netWorth).toBe(100_000);
  });

  it("subtracts every liability regardless of the property (no linking)", () => {
    const data = emptyData();
    data.accounts.push(
      account("bro", "brokerage"),
      account("mortgage", "liability"),
      account("loan", "liability"),
    );
    data.snapshots.push(
      snap("bro", "2026-01-31", 50_000),
      snap("mortgage", "2026-01-31", -100_000),
      snap("loan", "2026-01-31", -10_000),
    );
    expect(capital(data).netWorth).toBe(-60_000);
  });

  it("carries the last known balance of a stale account", () => {
    const data = emptyData();
    data.accounts.push(account("a", "brokerage"), account("b", "brokerage"));
    data.snapshots.push(
      snap("a", "2026-01-31", 1_000),
      snap("a", "2026-02-28", 1_100),
      snap("b", "2026-01-31", 5_000),
    );
    expect(capital(data, "2026-02-28").netWorth).toBe(6_100);
  });

  it("ignores archived accounts from the archive date on", () => {
    const data = emptyData();
    data.accounts.push(
      account("a", "brokerage", { archivedAt: "2026-02-01" }),
      account("b", "brokerage"),
    );
    data.snapshots.push(snap("a", "2026-01-31", 1_000), snap("b", "2026-01-31", 500));
    expect(capital(data, "2026-01-31").netWorth).toBe(1_500);
    expect(capital(data, "2026-02-28").netWorth).toBe(500);
  });

  it("groups the net worth by account type", () => {
    const byType = capital(richScenario()).netWorthByType;
    expect(byType.real_estate).toBe(250_000);
    expect(byType.liability).toBe(0);
    expect(byType.checking).toBeGreaterThan(0);
  });
});

describe("investable capital", () => {
  it("excludes the primary residence and subtracts the emergency buffer", () => {
    const result = capital(richScenario());
    const gross = result.balances
      .filter((b) => b.account.id !== "home")
      .reduce((total, b) => total + b.balance, 0);
    expect(result.investableGross).toBeCloseTo(gross, 6);
    expect(result.emergencyBuffer).toBeGreaterThan(11_900); // 6 × ~2001
    expect(result.investable).toBeCloseTo(gross - result.emergencyBuffer!, 6);
  });

  it("includes an income property", () => {
    const data = emptyData();
    data.accounts.push(
      spendingAccount(),
      account("flat", "real_estate", { realEstateUse: "income" }),
    );
    data.snapshots.push(snap("chk", "2026-01-31", 100), snap("flat", "2026-01-31", 150_000));
    expect(capital(data, "2026-01-31").investableGross).toBe(150_100);
  });

  it("subtracts a liability only when its own toggle is on", () => {
    const build = (flag: boolean): LifebookData => {
      const data = emptyData();
      data.accounts.push(
        account("flat", "real_estate", { realEstateUse: "income" }),
        account("mortgage", "liability", { params: { inInvestableCapital: flag } }),
      );
      data.snapshots.push(
        snap("flat", "2026-01-31", 200_000),
        snap("mortgage", "2026-01-31", -100_000),
      );
      return data;
    };
    expect(capital(build(false)).investableGross).toBe(200_000);
    expect(capital(build(true)).investableGross).toBe(100_000);
  });

  it("uses the toggle in force at the as-of date", () => {
    const data = emptyData();
    data.accounts.push(account("bro", "brokerage", { params: { inInvestableCapital: true } }));
    data.accounts[0]!.params.push({ validFrom: "2026-03-01", inInvestableCapital: false });
    data.snapshots.push(snap("bro", "2026-02-28", 1_000), snap("bro", "2026-03-31", 1_000));
    expect(capital(data, "2026-02-28").investableGross).toBe(1_000);
    expect(capital(data, "2026-03-31").investableGross).toBe(0);
  });

  it("never goes below zero when the buffer exceeds the capital", () => {
    const data = richScenario();
    // the spending account is left out of the investable capital with its own toggle
    data.accounts[0]!.params.push({ validFrom: "2000-01-01", inInvestableCapital: false });
    data.snapshots = data.snapshots.map((s) =>
      s.accountId === "bro" || s.accountId === "dep" ? { ...s, balance: 1_000 } : s,
    );
    const result = capital(data);
    expect(result.investable).toBe(0);
    expect(result.riskyCapital).toBe(0);
  });

  it("is unknown when the living cost is unknown", () => {
    const data = emptyData();
    data.accounts.push(account("bro", "brokerage"));
    data.snapshots.push(snap("bro", "2026-01-31", 1_000));
    const result = capital(data);
    expect(result.investable).toBeNull();
    expect(result.investableGross).toBe(1_000);
  });
});

describe("flows and expected return", () => {
  it("computes net passive income from deposit interest and dividends", () => {
    const result = capital(richScenario());
    const dep = result.balances.find((b) => b.account.id === "dep")!.balance;
    const bro = result.balances.find((b) => b.account.id === "bro")!.balance;
    expect(result.passiveNetAnnual).toBeCloseTo(dep * 0.03 * 0.74 + bro * 0.02 * 0.74, 6);
    // only deposit interest is a "safe" flow; brokerage dividends are not
    expect(result.safeFlowsNetAnnual).toBeCloseTo(dep * 0.03 * 0.74, 6);
  });

  it("weights the expected return by balance", () => {
    const result = capital(richScenario());
    const balance = (id: string) => result.balances.find((b) => b.account.id === id)!.balance;
    // the spending account is investable by default and has no expected return (0)
    const total = balance("bro") + balance("dep") + balance("chk");
    expect(result.portfolioReturn).toBeCloseTo(
      (balance("bro") * 0.04 + balance("dep") * 0.01) / total,
      9,
    );
  });

  it("takes the buffer from liquidity before touching risky capital", () => {
    const result = capital(richScenario());
    // liquid investable (~230k) is far above the ~12k buffer: risky is untouched
    const bro = result.balances.find((b) => b.account.id === "bro")!.balance;
    expect(result.riskyCapital).toBeCloseTo(bro, 6);
  });
});

describe("pension fund", () => {
  const withFund = (flag?: boolean): LifebookData => {
    const data = richScenario();
    data.accounts.push(
      account("fund", "pension_fund", {
        params: {
          expectedReturn: 0.03,
          ...(flag === undefined ? {} : { inInvestableCapital: flag }),
        },
      }),
    );
    for (const s of richScenario().snapshots.filter((x) => x.accountId === "home")) {
      data.snapshots.push(snap("fund", s.date, 40_000));
    }
    return data;
  };

  it("counts in the net worth and in its own bucket of the composition", () => {
    const base = capital(richScenario());
    const result = capital(withFund());
    expect(result.netWorth).toBe(base.netWorth + 40_000);
    expect(result.netWorthByType.pension_fund).toBe(40_000);
  });

  it("does not count as investable capital by default (regression)", () => {
    expect(capital(withFund()).investableGross).toBe(capital(richScenario()).investableGross);
  });

  it("counts as investable, and as risky capital, once the user includes it", () => {
    const base = capital(richScenario());
    const result = capital(withFund(true));
    expect(result.investableGross).toBe(base.investableGross + 40_000);
    expect(result.riskyCapital).toBeCloseTo(base.riskyCapital! + 40_000, 6);
  });
});
