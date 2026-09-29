import { useState, type FormEvent } from "react";
import { errorMessage } from "../api/client";
import { useGet, useWrite } from "../api/hooks";
import type { IncomeItem } from "../api/types";
import { Banner, Card, EmptyState, Field, Loading, QueryError } from "../components/ui";
import { todayIso } from "../lib/dates";
import { formatDate, formatEuro, parseDecimal, toInputNumber } from "../lib/format";
import { PERIODICITY_LABELS } from "../lib/labels";

interface Form {
  name: string;
  amount: string;
  kind: "recurring" | "one_off";
  periodicity: "monthly" | "quarterly" | "yearly";
  startDate: string;
  endDate: string;
  date: string;
}

const blank = (): Form => ({
  name: "",
  amount: "",
  kind: "recurring",
  periodicity: "monthly",
  startDate: todayIso(),
  endDate: "",
  date: todayIso(),
});

const toForm = (item: IncomeItem): Form =>
  item.kind === "one_off"
    ? {
        ...blank(),
        name: item.name,
        amount: toInputNumber(item.amount),
        kind: "one_off",
        date: item.date,
      }
    : {
        ...blank(),
        name: item.name,
        amount: toInputNumber(item.amount),
        kind: "recurring",
        periodicity: item.periodicity,
        startDate: item.startDate,
        endDate: item.endDate ?? "",
      };

export function Income() {
  const items = useGet<IncomeItem[]>("/income-items");
  const create = useWrite<Record<string, unknown>>("POST", () => "/income-items");
  const replace = useWrite<{ id: string; body: Record<string, unknown> }>(
    "PUT",
    ({ id }) => `/income-items/${id}`,
    ({ body }) => body,
  );
  const remove = useWrite<string>("DELETE", (id) => `/income-items/${id}`);
  const [form, setForm] = useState<Form>(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (items.error) return <QueryError error={items.error} />;
  if (!items.data) return <Loading />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const amount = parseDecimal(form.amount);
    if (amount === null) return setError("Importo non valido");
    const body: Record<string, unknown> =
      form.kind === "one_off"
        ? { name: form.name, kind: "one_off", amount, date: form.date }
        : {
            name: form.name,
            kind: "recurring",
            amount,
            periodicity: form.periodicity,
            startDate: form.startDate,
            endDate: form.endDate || null,
          };
    try {
      if (editing) await replace.mutateAsync({ id: editing, body });
      else await create.mutateAsync(body);
      setForm(blank());
      setEditing(null);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const describe = (item: IncomeItem) =>
    item.kind === "one_off"
      ? `una tantum il ${formatDate(item.date)}`
      : `${PERIODICITY_LABELS[item.periodicity].toLowerCase()} dal ${formatDate(item.startDate)}${item.endDate ? ` al ${formatDate(item.endDate)}` : ""}`;

  return (
    <>
      <h1>Entrate</h1>
      <Card title={editing ? "Modifica voce" : "Nuova voce"}>
        <form className="stack" onSubmit={submit}>
          <div className="row">
            <Field label="Nome" hint="Stipendio, tredicesima, bonus, affitto…">
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </Field>
            <Field label="Importo netto (€)" hint="Per ogni incasso">
              <input
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
              />
            </Field>
            <Field label="Tipo">
              <select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as Form["kind"] })}
              >
                <option value="recurring">Ricorrente</option>
                <option value="one_off">Una tantum</option>
              </select>
            </Field>
            {form.kind === "recurring" ? (
              <>
                <Field label="Periodicità">
                  <select
                    value={form.periodicity}
                    onChange={(e) =>
                      setForm({ ...form, periodicity: e.target.value as Form["periodicity"] })
                    }
                  >
                    {Object.entries(PERIODICITY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Dal" hint="Data del primo incasso">
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Fino al" hint="Vuoto = senza fine">
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                  />
                </Field>
              </>
            ) : (
              <Field label="Data">
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
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
                  setForm(blank());
                }}
              >
                Annulla
              </button>
            )}
          </div>
        </form>
        <p className="muted small">
          Inserisci anche affitti e dividendi accreditati su un conto di spesa: altrimenti abbassano
          il costo della vita calcolato.
        </p>
      </Card>
      <Card>
        {items.data.length === 0 ? (
          <EmptyState>
            Nessuna entrata. Senza entrate il costo della vita non può essere dedotto.
          </EmptyState>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Voce</th>
                <th className="num">Importo</th>
                <th>Quando</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.data.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td className="num">{formatEuro(item.amount, 2)}</td>
                  <td>{describe(item)}</td>
                  <td>
                    <button
                      className="link"
                      onClick={() => {
                        setEditing(item.id);
                        setForm(toForm(item));
                      }}
                    >
                      Modifica
                    </button>
                    <button
                      className="link danger"
                      onClick={() => confirm(`Eliminare «${item.name}»?`) && remove.mutate(item.id)}
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
    </>
  );
}
