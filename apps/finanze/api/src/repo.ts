import type {
  Account,
  AccountParamsEntry,
  BalanceSnapshot,
  Contribution,
  EssentialSpendingEntry,
  IncomeItem,
  LifebookData,
  Transfer,
  SettingsEntry,
} from "@lifebook/finanze-core";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "./db/client";
import * as t from "./db/schema";
import { notFound } from "./errors";
import { centsToEuros, eurosToCents } from "./money";

type Row<T extends { $inferSelect: unknown }> = T["$inferSelect"];

/* Patches are stored as JSON with money in cents and read back in euro. */

export function accountPatchToJson(patch: Record<string, unknown>): string {
  const stored = { ...patch };
  for (const key of ["monthlyPayment", "propertyValue"] as const)
    if (typeof stored[key] === "number") stored[key] = eurosToCents(stored[key]);
  return JSON.stringify(stored);
}

export function accountPatchFromJson(json: string): Record<string, unknown> {
  const patch = JSON.parse(json) as Record<string, unknown>;
  for (const key of ["monthlyPayment", "propertyValue"])
    if (typeof patch[key] === "number") patch[key] = centsToEuros(patch[key]);
  return patch;
}

export function settingsPatchToJson(patch: Record<string, unknown>): string {
  const stored = structuredClone(patch) as { publicPension?: { netMonthlyAmount?: number } };
  if (stored.publicPension && typeof stored.publicPension.netMonthlyAmount === "number") {
    stored.publicPension.netMonthlyAmount = eurosToCents(stored.publicPension.netMonthlyAmount);
  }
  return JSON.stringify(stored);
}

export function settingsPatchFromJson(json: string): Record<string, unknown> {
  const patch = JSON.parse(json) as { publicPension?: { netMonthlyAmount?: number } };
  if (patch.publicPension && typeof patch.publicPension.netMonthlyAmount === "number") {
    patch.publicPension.netMonthlyAmount = centsToEuros(patch.publicPension.netMonthlyAmount);
  }
  return patch as Record<string, unknown>;
}

export function paramsEntry(row: Row<typeof t.accountParams>) {
  return { id: row.id, validFrom: row.validFrom, ...accountPatchFromJson(row.patch) };
}

export function accountToApi(row: Row<typeof t.accounts>, params: Row<typeof t.accountParams>[]) {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    institution: row.institution,
    type: row.type,
    realEstateUse: row.realEstateUse,
    contributionsMode: row.contributionsMode,
    countsAsLivingCost: row.countsAsLivingCost,
    archivedAt: row.archivedAt,
    params: params.map(paramsEntry),
  };
}

export function snapshotToApi(row: Row<typeof t.snapshots>) {
  return {
    id: row.id,
    accountId: row.accountId,
    date: row.date,
    balance: centsToEuros(row.balanceCents),
    source: row.source,
  };
}

export function contributionToApi(row: Row<typeof t.contributions>) {
  return {
    id: row.id,
    accountId: row.accountId,
    date: row.date,
    amount: centsToEuros(row.amountCents),
  };
}

export function incomeToApi(row: Row<typeof t.incomeItems>) {
  const base = { id: row.id, name: row.name, amount: centsToEuros(row.amountCents) };
  if (row.kind === "one_off") return { ...base, kind: "one_off" as const, date: row.date! };
  return {
    ...base,
    kind: "recurring" as const,
    periodicity: row.periodicity!,
    startDate: row.startDate!,
    endDate: row.endDate,
  };
}

export function essentialToApi(row: Row<typeof t.essentialSpending>) {
  if (row.mode === "month_amount") {
    return { id: row.id, mode: row.mode, value: centsToEuros(row.value), month: row.month! };
  }
  const value = row.mode === "amount" ? centsToEuros(row.value) : row.value;
  return { id: row.id, mode: row.mode, value, validFrom: row.validFrom! };
}

export function settingsEntryToApi(row: Row<typeof t.settingsEntries>) {
  return { id: row.id, validFrom: row.validFrom, ...settingsPatchFromJson(row.patch) };
}

/** Returns the account if it belongs to the user, otherwise throws 404. */
export function requireAccount(db: Db, userId: string, accountId: string): Row<typeof t.accounts> {
  const row = db
    .select()
    .from(t.accounts)
    .where(and(eq(t.accounts.id, accountId), eq(t.accounts.ownerId, userId)))
    .get();
  if (!row) throw notFound("Account");
  return row;
}

/** Everything the user entered, in the shape finanze-core expects. */
export function loadLifebookData(db: Db, userId: string): LifebookData {
  const accountRows = db.select().from(t.accounts).where(eq(t.accounts.ownerId, userId)).all();
  const ids = accountRows.map((a) => a.id);
  const paramRows = ids.length
    ? db.select().from(t.accountParams).where(inArray(t.accountParams.accountId, ids)).all()
    : [];
  const snapshotRows = ids.length
    ? db.select().from(t.snapshots).where(inArray(t.snapshots.accountId, ids)).all()
    : [];
  const contributionRows = ids.length
    ? db.select().from(t.contributions).where(inArray(t.contributions.accountId, ids)).all()
    : [];

  const accounts: Account[] = accountRows.map((row) => ({
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    institution: row.institution,
    type: row.type,
    realEstateUse: row.realEstateUse,
    contributionsMode: row.contributionsMode,
    countsAsLivingCost: row.countsAsLivingCost,
    archivedAt: row.archivedAt,
    params: paramRows
      .filter((p) => p.accountId === row.id)
      .map(
        (p) => ({ validFrom: p.validFrom, ...accountPatchFromJson(p.patch) }) as AccountParamsEntry,
      ),
  }));
  const snapshots: BalanceSnapshot[] = snapshotRows.map((s) => ({
    accountId: s.accountId,
    date: s.date,
    balance: centsToEuros(s.balanceCents),
    source: s.source,
  }));
  const contributions: Contribution[] = contributionRows.map((c) => ({
    accountId: c.accountId,
    date: c.date,
    amount: centsToEuros(c.amountCents),
  }));
  const transfers: Transfer[] = db
    .select()
    .from(t.transfers)
    .where(eq(t.transfers.userId, userId))
    .all()
    .map((row) => ({
      date: row.date,
      amount: centsToEuros(row.amountCents),
      fromAccountId: row.fromAccountId,
      toAccountId: row.toAccountId,
    }));
  const incomeItems: IncomeItem[] = db
    .select()
    .from(t.incomeItems)
    .where(eq(t.incomeItems.ownerId, userId))
    .all()
    .map(incomeToApi);
  const essentialSpending = db
    .select()
    .from(t.essentialSpending)
    .where(eq(t.essentialSpending.ownerId, userId))
    .all()
    .map(essentialToApi)
    .map(({ id: _id, ...entry }) => entry as EssentialSpendingEntry);
  const settings = db
    .select()
    .from(t.settingsEntries)
    .where(eq(t.settingsEntries.ownerId, userId))
    .all()
    .map(
      ({ validFrom, patch }) => ({ validFrom, ...settingsPatchFromJson(patch) }) as SettingsEntry,
    );

  return {
    accounts,
    snapshots,
    contributions,
    transfers,
    incomeItems,
    essentialSpending,
    settings,
  };
}
