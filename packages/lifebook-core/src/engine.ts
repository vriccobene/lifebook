import { computeCapital, type CapitalSummary } from "./capital";
import { prepareDataset, type Dataset, type LifebookData } from "./dataset";
import { addDays, daysBetween, endOfMonth, monthOf, type IsoDate, type IsoMonth } from "./dates";
import { resolveEssentialForMonth } from "./essential";
import { computeLivingCost, type LivingCostResult } from "./livingCost";
import { defaultRegistry, type MethodRegistry } from "./methods/registry";
import type { MethodContext, MethodResult } from "./methods/types";
import { computeReturns, type ReturnsResult } from "./returns";
import { computeVerdict, type Verdict } from "./verdict";
import type { Warning } from "./types";

export interface EssentialSplit {
  month: IsoMonth;
  livingCost: number;
  essential: number | null;
  discretionary: number | null;
  exceedsLivingCost: boolean;
}

export interface AsOfResult {
  asOf: IsoDate;
  /** The pension toggle in force: when false no method counts the public pension. */
  publicPensionEnabled: boolean;
  livingCost: LivingCostResult;
  capital: CapitalSummary;
  essentialSplit: EssentialSplit[];
  methods: MethodResult[];
  verdict: Verdict;
  warnings: Warning[];
}

/** Essential vs discretionary spending for each period, in euro per (normalised) month. */
function essentialSplit(ds: Dataset, livingCost: LivingCostResult): EssentialSplit[] {
  return livingCost.periods.map((period) => {
    const month = monthOf(period.to);
    const essential = resolveEssentialForMonth(
      ds.essentialSpending,
      month,
      period.monthlySpending,
    ).monthly;
    const exceeds = essential !== null && essential > period.monthlySpending;
    return {
      month,
      livingCost: period.monthlySpending,
      essential,
      discretionary: essential === null ? null : Math.max(0, period.monthlySpending - essential),
      exceedsLivingCost: exceeds,
    };
  });
}

function buildContext(
  ds: Dataset,
  livingCost: LivingCostResult,
  capital: CapitalSummary,
): MethodContext {
  // Single-value methods use the most recent month with data.
  const lastPeriod = livingCost.periods[livingCost.periods.length - 1];
  const month = lastPeriod ? monthOf(lastPeriod.to) : monthOf(ds.asOf);
  const resolved = resolveEssentialForMonth(
    ds.essentialSpending,
    month,
    livingCost.referenceMonthly,
  );
  return {
    asOf: ds.asOf,
    settings: ds.settings,
    livingCost,
    capital,
    essential: {
      ...resolved,
      month,
      exceedsLivingCost:
        resolved.monthly !== null &&
        livingCost.referenceMonthly !== null &&
        resolved.monthly > livingCost.referenceMonthly,
    },
  };
}

/**
 * Everything the dashboard shows for one date, computed only from data and parameters valid on that
 * date. Later entries never change the result.
 */
export function computeAsOf(
  data: LifebookData,
  asOf: IsoDate,
  registry: MethodRegistry = defaultRegistry,
): AsOfResult {
  const ds = prepareDataset(data, asOf);
  const livingCost = computeLivingCost(ds);
  const capital = computeCapital(ds, livingCost);
  const ctx = buildContext(ds, livingCost, capital);
  const methods = registry.evaluateAll(ctx);
  const warnings = [...livingCost.warnings];
  if (ctx.essential.exceedsLivingCost) {
    warnings.push({
      code: "essential_exceeds_living_cost",
      accountId: null,
      from: null,
      to: null,
      detail: ctx.essential.monthly,
    });
  }
  return {
    asOf,
    publicPensionEnabled: ds.settings.publicPension.enabled,
    livingCost,
    capital,
    essentialSplit: essentialSplit(ds, livingCost),
    methods,
    verdict: computeVerdict(methods, registry.list(), ds.settings),
    warnings,
  };
}

export function computeLivingCostAsOf(data: LifebookData, asOf: IsoDate): LivingCostResult {
  return computeLivingCost(prepareDataset(data, asOf));
}

export function computeReturnsAsOf(data: LifebookData, asOf: IsoDate): ReturnsResult {
  return computeReturns(prepareDataset(data, asOf));
}

/** `round`: every date on which some account has a reading. `month`: every month end. */
export type SeriesStep = "round" | "month";

export interface SeriesRange {
  from: IsoDate;
  to: IsoDate;
  step: SeriesStep;
}

export function seriesDates(data: LifebookData, range: SeriesRange): IsoDate[] {
  if (range.step === "round") {
    return [...new Set(data.snapshots.map((s) => s.date))]
      .filter((d) => d >= range.from && d <= range.to)
      .sort();
  }
  const dates: IsoDate[] = [];
  let month = monthOf(range.from);
  for (;;) {
    const date = endOfMonth(month);
    if (date > range.to) break;
    if (date >= range.from) dates.push(date);
    month = monthOf(addDays(date, 1));
  }
  return dates;
}

export interface SeriesPoint<T> {
  date: IsoDate;
  value: T;
}

/** Evaluates `compute` as of each date of the range, e.g. `computeAsOf` for the dashboard history. */
export function computeSeries<T>(
  data: LifebookData,
  range: SeriesRange,
  compute: (data: LifebookData, asOf: IsoDate) => T,
): SeriesPoint<T>[] {
  if (daysBetween(range.from, range.to) < 0) return [];
  return seriesDates(data, range).map((date) => ({ date, value: compute(data, date) }));
}
