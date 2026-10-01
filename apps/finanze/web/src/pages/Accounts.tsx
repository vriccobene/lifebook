import { useState, type FormEvent } from "react";
import { errorMessage } from "../api/client";
import { useWrite } from "../api/hooks";
import { useAccounts } from "../api/queries";
import type { Account, AccountParamsEntry, AccountType } from "../api/types";
import { Banner, Card, EmptyState, Field, Loading, QueryError } from "../components/ui";
import {
  defaultInvestable,
  emptyParamsForm,
  entrySummary,
  entryToParamsForm,
  firstParamsDate,
  flagsAt,
  spendingFlagWrites,
  paramsFormToEntry,
  takesIncome,
  type ParamsForm,
} from "../lib/accountForm";
import { todayIso } from "../lib/dates";
import { formatDate } from "../lib/format";
import { ACCOUNT_TYPE_LABELS } from "../lib/labels";

const TYPES = Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[];

function ParamsFields({
  type,
  form,
  onChange,
  errors,
}: {
  type: AccountType;
  form: ParamsForm;
  onChange: (form: ParamsForm) => void;
  errors: Record<string, string>;
}) {
  const set = <K extends keyof ParamsForm>(key: K, value: ParamsForm[K]) =>
    onChange({ ...form, [key]: value });
  const percent = (
    key: "expectedReturn" | "passiveYield" | "taxRate" | "interestRate",
    label: string,
    hint?: string,
  ) => (
    <Field label={`${label} (%)`} hint={hint} error={errors[key]}>
      <input inputMode="decimal" value={form[key]} onChange={(e) => set(key, e.target.value)} />
    </Field>
  );
  return (
    <div className="row">
      {(type === "checking" || type === "deposit") && (
        <Field label="Conto di spesa" check hint="Il conto da cui paghi la vita quotidiana.">
          <input
            type="checkbox"
            checked={form.isSpendingAccount}
            onChange={(e) => set("isSpendingAccount", e.target.checked)}
          />
        </Field>
      )}
      {takesIncome(type) && (
        <Field
          label="Conto delle entrate"
          check
          hint="Dove arrivano lo stipendio e le altre voci di Entrate: qui non sono un rendimento."
        >
          <input
            type="checkbox"
            checked={form.isIncomeAccount}
            onChange={(e) => set("isIncomeAccount", e.target.checked)}
          />
        </Field>
      )}
      <Field label="Nel capitale investibile" check>
        <input
          type="checkbox"
          checked={form.inInvestableCapital}
          onChange={(e) => set("inInvestableCapital", e.target.checked)}
        />
      </Field>
      {type !== "liability" && percent("expectedReturn", "Rendimento atteso reale")}
      {type !== "liability" &&
        percent("passiveYield", "Rendita passiva annua", "Interessi, dividendi, affitto netto")}
      {percent("taxRate", "Tassazione", "Es. 26, 12,5, 21")}
      {(type === "deposit" || type === "liability" || type === "checking") &&
        percent("interestRate", "Tasso dichiarato")}
      {type === "real_estate" && (
        <Field
          label="Valore dell'immobile (€)"
          hint="Aggiornalo con una nuova voce datata quando cambia. Se lo indichi, il saldo del conto è la cassa dell'immobile (gli affitti incassati, ad esempio da Firefly III) e il rendimento si calcola su questo valore."
          error={errors.propertyValue}
        >
          <input
            inputMode="decimal"
            value={form.propertyValue}
            onChange={(e) => set("propertyValue", e.target.value)}
          />
        </Field>
      )}
      {type === "liability" && (
        <>
          <Field label="Rata mensile (€)" error={errors.monthlyPayment}>
            <input
              inputMode="decimal"
              value={form.monthlyPayment}
              onChange={(e) => set("monthlyPayment", e.target.value)}
            />
          </Field>
          <Field label="Data ultima rata">
            <input
              type="date"
              value={form.paymentEndDate}
              onChange={(e) => set("paymentEndDate", e.target.value)}
            />
          </Field>
        </>
      )}
    </div>
  );
}

