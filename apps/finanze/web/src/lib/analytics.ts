import { resolveAccountParams } from "@lifebook/finanze-core";
import type { Account, FireflyMovement, IncomeKind, MovementAnnotation } from "../api/types";

export const DEFAULT_ANNOTATION: MovementAnnotation = {
  tags: [],
  included: true,
  spendingClass: "unclassified",
  isYield: false,
  grossAmount: null,
};
export const annotationOf = (m: FireflyMovement) => m.annotation ?? DEFAULT_ANNOTATION;
export const categoryOf = (m: FireflyMovement) => m.categoryName || "Senza categoria";
export const TYPE_LABELS: Record<string, string> = {
  deposit: "Entrata",
  withdrawal: "Spesa",
  transfer: "Trasferimento",
  "opening balance": "Saldo iniziale",
};
export const INCOME_LABELS: Record<IncomeKind, string> = {
  salary: "Stipendio",
  yield: "Rendita",
  other: "Altra entrata",
};
/** Explicit classification wins; otherwise split receipts into salary and non-salary income. */
export function incomeKindOf(m: FireflyMovement): IncomeKind {
  const a = annotationOf(m);
  if (a.incomeKind) return a.incomeKind;
  if (a.isYield) return "yield";
  return ["stipendio", "stipendi", "salario", "salari", "salary", "salaries", "wages"].includes(
    (m.categoryName ?? "").trim().toLowerCase(),
  )
    ? "salary"
    : "yield";
}
const cents = (n: number) => Math.round(n * 100);

/** A linked investment receipt is gross; other non-salary receipts use their account tax rate too. */
export function receiptAmounts(m: FireflyMovement, accounts: readonly Account[] = []) {
  const account = m.type === "deposit" ? accounts.find((a) => a.id === m.toAccountId) : undefined;
  const taxable =
    account &&
    (["brokerage", "external_investment", "pension_fund"].includes(account.type) ||
      incomeKindOf(m) === "yield");
  if (taxable) {
    const taxRate = resolveAccountParams(account, m.date).taxRate;
    const grossCents = cents(m.amount);
    const taxCents = Math.round(Math.max(grossCents, 0) * taxRate);
    return {
      gross: grossCents / 100,
      net: (grossCents - taxCents) / 100,
      tax: taxCents / 100,
      taxRate,
      estimated: true,
    };
  }
  return {
    gross: annotationOf(m).grossAmount,
    net: m.amount,
    tax: null,
    taxRate: null,
    estimated: false,
  };
}

export function summarize(
  movements: readonly FireflyMovement[],
  accounts: readonly Account[] = [],
) {
  let income = 0,
    salary = 0,
    otherIncome = 0,
    spending = 0,
    transfers = 0,
    essential = 0,
    discretionary = 0,
    unclassified = 0,
    yieldNet = 0,
    yieldGross = 0,
    unknownGross = 0;
  for (const m of movements) {
    const a = annotationOf(m);
    if (!a.included) continue;
    const receipt = receiptAmounts(m, accounts);
    const amount = cents(m.type === "deposit" ? receipt.net : m.amount);
    if (m.type === "deposit") {
      income += amount;
      const kind = incomeKindOf(m);
      if (kind === "salary") salary += amount;
      else if (kind === "other") otherIncome += amount;
      if (kind === "yield") {
        yieldNet += amount;
        if (receipt.gross === null) unknownGross++;
        else yieldGross += cents(receipt.gross);
      }
    } else if (m.type === "withdrawal") {
      spending += amount;
      if (a.spendingClass === "essential") essential += amount;
      else if (a.spendingClass === "discretionary") discretionary += amount;
      else unclassified += amount;
    } else if (m.type === "transfer") transfers += amount;
  }
  return {
    income: income / 100,
    salary: salary / 100,
    otherIncome: otherIncome / 100,
    spending: spending / 100,
    transfers: transfers / 100,
    essential: essential / 100,
    discretionary: discretionary / 100,
    unclassified: unclassified / 100,
    balance: (income - spending) / 100,
    yieldNet: yieldNet / 100,
    yieldGross: yieldGross / 100,
    unknownGross,
  };
}

export type GroupBy = "category" | "month" | "tag" | "counterparty";
export function groupMovements(
  movements: readonly FireflyMovement[],
  by: GroupBy,
  accounts: readonly Account[] = [],
) {
  const groups = new Map<string, FireflyMovement[]>();
  for (const m of movements) {
    const keys =
      by === "category"
        ? [categoryOf(m)]
        : by === "month"
          ? [m.date.slice(0, 7)]
          : by === "counterparty"
            ? [m.type === "deposit" ? m.fromName : m.toName]
            : annotationOf(m).tags.length
              ? annotationOf(m).tags
              : ["Senza tag"];
    for (const key of keys) {
      const group = groups.get(key);
      if (group) group.push(m);
      else groups.set(key, [m]);
    }
  }
  return [...groups]
    .map(([name, rows]) => ({ name, count: rows.length, ...summarize(rows, accounts) }))
    .sort((a, b) =>
      by === "month"
        ? a.name.localeCompare(b.name)
        : b.spending + b.income + b.transfers - (a.spending + a.income + a.transfers),
    );
}

/** Quoted CSV cells; neutralize spreadsheet formulas in imported descriptions. */
export function movementsCsv(rows: readonly FireflyMovement[], accounts: readonly Account[] = []) {
  const cell = (v: string | number) =>
    '"' +
    String(typeof v === "string" && /^[=+@\-\t\r]/.test(v) ? "'" + v : v).replaceAll('"', '""') +
    '"';
  return (
    "\ufeff" +
    [
      [
        "Data",
        "Tipo",
        "Descrizione",
        "Categoria",
        "Da",
        "A",
        "Importo EUR",
        "Tag",
        "Inclusa",
        "Classificazione",
        "Rendita",
        "Tipo entrata",
        "Lordo EUR",
        "Netto EUR",
        "Imposte stimate EUR",
        "Aliquota (%)",
      ],
      ...rows.map((m) => {
        const a = annotationOf(m);
        const receipt = receiptAmounts(m, accounts);
        return [
          m.date,
          TYPE_LABELS[m.type] ?? m.type,
          m.description,
          categoryOf(m),
          m.fromName,
          m.toName,
          m.amount,
          a.tags.join(", "),
          a.included ? "Sì" : "No",
          a.spendingClass,
          m.type === "deposit" && incomeKindOf(m) === "yield" ? "Sì" : "No",
          m.type === "deposit" ? INCOME_LABELS[incomeKindOf(m)] : "",
          m.type === "deposit" ? (receipt.gross ?? "") : "",
          m.type === "deposit" ? receipt.net : "",
          m.type === "deposit" ? (receipt.tax ?? "") : "",
          receipt.taxRate === null ? "" : receipt.taxRate * 100,
        ];
      }),
    ]
      .map((row) => row.map(cell).join(";"))
      .join("\r\n")
  );
}
