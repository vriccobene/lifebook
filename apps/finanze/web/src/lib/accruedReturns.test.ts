import { computeReturns, prepareDataset } from "@lifebook/finanze-core";
import { describe, expect, it } from "vitest";
import { account, contribution, emptyData, snap, spendingAccount } from "../../../core/src/testkit";
import type { FireflyMovement } from "../api/types";
import { accruedReturns } from "./accruedReturns";

function scenario() {
  const data = emptyData();
  data.accounts.push(
    account("directa", "brokerage", { name: "Directa", params: { taxRate: 0.26 } }),
    account("deposit", "deposit", { name: "Deposito", params: { taxRate: 0, interestRate: 0 } }),
    spendingAccount("cash"),
  );
  data.accounts[1]!.contributionsMode = "declared";
  data.snapshots.push(
    snap("directa", "2026-09-01", 10000),
    snap("directa", "2026-09-30", 12000),
    snap("deposit", "2026-09-01", 1000),
    snap("deposit", "2026-09-30", 1100),
  );
  data.contributions.push(contribution("directa", "2026-09-15", -3000));
  const returns = computeReturns(prepareDataset(data, "2026-09-30"));
  const accounts = data.accounts.map((a) => ({
    ...a,
    params: a.params.map((p, i) => ({ ...p, id: String(i) })),
  }));
  const movement: FireflyMovement = {
    id: "transfer",
    externalId: "firefly:1",
    date: "2026-09-15",
    type: "transfer",
    amount: 3000,
    fromAccountId: "directa",
    toAccountId: "cash",
    fromName: "Directa Firefly",
    toName: "Banca",
    description: "Prelievo",
    categoryName: null,
  };
  return { accounts, returns, movements: [movement] };
}
describe("accrued returns analytics", () => {
  it("uses balance gains without requiring a sale and does not treat a capital withdrawal as yield", () => {
    const { returns, accounts, movements } = scenario();
    const result = accruedReturns(
      returns,
      accounts,
      movements,
      { from: "2026-09-01", to: "2026-09-30" },
      "",
      [],
    );
    expect(result).toMatchObject({ gross: 5100, net: 3800, tax: 1300 });
    expect(result.rows.find((r) => r.account.id === "directa")).toMatchObject({
      gross: 5000,
      net: 3700,
    });
    expect(result.rows.find((r) => r.account.id === "deposit")).toMatchObject({
      gross: 100,
      net: 100,
      tax: 0,
    });
  });
  it("honors linked Firefly account names and exclusions, without applying exclusions to counterparties", () => {
    const { returns, accounts, movements } = scenario();
    const range = { from: "2026-09-01", to: "2026-09-30" };
    expect(accruedReturns(returns, accounts, movements, range, "Directa Firefly", []).gross).toBe(
      5000,
    );
    expect(accruedReturns(returns, accounts, movements, range, "", ["Directa Firefly"]).gross).toBe(
      100,
    );
    expect(accruedReturns(returns, accounts, movements, range, "", ["Banca"]).gross).toBe(5100);
    expect(
      accruedReturns(returns, accounts, movements, { from: "2026-10-01", to: "2026-10-31" }, "", [])
        .rows,
    ).toHaveLength(0);
  });
});
