import { fireflyLedger, ledgerCovered } from "./fireflyLedger";
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
import {
  DAYS_PER_YEAR,
  addMonths,
  addDays,
  endOfMonth,
  daysBetween,
  monthIndex,
  monthOf,
  monthsBetween,
  type IsoDate,
} from "./dates";
import { incomeBetween } from "./income";
import type { Account, Warning } from "./types";

export interface PeriodSpending {
  /** Cut-off date of the previous month with readings. */
  from: IsoDate;
  /** Cut-off date of this month: the latest reading of a spending account in it. */
  to: IsoDate;
  days: number;
  /** Calendar months covered: 1, or more when a month has no reading. */
  months: number;
  income: number;
  source: "balances" | "firefly";
  estimatedSpending: number;
  /** Sum of balance changes of the spending accounts. */
  spendingAccountsDelta: number;
  /** Net transfers towards non-spending accounts, including `outsideTransfers`. */
  transfers: number;
  transfersByAccount: { accountId: string; amount: number }[];
  /**
   * Net transfers towards own accounts Lifebook does not track (Firefly III accounts not linked). Money
   * that leaves the tracked accounts this way is not spent, and money that comes in is not earned.
   */
  outsideTransfers: number;
  spending: number;
  /** Spending per calendar month: `spending / months`. */
  monthlySpending: number;
  warnings: Warning[];
}

export interface LivingCostResult {
  asOf: IsoDate;
  periods: PeriodSpending[];
  /** Moving averages of the monthly spending, or null when there are no periods. */
  averages: { 3: number | null; 6: number | null; 12: number | null };
  referenceWindow: 3 | 6 | 12;
  /** Monthly living cost from the reference window. */
  referenceMonthly: number | null;
  /** Monthly net income over the reference window. */
  incomeMonthly: number | null;
  /** Reference cost without the installments that end before the target retirement age. */
  regimeMonthly: number | null;
  warnings: Warning[];
}

/** Interest accrued over `days` at an effective annual rate. */
export function accruedInterest(balance: number, annualRate: number, days: number): number {
  return balance * (Math.pow(1 + annualRate, days / DAYS_PER_YEAR) - 1);
}

function warning(code: Warning["code"], extra: Partial<Omit<Warning, "code">> = {}): Warning {
  return { code, accountId: null, from: null, to: null, detail: null, ...extra };
}

/**
 * Period boundaries. A period is always a calendar month: each month in which a spending account
 * has a reading gives one boundary, dated at the latest such reading. A reading on the 29th or on
 * the 31st therefore makes no difference, and whatever it misses is recovered the next month.
 * A month without readings makes the next period span two (or more) months.
 */
export function roundDates(ds: Dataset): IsoDate[] {
  const cutoffByMonth = new Map<string, IsoDate>();
  for (const account of ds.accounts) {
    for (const reading of ds.readings.get(account.id) ?? []) {
      if (!isActive(account, reading.date) || !paramsAt(account, reading.date).isSpendingAccount)
        continue;
      const month = monthOf(reading.date);
      const current = cutoffByMonth.get(month);
      if (current === undefined || reading.date > current) cutoffByMonth.set(month, reading.date);
    }
  }
  // A complete journal can measure the first imported calendar month without a prior balance.
  const active = ds.accounts.filter((a) => isActive(a, ds.asOf));
  for (const range of ds.fireflyCoverage) {
    if (!range.from.endsWith("-01")) continue;
    for (let start = range.from; start <= range.to; start = addMonths(start, 1)) {
      const end = endOfMonth(monthOf(start));
      if (end > ds.asOf || end > range.to) break;
      const previous = addDays(start, -1);
      if (!active.length || !active.every((a) => ledgerCovered(ds, a.id, previous, end))) continue;
      cutoffByMonth.set(monthOf(end), end);
      if (!cutoffByMonth.has(monthOf(previous))) cutoffByMonth.set(monthOf(previous), previous);
    }
  }
  return [...cutoffByMonth.values()].sort();
}

