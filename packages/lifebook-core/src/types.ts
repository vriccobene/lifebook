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
  inInvestableCapital: boolean;
  /** Real annual expected return, used for projections. */
  expectedReturn: number | null;
  /** Annual share of return received passively (interest, dividends, net rent). */
  passiveYield: number | null;
  taxRate: number;
  /** Declared annual interest rate, for deposits and liabilities. */
  interestRate: number | null;
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
  source: "csv" | "manual";
}

/** Deposit (positive) or withdrawal (negative) towards a non-spending account. */
export interface Contribution {
  accountId: string;
  date: IsoDate;
  amount: number;
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
