import { describe, expect, it } from "vitest";
import type { Account, FireflyMovement } from "../api/types";
import { DEFAULT_ANNOTATION, groupMovements, movementsCsv, summarize } from "./analytics";
const movement = (
  type: string,
  amount: number,
  patch: Partial<FireflyMovement> = {},
): FireflyMovement => ({
  id: "1",
  externalId: "firefly:1",
  date: "2026-09-10",
  type,
  amount,
  fromAccountId: null,
  toAccountId: null,
  fromName: "Da",
  toName: "A",
  description: "Movimento",
  categoryName: "Casa",
  ...patch,
});
describe("analytics", () => {
  it("keeps transfers, opening balances and excluded rows out of income and spending", () => {
    const result = summarize([
      movement("deposit", 100),
      movement("withdrawal", 20),
      movement("transfer", 500),
      movement("opening balance", 1000),
      movement("withdrawal", 30, { annotation: { ...DEFAULT_ANNOTATION, included: false } }),
    ]);
    expect(result).toMatchObject({
      income: 100,
      spending: 20,
      transfers: 500,
      balance: 80,
      unclassified: 20,
    });
  });
  it("reports incomplete gross yield without assuming a tax rate", () => {
    expect(
      summarize([
        movement("deposit", 74, {
          annotation: { ...DEFAULT_ANNOTATION, isYield: true, grossAmount: 100 },
        }),
        movement("deposit", 20, { annotation: { ...DEFAULT_ANNOTATION, isYield: true } }),
      ]),
    ).toMatchObject({ yieldNet: 94, yieldGross: 100, unknownGross: 1 });
  });
  it("groups yields by month and category and does not add multi-tag groups to totals", () => {
    const rows = [
      movement("deposit", 0.1, {
        annotation: { ...DEFAULT_ANNOTATION, tags: ["a", "b"], isYield: true },
      }),
      movement("deposit", 0.2, { date: "2026-10-02" }),
    ];
    expect(summarize(rows).income).toBe(0.3);
    expect(groupMovements(rows, "month")).toHaveLength(2);
    expect(groupMovements(rows, "category")[0]?.yieldNet).toBe(0.3);
    expect(groupMovements(rows, "tag").map((g) => g.name)).toEqual(
      expect.arrayContaining(["a", "b", "Senza tag"]),
    );
  });
  it("separates salary, yields and other receipts without double counting and honors overrides", () => {
    const rows = [
      movement("deposit", 100, { categoryName: "Stipendio" }),
      movement("deposit", 20, { annotation: { ...DEFAULT_ANNOTATION, isYield: true } }),
      movement("deposit", 10),
      movement("deposit", 5, {
        categoryName: "Salary",
        annotation: { ...DEFAULT_ANNOTATION, incomeKind: "other" },
      }),
      movement("deposit", 50, {
        annotation: { ...DEFAULT_ANNOTATION, incomeKind: "salary", included: false },
      }),
      movement("transfer", 200),
    ];
    expect(summarize(rows)).toMatchObject({
      income: 135,
      salary: 100,
      yieldNet: 30,
      otherIncome: 5,
    });
    expect(groupMovements(rows, "month")[0]).toMatchObject({
      salary: 100,
      yieldNet: 30,
      otherIncome: 5,
    });
    expect(
      summarize([
        movement("deposit", 12, {
          annotation: { ...DEFAULT_ANNOTATION, isYield: true, incomeKind: "salary" },
        }),
      ]),
    ).toMatchObject({ salary: 12, yieldNet: 0, otherIncome: 0 });
  });
  it("counts unannotated non-salary receipts as yields (reported zero-yield regression)", () => {
    const rows = [
      movement("deposit", 107005, { categoryName: "Stipendio" }),
      movement("deposit", 22907.5, { annotation: { ...DEFAULT_ANNOTATION, incomeKind: null } }),
      movement("transfer", 5000),
      movement("deposit", 100, { annotation: { ...DEFAULT_ANNOTATION, included: false } }),
    ];
    expect(summarize(rows)).toMatchObject({
      income: 129912.5,
      salary: 107005,
      yieldNet: 22907.5,
      otherIncome: 0,
      unknownGross: 1,
    });
    expect(movementsCsv(rows)).toContain('"Rendita"');
  });
  it("taxes gross investment receipts using dated destination-account rates, preserving zero tax and capital transfers", () => {
    const accounts: Account[] = [
      {
        id: "directa",
        ownerId: "u",
        name: "Directa",
        type: "brokerage",
        institution: null,
        realEstateUse: null,
        contributionsMode: "declared",
        countsAsLivingCost: false,
        archivedAt: null,
        params: [
          { id: "p1", validFrom: "2000-01-01", taxRate: 0.26 },
          { id: "p2", validFrom: "2026-09-01", taxRate: 0.1 },
        ],
      },
      {
        id: "deposit",
        ownerId: "u",
        name: "Deposito",
        type: "deposit",
        institution: null,
        realEstateUse: null,
        contributionsMode: "inferred",
        countsAsLivingCost: false,
        archivedAt: null,
        params: [{ id: "p", validFrom: "2000-01-01", taxRate: 0 }],
      },
    ];
    const rows = [
      movement("deposit", 100, { toAccountId: "directa", date: "2026-08-10" }),
      movement("deposit", 100, { toAccountId: "directa" }),
      movement("deposit", 20, { toAccountId: "deposit" }),
      movement("deposit", 500, {
        toAccountId: "directa",
        annotation: { ...DEFAULT_ANNOTATION, included: false },
      }),
      movement("transfer", 1000, { fromAccountId: "directa" }),
    ];
    expect(summarize(rows, accounts)).toMatchObject({
      income: 184,
      yieldGross: 220,
      yieldNet: 184,
      unknownGross: 0,
      transfers: 1000,
    });
    expect(
      groupMovements(rows, "month", accounts).find((g) => g.name === "2026-08")?.yieldNet,
    ).toBe(74);
    expect(movementsCsv(rows, accounts)).toContain('"100";"74";"26";"26"');
  });
  it("escapes CSV quotes and spreadsheet formulas", () => {
    expect(movementsCsv([movement("deposit", 10, { description: '=HYPERLINK("x")' })])).toContain(
      '"\'=HYPERLINK(""x"")"',
    );
  });
});
