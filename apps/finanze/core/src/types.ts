import type { IsoDate, IsoMonth } from "./dates";

export type AccountType =
  | "checking"
  | "deposit"
  | "brokerage"
  | "external_investment"
  | "pension_fund"
  | "real_estate"
  | "liability";

export type ContributionsMode = "declared" | "inferred";
export type RealEstateUse = "primary_residence" | "income";

/**
 * Account parameters that change over time. Rates are fractions (0.26 = 26%).
 * Each stored entry is a partial patch with a `validFrom`; see `resolveAccountParams`.
 */
export interface AccountParams {
  isSpendingAccount: boolean;
  /**
   * The account the income (salary and the other entries of Entrate) is paid into. On an account that is
   * not a spending account the income is neither a gain nor a transfer.
   */
  isIncomeAccount: boolean;
  inInvestableCapital: boolean;
  /** Real annual expected return, used for projections. */
  expectedReturn: number | null;
  /** Annual share of return received passively (interest, dividends, net rent). */
  passiveYield: number | null;
  taxRate: number;
  /** Declared annual interest rate, for deposits and liabilities. */
  interestRate: number | null;
  /**
   * Real estate only: the value of the property. When set, the account's balance is the property's cash
   * (the rent collected, e.g. a Firefly III account) and the value is added to it; the return is measured
   * on the value. Tracked over time with dated entries.
   */
  propertyValue: number | null;
  /** Liabilities only: monthly installment. */
  monthlyPayment: number | null;
  /** Liabilities only: date of the last installment. */
  paymentEndDate: IsoDate | null;
}

export type AccountParamsEntry = { validFrom: IsoDate } & Partial<AccountParams>;

export interface Account {
  id: string;
  ownerId: string;
  name: string;
  institution: string | null;
  type: AccountType;
  realEstateUse: RealEstateUse | null;
  contributionsMode: ContributionsMode;
  /** Liabilities only: whether the installment is part of the living cost. */
  countsAsLivingCost: boolean;
  archivedAt: IsoDate | null;
  params: AccountParamsEntry[];
}

export interface BalanceSnapshot {
  accountId: string;
  date: IsoDate;
  /** Liabilities are negative. */
  balance: number;
  source: "csv" | "manual" | "firefly";
}

/** Deposit (positive) or withdrawal (negative) towards a non-spending account. */
export interface Contribution {
  accountId: string;
  date: IsoDate;
  amount: number;
}

/**
 * A movement between two of the user's own accounts, known from Firefly III. A side is null when it is an
 * account Lifebook does not track (not linked): money that leaves or enters the tracked accounts without
 * being spent or earned.
 */
export interface Transfer {
  date: IsoDate;
  /** Always positive. */
  amount: number;
  fromAccountId: string | null;
  toAccountId: string | null;
}

export type Periodicity = "monthly" | "quarterly" | "yearly";

export type IncomeItem = { id: string; name: string; amount: number } & (
  | { kind: "one_off"; date: IsoDate }
  | {
      kind: "recurring";
      periodicity: Periodicity;
      startDate: IsoDate;
      endDate: IsoDate | null;
    }
);

export type EssentialSpendingEntry =
  | { mode: "percent" | "amount"; value: number; validFrom: IsoDate }
  | { mode: "month_amount"; value: number; month: IsoMonth };

export type WarningCode =
  | "negative_spending"
  | "spending_outlier"
  | "spending_account_missing_reading"
  | "declared_contributions_missing"
  | "account_no_opening_balance"
  | "stale_account"
  | "insufficient_history"
  | "no_spending_account"
  | "essential_exceeds_living_cost";

export interface Warning {
  code: WarningCode;
  accountId: string | null;
  from: IsoDate | null;
  to: IsoDate | null;
  /** Code-specific number (e.g. days stale, spending amount). */
  detail: number | null;
}
