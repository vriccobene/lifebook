import {
  addMonths,
  contributionRole,
  endOfMonth,
  monthOf,
  type Account,
  type IsoDate,
} from "@lifebook/finanze-core";
import { eurosToCents } from "../money";
import { OWN_ACCOUNT_TYPES, type FireflyAccount, type FireflySplit } from "./client";

/*
 * What an import from Firefly III changes, computed without touching the database so the same plan serves
 * the preview and the import.
 *
 * - Balances: one snapshot per linked account at every month end in the range, read from Firefly III as of
 *   that day. Readings before the account existed in Firefly III are skipped, and a snapshot the user entered
 *   (manual or CSV) is never overwritten.
 * - Contributions: movements between two of the user's own Firefly III accounts (asset or liability), on the
 *   Lifebook accounts that take declared contributions, with the same sign rule as the Transfers screen.
 *   Imported entries carry `firefly:<journal id>`, so a new import of the same range updates them and removes
 *   the ones deleted in Firefly III, without duplicating anything.
 * - Transfers: every movement between two of the user's own Firefly III accounts with at least one linked
 *   side, whatever the Lifebook type of the accounts, kept as a record of the movement (from, to, amount).
 *   They carry the same `firefly:<journal id>` and follow edits and deletions in the same way.
 */

export const MAX_IMPORT_MONTHS = 120;
export const importedContributionId = (journalId: string) => `firefly:${journalId}`;

export interface ExistingSnapshot {
  id: string;
  accountId: string;
  date: IsoDate;
  balanceCents: number;
  source: "csv" | "manual" | "firefly";
}

export interface ExistingContribution {
  id: string;
  accountId: string;
  date: IsoDate;
  amountCents: number;
  externalId: string | null;
}

export interface ExistingTransfer {
  id: string;
  date: IsoDate;
  amountCents: number;
  fromAccountId: string | null;
  toAccountId: string | null;
  fromName: string;
  toName: string;
  description: string;
  externalId: string;
}

export interface PlanInput {
  from: IsoDate;
  to: IsoDate;
  /** Lifebook accounts, with their dated parameters. */
  accounts: Account[];
  links: { fireflyAccountId: string; accountId: string }[];
  /** Firefly III accounts as of each month end of the range. */
  balances: Map<IsoDate, FireflyAccount[]>;
  /** Transactions of each linked Firefly III account in the range. */
  splits: Map<string, FireflySplit[]>;
  /** Snapshots and contributions of the linked accounts in the range. */
  snapshots: ExistingSnapshot[];
  contributions: ExistingContribution[];
  /** The user's imported transfers in the range, plus those whose journal was fetched again. */
  transfers?: ExistingTransfer[];
  /** Linked accounts that already have a snapshot before `from`. */
  accountsWithEarlierHistory: Set<string>;
}

export interface Counts {
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
  /** Kept as the user entered them: a manual snapshot or an identical manual contribution. */
  kept: number;
}

export interface AccountReport {
  accountId: string;
  accountName: string;
  fireflyAccountId: string;
  fireflyAccountName: string | null;
  snapshots: Counts;
  contributions: Counts;
}

export type ImportWarningCode =
  | "firefly_account_missing"
  | "currency_not_supported"
  | "manual_snapshot_differs"
  | "transaction_currency_not_supported";

export interface ImportWarning {
  code: ImportWarningCode;
  accountId: string;
  date: IsoDate | null;
  detail: string | null;
}

export interface ImportPlan {
  dates: IsoDate[];
  createSnapshots: { accountId: string; date: IsoDate; balanceCents: number }[];
  updateSnapshots: { id: string; balanceCents: number }[];
  createContributions: {
    accountId: string;
    date: IsoDate;
    amountCents: number;
    externalId: string;
  }[];
  updateContributions: { id: string; date: IsoDate; amountCents: number }[];
  deleteContributions: string[];
  createTransfers: Omit<ExistingTransfer, "id">[];
  updateTransfers: ExistingTransfer[];
  deleteTransfers: string[];
  /** Transfers counts for the whole import (`kept` is always 0). */
  transfers: Counts;
  accounts: AccountReport[];
  warnings: ImportWarning[];
}

/** Month ends between two dates, both included. */
export function monthEnds(from: IsoDate, to: IsoDate): IsoDate[] {
  const dates: IsoDate[] = [];
  for (let first = `${monthOf(from)}-01`; ; first = addMonths(first, 1)) {
    const end = endOfMonth(monthOf(first));
    if (end > to) break;
    if (end >= from) dates.push(end);
  }
  return dates;
}

