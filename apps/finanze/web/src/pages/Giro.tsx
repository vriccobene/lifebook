import { PageHeading } from "../components/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch, errorMessage } from "../api/client";
import { useGet } from "../api/hooks";
import { useAccounts, useContributions, useSnapshots } from "../api/queries";
import type { SettingsResponse } from "../api/types";
import { Banner, Card, EmptyState, Loading, QueryError } from "../components/ui";
import { defaultRoundDate, todayIso } from "../lib/dates";
import { formatDate, formatEuro } from "../lib/format";
import {
  buildGiroRows,
  giroHint,
  initialInputs,
  planGiroSave,
  type GiroInput,
  type GiroOperation,
  type GiroRow,
} from "../lib/giro";
import { ACCOUNT_TYPE_LABELS } from "../lib/labels";

async function run(op: GiroOperation): Promise<void> {
  switch (op.type) {
    case "create-snapshot":
      await apiFetch("POST", "/snapshots", {
        accountId: op.accountId,
        date: op.date,
        balance: op.balance,
        source: "manual",
      });
      break;
    case "update-snapshot":
      await apiFetch("PATCH", `/snapshots/${op.id}`, { balance: op.balance });
      break;
    case "delete-contribution":
      await apiFetch("DELETE", `/contributions/${op.id}`);
      break;
    case "create-contribution":
      await apiFetch("POST", "/contributions", {
        accountId: op.accountId,
        date: op.date,
        amount: op.amount,
      });
      break;
  }
}

/** The whole monthly round on one screen: previous balance, new balance and, where it applies, contributions. */
export function Giro() {
  const [date, setDate] = useState(() => defaultRoundDate(todayIso()));
  // Kept here: the table is rebuilt when the data is reloaded after saving, the message must survive.
  const [status, setStatus] = useState<Status | null>(null);
  const accounts = useAccounts();
  const snapshots = useSnapshots();
  const contributions = useContributions();
  const settings = useGet<SettingsResponse>(`/settings?asOf=${date}`);

  const error = [accounts, snapshots, contributions].find((r) => r.error)?.error;
  if (error) return <QueryError error={error} />;
  if (!accounts.data || !snapshots.data || !contributions.data) return <Loading />;

  const rows = buildGiroRows(accounts.data, snapshots.data, contributions.data, date);
  const threshold = settings.data?.effective.declaredBalanceChangeThreshold ?? 0.1;
  const version = `${date}-${snapshots.dataUpdatedAt}-${contributions.dataUpdatedAt}`;

  return (
    <>
      <div className="toolbar">
        <PageHeading title="Giro mensile" eyebrow="LA TUA ABITUDINE MENSILE">
          Aggiorna i saldi e registra i contributi. Il quadro si ricalcola da qui.
        </PageHeading>
        <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <span>Data di riferimento</span>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              if (e.target.value) {
                setDate(e.target.value);
                setStatus(null);
              }
            }}
          />
        </label>
      </div>
      {rows.length === 0 ? (
        <Card>
          <EmptyState>
            Non ci sono conti. Creali in <a href="#/conti">Conti</a>.
          </EmptyState>
        </Card>
      ) : (
        <GiroTable
          key={version}
          rows={rows}
          date={date}
          threshold={threshold}
          status={status}
          setStatus={setStatus}
        />
      )}
    </>
  );
}

type Status = { kind: "ok" | "error"; text: string };

