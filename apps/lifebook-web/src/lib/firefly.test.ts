import { describe, expect, it } from "vitest";
import type { Account, FireflyAccount } from "../api/types";
import {
  CREATE_ACCOUNT,
  defaultImportRange,
  isImportable,
  linkOptions,
  warningText,
} from "./firefly";

const ff = (id: string, over: Partial<FireflyAccount> = {}): FireflyAccount => ({
  id,
  name: `FF ${id}`,
  kind: "asset",
  role: "defaultAsset",
  currencyCode: "EUR",
  balance: 0,
  active: true,
  iban: null,
  linkedAccountId: null,
  suggestedType: "checking",
  ...over,
});
const acc = (id: string, over: Partial<Account> = {}): Account => ({
  id,
  ownerId: "me",
  name: `Conto ${id}`,
  institution: null,
  type: "checking",
  realEstateUse: null,
  contributionsMode: "declared",
  countsAsLivingCost: true,
  archivedAt: null,
  params: [],
  ...over,
});

describe("Firefly III import helpers", () => {
  it("defaults to the twelve months up to the last complete month", () => {
    expect(defaultImportRange("2026-09-29")).toEqual({ from: "2025-08-31", to: "2026-08-31" });
    expect(defaultImportRange("2026-03-01")).toEqual({ from: "2025-02-28", to: "2026-02-28" });
  });

  it("offers the accounts not linked elsewhere, never archived ones, and a create option", () => {
    const all = [ff("1", { linkedAccountId: "a" }), ff("2", { linkedAccountId: "c" })];
    const accounts = [
      acc("a"),
      acc("b"),
      acc("c", { archivedAt: "2026-01-01" }),
      acc("d", { archivedAt: "2026-01-01" }),
    ];
    const options = linkOptions(all[1]!, all, accounts);
    expect(options.map((o) => o.value)).toEqual(["", "b", "c", CREATE_ACCOUNT]);
    expect(options.at(-1)!.label).toBe("Crea «FF 2» come conto corrente");
  });

  it("imports only euro accounts", () => {
    expect(isImportable(ff("1"))).toBe(true);
    expect(isImportable(ff("1", { currencyCode: null }))).toBe(true);
    expect(isImportable(ff("1", { currencyCode: "USD" }))).toBe(false);
  });

  it("explains every warning in Italian", () => {
    const w = (code: string, date: string | null = null, detail: string | null = null) =>
      warningText({ code, accountId: "a", date, detail }, "Titoli");
    expect(w("firefly_account_missing")).toMatch(/non esiste più in Firefly III/);
    expect(w("currency_not_supported", null, "USD")).toMatch(/è in USD/);
    expect(w("manual_snapshot_differs", "2026-01-31", "11800")).toMatch(
      /^«Titoli» al 31\/01\/2026: è rimasto il saldo inserito a mano, Firefly III indica 11\.800,00\s€\.$/,
    );
    expect(w("transaction_currency_not_supported", "2026-02-01", "Viaggio")).toMatch(
      /«Viaggio» non è in euro/,
    );
  });
});
