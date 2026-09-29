import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatEuro,
  formatMonth,
  formatPercent,
  formatYears,
  fractionToPercentInput,
  parseDecimal,
  percentToFraction,
  toInputNumber,
} from "./format";

describe("parseDecimal", () => {
  it("accepts the ways an Italian user types numbers", () => {
    expect(parseDecimal("1234,56")).toBe(1234.56);
    expect(parseDecimal("1.234,56")).toBe(1234.56);
    expect(parseDecimal("1234.56")).toBe(1234.56);
    expect(parseDecimal("  12 000,5 ")).toBe(12000.5);
    expect(parseDecimal("-500")).toBe(-500);
    expect(parseDecimal("0,5")).toBe(0.5);
    expect(parseDecimal(",5")).toBe(0.5);
  });

  it("rejects text and empty input instead of returning zero (regression)", () => {
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("   ")).toBeNull();
    expect(parseDecimal("abc")).toBeNull();
    expect(parseDecimal("12abc")).toBeNull();
    expect(parseDecimal("1,2,3")).toBeNull();
  });

  it("round-trips through the input format", () => {
    expect(toInputNumber(1234.5)).toBe("1234,5");
    expect(parseDecimal(toInputNumber(-0.25))).toBe(-0.25);
    expect(toInputNumber(null)).toBe("");
  });
});

describe("percentages", () => {
  it("converts typed percentages to fractions without float noise", () => {
    expect(percentToFraction("3,5")).toBe(0.035);
    expect(percentToFraction("26")).toBe(0.26);
    expect(percentToFraction("0,1")).toBe(0.001);
    expect(percentToFraction("x")).toBeNull();
    expect(fractionToPercentInput(0.035)).toBe("3,5");
    expect(fractionToPercentInput(0.8)).toBe("80");
    expect(fractionToPercentInput(null)).toBe("");
  });
});

describe("display formats", () => {
  it("formats euro with the Italian conventions", () => {
    expect(formatEuro(1234.5, 2).replace(/\s/g, " ")).toBe("1.234,50 €");
    expect(formatEuro(1234.4).replace(/\s/g, " ")).toBe("1.234 €");
    expect(formatEuro(null)).toBe("—");
  });

  it("formats percentages, dates, months and years", () => {
    expect(formatPercent(0.035)).toBe("3,5%");
    expect(formatPercent(null)).toBe("—");
    expect(formatDate("2026-09-30")).toBe("30/09/2026");
    expect(formatDate(null)).toBe("—");
    expect(formatMonth("2026-09-30")).toBe("set 2026");
    expect(formatMonth("2026-01")).toBe("gen 2026");
    expect(formatYears(12.34)).toBe("12,3 anni");
    expect(formatYears(0)).toBe("raggiunto");
    expect(formatYears(null)).toBe("non raggiungibile");
  });
});
