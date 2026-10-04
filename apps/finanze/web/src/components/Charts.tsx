import { useId, useState, type CSSProperties } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDate, formatEuro, formatMonth, formatPercent } from "../lib/format";
import type { Row } from "../lib/charts";
import { EmptyState } from "./ui";

export const SERIES_COLORS = [
  "var(--series-0)",
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
  "var(--series-9)",
];
export const colorAt = (i: number) => SERIES_COLORS[i % SERIES_COLORS.length]!;
type Fmt = (value: number) => string;
const money: Fmt = (v) => formatEuro(v);
const dateTick = (v: string) => (v.length === 7 ? formatMonth(v) : formatDate(v));
interface Serie {
  key: string;
  label: string;
  color?: string;
  dashed?: boolean;
}
interface ChartProps {
  rows: readonly Row[];
  series: readonly Serie[];
  format?: Fmt;
}

function InteractiveChart({
  rows,
  series,
  format = money,
  kind,
  stacked = false,
  line,
}: ChartProps & {
  kind: "line" | "area" | "bar";
  stacked?: boolean;
  line?: Serie;
}) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [showData, setShowData] = useState(false);
  const [window, setWindow] = useState({ from: "", to: "" });
  const id = useId();
  const all = [...series, ...(line ? [{ ...line, color: "var(--text)" }] : [])];
  const visible = all.filter((s) => !hidden.has(s.key));
  // Date bounds survive changes to the source data without leaving stale array indices.
  const filtered = rows.filter(
    (r) => (!window.from || r.date >= window.from) && (!window.to || r.date <= window.to),
  );
  function toggle(key: string) {
    setHidden((old) => {
      const next = new Set(old);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  if (!rows.length) return <EmptyState>Nessun dato nell'intervallo selezionato.</EmptyState>;
  return (
    <div className="interactive-chart">
      <div className="chart-controls">
        <span className="chart-count" aria-live="polite">
          {visible.length} / {all.length} serie
        </span>
        <button
          type="button"
          className="link"
          onClick={() => setHidden(new Set())}
          disabled={visible.length === all.length}
        >
          Mostra tutte
        </button>
        <button
          type="button"
          className="link"
          aria-expanded={showData}
          aria-controls={`${id}-data`}
          onClick={() => setShowData(!showData)}
        >
          {showData ? "Nascondi dati" : "Mostra dati"}
        </button>
        <details className="chart-zoom">
          <summary>Intervallo{window.from || window.to ? " · filtrato" : ""}</summary>
          <div className="row">
            <label className="field">
              Da punto
              <select
                aria-label="Inizio intervallo grafico"
                value={window.from}
                onChange={(e) =>
                  setWindow({
                    from: e.target.value,
                    to: window.to && e.target.value > window.to ? "" : window.to,
                  })
                }
              >
                <option value="">Inizio</option>
                {rows.map((r) => (
                  <option key={r.date} value={r.date}>
                    {dateTick(r.date)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              A punto
              <select
                aria-label="Fine intervallo grafico"
                value={window.to}
                onChange={(e) => setWindow({ ...window, to: e.target.value })}
              >
                <option value="">Fine</option>
                {rows
                  .filter((r) => !window.from || r.date >= window.from)
                  .map((r) => (
                    <option key={r.date} value={r.date}>
                      {dateTick(r.date)}
                    </option>
                  ))}
              </select>
            </label>
            <button type="button" onClick={() => setWindow({ from: "", to: "" })}>
              Ripristina intervallo
            </button>
          </div>
        </details>
      </div>
      {!visible.length ? (
        <div className="chart-empty" role="status">
          Nessuna serie visibile. Attiva una voce della legenda.
        </div>
      ) : !filtered.length ? (
        <div className="chart-empty" role="status">
          Nessun dato in questo intervallo. Ripristina l’intervallo del grafico.
        </div>
      ) : (
        <div className="chart">
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            initialDimension={{ width: 600, height: 300 }}
          >
            <ComposedChart
              data={filtered}
              stackOffset="sign"
              accessibilityLayer
              margin={{ top: 16, right: 12, bottom: 8, left: 0 }}
            >
              <CartesianGrid vertical={false} strokeDasharray="3 5" stroke="var(--border)" />
              <XAxis
                dataKey="date"
                tickFormatter={dateTick}
                stroke="var(--muted)"
                tickLine={false}
                axisLine={false}
                fontSize={11}
                minTickGap={35}
                dy={8}
              />
              <YAxis
                tickFormatter={(v: number) => format(v)}
                stroke="var(--muted)"
                tickLine={false}
                axisLine={false}
                fontSize={11}
                width={78}
              />
              <Tooltip
                labelFormatter={(l) => dateTick(String(l))}
                formatter={(v) => (typeof v === "number" ? format(v) : String(v ?? "—"))}
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  color: "var(--text)",
                  boxShadow: "0 8px 28px #102f3214",
                }}
                cursor={{
                  stroke: "var(--muted)",
                  strokeDasharray: "4 4",
                  fill: "var(--chart-hover)",
                }}
              />
              {series.map((s, i) => {
                const shared = {
                  dataKey: s.key,
                  name: s.label,
                  hide: hidden.has(s.key),
                  isAnimationActive: false,
                };
                const color = s.color ?? colorAt(i);
                if (kind === "bar")
                  return (
                    <Bar
                      key={s.key}
                      {...shared}
                      fill={color}
                      {...(stacked ? { stackId: "a" } : {})}
                      maxBarSize={36}
                      radius={[3, 3, 0, 0]}
                    />
                  );
                if (kind === "area")
                  return (
                    <Area
                      key={s.key}
                      {...shared}
                      type="monotone"
                      stackId="a"
                      stroke={color}
                      fill={color}
                      fillOpacity={0.18}
                      strokeWidth={2}
                    />
                  );
                return (
                  <Line
                    key={s.key}
                    {...shared}
                    type="monotone"
                    stroke={color}
                    strokeWidth={2.25}
                    {...(s.dashed ? { strokeDasharray: "5 4" } : {})}
                    dot={
                      filtered.length < 20
                        ? { r: 3, strokeWidth: 1.5, fill: "var(--surface)" }
                        : false
                    }
                    activeDot={{ r: 5 }}
                  />
                );
              })}
              {line && (
                <Line
                  dataKey={line.key}
                  name={line.label}
                  hide={hidden.has(line.key)}
                  type="monotone"
                  stroke="var(--text)"
                  strokeWidth={2.5}
                  dot={false}
                  isAnimationActive={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="chart-legend" role="group" aria-label="Serie del grafico">
        {all.map((s, i) => (
          <div
            className={`legend-item${hidden.has(s.key) ? " is-hidden" : ""}`}
            key={s.key}
            style={{ "--series-color": s.color ?? colorAt(i) } as CSSProperties}
          >
            <button
              type="button"
              className="legend-toggle"
              aria-pressed={!hidden.has(s.key)}
              onClick={() => toggle(s.key)}
            >
              <span className="legend-swatch" aria-hidden="true" />
              {s.label}
            </button>
            <button
              type="button"
              className="legend-solo"
              aria-label={`Mostra solo ${s.label}`}
              title={`Mostra solo ${s.label}`}
              onClick={() =>
                setHidden(new Set(all.filter((item) => item.key !== s.key).map((item) => item.key)))
              }
            >
              solo
            </button>
          </div>
        ))}
      </div>
      <p className="chart-hint">Clic: mostra/nascondi · «solo»: isola una serie</p>
      {showData && (
        <div
          className="scroll-x chart-data"
          id={`${id}-data`}
          tabIndex={0}
          role="region"
          aria-label="Dati del grafico"
        >
          <table>
            <caption>Dati delle serie visibili</caption>
            <thead>
              <tr>
                <th scope="col">Data</th>
                {visible.map((s) => (
                  <th scope="col" className="num" key={s.key}>
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.date}>
                  <th scope="row">{dateTick(r.date)}</th>
                  {visible.map((s) => (
                    <td className="num" key={s.key}>
                      {typeof r[s.key] === "number" ? format(r[s.key] as number) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
export function LineSeries(props: ChartProps) {
  return <InteractiveChart {...props} kind="line" />;
}
export function StackedArea(props: ChartProps & { line?: Serie }) {
  return <InteractiveChart {...props} kind="area" />;
}
export function Bars(props: ChartProps & { stacked?: boolean }) {
  return <InteractiveChart {...props} kind="bar" />;
}
export const formatPct: Fmt = (v) => formatPercent(v);
