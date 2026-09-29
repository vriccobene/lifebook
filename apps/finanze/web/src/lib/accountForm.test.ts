import { describe, expect, it } from "vitest";
import {
  defaultInvestable,
  emptyParamsForm,
  entrySummary,
  entryToParamsForm,
  paramsFormToEntry,
} from "./accountForm";

describe("account parameters form", () => {
  it("round-trips a saved entry through the edit form", () => {
    const entry = {
      validFrom: "2026-01-01",
      inInvestableCapital: false,
      taxRate: 0.125,
      interestRate: 0.035,
      monthlyPayment: 450.5,
      paymentEndDate: "2040-12-31",
    };
    const form = entryToParamsForm(entry, "liability", null);
    expect(form).toMatchObject({ taxRate: "12,5", interestRate: "3,5", monthlyPayment: "450,5" });
    expect(paramsFormToEntry(form, "liability")).toEqual({ entry, errors: {} });
  });

  it("does not treat liabilities and the primary residence as investable by default", () => {
    expect(defaultInvestable("liability", null)).toBe(false);
    expect(defaultInvestable("real_estate", "primary_residence")).toBe(false);
    expect(defaultInvestable("real_estate", "income")).toBe(true);
    expect(defaultInvestable("brokerage", null)).toBe(true);
  });

  it("sends only what the user filled in, with percentages as fractions", () => {
    const form = {
      ...emptyParamsForm("brokerage", null, "2026-01-01"),
      taxRate: "26",
      passiveYield: "2,5",
    };
    const { entry, errors } = paramsFormToEntry(form, "brokerage");
    expect(errors).toEqual({});
    expect(entry).toEqual({
      validFrom: "2026-01-01",
      inInvestableCapital: true,
      taxRate: 0.26,
      passiveYield: 0.025,
    });
  });

  it("sends the spending-account flag only for cash accounts", () => {
    const form = { ...emptyParamsForm("checking", null, "2026-01-01"), isSpendingAccount: true };
    expect(paramsFormToEntry(form, "checking").entry.isSpendingAccount).toBe(true);
    expect(paramsFormToEntry(form, "brokerage").entry).not.toHaveProperty("isSpendingAccount");
  });

  it("allows a negative expected return but rejects invalid percentages", () => {
    const base = emptyParamsForm("brokerage", null, "2026-01-01");
    expect(
      paramsFormToEntry({ ...base, expectedReturn: "-2" }, "brokerage").entry.expectedReturn,
    ).toBe(-0.02);
    expect(paramsFormToEntry({ ...base, taxRate: "-1" }, "brokerage").errors.taxRate).toBeDefined();
    expect(
      paramsFormToEntry({ ...base, taxRate: "150" }, "brokerage").errors.taxRate,
    ).toBeDefined();
    expect(
      paramsFormToEntry({ ...base, taxRate: "abc" }, "brokerage").errors.taxRate,
    ).toBeDefined();
  });

  it("reads the liability fields", () => {
    const form = {
      ...emptyParamsForm("liability", null, "2026-01-01"),
      monthlyPayment: "450,5",
      paymentEndDate: "2040-01-31",
    };
    expect(paramsFormToEntry(form, "liability").entry).toMatchObject({
      monthlyPayment: 450.5,
      paymentEndDate: "2040-01-31",
      inInvestableCapital: false,
    });
  });

  it("summarises an entry in Italian", () => {
    expect(entrySummary({ isSpendingAccount: true, taxRate: 0.26 })).toEqual([
      "conto di spesa",
      "tassazione 26%",
    ]);
  });
});

describe("pension fund", () => {
  it("is not investable by default", () => {
    expect(defaultInvestable("pension_fund", null)).toBe(false);
    expect(emptyParamsForm("pension_fund", null, "2026-01-01").inInvestableCapital).toBe(false);
  });
});
