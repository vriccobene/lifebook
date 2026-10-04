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
        <div className="card-header">
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
  return (
    <div className="loading-state" role="status" aria-busy="true">
      Caricamento {what}…
      <div className="loading-bars" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
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
  return <div className="empty-state">{children}</div>;
}

export function PageHeading({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <div className="page-intro">
      <div className="eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      <p>{children}</p>
    </div>
  );
}
