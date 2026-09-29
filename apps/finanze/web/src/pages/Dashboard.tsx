import { useGet } from "../api/hooks";
import { accountNamer, useAccounts, useSnapshots } from "../api/queries";
import type {
  LivingCostPayload,
  MethodsPayload,
  NetWorthPayload,
  VerdictPayload,
} from "../api/types";
import { DashboardCharts } from "../components/DashboardCharts";
import { useRangeControl } from "../components/RangeControl";
import { LivingCostDetail } from "../components/LivingCostDetail";
import { MethodsTable, metricText } from "../components/MethodsTable";
import { Banner, Card, EmptyState, Loading, QueryError } from "../components/ui";
import { formatEuro, formatNumber } from "../lib/format";
import { METHOD_LABELS, warningMessage } from "../lib/labels";

const VERDICT_TEXT: Record<string, string> = {
  green: "Verde: l'obiettivo è raggiunto",
  yellow: "Giallo: manca un solo metodo",
  red: "Rosso: obiettivo non ancora raggiunto",
  missing_data: "Dati insufficienti per un verdetto",
};

function names(ids: readonly string[]): string {
  return ids.map((id) => METHOD_LABELS[id] ?? id).join(", ");
}

export function Dashboard() {
  const { range, control } = useRangeControl("1y");
  const accounts = useAccounts();
  const snapshots = useSnapshots();
  const verdict = useGet<VerdictPayload>("/results/verdict");
  const methods = useGet<MethodsPayload>("/results/methods");
  const netWorth = useGet<NetWorthPayload>("/results/net-worth");
  const living = useGet<LivingCostPayload>("/results/living-cost");

  const accountName = accountNamer(accounts.data);

  const error = [verdict, methods, netWorth, living, accounts, snapshots].find(
    (r) => r.error,
  )?.error;
  if (error) return <QueryError error={error} />;
  if (!verdict.data || !methods.data || !netWorth.data || !living.data) return <Loading />;
  if (snapshots.data && snapshots.data.length === 0) {
    return (
      <>
        <h1>Cruscotto</h1>
        <Card>
          <EmptyState>
            Non ci sono ancora saldi. Crea i conti in <a href="#/conti">Conti</a> e inserisci i
            saldi nel <a href="#/giro">Giro mensile</a>.
          </EmptyState>
        </Card>
      </>
    );
  }

  const v = verdict.data.verdict;
  const cost = living.data.livingCost;
  const savings = methods.data.methods.find((m) => m.id === "savings_rate");
  const warnings = methods.data.warnings;
  const otherMetrics = methods.data.methods.filter((m) => m.family === "E");

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Cruscotto</h1>
        {control}
      </div>

      {!verdict.data.publicPensionEnabled && (
        <Banner kind="info">
          <strong>Senza pensione pubblica.</strong> Nessun metodo la considera. Puoi attivarla in{" "}
          <a href="#/impostazioni">Impostazioni</a>.
        </Banner>
      )}

      <section className={`card verdict ${v.status}`} aria-label="Verdetto">
        <div>
          <div className="big">{VERDICT_TEXT[v.status]}</div>
          <div className="muted">
            {v.greenCount} metodi verdi su {v.green.length + v.notGreen.length} valutati · servono{" "}
            {v.minGreenMethods}
          </div>
        </div>
        <div className="stack small" style={{ flex: 1, minWidth: 240 }}>
          {v.determining.length > 0 && (
            <div>
              <strong>{v.status === "green" ? "Lo determinano:" : "Per arrivare al verde:"}</strong>{" "}
              {names(v.determining)}
            </div>
          )}
          {v.excluded.length > 0 && (
            <div className="muted">Esclusi per dati mancanti: {names(v.excluded)}</div>
          )}
        </div>
      </section>

      <div className="grid kpis" style={{ marginBottom: 16 }}>
        <Card>
          <div className="kpi">
            <div className="label">Costo della vita (mensile)</div>
            <div className="value">{formatEuro(cost.referenceMonthly)}</div>
            <div className="sub">
              media {cost.referenceWindow} mesi · a regime {formatEuro(cost.regimeMonthly)}
            </div>
          </div>
        </Card>
        <Card>
          <div className="kpi">
            <div className="label">Patrimonio netto</div>
            <div className="value">{formatEuro(netWorth.data.netWorth)}</div>
            <div className="sub">
              aggiornato al {netWorth.data.asOf.split("-").reverse().join("/")}
            </div>
          </div>
        </Card>
        <Card>
          <div className="kpi">
            <div className="label">Capitale investibile</div>
            <div className="value">{formatEuro(netWorth.data.investable)}</div>
            <div className="sub">dopo il buffer di {formatEuro(netWorth.data.emergencyBuffer)}</div>
          </div>
        </Card>
        <Card>
          <div className="kpi">
            <div className="label">Tasso di risparmio</div>
            <div className="value">{metricText(savings)}</div>
            <div className="sub">entrate nette {formatEuro(cost.incomeMonthly)} al mese</div>
          </div>
        </Card>
      </div>

      {warnings.length > 0 && (
        <Card title="Avvisi sui dati">
          <ul className="stack small" style={{ margin: 0, paddingLeft: "1.1rem" }}>
            {warnings.map((w, i) => (
              <li key={`${w.code}-${w.accountId}-${w.to}-${i}`}>
                {warningMessage(w, accountName)}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Posso smettere di lavorare? Metodi a confronto">
        <MethodsTable methods={methods.data.methods} />
        <div className="row" style={{ marginTop: 12 }}>
          {otherMetrics.map((m) => (
            <span key={m.id} className="small">
              <span className="muted">{METHOD_LABELS[m.id]}:</span> <strong>{metricText(m)}</strong>
            </span>
          ))}
          <span className="small">
            <span className="muted">Liquidità:</span>{" "}
            <strong>{formatEuro(netWorth.data.liquidity)}</strong>
          </span>
          <span className="small">
            <span className="muted">Rendite passive nette:</span>{" "}
            <strong>{formatEuro(netWorth.data.passiveNetAnnual)}/anno</strong>
          </span>
          <span className="small">
            <span className="muted">Rendimento atteso:</span>{" "}
            <strong>{formatNumber(netWorth.data.portfolioReturn * 100, 1)}%</strong>
          </span>
        </div>
      </Card>

      <LivingCostDetail livingCost={cost} accountName={accountName} />

      <h2>Storico</h2>
      <DashboardCharts range={range} />
    </>
  );
}