/** Transfer towards a non-spending account during (from, to]; null when the account does not take part. */
function transferFor(
  ds: Dataset,
  account: Account,
  from: IsoDate,
  to: IsoDate,
  warnings: Warning[],
): number | null {
  const known = movementsKnown(ds, account.id, from, to);
  const knownTransfers = () => sum(transfersBetween(ds, account.id, from, to).map((t) => t.amount));

  // Revaluations are not transfers; a purchase or renovation paid from another account is, when known.
  if (account.type === "real_estate") return known ? knownTransfers() : null;

  const params = paramsAt(account, to);

  if (account.type === "liability") {
    const capitalRepaid = sum(contributionsBetween(ds, account.id, from, to).map((c) => c.amount));
    // When the installment is living cost the repaid capital stays in the spending.
    if (account.countsAsLivingCost) return 0;
    const installments = monthsBetween(from, to) * (params.monthlyPayment ?? 0);
    return Math.max(capitalRepaid, installments);
  }

  // Income paid into a non-spending account stays there: part of its inflow, like a transfer.
  const income = () => sum(incomeInto(ds, account, from, to).map((r) => r.amount));

  if (account.contributionsMode === "declared") {
    const contributions = contributionsBetween(ds, account.id, from, to);
    const total = sum(contributions.map((c) => c.amount)) + income();
    const opening = readingAt(ds, account.id, from);
    const closing = readingAt(ds, account.id, to);
    if (
      opening &&
      closing &&
      contributions.length === 0 &&
      !params.isIncomeAccount &&
      opening.balance !== 0 &&
      Math.abs(closing.balance - opening.balance) / Math.abs(opening.balance) >
        ds.settings.declaredBalanceChangeThreshold
    ) {
      warnings.push(
        warning("declared_contributions_missing", {
          accountId: account.id,
          from,
          to,
          detail: closing.balance - opening.balance,
        }),
      );
    }
    return total;
  }

  // inferred: the transfers when known from Firefly III, otherwise the balance change minus the net
  // interest accrued at the declared rate
  // Without them the balance change already contains the income.
  if (known) return knownTransfers() + income();
  const closing = readingAt(ds, account.id, to);
  if (!closing) return null;
  if (closing.date <= from) return 0; // not read in this period: the change lands where it is measured
  const opening = readingAt(ds, account.id, from);
  if (!opening) {
    warnings.push(warning("account_no_opening_balance", { accountId: account.id, from, to }));
    return 0;
  }
  const ownDays = daysBetween(opening.date, closing.date);
  const gross = accruedInterest(opening.balance, params.interestRate ?? 0, ownDays);
  const net = gross * (1 - params.taxRate);
  return closing.balance - opening.balance - net;
}

function computePeriod(ds: Dataset, from: IsoDate, to: IsoDate): PeriodSpending {
  const warnings: Warning[] = [];
  const days = daysBetween(from, to);
  const months = monthsBetween(from, to);
  const manualIncome = incomeBetween(ds.incomeItems, from, to);
  const ledger = fireflyLedger(ds, from, to, warnings);
  const income = ledger?.income ?? manualIncome;
  if (ledger && manualIncome !== 0)
    warnings.push(warning("firefly_manual_income_ignored", { from, to, detail: manualIncome }));

  let spendingAccountsDelta = 0;
  const transfersByAccount: { accountId: string; amount: number }[] = [];
  /** Accounts whose movements this period accounts for. */
  const counted = new Set<string>();

  for (const account of ds.accounts) {
    if (!isActive(account, to)) continue;
    const params = paramsAt(account, to);
    if (params.isSpendingAccount) {
      const closing = readingAt(ds, account.id, to);
      if (!closing || closing.date <= from) {
        warnings.push(
          warning("spending_account_missing_reading", { accountId: account.id, from, to }),
        );
        continue;
      }
      const opening = readingAt(ds, account.id, from);
      if (!opening) {
        warnings.push(warning("account_no_opening_balance", { accountId: account.id, from, to }));
        continue;
      }
      spendingAccountsDelta += closing.balance - opening.balance;
      counted.add(account.id);
    } else {
      const amount = transferFor(ds, account, from, to, warnings);
      if (amount !== null) {
        transfersByAccount.push({ accountId: account.id, amount });
        counted.add(account.id);
      }
    }
  }

  // The other side of a transfer with an untracked account: without it the money that left would look
  // spent (or, coming in, earned).
  let outsideTransfers = 0;
  for (const t of ds.transfers) {
    if (t.date <= from || t.date > to) continue;
    if (t.toAccountId === null && t.fromAccountId !== null && counted.has(t.fromAccountId))
      outsideTransfers += t.amount;
    if (t.fromAccountId === null && t.toAccountId !== null && counted.has(t.toAccountId))
      outsideTransfers -= t.amount;
  }

  const transfers = sum(transfersByAccount.map((t) => t.amount)) + outsideTransfers;
  const estimatedSpending = income - spendingAccountsDelta - transfers;
  const spending = ledger?.spending ?? estimatedSpending;
  if (spending < 0) warnings.push(warning("negative_spending", { from, to, detail: spending }));

  return {
    from,
    to,
    days,
    months,
    income,
    source: ledger ? "firefly" : "balances",
    estimatedSpending,
    spendingAccountsDelta,
    transfers,
    transfersByAccount,
    outsideTransfers,
    spending,
    monthlySpending: spending / months,
    warnings,
  };
}

