import type { IsoDate } from "./dates";
import type { Account, AccountParams } from "./types";

export function defaultAccountParams(
  account: Pick<Account, "type" | "realEstateUse">,
): AccountParams {
  // A pension fund is locked until retirement: out of the investable capital unless the user includes it.
  const investableByDefault =
    account.type !== "liability" &&
    account.type !== "pension_fund" &&
    !(account.type === "real_estate" && account.realEstateUse !== "income");
  return {
    isSpendingAccount: false,
    isIncomeAccount: false,
    inInvestableCapital: investableByDefault,
    expectedReturn: null,
    passiveYield: null,
    taxRate: 0,
    interestRate: null,
    propertyValue: null,
    monthlyPayment: null,
    paymentEndDate: null,
  };
}

/** Account parameters in force at `date`: defaults overlaid by every entry with `validFrom <= date`, oldest first. */
export function resolveAccountParams(account: Account, date: IsoDate): AccountParams {
  const params = defaultAccountParams(account);
  const applicable = account.params
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.validFrom <= date)
    .sort((a, b) =>
      a.entry.validFrom === b.entry.validFrom
        ? a.index - b.index
        : a.entry.validFrom < b.entry.validFrom
          ? -1
          : 1,
    );
  const target = params as unknown as Record<string, unknown>;
  for (const { entry } of applicable) {
    for (const [key, value] of Object.entries(entry)) {
      if (key !== "validFrom" && value !== undefined) target[key] = value;
    }
  }
  // The primary residence never counts as investable capital, whatever the flag says.
  if (account.type === "real_estate" && account.realEstateUse !== "income") {
    params.inInvestableCapital = false;
  }
  return params;
}

/**
 * How a transfer touches an account in the calculation:
 * - `declared`: the user records the contribution (titoli, investimenti esterni, fondi pensione, passività);
 * - `spending`: a spending account, its change is read from its balance;
 * - `inferred`: a deposit whose transfers are deduced from its balance;
 * - `none`: real estate, which has no transfers.
 */
export type ContributionRole = "declared" | "spending" | "inferred" | "none";

export function contributionRole(account: Account, date: IsoDate): ContributionRole {
  if (account.type === "real_estate") return "none";
  if (resolveAccountParams(account, date).isSpendingAccount) return "spending";
  if (account.type !== "liability" && account.contributionsMode === "inferred") return "inferred";
  return "declared";
}
