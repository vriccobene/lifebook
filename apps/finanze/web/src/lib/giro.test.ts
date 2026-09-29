import { describe, expect, it } from "vitest";
import type { Account, Contribution, Snapshot } from "../api/types";
import { buildGiroRows, giroHint, initialInputs, planGiroSave } from "./giro";

const account = (id: string, overrides: Partial<Account> = {}): Account => ({
  id,
  ownerId: "o",
  name: id,
  institution: null,
  type: "brokerage",
  realEstateUse: null,
  contributionsMode: "declared",
  countsAsLivingCost: true,
  archivedAt: null,
  params: [],
  ...overrides,
});
const snap = (
  accountId: string,
  date: string,
  balance: number,
  id = `${accountId}-${date}`,
): Snapshot => ({
  id,
  accountId,
  date,
  balance,
  source: "manual",
});
const contribution = (
  accountId: string,
  date: string,
  amount: number,
  id = `c-${accountId}-${date}`,
): Contribution => ({
  id,
  accountId,
  date,
  amount,
});

const spending = account("chk", {
  type: "checking",
  params: [{ id: "p", validFrom: "2000-01-01", isSpendingAccount: true }],
});
const broker = account("bro");
const deposit = account("dep", { type: "deposit", contributionsMode: "inferred" });
const home = account("home", { type: "real_estate", realEstateUse: "primary_residence" });
const date = "2026-09-30";

describe("monthly round rows", () => {
  it("shows the previous balance, i.e. the latest reading before the date", () => {
    const rows = buildGiroRows(
      [broker],
      [
        snap("bro", "2026-07-31", 100),
        snap("bro", "2026-08-31", 120),
        snap("bro", "2026-10-31", 999),
      ],
      [],
      date,
    );
    expect(rows[0]!.previous?.balance).toBe(120);
    expect(rows[0]!.existing).toBeNull();
  });

  it("recognises a snapshot already saved on the date and keeps the previous one separate", () => {
    const rows = buildGiroRows(
      [broker],
      [snap("bro", "2026-08-31", 120), snap("bro", date, 130)],
      [],
      date,
    );
    expect(rows[0]!.existing?.balance).toBe(130);
    expect(rows[0]!.previous?.balance).toBe(120);
    expect(initialInputs(rows)["bro"]!.balance).toBe("130");
  });

  it("asks for contributions only on declared accounts that are not spending accounts (regression)", () => {
    const rows = buildGiroRows([spending, broker, deposit, home], [], [], date);
    const flags = Object.fromEntries(rows.map((r) => [r.account.id, r.showContribution]));
    expect(flags).toEqual({ chk: false, bro: true, dep: false, home: false });
  });

  it("leaves out archived accounts from their archive date", () => {
    const old = account("old", { archivedAt: "2026-06-30" });
    const later = account("later", { archivedAt: "2026-12-31" });
    const ids = buildGiroRows([old, later, broker], [], [], date).map((r) => r.account.id);
    expect(ids).toEqual(["later", "bro"]);
  });

  it("prefills the contributions already saved on the date (their sum)", () => {
    const rows = buildGiroRows(
      [broker],
      [],
      [contribution("bro", date, 100, "a"), contribution("bro", date, 50, "b")],
      date,
    );
    expect(initialInputs(rows)["bro"]!.contribution).toBe("150");
  });
});

describe("saving the round", () => {
  it("creates a snapshot per filled row and ignores empty rows", () => {
    const rows = buildGiroRows([spending, broker], [], [], date);
    const plan = planGiroSave(
      rows,
      { chk: { balance: "1.500,25", contribution: "" }, bro: { balance: "", contribution: "" } },
      date,
    );
    expect(plan.errors).toEqual({});
    expect(plan.operations).toEqual([
      { type: "create-snapshot", accountId: "chk", date, balance: 1500.25 },
    ]);
  });

  it("updates an existing snapshot only when the value changed", () => {
    const rows = buildGiroRows([broker], [snap("bro", date, 100, "s1")], [], date);
    expect(
      planGiroSave(rows, { bro: { balance: "100", contribution: "" } }, date).operations,
    ).toEqual([]);
    expect(
      planGiroSave(rows, { bro: { balance: "120,5", contribution: "" } }, date).operations,
    ).toEqual([{ type: "update-snapshot", id: "s1", balance: 120.5 }]);
  });

  it("creates a contribution dated on the round date", () => {
    const rows = buildGiroRows([broker], [], [], date);
    const plan = planGiroSave(rows, { bro: { balance: "1000", contribution: "-200" } }, date);
    expect(plan.operations).toContainEqual({
      type: "create-contribution",
      accountId: "bro",
      date,
      amount: -200,
    });
  });

  it("replaces existing contributions of the date when the amount changes, and does nothing when it does not", () => {
    const rows = buildGiroRows(
      [broker],
      [],
      [contribution("bro", date, 100, "c1"), contribution("bro", date, 50, "c2")],
      date,
    );
    expect(
      planGiroSave(rows, { bro: { balance: "", contribution: "150" } }, date).operations,
    ).toEqual([]);
    expect(
      planGiroSave(rows, { bro: { balance: "", contribution: "300" } }, date).operations,
    ).toEqual([
      { type: "delete-contribution", id: "c1" },
      { type: "delete-contribution", id: "c2" },
      { type: "create-contribution", accountId: "bro", date, amount: 300 },
    ]);
  });

  it("removes the contributions when the amount is set to zero", () => {
    const rows = buildGiroRows([broker], [], [contribution("bro", date, 100, "c1")], date);
    expect(
      planGiroSave(rows, { bro: { balance: "", contribution: "0" } }, date).operations,
    ).toEqual([{ type: "delete-contribution", id: "c1" }]);
  });

  it("never sends contributions for accounts that do not take them", () => {
    const rows = buildGiroRows([deposit, spending], [], [], date);
    const plan = planGiroSave(
      rows,
      { dep: { balance: "10", contribution: "5" }, chk: { balance: "20", contribution: "5" } },
      date,
    );
    expect(plan.operations.every((op) => op.type === "create-snapshot")).toBe(true);
  });

  it("reports invalid numbers per account without writing anything for them", () => {
    const rows = buildGiroRows([broker, spending], [], [], date);
    const plan = planGiroSave(
      rows,
      { bro: { balance: "abc", contribution: "" }, chk: { balance: "10", contribution: "" } },
      date,
    );
    expect(plan.errors).toEqual({ bro: "Saldo non valido" });
    expect(plan.operations).toEqual([
      { type: "create-snapshot", accountId: "chk", date, balance: 10 },
    ]);
  });
});

describe("hint about missing contributions", () => {
  const rows = buildGiroRows(
    [broker, deposit],
    [snap("bro", "2026-08-31", 1000), snap("dep", "2026-08-31", 1000)],
    [],
    date,
  );

  it("warns on a large change with no contribution entered (spec Section 5)", () => {
    expect(giroHint(rows[0]!, { balance: "1500", contribution: "" }, 0.1)).toMatch(/50%/);
  });

  it("stays quiet for small changes, entered contributions and accounts without contributions", () => {
    expect(giroHint(rows[0]!, { balance: "1050", contribution: "" }, 0.1)).toBeNull();
    expect(giroHint(rows[0]!, { balance: "1500", contribution: "400" }, 0.1)).toBeNull();
    expect(giroHint(rows[1]!, { balance: "1500", contribution: "" }, 0.1)).toBeNull();
    expect(giroHint(rows[0]!, { balance: "", contribution: "" }, 0.1)).toBeNull();
  });
});