const counts = (): Counts => ({ created: 0, updated: 0, unchanged: 0, deleted: 0, kept: 0 });
const isOpen = (account: Account, date: IsoDate) =>
  account.archivedAt === null || date < account.archivedAt;

export function planImport(input: PlanInput): ImportPlan {
  const dates = monthEnds(input.from, input.to);
  const plan: ImportPlan = {
    dates,
    createSnapshots: [],
    updateSnapshots: [],
    createContributions: [],
    updateContributions: [],
    deleteContributions: [],
    createTransfers: [],
    updateTransfers: [],
    deleteTransfers: [],
    transfers: counts(),
    accounts: [],
    warnings: [],
  };
  const byId = new Map(input.accounts.map((a) => [a.id, a]));

  for (const link of input.links) {
    const account = byId.get(link.accountId);
    if (!account) continue;
    const warn = (
      code: ImportWarningCode,
      date: IsoDate | null = null,
      detail: string | null = null,
    ) => plan.warnings.push({ code, accountId: account.id, date, detail });
    const readings = dates.map(
      (date) =>
        [date, input.balances.get(date)?.find((f) => f.id === link.fireflyAccountId)] as const,
    );
    const firefly = readings.findLast(([, f]) => f)?.[1] ?? null;
    const report: AccountReport = {
      accountId: account.id,
      accountName: account.name,
      fireflyAccountId: link.fireflyAccountId,
      fireflyAccountName: firefly?.name ?? null,
      snapshots: counts(),
      contributions: counts(),
    };
    plan.accounts.push(report);
    if (!firefly) {
      warn("firefly_account_missing");
      continue;
    }
    if (firefly.currencyCode && firefly.currencyCode !== "EUR") {
      warn("currency_not_supported", null, firefly.currencyCode);
      continue;
    }

    // Balances
    let started = input.accountsWithEarlierHistory.has(account.id);
    for (const [date, reading] of readings) {
      if (!reading || !isOpen(account, date)) continue;
      if (reading.openingBalanceDate && date < reading.openingBalanceDate) continue;
      if (reading.currencyCode && reading.currencyCode !== "EUR") {
        warn("currency_not_supported", date, reading.currencyCode);
        continue;
      }
      // A known opening date establishes that a zero balance is real. Without it, retain
      // the conservative behaviour for accounts whose history has not started yet.
      if (!started && !reading.openingBalanceDate && reading.currentBalance === 0) continue;
      started = true;
      const euros =
        account.type === "liability" ? -Math.abs(reading.currentBalance) : reading.currentBalance;
      const balanceCents = eurosToCents(euros);
      const existing = input.snapshots.find((s) => s.accountId === account.id && s.date === date);
      if (!existing) {
        plan.createSnapshots.push({ accountId: account.id, date, balanceCents });
        report.snapshots.created++;
      } else if (existing.balanceCents === balanceCents) {
        report.snapshots.unchanged++;
      } else if (existing.source !== "firefly") {
        report.snapshots.kept++;
        warn("manual_snapshot_differs", date, String(balanceCents / 100));
      } else {
        plan.updateSnapshots.push({ id: existing.id, balanceCents });
        report.snapshots.updated++;
      }
    }

    // Contributions
    const wanted = new Map<string, { date: IsoDate; amountCents: number }>();
    const unsupported = new Set<string>();
    for (const split of input.splits.get(link.fireflyAccountId) ?? []) {
      if (split.date < input.from || split.date > input.to) continue;
      if (!OWN_ACCOUNT_TYPES.has(split.sourceType) || !OWN_ACCOUNT_TYPES.has(split.destinationType))
        continue;
      if (split.sourceId === split.destinationId) continue;
      const sign =
        split.destinationId === link.fireflyAccountId
          ? 1
          : split.sourceId === link.fireflyAccountId
            ? -1
            : 0;
      if (sign === 0 || !isOpen(account, split.date)) continue;
      if (contributionRole(account, split.date) !== "declared") continue;
      if (split.currencyCode && split.currencyCode !== "EUR") {
        warn("transaction_currency_not_supported", split.date, split.description);
        unsupported.add(importedContributionId(split.journalId));
        continue;
      }
      wanted.set(importedContributionId(split.journalId), {
        date: split.date,
        amountCents: sign * eurosToCents(split.amount),
      });
    }

    const own = input.contributions.filter((c) => c.accountId === account.id);
    const manual = own.filter((c) => c.externalId === null);
    const imported = new Map(
      own.filter((c) => c.externalId !== null).map((c) => [c.externalId!, c]),
    );
    for (const [externalId, entry] of wanted) {
      const existing = imported.get(externalId);
      imported.delete(externalId);
      if (existing) {
        if (existing.date === entry.date && existing.amountCents === entry.amountCents) {
          report.contributions.unchanged++;
        } else {
          plan.updateContributions.push({ id: existing.id, ...entry });
          report.contributions.updated++;
        }
        continue;
      }
      // Already entered by hand (e.g. from the Transfers screen): importing it would count it twice.
      const twin = manual.findIndex(
        (c) => c.date === entry.date && c.amountCents === entry.amountCents,
      );
      if (twin >= 0) {
        manual.splice(twin, 1);
        report.contributions.kept++;
        continue;
      }
      plan.createContributions.push({ accountId: account.id, externalId, ...entry });
      report.contributions.created++;
    }
    // Imported earlier, now gone from Firefly III (or no longer a contribution).
    for (const stale of imported.values()) {
      // An unsupported currency is not evidence that the movement was deleted.
      if (unsupported.has(stale.externalId!)) continue;
      plan.deleteContributions.push(stale.id);
      report.contributions.deleted++;
    }
  }
  planTransfers(input, plan);
  return plan;
}

