import type { FireflyMovement } from "../api/types";
import { annotationOf, categoryOf, incomeKindOf } from "./analytics";

export interface AnalyticsFilters {
  from: string;
  to: string;
  search: string;
  category: string;
  includedCategories: string[];
  tag: string;
  account: string;
  excludedCategories: string[];
  excludedAccounts: string[];
  type: string;
  classification: string;
  inclusion: string;
  yieldOnly: boolean;
}
export function defaultAnalyticsFilters(from: string, to: string): AnalyticsFilters {
  return {
    from,
    to,
    includedCategories: [],
    search: "",
    category: "",
    tag: "",
    account: "",
    excludedCategories: [],
    excludedAccounts: [],
    type: "",
    classification: "",
    inclusion: "all",
    yieldOnly: false,
  };
}
export function filterMovements(movements: readonly FireflyMovement[], f: AnalyticsFilters) {
  return movements.filter((m) => {
    const a = annotationOf(m);
    return (
      m.date >= f.from &&
      m.date <= f.to &&
      (!f.type || m.type === f.type) &&
      (!f.category || categoryOf(m) === f.category) &&
      (!f.includedCategories.length || f.includedCategories.includes(categoryOf(m))) &&
      !f.excludedCategories.includes(categoryOf(m)) &&
      !f.excludedAccounts.includes(m.fromName) &&
      !f.excludedAccounts.includes(m.toName) &&
      (!f.tag || a.tags.includes(f.tag)) &&
      (!f.account || m.fromName === f.account || m.toName === f.account) &&
      (!f.classification || (m.type === "withdrawal" && a.spendingClass === f.classification)) &&
      (!f.yieldOnly || (m.type === "deposit" && incomeKindOf(m) === "yield")) &&
      (f.inclusion === "all" || a.included === (f.inclusion === "included")) &&
      (!f.search ||
        [m.description, m.fromName, m.toName, categoryOf(m), ...a.tags]
          .join(" ")
          .toLocaleLowerCase()
          .includes(f.search.toLocaleLowerCase()))
    );
  });
}

export function analyticsHref(path: string, filters: AnalyticsFilters) {
  return `#${path}?${new URLSearchParams({ filters: JSON.stringify(filters) })}`;
}
export function readAnalyticsFilters(hash = window.location.hash): AnalyticsFilters | null {
  const raw = new URLSearchParams(hash.split("?")[1] ?? "").get("filters");
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as AnalyticsFilters;
    const defaults = defaultAnalyticsFilters("", "");
    for (const key of Object.keys(defaults) as (keyof AnalyticsFilters)[]) {
      if (Array.isArray(defaults[key])) {
        if (
          !Array.isArray(value[key]) ||
          !(value[key] as unknown[]).every((v) => typeof v === "string")
        )
          return null;
      } else if (typeof value[key] !== typeof defaults[key]) return null;
    }
    if (!validReportRange(value.from, value.to)) return null;
    return value;
  } catch {
    return null;
  }
}
export function validReportRange(from: string, to: string) {
  const valid = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s;
  return valid(from) && valid(to) && from <= to;
}
