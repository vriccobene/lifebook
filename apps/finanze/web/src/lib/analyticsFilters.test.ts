import { expect, it } from "vitest";
import type { FireflyMovement } from "../api/types";
import { DEFAULT_ANNOTATION } from "./analytics";
import { filterMovements, defaultAnalyticsFilters } from "./analyticsFilters";

const movement: FireflyMovement = {
  id: "expense",
  externalId: "1",
  date: "2026-09-10",
  type: "withdrawal",
  amount: 30,
  fromAccountId: null,
  toAccountId: null,
  fromName: "Banca",
  toName: "Bar",
  description: "Pranzo",
  categoryName: "Ristoranti",
  annotation: { ...DEFAULT_ANNOTATION, tags: ["famiglia"], spendingClass: "essential" },
};
it("combines all analytics filters and excludes either side of a movement", () => {
  const filters = {
    ...defaultAnalyticsFilters("2026-09-01", "2026-09-30"),
    search: "PRANZO",
    category: "Ristoranti",
    tag: "famiglia",
    account: "Banca",
    type: "withdrawal",
    classification: "essential",
    inclusion: "included",
  };
  const rows = [
    movement,
    { ...movement, id: "old", date: "2026-08-31" },
    { ...movement, id: "other", categoryName: "Altro" },
    { ...movement, id: "excluded", annotation: { ...movement.annotation!, included: false } },
  ];
  expect(filterMovements(rows, filters).map((m) => m.id)).toEqual(["expense"]);
  expect(filterMovements(rows, { ...filters, excludedAccounts: ["Bar"] })).toEqual([]);
  expect(filterMovements(rows, { ...filters, excludedCategories: ["Ristoranti"] })).toEqual([]);
  expect(filterMovements(rows, { ...filters, yieldOnly: true })).toEqual([]);
});
it("keeps date boundaries inclusive and recognizes unannotated yield receipts", () => {
  const filters = { ...defaultAnalyticsFilters("2026-09-10", "2026-09-10"), yieldOnly: true };
  expect(
    filterMovements([movement, { ...movement, id: "yield", type: "deposit" }], filters).map(
      (m) => m.id,
    ),
  ).toEqual(["yield"]);
});
it("round trips accented filters and rejects malformed or invalid report ranges", async () => {
  const { analyticsHref, readAnalyticsFilters } = await import("./analyticsFilters");
  const filters = {
    ...defaultAnalyticsFilters("2026-01-01", "2026-02-28"),
    includedCategories: ["Caffè & tè", "Casa"],
    search: "a+b",
  };
  expect(readAnalyticsFilters(analyticsHref("/analytics/report", filters))).toEqual(filters);
  expect(readAnalyticsFilters("#/analytics/report?filters=bad")).toBeNull();
  expect(
    readAnalyticsFilters(analyticsHref("/analytics/report", { ...filters, from: "2026-02-30" })),
  ).toBeNull();
  expect(
    readAnalyticsFilters(analyticsHref("/analytics/report", { ...filters, from: "2027-01-01" })),
  ).toBeNull();
});
