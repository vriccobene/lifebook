import { describe, expect, it } from "vitest";
import { defaultRoundDate, todayIso } from "./dates";
import { inRange, resolveRange } from "./range";

const custom = { from: "2025-01-01", to: "2025-06-30" };

describe("time range selector", () => {
  it("resolves the preset ranges from today", () => {
    expect(resolveRange("3m", "2026-09-24", null, custom)).toEqual({
      from: "2026-06-24",
      to: "2026-09-24",
    });
    expect(resolveRange("1y", "2026-09-24", null, custom)).toEqual({
      from: "2025-09-24",
      to: "2026-09-24",
    });
  });

  it("uses the oldest reading for 'all' and falls back to a year without data", () => {
    expect(resolveRange("all", "2026-09-24", "2024-03-31", custom).from).toBe("2024-03-31");
    expect(resolveRange("all", "2026-09-24", null, custom).from).toBe("2025-09-24");
  });

  it("uses the custom range, swapping it when it is inverted", () => {
    expect(resolveRange("custom", "2026-09-24", null, custom)).toEqual(custom);
    expect(
      resolveRange("custom", "2026-09-24", null, { from: "2025-06-30", to: "2025-01-01" }),
    ).toEqual(custom);
  });

  it("checks membership inclusively", () => {
    expect(inRange("2026-01-01", { from: "2026-01-01", to: "2026-01-31" })).toBe(true);
    expect(inRange("2026-01-31", { from: "2026-01-01", to: "2026-01-31" })).toBe(true);
    expect(inRange("2026-02-01", { from: "2026-01-01", to: "2026-01-31" })).toBe(false);
  });
});

describe("round date", () => {
  it("defaults to the end of the current month (spec Section 4)", () => {
    expect(defaultRoundDate("2026-09-24")).toBe("2026-09-30");
    expect(defaultRoundDate("2026-02-03")).toBe("2026-02-28");
    expect(defaultRoundDate("2028-02-03")).toBe("2028-02-29");
  });

  it("formats today in the local time zone", () => {
    expect(todayIso(new Date(2026, 8, 4, 23, 59))).toBe("2026-09-04");
  });
});
