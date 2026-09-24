import type { IsoDate } from "./dates";

/** Rates and factors are fractions (0.035 = 3.5%). */
export interface Settings {
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
  /** Moving-average window (months) used as the living-cost reference. */
  livingCostWindow: 3 | 6 | 12;
  /** Relative distance from the average above which a period is flagged. */
  spendingDeviationThreshold: number;
  /** Relative balance change of a declared account that requires contributions. */
  declaredBalanceChangeThreshold: number;
  /** Days without a reading after which an account is reported as stale. */
  staleAccountDays: number;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type SettingsEntry = { validFrom: IsoDate } & DeepPartial<Settings>;

export const DEFAULT_SETTINGS: Settings = {
  inflationRate: 0.02,
  safeWithdrawalRate: 0.035,
  emergencyBufferMonths: 6,
  leanFactor: 0.8,
  fatFactor: 1.3,
  currentAge: null,
  targetRetirementAge: null,
  endOfPlanAge: 90,
  publicPension: { enabled: false, startAge: 67, netMonthlyAmount: 0 },
  trafficLight: { greenAt: 1, yellowAt: 0.8 },
  verdict: { minGreenMethods: 3 },
  livingCostWindow: 12,
  spendingDeviationThreshold: 0.5,
  declaredBalanceChangeThreshold: 0.1,
  staleAccountDays: 45,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function merge(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (key === "validFrom" || value === undefined) continue;
    const current = target[key];
    if (isPlainObject(value) && isPlainObject(current)) {
      merge(current, value);
    } else {
      target[key] = value;
    }
  }
}

/** Settings in force at `date`: defaults overlaid by every entry with `validFrom <= date`, oldest first. */
export function resolveSettings(entries: readonly SettingsEntry[], date: IsoDate): Settings {
  // Plain data only: a JSON round trip is a deep copy without depending on runtime globals.
  const result = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Record<string, unknown>;
  const applicable = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.validFrom <= date)
    .sort((a, b) =>
      a.entry.validFrom === b.entry.validFrom
        ? a.index - b.index
        : a.entry.validFrom < b.entry.validFrom
          ? -1
          : 1,
    );
  for (const { entry } of applicable) merge(result, entry as unknown as Record<string, unknown>);
  return result as unknown as Settings;
}

/** Converts a nominal annual rate to a real one for a given inflation rate. */
export function toRealRate(nominal: number, inflation: number): number {
  return (1 + nominal) / (1 + inflation) - 1;
}
