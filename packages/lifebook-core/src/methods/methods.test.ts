import { describe, expect, it } from "vitest";
import { methodContext } from "../testkit";
import { annuityDue, yearsToTarget } from "./helpers";
import { fiNumberMethod, swrMethod } from "./capitalMethods";
import { hybridMethod, layersMethod, passiveIncomeMethod } from "./flowMethods";
import { runwayMethod, savingsRateMethod, yearsOfAutonomyMethod } from "./monitoringMethods";
import { baristaMethod, bridgeMethod, coastMethod, fireTiersMethod } from "./scenarioMethods";

// Cost 2000 €/month = 24000 €/year, swr 3.5%: Fi-Number = 685 714.29 €.
const FI = 24_000 / 0.035;
const cap = (investable: number, more: object = {}) => ({
  capital: { investable, riskyCapital: investable, ...more },
});

describe("SWR", () => {
  it("is green at or above 100% coverage and reports the distance", () => {
    const green = swrMethod.evaluate(methodContext(cap(700_000)));
    expect(green.status).toBe("green");
    expect(green.coverage).toBeCloseTo((700_000 * 0.035) / 24_000, 12);
    expect(green.distance).toEqual({ eur: 0, kind: "capital", years: null });
  });

  it("is green exactly at the Fi-Number (regression: floating point at the threshold)", () => {
    expect(swrMethod.evaluate(methodContext(cap(FI))).status).toBe("green");
  });

  it("is yellow from 80% and red below", () => {
    const yellow = swrMethod.evaluate(methodContext(cap(600_000)));
    expect(yellow.status).toBe("yellow");
    expect(yellow.distance.eur).toBeCloseTo(FI - 600_000, 6);
    expect(swrMethod.evaluate(methodContext(cap(500_000))).status).toBe("red");
    expect(swrMethod.evaluate(methodContext(cap(FI * 0.8))).status).toBe("yellow");
  });

  it("follows the configured thresholds and swr", () => {
    const ctx = methodContext({ ...cap(600_000), settings: { trafficLight: { greenAt: 0.85 } } });
    expect(swrMethod.evaluate(ctx).status).toBe("green");
    const strict = methodContext({ ...cap(700_000), settings: { safeWithdrawalRate: 0.03 } });
    expect(swrMethod.evaluate(strict).status).toBe("yellow"); // 700k × 3% = 21k < 24k
  });

  it("is missing data without a living cost, and not for a zero cost", () => {
    const unknown = swrMethod.evaluate(methodContext({ ...cap(700_000), monthlyCost: null }));
    expect(unknown.status).toBe("missing_data");
    expect(unknown.missing).toEqual(["living_cost"]);
    const zero = swrMethod.evaluate(methodContext({ ...cap(700_000), monthlyCost: 0 }));
    expect(zero.missing).toEqual(["living_cost_not_positive"]);
  });
});

describe("Fi-Number", () => {
  it("is already reached with enough capital", () => {
    const result = fiNumberMethod.evaluate(methodContext(cap(FI + 1)));
    expect(result.status).toBe("green");
    expect(result.distance.years).toBe(0);
  });

  it("estimates the years from savings and the real return, matching a month-by-month simulation", () => {
    const ctx = methodContext({ ...cap(400_000, { portfolioReturn: 0.04 }), incomeMonthly: 3_000 });
    const result = fiNumberMethod.evaluate(ctx);
    const i = Math.pow(1.04, 1 / 12) - 1;
    let balance = 400_000;
    let months = 0;
    while (balance < FI) {
      balance = balance * (1 + i) + 1_000;
      months++;
    }
    expect(result.distance.years! * 12).toBeGreaterThan(months - 1);
    expect(result.distance.years! * 12).toBeLessThanOrEqual(months);
  });

  it("reaches the goal on returns alone when savings are zero", () => {
    expect(yearsToTarget(500_000, FI, 0, 0.04)).toBeGreaterThan(0);
  });

  it("is never reached with no savings and no return", () => {
    expect(yearsToTarget(500_000, FI, 0, 0)).toBeNull();
    expect(yearsToTarget(500_000, FI, -500, 0.0)).toBeNull();
  });

  it("is never reached when withdrawals exceed the growth", () => {
    expect(yearsToTarget(100_000, FI, -1_000, 0.02)).toBeNull();
  });

  it("uses linear savings at a 0% return", () => {
    expect(yearsToTarget(600_000, 660_000, 1_000, 0)).toBeCloseTo(5, 12);
  });
});

