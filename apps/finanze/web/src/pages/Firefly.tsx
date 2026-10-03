import { useState, type FormEvent } from "react";
import { apiFetch, errorMessage } from "../api/client";
import { useGet, useWrite } from "../api/hooks";
import type {
  Account,
  FireflyAccount,
  FireflyConnection,
  FireflyImportResult,
  ImportCounts,
} from "../api/types";
import { Banner, Card, EmptyState, Field, Loading, QueryError } from "../components/ui";
import { todayIso } from "../lib/dates";
import {
  CREATE_ACCOUNT,
  defaultImportRange,
  isImportable,
  linkOptions,
  warningText,
} from "../lib/firefly";
import { formatDate, formatEuro } from "../lib/format";

type Message = { kind: "ok" | "error" | "info"; text: string };

/** Each user connects their own Firefly III and imports month-end balances and transfers from it. */
export function Firefly() {
  const connection = useGet<FireflyConnection>("/firefly/connection");
  if (connection.error) return <QueryError error={connection.error} />;
  if (!connection.data) return <Loading />;
  const c = connection.data;
  return (
    <>
      <h1>Firefly III</h1>
      <p className="muted">
        Importa da Firefly III i saldi di fine mese e i trasferimenti tra i tuoi conti. Il
        collegamento è personale: ogni utente usa il proprio Firefly III.
      </p>
      {!c.available ? (
        <Banner kind="error">
          Il server non ha una chiave di cifratura per i token: l'integrazione non è disponibile.
          Vedi il README.
        </Banner>
      ) : (
        <>
          <ConnectionCard connection={c} />
          {c.configured && <AccountsCard />}
          {c.configured && <ImportCard />}
        </>
      )}
    </>
  );
}

function ConnectionCard({ connection }: { connection: FireflyConnection }) {
  const save = useWrite<{ baseUrl: string; token: string }, { fireflyVersion: string }>(
    "PUT",
    () => "/firefly/connection",
  );
  const disconnect = useWrite<void>("DELETE", () => "/firefly/connection");
  const [baseUrl, setBaseUrl] = useState(connection.baseUrl ?? "");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState<Message | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await save.mutateAsync({ baseUrl, token });
      setToken("");
      setMessage({ kind: "ok", text: `Collegato a Firefly III ${result.fireflyVersion}.` });
    } catch (e) {
      setMessage({ kind: "error", text: errorMessage(e) });
    }
  }

  return (
    <Card title="Collegamento">
      {connection.configured && (
        <p>
          Collegato a <strong>{connection.baseUrl}</strong>.{" "}
          {connection.lastImportAt
            ? `Ultimo import il ${formatDate(connection.lastImportAt.slice(0, 10))}.`
            : "Nessun import ancora."}
        </p>
      )}
      <form className="stack" onSubmit={submit}>
        <div className="row">
          <Field label="Indirizzo di Firefly III" hint="Ad esempio https://firefly.casa.lan">
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://"
              required
            />
          </Field>
          <Field
            label="Token di accesso personale"
            hint="In Firefly III: Opzioni → Profilo → OAuth → Personal Access Tokens. Viene salvato cifrato e non si può rileggere."
          >
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              required
            />
          </Field>
        </div>
        {message && <Banner kind={message.kind}>{message.text}</Banner>}
        <div className="row">
          <button className="primary" disabled={save.isPending}>
            {save.isPending
              ? "Verifica…"
              : connection.configured
                ? "Aggiorna collegamento"
                : "Collega"}
          </button>
          {connection.configured && (
            <button
              type="button"
              className="link danger"
              onClick={() =>
                confirm(
                  "Scollegare Firefly III? Il token viene dimenticato; i dati importati restano.",
                ) && disconnect.mutate()
              }
            >
              Scollega
            </button>
          )}
        </div>
      </form>
    </Card>
  );
}

