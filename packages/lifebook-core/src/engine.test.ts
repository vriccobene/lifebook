import { describe, expect, it } from "vitest";
import {
  computeAsOf,
  computeLivingCostAsOf,
  computeReturnsAsOf,
  computeSeries,
  seriesDates,
} from "./engine";
import { defaultRegistry } from "./methods/registry";
import { MONTH_ENDS_2026, contribution, richScenario, snap, withPension } from "./testkit";
import type { MethodResult } from "./methods/types";

const method = (id: string, data = richScenario(), asOf = "2026-12-31"): MethodResult =>
  computeAsOf(data, asOf).methods.find((m) => m.id === id)!;

describe("as-of calculation", () => {
  it("is not affected by data dated after the as-of date (regression)", () => {
    const base = richScenario();
    const extended = richScenario();
    extended.snapshots.push(snap("chk", "2027-01-31", 1), snap("bro", "2027-01-31", 1));
    extended.contributions.push(contribution("bro", "2027-01-15", 99_999));
    extended.settings.push({ validFrom: "2027-01-01", safeWithdrawalRate: 0.01 });
    extended.essentialSpending.push({ mode: "amount", value: 9_999, validFrom: "2027-01-01" });
    for (const asOf of ["2026-06-30", "2026-12-31"]) {
      expect(computeAsOf(extended, asOf)).toEqual(computeAsOf(base, asOf));
    }
  });

  it("gives the same result as the history at that date: the last point of a shorter data set", () => {
    const full = richScenario();
    const truncated = { ...full, snapshots: full.snapshots.filter((s) => s.date <= "2026-06-30") };
    expect(computeAsOf(full, "2026-06-30")).toEqual(computeAsOf(truncated, "2026-06-30"));
  });

  it("recomputes history after a retroactive entry", () => {
    const data = richScenario();
    const before = computeAsOf(data, "2026-12-31").livingCost;
    // A backdated withdrawal of 1000 from the brokerage that the spending account never received:
    // the money went out of the tracked accounts, so March's spending is 1000 higher.
    data.contributions.push(contribution("bro", "2026-03-10", -1_000));
    const after = computeAsOf(data, "2026-12-31").livingCost;
    const march = (r: typeof before) => r.periods.find((p) => p.to === "2026-03-31")!.spending;
    expect(march(before)).toBeCloseTo(2_000, 6);
    expect(march(after)).toBeCloseTo(3_000, 6);
    expect(after.referenceMonthly!).toBeGreaterThan(before.referenceMonthly!);
    // as of February the entry does not exist yet
    expect(computeAsOf(data, "2026-02-28")).toEqual(computeAsOf(richScenario(), "2026-02-28"));
  });

  it("uses the settings in force at each date", () => {
    const data = richScenario();
    data.settings.push({ validFrom: "2026-09-01", safeWithdrawalRate: 0.02 });
    const early = method("swr", data, "2026-08-31");
    const late = method("swr", data, "2026-12-31");
    expect(
      (early.details.annualWithdrawal! as number) / (early.details.capital as number),
    ).toBeCloseTo(0.035, 9);
    expect(
      (late.details.annualWithdrawal as number) / (late.details.capital as number),
    ).toBeCloseTo(0.02, 9);
  });

  it("uses the account parameters in force at each date", () => {
    const data = richScenario();
    data.accounts
      .find((a) => a.id === "bro")!
      .params.push({ validFrom: "2026-07-01", inInvestableCapital: false });
    const june = computeAsOf(data, "2026-06-30").capital.investableGross;
    const july = computeAsOf(data, "2026-07-31").capital.investableGross;
    expect(june - july).toBeGreaterThan(400_000);
  });
});

