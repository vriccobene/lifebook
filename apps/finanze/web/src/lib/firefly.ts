import { addMonths, endOfMonth, monthOf } from "@lifebook/finanze-core";
import type { Account, FireflyAccount, FireflyImportWarning } from "../api/types";
import { formatDate, formatEuro } from "./format";
import { ACCOUNT_TYPE_LABELS } from "./labels";

/** Default import range: the twelve months up to the end of the last complete month (as the API does). */
export function defaultImportRange(today: string): { from: string; to: string } {
  const to = endOfMonth(monthOf(addMonths(`${monthOf(today)}-01`, -1)));
  return { from: addMonths(to, -12), to };
}

/** Value of the select that creates a new Lifebook account from the Firefly III one. */
export const CREATE_ACCOUNT = "__create__";

export interface LinkOption {
  value: string;
  label: string;
}

/**
 * Lifebook accounts a Firefly III account can be linked to: the open accounts not linked to another one,
 * plus the option to create a new account of the suggested type.
 */
export function linkOptions(
  firefly: FireflyAccount,
  all: readonly FireflyAccount[],
  accounts: readonly Account[],
): LinkOption[] {
  const takenElsewhere = new Set(
    all.filter((f) => f.id !== firefly.id && f.linkedAccountId).map((f) => f.linkedAccountId),
  );
  return [
    { value: "", label: "Non importare" },
    ...accounts
      .filter(
        (a) =>
          (a.archivedAt === null || a.id === firefly.linkedAccountId) && !takenElsewhere.has(a.id),
      )
      .map((a) => ({ value: a.id, label: `${a.name} (${ACCOUNT_TYPE_LABELS[a.type]})` })),
    {
      value: CREATE_ACCOUNT,
      label: `Crea «${firefly.name}» come ${ACCOUNT_TYPE_LABELS[firefly.suggestedType].toLowerCase()}`,
    },
  ];
}

export const isImportable = (account: FireflyAccount) =>
  account.currencyCode === null || account.currencyCode === "EUR";

/** The import warnings in Italian. */
export function warningText(warning: FireflyImportWarning, accountName: string): string {
  const name = `«${accountName}»`;
  switch (warning.code) {
    case "firefly_account_missing":
      return `${name}: il conto collegato non esiste più in Firefly III. Scollegalo o collegane un altro.`;
    case "currency_not_supported":
      return `${name}${warning.date ? ` al ${formatDate(warning.date)}` : ""}: il conto è in ${warning.detail}, Lifebook gestisce solo euro. Non è stato importato.`;
    case "manual_snapshot_differs":
      return `${name} al ${formatDate(warning.date)}: è rimasto il saldo inserito a mano, Firefly III indica ${formatEuro(Number(warning.detail), 2)}.`;
    case "transaction_currency_not_supported":
      return `${name} al ${formatDate(warning.date)}: il movimento «${warning.detail}» non è in euro ed è stato ignorato. Se già importato, conserva il valore precedente.`;
    default:
      return `${name}: ${warning.code}`;
  }
}
