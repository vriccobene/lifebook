import type { AccountType, Warning } from "@lifebook/core";
import { formatDate, formatEuro } from "./format";

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: "Conto corrente",
  deposit: "Deposito",
  brokerage: "Titoli",
  external_investment: "Investimento esterno",
  pension_fund: "Fondo pensione",
  real_estate: "Immobile",
  liability: "Passività",
};

export const STATUS_LABELS: Record<string, string> = {
  green: "Verde",
  yellow: "Giallo",
  red: "Rosso",
  missing_data: "Dati mancanti",
  info: "Indicatore",
};

export const METHOD_LABELS: Record<string, string> = {
  swr: "Prelievo sicuro (SWR)",
  fi_number: "Numero FI",
  passive_income: "Solo rendite passive",
  hybrid: "Rendite più prelievo",
  layers: "Copertura per strati",
  coast_fire: "Coast FIRE",
  barista_fire: "Barista FIRE",
  fire_tiers: "Lean / Regular / Fat FIRE",
  bridge: "Ponte fino alla pensione",
  savings_rate: "Tasso di risparmio",
  years_of_autonomy: "Anni di autonomia",
  runway: "Runway senza rendimenti",
};

export const VARIANT_LABELS: Record<string, string> = {
  lean: "Lean",
  regular: "Regular",
  fat: "Fat",
};

export const METHOD_HINTS: Record<string, string> = {
  swr: "Il capitale per il tasso di prelievo sicuro copre il costo annuo.",
  fi_number: "Capitale obiettivo = costo annuo / tasso di prelievo.",
  passive_income: "Le rendite passive nette coprono da sole il costo annuo.",
  hybrid: "Rendite passive più un prelievo entro il tasso sicuro.",
  layers: "Spesa essenziale coperta da flussi sicuri, il resto dal capitale rischioso.",
  coast_fire:
    "Il capitale attuale, senza altri versamenti, raggiunge il Numero FI all'età obiettivo.",
  barista_fire: "Reddito da lavoro ancora necessario dopo rendite e prelievi.",
  fire_tiers: "Stesso calcolo con costo ridotto (Lean), normale (Regular) e maggiorato (Fat).",
  bridge: "Capitale per coprire il costo fino alla pensione e oltre.",
};

const MISSING_REASONS: Record<string, string> = {
  living_cost: "costo della vita non ancora calcolabile (servono due letture del conto di spesa)",
  living_cost_not_positive: "costo della vita non positivo",
  essential_spending: "spesa essenziale non inserita",
  current_age: "età attuale non impostata",
  target_retirement_age: "età di pensionamento obiettivo non impostata",
  income: "entrate non inserite",
};

export function missingReasons(codes: readonly string[]): string {
  return codes.map((code) => MISSING_REASONS[code] ?? code).join("; ");
}

/** Italian text of a living-cost validation. `accountName` resolves account ids. */
export function warningMessage(warning: Warning, accountName: (id: string) => string): string {
  const account = warning.accountId ? accountName(warning.accountId) : "";
  const period =
    warning.from && warning.to ? ` (${formatDate(warning.from)} → ${formatDate(warning.to)})` : "";
  switch (warning.code) {
    case "negative_spending":
      return `Spesa negativa${period}: ${formatEuro(warning.detail)}. Controlla saldi, entrate e contributi.`;
    case "spending_outlier":
      return `Spesa molto diversa dalla media${period}: ${formatEuro(warning.detail)} al mese.`;
    case "spending_account_missing_reading":
      return `Il conto di spesa «${account}» non ha una lettura nel periodo${period}.`;
    case "declared_contributions_missing":
      return `Il saldo di «${account}» è variato molto (${formatEuro(warning.detail)}) senza contributi dichiarati${period}.`;
    case "account_no_opening_balance":
      return `«${account}» non ha un saldo iniziale${period}: la sua variazione non è contata.`;
    case "stale_account":
      return `«${account}» non viene aggiornato da ${warning.detail} giorni: si usa l'ultimo saldo noto.`;
    case "insufficient_history":
      return `Storico breve: il costo della vita si basa su ${warning.detail} mesi.`;
    case "no_spending_account":
      return "Nessun conto è marcato come conto di spesa: il costo della vita non si può calcolare.";
    case "essential_exceeds_living_cost":
      return `La spesa essenziale (${formatEuro(warning.detail)}) supera il costo della vita: la parte discrezionale è zero.`;
    default:
      return warning.code;
  }
}

export const PERIODICITY_LABELS = {
  monthly: "Mensile",
  quarterly: "Trimestrale",
  yearly: "Annuale",
} as const;
