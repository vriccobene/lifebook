import {
  annuityDue,
  basics,
  basicsMissing,
  grade,
  missingData,
  pensionAnnual,
  result,
  shortfall,
  variant,
  yearsToTarget,
} from "./helpers";
import type { Method } from "./types";

/**
 * Coast FIRE: today's capital, with no further contributions, grows at the real expected return
 * until the target retirement age and must reach the Fi-Number of that age.
 */
export const coastMethod: Method = {
  id: "coast_fire",
  family: "D",
  countsForVerdict: true,
  evaluate(ctx) {
    const b = basics(ctx);
    const { currentAge, targetRetirementAge } = ctx.settings;
    const missing = basicsMissing(ctx);
    if (currentAge === null) missing.push("current_age");
    if (targetRetirementAge === null) missing.push("target_retirement_age");
    if (!b || currentAge === null || targetRetirementAge === null)
      return missingData(this, missing);

    const years = Math.max(0, targetRetirementAge - currentAge);
    const growth = Math.pow(1 + ctx.capital.portfolioReturn, years);
    const target = b.annualCost / ctx.settings.safeWithdrawalRate;
    const coverage = (b.capital * growth) / target;
    const coastNumber = target / growth;
    return result(this, {
      status: grade(coverage, ctx.settings),
      coverage,
      distance: {
        eur: shortfall(coastNumber, b.capital),
        kind: "capital",
        years: yearsToTarget(b.capital, coastNumber, 0, ctx.capital.portfolioReturn),
      },
      details: { yearsToRetirement: years, capitalAtRetirement: b.capital * growth, coastNumber },
    });
  },
};

/** Barista FIRE: work income still needed once passive income and swr withdrawals are counted. */
export const baristaMethod: Method = {
  id: "barista_fire",
  family: "D",
  countsForVerdict: true,
  evaluate(ctx) {
    const b = basics(ctx);
    if (!b) return missingData(this, basicsMissing(ctx));
    const covered = ctx.capital.passiveNetAnnual + b.capital * ctx.settings.safeWithdrawalRate;
    const residual = Math.max(0, b.annualCost - covered);
    const coverage = covered / b.annualCost;
    return result(this, {
      status: grade(coverage, ctx.settings),
      coverage,
      distance: { eur: residual, kind: "annual_flow", years: null },
      details: { residualWorkIncomeAnnual: residual, residualWorkIncomeMonthly: residual / 12 },
    });
  },
};

/** Lean / Regular / Fat FIRE: swr and Fi-Number at 0.8×, 1× and 1.3× the cost. The verdict uses Regular. */
export const fireTiersMethod: Method = {
  id: "fire_tiers",
  family: "D",
  countsForVerdict: true,
  evaluate(ctx) {
    const b = basics(ctx);
    if (!b) return missingData(this, basicsMissing(ctx));
    const swr = ctx.settings.safeWithdrawalRate;
    const tiers = [
      ["lean", ctx.settings.leanFactor],
      ["regular", 1],
      ["fat", ctx.settings.fatFactor],
    ] as const;
    const variants = tiers.map(([id, factor]) => {
      const target = (b.annualCost * factor) / swr;
      return variant(
        id,
        b.capital / target,
        { eur: shortfall(target, b.capital), kind: "capital", years: null },
        ctx.settings,
      );
    });
    const regular = variants[1]!;
    return result(this, {
      status: regular.status,
      coverage: regular.coverage,
      distance: regular.distance,
      variants,
    });
  },
};

/**
 * Bridge to the pension: capital needed at the exit age to cover the cost until the pension starts,
 * then the cost net of the pension until the end of the plan. With the pension disabled the whole
 * period up to `endOfPlanAge` must be covered. Today's capital grows at the real expected return
 * until the exit age.
 */
export const bridgeMethod: Method = {
  id: "bridge",
  family: "D",
  countsForVerdict: true,
  evaluate(ctx) {
    const b = basics(ctx);
    const { currentAge, targetRetirementAge, endOfPlanAge, publicPension } = ctx.settings;
    const missing = basicsMissing(ctx);
    if (currentAge === null) missing.push("current_age");
    if (targetRetirementAge === null) missing.push("target_retirement_age");
    if (!b || currentAge === null || targetRetirementAge === null)
      return missingData(this, missing);

    const exitAge = Math.max(currentAge, targetRetirementAge);
    const yearsToExit = exitAge - currentAge;
    const rate = ctx.capital.portfolioReturn;
    const pension = pensionAnnual(ctx.settings);

    const bridgeEnd = publicPension.enabled
      ? Math.min(Math.max(publicPension.startAge, exitAge), endOfPlanAge)
      : endOfPlanAge;
    const bridgeYears = Math.max(0, bridgeEnd - exitAge);
    const postYears = publicPension.enabled ? Math.max(0, endOfPlanAge - bridgeEnd) : 0;

    const required =
      annuityDue(b.annualCost, bridgeYears, rate) +
      annuityDue(Math.max(0, b.annualCost - pension), postYears, rate) /
        Math.pow(1 + rate, bridgeYears);
    const projected = b.capital * Math.pow(1 + rate, yearsToExit);
    const coverage = required > 0 ? projected / required : 1;
    return result(this, {
      status: grade(coverage, ctx.settings),
      coverage,
      distance: {
        eur: shortfall(required / Math.pow(1 + rate, yearsToExit), b.capital),
        kind: "capital",
        years: null,
      },
      details: {
        requiredCapitalAtExit: required,
        projectedCapitalAtExit: projected,
        bridgeYears,
        postPensionYears: postYears,
        pensionAnnual: pension,
        horizonAge: endOfPlanAge,
      },
    });
  },
};