/** Average per month over the last `months` calendar months: total over the months the periods cover. */
function windowAverage(
  periods: readonly PeriodSpending[],
  months: number,
  pick: (p: PeriodSpending) => number,
): { value: number | null; coveredMonths: number } {
  const last = periods[periods.length - 1];
  if (!last) return { value: null, coveredMonths: 0 };
  const included = periods.filter((p) => monthIndex(p.to) > monthIndex(last.to) - months);
  const coveredMonths = sum(included.map((p) => p.months));
  if (included.length === 0) return { value: null, coveredMonths: 0 };
  return { value: sum(included.map(pick)) / coveredMonths, coveredMonths };
}

function flagOutliers(periods: PeriodSpending[], threshold: number): void {
  if (periods.length < 3) return;
  for (const period of periods) {
    const others = periods.filter((p) => p !== period);
    const average = sum(others.map((p) => p.spending)) / sum(others.map((p) => p.months));
    if (average > 0 && Math.abs(period.monthlySpending - average) / average > threshold) {
      period.warnings.push(
        warning("spending_outlier", {
          from: period.from,
          to: period.to,
          detail: period.monthlySpending,
        }),
      );
    }
  }
}

function staleWarnings(ds: Dataset): Warning[] {
  const active = ds.accounts.filter((a) => isActive(a, ds.asOf) && ds.readings.has(a.id));
  const lastDates = active.map((a) => ({ id: a.id, date: readingAt(ds, a.id, ds.asOf)?.date }));
  const newest = lastDates.reduce<IsoDate | null>(
    (max, { date }) => (date && (max === null || date > max) ? date : max),
    null,
  );
  if (newest === null) return [];
  return lastDates.flatMap(({ id, date }) => {
    if (!date) return [];
    const age = daysBetween(date, newest);
    return age > ds.settings.staleAccountDays
      ? [warning("stale_account", { accountId: id, detail: age })]
      : [];
  });
}

/** Installments of liabilities counted as living cost that are still due after the target retirement date. */
function regimeAdjustment(ds: Dataset): number {
  const { currentAge, targetRetirementAge } = ds.settings;
  if (currentAge === null || targetRetirementAge === null) return 0;
  const retirement = addMonths(ds.asOf, Math.round((targetRetirementAge - currentAge) * 12));
  let ended = 0;
  for (const account of ds.accounts) {
    if (account.type !== "liability" || !account.countsAsLivingCost || !isActive(account, ds.asOf))
      continue;
    const params = paramsAt(account, ds.asOf);
    if (params.paymentEndDate !== null && params.paymentEndDate <= retirement) {
      ended += params.monthlyPayment ?? 0;
    }
  }
  return ended;
}

export function computeLivingCost(ds: Dataset): LivingCostResult {
  const boundaries = roundDates(ds);
  const periods: PeriodSpending[] = [];
  for (let i = 1; i < boundaries.length; i++) {
    periods.push(computePeriod(ds, boundaries[i - 1]!, boundaries[i]!));
  }
  flagOutliers(periods, ds.settings.spendingDeviationThreshold);

  const warnings: Warning[] = [];
  const hasSpendingAccount = ds.accounts.some(
    (a) => isActive(a, ds.asOf) && paramsAt(a, ds.asOf).isSpendingAccount,
  );
  if (!hasSpendingAccount && !periods.some((p) => p.source === "firefly"))
    warnings.push(warning("no_spending_account"));
  warnings.push(...periods.flatMap((p) => p.warnings), ...staleWarnings(ds));

  const averages = {
    3: windowAverage(periods, 3, (p) => p.spending).value,
    6: windowAverage(periods, 6, (p) => p.spending).value,
    12: windowAverage(periods, 12, (p) => p.spending).value,
  };
  const referenceWindow = ds.settings.livingCostWindow;
  const reference = windowAverage(periods, referenceWindow, (p) => p.spending);
  if (reference.value !== null && reference.coveredMonths < referenceWindow * 0.75) {
    warnings.push(warning("insufficient_history", { detail: reference.coveredMonths }));
  }
  const income = windowAverage(periods, referenceWindow, (p) => p.income);

  const referenceMonthly = reference.value;
  return {
    asOf: ds.asOf,
    periods,
    averages,
    referenceWindow,
    referenceMonthly,
    incomeMonthly: income.value,
    regimeMonthly:
      referenceMonthly === null ? null : Math.max(0, referenceMonthly - regimeAdjustment(ds)),
    warnings,
  };
}
