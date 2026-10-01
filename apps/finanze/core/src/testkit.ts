import type { CapitalSummary } from "./capital";
import type { LifebookData } from "./dataset";
import { addDays, daysBetween, type IsoDate } from "./dates";
import { accruedInterest } from "./livingCost";
import type { MethodContext } from "./methods/types";
import { DEFAULT_SETTINGS, type DeepPartial, type Settings } from "./settings";
import type {
  Account,
  AccountParamsEntry,
  AccountType,
  BalanceSnapshot,
  Contribution,
  IncomeItem,
  Transfer,
} from "./types";

/** Builders for synthetic test data. Not part of the public API. */

export function account(
  id: string,
  type: AccountType,
  overrides: Partial<Omit<Account, "id" | "type" | "params">> & {
    params?: Partial<AccountParamsEntry>;
  } = {},
): Account {
  const { params, ...rest } = overrides;
  return {
    ownerId: "owner",
    name: id,
    institution: null,
    realEstateUse: null,
    contributionsMode: type === "deposit" ? "inferred" : "declared",
    countsAsLivingCost: true,
    archivedAt: null,
    ...rest,
    id,
    type,
    params: params ? [{ validFrom: "2000-01-01", ...params }] : [],
  };
}

export function spendingAccount(id = "chk"): Account {
  return account(id, "checking", { params: { isSpendingAccount: true } });
}

export function snap(accountId: string, date: IsoDate, balance: number): BalanceSnapshot {
  return { accountId, date, balance, source: "manual" };
}

/** A balance imported from Firefly III: the transfers around it are known. */
export function fireflySnap(accountId: string, date: IsoDate, balance: number): BalanceSnapshot {
  return { accountId, date, balance, source: "firefly" };
}

export function transfer(
  from: string | null,
  to: string | null,
  date: IsoDate,
  amount: number,
): Transfer {
  return { fromAccountId: from, toAccountId: to, date, amount };
}

export function contribution(accountId: string, date: IsoDate, amount: number): Contribution {
  return { accountId, date, amount };
}

export function salary(
  amount: number,
  startDate: IsoDate,
  endDate: IsoDate | null = null,
): IncomeItem {
  return {
    id: `salary-${startDate}`,
    name: "Salary",
    amount,
    kind: "recurring",
    periodicity: "monthly",
    startDate,
    endDate,
  };
}

export function emptyData(): LifebookData {
  return {
    accounts: [],
    snapshots: [],
    contributions: [],
    incomeItems: [],
    essentialSpending: [],
    settings: [],
  };
}

const MONTH_ENDS_2026 = [
  "2026-01-31",
  "2026-02-28",
  "2026-03-31",
  "2026-04-30",
  "2026-05-31",
  "2026-06-30",
  "2026-07-31",
  "2026-08-31",
  "2026-09-30",
  "2026-10-31",
  "2026-11-30",
  "2026-12-31",
];

export { MONTH_ENDS_2026 };

/**
 * A spending account with a salary paid on the last day of each month and a fixed monthly spending.
 * Readings start at 2025-12-31 so that 2026 has twelve complete periods.
 */
export function steadyLife(options: {
  months: number;
  salary?: number;
  monthlySpending?: number;
  opening?: number;
}): LifebookData {
  const pay = options.salary ?? 2000;
  const spend = options.monthlySpending ?? 1500;
  let balance = options.opening ?? 1000;
  const data = emptyData();
  data.accounts.push(spendingAccount());
  data.incomeItems.push(salary(pay, "2026-01-31"));
  data.snapshots.push(snap("chk", "2025-12-31", balance));
  for (const date of MONTH_ENDS_2026.slice(0, options.months)) {
    balance += pay - spend;
    data.snapshots.push(snap("chk", date, balance));
  }
  return data;
}

