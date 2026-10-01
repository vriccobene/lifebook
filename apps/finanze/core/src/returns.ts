import {
  contributionsBetween,
  incomeInto,
  isActive,
  movementsKnown,
  paramsAt,
  readingAt,
  sum,
  transfersBetween,
  type Dataset,
} from "./dataset";
import { DAYS_PER_YEAR, daysBetween, type IsoDate } from "./dates";
import { accruedInterest } from "./livingCost";
import type { Account } from "./types";

export type ReturnMethod =
  "declared" | "inferred" | "real_estate_income" | "appreciation" | "property_value";

/** Return of one account between two of its own consecutive readings. */
export interface AccountReturn {
  accountId: string;
  from: IsoDate;
  to: IsoDate;
  days: number;
  method: ReturnMethod;
  opening: number;
  closing: number;
  /** Net contributions inside the interval: declared, or the transfers known from Firefly III. */
  contributions: number;
  grossGain: number;
  tax: number;
  netGain: number;
  /** Modified Dietz capital base: opening balance plus time-weighted contributions. */
  base: number;
  grossPct: number | null;
  netPct: number | null;
  grossAnnualized: number | null;
  netAnnualized: number | null;
  /** Passive part of the return (interest, dividends, net rent), gross and net of tax. */
  passiveGross: number;
  passiveNet: number;
}

export interface TotalReturn {
  date: IsoDate;
  grossGain: number;
  netGain: number;
  base: number;
  grossPct: number | null;
  netPct: number | null;
  passiveNet: number;
}

export interface ReturnsResult {
  asOf: IsoDate;
  records: AccountReturn[];
  totals: TotalReturn[];
}

function annualize(pct: number | null, days: number): number | null {
  if (pct === null || days <= 0 || pct <= -1) return null;
  return Math.pow(1 + pct, DAYS_PER_YEAR / days) - 1;
}

function ratio(gain: number, base: number): number | null {
  return base > 0 ? gain / base : null;
}

/** Modified Dietz base: opening balance plus each contribution weighted by the time it was invested. */
function dietzBase(
  opening: number,
  contributions: readonly { date: IsoDate; amount: number }[],
  from: IsoDate,
  to: IsoDate,
): number {
  const days = daysBetween(from, to);
  return opening + sum(contributions.map((c) => (c.amount * daysBetween(c.date, to)) / days));
}

function returnFor(
  ds: Dataset,
  account: Account,
  prev: IsoDate,
  cur: IsoDate,
): AccountReturn | null {
  const opening = readingAt(ds, account.id, prev)!;
  const closing = readingAt(ds, account.id, cur)!;
  const params = paramsAt(account, cur);
  const days = daysBetween(opening.date, closing.date);

  let method: ReturnMethod;
  let grossGain: number;
  let tax: number;
  let passiveGross: number;
  let contributions = 0;
  let base: number;
  // Deposits and real estate have no declared contributions: when Firefly III knows their transfers, the
  // money moved in or out is not a gain.
  const known = movementsKnown(ds, account.id, opening.date, closing.date)
    ? transfersBetween(ds, account.id, opening.date, closing.date)
    : null;
  // The salary paid into the income account is money coming in, not a gain.
  const income = incomeInto(ds, account, opening.date, closing.date);

  const openingValue =
    account.type === "real_estate" ? paramsAt(account, opening.date).propertyValue : null;

  if (account.type === "real_estate" && (openingValue !== null || params.propertyValue !== null)) {
    // The balance is the property's cash: what it collects net of what is moved out is the rent. The
    // gain is that plus the change of value, on a base that includes the value of the property.
    method = "property_value";
    const flows = known ?? [];
    contributions = sum(flows.map((t) => t.amount));
    const rent = closing.balance - opening.balance - contributions;
    const startValue = openingValue ?? params.propertyValue!;
    const appreciation = (params.propertyValue ?? startValue) - startValue;
    grossGain = rent + appreciation;
    tax = Math.max(rent, 0) * params.taxRate;
    passiveGross = rent;
    base = dietzBase(opening.balance + startValue, flows, opening.date, closing.date);
  } else if (account.type === "real_estate") {
    contributions = known ? sum(known.map((t) => t.amount)) : 0;
    const appreciation = closing.balance - opening.balance - contributions;
    const rent =
      account.realEstateUse === "income"
        ? (opening.balance * (params.passiveYield ?? 0) * days) / DAYS_PER_YEAR
        : 0;
    method = account.realEstateUse === "income" ? "real_estate_income" : "appreciation";
    grossGain = appreciation + rent;
    // The tax regime of a rental (e.g. cedolare secca) applies to the rent, not to the revaluation.
    tax = Math.max(rent, 0) * params.taxRate;
    passiveGross = rent;
    base = known ? dietzBase(opening.balance, known, opening.date, closing.date) : opening.balance;
  } else if (account.contributionsMode === "inferred") {
    method = "inferred";
    if (known) {
      const flows = [...known, ...income];
      contributions = sum(flows.map((t) => t.amount));
      grossGain = closing.balance - opening.balance - contributions;
      base = dietzBase(opening.balance, flows, opening.date, closing.date);
    } else {
      grossGain = accruedInterest(opening.balance, params.interestRate ?? 0, days);
      base = opening.balance;
    }
    tax = Math.max(grossGain, 0) * params.taxRate;
    passiveGross = grossGain;
  } else {
    method = "declared";
    const list = [...contributionsBetween(ds, account.id, opening.date, closing.date), ...income];
    contributions = sum(list.map((c) => c.amount));
    grossGain = closing.balance - opening.balance - contributions;
    tax = Math.max(grossGain, 0) * params.taxRate;
    passiveGross = Math.min(
      (opening.balance * (params.passiveYield ?? 0) * days) / DAYS_PER_YEAR,
      Math.max(grossGain, 0),
    );
    base = dietzBase(opening.balance, list, opening.date, closing.date);
  }

  const netGain = grossGain - tax;
  const grossPct = ratio(grossGain, base);
  const netPct = ratio(netGain, base);
  return {
    accountId: account.id,
    from: opening.date,
    to: closing.date,
    days,
    method,
    opening: opening.balance,
    closing: closing.balance,
    contributions,
    grossGain,
    tax,
    netGain,
    base,
    grossPct,
    netPct,
    grossAnnualized: annualize(grossPct, days),
    netAnnualized: annualize(netPct, days),
    passiveGross,
    passiveNet: passiveGross * (1 - params.taxRate),
  };
}

