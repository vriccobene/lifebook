const euro0 = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
  useGrouping: "always",
});
const euro2 = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  useGrouping: "always",
});

export function formatEuro(value: number | null | undefined, decimals: 0 | 2 = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return (decimals === 0 ? euro0 : euro2).format(value);
}

/** `0.035` -> `3,5%`. */
export function formatPercent(fraction: number | null | undefined, digits = 1): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toLocaleString("it-IT", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("it-IT", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** `2026-09-30` -> `30/09/2026`. */
export function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

const MONTHS = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

/** `2026-09` or `2026-09-30` -> `set 2026`. */
export function formatMonth(value: string): string {
  const [y, m] = value.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

/** Years as `12,5 anni`, or `raggiunto` for zero and `non raggiungibile` for null. */
export function formatYears(years: number | null | undefined): string {
  if (years === null || years === undefined) return "non raggiungibile";
  if (years === 0) return "raggiunto";
  return `${formatNumber(years, 1)} anni`;
}

/** Parses a number typed by an Italian user: `1.234,56`, `1234,56` and `1234.56` are all accepted. */
export function parseDecimal(text: string): number | null {
  const trimmed = text.trim().replace(/\s/g, "");
  if (trimmed === "") return null;
  const normalised = trimmed.includes(",") ? trimmed.replace(/\./g, "").replace(",", ".") : trimmed;
  if (!/^[-+]?\d*\.?\d+$|^[-+]?\d+\.$/.test(normalised)) return null;
  const value = Number(normalised);
  return Number.isFinite(value) ? value : null;
}

/** Number to the text an input should show: `1234.5` -> `1234,5`. */
export function toInputNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value).replace(".", ",");
}

/** Percentage typed by the user (`3,5`) to a fraction (`0.035`), avoiding float noise. */
export function percentToFraction(text: string): number | null {
  const value = parseDecimal(text);
  return value === null ? null : Math.round(value * 1e6) / 1e8;
}

export function fractionToPercentInput(fraction: number | null | undefined): string {
  return fraction === null || fraction === undefined
    ? ""
    : toInputNumber(Math.round(fraction * 1e8) / 1e6);
}
