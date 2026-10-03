import { addDays, type IsoDate } from "./dates";
import { isActive, paramsAt, readingAt, sum, type Dataset } from "./dataset";
import type { Account, Warning } from "./types";

/** Adjacent and overlapping successful imports jointly cover the requested period. */
export function ledgerCovered(ds: Dataset, accountId: string, from: IsoDate, to: IsoDate): boolean {
  let next = addDays(from, 1);
  const ranges = ds.fireflyCoverage
    .filter((r) => r.accountId === accountId)
    .sort((a, b) => a.from.localeCompare(b.from));
  for (const r of ranges) {
    if (r.to < next) continue;
    if (r.from > next) return false;
    if (r.to >= to) return true;
    next = addDays(r.to, 1);
  }
  return false;
}

const isInvestment = (a: Account) =>
  a.type === "brokerage" || a.type === "external_investment" || a.type === "pension_fund";

/** The synthetic dataset uses this explicit category for valuation changes, not purchases. */
export function isValuation(category: string | null, account: Account | undefined): boolean {
  return (
    !!account && isInvestment(account) && category?.trim().toLowerCase() === "rendita investimenti"
  );
}

export function fireflyLedger(ds: Dataset, from: IsoDate, to: IsoDate, warnings: Warning[]) {
  const accounts = ds.accounts.filter((a) => isActive(a, from));
  if (!accounts.length || !accounts.every((a) => ledgerCovered(ds, a.id, from, to))) {
    if (ds.fireflyCoverage.length)
      warnings.push({ code: "firefly_partial_coverage", accountId: null, from, to, detail: null });
    return null;
  }
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const movements = ds.fireflyMovements.filter((m) => m.date > from && m.date <= to);
  const deposits = movements.filter((m) => {
    const a = m.toAccountId ? byId.get(m.toAccountId) : undefined;
    return (
      m.type === "deposit" &&
      a &&
      !isValuation(m.categoryName, a) &&
      (!isInvestment(a) ||
        paramsAt(a, m.date).isIncomeAccount ||
        paramsAt(a, m.date).isSpendingAccount)
    );
  });
  const withdrawals = movements.filter((m) => {
    const a = m.fromAccountId ? byId.get(m.fromAccountId) : undefined;
    if (m.type !== "withdrawal" || !a) return false;
    if (isValuation(m.categoryName, a)) {
      warnings.push({
        code: "firefly_valuation_excluded",
        accountId: a.id,
        from,
        to,
        detail: m.amount,
      });
      return false;
    }
    return a.type !== "liability" || a.countsAsLivingCost;
  });
  // Check the journal against balances independently of the expense classification.
  for (const a of accounts) {
    const opening = readingAt(ds, a.id, from),
      closing = readingAt(ds, a.id, to);
    if (
      !opening ||
      !closing ||
      opening.date !== from ||
      closing.date !== to ||
      a.type === "liability"
    )
      continue;
    const net = sum(
      movements.map(
        (m) => (m.toAccountId === a.id ? m.amount : 0) - (m.fromAccountId === a.id ? m.amount : 0),
      ),
    );
    const difference = Math.round((closing.balance - opening.balance - net) * 100) / 100;
    if (difference !== 0)
      warnings.push({
        code: "firefly_balance_discrepancy",
        accountId: a.id,
        from,
        to,
        detail: difference,
      });
  }
  const installments = movements.filter((m) => {
    const liability = m.toAccountId ? byId.get(m.toAccountId) : undefined;
    return m.type === "transfer" && liability?.type === "liability" && liability.countsAsLivingCost;
  });
  const money = (amount: number) => Math.round(amount * 100) / 100;
  return {
    income: money(sum(deposits.map((m) => m.amount))),
    spending: money(sum([...withdrawals, ...installments].map((m) => m.amount))),
  };
}
