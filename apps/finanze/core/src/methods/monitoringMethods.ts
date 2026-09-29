import { basics, basicsMissing, missingData, result } from "./helpers";
import type { Method } from "./types";

/** Savings rate: (net income − living cost) / net income. */
export const savingsRateMethod: Method = {
  id: "savings_rate",
  family: "E",
  countsForVerdict: false,
  evaluate(ctx) {
    const cost = ctx.livingCost.referenceMonthly;
    const income = ctx.livingCost.incomeMonthly;
    const missing = basicsMissing(ctx);
    if (income === null || income <= 0) missing.push("income");
    if (cost === null || income === null || income <= 0) return missingData(this, missing);
    return result(this, {
      metric: { value: (income - cost) / income, unit: "ratio" },
      details: { incomeMonthly: income, livingCostMonthly: cost },
    });
  },
};

/** Years of autonomy: investable capital / yearly cost. */
export const yearsOfAutonomyMethod: Method = {
  id: "years_of_autonomy",
  family: "E",
  countsForVerdict: false,
  evaluate(ctx) {
    const b = basics(ctx);
    if (!b) return missingData(this, basicsMissing(ctx));
    return result(this, { metric: { value: b.capital / b.annualCost, unit: "years" } });
  },
};

/** Runway without returns: liquidity / monthly cost, in months. */
export const runwayMethod: Method = {
  id: "runway",
  family: "E",
  countsForVerdict: false,
  evaluate(ctx) {
    const cost = ctx.livingCost.referenceMonthly;
    if (cost === null || cost <= 0) return missingData(this, basicsMissing(ctx));
    return result(this, {
      metric: { value: ctx.capital.liquidity / cost, unit: "months" },
      details: { liquidity: ctx.capital.liquidity },
    });
  },
};
