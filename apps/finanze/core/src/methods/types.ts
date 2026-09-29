import type { IsoDate } from "../dates";
import type { CapitalSummary } from "../capital";
import type { EssentialForMonth } from "../essential";
import type { LivingCostResult } from "../livingCost";
import type { Settings } from "../settings";

export type MethodStatus = "green" | "yellow" | "red" | "missing_data" | "info";
export type MethodFamily = "A" | "B" | "D" | "E";

export interface Distance {
  /** Euro still missing, 0 once reached. */
  eur: number | null;
  /** `capital`: missing capital in today's euro. `annual_flow`: missing yearly income. */
  kind: "capital" | "annual_flow" | null;
  /** Estimated years to reach the goal, when the method can tell. */
  years: number | null;
}

export interface MethodVariant {
  id: string;
  status: MethodStatus;
  coverage: number | null;
  distance: Distance;
}

export interface MethodResult {
  id: string;
  family: MethodFamily;
  status: MethodStatus;
  /** Fraction of the goal reached (1 = 100%). Null for informational metrics and missing data. */
  coverage: number | null;
  distance: Distance;
  /** Family E only: the metric value. */
  metric: { value: number | null; unit: "ratio" | "years" | "months" } | null;
  details: Record<string, number | string | boolean | null>;
  variants: MethodVariant[];
  /** Why the method could not be computed, when `status` is `missing_data`. */
  missing: string[];
}

export interface MethodContext {
  asOf: IsoDate;
  settings: Settings;
  livingCost: LivingCostResult;
  capital: CapitalSummary;
  essential: EssentialForMonth & { month: string | null; exceedsLivingCost: boolean };
}

/**
 * A "can I stop working?" method. New methods (Monte Carlo, backtests, stress tests) are added by
 * registering another `Method`; existing ones do not change.
 */
export interface Method {
  id: string;
  family: MethodFamily;
  /** Whether the result takes part in the synthetic verdict. */
  countsForVerdict: boolean;
  evaluate(ctx: MethodContext): MethodResult;
}
