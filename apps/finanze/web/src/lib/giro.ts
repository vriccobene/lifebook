import { resolveAccountParams, type Account as CoreAccount } from "@lifebook/finanze-core";
import type { Account, Contribution, Snapshot } from "../api/types";
import { parseDecimal } from "./format";

export interface GiroRow {
  account: Account;
  /** Latest snapshot before the round date. */
  previous: Snapshot | null;
  /** Snapshot already saved on the round date, if any. */
  existing: Snapshot | null;
  /** Contributions already saved on the round date. */
  existingContributions: Contribution[];
  /** Contributions are asked only for declared accounts that are not spending accounts. */
  showContribution: boolean;
}

export interface GiroInput {
  balance: string;
  contribution: string;
}

export type GiroOperation =
  | { type: "create-snapshot"; accountId: string; date: string; balance: number }
  | { type: "update-snapshot"; id: string; balance: number }
  | { type: "delete-contribution"; id: string }
  | { type: "create-contribution"; accountId: string; date: string; amount: number };

/** Accounts of the monthly round, with what is already known about each on that date. */
export function buildGiroRows(
  accounts: readonly Account[],
  snapshots: readonly Snapshot[],
  contributions: readonly Contribution[],
  date: string,
): GiroRow[] {
  return accounts
    .filter((account) => account.archivedAt === null || account.archivedAt > date)
    .map((account) => {
      const own = snapshots.filter((s) => s.accountId === account.id);
      const previous =
        own.filter((s) => s.date < date).sort((a, b) => (a.date < b.date ? 1 : -1))[0] ?? null;
      const params = resolveAccountParams(account as unknown as CoreAccount, date);
      return {
        account,
        previous,
        existing: own.find((s) => s.date === date) ?? null,
        existingContributions: contributions.filter(
          (c) => c.accountId === account.id && c.date === date,
        ),
        showContribution:
          account.contributionsMode === "declared" &&
          account.type !== "real_estate" &&
          !params.isSpendingAccount,
      };
    });
}

export function initialInputs(rows: readonly GiroRow[]): Record<string, GiroInput> {
  const inputs: Record<string, GiroInput> = {};
  for (const row of rows) {
    const contribution = row.existingContributions.reduce((total, c) => total + c.amount, 0);
    inputs[row.account.id] = {
      balance: row.existing ? String(row.existing.balance).replace(".", ",") : "",
      contribution:
        row.existingContributions.length > 0 ? String(contribution).replace(".", ",") : "",
    };
  }
  return inputs;
}

/** Warning before saving: a declared account moved a lot with no contribution entered. */
export function giroHint(row: GiroRow, input: GiroInput, threshold: number): string | null {
  if (!row.showContribution || !row.previous || row.previous.balance === 0) return null;
  const balance = parseDecimal(input.balance);
  if (balance === null || parseDecimal(input.contribution) !== null) return null;
  const change = (balance - row.previous.balance) / Math.abs(row.previous.balance);
  if (Math.abs(change) <= threshold) return null;
  return `Il saldo è variato del ${(change * 100).toLocaleString("it-IT", { maximumFractionDigits: 0 })}% senza contributi: se hai versato o prelevato, inseriscilo.`;
}

export interface GiroPlan {
  operations: GiroOperation[];
  errors: Record<string, string>;
}

/** What has to be written to save the round. Rows left empty are ignored; unchanged values produce nothing. */
export function planGiroSave(
  rows: readonly GiroRow[],
  inputs: Readonly<Record<string, GiroInput>>,
  date: string,
): GiroPlan {
  const operations: GiroOperation[] = [];
  const errors: Record<string, string> = {};
  for (const row of rows) {
    const input = inputs[row.account.id];
    if (!input) continue;
    const id = row.account.id;

    if (input.balance.trim() !== "") {
      const balance = parseDecimal(input.balance);
      if (balance === null) {
        errors[id] = "Saldo non valido";
        continue;
      }
      if (!row.existing) operations.push({ type: "create-snapshot", accountId: id, date, balance });
      else if (row.existing.balance !== balance) {
        operations.push({ type: "update-snapshot", id: row.existing.id, balance });
      }
    }

    if (row.showContribution && input.contribution.trim() !== "") {
      const amount = parseDecimal(input.contribution);
      if (amount === null) {
        errors[id] = "Contributo non valido";
        continue;
      }
      const current = row.existingContributions.reduce((total, c) => total + c.amount, 0);
      if (row.existingContributions.length === 0 ? amount !== 0 : current !== amount) {
        for (const c of row.existingContributions)
          operations.push({ type: "delete-contribution", id: c.id });
        if (amount !== 0)
          operations.push({ type: "create-contribution", accountId: id, date, amount });
      }
    }
  }
  return { operations, errors };
}
