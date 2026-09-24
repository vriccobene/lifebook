import type { LivingCostResult } from "../api/types";
import { formatDate, formatEuro, formatMonth } from "../lib/format";
import { warningMessage } from "../lib/labels";
import { Card } from "./ui";

/**
 * How each month's living cost was deduced (Section 5): income minus the change of the spending accounts
 * minus the transfers to the other accounts, with the validations of that period.
 */
export function LivingCostDetail({
  livingCost,
  accountName,
}: {
  livingCost: LivingCostResult;
  accountName: (id: string) => string;
}) {
  const periods = [...livingCost.periods].reverse();
  return (
    <Card title="Come è calcolato il costo della vita">
      <details>
        <summary>Mostra il dettaglio per mese ({periods.length})</summary>
        <p className="muted small">
          Spesa = entrate nette − variazione dei conti di spesa − trasferimenti verso gli altri
          conti. Un rendimento negativo non è una spesa: avviene sui conti che non sono di spesa.
        </p>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>Periodo</th>
                <th className="num">Entrate</th>
                <th className="num">Variazione conti di spesa</th>
                <th className="num">Trasferimenti</th>
                <th className="num">Spesa</th>
                <th className="num">Al mese</th>
                <th>Avvisi</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.to}>
                  <td>
                    {formatMonth(p.to)}
                    <div className="muted small">
                      {formatDate(p.from)} → {formatDate(p.to)}
                      {p.months > 1 ? ` · ${p.months} mesi` : ""}
                    </div>
                  </td>
                  <td className="num">{formatEuro(p.income)}</td>
                  <td className="num">{formatEuro(p.spendingAccountsDelta)}</td>
                  <td className="num">{formatEuro(p.transfers)}</td>
                  <td className="num">{formatEuro(p.spending)}</td>
                  <td className="num">{formatEuro(p.monthlySpending)}</td>
                  <td className="small" style={{ color: "var(--yellow)" }}>
                    {p.warnings.map((w) => warningMessage(w, accountName)).join(" ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  );
}
