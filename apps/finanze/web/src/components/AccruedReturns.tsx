import { resolveAccountParams } from "@lifebook/finanze-core";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useGet, useWrite } from "../api/hooks";
import type { Account, FireflyMovement, ReturnsPayload } from "../api/types";
import { accruedReturns } from "../lib/accruedReturns";
import { formatDate, formatEuro, formatPercent, parseDecimal } from "../lib/format";
import type { DateRange } from "../lib/range";
import { Banner, Field, Loading, QueryError } from "./ui";

const money = (v: number) => formatEuro(v, 2);

export function AccruedReturns({
  range,
  movements,
  accountName,
  excludedNames,
}: {
  range: DateRange;
  movements: FireflyMovement[];
  accountName: string;
  excludedNames: string[];
}) {
  const valid = Boolean(range.from && range.to && range.from <= range.to);
  const accounts = useGet<Account[]>("/accounts");
  const returns = useGet<ReturnsPayload>(`/results/returns?asOf=${encodeURIComponent(range.to)}`, {
    enabled: valid,
  });
  const [editing, setEditing] = useState<Account | null>(null);
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  if (!valid) return null;
  return (
    <section className="analytics-panel accrued-panel" aria-label="Rendimenti maturati">
      <div className="toolbar">
        <div>
          <div className="analytics-eyebrow">VALORE MATURATO · STIMA</div>
          <h2>
            <button
              className="accrued-toggle"
              aria-expanded={expanded}
              aria-controls={contentId}
              onClick={() => setExpanded(!expanded)}
            >
              Rendimenti dei conti, anche senza vendere{" "}
              <span aria-hidden="true">{expanded ? "▴" : "▾"}</span>
            </button>
          </h2>
        </div>
        <a href="#/rendimenti">Storico rendimenti ↗</a>
      </div>
      <div id={contentId} hidden={!expanded}>
        <p className="muted small">
          Il rendimento lordo deriva dalle variazioni di saldo, al netto del capitale versato o
          prelevato. Il netto è una stima dopo le imposte configurate per ogni conto, anche se non
          hai ancora venduto.
        </p>
        {accounts.error || returns.error ? (
          <QueryError error={accounts.error ?? returns.error} />
        ) : !accounts.data || !returns.data ? (
          <Loading what="rendimenti maturati" />
        ) : (
          (() => {
            const summary = accruedReturns(
              returns.data,
              accounts.data,
              movements,
              range,
              accountName,
              excludedNames,
            );
            return (
              <>
                <div className="accrued-metrics">
                  <div>
                    <span>Rendimento lordo</span>
                    <strong>
                      {summary.rows.length ? money(summary.gross) : "Non disponibile"}
                    </strong>
                  </div>
                  <div>
                    <span>Netto stimato alla vendita</span>
                    <strong>{summary.rows.length ? money(summary.net) : "Non disponibile"}</strong>
                  </div>
                  <div>
                    <span>Imposte stimate</span>
                    <strong>{summary.rows.length ? money(summary.tax) : "Non disponibile"}</strong>
                  </div>
                </div>
                {summary.rows.length ? (
                  <div className="scroll-x">
                    <table>
                      <thead>
                        <tr>
                          <th>Conto</th>
                          <th>Periodo misurato</th>
                          <th className="num">Lordo</th>
                          <th className="num">Netto stimato</th>
                          <th className="num">Imposte</th>
                          <th>Aliquota alla data finale</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {summary.rows.map((row) => (
                          <tr key={row.account.id}>
                            <td>{row.account.name}</td>
                            <td className="small">
                              {formatDate(row.from)} → {formatDate(row.to)}
                            </td>
                            <td className="num">{money(row.gross)}</td>
                            <td className="num">{money(row.net)}</td>
                            <td className="num">{money(row.tax)}</td>
                            <td>
                              {formatPercent(
                                resolveAccountParams(row.account, range.to).taxRate,
                                2,
                              )}
                            </td>
                            <td>
                              <button
                                onClick={() => setEditing(row.account)}
                                aria-label={`Imposta tassazione ${row.account.name}`}
                              >
                                Tassazione
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="muted">
                    Servono almeno due letture di saldo di un conto non di spesa. Importa i saldi da
                    Firefly o aggiungili in Conti; verifica anche i filtri sui conti.
                  </p>
                )}
                <p className="muted small">
                  Include i periodi di lettura chiusi nell’intervallo selezionato; le date effettive
                  sono indicate per conto. Qui valgono i filtri per data e conto, mentre categorie,
                  tag e classificazioni si applicano ai movimenti incassati. Un’aliquota del 0%
                  evita ulteriori trattenute sugli importi già tassati. La stima usa l’aliquota del
                  conto sui guadagni dei singoli periodi, senza compensare perdite o ricostruire il
                  costo fiscale dei titoli.
                </p>
                <p className="muted small">
                  I trasferimenti da Directa e dagli altri conti sono capitale movimentato: non sono
                  rendimenti e non vengono sommati a questi valori. Il rendimento maturato resta
                  separato dalle entrate incassate. Per più precisione puoi creare un conto per ogni
                  investimento.
                </p>
              </>
            );
          })()
        )}
      </div>
      {editing && (
        <TaxEditor
          key={editing.id}
          account={editing}
          range={range}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function TaxEditor({
  account,
  range,
  onClose,
}: {
  account: Account;
  range: DateRange;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const taxInput = useRef<HTMLInputElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    taxInput.current?.focus();
    return () => element?.close();
  }, []);
  const [tax, setTax] = useState(String(resolveAccountParams(account, range.to).taxRate * 100));
  const [validFrom, setValidFrom] = useState(range.from);
  const [error, setError] = useState("");
  const write = useWrite<{ id: string; body: { validFrom: string; taxRate: number } }>(
    "POST",
    ({ id }) => `/accounts/${encodeURIComponent(id)}/params`,
    ({ body }) => body,
  );
  async function save(e: FormEvent) {
    e.preventDefault();
    const value = parseDecimal(tax);
    if (value === null || value < 0 || value > 100) {
      setError("Inserisci un’aliquota tra 0 e 100%.");
      return;
    }
    try {
      await write.mutateAsync({ id: account.id, body: { validFrom, taxRate: value / 100 } });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Salvataggio non riuscito");
    }
  }
  return (
    <dialog
      ref={dialog}
      className="analytics-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        if (write.isPending) e.preventDefault();
        else onClose();
      }}
    >
      <div className="toolbar">
        <h2 id={titleId}>Tassazione · {account.name}</h2>
        <button
          type="button"
          aria-label="Chiudi tassazione"
          disabled={write.isPending}
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <form
        className="stack"
        onSubmit={(e) => void save(e)}
        aria-label={`Tassazione ${account.name}`}
      >
        {error && <Banner kind="error">{error}</Banner>}
        <div className="row">
          <Field label="Aliquota (%)">
            <input
              ref={taxInput}
              inputMode="decimal"
              value={tax}
              onChange={(e) => setTax(e.target.value)}
              required
            />
          </Field>
          <Field label="Valida dal">
            <input
              type="date"
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
              required
            />
          </Field>
          <button className="primary" disabled={write.isPending}>
            {write.isPending ? "Salvataggio…" : "Salva aliquota"}
          </button>
          <button type="button" onClick={onClose} disabled={write.isPending}>
            Annulla
          </button>
        </div>
        <p className="muted small">
          Inserisci 0 se gli importi sono già tassati. La modifica è salvata nei parametri del conto
          dalla data scelta e aggiorna anche la pagina Rendimenti e la pianificazione.
        </p>
      </form>
    </dialog>
  );
}
