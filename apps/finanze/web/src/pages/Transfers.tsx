import { useState, type FormEvent } from "react";
import { errorMessage } from "../api/client";
import { useWrite } from "../api/hooks";
import { accountNamer, useAccounts, useContributions, useTransfers } from "../api/queries";
import type { Contribution, Transfer } from "../api/types";
import { Banner, Card, EmptyState, Field, Loading, QueryError } from "../components/ui";
import { todayIso } from "../lib/dates";
import { formatDate, formatEuro, parseDecimal, toInputNumber } from "../lib/format";
import {
  contributionAccounts,
  movementLabel,
  planTransfer,
  transferAccounts,
} from "../lib/transfers";

type Message = { kind: "ok" | "error"; text: string };

/** Contributions (versamenti e prelievi) and transfers between the accounts Lifebook Finanze tracks. */
export function Transfers() {
  const accounts = useAccounts();
  const contributions = useContributions();
  const create = useWrite<{ accountId: string; date: string; amount: number }>(
    "POST",
    () => "/contributions",
  );
  const update = useWrite<{ id: string; body: { date: string; amount: number } }>(
    "PATCH",
    ({ id }) => `/contributions/${id}`,
    ({ body }) => body,
  );
  const remove = useWrite<string>("DELETE", (id) => `/contributions/${id}`);

  const [date, setDate] = useState(todayIso());
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [movementAccount, setMovementAccount] = useState("");
  const [kind, setKind] = useState<"in" | "out">("in");
  const [movementAmount, setMovementAmount] = useState("");
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<{ id: string; date: string; amount: string } | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  if (accounts.error || contributions.error)
    return <QueryError error={accounts.error ?? contributions.error} />;
  if (!accounts.data || !contributions.data) return <Loading />;

  const name = accountNamer(accounts.data);
  const routes = transferAccounts(accounts.data, date);
  const declared = contributionAccounts(accounts.data, date);
  const plan = planTransfer(
    routes.find((a) => a.id === from),
    routes.find((a) => a.id === to),
    parseDecimal(amount),
    date,
  );
  const showPlan = from !== "" && to !== "" && amount.trim() !== "";

  async function submitTransfer(event: FormEvent) {
    event.preventDefault();
    if (plan.error) return setMessage({ kind: "error", text: plan.error });
    try {
      for (const c of plan.contributions) await create.mutateAsync(c);
      setMessage({
        kind: "ok",
        text: `Trasferimento registrato (${plan.contributions.length} ${plan.contributions.length === 1 ? "voce" : "voci"}).`,
      });
      setAmount("");
    } catch (e) {
      setMessage({ kind: "error", text: errorMessage(e) });
    }
  }

  async function submitMovement(event: FormEvent) {
    event.preventDefault();
    const value = parseDecimal(movementAmount);
    if (!movementAccount) return setMessage({ kind: "error", text: "Scegli il conto." });
    if (value === null || value <= 0)
      return setMessage({ kind: "error", text: "Inserisci un importo maggiore di zero." });
    try {
      await create.mutateAsync({
        accountId: movementAccount,
        date,
        amount: kind === "in" ? value : -value,
      });
      setMessage({
        kind: "ok",
        text: kind === "in" ? "Versamento registrato." : "Prelievo registrato.",
      });
      setMovementAmount("");
    } catch (e) {
      setMessage({ kind: "error", text: errorMessage(e) });
    }
  }

  async function saveEdit() {
    if (!editing) return;
    const value = parseDecimal(editing.amount);
    if (value === null || value === 0)
      return setMessage({ kind: "error", text: "Importo non valido." });
    try {
      await update.mutateAsync({ id: editing.id, body: { date: editing.date, amount: value } });
      setEditing(null);
      setMessage({ kind: "ok", text: "Movimento aggiornato." });
    } catch (e) {
      setMessage({ kind: "error", text: errorMessage(e) });
    }
  }

  const rows = contributions.data
    .filter((c) => !filter || c.accountId === filter)
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
  const byId = new Map(accounts.data.map((a) => [a.id, a]));

  return (
    <>
      <h1>Trasferimenti</h1>
      <Card>
        <div className="row">
          <Field
            label="Data dei movimenti"
            hint="Vale per i moduli qui sotto. Può essere anche nel passato."
          >
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
          </Field>
        </div>
      </Card>
      {message && <Banner kind={message.kind}>{message.text}</Banner>}

      <Card title="Trasferimento tra due conti">
        <form className="stack" onSubmit={submitTransfer}>
          <div className="row">
            <Field label="Da">
              <select value={from} onChange={(e) => setFrom(e.target.value)}>
                <option value="">Scegli…</option>
                {routes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="A">
              <select value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">Scegli…</option>
                {routes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Importo (€)">
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
          </div>
          {showPlan && (
            <div className="small" aria-live="polite">
              {plan.contributions.length > 0 && (
                <div>
                  <strong>Verrà registrato:</strong>{" "}
                  {plan.contributions
                    .map(
                      (c) =>
                        `${name(c.accountId)} ${c.amount > 0 ? "+" : "−"}${formatEuro(Math.abs(c.amount), 2)}`,
                    )
                    .join(" · ")}
                </div>
              )}
              {plan.notes.map((note) => (
                <div key={note} className="muted">
                  {note}
                </div>
              ))}
              {plan.error && <div style={{ color: "var(--red)" }}>{plan.error}</div>}
            </div>
          )}
          <div>
            <button className="primary" disabled={create.isPending}>
              Registra trasferimento
            </button>
          </div>
        </form>
        <p className="muted small">
          Conti di spesa e depositi con movimenti dedotti si leggono dal saldo: per loro non si
          inserisce nulla. Per gli altri conti si registrano un prelievo da chi cede e un versamento
          a chi riceve.
        </p>
      </Card>

      <Card title="Versamento o prelievo su un conto">
        <form className="stack" onSubmit={submitMovement}>
          <div className="row">
            <Field label="Conto">
              <select value={movementAccount} onChange={(e) => setMovementAccount(e.target.value)}>
                <option value="">Scegli…</option>
                {declared.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tipo">
              <select value={kind} onChange={(e) => setKind(e.target.value as "in" | "out")}>
                <option value="in">Versamento (entra nel conto)</option>
                <option value="out">Prelievo (esce dal conto)</option>
              </select>
            </Field>
            <Field label="Importo (€)">
              <input
                inputMode="decimal"
                value={movementAmount}
                onChange={(e) => setMovementAmount(e.target.value)}
              />
            </Field>
          </div>
          <div>
            <button className="primary" disabled={create.isPending}>
              Registra
            </button>
          </div>
        </form>
        {declared.length === 0 && (
          <p className="muted small">
            Non ci sono conti con contributi dichiarati (titoli, investimenti esterni, passività).
          </p>
        )}
      </Card>

      <Card
        title="Movimenti registrati"
        actions={
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filtra per conto"
          >
            <option value="">Tutti i conti</option>
            {accounts.data.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        }
      >
        {rows.length === 0 ? (
          <EmptyState>Nessun movimento registrato.</EmptyState>
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Conto</th>
                  <th>Tipo</th>
                  <th className="num">Importo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((c: Contribution) => {
                  const isEditing = editing?.id === c.id;
                  return (
                    <tr key={c.id}>
                      <td>
                        {isEditing ? (
                          <input
                            type="date"
                            aria-label="Data"
                            value={editing.date}
                            onChange={(e) => setEditing({ ...editing, date: e.target.value })}
                          />
                        ) : (
                          formatDate(c.date)
                        )}
                      </td>
                      <td>{name(c.accountId)}</td>
                      <td>{movementLabel(byId.get(c.accountId), c.amount)}</td>
                      <td className="num">
                        {isEditing ? (
                          <input
                            inputMode="decimal"
                            aria-label="Importo"
                            value={editing.amount}
                            onChange={(e) => setEditing({ ...editing, amount: e.target.value })}
                          />
                        ) : (
                          formatEuro(c.amount, 2)
                        )}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {isEditing ? (
                          <>
                            <button className="link" onClick={() => void saveEdit()}>
                              Salva
                            </button>
                            <button className="link" onClick={() => setEditing(null)}>
                              Annulla
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="link"
                              onClick={() =>
                                setEditing({
                                  id: c.id,
                                  date: c.date,
                                  amount: toInputNumber(c.amount),
                                })
                              }
                            >
                              Modifica
                            </button>
                            <button
                              className="link danger"
                              onClick={() =>
                                confirm("Eliminare questo movimento?") && remove.mutate(c.id)
                              }
                            >
                              Elimina
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ImportedTransfers filter={filter} name={name} />
    </>
  );
}

/** Transfers read from Firefly III: the movement as it happened, whatever it means for the contributions. */
function ImportedTransfers({ filter, name }: { filter: string; name: (id: string) => string }) {
  const transfers = useTransfers();
  if (transfers.error) return <QueryError error={transfers.error} />;
  if (!transfers.data) return <Loading />;
  if (transfers.data.length === 0) return null;
  const side = (accountId: string | null, fireflyName: string) =>
    accountId ? name(accountId) : `${fireflyName} (non collegato)`;
  const rows = transfers.data.filter(
    (tr) => !filter || tr.fromAccountId === filter || tr.toAccountId === filter,
  );
  return (
    <Card title="Trasferimenti importati da Firefly III">
      <p className="muted small">
        Tutti i trasferimenti tra i tuoi conti letti da Firefly III. Si aggiornano a ogni import;
        per correggerli modificali in Firefly III. I contributi che ne derivano sono in «Movimenti
        registrati».
      </p>
      {rows.length === 0 ? (
        <EmptyState>Nessun trasferimento per questo conto.</EmptyState>
      ) : (
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Da</th>
                <th>A</th>
                <th>Descrizione</th>
                <th className="num">Importo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((tr: Transfer) => (
                <tr key={tr.id}>
                  <td>{formatDate(tr.date)}</td>
                  <td>{side(tr.fromAccountId, tr.fromName)}</td>
                  <td>{side(tr.toAccountId, tr.toName)}</td>
                  <td className="small">{tr.description}</td>
                  <td className="num">{formatEuro(tr.amount, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