describe("passive income only", () => {
  it("compares net passive income with the yearly cost", () => {
    const result = passiveIncomeMethod.evaluate(
      methodContext(cap(500_000, { passiveNetAnnual: 12_000 })),
    );
    expect(result.status).toBe("red");
    expect(result.coverage).toBe(0.5);
    expect(result.distance).toEqual({ eur: 12_000, kind: "annual_flow", years: null });
    expect(
      passiveIncomeMethod.evaluate(methodContext(cap(0, { passiveNetAnnual: 24_000 }))).status,
    ).toBe("green");
  });

  it("ignores the public pension whatever the toggle says", () => {
    const on = methodContext({
      ...cap(0, { passiveNetAnnual: 12_000 }),
      settings: { publicPension: { enabled: true, netMonthlyAmount: 1_000 } },
    });
    expect(passiveIncomeMethod.evaluate(on).coverage).toBe(0.5);
  });
});

describe("hybrid", () => {
  const base = { ...cap(400_000, { passiveNetAnnual: 6_000 }) };

  it("needs a withdrawal within the swr", () => {
    const result = hybridMethod.evaluate(methodContext(base));
    // needs 18 000 / 400 000 = 4.5% > 3.5%
    expect(result.status).toBe("red");
    expect(result.coverage).toBeCloseTo((400_000 * 0.035) / 18_000, 12);
    expect(result.distance.eur).toBeCloseTo(18_000 / 0.035 - 400_000, 6);
  });

  it("is green when the passive income covers everything (coverage capped by definition at 100%)", () => {
    const result = hybridMethod.evaluate(methodContext(cap(10_000, { passiveNetAnnual: 30_000 })));
    expect(result.status).toBe("green");
    expect(result.coverage).toBe(1);
  });

  it("counts the pension only when the global toggle is on", () => {
    const pension = { netMonthlyAmount: 1_000, startAge: 67 };
    const off = hybridMethod.evaluate(
      methodContext({ ...base, settings: { publicPension: { enabled: false, ...pension } } }),
    );
    const on = hybridMethod.evaluate(
      methodContext({ ...base, settings: { publicPension: { enabled: true, ...pension } } }),
    );
    expect(off.status).toBe("red");
    expect(off.details.pensionAnnual).toBe(0);
    expect(off.coverage).toBeCloseTo((400_000 * 0.035) / 18_000, 12);
    // with the pension the withdrawal is only 24 000 − 6 000 − 12 000 = 6 000
    expect(on.status).toBe("green");
    expect(on.coverage).toBeCloseTo((400_000 * 0.035) / 6_000, 12);
  });

  it("is identical with the toggle off whatever the amount (regression)", () => {
    const zero = hybridMethod.evaluate(
      methodContext({
        ...base,
        settings: { publicPension: { enabled: false, netMonthlyAmount: 0 } },
      }),
    );
    const big = hybridMethod.evaluate(
      methodContext({
        ...base,
        settings: { publicPension: { enabled: false, netMonthlyAmount: 5_000 } },
      }),
    );
    expect(big).toEqual(zero);
  });
});

describe("layered coverage", () => {
  const ctxFor = (extra: object = {}, pension?: { enabled: boolean; netMonthlyAmount?: number }) =>
    methodContext({
      capital: {
        investable: 400_000,
        riskyCapital: 300_000,
        safeFlowsNetAnnual: 10_000,
        passiveNetAnnual: 10_000,
      },
      essentialMonthly: 1_200,
      ...(pension ? { settings: { publicPension: pension } } : {}),
      ...extra,
    });

  it("is missing data, never a default, without essential spending", () => {
    const result = layersMethod.evaluate(ctxFor({ essentialMonthly: null }));
    expect(result.status).toBe("missing_data");
    expect(result.missing).toEqual(["essential_spending"]);
    expect(result.coverage).toBeNull();
  });

  it("requires both layers to be covered", () => {
    const result = layersMethod.evaluate(ctxFor());
    // essential 14 400 vs safe 10 000; discretionary 9 600 vs 300 000 × 3.5% = 10 500
    expect(result.details.essentialCoverage).toBeCloseTo(10_000 / 14_400, 12);
    expect(result.details.discretionaryCoverage).toBeCloseTo(10_500 / 9_600, 12);
    expect(result.coverage).toBeCloseTo(10_000 / 14_400, 12);
    expect(result.status).toBe("red");
  });

  it("is green when both layers are covered", () => {
    const result = layersMethod.evaluate(
      ctxFor({
        capital: { investable: 400_000, riskyCapital: 300_000, safeFlowsNetAnnual: 15_000 },
      }),
    );
    expect(result.status).toBe("green");
  });

  it("adds the pension to the safe flows only when the toggle is on", () => {
    const off = layersMethod.evaluate(ctxFor({}, { enabled: false, netMonthlyAmount: 500 }));
    const on = layersMethod.evaluate(ctxFor({}, { enabled: true, netMonthlyAmount: 500 }));
    expect(off.details.safeFlowsAnnual).toBe(10_000);
    expect(off.status).toBe("red");
    expect(on.details.safeFlowsAnnual).toBe(16_000);
    expect(on.details.essentialCoverage).toBeCloseTo(16_000 / 14_400, 12);
    expect(on.status).toBe("green");
  });

  it("sets the discretionary part to zero when the essential spending exceeds the cost", () => {
    const result = layersMethod.evaluate(ctxFor({ essentialMonthly: 2_500 }));
    expect(result.details.discretionaryAnnual).toBe(0);
    expect(result.details.discretionaryCoverage).toBe(1);
  });
});

