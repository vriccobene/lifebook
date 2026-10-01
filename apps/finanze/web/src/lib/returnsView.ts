import { daysBetween, linkReturns, type AccountReturn } from "@lifebook/finanze-core";
import type { ReturnsPayload } from "../api/types";
import { inRange, type DateRange } from "./range";

export interface ReturnSummary {
  accountId: string | null;
  periods: number;
  gross: number | null;
  net: number | null;
  grossAnnualized: number | null;
  netAnnualized: number | null;
  /** Gains in euro over the range: the sum of the periods. */
  grossGain: number;
  netGain: number;
  passiveNet: number;
}

const total = (values: readonly number[]) => values.reduce((sum, v) => sum + v, 0);

/**
 * Share of the whole net gain that comes from each account. Null when the total is zero; a share can be
 * negative (an account that lost) or above 100% (when others lost).
 */
export function gainShare(summary: ReturnSummary, whole: ReturnSummary | null): number | null {
  if (!whole || whole.netGain === 0) return null;
  return summary.netGain / whole.netGain;
}

function annualize(pct: number | null, days: number): number | null {
  if (pct === null || days <= 0 || pct <= -1) return null;
  return Math.pow(1 + pct, 365 / days) - 1;
}

/** Cumulative (chain-linked) and annualised return of each account over the range. */
export function accountSummaries(returns: ReturnsPayload, range: DateRange): ReturnSummary[] {
  const byAccount = new Map<string, AccountReturn[]>();
  for (const record of returns.records) {
    if (!inRange(record.to, range)) continue;
    byAccount.set(record.accountId, [...(byAccount.get(record.accountId) ?? []), record]);
  }
  return [...byAccount.entries()].map(([accountId, records]) => {
    const linked = linkReturns(records);
    return {
      accountId,
      periods: records.length,
      gross: linked.gross,
      net: linked.net,
      grossAnnualized: linked.grossAnnualized,
      netAnnualized: linked.netAnnualized,
      grossGain: total(records.map((r) => r.grossGain)),
      netGain: total(records.map((r) => r.netGain)),
      passiveNet: total(records.map((r) => r.passiveNet)),
    };
  });
}

/** The same for the whole portfolio, from the totals of each date. */
export function totalSummary(returns: ReturnsPayload, range: DateRange): ReturnSummary | null {
  const totals = returns.totals.filter((t) => inRange(t.date, range));
  const records = returns.records.filter((r) => inRange(r.to, range));
  if (totals.length === 0 || records.length === 0) return null;
  const chain = (pick: (t: (typeof totals)[number]) => number | null) => {
    let growth = 1;
    for (const t of totals) {
      const value = pick(t);
      if (value === null) return null;
      growth *= 1 + value;
    }
    return growth - 1;
  };
  const from = records.reduce((min, r) => (r.from < min ? r.from : min), records[0]!.from);
  const to = totals[totals.length - 1]!.date;
  const days = daysBetween(from, to);
  const gross = chain((t) => t.grossPct);
  const net = chain((t) => t.netPct);
  return {
    accountId: null,
    periods: totals.length,
    gross,
    net,
    grossAnnualized: annualize(gross, days),
    netAnnualized: annualize(net, days),
    grossGain: total(totals.map((t) => t.grossGain)),
    netGain: total(totals.map((t) => t.netGain)),
    passiveNet: total(totals.map((t) => t.passiveNet)),
  };
}
