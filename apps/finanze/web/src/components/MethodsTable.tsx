import type { MethodResult } from "@lifebook/finanze-core";
import { formatEuro, formatNumber, formatPercent, formatYears } from "../lib/format";
import { METHOD_HINTS, METHOD_LABELS, VARIANT_LABELS, missingReasons } from "../lib/labels";
import { StatusPill } from "./ui";

/** How far a method is from its goal, in words. */
export function distanceText(method: MethodResult): string {
  if (method.status === "missing_data") return "—";
  if (method.id === "layers") {
    const flow = Number(method.details.essentialShortfallAnnualFlow ?? 0);
    const capital = Number(method.details.discretionaryShortfallCapital ?? 0);
    if (flow === 0 && capital === 0) return "obiettivo raggiunto";
    return [
      flow > 0 ? `${formatEuro(flow)}/anno di flussi sicuri` : "",
      capital > 0 ? `${formatEuro(capital)} di capitale` : "",
    ]
      .filter(Boolean)
      .join(" + ");
  }
  const { eur, kind, years } = method.distance;
  if (eur === null) return "—";
  if (eur === 0) return "obiettivo raggiunto";
  const amount = kind === "annual_flow" ? `${formatEuro(eur)}/anno` : formatEuro(eur);
  return years !== null && years !== undefined && method.id === "fi_number"
    ? `${amount} · ${formatYears(years)}`
    : amount;
}

export function MethodsTable({ methods }: { methods: readonly MethodResult[] }) {
  const rated = methods.filter((m) => m.family !== "E");
  return (
    <div className="scroll-x">
      <table>
        <thead>
          <tr>
            <th>Metodo</th>
            <th>Esito</th>
            <th className="num">Copertura</th>
            <th>Distanza</th>
          </tr>
        </thead>
        <tbody>
          {rated.map((m) => (
            <MethodRows key={m.id} method={m} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MethodRows({ method }: { method: MethodResult }) {
  const name = METHOD_LABELS[method.id] ?? method.id;
  return (
    <>
      <tr>
        <td title={METHOD_HINTS[method.id]}>{name}</td>
        <td>
          <StatusPill status={method.status} />
        </td>
        <td className="num">{formatPercent(method.coverage, 0)}</td>
        <td>
          {method.status === "missing_data" ? (
            <span className="muted small">Non calcolabile: {missingReasons(method.missing)}</span>
          ) : (
            distanceText(method)
          )}
        </td>
      </tr>
      {method.variants.map((v) => (
        <tr key={v.id} className="muted">
          <td style={{ paddingLeft: "1.5rem" }}>{VARIANT_LABELS[v.id] ?? v.id}</td>
          <td>
            <StatusPill status={v.status} />
          </td>
          <td className="num">{formatPercent(v.coverage, 0)}</td>
          <td>{v.distance.eur === 0 ? "obiettivo raggiunto" : formatEuro(v.distance.eur)}</td>
        </tr>
      ))}
    </>
  );
}

export function metricText(method: MethodResult | undefined): string {
  const metric = method?.metric;
  if (!metric || metric.value === null) return "—";
  if (metric.unit === "ratio") return formatPercent(metric.value, 0);
  if (metric.unit === "years") return `${formatNumber(metric.value, 1)} anni`;
  return `${formatNumber(metric.value, 1)} mesi`;
}
