import type { Account, FireflyMovement, ReturnsPayload } from "../api/types";
import type { DateRange } from "./range";

/** Gains from balance readings. Cash transfers are capital flows, never income here. */
export function accruedReturns(
  returns: ReturnsPayload,
  accounts: readonly Account[],
  movements: readonly FireflyMovement[],
  range: DateRange,
  accountName: string,
  excludedNames: readonly string[],
) {
  const names = new Map(accounts.map((a) => [a.id, new Set([a.name])]));
  for (const m of movements) {
    if (m.fromAccountId) names.get(m.fromAccountId)?.add(m.fromName);
    if (m.toAccountId) names.get(m.toAccountId)?.add(m.toName);
  }
  const eligible = accounts.filter((a) => {
    const aliases = names.get(a.id)!;
    return (
      (!accountName || aliases.has(accountName)) && !excludedNames.some((name) => aliases.has(name))
    );
  });
  const rows = eligible.flatMap((account) => {
    const records = returns.records.filter(
      (r) => r.accountId === account.id && r.to >= range.from && r.to <= range.to,
    );
    if (!records.length) return [];
    const sum = (pick: (r: (typeof records)[number]) => number) =>
      records.reduce((total, r) => total + pick(r), 0);
    return [
      {
        account,
        from: records.reduce((date, r) => (r.from < date ? r.from : date), records[0]!.from),
        to: records.reduce((date, r) => (r.to > date ? r.to : date), records[0]!.to),
        periods: records.length,
        gross: sum((r) => r.grossGain),
        net: sum((r) => r.netGain),
        tax: sum((r) => r.tax),
      },
    ];
  });
  return {
    rows,
    gross: rows.reduce((v, r) => v + r.gross, 0),
    net: rows.reduce((v, r) => v + r.net, 0),
    tax: rows.reduce((v, r) => v + r.tax, 0),
  };
}