describe("full scenario", () => {
  it("deduces the living cost from the balances", () => {
    const result = computeAsOf(richScenario(), "2026-12-31");
    expect(result.livingCost.periods).toHaveLength(12);
    for (const period of result.livingCost.periods) expect(period.spending).toBeCloseTo(2_000, 6);
    expect(result.livingCost.referenceMonthly).toBeCloseTo((24_000 / 365) * (365.25 / 12), 6);
    expect(result.livingCost.incomeMonthly).toBeCloseTo((36_000 / 365) * (365.25 / 12), 6);
  });

  it("evaluates all methods and the verdict", () => {
    const result = computeAsOf(richScenario(), "2026-12-31");
    expect(result.methods.map((m) => m.id)).toEqual(defaultRegistry.list().map((m) => m.id));
    // ~790k investable vs a 685k Fi-Number
    expect(result.methods.find((m) => m.id === "swr")!.status).toBe("green");
    expect(result.verdict.status).toBe("green");
    expect(result.verdict.excluded).toEqual(
      expect.arrayContaining(["layers", "coast_fire", "bridge"]),
    );
  });

  it("resolves essential spending as a percentage of the living cost", () => {
    const data = richScenario();
    data.essentialSpending.push({ mode: "percent", value: 60, validFrom: "2026-01-01" });
    const result = computeAsOf(data, "2026-12-31");
    const layers = result.methods.find((m) => m.id === "layers")!;
    expect(layers.status).not.toBe("missing_data");
    expect(layers.details.essentialAnnual).toBeCloseTo(
      result.livingCost.referenceMonthly! * 0.6 * 12,
      6,
    );
  });

  it("uses the most recent month with data for the single-value methods", () => {
    const data = richScenario();
    data.essentialSpending.push({ mode: "month_amount", value: 500, month: "2026-11" });
    // the last period ends in December: a November-only value is not the current one
    expect(method("layers", data).status).toBe("missing_data");
    data.essentialSpending.push({ mode: "month_amount", value: 500, month: "2026-12" });
    expect(method("layers", data).status).not.toBe("missing_data");
  });

  it("splits essential and discretionary spending per period and warns when essential exceeds the cost", () => {
    const data = richScenario();
    data.essentialSpending.push(
      { mode: "amount", value: 1_500, validFrom: "2026-01-01" },
      { mode: "month_amount", value: 4_000, month: "2026-06" },
    );
    const result = computeAsOf(data, "2026-12-31");
    const june = result.essentialSplit.find((s) => s.month === "2026-06")!;
    expect(june.exceedsLivingCost).toBe(true);
    expect(june.discretionary).toBe(0);
    const may = result.essentialSplit.find((s) => s.month === "2026-05")!;
    expect(may.essential).toBe(1_500);
    expect(may.discretionary).toBeCloseTo(may.livingCost - 1_500, 9);
    expect(result.warnings.map((w) => w.code)).not.toContain("essential_exceeds_living_cost");
  });

  it("warns about the current month when the essential spending exceeds the cost", () => {
    const data = richScenario();
    data.essentialSpending.push({ mode: "amount", value: 5_000, validFrom: "2026-01-01" });
    expect(computeAsOf(data, "2026-12-31").warnings.map((w) => w.code)).toContain(
      "essential_exceeds_living_cost",
    );
  });

  it("keeps a stale account at its last balance and warns", () => {
    const data = richScenario();
    data.snapshots = data.snapshots.filter(
      (s) => !(s.accountId === "bro" && s.date > "2026-09-30"),
    );
    const result = computeAsOf(data, "2026-12-31");
    expect(result.warnings.find((w) => w.code === "stale_account")?.accountId).toBe("bro");
    const bro = result.capital.balances.find((b) => b.account.id === "bro")!;
    expect(bro.balance).toBe(data.snapshots.filter((s) => s.accountId === "bro").at(-1)!.balance);
  });
});

