import type { Warning } from "@lifebook/core";
import { describe, expect, it } from "vitest";
import { METHOD_LABELS, missingReasons, warningMessage } from "./labels";

const name = (id: string) => ({ a1: "Titoli", c1: "Conto corrente" })[id] ?? "?";
const warn = (code: Warning["code"], extra: Partial<Warning> = {}): Warning => ({
  code,
  accountId: null,
  from: null,
  to: null,
  detail: null,
  ...extra,
});

describe("Italian texts", () => {
  it("has a label for each of the twelve methods", () => {
    expect(Object.keys(METHOD_LABELS)).toHaveLength(12);
  });

  it("explains missing data in words", () => {
    expect(missingReasons(["essential_spending"])).toBe("spesa essenziale non inserita");
    expect(missingReasons(["current_age", "target_retirement_age"])).toContain("età attuale");
    expect(missingReasons(["unknown_code"])).toBe("unknown_code");
  });

  it("covers every validation of Section 5", () => {
    expect(
      warningMessage(
        warn("negative_spending", { detail: -500, from: "2026-01-31", to: "2026-02-28" }),
        name,
      ),
    ).toMatch(/Spesa negativa.*31\/01\/2026/);
    expect(warningMessage(warn("spending_outlier", { detail: 4000 }), name)).toMatch(
      /molto diversa dalla media/,
    );
    expect(
      warningMessage(warn("spending_account_missing_reading", { accountId: "c1" }), name),
    ).toMatch(/«Conto corrente».*lettura/);
    expect(
      warningMessage(
        warn("declared_contributions_missing", { accountId: "a1", detail: 5000 }),
        name,
      ),
    ).toMatch(/«Titoli».*senza contributi/);
  });

  it("names the account and the age of a stale reading", () => {
    expect(warningMessage(warn("stale_account", { accountId: "a1", detail: 89 }), name)).toBe(
      "«Titoli» non viene aggiornato da 89 giorni: si usa l'ultimo saldo noto.",
    );
  });
});

describe("account types", () => {
  it("names the pension fund", async () => {
    const { ACCOUNT_TYPE_LABELS } = await import("./labels");
    expect(ACCOUNT_TYPE_LABELS.pension_fund).toBe("Fondo pensione");
  });
});
