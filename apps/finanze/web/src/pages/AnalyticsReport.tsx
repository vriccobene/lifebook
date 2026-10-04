import { useMemo } from "react";
import { useGet } from "../api/hooks";
import { useAccounts, useSnapshots } from "../api/queries";
import type { FireflyMovement, SettingsResponse } from "../api/types";
import { Bars, LineSeries, formatPct } from "../components/Charts";
import { MethodsTable, metricText } from "../components/MethodsTable";
import { Banner, Card, EmptyState, Loading, QueryError } from "../components/ui";
import { TYPE_LABELS } from "../lib/analytics";
import {
  analyticsHref,
  readAnalyticsFilters,
  type AnalyticsFilters,
} from "../lib/analyticsFilters";
import { computeAnalyticsReport } from "../lib/analyticsReport";
import { formatDate, formatEuro, formatNumber, formatMonth } from "../lib/format";
import { METHOD_LABELS } from "../lib/labels";
import "./analytics.css";

const VERDICT_TEXT: Record<string, string> = {
  green: "Verde: obiettivo raggiunto nel report",
  yellow: "Giallo: manca un solo metodo",
  red: "Rosso: obiettivo non ancora raggiunto",
  missing_data: "Dati insufficienti per un verdetto",
};

function FilterSummary({ filters: f }: { filters: AnalyticsFilters }) {
  const values = [
    ["Periodo", `${formatDate(f.from)} – ${formatDate(f.to)}`],
    ["Categoria", f.category],
    ["Categorie incluse", f.includedCategories.join(", ")],
    ["Categorie escluse", f.excludedCategories.join(", ")],
    ["Conto / controparte", f.account],
    ["Conti / controparti esclusi", f.excludedAccounts.join(", ")],
    ["Ricerca", f.search],
    ["Tag", f.tag],
    ["Tipo", TYPE_LABELS[f.type] ?? f.type],
    [
      "Spese",
      (
        {
          essential: "Essenziali",
          discretionary: "Discrezionali",
          unclassified: "Da classificare",
        } as Record<string, string>
      )[f.classification],
    ],
    [
      "Conteggio",
      f.inclusion === "included"
        ? "Solo inclusi"
        : f.inclusion === "excluded"
          ? "Solo esclusi"
          : "Tutti; i movimenti esclusi non contribuiscono ai totali",
    ],
    ["Rendite", f.yieldOnly ? "Solo rendite" : ""],
  ];
  return (
    <Card title="Filtri del report">
      <dl className="report-filters">
        {values
          .filter(([, v]) => v)
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
    </Card>
  );
}

export function AnalyticsReport() {
  const filters = readAnalyticsFilters();
  if (!filters)
    return (
      <>
        <h1>Report Analytics</h1>
        <Banner kind="error">
          I filtri del report non sono validi. Torna ad Analytics e genera un nuovo report.
        </Banner>
        <a href="#/analytics">Torna ad Analytics</a>
      </>
    );
  return <ReportContent filters={filters} />;
}

function ReportContent({ filters }: { filters: AnalyticsFilters }) {
  const movements = useGet<FireflyMovement[]>("/firefly/movements");
  const accounts = useAccounts();
  const snapshots = useSnapshots();
  const settings = useGet<SettingsResponse>("/settings");
  const result = useMemo(() => {
    if (!movements.data || !accounts.data || !snapshots.data || !settings.data) return null;
    const compute = (to: string) =>
      computeAnalyticsReport(
        movements.data!,
        accounts.data!,
        snapshots.data!,
        settings.data!.entries,
        { ...filters, to },
      );
    const report = compute(filters.to);
    const history = report.monthly.map((month) => {
      const point = compute(month.to);
      const savings = point.methods.find((m) => m.id === "savings_rate");
      return {
        date: month.to,
        netWorth: point.capital.balances.length ? point.capital.netWorth : null,
        cost: point.livingCost.referenceMonthly,
        savings: savings?.metric?.value ?? null,
        ...Object.fromEntries(point.methods.map((m) => [m.id, m.coverage])),
      };
    });
    return { report, history };
  }, [movements.data, accounts.data, snapshots.data, settings.data, filters]);
  const error = [movements, accounts, snapshots, settings].find((q) => q.error)?.error;
  if (error) return <QueryError error={error} />;
  if (!result) return <Loading what="report" />;
  const { report: r, history } = result;
  const savings = r.methods.find((m) => m.id === "savings_rate");
  const methodIds = r.methods.filter((m) => m.coverage !== null).map((m) => m.id);
  const monthly = r.monthly.map((m) => ({ ...m, date: m.to }));
  const flowCount = r.rows.filter(
    (m) => m.annotation?.included !== false && ["deposit", "withdrawal"].includes(m.type),
  ).length;
  return (
    <div className="analytics analytics-report">
      <div className="analytics-heading">
        <div>
          <div className="analytics-eyebrow">IL TUO CRUSCOTTO PER CATEGORIE</div>
          <h1>Report Analytics</h1>
          <p>
            {formatDate(filters.from)} – {formatDate(filters.to)} · {r.rows.length} movimenti
            selezionati
          </p>
        </div>
        <div className="row report-actions">
          <a className="button" href={analyticsHref("/analytics", filters)}>
            Modifica filtri
          </a>
          <button onClick={() => window.print()}>Stampa / Salva PDF</button>
        </div>
      </div>
      <FilterSummary filters={filters} />
      <Banner kind="info">
        <strong>Scenario basato sui filtri.</strong> Costo della vita, entrate e rendite derivano
        solo dai movimenti selezionati. Il patrimonio usa gli ultimi saldi disponibili dei conti
        selezionati al {formatDate(filters.to)}: categorie, tag e ricerca non suddividono i saldi.
        Il verdetto descrive questo perimetro, non l’intero bilancio personale.
      </Banner>
      {!flowCount && (
        <Card>
          <EmptyState>
            Nessuna entrata o spesa conteggiabile con questi filtri. Modifica i filtri per calcolare
            gli indicatori.
          </EmptyState>
        </Card>
      )}
      {r.livingCost.referenceMonthly === null && (
        <Banner>
          Non ci sono spese conteggiabili nel report: il costo della vita e i metodi che ne
          dipendono non sono disponibili.
        </Banner>
      )}
      {!r.capital.balances.length && (
        <Banner>Non ci sono saldi disponibili per i conti selezionati alla data finale.</Banner>
      )}
      <section className={`card verdict ${r.verdict.status}`} aria-label="Verdetto del report">
        <div>
          <div className="eyebrow">IL TUO OBIETTIVO NEL PERIMETRO SELEZIONATO</div>
          <h2>{VERDICT_TEXT[r.verdict.status]}</h2>
          <p>
            {r.verdict.greenCount} metodi verdi su{" "}
            {r.verdict.green.length + r.verdict.notGreen.length} valutati · servono{" "}
            {r.verdict.minGreenMethods}
          </p>
          <progress
            className="verdict-progress"
            value={r.verdict.greenCount}
            max={Math.max(1, r.verdict.minGreenMethods)}
            aria-label="Metodi verdi rispetto all’obiettivo"
          />
          {r.verdict.determining.length > 0 && (
            <p>
              {r.verdict.status === "green" ? "Lo determinano" : "Per arrivare al verde"}:{" "}
              {r.verdict.determining.map((id) => METHOD_LABELS[id] ?? id).join(", ")}
            </p>
          )}
        </div>
      </section>
      <div className="grid kpis report-kpis">
        {[
          [
            "Costo della vita (mensile)",
            formatEuro(r.livingCost.referenceMonthly),
            `media sul periodo · ${formatNumber(r.duration, 2)} mesi equivalenti`,
          ],
          [
            "Patrimonio netto",
            formatEuro(r.capital.balances.length ? r.capital.netWorth : null),
            "saldi dei conti selezionati alla data finale",
          ],
          [
            "Capitale investibile",
            formatEuro(r.capital.balances.length ? r.capital.investable : null),
            `dopo il buffer di ${formatEuro(r.capital.emergencyBuffer)}`,
          ],
          [
            "Tasso di risparmio",
            metricText(savings),
            `entrate nette ${formatEuro(r.livingCost.incomeMonthly)} al mese`,
          ],
        ].map(([label, value, sub]) => (
          <Card key={label}>
            <div className="kpi">
              <div className="label">{label}</div>
              <div className="value">{value}</div>
              <div className="sub">{sub}</div>
            </div>
          </Card>
        ))}
      </div>
      <Card title="Posso smettere di lavorare? Metodi a confronto">
        <MethodsTable methods={r.methods} />
        <p className="small muted">
          Rendite nette selezionate annualizzate: {formatEuro(r.capital.passiveNetAnnual)}/anno.
          Pensione pubblica:{" "}
          {r.settings.publicPension.enabled ? "attiva secondo le impostazioni" : "esclusa"}.
          Parametri di pianificazione validi al {formatDate(filters.to)}.
        </p>
        {r.essential === null && (
          <p className="small muted">
            Spesa essenziale non determinabile: completa la classificazione delle spese per
            calcolare il metodo a strati.
          </p>
        )}
      </Card>
      <div className="grid two">
        <Card title="Entrate e spese selezionate">
          <Bars
            rows={monthly}
            series={[
              { key: "income", label: "Entrate nette" },
              { key: "spending", label: "Spese" },
            ]}
          />
        </Card>
        <Card title="Spesa essenziale e discrezionale">
          <Bars
            rows={monthly}
            stacked
            series={[
              { key: "essential", label: "Essenziale" },
              { key: "discretionary", label: "Discrezionale" },
              { key: "unclassified", label: "Da classificare" },
            ]}
          />
        </Card>
        <Card title="Patrimonio dei conti nel tempo">
          <LineSeries rows={history} series={[{ key: "netWorth", label: "Patrimonio netto" }]} />
        </Card>
        <Card title="Costo della vita medio progressivo">
          <LineSeries
            rows={history}
            series={[{ key: "cost", label: "Media dall’inizio del periodo" }]}
          />
        </Card>
        <Card title="Tasso di risparmio progressivo">
          <LineSeries
            rows={history}
            format={formatPct}
            series={[{ key: "savings", label: "Tasso di risparmio" }]}
          />
        </Card>
        <Card title="Copertura dei metodi nel tempo">
          <LineSeries
            rows={history}
            format={formatPct}
            series={methodIds.map((id) => ({ key: id, label: METHOD_LABELS[id] ?? id }))}
          />
        </Card>
      </div>
      <Card title="Dettaglio mensile del report">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Mese</th>
                <th>Entrate nette</th>
                <th>Spese</th>
                <th>Saldo</th>
                <th>Rendite nette</th>
              </tr>
            </thead>
            <tbody>
              {r.monthly.map((m) => (
                <tr key={m.date}>
                  <th>{formatMonth(m.date)}</th>
                  <td>{formatEuro(m.income)}</td>
                  <td>{formatEuro(m.spending)}</td>
                  <td>{formatEuro(m.balance)}</td>
                  <td>{formatEuro(m.yieldNet)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>Totale</th>
                <td>{formatEuro(r.totals.income)}</td>
                <td>{formatEuro(r.totals.spending)}</td>
                <td>{formatEuro(r.totals.balance)}</td>
                <td>{formatEuro(r.totals.yieldNet)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
      <Card title="Come leggere il report">
        <p>
          Le medie coprono l’intero intervallo selezionato, inclusi i mesi senza movimenti. I mesi
          parziali pesano in proporzione ai giorni selezionati. Verifica che l’importazione copra il
          periodo: un mese senza movimenti selezionati contribuisce con zero ai totali.
        </p>
        <p>
          Le rendite incassate sono annualizzate sulla stessa durata; il netto segue le aliquote dei
          conti alla data del movimento. Trasferimenti, saldi iniziali e movimenti annotati come
          esclusi non sono entrate o spese.
        </p>
        <p>
          Il costo a regime coincide con la media delle spese selezionate: non viene sottratta una
          rata che potrebbe essere già esclusa dai filtri. I grafici dei metodi ricalcolano lo
          scenario dall’inizio del periodo fino a ciascun punto.
        </p>
        <p className="muted small">
          Il report si ricalcola sui dati disponibili all’apertura. La stampa o il PDF conservano la
          versione visualizzata.
        </p>
      </Card>
    </div>
  );
}
