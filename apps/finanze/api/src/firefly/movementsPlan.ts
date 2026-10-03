import type { PlanInput, Counts } from "./plan";
import { importedContributionId } from "./plan";
import { eurosToCents } from "../money";

export interface StoredMovement {
  id: string;
  externalId: string;
  date: string;
  type: string;
  amountCents: number;
  fromAccountId: string | null;
  toAccountId: string | null;
  fromName: string;
  toName: string;
  description: string;
  categoryName: string | null;
}

/** Plan the complete journal independently of the account's contribution mode. */
export function planMovements(input: PlanInput, existing: StoredMovement[]) {
  const linked = new Map(input.links.map((l) => [l.fireflyAccountId, l.accountId]));
  const wanted = new Map<string, Omit<StoredMovement, "id">>();
  const unsupported = new Set<string>();
  const incomplete = new Set<string>();
  for (const [remoteId, splits] of input.splits) {
    for (const s of splits) {
      if (s.date < input.from || s.date > input.to) continue;
      const externalId = importedContributionId(s.journalId);
      if (s.currencyCode && s.currencyCode !== "EUR") {
        unsupported.add(externalId);
        incomplete.add(linked.get(remoteId)!);
        continue;
      }
      wanted.set(externalId, {
        externalId,
        date: s.date,
        type: s.type,
        amountCents: eurosToCents(s.amount),
        fromAccountId: linked.get(s.sourceId) ?? null,
        toAccountId: linked.get(s.destinationId) ?? null,
        fromName: s.sourceName,
        toName: s.destinationName,
        description: s.description,
        categoryName: s.categoryName ?? null,
      });
    }
  }
  const counts: Counts = { created: 0, updated: 0, unchanged: 0, deleted: 0, kept: 0 };
  const create: Omit<StoredMovement, "id">[] = [];
  const update: StoredMovement[] = [];
  const remove: string[] = [];
  const current = new Map(existing.map((m) => [m.externalId, m]));
  for (const [externalId, entry] of wanted) {
    const old = current.get(externalId);
    current.delete(externalId);
    if (!old) {
      create.push(entry);
      counts.created++;
    } else if ((Object.keys(entry) as (keyof typeof entry)[]).every((k) => entry[k] === old[k]))
      counts.unchanged++;
    else {
      update.push({ id: old.id, ...entry });
      counts.updated++;
    }
  }
  for (const old of current.values()) {
    if (unsupported.has(old.externalId) || old.date < input.from || old.date > input.to) continue;
    if (
      !(old.fromAccountId && [...linked.values()].includes(old.fromAccountId)) &&
      !(old.toAccountId && [...linked.values()].includes(old.toAccountId))
    )
      continue;
    remove.push(old.id);
    counts.deleted++;
  }
  const coverage = input.links
    .filter((l) => {
      if (incomplete.has(l.accountId)) return false;
      return [...input.balances.values()].every((accounts) => {
        const a = accounts.find((a) => a.id === l.fireflyAccountId);
        return a && (!a.currencyCode || a.currencyCode === "EUR");
      });
    })
    .map((l) => ({ accountId: l.accountId, from: input.from, to: input.to }));
  return { create, update, remove, counts, coverage };
}