describe("Coast FIRE", () => {
  const settings = { currentAge: 40, targetRetirementAge: 60 };

  it("grows today's capital to the target age without contributions", () => {
    const ctx = methodContext({ ...cap(300_000, { portfolioReturn: 0.04 }), settings });
    const result = coastMethod.evaluate(ctx);
    const growth = Math.pow(1.04, 20);
    expect(result.details.capitalAtRetirement).toBeCloseTo(300_000 * growth, 6);
    expect(result.coverage).toBeCloseTo((300_000 * growth) / FI, 12);
    expect(result.status).toBe("yellow");
    expect(result.distance.eur).toBeCloseTo(FI / growth - 300_000, 6);
  });

  it("is missing data without the ages", () => {
    const result = coastMethod.evaluate(methodContext(cap(300_000)));
    expect(result.status).toBe("missing_data");
    expect(result.missing).toEqual(["current_age", "target_retirement_age"]);
  });

  it("does not use the pension: results are identical with the toggle on and off", () => {
    const off = coastMethod.evaluate(
      methodContext({
        ...cap(300_000, { portfolioReturn: 0.04 }),
        settings: { ...settings, publicPension: { enabled: false, netMonthlyAmount: 1_000 } },
      }),
    );
    const on = coastMethod.evaluate(
      methodContext({
        ...cap(300_000, { portfolioReturn: 0.04 }),
        settings: { ...settings, publicPension: { enabled: true, netMonthlyAmount: 1_000 } },
      }),
    );
    expect(on).toEqual(off);
  });

  it("does not grow the capital when the target age is already reached", () => {
    const ctx = methodContext({
      ...cap(300_000, { portfolioReturn: 0.04 }),
      settings: { currentAge: 60, targetRetirementAge: 55 },
    });
    expect(coastMethod.evaluate(ctx).details.yearsToRetirement).toBe(0);
  });
});

describe("Barista FIRE", () => {
  it("computes the residual work income, never below zero", () => {
    const result = baristaMethod.evaluate(methodContext(cap(400_000, { passiveNetAnnual: 6_000 })));
    // covered: 6 000 + 400 000 × 3.5% = 20 000; residual 4 000 a year
    expect(result.distance).toEqual({ eur: 4_000, kind: "annual_flow", years: null });
    expect(result.coverage).toBeCloseTo(20_000 / 24_000, 12);
    expect(result.status).toBe("yellow");
    expect(baristaMethod.evaluate(methodContext(cap(1_000_000))).distance.eur).toBe(0);
  });
});

describe("Lean / Regular / Fat FIRE", () => {
  it("evaluates three variants and takes the regular one as the result", () => {
    const result = fireTiersMethod.evaluate(methodContext(cap(600_000)));
    const [lean, regular, fat] = result.variants;
    expect(lean!.id).toBe("lean");
    expect(lean!.status).toBe("green"); // target 548 571
    expect(regular!.status).toBe("yellow"); // target 685 714
    expect(fat!.status).toBe("red"); // target 891 428
    expect(fat!.coverage).toBeCloseTo(600_000 / ((24_000 * 1.3) / 0.035), 12);
    expect(result.status).toBe("yellow");
    expect(result.coverage).toBe(regular!.coverage);
  });

  it("uses the configured factors", () => {
    const ctx = methodContext({ ...cap(600_000), settings: { leanFactor: 0.5, fatFactor: 1.1 } });
    const [lean, , fat] = fireTiersMethod.evaluate(ctx).variants;
    expect(lean!.coverage).toBeCloseTo(600_000 / ((24_000 * 0.5) / 0.035), 12);
    expect(fat!.coverage).toBeCloseTo(600_000 / ((24_000 * 1.1) / 0.035), 12);
  });
});

