import { useMemo, useState } from "react";
import { rangeQuery, useGet } from "../api/hooks";
import { useAccounts, useSnapshots } from "../api/queries";
import type {
  LivingCostPayload,
  MethodsPayload,
  NetWorthPayload,
  ReturnsPayload,
  Series,
  VerdictPayload,
} from "../api/types";
import {
  ACCOUNT_TYPES,
  accountsWithBalances,
  balanceRows,
  costRows,
  coverageRows,
  essentialRows,
  incomeVsCostRows,
  netWorthRows,
  returnsRows,
  savingsRows,
  trafficMethods,
  trafficStrip,
  verdictStrip,
} from "../lib/charts";
import { formatDate } from "../lib/format";
import { ACCOUNT_TYPE_LABELS, METHOD_LABELS, STATUS_LABELS } from "../lib/labels";
import type { DateRange } from "../lib/range";
import { Bars, LineSeries, StackedArea, colorAt, formatPct } from "./Charts";
import { Card, Loading, QueryError } from "./ui";

function Strip({ cells }: { cells: { date: string; status: string }[] }) {
  return (
    <div className="strip" role="img" aria-label="Evoluzione del semaforo">
      {cells.map((c) => (
        <span
          key={c.date}
          className={c.status}
          title={`${formatDate(c.date)}: ${STATUS_LABELS[c.status] ?? c.status}`}
        />
      ))}
    </div>
  );
}

/** Every historical chart of the dashboard, all for the same time range. */
export function DashboardCharts({ range }: { range: DateRange }) {
  const q = rangeQuery(range.from, range.to);
  const accounts = useAccounts();
  const snapshots = useSnapshots();
  const netWorth = useGet<Series<NetWorthPayload>>(`/results/net-worth?${q}`);
  const cost = useGet<Series<LivingCostPayload>>(`/results/living-cost?${q}`);
  const methods = useGet<Series<MethodsPayload>>(`/results/methods?${q}`);
  const verdict = useGet<Series<VerdictPayload>>(`/results/verdict?${q}`);
  const living = useGet<LivingCostPayload>("/results/living-cost");
  const returns = useGet<ReturnsPayload>("/results/returns");
  const [returnAccount, setReturnAccount] = useState<string>("");

  const firstError = [netWorth, cost, methods, verdict, living, returns, accounts, snapshots].find(
    (r) => r.error,
  )?.error;
  const loading = [netWorth, cost, methods, verdict, living, returns, accounts, snapshots].some(
    (r) => r.isLoading,
  );

  const data = useMemo(() => {
    if (
      !netWorth.data ||
      !cost.data ||
      !methods.data ||
      !living.data ||
      !returns.data ||
      !snapshots.data ||
      !accounts.data
    ) {
      return null;
    }
    const withBalances = accountsWithBalances(snapshots.data, accounts.data);
    return {
      netWorth: netWorthRows(netWorth.data.points),
      balances: balanceRows(snapshots.data, range),
      balanceAccounts: withBalances,
      cost: costRows(living.data.livingCost, cost.data.points, range),
      essential: essentialRows(living.data.essentialSplit, range),
      incomeVsCost: incomeVsCostRows(living.data.livingCost, range),
      savings: savingsRows(methods.data.points),
      coverage: coverageRows(methods.data.points),
      methodIds: trafficMethods(methods.data.points.at(-1)?.methods ?? []).map((m) => m.id),
      returnable: withBalances.filter((a) => a.type !== "liability" && a.type !== "checking"),
    };
  }, [
    netWorth.data,
    cost.data,
    methods.data,
    living.data,
    returns.data,
    snapshots.data,
    accounts.data,
    range,
  ]);

  if (firstError) return <QueryError error={firstError} />;
  if (loading || !data || !returns.data || !methods.data || !verdict.data)
    return <Loading what="grafici" />;

  const returnRows = returnsRows(returns.data, returnAccount || null, range);

  return (
    <div className="grid two">
      <Card title="Patrimonio netto nel tempo">
        <StackedArea
          rows={data.netWorth}
          series={ACCOUNT_TYPES.map((t) => ({ key: t, label: ACCOUNT_TYPE_LABELS[t] }))}
          line={{ key: "total", label: "Patrimonio netto" }}
        />
      </Card>
      <Card title="Saldo di ogni conto">
        <LineSeries
          rows={data.balances}
          series={data.balanceAccounts.map((a, i) => ({
            key: a.id,
            label: a.name,
            color: colorAt(i),
          }))}
        />
      </Card>
      <Card title="Costo della vita mensile">
        <LineSeries
          rows={data.cost}
          series={[
            { key: "monthly", label: "Mese" },
            { key: "ma3", label: "Media 3 mesi" },
            { key: "ma6", label: "Media 6 mesi" },
            { key: "ma12", label: "Media 12 mesi" },
          ]}
        />
      </Card>
      <Card title="Spesa essenziale e discrezionale">
        <Bars
          rows={data.essential}
          stacked
          series={[
            { key: "essential", label: "Essenziale" },
            { key: "discretionary", label: "Discrezionale" },
          ]}
        />
      </Card>
      <Card title="Entrate e costo della vita">
        <Bars
          rows={data.incomeVsCost}
          series={[
            { key: "income", label: "Entrate nette" },
            { key: "cost", label: "Costo della vita" },
          ]}
        />
      </Card>
      <Card
        title="Rendimento lordo e netto"
        actions={
          <select
            value={returnAccount}
            onChange={(e) => setReturnAccount(e.target.value)}
            aria-label="Conto"
          >
            <option value="">Totale</option>
            {data.returnable.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        }
      >
        <Bars
          rows={returnRows}
          format={formatPct}
          series={[
            { key: "gross", label: "Lordo" },
            { key: "net", label: "Netto" },
          ]}
        />
      </Card>
      <Card title="Tasso di risparmio">
        <LineSeries
          rows={data.savings}
          series={[{ key: "rate", label: "Tasso di risparmio" }]}
          format={formatPct}
        />
      </Card>
      <Card title="Copertura dei metodi nel tempo">
        <LineSeries
          rows={data.coverage}
          format={formatPct}
          series={data.methodIds.map((id, i) => ({
            key: id,
            label: METHOD_LABELS[id] ?? id,
            color: colorAt(i),
          }))}
        />
      </Card>
      <div style={{ gridColumn: "1 / -1" }}>
        <Card title="Semaforo e verdetto nel tempo">
          <table>
            <tbody>
              <tr>
                <th style={{ width: 210 }}>Verdetto</th>
                <td>
                  <Strip cells={verdictStrip(verdict.data.points)} />
                </td>
              </tr>
              {data.methodIds.map((id) => (
                <tr key={id}>
                  <th>{METHOD_LABELS[id] ?? id}</th>
                  <td>
                    <Strip cells={trafficStrip(methods.data.points, id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