function NewAccount({ onDone }: { onDone: () => void }) {
  const create = useWrite<Record<string, unknown>>("POST", () => "/accounts");
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [type, setType] = useState<AccountType>("checking");
  const [use, setUse] = useState<"primary_residence" | "income">("primary_residence");
  const [mode, setMode] = useState<"declared" | "inferred" | "">("");
  const [counts, setCounts] = useState(true);
  const realEstateUse = type === "real_estate" ? use : null;
  const [params, setParams] = useState<ParamsForm>(() =>
    emptyParamsForm("checking", null, "2000-01-01"),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const changeType = (next: AccountType) => {
    setType(next);
    setParams({
      ...params,
      inInvestableCapital: defaultInvestable(next, next === "real_estate" ? use : null),
    });
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    const { entry, errors: found } = paramsFormToEntry(params, type);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    try {
      await create.mutateAsync({
        name,
        type,
        institution: institution || null,
        ...(realEstateUse ? { realEstateUse } : {}),
        ...(mode ? { contributionsMode: mode } : {}),
        ...(type === "liability" ? { countsAsLivingCost: counts } : {}),
        params: [entry],
      });
      setName("");
      setInstitution("");
      setError(null);
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Card title="Nuovo conto">
      <form className="stack" onSubmit={submit}>
        <div className="row">
          <Field label="Nome">
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Istituto">
            <input value={institution} onChange={(e) => setInstitution(e.target.value)} />
          </Field>
          <Field label="Tipo">
            <select value={type} onChange={(e) => changeType(e.target.value as AccountType)}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {ACCOUNT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          {type === "real_estate" && (
            <Field label="Uso">
              <select value={use} onChange={(e) => setUse(e.target.value as typeof use)}>
                <option value="primary_residence">Abitazione principale</option>
                <option value="income">A reddito</option>
              </select>
            </Field>
          )}
          {type !== "real_estate" && (
            <Field label="Contributi" hint="Depositi: dedotti. Titoli: li inserisci tu.">
              <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="">Predefinito per il tipo</option>
                <option value="declared">Dichiarati</option>
                <option value="inferred">Dedotti dal saldo</option>
              </select>
            </Field>
          )}
          {type === "liability" && (
            <Field label="La rata è costo della vita" check>
              <input
                type="checkbox"
                checked={counts}
                onChange={(e) => setCounts(e.target.checked)}
              />
            </Field>
          )}
        </div>
        <h3>Parametri</h3>
        <Field label="Validi dal" hint="Puoi aggiungere modifiche datate in seguito.">
          <input
            type="date"
            value={params.validFrom}
            onChange={(e) => setParams({ ...params, validFrom: e.target.value })}
            required
          />
        </Field>
        <ParamsFields type={type} form={params} onChange={setParams} errors={errors} />
        {error && <Banner kind="error">{error}</Banner>}
        <div>
          <button className="primary" disabled={create.isPending}>
            Crea conto
          </button>
        </div>
      </form>
    </Card>
  );
}

function AccountDetail({ account }: { account: Account }) {
  const update = useWrite<Record<string, unknown>>("PATCH", () => `/accounts/${account.id}`);
  const remove = useWrite<null>("DELETE", () => `/accounts/${account.id}`);
  const addParams = useWrite<Record<string, unknown>>(
    "POST",
    () => `/accounts/${account.id}/params`,
  );
  const removeParams = useWrite<string>("DELETE", (id) => `/accounts/${account.id}/params/${id}`);
  const replaceParams = useWrite<{ id: string; entry: Record<string, unknown> }>(
    "PUT",
    ({ id }) => `/accounts/${account.id}/params/${id}`,
    ({ entry }) => entry,
  );
  const [name, setName] = useState(account.name);
  const [institution, setInstitution] = useState(account.institution ?? "");
  const [type, setType] = useState<AccountType>(account.type);
  const [use, setUse] = useState<"primary_residence" | "income">(
    account.realEstateUse ?? "primary_residence",
  );
  const [mode, setMode] = useState(account.contributionsMode);
  const [counts, setCounts] = useState(account.countsAsLivingCost);
  const [editing, setEditing] = useState<{ id: string; form: ParamsForm } | null>(null);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const patchParams = useWrite<{ id: string; entry: Record<string, unknown> }>(
    "PATCH",
    ({ id }) => `/accounts/${account.id}/params/${id}`,
    ({ entry }) => entry,
  );
  const [form, setForm] = useState<ParamsForm>(() => ({
    ...emptyParamsForm(account.type, account.realEstateUse, todayIso()),
    ...flagsAt(account.params, account.type, account.realEstateUse, todayIso()),
  }));
  const [spending, setSpending] = useState(
    () =>
      flagsAt(account.params, account.type, account.realEstateUse, todayIso()).isSpendingAccount,
  );
  const [spendingFrom, setSpendingFrom] = useState(() =>
    firstParamsDate(account.params, "2000-01-01"),
  );
  const saveSpending = async () => {
    const writes = spendingFlagWrites(account.params, spendingFrom, spending);
    for (const id of writes.update)
      await patchParams.mutateAsync({ id, entry: { isSpendingAccount: spending } });
    if (writes.create)
      await addParams.mutateAsync({ validFrom: spendingFrom, isSpendingAccount: spending });
  };
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const attempt = async (action: () => Promise<unknown>, ok: string) => {
    try {
      await action();
      setMessage({ kind: "ok", text: ok });
    } catch (e) {
      setMessage({ kind: "error", text: errorMessage(e) });
    }
  };
  const entries = [...account.params].sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1));

  return (
    <tr>
      <td colSpan={6} style={{ background: "var(--bg)" }}>
        <div className="stack" style={{ padding: "8px 0" }}>
          {message && <Banner kind={message.kind === "ok" ? "ok" : "error"}>{message.text}</Banner>}
          <div className="row">
            <Field label="Nome">
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Istituto">
              <input value={institution} onChange={(e) => setInstitution(e.target.value)} />
            </Field>
            <Field label="Tipo">
              <select value={type} onChange={(e) => setType(e.target.value as AccountType)}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ACCOUNT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
            {type === "real_estate" ? (
              <Field label="Uso">
                <select value={use} onChange={(e) => setUse(e.target.value as typeof use)}>
                  <option value="primary_residence">Abitazione principale</option>
                  <option value="income">A reddito</option>
                </select>
              </Field>
            ) : (
              <Field label="Contributi">
                <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                  <option value="declared">Dichiarati</option>
                  <option value="inferred">Dedotti dal saldo</option>
                </select>
              </Field>
            )}
            {type === "liability" && (
              <Field label="La rata è costo della vita" check>
                <input
                  type="checkbox"
                  checked={counts}
                  onChange={(e) => setCounts(e.target.checked)}
                />
              </Field>
            )}
            <button
              onClick={() =>
                attempt(
                  () =>
                    update.mutateAsync({
                      name,
                      institution: institution || null,
                      type,
                      realEstateUse: type === "real_estate" ? use : null,
                      contributionsMode: mode,
                      countsAsLivingCost: counts,
                    }),
                  "Conto aggiornato.",
                )
              }
            >
              Salva
            </button>
            {account.archivedAt === null ? (
              <button
                onClick={() =>
                  attempt(
                    () => update.mutateAsync({ archivedAt: todayIso() }),
                    "Conto archiviato da oggi.",
                  )
                }
              >
                Archivia da oggi
              </button>
            ) : (
              <button
                onClick={() =>
                  attempt(() => update.mutateAsync({ archivedAt: null }), "Conto ripristinato.")
                }
              >
                Ripristina
              </button>
            )}
            <button
              className="danger"
              onClick={() =>
                confirm(`Eliminare «${account.name}»?`) &&
                attempt(() => remove.mutateAsync(null), "Conto eliminato.")
              }
            >
              Elimina
            </button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            L'eliminazione è possibile solo per conti senza saldi né contributi: negli altri casi
            archivia il conto.
          </p>

          {(account.type === "checking" || account.type === "deposit") && (
            <>
              <h3>Conto di spesa</h3>
              <div className="row">
                <Field
                  label="Conto di spesa"
                  check
                  hint="Il conto da cui paghi la vita quotidiana."
                >
                  <input
                    type="checkbox"
                    checked={spending}
                    onChange={(e) => setSpending(e.target.checked)}
                  />
                </Field>
                <Field
                  label="Dal"
                  hint="Di default dall'inizio dello storico, così vale anche per i mesi passati."
                >
                  <input
                    type="date"
                    value={spendingFrom}
                    onChange={(e) => setSpendingFrom(e.target.value)}
                    required
                  />
                </Field>
                <button
                  onClick={() =>
                    attempt(
                      saveSpending,
                      spending ? "Conto di spesa impostato." : "Conto di spesa tolto.",
                    )
                  }
                >
                  Applica
                </button>
              </div>
            </>
          )}

          <h3>Storico dei parametri</h3>
          {entries.length === 0 ? (
            <EmptyState>Nessun parametro.</EmptyState>
          ) : (
            <table>
              <tbody>
                {entries.map((entry: AccountParamsEntry) => {
                  const { id, validFrom, ...rest } = entry;
                  if (editing?.id === id)
                    return (
                      <tr key={id}>
                        <td colSpan={3}>
                          <div className="stack">
                            <Field label="Valida dal">
                              <input
                                type="date"
                                value={editing.form.validFrom}
                                onChange={(e) =>
                                  setEditing({
                                    id,
                                    form: { ...editing.form, validFrom: e.target.value },
                                  })
                                }
                                required
                              />
                            </Field>
                            <ParamsFields
                              type={account.type}
                              form={editing.form}
                              onChange={(next) => setEditing({ id, form: next })}
                              errors={editErrors}
                            />
                            <div className="row">
                              <button
                                className="primary"
                                onClick={() => {
                                  const { entry: next, errors: found } = paramsFormToEntry(
                                    editing.form,
                                    account.type,
                                  );
                                  setEditErrors(found);
                                  if (Object.keys(found).length > 0) return;
                                  void attempt(async () => {
                                    await replaceParams.mutateAsync({ id, entry: next });
                                    setEditing(null);
                                  }, "Voce aggiornata.");
                                }}
                              >
                                Salva voce
                              </button>
                              <button onClick={() => setEditing(null)}>Annulla</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  return (
                    <tr key={id}>
                      <td style={{ width: 120 }}>dal {formatDate(validFrom)}</td>
                      <td className="small">{entrySummary(rest).join(" · ") || "—"}</td>
                      <td style={{ width: 150 }}>
                        <button
                          className="link"
                          onClick={() => {
                            setEditErrors({});
                            setEditing({
                              id,
                              form: entryToParamsForm(entry, account.type, account.realEstateUse),
                            });
                          }}
                        >
                          Modifica
                        </button>{" "}
                        <button
                          className="link danger"
                          onClick={() =>
                            attempt(() => removeParams.mutateAsync(id), "Voce eliminata.")
                          }
                        >
                          Elimina
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <h3>Aggiungi una modifica datata</h3>
          <Field label="Valida dal">
            <input
              type="date"
              value={form.validFrom}
              onChange={(e) => setForm({ ...form, validFrom: e.target.value })}
            />
          </Field>
          <ParamsFields type={account.type} form={form} onChange={setForm} errors={errors} />
          <div>
            <button
              onClick={() => {
                const { entry, errors: found } = paramsFormToEntry(form, account.type);
                setErrors(found);
                if (Object.keys(found).length === 0)
                  void attempt(() => addParams.mutateAsync(entry), "Parametri aggiunti.");
              }}
            >
              Aggiungi
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

export function Accounts() {
  const accounts = useAccounts();
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  if (accounts.error) return <QueryError error={accounts.error} />;
  if (!accounts.data) return <Loading />;

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Conti</h1>
        <button className="primary" onClick={() => setCreating(!creating)}>
          {creating ? "Chiudi" : "Nuovo conto"}
        </button>
      </div>
      {creating && <NewAccount onDone={() => setCreating(false)} />}
      <Card>
        {accounts.data.length === 0 ? (
          <EmptyState>
            Nessun conto. Crea almeno un conto di spesa e gli altri conti da monitorare.
          </EmptyState>
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Tipo</th>
                  <th>Istituto</th>
                  <th>Contributi</th>
                  <th>Stato</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {accounts.data.map((account) => (
                  <FragmentRow
                    key={account.id}
                    account={account}
                    open={open === account.id}
                    toggle={() => setOpen(open === account.id ? null : account.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function FragmentRow({
  account,
  open,
  toggle,
}: {
  account: Account;
  open: boolean;
  toggle: () => void;
}) {
  const latest = [...account.params].sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1));
  const spending = latest.find((p) => p.isSpendingAccount !== undefined)?.isSpendingAccount;
  return (
    <>
      <tr>
        <td>
          <strong>{account.name}</strong>
          {spending && (
            <span className="pill green" style={{ marginLeft: 8 }}>
              di spesa
            </span>
          )}
        </td>
        <td>
          {ACCOUNT_TYPE_LABELS[account.type]}
          {account.realEstateUse &&
            ` (${account.realEstateUse === "income" ? "a reddito" : "abitazione principale"})`}
        </td>
        <td>{account.institution ?? "—"}</td>
        <td>
          {account.type === "real_estate"
            ? "—"
            : account.contributionsMode === "declared"
              ? "dichiarati"
              : "dedotti"}
        </td>
        <td>
          {account.archivedAt ? `archiviato dal ${formatDate(account.archivedAt)}` : "attivo"}
        </td>
        <td>
          <button className="link" onClick={toggle} aria-expanded={open}>
            {open ? "Chiudi" : "Dettagli"}
          </button>
        </td>
      </tr>
      {open && <AccountDetail account={account} />}
    </>
  );
}
