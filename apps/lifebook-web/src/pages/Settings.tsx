import { useEffect, useMemo, useState } from "react";
import { errorMessage } from "../api/client";
import { useGet, useWrite } from "../api/hooks";
import type { SettingsResponse } from "../api/types";
import { Banner, Card, EmptyState, Field, Loading, QueryError } from "../components/ui";
import { todayIso } from "../lib/dates";
import { formatDate } from "../lib/format";
import {
  SETTINGS_FIELDS,
  diffSettings,
  settingsToForm,
  type FormValues,
} from "../lib/settingsForm";

const GROUPS = [
  { id: "generale", title: "Parametri generali" },
  { id: "pensione", title: "Pensione pubblica" },
  { id: "semaforo", title: "Semaforo e verdetto" },
  { id: "avanzate", title: "Avvisi" },
] as const;

export function Settings() {
  const [validFrom, setValidFrom] = useState(todayIso());
  const settings = useGet<SettingsResponse>(`/settings?asOf=${validFrom}`);
  const create = useWrite<Record<string, unknown>>("POST", () => "/settings");
  const remove = useWrite<string>("DELETE", (id) => `/settings/${id}`);
  const [form, setForm] = useState<FormValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(
    null,
  );

  const effective = settings.data?.effective;
  useEffect(() => {
    if (effective) setForm(settingsToForm(effective));
  }, [effective]);
  const changes = useMemo(
    () => (effective ? diffSettings(effective, form) : null),
    [effective, form],
  );

  if (settings.error) return <QueryError error={settings.error} />;
  if (!settings.data || !effective) return <Loading />;

  async function save() {
    if (!changes) return;
    setErrors(changes.errors);
    if (Object.keys(changes.errors).length > 0)
      return setMessage({ kind: "error", text: "Correggi i valori segnalati." });
    if (Object.keys(changes.patch).length === 0)
      return setMessage({ kind: "info", text: "Nessuna modifica rispetto ai valori in vigore." });
    try {
      await create.mutateAsync({ validFrom, ...changes.patch });
      setMessage({
        kind: "ok",
        text: `Impostazioni salvate: valgono dal ${formatDate(validFrom)}.`,
      });
    } catch (e) {
      setMessage({ kind: "error", text: errorMessage(e) });
    }
  }

  const entries = [...settings.data.entries].sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1));

  return (
    <>
      <h1>Impostazioni</h1>
      {!effective.publicPension.enabled && (
        <Banner kind="info">
          <strong>Senza pensione pubblica.</strong> La pensione è disattivata: nessun metodo la
          considera.
        </Banner>
      )}
      <Card>
        <div className="row">
          <Field
            label="Valide dal"
            hint="Ogni modifica vale da questa data: lo storico usa i valori in vigore allora."
          >
            <input
              type="date"
              value={validFrom}
              onChange={(e) => e.target.value && setValidFrom(e.target.value)}
            />
          </Field>
        </div>
      </Card>
      {GROUPS.map((group) => (
        <Card key={group.id} title={group.title}>
          <div className="row">
            {SETTINGS_FIELDS.filter((f) => f.group === group.id).map((field) => (
              <Field
                key={field.key}
                label={field.unit ? `${field.label} (${field.unit})` : field.label}
                hint={field.hint}
                error={errors[field.key]}
                check={field.kind === "boolean"}
              >
                {field.kind === "boolean" ? (
                  <input
                    type="checkbox"
                    checked={Boolean(form[field.key])}
                    onChange={(e) => setForm({ ...form, [field.key]: e.target.checked })}
                  />
                ) : field.kind === "window" ? (
                  <select
                    value={String(form[field.key] ?? "12")}
                    onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                  >
                    <option value="3">3</option>
                    <option value="6">6</option>
                    <option value="12">12</option>
                  </select>
                ) : (
                  <input
                    inputMode="decimal"
                    value={String(form[field.key] ?? "")}
                    aria-invalid={errors[field.key] ? true : undefined}
                    onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                  />
                )}
              </Field>
            ))}
          </div>
        </Card>
      ))}
      <div className="row" style={{ marginBottom: 16 }}>
        <button className="primary" onClick={save} disabled={create.isPending}>
          Salva impostazioni
        </button>
        {changes && Object.keys(changes.patch).length > 0 && (
          <span className="muted small">{Object.keys(changes.patch).length} campi modificati</span>
        )}
      </div>
      {message && <Banner kind={message.kind}>{message.text}</Banner>}

      <Card title="Storico delle impostazioni">
        {entries.length === 0 ? (
          <EmptyState>Stai usando i valori predefiniti.</EmptyState>
        ) : (
          <table>
            <tbody>
              {entries.map(({ id, validFrom: from, ...values }) => (
                <tr key={id}>
                  <td style={{ width: 120 }}>dal {formatDate(from)}</td>
                  <td className="small">
                    {Object.entries(values)
                      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                      .join(" · ")}
                  </td>
                  <td style={{ width: 80 }}>
                    <button
                      className="link danger"
                      onClick={() => confirm("Eliminare questa voce?") && remove.mutate(id)}
                    >
                      Elimina
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
