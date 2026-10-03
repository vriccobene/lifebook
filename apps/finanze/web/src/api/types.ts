import type {
  AccountType,
  EssentialSplit,
  LivingCostResult,
  MethodResult,
  ReturnsResult,
  Verdict,
  Warning,
} from "@lifebook/finanze-core";

export type {
  AccountType,
  EssentialSplit,
  LivingCostResult,
  MethodResult,
  ReturnsResult,
  Verdict,
  Warning,
};

export interface AccountParamsEntry {
  id: string;
  validFrom: string;
  isSpendingAccount?: boolean;
  isIncomeAccount?: boolean;
  inInvestableCapital?: boolean;
  expectedReturn?: number | null;
  passiveYield?: number | null;
  taxRate?: number;
  interestRate?: number | null;
  propertyValue?: number | null;
  monthlyPayment?: number | null;
  paymentEndDate?: string | null;
}

export interface Account {
  id: string;
  ownerId: string;
  name: string;
  institution: string | null;
  type: AccountType;
  realEstateUse: "primary_residence" | "income" | null;
  contributionsMode: "declared" | "inferred";
  countsAsLivingCost: boolean;
  archivedAt: string | null;
  params: AccountParamsEntry[];
}

export interface Snapshot {
  id: string;
  accountId: string;
  date: string;
  balance: number;
  source: "csv" | "manual" | "firefly";
}

export interface Contribution {
  id: string;
  accountId: string;
  date: string;
  amount: number;
}

/** A transfer imported from Firefly III. A side is null when its Firefly III account is not linked. */
export interface Transfer {
  id: string;
  date: string;
  amount: number;
  fromAccountId: string | null;
  toAccountId: string | null;
  fromName: string;
  toName: string;
  description: string;
}

export type IncomeItem = { id: string; name: string; amount: number } & (
  | { kind: "one_off"; date: string }
  | {
      kind: "recurring";
      periodicity: "monthly" | "quarterly" | "yearly";
      startDate: string;
      endDate: string | null;
    }
);

export type EssentialEntry = { id: string; value: number } & (
  | { mode: "percent"; validFrom: string }
  | { mode: "amount"; validFrom: string }
  | { mode: "month_amount"; month: string }
);

export interface SettingsValues {
  inflationRate: number;
  safeWithdrawalRate: number;
  emergencyBufferMonths: number;
  leanFactor: number;
  fatFactor: number;
  currentAge: number | null;
  targetRetirementAge: number | null;
  endOfPlanAge: number;
  publicPension: { enabled: boolean; startAge: number; netMonthlyAmount: number };
  trafficLight: { greenAt: number; yellowAt: number };
  verdict: { minGreenMethods: number };
  livingCostWindow: 3 | 6 | 12;
  spendingDeviationThreshold: number;
  declaredBalanceChangeThreshold: number;
  staleAccountDays: number;
}

export interface SettingsResponse {
  asOf: string;
  effective: SettingsValues;
  entries: ({ id: string; validFrom: string } & Partial<SettingsValues>)[];
}

export interface LivingCostPayload {
  asOf: string;
  livingCost: LivingCostResult;
  essentialSplit: EssentialSplit[];
}
export interface MethodsPayload {
  asOf: string;
  publicPensionEnabled: boolean;
  methods: MethodResult[];
  warnings: Warning[];
}
export interface VerdictPayload {
  asOf: string;
  publicPensionEnabled: boolean;
  verdict: Verdict;
}
export interface NetWorthPayload {
  asOf: string;
  netWorth: number;
  netWorthByType: Record<AccountType, number>;
  investableGross: number;
  emergencyBuffer: number | null;
  investable: number | null;
  liquidity: number;
  riskyCapital: number | null;
  passiveNetAnnual: number;
  safeFlowsNetAnnual: number;
  portfolioReturn: number;
  balances: { accountId: string; name: string; type: AccountType; balance: number }[];
}
export type ReturnsPayload = ReturnsResult;

export interface Series<T> {
  from: string;
  to: string;
  step: "month" | "round";
  points: T[];
}

export type UserRole = "admin" | "user";

export interface Me {
  userId: string;
  username: string;
  role: UserRole;
}

export interface UserInfo {
  id: string;
  username: string;
  role: UserRole;
  createdAt: string;
}

export interface FireflyConnection {
  configured: boolean;
  available: boolean;
  baseUrl: string | null;
  lastImportAt: string | null;
}

export interface FireflyAccount {
  id: string;
  name: string;
  kind: "asset" | "liability";
  role: string | null;
  currencyCode: string | null;
  balance: number;
  active: boolean;
  iban: string | null;
  linkedAccountId: string | null;
  suggestedType: AccountType;
}

export interface ImportCounts {
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
  kept: number;
}

export interface FireflyImportWarning {
  code: string;
  accountId: string;
  date: string | null;
  detail: string | null;
}

export interface FireflyImportResult {
  dryRun: boolean;
  from: string;
  to: string;
  dates: string[];
  movements: ImportCounts;
  transfers: ImportCounts;
  accounts: {
    accountId: string;
    accountName: string;
    fireflyAccountId: string;
    fireflyAccountName: string | null;
    snapshots: ImportCounts;
    contributions: ImportCounts;
  }[];
  warnings: FireflyImportWarning[];
}

export interface FireflyMovement {
  id: string;
  externalId: string;
  date: string;
  type: string;
  amount: number;
  fromAccountId: string | null;
  toAccountId: string | null;
  fromName: string;
  toName: string;
  description: string;
  categoryName: string | null;
}
