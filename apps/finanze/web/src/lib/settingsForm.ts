import type { SettingsValues } from "../api/types";
import { fractionToPercentInput, parseDecimal, percentToFraction, toInputNumber } from "./format";

export type FieldKind = "percent" | "number" | "nullable" | "boolean" | "window";

export interface FieldDef {
  key: string;
  path: readonly string[];
  kind: FieldKind;
  label: string;
  hint?: string;
  unit?: string;
  group: "generale" | "pensione" | "semaforo" | "avanzate";
}

export const SETTINGS_FIELDS: readonly FieldDef[] = [
  {
    key: "safeWithdrawalRate",
    path: ["safeWithdrawalRate"],
    kind: "percent",
    unit: "%",
    group: "generale",
    label: "Tasso di prelievo sicuro",
    hint: "Quota annua del capitale che puoi prelevare (SWR).",
  },
  {
    key: "inflationRate",
    path: ["inflationRate"],
    kind: "percent",
    unit: "%",
    group: "generale",
    label: "Inflazione",
    hint: "Le proiezioni sono in euro di oggi.",
  },
  {
    key: "emergencyBufferMonths",
    path: ["emergencyBufferMonths"],
    kind: "number",
    unit: "mesi",
    group: "generale",
    label: "Buffer di emergenza",
    hint: "Mesi di costo della vita esclusi dal capitale investibile.",
  },
  {
    key: "livingCostWindow",
    path: ["livingCostWindow"],
    kind: "window",
    unit: "mesi",
    group: "generale",
    label: "Finestra del costo della vita",
    hint: "Media mobile usata come riferimento.",
  },
  {
    key: "leanFactor",
    path: ["leanFactor"],
    kind: "number",
    group: "generale",
    label: "Fattore Lean FIRE",
    hint: "0,8 = costo ridotto del 20%.",
  },
  {
    key: "fatFactor",
    path: ["fatFactor"],
    kind: "number",
    group: "generale",
    label: "Fattore Fat FIRE",
    hint: "1,3 = costo maggiorato del 30%.",
  },
  {
    key: "currentAge",
    path: ["currentAge"],
    kind: "nullable",
    unit: "anni",
    group: "generale",
    label: "Età attuale",
  },
  {
    key: "targetRetirementAge",
    path: ["targetRetirementAge"],
    kind: "nullable",
    unit: "anni",
    group: "generale",
    label: "Età di pensionamento obiettivo",
  },
  {
    key: "endOfPlanAge",
    path: ["endOfPlanAge"],
    kind: "number",
    unit: "anni",
    group: "generale",
    label: "Età di fine piano",
  },
  {
    key: "pensionEnabled",
    path: ["publicPension", "enabled"],
    kind: "boolean",
    group: "pensione",
    label: "Considera la pensione pubblica",
    hint: "Disabilitata di default. Vale per tutti i metodi.",
  },
  {
    key: "pensionStartAge",
    path: ["publicPension", "startAge"],
    kind: "number",
    unit: "anni",
    group: "pensione",
    label: "Età di inizio",
  },
  {
    key: "pensionAmount",
    path: ["publicPension", "netMonthlyAmount"],
    kind: "number",
    unit: "€ al mese",
    group: "pensione",
    label: "Importo netto mensile",
    hint: "Ad esempio dalla simulazione INPS «La mia pensione futura».",
  },
  {
    key: "greenAt",
    path: ["trafficLight", "greenAt"],
    kind: "percent",
    unit: "%",
    group: "semaforo",
    label: "Verde da",
    hint: "Copertura minima per il verde.",
  },
  {
    key: "yellowAt",
    path: ["trafficLight", "yellowAt"],
    kind: "percent",
    unit: "%",
    group: "semaforo",
    label: "Giallo da",
  },
  {
    key: "minGreenMethods",
    path: ["verdict", "minGreenMethods"],
    kind: "number",
    group: "semaforo",
    label: "Metodi verdi necessari",
    hint: "Per il verdetto sintetico.",
  },
  {
    key: "spendingDeviationThreshold",
    path: ["spendingDeviationThreshold"],
    kind: "percent",
    unit: "%",
    group: "avanzate",
    label: "Soglia di scostamento della spesa",
    hint: "Oltre questa distanza dalla media la spesa del mese è segnalata.",
  },
  {
    key: "declaredBalanceChangeThreshold",
    path: ["declaredBalanceChangeThreshold"],
    kind: "percent",
    unit: "%",
    group: "avanzate",
    label: "Soglia di variazione senza contributi",
    hint: "Variazione del saldo di un conto con contributi dichiarati che richiede un avviso.",
  },
  {
    key: "staleAccountDays",
    path: ["staleAccountDays"],
    kind: "number",
    unit: "giorni",
    group: "avanzate",
    label: "Giorni per considerare un conto fermo",
  },
];

