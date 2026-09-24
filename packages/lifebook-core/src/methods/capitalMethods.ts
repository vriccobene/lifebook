import {
  basics,
  basicsMissing,
  grade,
  missingData,
  result,
  shortfall,
  yearsToTarget,
} from "./helpers";
import type { Method } from "./types";

/** Safe withdrawal rate: capital × swr must cover the yearly cost. */
export const swrMethod: Method = {
  id: "swr",
  family: "A",
  countsForVerdict: true,
  evaluate(ctx) {
    const b = basics(ctx);
    if (!b) return missingData(this, basicsMissing(ctx));
    const swr = ctx.settings.safeWithdrawalRate;
    const coverage = (b.capital * swr) / b.annualCost;
    const target = b.annualCost / swr;
    return result(this, {
      status: grade(coverage, ctx.settings),
      coverage,
      distance: { eur: shortfall(target, b.capital), kind: "capital", years: null },
      details: { capital: b.capital, annualWithdrawal: b.capital * swr, annualCost: b.annualCost },
    });
  },
};

/** Fi-Number: the capital goal is `annual cost / swr`; also estimates the years to reach it. */
export const fiNumberMethod: Method = {
  id: "fi_number",
  family: "A",
  countsForVerdict: true,
  evaluate(ctx) {
    const b = basics(ctx);
    if (!b) return missingData(this, basicsMissing(ctx));
    const target = b.annualCost / ctx.settings.safeWithdrawalRate;
    const monthlySavings = (ctx.livingCost.incomeMonthly ?? b.monthlyCost) - b.monthlyCost;
    const years = yearsToTarget(b.capital, target, monthlySavings, ctx.capital.portfolioReturn);
    return result(this, {
      status: grade(b.capital / target, ctx.settings),
      coverage: b.capital / target,
      distance: { eur: shortfall(target, b.capital), kind: "capital", years },
      details: {
        targetCapital: target,
        monthlySavings,
        portfolioReturn: ctx.capital.portfolioReturn,
      },
    });
  },
};
