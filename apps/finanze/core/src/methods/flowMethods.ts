import {
  basics,
  basicsMissing,
  grade,
  missingData,
  pensionAnnual,
  result,
  shortfall,
} from "./helpers";
import type { Method } from "./types";

/** Passive income alone must cover the yearly cost, without touching the capital. */
export const passiveIncomeMethod: Method = {
  id: "passive_income",
  family: "B",
  countsForVerdict: true,
  evaluate(ctx) {
    const b = basics(ctx);
    if (!b) return missingData(this, basicsMissing(ctx));
    const passive = ctx.capital.passiveNetAnnual;
    const coverage = passive / b.annualCost;
    return result(this, {
      status: grade(coverage, ctx.settings),
      coverage,
      distance: { eur: shortfall(b.annualCost, passive), kind: "annual_flow", years: null },
      details: { passiveNetAnnual: passive, annualCost: b.annualCost },
    });
  },
};

/** Passive income (and pension, if enabled) plus a withdrawal from capital no larger than the swr. */
export const hybridMethod: Method = {
  id: "hybrid",
  family: "B",
  countsForVerdict: true,
  evaluate(ctx) {
    const b = basics(ctx);
    if (!b) return missingData(this, basicsMissing(ctx));
    const swr = ctx.settings.safeWithdrawalRate;
    const pension = pensionAnnual(ctx.settings);
    const withdrawal = Math.max(0, b.annualCost - ctx.capital.passiveNetAnnual - pension);
    const coverage = withdrawal === 0 ? 1 : (b.capital * swr) / withdrawal;
    return result(this, {
      status: grade(coverage, ctx.settings),
      coverage,
      distance: { eur: shortfall(withdrawal / swr, b.capital), kind: "capital", years: null },
      details: {
        requiredWithdrawal: withdrawal,
        withdrawalRate: b.capital > 0 ? withdrawal / b.capital : null,
        pensionAnnual: pension,
      },
    });
  },
};

/**
 * Layered coverage: essential spending must be covered by safe flows (deposit interest, net rent and,
 * if enabled, the public pension); the discretionary rest by risky capital × swr.
 * Without user-entered essential spending the method is `missing_data`: there is no default.
 */
export const layersMethod: Method = {
  id: "layers",
  family: "B",
  countsForVerdict: true,
  evaluate(ctx) {
    const b = basics(ctx);
    const missing = basicsMissing(ctx);
    if (ctx.essential.monthly === null) missing.push("essential_spending");
    if (!b || ctx.essential.monthly === null) return missingData(this, missing);

    const swr = ctx.settings.safeWithdrawalRate;
    const essentialAnnual = ctx.essential.monthly * 12;
    const discretionaryAnnual = Math.max(0, b.annualCost - essentialAnnual);
    const pension = pensionAnnual(ctx.settings);
    const safeFlows = ctx.capital.safeFlowsNetAnnual + pension;
    const risky = ctx.capital.riskyCapital ?? 0;

    const essentialCoverage = essentialAnnual === 0 ? 1 : safeFlows / essentialAnnual;
    const discretionaryCoverage =
      discretionaryAnnual === 0 ? 1 : (risky * swr) / discretionaryAnnual;
    const coverage = Math.min(essentialCoverage, discretionaryCoverage);
    const missingCapital = shortfall(discretionaryAnnual / swr, risky);
    return result(this, {
      status: grade(coverage, ctx.settings),
      coverage,
      distance: {
        eur: shortfall(essentialAnnual, safeFlows) + missingCapital,
        kind: null,
        years: null,
      },
      details: {
        essentialAnnual,
        discretionaryAnnual,
        safeFlowsAnnual: safeFlows,
        pensionAnnual: pension,
        riskyCapital: risky,
        essentialCoverage,
        discretionaryCoverage,
        essentialShortfallAnnualFlow: shortfall(essentialAnnual, safeFlows),
        discretionaryShortfallCapital: missingCapital,
      },
    });
  },
};
