import { describe, expect, it } from "vitest";
import type { SettingsValues } from "../api/types";
import { describeSettingsEntry, diffSettings, settingsToForm } from "./settingsForm";

const defaults: SettingsValues = {
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

describe("settings form", () => {
  it("shows percentages as percentages and rates as typed by the user", () => {
    const form = settingsToForm(defaults);
    expect(form.safeWithdrawalRate).toBe("3,5");
    expect(form.greenAt).toBe("100");
    expect(form.yellowAt).toBe("80");
    expect(form.pensionEnabled).toBe(false);
    expect(form.currentAge).toBe("");
  });

  it("produces an empty patch when nothing changed (no useless dated entries)", () => {
    expect(diffSettings(defaults, settingsToForm(defaults))).toEqual({ patch: {}, errors: {} });
  });

  it("sends only the fields that changed, converted back to fractions", () => {
    const form = {
      ...settingsToForm(defaults),
      safeWithdrawalRate: "4",
      emergencyBufferMonths: "9",
    };
    expect(diffSettings(defaults, form).patch).toEqual({
      safeWithdrawalRate: 0.04,
      emergencyBufferMonths: 9,
    });
  });

  it("builds nested patches for the public pension toggle (default off)", () => {
    const form = { ...settingsToForm(defaults), pensionEnabled: true, pensionAmount: "1.250,50" };
    expect(diffSettings(defaults, form).patch).toEqual({
      publicPension: { enabled: true, netMonthlyAmount: 1250.5 },
    });
    expect(
      diffSettings(
        { ...defaults, publicPension: { enabled: true, startAge: 67, netMonthlyAmount: 0 } },
        {
          ...settingsToForm(defaults),
          pensionEnabled: false,
        },
      ).patch,
    ).toEqual({ publicPension: { enabled: false } });
  });

  it("allows clearing an age (null) and setting it", () => {
    const withAge = { ...defaults, currentAge: 45 };
    expect(diffSettings(withAge, { ...settingsToForm(withAge), currentAge: "" }).patch).toEqual({
      currentAge: null,
    });
    expect(diffSettings(defaults, { ...settingsToForm(defaults), currentAge: "44" }).patch).toEqual(
      { currentAge: 44 },
    );
  });

  it("reports invalid values and does not include them in the patch", () => {
    const form = { ...settingsToForm(defaults), safeWithdrawalRate: "abc", endOfPlanAge: "" };
    const { patch, errors } = diffSettings(defaults, form);
    expect(errors).toEqual({
      safeWithdrawalRate: "Valore non valido",
      endOfPlanAge: "Valore non valido",
    });
    expect(patch).toEqual({});
  });

  it("accepts only 3, 6 or 12 for the moving-average window", () => {
    expect(
      diffSettings(defaults, { ...settingsToForm(defaults), livingCostWindow: "5" }).errors,
    ).toEqual({
      livingCostWindow: "Scegli 3, 6 o 12",
    });
    expect(
      diffSettings(defaults, { ...settingsToForm(defaults), livingCostWindow: "6" }).patch,
    ).toEqual({ livingCostWindow: 6 });
  });
});

describe("settings history text", () => {
  it("uses the labels of the form, never internal field names (regression)", () => {
    const lines = describeSettingsEntry({
      safeWithdrawalRate: 0.04,
      currentAge: 42,
      publicPension: { enabled: true, netMonthlyAmount: 1100.5 },
    });
    expect(lines).toEqual([
      "Tasso di prelievo sicuro: 4%",
      "Età attuale: 42 anni",
      "Considera la pensione pubblica: sì",
      "Importo netto mensile: 1100,5 € al mese",
    ]);
    expect(lines.join(" ")).not.toMatch(/publicPension|safeWithdrawalRate|netMonthlyAmount/);
  });

  it("says when a value was cleared and describes the thresholds and the window", () => {
    expect(describeSettingsEntry({ currentAge: null })).toEqual(["Età attuale: non impostata"]);
    expect(
      describeSettingsEntry({ trafficLight: { greenAt: 1, yellowAt: 0.8 }, livingCostWindow: 6 }),
    ).toEqual(["Finestra del costo della vita: 6 mesi", "Verde da: 100%", "Giallo da: 80%"]);
  });
});
