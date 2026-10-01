import { useState } from "react";
import { useGet } from "../api/hooks";
import { accountNamer, useAccounts } from "../api/queries";
import type { ReturnsPayload } from "../api/types";
import { Bars } from "../components/Charts";
import { useRangeControl } from "../components/RangeControl";
import { Card, EmptyState, Loading, QueryError } from "../components/ui";
import { returnsRows } from "../lib/charts";
import { formatDate, formatEuro, formatPercent } from "../lib/format";
import { accountSummaries, gainShare, totalSummary, type ReturnSummary } from "../lib/returnsView";
import { inRange } from "../lib/range";

const METHOD_TEXT = {
  declared: "saldo meno contributi",
  inferred: "interessi al tasso dichiarato",
  real_estate_income: "affitto netto più rivalutazione",
  appreciation: "rivalutazione",
  property_value: "affitti incassati più rivalutazione, sul valore dell'immobile",
} as const;

export function Returns() {
  const { range, control } = useRangeControl("all");
  const returns = useGet<ReturnsPayload>("/results/returns");
  const accounts = useAccounts();
  const [selected, setSelected] = useState<string>("");

  if (returns.error || accounts.error)
    return <QueryError error={returns.error ?? accounts.error} />;
  if (!returns.data || !accounts.data) return <Loading />;
  const name = accountNamer(accounts.data);
  const summaries = accountSummaries(returns.data, range);
  const total = totalSummary(returns.data, range);
  const account = selected || summaries[0]?.accountId || "";
  const records = returns.data.records.filter(
    (r) => r.accountId === account && inRange(r.to, range),
  );

  const row = (s: ReturnSummary, label: string, strong = false) => (
    <tr key={s.accountId ?? "total"}>
      <td>{strong ? <strong>{label}</strong> : label}</td>
      <td className="num">{s.periods}</td>
      <td className="num">{formatPercent(s.gross, 2)}</td>
      <td className="num">{formatPercent(s.net, 2)}</td>
      <td className="num">{formatPercent(s.grossAnnualized, 2)}</td>
      <td className="num">{formatPercent(s.netAnnualized, 2)}</td>
      <td className="num">{formatEuro(s.grossGain)}</td>
      <td className="num">{formatEuro(s.netGain)}</td>
      <td className="num">{formatPercent(gainShare(s, total), 1)}</td>
      <td className="num">{formatEuro(s.passiveNet)}</td>
    </tr>
  );

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Rendimenti</h1>
        {control}
      </div>
      {summaries.length === 0 ? (
        <Card>
          <EmptyState>
            Servono almeno due letture di un conto (non di spesa) per calcolare un rendimento.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card title="Riepilogo dell'intervallo">
            <div className="scroll-x">
              <table>
                <thead>
                  <tr>
                    <th>Conto</th>
                    <th className="num">Periodi</th>
                    <th className="num">Lordo</th>
                    <th className="num">Netto</th>
                    <th className="num">Lordo annuo</th>
                    <th className="num">Netto annuo</th>
                    <th className="num">Guadagno lordo</th>
                    <th className="num">Guadagno netto</th>
                    <th className="num">Quota del totale</th>
                    <th className="num">Rendite passive nette</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map((s) => row(s, name(s.accountId!)))}
                  {total && row(total, "Totale", true)}
                </tbody>
              </table>
            </div>
            <p className="muted small">
              Rendimento cumulato dei periodi (composto), con il metodo Modified Dietz per pesare i
              versamenti. Il netto applica l'aliquota del conto. I guadagni sono in euro, sommati
              sui periodi; la quota del totale è la parte del guadagno netto complessivo che viene
              da ogni conto (negativa se il conto ha perso).
            </p>
          </Card>

          <Card
            title="Storico per conto"
            actions={
              <select
                value={account}
                onChange={(e) => setSelected(e.target.value)}
                aria-label="Conto"
              >
                {summaries.map((s) => (
                  <option key={s.accountId} value={s.accountId!}>
                    {name(s.accountId!)}
                  </option>
                ))}
              </select>
            }
          >
            <Bars
              rows={returnsRows(returns.data, account, range)}
              format={(v) => formatPercent(v, 1)}
              series={[
                { key: "gross", label: "Lordo" },
                { key: "net", label: "Netto" },
              ]}
            />
            <div className="scroll-x" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>Periodo</th>
                    <th>Calcolo</th>
                    <th className="num">Saldo iniziale</th>
                    <th className="num">Contributi</th>
                    <th className="num">Saldo finale</th>
                    <th className="num">Lordo</th>
                    <th className="num">Netto</th>
                    <th className="num">Annuo netto</th>
                  </tr>
                </thead>
                <tbody>
                  {[...records].reverse().map((r) => (
                    <tr key={`${r.accountId}-${r.to}`}>
                      <td>
                        {formatDate(r.from)} → {formatDate(r.to)}
                      </td>
                      <td className="small muted">{METHOD_TEXT[r.method]}</td>
                      <td className="num">{formatEuro(r.opening)}</td>
                      <td className="num">{formatEuro(r.contributions)}</td>
                      <td className="num">{formatEuro(r.closing)}</td>
                      <td className="num">
                        {formatEuro(r.grossGain)} · {formatPercent(r.grossPct, 2)}
                      </td>
                      <td className="num">
                        {formatEuro(r.netGain)} · {formatPercent(r.netPct, 2)}
                      </td>
                      <td className="num">{formatPercent(r.netAnnualized, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