describe("public pension toggle across the whole engine", () => {
  const scenario = (enabled: boolean) => {
    const data = richScenario();
    data.settings.push({ validFrom: "2000-01-01", currentAge: 50, targetRetirementAge: 55 });
    data.essentialSpending.push({ mode: "amount", value: 1_500, validFrom: "2026-01-01" });
    // make the outcome sensitive: less capital, so the pension changes the traffic lights
    data.snapshots = data.snapshots.map((s) =>
      s.accountId === "bro" ? { ...s, balance: s.balance * 0.4 } : s,
    );
    return withPension(data, { enabled, startAge: 67, netMonthlyAmount: 1_500 });
  };

  it("changes strati, ponte and hybrid, and nothing else", () => {
    const off = computeAsOf(scenario(false), "2026-12-31");
    const on = computeAsOf(scenario(true), "2026-12-31");
    const changed = off.methods
      .filter((m, i) => JSON.stringify(m) !== JSON.stringify(on.methods[i]))
      .map((m) => m.id);
    expect(changed.sort()).toEqual(["bridge", "hybrid", "layers"]);
    expect(off.publicPensionEnabled).toBe(false);
    expect(on.publicPensionEnabled).toBe(true);
  });

  it("improves the pension-aware methods when enabled", () => {
    const off = computeAsOf(scenario(false), "2026-12-31");
    const on = computeAsOf(scenario(true), "2026-12-31");
    for (const id of ["layers", "bridge", "hybrid"]) {
      const a = off.methods.find((m) => m.id === id)!;
      const b = on.methods.find((m) => m.id === id)!;
      expect(b.coverage!).toBeGreaterThan(a.coverage!);
    }
  });

  it("is off by default", () => {
    const data = richScenario();
    expect(computeAsOf(data, "2026-12-31").publicPensionEnabled).toBe(false);
  });

  it("can be switched on from a date, leaving earlier history without pension", () => {
    const data = scenario(false);
    data.settings.push({ validFrom: "2026-09-01", publicPension: { enabled: true } });
    expect(computeAsOf(data, "2026-08-31").publicPensionEnabled).toBe(false);
    expect(computeAsOf(data, "2026-09-30").publicPensionEnabled).toBe(true);
  });
});

describe("series", () => {
  it("lists month ends inside the range", () => {
    const dates = seriesDates(richScenario(), {
      from: "2026-03-15",
      to: "2026-06-30",
      step: "month",
    });
    expect(dates).toEqual(["2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30"]);
  });

  it("lists reading dates for the round step", () => {
    const dates = seriesDates(richScenario(), {
      from: "2026-01-01",
      to: "2026-03-31",
      step: "round",
    });
    expect(dates).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("returns nothing for an inverted range", () => {
    expect(
      computeSeries(
        richScenario(),
        { from: "2026-12-31", to: "2026-01-01", step: "month" },
        computeAsOf,
      ),
    ).toEqual([]);
  });

  it("gives each point the result of an independent as-of calculation", () => {
    const data = richScenario();
    const series = computeSeries(
      data,
      { from: "2026-01-01", to: "2026-12-31", step: "month" },
      computeAsOf,
    );
    expect(series.map((p) => p.date)).toEqual(MONTH_ENDS_2026);
    for (const point of series) expect(point.value).toEqual(computeAsOf(data, point.date));
  });

  it("shows the evolution of the coverage and the verdict as parameters change", () => {
    const data = richScenario();
    data.settings.push({ validFrom: "2026-07-01", safeWithdrawalRate: 0.01 });
    const series = computeSeries(
      data,
      { from: "2026-06-01", to: "2026-08-31", step: "month" },
      computeAsOf,
    );
    const swr = series.map((p) => p.value.methods.find((m) => m.id === "swr")!.coverage!);
    expect(swr[0]).toBeGreaterThan(1);
    expect(swr[1]!).toBeLessThan(0.5);
    expect(series.map((p) => p.value.verdict.status)[1]).not.toBe("green");
  });

  it("supports the returns and living cost series", () => {
    const data = richScenario();
    const returns = computeSeries(
      data,
      { from: "2026-01-01", to: "2026-12-31", step: "month" },
      computeReturnsAsOf,
    );
    expect(returns.at(-1)!.value.totals.length).toBeGreaterThan(returns[0]!.value.totals.length);
    const living = computeSeries(
      data,
      { from: "2026-01-01", to: "2026-12-31", step: "month" },
      computeLivingCostAsOf,
    );
    expect(living.map((p) => p.value.periods.length)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });
});
