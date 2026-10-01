import type { AccountType } from "@lifebook/finanze-core";
import { fractionToPercentInput, parseDecimal, percentToFraction, toInputNumber } from "./format";

/** Form state for the dated parameters of an account. Percent fields are typed as percentages. */
export interface ParamsForm {
  validFrom: string;
  isSpendingAccount: boolean;
  isIncomeAccount: boolean;
  inInvestableCapital: boolean;
  expectedReturn: string;
  passiveYield: string;
  taxRate: string;
  interestRate: string;
  propertyValue: string;
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
    isIncomeAccount: false,
    inInvestableCapital: defaultInvestable(type, realEstateUse),
    expectedReturn: "",
    passiveYield: "",
    taxRate: "",
    interestRate: "",
    propertyValue: "",
    monthlyPayment: "",
    paymentEndDate: "",
  };
}

/** Account types the income can be paid into. */
export const takesIncome = (type: AccountType) => type !== "liability" && type !== "real_estate";

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
  if (typeof entry.isIncomeAccount === "boolean") form.isIncomeAccount = entry.isIncomeAccount;
  if (typeof entry.inInvestableCapital === "boolean")
    form.inInvestableCapital = entry.inInvestableCapital;
  for (const key of PERCENT_FIELDS)
    if (typeof entry[key] === "number") form[key] = fractionToPercentInput(entry[key] as number);
  if (typeof entry.monthlyPayment === "number")
    form.monthlyPayment = toInputNumber(entry.monthlyPayment);
  if (typeof entry.propertyValue === "number")
    form.propertyValue = toInputNumber(entry.propertyValue);
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
  if (takesIncome(type)) entry.isIncomeAccount = form.isIncomeAccount;
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
  if (type === "real_estate" && form.propertyValue.trim() !== "") {
    const value = parseDecimal(form.propertyValue);
    if (value === null || value < 0) errors.propertyValue = "Importo non valido";
    else entry.propertyValue = value;
  }
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
  if (typeof entry.isIncomeAccount === "boolean")
    parts.push(entry.isIncomeAccount ? "riceve le entrate" : "non riceve le entrate");
  if (typeof entry.inInvestableCapital === "boolean")
    parts.push(
      entry.inInvestableCapital ? "nel capitale investibile" : "fuori dal capitale investibile",
    );
  pct("expectedReturn", "rendimento atteso");
  pct("passiveYield", "rendita passiva");
  pct("taxRate", "tassazione");
  pct("interestRate", "tasso");
  if (typeof entry.propertyValue === "number")
    parts.push(`valore dell'immobile ${toInputNumber(entry.propertyValue)} €`);
  if (typeof entry.monthlyPayment === "number")
    parts.push(`rata ${toInputNumber(entry.monthlyPayment)} €`);
  if (typeof entry.paymentEndDate === "string") parts.push(`ultima rata ${entry.paymentEndDate}`);
  return parts;
}