/**
 * Gross and net returns of every non-spending, non-liability account, one record per pair of
 * consecutive readings, plus totals per reading date.
 */
export function computeReturns(ds: Dataset): ReturnsResult {
  const records: AccountReturn[] = [];
  for (const account of ds.accounts) {
    if (account.type === "liability") continue;
    const readings = ds.readings.get(account.id) ?? [];
    for (let i = 1; i < readings.length; i++) {
      const cur = readings[i]!;
      const prev = readings[i - 1]!;
      if (!isActive(account, cur.date)) continue;
      if (paramsAt(account, cur.date).isSpendingAccount) continue;
      const record = returnFor(ds, account, prev.date, cur.date);
      if (record) records.push(record);
    }
  }
  records.sort((a, b) =>
    a.to === b.to ? (a.accountId < b.accountId ? -1 : 1) : a.to < b.to ? -1 : 1,
  );

  const dates = [...new Set(records.map((r) => r.to))].sort();
  const totals = dates.map((date): TotalReturn => {
    const group = records.filter((r) => r.to === date);
    const grossGain = sum(group.map((r) => r.grossGain));
    const netGain = sum(group.map((r) => r.netGain));
    const base = sum(group.map((r) => r.base));
    return {
      date,
      grossGain,
      netGain,
      base,
      grossPct: ratio(grossGain, base),
      netPct: ratio(netGain, base),
      passiveNet: sum(group.map((r) => r.passiveNet)),
    };
  });
  return { asOf: ds.asOf, records, totals };
}

/** Time-weighted (chain-linked) return of an account over a set of consecutive records. */
export function linkReturns(records: readonly AccountReturn[]): {
  gross: number | null;
  net: number | null;
  days: number;
  grossAnnualized: number | null;
  netAnnualized: number | null;
} {
  const days = sum(records.map((r) => r.days));
  const link = (pick: (r: AccountReturn) => number | null): number | null => {
    let growth = 1;
    for (const record of records) {
      const value = pick(record);
      if (value === null) return null;
      growth *= 1 + value;
    }
    return growth - 1;
  };
  const gross = records.length > 0 ? link((r) => r.grossPct) : null;
  const net = records.length > 0 ? link((r) => r.netPct) : null;
  return {
    gross,
    net,
    days,
    grossAnnualized: annualize(gross, days),
    netAnnualized: annualize(net, days),
  };
}
