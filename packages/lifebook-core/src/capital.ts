import { isActive, paramsAt, readingAt, sum, type Dataset } from "./dataset";
import type { LivingCostResult } from "./livingCost";
import type { Account, AccountParams, AccountType } from "./types";

export interface AccountBalance {
  account: Account;
  params: AccountParams;
  balance: number;
}

export interface CapitalSummary {
  balances: AccountBalance[];
  /** All active accounts, liabilities negative. */
  netWorth: number;
  netWorthByType: Record<AccountType, number>;
  /** Investable accounts before the emergency buffer. */
  investableGross: number;
  emergencyBuffer: number | null;
  /** Investable capital after the buffer, never below zero. Null when the living cost is unknown. */
  investable: number | null;
  /** Checking and deposit balances. */
  liquidity: number;
  /** Brokerage and external investments that are investable, minus any buffer not covered by liquidity. */
  riskyCapital: number | null;
  /** Net annual passive income of the investable accounts. */
  passiveNetAnnual: number;
  /** Net annual passive income from deposits and rentals only. */
  safeFlowsNetAnnual: number;
  /** Balance-weighted expected real return of the investable accounts. */
  portfolioReturn: number;
}

/** Declared yield of an account: interest rate for cash accounts, passive yield otherwise. */
function yieldOf(item: AccountBalance): number {
  const { type } = item.account;
  if (type === "checking" || type === "deposit") {
    return item.params.interestRate ?? item.params.passiveYield ?? 0;
  }
  return item.params.passiveYield ?? 0;
}

export function balancesAt(ds: Dataset): AccountBalance[] {
  const result: AccountBalance[] = [];
  for (const account of ds.accounts) {
    if (!isActive(account, ds.asOf)) continue;
    const reading = readingAt(ds, account.id, ds.asOf);
    if (!reading) continue;
    result.push({ account, params: paramsAt(account, ds.asOf), balance: reading.balance });
  }
  return result;
}

export function computeCapital(ds: Dataset, livingCost: LivingCostResult): CapitalSummary {
  const balances = balancesAt(ds);
  const netWorthByType: Record<AccountType, number> = {
    checking: 0,
    deposit: 0,
    brokerage: 0,
    external_investment: 0,
    real_estate: 0,
    liability: 0,
  };
  for (const item of balances) netWorthByType[item.account.type] += item.balance;

  const investable = balances.filter((b) => b.params.inInvestableCapital);
  const investableGross = sum(investable.map((b) => b.balance));
  const emergencyBuffer =
    livingCost.referenceMonthly === null
      ? null
      : ds.settings.emergencyBufferMonths * livingCost.referenceMonthly;

  const liquid = (b: AccountBalance) =>
    b.account.type === "checking" || b.account.type === "deposit";
  const liquidity = sum(balances.filter(liquid).map((b) => b.balance));

  // The buffer is taken from liquidity first; any excess reduces the risky capital.
  const liquidInvestable = sum(investable.filter(liquid).map((b) => b.balance));
  const riskyBalances = sum(
    investable
      .filter((b) => b.account.type === "brokerage" || b.account.type === "external_investment")
      .map((b) => b.balance),
  );
  const riskyCapital =
    emergencyBuffer === null
      ? null
      : Math.max(0, riskyBalances - Math.max(0, emergencyBuffer - Math.max(0, liquidInvestable)));

  const passive = (b: AccountBalance) =>
    b.account.type === "liability"
      ? 0
      : Math.max(0, b.balance) * yieldOf(b) * (1 - b.params.taxRate);
  const isSafeFlow = (b: AccountBalance) => liquid(b) || b.account.type === "real_estate";

  const positive = investable.filter((b) => b.balance > 0 && b.account.type !== "liability");
  const weight = sum(positive.map((b) => b.balance));
  const portfolioReturn =
    weight > 0 ? sum(positive.map((b) => b.balance * (b.params.expectedReturn ?? 0))) / weight : 0;

  return {
    balances,
    netWorth: sum(balances.map((b) => b.balance)),
    netWorthByType,
    investableGross,
    emergencyBuffer,
    investable: emergencyBuffer === null ? null : Math.max(0, investableGross - emergencyBuffer),
    liquidity,
    riskyCapital,
    passiveNetAnnual: sum(investable.map(passive)),
    safeFlowsNetAnnual: sum(investable.filter(isSafeFlow).map(passive)),
    portfolioReturn,
  };
}