export type FormValues = Record<string, string | boolean>;

function read(values: SettingsValues, path: readonly string[]): unknown {
  return path.reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], values);
}

export function settingsToForm(values: SettingsValues): FormValues {
  const form: FormValues = {};
  for (const field of SETTINGS_FIELDS) {
    const value = read(values, field.path);
    form[field.key] =
      field.kind === "boolean"
        ? Boolean(value)
        : field.kind === "percent"
          ? fractionToPercentInput(value as number)
          : toInputNumber(value as number | null);
  }
  return form;
}

function parseField(field: FieldDef, raw: string | boolean): { value: unknown; error?: string } {
  if (field.kind === "boolean") return { value: Boolean(raw) };
  const text = String(raw);
  if (field.kind === "nullable" && text.trim() === "") return { value: null };
  const parsed = field.kind === "percent" ? percentToFraction(text) : parseDecimal(text);
  if (parsed === null) return { value: null, error: "Valore non valido" };
  if (field.kind === "window" && ![3, 6, 12].includes(parsed))
    return { value: null, error: "Scegli 3, 6 o 12" };
  return { value: parsed };
}

/** Only the values that differ from those in force: they become a new dated settings entry. */
export function diffSettings(
  effective: SettingsValues,
  form: Readonly<FormValues>,
): { patch: Record<string, unknown>; errors: Record<string, string> } {
  const patch: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const field of SETTINGS_FIELDS) {
    const { value, error } = parseField(field, form[field.key] ?? "");
    if (error) {
      errors[field.key] = error;
      continue;
    }
    const current = read(effective, field.path);
    const same =
      field.kind === "percent" && typeof value === "number" && typeof current === "number"
        ? Math.abs(value - current) < 1e-9
        : value === current;
    if (same) continue;
    let node = patch;
    for (const key of field.path.slice(0, -1)) {
      node[key] = (node[key] as Record<string, unknown> | undefined) ?? {};
      node = node[key] as Record<string, unknown>;
    }
    node[field.path[field.path.length - 1]!] = value;
  }
  return { patch, errors };
}

function display(field: FieldDef, value: unknown): string {
  if (value === null || value === undefined) return "non impostata";
  if (field.kind === "boolean") return value ? "sì" : "no";
  if (field.kind === "percent") return fractionToPercentInput(value as number) + "%";
  const text = toInputNumber(value as number);
  return field.unit ? `${text} ${field.unit}` : text;
}

/** Readable summary of a dated settings entry: `Tasso di prelievo sicuro: 4%`, never internal field names. */
export function describeSettingsEntry(values: Readonly<Record<string, unknown>>): string[] {
  const lines: string[] = [];
  for (const field of SETTINGS_FIELDS) {
    let node: unknown = values;
    for (const key of field.path) {
      node = node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined;
    }
    if (node === undefined) continue;
    lines.push(`${field.label}: ${display(field, node)}`);
  }
  return lines;
}