export function GiroTable({
  rows,
  date,
  threshold,
  status,
  setStatus,
}: {
  rows: GiroRow[];
  date: string;
  threshold: number;
  status: Status | null;
  setStatus: (status: Status | null) => void;
}) {
  const client = useQueryClient();
  const [inputs, setInputs] = useState<Record<string, GiroInput>>(() => initialInputs(rows));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const set = (id: string, patch: Partial<GiroInput>) =>
    setInputs((current) => ({ ...current, [id]: { ...current[id]!, ...patch } }));

  async function save() {
    const plan = planGiroSave(rows, inputs, date);
    setErrors(plan.errors);
    if (Object.keys(plan.errors).length > 0) {
      setStatus({ kind: "error", text: "Correggi i valori segnalati." });
      return;
    }
    if (plan.operations.length === 0) {
      setStatus({ kind: "ok", text: "Niente da salvare: i valori sono già registrati." });
      return;
    }
    setBusy(true);
    let done = 0;
    try {
      for (const op of plan.operations) {
        await run(op);
        done++;
      }
      setStatus({ kind: "ok", text: `Giro del ${formatDate(date)} salvato (${done} modifiche).` });
    } catch (e) {
      setStatus({
        kind: "error",
        text: `Salvataggio interrotto dopo ${done} modifiche: ${errorMessage(e)}`,
      });
    } finally {
      setBusy(false);
      await client.invalidateQueries({ queryKey: ["api"] });
    }
  }

  return (
    <Card>
      <div className="scroll-x">
        <table className="giro">
          <thead>
            <tr>
              <th>Conto</th>
              <th className="num">Saldo precedente</th>
              <th className="num">Nuovo saldo</th>
              <th className="num">Contributi</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const input = inputs[row.account.id]!;
              const hint = giroHint(row, input, threshold);
              return (
                <RowView
                  key={row.account.id}
                  row={row}
                  input={input}
                  error={errors[row.account.id]}
                  hint={hint}
                  set={set}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <button className="primary" onClick={save} disabled={busy}>
          {busy ? "Salvataggio…" : "Salva giro"}
        </button>
        <span className="muted small">
          Le righe vuote vengono ignorate. I contributi sono positivi per un versamento e negativi
          per un prelievo.
        </span>
      </div>
      {status && (
        <div style={{ marginTop: 12 }}>
          <Banner kind={status.kind === "ok" ? "ok" : "error"}>{status.text}</Banner>
        </div>
      )}
    </Card>
  );
}

function RowView({
  row,
  input,
  error,
  hint,
  set,
}: {
  row: GiroRow;
  input: GiroInput;
  error: string | undefined;
  hint: string | null;
  set: (id: string, patch: Partial<GiroInput>) => void;
}) {
  const id = row.account.id;
  const previous = row.previous;
  return (
    <>
      <tr>
        <td>
          <strong>{row.account.name}</strong>
          <div className="muted small">
            {ACCOUNT_TYPE_LABELS[row.account.type]}
            {row.account.institution ? ` · ${row.account.institution}` : ""}
          </div>
        </td>
        <td className="num">
          {previous ? (
            <>
              {formatEuro(previous.balance, 2)}
              <div className="muted small">{formatDate(previous.date)}</div>
              <button
                className="link"
                type="button"
                onClick={() => set(id, { balance: String(previous.balance).replace(".", ",") })}
              >
                Invariato
              </button>
            </>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        <td className="num">
          <input
            inputMode="decimal"
            aria-label={`Nuovo saldo ${row.account.name}`}
            aria-invalid={error ? true : undefined}
            value={input.balance}
            onChange={(e) => set(id, { balance: e.target.value })}
            placeholder={row.existing ? "" : "0,00"}
          />
          {row.existing && <div className="muted small">già registrato</div>}
        </td>
        <td className="num">
          {row.showContribution ? (
            <input
              inputMode="decimal"
              aria-label={`Contributi ${row.account.name}`}
              value={input.contribution}
              onChange={(e) => set(id, { contribution: e.target.value })}
              placeholder="0,00"
            />
          ) : (
            <span className="muted">—</span>
          )}
        </td>
      </tr>
      {(error || hint) && (
        <tr>
          <td colSpan={4} className="hint" style={error ? { color: "var(--red)" } : undefined}>
            {error ?? hint}
          </td>
        </tr>
      )}
    </>
  );
}
