import type { IsoDate } from "./dates";
import type { Account, AccountParams } from "./types";

export function defaultAccountParams(
  account: Pick<Account, "type" | "realEstateUse">,
): AccountParams {
  const investableByDefault =
    account.type !== "liability" &&
    !(account.type === "real_estate" && account.realEstateUse !== "income");
  return {
    isSpendingAccount: false,
    inInvestableCapital: investableByDefault,
    expectedReturn: null,
    passiveYield: null,
    taxRate: 0,
    interestRate: null,
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
