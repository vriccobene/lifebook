import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDate, formatEuro, formatMonth, formatPercent } from "../lib/format";
import type { Row } from "../lib/charts";
import { EmptyState } from "./ui";

export const SERIES_COLORS = [
  "#2456d6",
  "#1f9d55",
  "#d69e0b",
  "#c2410c",
  "#7c3aed",
  "#0891b2",
  "#be185d",
  "#4d7c0f",
  "#64748b",
  "#a16207",
];
export const colorAt = (i: number) => SERIES_COLORS[i % SERIES_COLORS.length]!;

type Fmt = (value: number) => string;
const money: Fmt = (v) => formatEuro(v);
const pct: Fmt = (v) => formatPercent(v);

const dateTick = (v: string) => (v.length === 7 ? formatMonth(v) : formatDate(v));

interface Serie {
  key: string;
  label: string;
  color?: string;
  dashed?: boolean;
}

function Frame({ rows, children }: { rows: readonly Row[]; children: ReactNode }) {
  if (rows.length === 0) return <EmptyState>Nessun dato nell'intervallo selezionato.</EmptyState>;
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        {children as never}
      </ResponsiveContainer>
    </div>
  );
}

const common = (format: Fmt) => ({
  grid: <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />,
  x: (
    <XAxis
      dataKey="date"
      tickFormatter={dateTick}
      stroke="var(--muted)"
      fontSize={11}
      minTickGap={24}
    />
  ),
  y: (
    <YAxis
      tickFormatter={(v: number) => format(v)}
      stroke="var(--muted)"
      fontSize={11}
      width={70}
    />
  ),
  tooltip: (
    <Tooltip
      labelFormatter={(l) => dateTick(String(l))}
      formatter={(v) => (typeof v === "number" ? format(v) : String(v ?? "—"))}
      contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    />
  ),
});

export function LineSeries({
  rows,
  series,
  format = money,
}: {
  rows: readonly Row[];
  series: readonly Serie[];
  format?: Fmt;
}) {
  const c = common(format);
  return (
    <Frame rows={rows}>
      <LineChart data={rows as Row[]}>
        {c.grid}
        {c.x}
        {c.y}
        {c.tooltip}
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color ?? colorAt(i)}
            {...(s.dashed ? { strokeDasharray: "5 4" } : {})}
            dot={rows.length < 40}
            connectNulls
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </Frame>
  );
}

export function StackedArea({
  rows,
  series,
  line,
}: {
  rows: readonly Row[];
  series: readonly Serie[];
  line?: Serie;
}) {
  const c = common(money);
  return (
    <Frame rows={rows}>
      <AreaChart data={rows as Row[]} stackOffset="sign">
        {c.grid}
        {c.x}
        {c.y}
        {c.tooltip}
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
        {series.map((s, i) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stackId="a"
            stroke={s.color ?? colorAt(i)}
            fill={s.color ?? colorAt(i)}
            fillOpacity={0.55}
            isAnimationActive={false}
          />
        ))}
        {line && (
          <Line
            type="monotone"
            dataKey={line.key}
            name={line.label}
            stroke="var(--text)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        )}
      </AreaChart>
    </Frame>
  );
}

export function Bars({
  rows,
  series,
  stacked = false,
  format = money,
}: {
  rows: readonly Row[];
  series: readonly Serie[];
  stacked?: boolean;
  format?: Fmt;
}) {
  const c = common(format);
  return (
    <Frame rows={rows}>
      <BarChart data={rows as Row[]}>
        {c.grid}
        {c.x}
        {c.y}
        {c.tooltip}
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={s.color ?? colorAt(i)}
            {...(stacked ? { stackId: "a" } : {})}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </Frame>
  );
}

export { pct as formatPct };
