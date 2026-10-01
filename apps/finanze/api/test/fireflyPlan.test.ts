import { describe, expect, it } from "vitest";
import type { Account } from "@lifebook/finanze-core";
import type { FireflyAccount } from "../src/firefly/client";
import { planImport } from "../src/firefly/plan";

describe("Firefly III historical currencies", () => {
  it("checks each snapshot's currency, even if the latest currency is EUR", () => {
    const account: Account = {
      id: "local",
      ownerId: "owner",
      name: "Conto",
      institution: null,
      type: "checking",
      realEstateUse: null,
      contributionsMode: "declared",
      countsAsLivingCost: true,
      archivedAt: null,
      params: [],
    };
    const remote: FireflyAccount = {
      id: "1",
      name: "Conto",
      type: "asset",
      accountRole: null,
      liabilityType: null,
      currencyCode: "EUR",
      currentBalance: 100,
      active: true,
      openingBalanceDate: "2026-01-01",
      iban: null,
    };
    const plan = planImport({
      from: "2026-01-01",
      to: "2026-02-28",
      accounts: [account],
      links: [{ fireflyAccountId: "1", accountId: "local" }],
      balances: new Map([
        ["2026-01-31", [{ ...remote, currencyCode: "USD" }]],
        ["2026-02-28", [remote]],
      ]),
      splits: new Map(),
      snapshots: [],
      contributions: [],
      accountsWithEarlierHistory: new Set(),
    });
    expect(plan.createSnapshots).toEqual([
      { accountId: "local", date: "2026-02-28", balanceCents: 10_000 },
    ]);
    expect(plan.warnings).toContainEqual({
      code: "currency_not_supported",
      accountId: "local",
      date: "2026-01-31",
      detail: "USD",
    });
  });
});
