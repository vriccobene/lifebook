import { useGet } from "./hooks";
import type { Account, Contribution, Snapshot, Transfer } from "./types";

export const useAccounts = () => useGet<Account[]>("/accounts");
export const useSnapshots = () => useGet<Snapshot[]>("/snapshots");
export const useContributions = () => useGet<Contribution[]>("/contributions");
export const useTransfers = () => useGet<Transfer[]>("/transfers");

/** Resolves account ids to names for warnings and tables. */
export function accountNamer(accounts: readonly Account[] | undefined): (id: string) => string {
  const names = new Map((accounts ?? []).map((a) => [a.id, a.name]));
  return (id) => names.get(id) ?? "conto sconosciuto";
}