/** A method context with round numbers: 2000 €/month cost, 3000 €/month income, no capital. */
export function methodContext(
  options: {
    monthlyCost?: number | null;
    incomeMonthly?: number | null;
    capital?: Partial<CapitalSummary>;
    settings?: DeepPartial<Settings>;
    essentialMonthly?: number | null;
  } = {},
): MethodContext {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...(options.settings as Partial<Settings>),
    publicPension: { ...DEFAULT_SETTINGS.publicPension, ...options.settings?.publicPension },
    trafficLight: { ...DEFAULT_SETTINGS.trafficLight, ...options.settings?.trafficLight },
    verdict: { ...DEFAULT_SETTINGS.verdict, ...options.settings?.verdict },
  };
  const monthlyCost = options.monthlyCost === undefined ? 2000 : options.monthlyCost;
  const investable = options.capital?.investable ?? 0;
  const capital: CapitalSummary = {
    balances: [],
    netWorth: investable,
    netWorthByType: {
      checking: 0,
      deposit: 0,
      brokerage: 0,
      external_investment: 0,
      pension_fund: 0,
      real_estate: 0,
      liability: 0,
    },
    investableGross: investable,
    emergencyBuffer: 0,
    investable,
    liquidity: 0,
    riskyCapital: investable,
    passiveNetAnnual: 0,
    safeFlowsNetAnnual: 0,
    portfolioReturn: 0,
    ...options.capital,
  };
  const essentialMonthly = options.essentialMonthly ?? null;
  return {
    asOf: "2026-12-31",
    settings,
    livingCost: {
      asOf: "2026-12-31",
      periods: [],
      averages: { 3: monthlyCost, 6: monthlyCost, 12: monthlyCost },
      referenceWindow: 12,
      referenceMonthly: monthlyCost,
      incomeMonthly: options.incomeMonthly === undefined ? 3000 : options.incomeMonthly,
      regimeMonthly: monthlyCost,
      warnings: [],
    },
    capital,
    essential: {
      monthly: essentialMonthly,
      source: essentialMonthly === null ? null : "amount",
      month: "2026-12",
      exceedsLivingCost:
        essentialMonthly !== null && monthlyCost !== null && essentialMonthly > monthlyCost,
    },
  };
}

/**
 * Twelve months of 2026 for a complete synthetic life: 3000 salary, 2000 spending, a spending
 * account, a brokerage account (500k, declared), a deposit (200k at 3%, inferred, taxed 26%) and a
 * primary residence. No real data.
 */
export function richScenario(): LifebookData {
  const data = emptyData();
  data.accounts.push(
    spendingAccount(),
    account("bro", "brokerage", {
      params: { expectedReturn: 0.04, passiveYield: 0.02, taxRate: 0.26 },
    }),
    account("dep", "deposit", {
      params: { interestRate: 0.03, taxRate: 0.26, expectedReturn: 0.01 },
    }),
    account("home", "real_estate", { realEstateUse: "primary_residence" }),
  );
  data.incomeItems.push(salary(3000, "2026-01-31"));

  const dates = ["2025-12-31", ...MONTH_ENDS_2026];
  let chk = 20_000;
  let dep = 200_000;
  let bro = 500_000;
  dates.forEach((date, i) => {
    if (i > 0) {
      const days = daysBetween(dates[i - 1]!, date);
      dep += accruedInterest(dep, 0.03, days) * (1 - 0.26);
      bro += i % 2 === 0 ? 2_000 : -1_000; // market noise, no contributions
      chk += 3000 - 2000;
    }
    data.snapshots.push(
      snap("chk", date, chk),
      snap("dep", date, dep),
      snap("bro", date, bro),
      snap("home", date, 250_000),
    );
  });
  return data;
}

export function withPension(
  data: LifebookData,
  pension: { enabled: boolean; startAge?: number; netMonthlyAmount?: number },
  validFrom: IsoDate = "2000-01-01",
): LifebookData {
  return { ...data, settings: [...data.settings, { validFrom, publicPension: pension }] };
}

export function daysAfter(date: IsoDate, days: number): IsoDate {
  return addDays(date, days);
}