describe("bridge to the pension", () => {
  const ages = { currentAge: 50, targetRetirementAge: 55, endOfPlanAge: 90 };
  const bridge = (
    pension: { enabled: boolean; startAge?: number; netMonthlyAmount?: number },
    capital = 700_000,
    rate = 0,
    extra: object = {},
  ) =>
    bridgeMethod.evaluate(
      methodContext({
        ...cap(capital, { portfolioReturn: rate }),
        settings: {
          ...ages,
          ...extra,
          publicPension: { startAge: 67, netMonthlyAmount: 1_000, ...pension },
        },
      }),
    );

  it("with the pension off must cover the whole plan up to the end-of-plan age", () => {
    const result = bridge({ enabled: false });
    // 35 years × 24 000 = 840 000
    expect(result.details.requiredCapitalAtExit).toBe(840_000);
    expect(result.details.bridgeYears).toBe(35);
    expect(result.details.postPensionYears).toBe(0);
    expect(result.coverage).toBeCloseTo(700_000 / 840_000, 12);
    expect(result.status).toBe("yellow"); // 83%
  });

  it("with the pension on covers the bridge, then the cost net of the pension", () => {
    const result = bridge({ enabled: true });
    // 12 years × 24 000 + 23 years × 12 000 = 564 000
    expect(result.details.requiredCapitalAtExit).toBe(564_000);
    expect(result.details.bridgeYears).toBe(12);
    expect(result.details.postPensionYears).toBe(23);
    expect(result.status).toBe("green");
  });

  it("differs between toggle on and off (regression)", () => {
    const off = bridge({ enabled: false });
    const on = bridge({ enabled: true });
    expect(on.coverage).toBeGreaterThan(off.coverage!);
    expect(on.status).not.toBe(off.status);
  });

  it("ignores amount and start age while the toggle is off", () => {
    expect(bridge({ enabled: false, netMonthlyAmount: 9_999, startAge: 60 })).toEqual(
      bridge({ enabled: false }),
    );
  });

  it("treats a pension starting before the exit as covering everything from the exit", () => {
    const result = bridge({ enabled: true, startAge: 50 });
    expect(result.details.bridgeYears).toBe(0);
    expect(result.details.postPensionYears).toBe(35);
    expect(result.details.requiredCapitalAtExit).toBe(35 * 12_000);
  });

  it("behaves like no pension when it starts after the end of the plan", () => {
    const late = bridge({ enabled: true, startAge: 95 });
    expect(late.details.requiredCapitalAtExit).toBe(840_000);
  });

  it("discounts at the real return and grows today's capital to the exit age", () => {
    const rate = 0.03;
    const result = bridge({ enabled: false }, 700_000, rate);
    let expected = 0;
    for (let k = 0; k < 35; k++) expected += 24_000 / Math.pow(1 + rate, k);
    expect(result.details.requiredCapitalAtExit).toBeCloseTo(expected, 6);
    expect(annuityDue(24_000, 35, rate)).toBeCloseTo(expected, 6);
    expect(result.details.projectedCapitalAtExit).toBeCloseTo(700_000 * Math.pow(1.03, 5), 6);
    expect(result.distance.eur).toBeCloseTo(Math.max(0, expected / Math.pow(1.03, 5) - 700_000), 6);
  });

  it("is trivially covered when the plan ends before the exit", () => {
    const result = bridge({ enabled: false }, 1, 0, { endOfPlanAge: 54 });
    expect(result.coverage).toBe(1);
    expect(result.status).toBe("green");
  });

  it("is missing data without the ages", () => {
    const result = bridgeMethod.evaluate(methodContext(cap(700_000)));
    expect(result.status).toBe("missing_data");
  });
});

describe("monitoring metrics", () => {
  it("computes the savings rate from income and cost", () => {
    const result = savingsRateMethod.evaluate(methodContext());
    expect(result.status).toBe("info");
    expect(result.metric).toEqual({ value: 1 / 3, unit: "ratio" });
    expect(savingsRateMethod.evaluate(methodContext({ incomeMonthly: null })).status).toBe(
      "missing_data",
    );
  });

  it("computes the years of autonomy", () => {
    expect(yearsOfAutonomyMethod.evaluate(methodContext(cap(120_000))).metric).toEqual({
      value: 5,
      unit: "years",
    });
  });

  it("computes the runway in months from liquidity", () => {
    const result = runwayMethod.evaluate(methodContext(cap(0, { liquidity: 30_000 })));
    expect(result.metric).toEqual({ value: 15, unit: "months" });
  });

  it("have no traffic light and do not count for the verdict", () => {
    for (const m of [savingsRateMethod, yearsOfAutonomyMethod, runwayMethod]) {
      expect(m.family).toBe("E");
      expect(m.countsForVerdict).toBe(false);
    }
  });
});
