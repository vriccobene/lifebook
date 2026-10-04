import { PageHeading } from "../components/ui";
import { useState, type FormEvent } from "react";
import { errorMessage } from "../api/client";
import { useGet, useWrite } from "../api/hooks";
import type { EssentialEntry, LivingCostPayload, MethodsPayload } from "../api/types";
import { Bars } from "../components/Charts";
import { Banner, Card, EmptyState, Field, Loading, QueryError } from "../components/ui";
import { essentialRows } from "../lib/charts";
import { monthOf, todayIso } from "../lib/dates";
import {
  formatDate,
  formatEuro,
  formatMonth,
  formatPercent,
  parseDecimal,
  toInputNumber,
} from "../lib/format";

type Mode = "percent" | "amount" | "month_amount";
const MODE_LABELS: Record<Mode, string> = {
  percent: "Percentuale del costo della vita",
  amount: "Importo mensile fisso da una data",
  month_amount: "Importo di un singolo mese",
};
const ALL_TIME = { from: "0000-01-01", to: "9999-12-31" };

const sortKey = (e: EssentialEntry) => (e.mode === "month_amount" ? `${e.month}-31` : e.validFrom);

function describe(entry: EssentialEntry): string {
  if (entry.mode === "percent")
    return `${toInputNumber(entry.value)}% del costo della vita, dal ${formatDate(entry.validFrom)}`;
  if (entry.mode === "amount")
    return `${formatEuro(entry.value, 2)} al mese, dal ${formatDate(entry.validFrom)}`;
  return `${formatEuro(entry.value, 2)} per ${formatMonth(entry.month)}`;
}

export function Essential() {
  const entries = useGet<EssentialEntry[]>("/essential-spending");
  const living = useGet<LivingCostPayload>("/results/living-cost");
  const methods = useGet<MethodsPayload>("/results/methods");
  const create = useWrite<Record<string, unknown>>("POST", () => "/essential-spending");
  const replace = useWrite<{ id: string; body: Record<string, unknown> }>(
    "PUT",
    ({ id }) => `/essential-spending/${id}`,
    ({ body }) => body,
  );
  const remove = useWrite<string>("DELETE", (id) => `/essential-spending/${id}`);

  const [mode, setMode] = useState<Mode>("amount");
  const [value, setValue] = useState("");
  const [validFrom, setValidFrom] = useState(todayIso());
  const [month, setMonth] = useState(monthOf(todayIso()));
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (entries.error || living.error || methods.error)
    return <QueryError error={entries.error ?? living.error ?? methods.error} />;
  if (!entries.data || !living.data || !methods.data) return <Loading />;

  const split = living.data.essentialSplit;
  const layers = methods.data.methods.find((m) => m.id === "layers");
  const inUse =
    layers && layers.status !== "missing_data" ? Number(layers.details.essentialAnnual) / 12 : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseDecimal(value);
    if (parsed === null || parsed < 0 || (mode === "percent" && parsed > 100)) {
      return setError(
        mode === "percent" ? "Inserisci una percentuale tra 0 e 100." : "Importo non valido.",
      );
    }
    const body =
      mode === "month_amount" ? { mode, value: parsed, month } : { mode, value: parsed, validFrom };
    try {
      if (editing) await replace.mutateAsync({ id: editing, body });
      else await create.mutateAsync(body);
      setEditing(null);
      setValue("");
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function edit(entry: EssentialEntry) {
    setEditing(entry.id);
    setMode(entry.mode);
    setValue(toInputNumber(entry.value));
    if (entry.mode === "month_amount") setMonth(entry.month);
    else setValidFrom(entry.validFrom);
  }

  return (
    <>
      <PageHeading title="Spesa essenziale" eyebrow="LE TUE PRIORITÀ">
        Definisci quanto serve ogni mese, prima delle spese discrezionali.
      </PageHeading>
      {inUse === null ? (
        <Banner kind="info">
          {entries.data.length === 0
            ? "La spesa essenziale non è impostata."
            : "Nessun valore è in vigore nel mese corrente."}{" "}
          Finché manca, il metodo «Copertura per strati» è escluso dal verdetto: non esiste un
          valore predefinito.
        </Banner>
      ) : (
        <Banner kind="ok">
          Valore in uso nel mese corrente: <strong>{formatEuro(inUse, 0)}</strong> al mese, su un
          costo della vita di {formatEuro(living.data.livingCost.referenceMonthly)}.
        </Banner>
      )}

      <Card title={editing ? "Modifica valore" : "Nuovo valore"}>
        <form className="stack" onSubmit={submit}>
          <div className="row" role="radiogroup" aria-label="Modalità">
            {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
              <label key={m} className="field check">
                <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
                <span>{MODE_LABELS[m]}</span>
              </label>
            ))}
          </div>
          <div className="row">
            <Field label={mode === "percent" ? "Percentuale (%)" : "Importo (€ al mese)"}>
              <input
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
              />
            </Field>
            {mode === "month_amount" ? (
              <Field label="Mese">
                <input
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  required
                />
              </Field>
            ) : (
              <Field label="In vigore dal">
                <input
                  type="date"
                  value={validFrom}
                  onChange={(e) => setValidFrom(e.target.value)}
                  required
                />
              </Field>
            )}
          </div>
          {error && <Banner kind="error">{error}</Banner>}
          <div className="row">
            <button className="primary">{editing ? "Salva" : "Aggiungi"}</button>
            {editing && (
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setValue("");
                }}
              >
                Annulla
              </button>
            )}
          </div>
        </form>
        <p className="muted small">
          Per un mese vale prima l'importo di quel mese, altrimenti l'ultimo valore fisso o
          percentuale con data non successiva. Le tre modalità si possono combinare.
        </p>
      </Card>

      <Card title="Storico dei valori">
        {entries.data.length === 0 ? (
          <EmptyState>Nessun valore inserito.</EmptyState>
        ) : (
          <table>
            <tbody>
              {[...entries.data]
                .sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : -1))
                .map((entry) => (
                  <tr key={entry.id}>
                    <td>{describe(entry)}</td>
                    <td style={{ width: 150 }}>
                      <button className="link" onClick={() => edit(entry)}>
                        Modifica
                      </button>
                      <button
                        className="link danger"
                        onClick={() =>
                          confirm("Eliminare questo valore?") && remove.mutate(entry.id)
                        }
                      >
                        Elimina
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Confronto con il costo della vita dedotto">
        <Bars
          rows={essentialRows(split, ALL_TIME)}
          stacked
          series={[
            { key: "essential", label: "Essenziale" },
            { key: "discretionary", label: "Discrezionale" },
          ]}
        />
        <div className="scroll-x" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Mese</th>
                <th className="num">Costo della vita</th>
                <th className="num">Essenziale</th>
                <th className="num">Discrezionale</th>
                <th className="num">Quota essenziale</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...split].reverse().map((s) => (
                <tr key={s.month}>
                  <td>{formatMonth(s.month)}</td>
                  <td className="num">{formatEuro(s.livingCost)}</td>
                  <td className="num">{formatEuro(s.essential)}</td>
                  <td className="num">{formatEuro(s.discretionary)}</td>
                  <td className="num">
                    {s.essential === null ? "—" : formatPercent(s.essential / s.livingCost, 0)}
                  </td>
                  <td className="small" style={{ color: "var(--yellow)" }}>
                    {s.exceedsLivingCost ? "Supera il costo della vita: discrezionale a zero" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
