import { describe, expect, it } from "vitest";
import { addDays, addMonths, daysBetween, endOfMonth, isIsoDate, monthOf } from "./dates";

describe("dates", () => {
  it("counts days across month and leap-year boundaries", () => {
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2);
    expect(daysBetween("2025-02-28", "2025-03-01")).toBe(1);
    expect(daysBetween("2026-03-01", "2026-02-01")).toBe(-28);
  });

  it("adds days", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("clamps the day when adding months (regression: Jan 31 + 1 month)", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
    expect(addMonths("2026-03-15", -3)).toBe("2025-12-15");
  });

  it("rejects impossible dates", () => {
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("26-01-01")).toBe(false);
    expect(isIsoDate("2026-02-28")).toBe(true);
  });

  it("finds month boundaries", () => {
    expect(monthOf("2026-07-19")).toBe("2026-07");
    expect(endOfMonth("2026-02")).toBe("2026-02-28");
    expect(endOfMonth("2028-02")).toBe("2028-02-29");
    expect(() => endOfMonth("2026-00")).toThrow();
  });
});
