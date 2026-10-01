import { incomeReceipts } from "./income";
import { resolveAccountParams } from "./params";
import { resolveSettings, type Settings, type SettingsEntry } from "./settings";
import type { IsoDate } from "./dates";
import { monthOf } from "./dates";
import type {
  Account,
  AccountParams,
  BalanceSnapshot,
  Contribution,
  EssentialSpendingEntry,
  IncomeItem,
  Transfer,
} from "./types";

/** Everything the user has entered. Persistence is the caller's concern. */
export interface LifebookData {
  accounts: Account[];
  snapshots: BalanceSnapshot[];
  contributions: Contribution[];
  /** Transfers imported from Firefly III. */
  transfers?: Transfer[];
  incomeItems: IncomeItem[];
  essentialSpending: EssentialSpendingEntry[];
  settings: SettingsEntry[];
}

/**
 * The data visible at `asOf`: nothing dated after it is kept, and settings are resolved at that date.
 * Every calculation works on a Dataset, which is what makes as-of results independent of later data.
 */
export interface Dataset {
  asOf: IsoDate;
  settings: Settings;
  accounts: Account[];
  readings: Map<string, BalanceSnapshot[]>;
  contributions: Map<string, Contribution[]>;
  transfers: Transfer[];
  incomeItems: IncomeItem[];
  essentialSpending: EssentialSpendingEntry[];
}

export function prepareDataset(data: LifebookData, asOf: IsoDate): Dataset {
  const readings = new Map<string, BalanceSnapshot[]>();
  // Later entries win when two snapshots share account and date.
  const byKey = new Map<string, BalanceSnapshot>();
  for (const snapshot of data.snapshots) {
    if (snapshot.date <= asOf) byKey.set(`${snapshot.accountId}|${snapshot.date}`, snapshot);
  }
  for (const snapshot of byKey.values()) {
    const list = readings.get(snapshot.accountId) ?? [];
    list.push(snapshot);
    readings.set(snapshot.accountId, list);
  }
  for (const list of readings.values()) list.sort((a, b) => (a.date < b.date ? -1 : 1));

  const contributions = new Map<string, Contribution[]>();
  for (const contribution of data.contributions) {
    if (contribution.date > asOf) continue;
    const list = contributions.get(contribution.accountId) ?? [];
    list.push(contribution);
    contributions.set(contribution.accountId, list);
  }

  const asOfMonth = monthOf(asOf);
  return {
    asOf,
    settings: resolveSettings(data.settings, asOf),
    accounts: data.accounts,
    readings,
    contributions,
    transfers: (data.transfers ?? []).filter((t) => t.date <= asOf),
    incomeItems: data.incomeItems,
    essentialSpending: data.essentialSpending.filter((entry) =>
      entry.mode === "month_amount" ? entry.month <= asOfMonth : entry.validFrom <= asOf,
    ),
  };
}

/** An archived account stops existing from its `archivedAt` date onwards. */
export function isActive(account: Account, date: IsoDate): boolean {
  return account.archivedAt === null || account.archivedAt > date;
}

export function paramsAt(account: Account, date: IsoDate): AccountParams {
  return resolveAccountParams(account, date);
}

/** Latest reading on or before `date`. A stale account keeps its last known balance. */
export function readingAt(
  ds: Dataset,
  accountId: string,
  date: IsoDate,
): BalanceSnapshot | undefined {
  const list = ds.readings.get(accountId);
  if (!list) return undefined;
  let found: BalanceSnapshot | undefined;
  for (const reading of list) {
    if (reading.date <= date) found = reading;
    else break;
  }
  return found;
}

/** Sum of contributions with `from < date <= to`. */
export function contributionsBetween(
  ds: Dataset,
  accountId: string,
  from: IsoDate,
  to: IsoDate,
): Contribution[] {
  return (ds.contributions.get(accountId) ?? []).filter((c) => c.date > from && c.date <= to);
}

/**
 * Income paid into an account with `from < date <= to`: the whole income when it is the only income
 * account at the payment date, a share when there are several.
 */
export function incomeInto(
  ds: Dataset,
  account: Account,
  from: IsoDate,
  to: IsoDate,
): { date: IsoDate; amount: number }[] {
  return incomeReceipts(ds.incomeItems, from, to).flatMap((receipt) => {
    if (!paramsAt(account, receipt.date).isIncomeAccount) return [];
    const receivers = ds.accounts.filter(
      (a) => isActive(a, receipt.date) && paramsAt(a, receipt.date).isIncomeAccount,
    ).length;
    return [{ date: receipt.date, amount: receipt.amount / receivers }];
  });
}

export function sum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/**
 * Whether the movements of an account between two dates are known from Firefly III: both readings were
 * imported, and the import brings every transfer of the account in the same range. Then the transfers
 * are the account's exact net inflow and no estimate is needed.
 */
export function movementsKnown(
  ds: Dataset,
  accountId: string,
  from: IsoDate,
  to: IsoDate,
): boolean {
  const opening = readingAt(ds, accountId, from);
  const closing = readingAt(ds, accountId, to);
  return opening?.source === "firefly" && closing?.source === "firefly";
}

/** Transfers of an account with `from < date <= to`, signed: positive into the account, negative out. */
export function transfersBetween(
  ds: Dataset,
  accountId: string,
  from: IsoDate,
  to: IsoDate,
): { date: IsoDate; amount: number }[] {
  const flows: { date: IsoDate; amount: number }[] = [];
  for (const t of ds.transfers) {
    if (t.date <= from || t.date > to || t.fromAccountId === t.toAccountId) continue;
    if (t.toAccountId === accountId) flows.push({ date: t.date, amount: t.amount });
    if (t.fromAccountId === accountId) flows.push({ date: t.date, amount: -t.amount });
  }
  return flows;
}
