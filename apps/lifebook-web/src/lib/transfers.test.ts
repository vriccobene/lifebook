import { describe, expect, it } from "vitest";
import type { Account } from "../api/types";
import {
  accountRole,
  contributionAccounts,
  movementLabel,
  planTransfer,
  transferAccounts,
} from "./transfers";

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
const chk = account("chk", {
  type: "checking",
  params: [{ id: "p", validFrom: "2000-01-01", isSpendingAccount: true }],
});
const dep = account("dep", { type: "deposit", contributionsMode: "inferred" });
const etf = account("etf");
const fund = account("fund", { type: "external_investment" });
const home = account("home", { type: "real_estate", realEstateUse: "primary_residence" });
const mortgage = account("mortgage", { type: "liability" });
const date = "2026-09-24";

describe("account roles", () => {
  it("tells apart who records contributions and who is read from the balance", () => {
    expect(accountRole(chk, date)).toBe("spending");
    expect(accountRole(dep, date)).toBe("inferred");
    expect(accountRole(etf, date)).toBe("declared");
    expect(accountRole(home, date)).toBe("none");
    expect(accountRole(mortgage, date)).toBe("declared");
  });

  it("uses the spending flag in force on the date", () => {
    const later = account("chk2", {
      type: "checking",
      params: [{ id: "p", validFrom: "2026-06-01", isSpendingAccount: true }],
    });
    expect(accountRole(later, "2026-05-31")).toBe("declared");
    expect(accountRole(later, "2026-06-01")).toBe("spending");
  });

  it("lists the accounts for contributions and for transfers, leaving out archived ones", () => {
    const old = account("old", { archivedAt: "2026-01-01" });
    const all = [chk, dep, etf, fund, home, mortgage, old];
    expect(contributionAccounts(all, date).map((a) => a.id)).toEqual(["etf", "fund", "mortgage"]);
    expect(transferAccounts(all, date).map((a) => a.id)).toEqual([
      "chk",
      "dep",
      "etf",
      "fund",
      "mortgage",
    ]);
  });
});

describe("planning a transfer", () => {
  it("records a positive contribution when money goes from a spending account to a declared one", () => {
    const plan = planTransfer(chk, etf, 500, date);
    expect(plan.error).toBeNull();
    expect(plan.contributions).toEqual([{ accountId: "etf", date, amount: 500 }]);
    expect(plan.notes[0]).toMatch(/«chk» è un conto di spesa/);
  });

  it("records a withdrawal when money comes back to the spending account", () => {
    expect(planTransfer(etf, chk, 500, date).contributions).toEqual([
      { accountId: "etf", date, amount: -500 },
    ]);
  });

  it("records both sides between two declared accounts", () => {
    const plan = planTransfer(etf, fund, 300, date);
    expect(plan.contributions).toEqual([
      { accountId: "etf", date, amount: -300 },
      { accountId: "fund", date, amount: 300 },
    ]);
    expect(plan.notes).toEqual([]);
  });

  it("skips the side of a deposit, whose movements are deduced from its balance (regression: no double counting)", () => {
    const toDeposit = planTransfer(etf, dep, 200, date);
    expect(toDeposit.contributions).toEqual([{ accountId: "etf", date, amount: -200 }]);
    expect(toDeposit.notes[0]).toMatch(/dedotti dal saldo/);
    expect(planTransfer(dep, etf, 200, date).contributions).toEqual([
      { accountId: "etf", date, amount: 200 },
    ]);
  });

  it("has nothing to record when both accounts are read from their balances", () => {
    expect(planTransfer(chk, dep, 100, date).error).toMatch(/nulla da registrare/);
    expect(planTransfer(dep, chk, 100, date).contributions).toEqual([]);
  });

  it("records the repaid capital of a liability", () => {
    expect(planTransfer(chk, mortgage, 450, date).contributions).toEqual([
      { accountId: "mortgage", date, amount: 450 },
    ]);
  });

  it("rejects the same account, missing accounts and non positive amounts", () => {
    expect(planTransfer(etf, etf, 10, date).error).toMatch(/diversi/);
    expect(planTransfer(undefined, etf, 10, date).error).toMatch(/Scegli/);
    expect(planTransfer(etf, chk, 0, date).error).toMatch(/maggiore di zero/);
    expect(planTransfer(etf, chk, -5, date).error).toMatch(/maggiore di zero/);
    expect(planTransfer(etf, chk, null, date).error).toMatch(/maggiore di zero/);
  });
});

describe("movement labels", () => {
  it("names a contribution by its sign and account", () => {
    expect(movementLabel(etf, 10)).toBe("Versamento");
    expect(movementLabel(etf, -10)).toBe("Prelievo");
    expect(movementLabel(mortgage, 10)).toBe("Capitale rimborsato");
    expect(movementLabel(mortgage, -10)).toBe("Nuovo debito");
    expect(movementLabel(undefined, 10)).toBe("Versamento");
  });
});
