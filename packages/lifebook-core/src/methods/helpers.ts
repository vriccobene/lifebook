import type { Settings } from "../settings";
import type {
  Distance,
  Method,
  MethodContext,
  MethodResult,
  MethodStatus,
  MethodVariant,
} from "./types";

const EPSILON = 1e-9;

export const NO_DISTANCE: Distance = { eur: null, kind: null, years: null };

/** Traffic light from the coverage and the configured thresholds. */
export function grade(coverage: number, settings: Settings): MethodStatus {
  const { greenAt, yellowAt } = settings.trafficLight;
  if (coverage >= greenAt - EPSILON) return "green";
  if (coverage >= yellowAt - EPSILON) return "yellow";
  return "red";
}

export function result(
  method: Pick<Method, "id" | "family">,
  fields: Partial<Omit<MethodResult, "id" | "family">>,
): MethodResult {
  return {
    id: method.id,
    family: method.family,
    status: "info",
    coverage: null,
    distance: NO_DISTANCE,
    metric: null,
    details: {},
    variants: [],
    missing: [],
    ...fields,
  };
}

export function missingData(
  method: Pick<Method, "id" | "family">,
  reasons: string[],
): MethodResult {
  return result(method, { status: "missing_data", missing: reasons });
}

export function variant(
  id: string,
  coverage: number,
  distance: Distance,
  settings: Settings,
): MethodVariant {
  return { id, status: grade(coverage, settings), coverage, distance };
}

export interface Basics {
  monthlyCost: number;
  annualCost: number;
  /** Investable capital after the emergency buffer. */
  capital: number;
}

/** Living cost and capital shared by most methods; null when they are not available. */
export function basics(ctx: MethodContext): Basics | null {
  const monthlyCost = ctx.livingCost.referenceMonthly;
  const capital = ctx.capital.investable;
  if (monthlyCost === null || capital === null || monthlyCost <= 0) return null;
  return { monthlyCost, annualCost: monthlyCost * 12, capital };
}

export function basicsMissing(ctx: MethodContext): string[] {
  const reasons: string[] = [];
  const cost = ctx.livingCost.referenceMonthly;
  if (cost === null) reasons.push("living_cost");
  else if (cost <= 0) reasons.push("living_cost_not_positive");
  return reasons;
}

/** Net annual public pension; zero whenever the global toggle is off. */
export function pensionAnnual(settings: Settings): number {
  return settings.publicPension.enabled ? settings.publicPension.netMonthlyAmount * 12 : 0;
}

/**
 * Years until `capital` reaches `target` with `monthlySavings` added each month and `annualReturn`
 * (real) earned. Null when it is never reached.
 */
export function yearsToTarget(
  capital: number,
  target: number,
  monthlySavings: number,
  annualReturn: number,
): number | null {
  if (capital >= target) return 0;
  const i = Math.pow(1 + annualReturn, 1 / 12) - 1;
  if (Math.abs(i) < 1e-12)
    return monthlySavings > 0 ? (target - capital) / monthlySavings / 12 : null;
  const a = monthlySavings / i;
  const numerator = target + a;
  const denominator = capital + a;
  if (numerator <= 0 || denominator <= 0 || numerator / denominator <= 1) return null;
  return Math.log(numerator / denominator) / Math.log(1 + i) / 12;
}

/** Present value of `annual` withdrawn at the start of each year for `years` years, at real rate `rate`. */
export function annuityDue(annual: number, years: number, rate: number): number {
  if (years <= 0) return 0;
  if (Math.abs(rate) < 1e-12) return annual * years;
  const v = 1 / (1 + rate);
  return (annual * (1 - Math.pow(v, years))) / (1 - v);
}

export function shortfall(target: number, actual: number): number {
  return Math.max(0, target - actual);
}
