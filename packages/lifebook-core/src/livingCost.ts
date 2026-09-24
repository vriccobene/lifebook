import { contributionsBetween, isActive, paramsAt, readingAt, sum, type Dataset } from "./dataset";
import { DAYS_PER_MONTH, DAYS_PER_YEAR, addMonths, daysBetween, type IsoDate } from "./dates";
import { incomeBetween } from "./income";
import type { Account, Warning } from "./types";

export interface PeriodSpending {
  from: IsoDate;
  to: IsoDate;
  days: number;
  income: number;
  /** Sum of balance changes of the spending accounts. */
  spendingAccountsDelta: number;
  /** Net transfers towards non-spending accounts. */
  transfers: number;
  transfersByAccount: { accountId: string; amount: number }[];
  spending: number;
  /** Spending normalised to a 30.4375-day month. */
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
 * Period boundaries: every date on which an account that is a spending account on that date has a reading.
 * Consecutive boundaries delimit a period, so a missed round simply makes the next period longer.
 */
export function roundDates(ds: Dataset): IsoDate[] {
  const dates = new Set<IsoDate>();
  for (const account of ds.accounts) {
    for (const reading of ds.readings.get(account.id) ?? []) {
      if (isActive(account, reading.date) && paramsAt(account, reading.date).isSpendingAccount) {
        dates.add(reading.date);
      }
    }
  }
  return [...dates].sort();
}

/** Transfer towards a non-spending account during (from, to]; null when the account does not take part. */
function transferFor(
  ds: Dataset,
  account: Account,
  from: IsoDate,
  to: IsoDate,
  warnings: Warning[],
): number | null {
  if (account.type === "real_estate") return null; // revaluations are not transfers

  const params = paramsAt(account, to);
  const days = daysBetween(from, to);

  if (account.type === "liability") {
    const capitalRepaid = sum(contributionsBetween(ds, account.id, from, to).map((c) => c.amount));
    // When the installment is living cost the repaid capital stays in the spending.
    if (account.countsAsLivingCost) return 0;
    const installments = Math.round(days / DAYS_PER_MONTH) * (params.monthlyPayment ?? 0);
    return Math.max(capitalRepaid, installments);
  }

  if (account.contributionsMode === "declared") {
    const contributions = contributionsBetween(ds, account.id, from, to);
    const total = sum(contributions.map((c) => c.amount));
    const opening = readingAt(ds, account.id, from);
    const closing = readingAt(ds, account.id, to);
    if (
      opening &&
      closing &&
      contributions.length === 0 &&
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

  // inferred: balance change minus the net interest accrued at the declared rate
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
  const income = incomeBetween(ds.incomeItems, from, to);

  let spendingAccountsDelta = 0;
  const transfersByAccount: { accountId: string; amount: number }[] = [];

  for (const account of ds.accounts) {
    if (!isActive(account, to)) continue;
    const params = paramsAt(account, to);
    if (params.isSpendingAccount) {
      const closing = readingAt(ds, account.id, to);
      if (!closing) continue;
      if (closing.date <= from) {
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
    } else {
      const amount = transferFor(ds, account, from, to, warnings);
      if (amount !== null) transfersByAccount.push({ accountId: account.id, amount });
    }
  }

  const transfers = sum(transfersByAccount.map((t) => t.amount));
  const spending = income - spendingAccountsDelta - transfers;
  if (spending < 0) warnings.push(warning("negative_spending", { from, to, detail: spending }));

  return {
    from,
    to,
    days,
    income,
    spendingAccountsDelta,
    transfers,
    transfersByAccount,
    spending,
    monthlySpending: (spending / days) * DAYS_PER_MONTH,
    warnings,
  };
}

function windowAverage(
  periods: readonly PeriodSpending[],
  months: number,
  pick: (p: PeriodSpending) => number,
): { value: number | null; coveredDays: number; windowDays: number } {
  const last = periods[periods.length - 1];
  if (!last) return { value: null, coveredDays: 0, windowDays: 0 };
  const start = addMonths(last.to, -months);
  const included = periods.filter((p) => p.to > start);
  const coveredDays = sum(included.map((p) => p.days));
  if (included.length === 0 || coveredDays === 0)
    return { value: null, coveredDays: 0, windowDays: 0 };
  return {
    value: (sum(included.map(pick)) / coveredDays) * DAYS_PER_MONTH,
    coveredDays,
    windowDays: daysBetween(start, last.to),
  };
}

function flagOutliers(periods: PeriodSpending[], threshold: number): void {
  if (periods.length < 3) return;
  for (const period of periods) {
    const others = periods.filter((p) => p !== period);
    const days = sum(others.map((p) => p.days));
    const average = (sum(others.map((p) => p.spending)) / days) * DAYS_PER_MONTH;
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
  if (!hasSpendingAccount) warnings.push(warning("no_spending_account"));
  warnings.push(...periods.flatMap((p) => p.warnings), ...staleWarnings(ds));

  const averages = {
    3: windowAverage(periods, 3, (p) => p.spending).value,
    6: windowAverage(periods, 6, (p) => p.spending).value,
    12: windowAverage(periods, 12, (p) => p.spending).value,
  };
  const referenceWindow = ds.settings.livingCostWindow;
  const reference = windowAverage(periods, referenceWindow, (p) => p.spending);
  if (reference.value !== null && reference.coveredDays < reference.windowDays * 0.75) {
    warnings.push(warning("insufficient_history", { detail: reference.coveredDays }));
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
