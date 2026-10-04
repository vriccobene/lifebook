import {
  addDays,
  computeCapital,
  computeVerdict,
  daysBetween,
  defaultRegistry,
  endOfMonth,
  prepareDataset,
  type LivingCostResult,
  type MethodContext,
  type SettingsEntry,
} from "@lifebook/finanze-core";
import type { Account, FireflyMovement, Snapshot } from "../api/types";
import { annotationOf, incomeKindOf, receiptAmounts, summarize } from "./analytics";
import { filterMovements, validReportRange, type AnalyticsFilters } from "./analyticsFilters";

/** A month fraction uses the actual days in that calendar month, including both selected bounds. */
export function reportMonths(from: string, to: string) {
  if (!validReportRange(from, to)) return [];
  const months: { date: string; from: string; to: string; fraction: number }[] = [];
  for (let start = from; start <= to;) {
    const end = endOfMonth(start.slice(0, 7));
    const finish = end < to ? end : to;
    months.push({
      date: start.slice(0, 7),
      from: start,
      to: finish,
      fraction: (daysBetween(start, finish) + 1) / Number(end.slice(8)),
    });
    start = addDays(end, 1);
  }
  return months;
}

/** Account filters constrain assets; category/tag/description filters only describe flows. */
export function reportAccounts(
  accounts: Account[],
  movements: FireflyMovement[],
  filters: AnalyticsFilters,
) {
  const idsForName = (name: string) =>
    new Set(
      movements.flatMap((m) => [
        ...(m.fromName === name && m.fromAccountId ? [m.fromAccountId] : []),
        ...(m.toName === name && m.toAccountId ? [m.toAccountId] : []),
      ]),
    );
  const included = idsForName(filters.account);
  const excluded = new Set(filters.excludedAccounts.flatMap((name) => [...idsForName(name)]));
  return accounts.filter(
    (a) =>
      (!filters.account || a.name === filters.account || included.has(a.id)) &&
      !filters.excludedAccounts.includes(a.name) &&
      !excluded.has(a.id),
  );
}

export function computeAnalyticsReport(
  movements: FireflyMovement[],
  accounts: Account[],
  snapshots: Snapshot[],
  settings: SettingsEntry[],
  filters: AnalyticsFilters,
) {
  const months = reportMonths(filters.from, filters.to);
  const rows = filterMovements(movements, filters);
  const counted = rows.filter((m) => annotationOf(m).included);
  const totals = summarize(rows, accounts);
  const duration = months.reduce((sum, m) => sum + m.fraction, 0);
  const hasSpending = counted.some((m) => m.type === "withdrawal");
  const monthlyCost = duration && hasSpending ? totals.spending / duration : null;
  const monthlyIncome =
    duration && counted.some((m) => m.type === "deposit" || m.type === "withdrawal")
      ? totals.income / duration
      : null;
  const monthly = months.map((m) => ({
    ...m,
    ...summarize(
      rows.filter((r) => r.date >= m.from && r.date <= m.to),
      accounts,
    ),
  }));
  const scopedAccounts = reportAccounts(accounts, movements, filters);
  const ds = prepareDataset(
    {
      accounts: scopedAccounts,
      snapshots,
      contributions: [],
      incomeItems: [],
      essentialSpending: [],
      settings,
    },
    filters.to,
  );
  const livingCost: LivingCostResult = {
    asOf: filters.to,
    periods: [],
    averages: { 3: null, 6: null, 12: null },
    referenceWindow: ds.settings.livingCostWindow,
    referenceMonthly: monthlyCost,
    incomeMonthly: monthlyIncome,
    regimeMonthly: monthlyCost,
    warnings: [],
  };
  const capital = computeCapital(ds, livingCost);
  // Observed, tax-adjusted receipts replace the global declared passive yields in this scenario.
  capital.passiveNetAnnual = duration ? (totals.yieldNet / duration) * 12 : 0;
  const safeIds = new Set(
    scopedAccounts
      .filter((a) => ["checking", "deposit", "real_estate"].includes(a.type))
      .map((a) => a.id),
  );
  capital.safeFlowsNetAnnual = duration
    ? (counted
        .filter(
          (m) =>
            m.type === "deposit" && incomeKindOf(m) === "yield" && safeIds.has(m.toAccountId ?? ""),
        )
        .reduce((sum, m) => sum + receiptAmounts(m, accounts).net, 0) /
        duration) *
      12
    : 0;
  const essential =
    monthlyCost !== null && totals.unclassified === 0 ? totals.essential / duration : null;
  const context: MethodContext = {
    asOf: filters.to,
    settings: ds.settings,
    livingCost,
    capital,
    essential: {
      monthly: essential,
      source: essential === null ? null : "amount",
      month: filters.to.slice(0, 7),
      exceedsLivingCost: false,
    },
  };
  const methods = defaultRegistry.evaluateAll(context);
  return {
    rows,
    totals,
    duration,
    monthly,
    livingCost,
    capital,
    methods,
    essential,
    settings: ds.settings,
    verdict: computeVerdict(methods, defaultRegistry.list(), ds.settings),
  };
}