function AccountsCard() {
  const firefly = useGet<FireflyAccount[]>("/firefly/accounts");
  const accounts = useGet<Account[]>("/accounts");
  const link = useWrite<{ fireflyAccountId: string; accountId: string }>(
    "PUT",
    ({ fireflyAccountId }) => `/firefly/links/${encodeURIComponent(fireflyAccountId)}`,
    ({ accountId }) => ({ accountId }),
  );
  const unlink = useWrite<string>("DELETE", (id) => `/firefly/links/${encodeURIComponent(id)}`);
  const [message, setMessage] = useState<Message | null>(null);

  if (firefly.error) return <QueryError error={firefly.error} />;
  if (accounts.error) return <QueryError error={accounts.error} />;
  if (!firefly.data || !accounts.data) return <Loading what="conti di Firefly III" />;

  async function choose(account: FireflyAccount, value: string) {
    try {
      if (value === "") {
        await unlink.mutateAsync(account.id);
        setMessage({ kind: "info", text: `«${account.name}» non verrà più importato.` });
        return;
      }
      let accountId = value;
      if (value === CREATE_ACCOUNT) {
        const created = await apiFetch<Account>("POST", "/accounts", {
          name: account.name,
          type: account.suggestedType,
        });
        accountId = created.id;
      }
      await link.mutateAsync({ fireflyAccountId: account.id, accountId });
      setMessage({
        kind: "ok",
        text:
          value === CREATE_ACCOUNT
            ? `Creato il conto «${account.name}». Controlla tipo e parametri nella pagina Conti.`
            : `«${account.name}» collegato.`,
      });
    } catch (e) {
      setMessage({ kind: "error", text: errorMessage(e) });
    }
  }

  const all = firefly.data;
  return (
    <Card title="Conti da importare">
      <p className="muted small">
        Collega ogni conto di Firefly III a un conto di Lifebook. I conti di spesa si indicano nella
        pagina Conti: per loro, per i depositi e per gli immobili i movimenti si leggono già dai
        saldi, quindi l'import crea contributi solo per titoli, investimenti, fondi pensione e
        passività.
      </p>
      {all.length === 0 ? (
        <EmptyState>Firefly III non ha conti attivi o passività.</EmptyState>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Conto in Firefly III</th>
              <th className="num">Saldo oggi</th>
              <th>Conto in Lifebook</th>
            </tr>
          </thead>
          <tbody>
            {all.map((account) => (
              <tr key={account.id}>
                <td>
                  {account.name}
                  <div className="muted small">
                    {account.kind === "liability" ? "Passività" : "Attività"}
                    {account.role ? ` · ${account.role}` : ""}
                    {!account.active ? " · non attivo" : ""}
                  </div>
                </td>
                <td className="num">
                  {isImportable(account)
                    ? formatEuro(account.balance, 2)
                    : `${account.balance} ${account.currencyCode}`}
                </td>
                <td>
                  {isImportable(account) ? (
                    <select
                      aria-label={`Conto Lifebook per ${account.name}`}
                      value={account.linkedAccountId ?? ""}
                      disabled={link.isPending || unlink.isPending}
                      onChange={(e) => void choose(account, e.target.value)}
                    >
                      {linkOptions(account, all, accounts.data).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="muted small">Solo conti in euro</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {message && <Banner kind={message.kind}>{message.text}</Banner>}
    </Card>
  );
}

const describeCounts = (c: ImportCounts, deleted: boolean) =>
  [
    c.created && `${c.created} nuovi`,
    c.updated && `${c.updated} aggiornati`,
    deleted && c.deleted && `${c.deleted} eliminati`,
    c.kept && `${c.kept} tenuti come inseriti a mano`,
    c.unchanged && `${c.unchanged} invariati`,
  ]
    .filter(Boolean)
    .join(", ") || "nessuno";

function ImportCard() {
  const [range, setRange] = useState(() => defaultImportRange(todayIso()));
  const run = useWrite<boolean, FireflyImportResult>(
    "POST",
    () => "/firefly/import",
    (dryRun) => ({ ...range, dryRun }),
  );
  const [result, setResult] = useState<FireflyImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go(dryRun: boolean) {
    setError(null);
    try {
      setResult(await run.mutateAsync(dryRun));
    } catch (e) {
      setResult(null);
      setError(errorMessage(e));
    }
  }

  const names = new Map(result?.accounts.map((a) => [a.accountId, a.accountName]));
  return (
    <Card title="Importa">
      <p className="muted small">
        Per ogni conto collegato si importa il saldo a ogni fine mese del periodo e ogni movimento
        verso o da un altro tuo conto, che trovi nella pagina Trasferimenti. Un nuovo import dello
        stesso periodo aggiorna i dati invece di duplicarli. I saldi e i contributi inseriti a mano
        non vengono mai sovrascritti.
      </p>
      <div className="row">
        <Field label="Dal">
          <input
            type="date"
            value={range.from}
            onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })}
          />
        </Field>
        <Field label="Al" hint="Si importano le fine mese comprese">
          <input
            type="date"
            value={range.to}
            onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })}
          />
        </Field>
      </div>
      <div className="row" style={{ margin: "12px 0" }}>
        <button onClick={() => void go(true)} disabled={run.isPending}>
          Anteprima
        </button>
        <button className="primary" onClick={() => void go(false)} disabled={run.isPending}>
          Importa
        </button>
        {run.isPending && <span className="muted small">Lettura da Firefly III…</span>}
      </div>
      {error && <Banner kind="error">{error}</Banner>}
      {result && (
        <>
          <Banner kind={result.dryRun ? "info" : "ok"}>
            {result.dryRun
              ? "Anteprima: non è stato salvato nulla. Ecco cosa farebbe l'import."
              : `Import completato: ${result.dates.length} fine mese dal ${formatDate(result.dates[0])} al ${formatDate(result.dates.at(-1))}.`}
          </Banner>
          <p>
            <strong>Movimenti completi (entrate, uscite e aperture):</strong>{" "}
            {result.movements && describeCounts(result.movements, true)}.
          </p>
          <p>
            <strong>Trasferimenti tra i tuoi conti:</strong>{" "}
            {describeCounts(result.transfers, true)}.
          </p>
          <table>
            <thead>
              <tr>
                <th>Conto</th>
                <th>Saldi</th>
                <th>Contributi</th>
              </tr>
            </thead>
            <tbody>
              {result.accounts.map((a) => (
                <tr key={a.accountId}>
                  <td>
                    {a.accountName}
                    {a.fireflyAccountName && a.fireflyAccountName !== a.accountName && (
                      <div className="muted small">da {a.fireflyAccountName}</div>
                    )}
                  </td>
                  <td className="small">{describeCounts(a.snapshots, false)}</td>
                  <td className="small">{describeCounts(a.contributions, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.warnings.map((w, i) => (
            <Banner key={i}>{warningText(w, names.get(w.accountId) ?? "?")}</Banner>
          ))}
        </>
      )}
    </Card>
  );
}
