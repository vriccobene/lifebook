import type { ReactNode } from "react";
import { STATUS_LABELS } from "../lib/labels";

export function Card({
  title,
  children,
  actions,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="toolbar" style={{ marginBottom: 8 }}>
          {title ? <h2 style={{ margin: 0 }}>{title}</h2> : <span />}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`pill ${status}`}>{STATUS_LABELS[status] ?? status}</span>;
}

export function Banner({
  kind = "warn",
  children,
}: {
  kind?: "warn" | "error" | "ok" | "info";
  children: ReactNode;
}) {
  return (
    <div
      className={`banner ${kind === "warn" ? "" : kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}

export function Loading({ what = "dati" }: { what?: string }) {
  return <p className="muted">Caricamento {what}…</p>;
}

export function QueryError({ error }: { error: unknown }) {
  return (
    <Banner kind="error">
      {error instanceof Error ? error.message : "Errore nel caricamento dei dati"}
    </Banner>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  check = false,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
  check?: boolean;
}) {
  return (
    <label className={`field${check ? " check" : ""}`}>
      <span>{label}</span>
      {children}
      {hint && <span className="small muted">{hint}</span>}
      {error && (
        <span className="small" style={{ color: "var(--red)" }}>
          {error}
        </span>
      )}
    </label>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="muted">{children}</p>;
}
