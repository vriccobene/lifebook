import type { MethodResult } from "@lifebook/core";
import type {
  Account,
  AccountType,
  EssentialSplit,
  LivingCostResult,
  MethodsPayload,
  NetWorthPayload,
  ReturnsPayload,
  Snapshot,
  VerdictPayload,
} from "../api/types";
import { inRange, type DateRange } from "./range";

export const ACCOUNT_TYPES: AccountType[] = [
  "checking",
  "deposit",
  "brokerage",
  "external_investment",
  "real_estate",
  "liability",
];

export type Row = { date: string } & Record<string, number | string | null>;

export function netWorthRows(points: readonly NetWorthPayload[]): Row[] {
  return points.map((p) => ({ date: p.asOf, total: p.netWorth, ...p.netWorthByType }));
}

/** One row per date with the balance of each account (by id); accounts without a reading that day are null. */
export function balanceRows(snapshots: readonly Snapshot[], range: DateRange): Row[] {
  const byDate = new Map<string, Row>();
  for (const s of snapshots) {
    if (!inRange(s.date, range)) continue;
    const row = byDate.get(s.date) ?? ({ date: s.date } as Row);
    row[s.accountId] = s.balance;
    byDate.set(s.date, row);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function accountsWithBalances(
  snapshots: readonly Snapshot[],
  accounts: readonly Account[],
): Account[] {
  const ids = new Set(snapshots.map((s) => s.accountId));
  return accounts.filter((a) => ids.has(a.id));
}

/** Monthly spending per period plus the 3, 6 and 12 month moving averages as of that date. */
export function costRows(
  living: LivingCostResult,
  series: readonly { asOf: string; livingCost: LivingCostResult }[],
  range: DateRange,
): Row[] {
  const byDate = new Map(series.map((p) => [p.asOf, p.livingCost.averages]));
  return living.periods
    .filter((p) => inRange(p.to, range))
    .map((p) => {
      const averages = byDate.get(p.to);
      return {
        date: p.to,
        monthly: p.monthlySpending,
        ma3: averages?.[3] ?? null,
        ma6: averages?.[6] ?? null,
        ma12: averages?.[12] ?? null,
      };
    });
}

export function essentialRows(split: readonly EssentialSplit[], range: DateRange): Row[] {
  return split
    .filter((s) =>
      inRange(`${s.month}-15`, {
        from: range.from.slice(0, 7) + "-01",
        to: range.to.slice(0, 7) + "-31",
      }),
    )
    .map((s) => ({
      date: s.month,
      essential: s.essential,
      discretionary: s.discretionary,
      livingCost: s.livingCost,
    }));
}

/** Net income and living cost per month for each period. */
export function incomeVsCostRows(living: LivingCostResult, range: DateRange): Row[] {
  return living.periods
    .filter((p) => inRange(p.to, range))
    .map((p) => ({ date: p.to, income: p.income / p.months, cost: p.monthlySpending }));
}

/** Gross and net return per period, for the total or for one account. */
export function returnsRows(
  returns: ReturnsPayload,
  accountId: string | null,
  range: DateRange,
): Row[] {
  if (accountId === null) {
    return returns.totals
      .filter((t) => inRange(t.date, range))
      .map((t) => ({ date: t.date, gross: t.grossPct, net: t.netPct }));
  }
  return returns.records
    .filter((r) => r.accountId === accountId && inRange(r.to, range))
    .map((r) => ({ date: r.to, gross: r.grossPct, net: r.netPct }));
}

export function savingsRows(points: readonly MethodsPayload[]): Row[] {
  return points.map((p) => ({
    date: p.asOf,
    rate: p.methods.find((m) => m.id === "savings_rate")?.metric?.value ?? null,
  }));
}

/** Methods that have a traffic light, i.e. everything but the monitoring metrics. */
export function trafficMethods(methods: readonly MethodResult[]): MethodResult[] {
  return methods.filter((m) => m.family !== "E");
}

export function coverageRows(points: readonly MethodsPayload[]): Row[] {
  return points.map((p) => {
    const row: Row = { date: p.asOf };
    for (const m of trafficMethods(p.methods)) row[m.id] = m.coverage;
    return row;
  });
}

export interface TrafficCell {
  date: string;
  status: string;
}

export function trafficStrip(points: readonly MethodsPayload[], methodId: string): TrafficCell[] {
  return points.map((p) => ({
    date: p.asOf,
    status: p.methods.find((m) => m.id === methodId)?.status ?? "missing_data",
  }));
}

export function verdictStrip(points: readonly VerdictPayload[]): TrafficCell[] {
  return points.map((p) => ({ date: p.asOf, status: p.verdict.status }));
}