const isOwnMovement = (split: FireflySplit) =>
  OWN_ACCOUNT_TYPES.has(split.sourceType) &&
  OWN_ACCOUNT_TYPES.has(split.destinationType) &&
  split.sourceId !== split.destinationId;

function planTransfers(input: PlanInput, plan: ImportPlan): void {
  const linked = new Map(
    input.links
      .filter((l) => input.accounts.some((a) => a.id === l.accountId))
      .map((l) => [l.fireflyAccountId, l.accountId]),
  );
  // A transfer between two linked accounts shows up in the transactions of both: keep it once.
  const wanted = new Map<string, Omit<ExistingTransfer, "id">>();
  const unsupported = new Set<string>();
  for (const [fireflyAccountId, splits] of input.splits) {
    const accountId = linked.get(fireflyAccountId);
    if (!accountId) continue;
    for (const split of splits) {
      if (split.date < input.from || split.date > input.to || !isOwnMovement(split)) continue;
      const externalId = importedContributionId(split.journalId);
      if (wanted.has(externalId)) continue;
      if (split.currencyCode && split.currencyCode !== "EUR") {
        unsupported.add(externalId);
        const duplicate = plan.warnings.some(
          (w) =>
            w.code === "transaction_currency_not_supported" &&
            w.date === split.date &&
            w.detail === split.description,
        );
        if (!duplicate)
          plan.warnings.push({
            code: "transaction_currency_not_supported",
            accountId,
            date: split.date,
            detail: split.description,
          });
        continue;
      }
      wanted.set(externalId, {
        date: split.date,
        amountCents: eurosToCents(split.amount),
        fromAccountId: linked.get(split.sourceId) ?? null,
        toAccountId: linked.get(split.destinationId) ?? null,
        fromName: split.sourceName,
        toName: split.destinationName,
        description: split.description,
        externalId,
      });
    }
  }

  const linkedAccounts = new Set(linked.values());
  const existing = new Map((input.transfers ?? []).map((t) => [t.externalId, t]));
  for (const [externalId, entry] of wanted) {
    const current = existing.get(externalId);
    existing.delete(externalId);
    if (!current) {
      plan.createTransfers.push(entry);
      plan.transfers.created++;
    } else if (
      (Object.keys(entry) as (keyof typeof entry)[]).every((k) => current[k] === entry[k])
    ) {
      plan.transfers.unchanged++;
    } else {
      plan.updateTransfers.push({ id: current.id, ...entry });
      plan.transfers.updated++;
    }
  }
  // Gone from Firefly III. Only where the import looked: in the range, on an account still linked.
  for (const stale of existing.values()) {
    // Match the contribution import: an unsupported currency is not a deleted movement.
    if (unsupported.has(stale.externalId)) continue;
    if (stale.date < input.from || stale.date > input.to) continue;
    if (
      !(stale.fromAccountId && linkedAccounts.has(stale.fromAccountId)) &&
      !(stale.toAccountId && linkedAccounts.has(stale.toAccountId))
    )
      continue;
    plan.deleteTransfers.push(stale.id);
    plan.transfers.deleted++;
  }
}
