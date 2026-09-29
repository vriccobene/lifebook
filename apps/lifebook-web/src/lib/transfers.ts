import {
  contributionRole,
  type Account as CoreAccount,
  type ContributionRole,
} from "@lifebook/core";
import type { Account } from "../api/types";

export type AccountRole = ContributionRole;

export function accountRole(account: Account, date: string): AccountRole {
  return contributionRole(account as unknown as CoreAccount, date);
}

const isOpen = (account: Account, date: string) =>
  account.archivedAt === null || account.archivedAt > date;

/** Accounts on which the user records contributions at that date. */
export function contributionAccounts(accounts: readonly Account[], date: string): Account[] {
  return accounts.filter((a) => isOpen(a, date) && accountRole(a, date) === "declared");
}

/** Accounts a transfer can start from or arrive at: everything except real estate. */
export function transferAccounts(accounts: readonly Account[], date: string): Account[] {
  return accounts.filter((a) => isOpen(a, date) && accountRole(a, date) !== "none");
}

export interface PlannedContribution {
  accountId: string;
  date: string;
  amount: number;
}

export interface TransferPlan {
  contributions: PlannedContribution[];
  /** Why a side needs no entry. */
  notes: string[];
  error: string | null;
}

/**
 * The contributions that record a transfer of `amount` euro from one account to another. Only accounts
 * with declared contributions get an entry (negative on the account the money leaves, positive on the one
 * it enters): the others are read from their balances, and an entry there would count the money twice.
 */
export function planTransfer(
  from: Account | undefined,
  to: Account | undefined,
  amount: number | null,
  date: string,
): TransferPlan {
  const fail = (error: string): TransferPlan => ({ contributions: [], notes: [], error });
  if (!from || !to) return fail("Scegli il conto di partenza e quello di arrivo.");
  if (from.id === to.id)
    return fail("Il conto di partenza e quello di arrivo devono essere diversi.");
  if (amount === null || amount <= 0) return fail("Inserisci un importo maggiore di zero.");

  const contributions: PlannedContribution[] = [];
  const notes: string[] = [];
  const side = (account: Account, sign: 1 | -1) => {
    const role = accountRole(account, date);
    if (role === "declared")
      contributions.push({ accountId: account.id, date, amount: sign * amount });
    else if (role === "spending") {
      notes.push(
        `«${account.name}» è un conto di spesa: il movimento si vede dal suo saldo, non serve inserirlo.`,
      );
    } else if (role === "inferred") {
      notes.push(`«${account.name}» ha i movimenti dedotti dal saldo: non serve inserirli.`);
    }
  };
  side(from, -1);
  side(to, 1);

  if (contributions.length === 0) {
    return {
      contributions,
      notes,
      error: "Non c'è nulla da registrare: entrambi i conti si deducono dai saldi.",
    };
  }
  return { contributions, notes, error: null };
}

/** Label of a recorded contribution, by the sign and the kind of account. */
export function movementLabel(account: Account | undefined, amount: number): string {
  if (account?.type === "liability") return amount >= 0 ? "Capitale rimborsato" : "Nuovo debito";
  return amount >= 0 ? "Versamento" : "Prelievo";
}
