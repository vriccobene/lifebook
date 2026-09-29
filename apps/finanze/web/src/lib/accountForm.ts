import type { AccountType } from "@lifebook/finanze-core";
import { fractionToPercentInput, parseDecimal, percentToFraction, toInputNumber } from "./format";

/** Form state for the dated parameters of an account. Percent fields are typed as percentages. */
export interface ParamsForm {
  validFrom: string;
  isSpendingAccount: boolean;
  inInvestableCapital: boolean;
  expectedReturn: string;
  passiveYield: string;
  taxRate: string;
  interestRate: string;
  monthlyPayment: string;
  paymentEndDate: string;
}

export const defaultInvestable = (type: AccountType, realEstateUse: string | null): boolean =>
  type !== "liability" &&
  type !== "pension_fund" &&
  !(type === "real_estate" && realEstateUse !== "income");

export function emptyParamsForm(
  type: AccountType,
  realEstateUse: string | null,
  validFrom: string,
): ParamsForm {
  return {
    validFrom,
    isSpendingAccount: false,
    inInvestableCapital: defaultInvestable(type, realEstateUse),
    expectedReturn: "",
    passiveYield: "",
    taxRate: "",
    interestRate: "",
    monthlyPayment: "",
    paymentEndDate: "",
  };
}

const PERCENT_FIELDS = ["expectedReturn", "passiveYield", "taxRate", "interestRate"] as const;

/** A saved entry back into the form, to edit it. Fields the entry does not set stay empty. */
export function entryToParamsForm(
  saved: { validFrom: string },
  type: AccountType,
  realEstateUse: string | null,
): ParamsForm {
  const entry = saved as Record<string, unknown>;
  const form = emptyParamsForm(type, realEstateUse, saved.validFrom);
  if (typeof entry.isSpendingAccount === "boolean")
    form.isSpendingAccount = entry.isSpendingAccount;
  if (typeof entry.inInvestableCapital === "boolean")
    form.inInvestableCapital = entry.inInvestableCapital;
  for (const key of PERCENT_FIELDS)
    if (typeof entry[key] === "number") form[key] = fractionToPercentInput(entry[key] as number);
  if (typeof entry.monthlyPayment === "number")
    form.monthlyPayment = toInputNumber(entry.monthlyPayment);
  if (typeof entry.paymentEndDate === "string") form.paymentEndDate = entry.paymentEndDate;
  return form;
}

/** The dated entry to send: only what the user filled in, so untouched parameters keep their earlier value. */
export function paramsFormToEntry(
  form: ParamsForm,
  type: AccountType,
): { entry: Record<string, unknown>; errors: Record<string, string> } {
  const entry: Record<string, unknown> = { validFrom: form.validFrom };
  const errors: Record<string, string> = {};
  if (type === "checking" || type === "deposit") entry.isSpendingAccount = form.isSpendingAccount;
  entry.inInvestableCapital = form.inInvestableCapital;
  for (const key of PERCENT_FIELDS) {
    if (form[key].trim() === "") continue;
    const value = percentToFraction(form[key]);
    if (value === null || (key !== "expectedReturn" && value < 0) || value > 1)
      errors[key] = "Percentuale non valida";
    else entry[key] = value;
  }
  if (form.monthlyPayment.trim() !== "") {
    const value = parseDecimal(form.monthlyPayment);
    if (value === null || value < 0) errors.monthlyPayment = "Importo non valido";
    else entry.monthlyPayment = value;
  }
  if (form.paymentEndDate.trim() !== "") entry.paymentEndDate = form.paymentEndDate;
  return { entry, errors };
}

export function entrySummary(entry: Record<string, unknown>): string[] {
  const parts: string[] = [];
  const pct = (key: string, label: string) => {
    if (typeof entry[key] === "number")
      parts.push(`${label} ${fractionToPercentInput(entry[key] as number)}%`);
  };
  if (typeof entry.isSpendingAccount === "boolean")
    parts.push(entry.isSpendingAccount ? "conto di spesa" : "non di spesa");
  if (typeof entry.inInvestableCapital === "boolean")
    parts.push(
      entry.inInvestableCapital ? "nel capitale investibile" : "fuori dal capitale investibile",
    );
  pct("expectedReturn", "rendimento atteso");
  pct("passiveYield", "rendita passiva");
  pct("taxRate", "tassazione");
  pct("interestRate", "tasso");
  if (typeof entry.monthlyPayment === "number")
    parts.push(`rata ${toInputNumber(entry.monthlyPayment)} €`);
  if (typeof entry.paymentEndDate === "string") parts.push(`ultima rata ${entry.paymentEndDate}`);
  return parts;
}

type DatedEntry = { id: string; validFrom: string; isSpendingAccount?: boolean };

/**
 * The flags in force at `date`, to prefill a new dated entry: the form sends both flags,
 * so starting from the defaults would silently reset them.
 */
export function flagsAt(
  entries: (DatedEntry & { inInvestableCapital?: boolean })[],
  type: AccountType,
  realEstateUse: string | null,
  date: string,
): { isSpendingAccount: boolean; inInvestableCapital: boolean } {
  const flags = {
    isSpendingAccount: false,
    inInvestableCapital: defaultInvestable(type, realEstateUse),
  };
  const applicable = entries
    .filter((e) => e.validFrom <= date)
    .sort((a, b) => (a.validFrom < b.validFrom ? -1 : a.validFrom > b.validFrom ? 1 : 0));
  for (const entry of applicable) {
    if (entry.isSpendingAccount !== undefined) flags.isSpendingAccount = entry.isSpendingAccount;
    if (entry.inInvestableCapital !== undefined)
      flags.inInvestableCapital = entry.inInvestableCapital;
  }
  return flags;
}

/** The first date the account has parameters for: "since always" for a flag. */
export function firstParamsDate(entries: DatedEntry[], fallback: string): string {
  return entries.reduce((min, e) => (e.validFrom < min ? e.validFrom : min), fallback);
}

/**
 * The writes that make the spending flag `value` from `from` onward: every later entry that
 * sets the flag is changed, and an entry at `from` is added when none exists.
 */
export function spendingFlagWrites(
  entries: DatedEntry[],
  from: string,
  value: boolean,
): { update: string[]; create: boolean } {
  return {
    update: entries
      .filter(
        (e) =>
          e.validFrom >= from &&
          (e.validFrom === from ||
            (e.isSpendingAccount !== undefined && e.isSpendingAccount !== value)),
      )
      .map((e) => e.id),
    create: !entries.some((e) => e.validFrom === from),
  };
}
