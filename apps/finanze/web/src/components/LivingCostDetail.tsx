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
          Nei periodi interamente importati, la spesa è la somma delle uscite Firefly di tutti i
          conti, inclusi i costi degli investimenti. Le entrate manuali non si sommano agli
          accrediti importati. Negli altri periodi: spesa = entrate nette − variazione dei conti di
          spesa − trasferimenti verso gli altri conti. Sui conti a contributi dichiarati, i
          rendimenti non entrano nella spesa: occorre registrare tutti i versamenti e i prelievi.
          Sui conti con movimenti dedotti, il risultato dipende dal tasso di interesse impostato.
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
                      {p.source === "firefly" ? "Uscite Firefly" : "Stima dai saldi"}
                    </div>
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
