import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAccounts } from "../api/queries";
import { useGet, useWrite } from "../api/hooks";
import type { Account, FireflyMovement, IncomeKind, MovementAnnotation } from "../api/types";
import { Bars } from "../components/Charts";
import { AccruedReturns } from "../components/AccruedReturns";
import { Banner, Field, Loading, QueryError } from "../components/ui";
import {
  annotationOf,
  categoryOf,
  groupMovements,
  incomeKindOf,
  INCOME_LABELS,
  movementsCsv,
  summarize,
  receiptAmounts,
  TYPE_LABELS,
  type GroupBy,
} from "../lib/analytics";
import { endOfMonth, todayIso } from "../lib/dates";
import { formatDate, formatEuro, formatMonth, formatPercent } from "../lib/format";
import "./analytics.css";
import {
  analyticsHref,
  defaultAnalyticsFilters,
  filterMovements,
  readAnalyticsFilters,
  validReportRange,
} from "../lib/analyticsFilters";

const money = (v: number) => formatEuro(v, 2);
const grossValue = (amount: number, missing: number) =>
  missing > 0 && amount === 0 ? "Non disponibile" : money(amount);
const grossLabel = (amount: number, missing: number) =>
  missing > 0 && amount > 0 ? "Lordo noto (parziale)" : "Lordo";
const CLASSES = {
  unclassified: "Da classificare",
  essential: "Essenziale",
  discretionary: "Discrezionale",
};

export function Analytics() {
  const query = useGet<FireflyMovement[]>("/firefly/movements");
  const accountQuery = useAccounts();
  const now = todayIso();
  const [initialFilters] = useState(() => readAnalyticsFilters());
  const initial = initialFilters ?? defaultAnalyticsFilters(now.slice(0, 7) + "-01", now);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [search, setSearch] = useState(initial.search);
  const [category, setCategory] = useState(initial.category);
  const [tag, setTag] = useState(initial.tag);
  const [account, setAccount] = useState(initial.account);
  const [excludedCategories, setExcludedCategories] = useState<string[]>(
    initial.excludedCategories,
  );
  const [excludedAccounts, setExcludedAccounts] = useState<string[]>(initial.excludedAccounts);
  const [includedCategories, setIncludedCategories] = useState<string[]>(
    initial.includedCategories,
  );
  const [type, setType] = useState(initial.type);
  const [classification, setClassification] = useState(initial.classification);
  const [inclusion, setInclusion] = useState(initial.inclusion);
  const [yieldOnly, setYieldOnly] = useState(initial.yieldOnly);
  const [groupBy, setGroupBy] = useState<GroupBy>("category");
  const [editing, setEditing] = useState<FireflyMovement | null>(null);
  const [page, setPage] = useState(0);
  const initializedRange = useRef(Boolean(initialFilters));
  useEffect(() => {
    if (!query.data || initializedRange.current) return;
    initializedRange.current = true;
    const latest = query.data[0]?.date;
    if (latest && latest.slice(0, 7) !== now.slice(0, 7)) {
      setFrom(latest.slice(0, 7) + "-01");
      setTo(endOfMonth(latest.slice(0, 7)));
    }
  }, [query.data, now]);
  useEffect(
    () => setPage(0),
    [
      from,
      to,
      search,
      category,
      tag,
      account,
      type,
      classification,
      inclusion,
      yieldOnly,
      includedCategories,
      excludedCategories,
      excludedAccounts,
    ],
  );
  if (query.error || accountQuery.error)
    return <QueryError error={query.error ?? accountQuery.error} />;
  if (!query.data || !accountQuery.data) return <Loading what="analytics" />;
  const movements = query.data;
  const categories = [...new Set(movements.map(categoryOf))].sort();
  const tags = [...new Set(movements.flatMap((m) => annotationOf(m).tags))].sort();
  const accounts = [...new Set(movements.flatMap((m) => [m.fromName, m.toName]))].sort();
  const filters = {
    from,
    to,
    search,
    category,
    tag,
    account,
    includedCategories,
    excludedCategories,
    excludedAccounts,
    type,
    classification,
    inclusion,
    yieldOnly,
  };
  const rows = filterMovements(movements, filters);
  const totals = summarize(rows, accountQuery.data);
  const groups = groupMovements(rows, groupBy, accountQuery.data);
  const months = groupMovements(rows, "month", accountQuery.data).map((g) => ({
    date: g.name,
    income: g.income,
    spending: g.spending,
    yieldNet: g.yieldNet,
    salary: g.salary,
    otherIncome: g.otherIncome,
  }));
  const spendingGroups = groupMovements(rows, "category", accountQuery.data).filter(
    (g) => g.spending > 0,
  );
  const pageCount = Math.max(1, Math.ceil(rows.length / 25));
  const currentPage = Math.min(page, pageCount - 1);
  const excluded = rows.filter((m) => !annotationOf(m).included).length;
  function exportCsv() {
    const url = URL.createObjectURL(
      new Blob([movementsCsv(rows, accountQuery.data)], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics-${from}-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="analytics">
      <div className="analytics-heading">
        <div>
          <div className="analytics-eyebrow">IL TUO DENARO, IN CHIARO</div>
          <h1>Analytics</h1>
          <p>Esplora i flussi. Dai un significato a ogni spesa.</p>
        </div>
        <div className="row">
          <button
            className="primary"
            disabled={!validReportRange(from, to) || !movements.length}
            onClick={() => {
              window.history.replaceState(null, "", analyticsHref("/analytics", filters));
              window.location.hash = analyticsHref("/analytics/report", filters).slice(1);
            }}
          >
            Genera report
          </button>
          <button onClick={exportCsv} disabled={!rows.length}>
            Esporta CSV ↗
          </button>
        </div>
      </div>
      {!movements.length && (
        <Banner kind="info">
          Importa i movimenti nella sezione <a href="#/firefly">Firefly III</a> per iniziare.
        </Banner>
      )}
      <section className="analytics-panel analytics-filters" aria-label="Filtri analytics">
        <div className="row">
          <Field label="Dal">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
          </Field>
          <Field label="Al">
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} required />
          </Field>
          <Field label="Cerca transazioni">
            <input
              type="search"
              placeholder="Descrizione, categoria, tag…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
          <button
            onClick={() => {
              setFrom(now.slice(0, 7) + "-01");
              setTo(now);
            }}
          >
            Questo mese
          </button>
          <button
            onClick={() => {
              setFrom(now.slice(0, 4) + "-01-01");
              setTo(now);
            }}
          >
            Quest’anno
          </button>
          <button
            onClick={() => {
              setFrom(movements.at(-1)?.date ?? now);
              setTo(movements[0]?.date ?? now);
            }}
          >
            Tutto lo storico
          </button>
        </div>
        <div className="row">
          <Field label="Tipo">
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Tutti i movimenti</option>
              {Object.entries(TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Categoria">
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Tutte le categorie</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Tag">
            <select value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">Tutti i tag</option>
              {tags.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Conto / controparte">
            <select value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="">Tutti</option>
              {accounts.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </Field>
          <Field label="Spese">
            <select value={classification} onChange={(e) => setClassification(e.target.value)}>
              <option value="">Tutte le classificazioni</option>
              {Object.entries(CLASSES).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Conteggio">
            <select value={inclusion} onChange={(e) => setInclusion(e.target.value)}>
              <option value="all">Incluse ed escluse</option>
              <option value="included">Solo incluse</option>
              <option value="excluded">Solo escluse</option>
            </select>
          </Field>
          <Field label="Solo rendite" check>
            <input
              type="checkbox"
              checked={yieldOnly}
              onChange={(e) => setYieldOnly(e.target.checked)}
            />
          </Field>
          <button
            className="link"
            onClick={() => {
              setSearch("");
              setCategory("");
              setTag("");
              setAccount("");
              setIncludedCategories([]);
              setExcludedCategories([]);
              setExcludedAccounts([]);
              setType("");
              setClassification("");
              setInclusion("all");
              setYieldOnly(false);
            }}
          >
            Azzera filtri
          </button>
        </div>
        <div className="analytics-exclusions">
          <ExclusionFilter
            label="Includi categorie"
            options={categories}
            selected={includedCategories}
            onChange={setIncludedCategories}
          />
          <ExclusionFilter
            label="Escludi categorie"
            options={categories}
            selected={excludedCategories}
            onChange={setExcludedCategories}
          />
          <ExclusionFilter
            label="Escludi conti / controparti"
            options={accounts}
            selected={excludedAccounts}
            onChange={setExcludedAccounts}
          />
          <p className="muted small">
            Seleziona più categorie in «Includi categorie» per analizzarle insieme; nessuna
            selezione include tutte. Le esclusioni valgono per transazioni, grafici, totali ed
            esportazione. Un conto escluso rimuove i movimenti in cui compare come origine o
            destinazione.
          </p>
        </div>
      </section>
      {(!from || !to || from > to) && (
        <Banner kind="error">
          Scegli un intervallo valido: la data iniziale deve precedere quella finale.
        </Banner>
      )}
      <AccruedReturns
        range={{ from, to }}
        movements={movements}
        accountName={account}
        excludedNames={excludedAccounts}
      />
      <h2>Movimenti importati · lordo e netto stimato</h2>
      <p className="muted small">
        Le entrate nei conti titoli sono importi lordi. Il netto stimato applica l’aliquota del
        conto alla data del movimento. Per le altre rendite vale la stessa regola: imposta 0% se gli
        importi sono già tassati. I trasferimenti restano separati dalle entrate.
      </p>
      <div className="analytics-kpis">
        {[
          ["Entrate nette (stimate)", totals.income, "income"],
          ["Spese", totals.spending, "spending"],
          ["Saldo stimato del periodo", totals.balance, "balance"],
          ["Stipendio netto", totals.salary, "salary"],
          ["Altre entrate nette (stimate)", totals.yieldNet, "yield"],
        ].map(([label, value, cls]) => (
          <section className={`analytics-panel metric ${cls}`} key={label}>
            <span>{label}</span>
            <strong>{money(Number(value))}</strong>
            {cls === "yield" && (
              <div className="metric-gross">
                <small>
                  {grossLabel(totals.yieldGross, totals.unknownGross)}:{" "}
                  {grossValue(totals.yieldGross, totals.unknownGross)}
                </small>
                {totals.unknownGross > 0 && (
                  <small>{totals.unknownGross} rendite senza lordo</small>
                )}
              </div>
            )}
            <small>
              {cls === "balance"
                ? "Entrate meno spese"
                : cls === "salary"
                  ? "Entrate classificate come stipendio"
                  : cls === "yield"
                    ? "Entrate diverse dallo stipendio"
                    : "Transazioni incluse nei filtri"}
            </small>
          </section>
        ))}
      </div>
      {totals.otherIncome > 0 && (
        <p className="muted small">
          Altre entrate: {money(totals.otherIncome)}. Sono incluse nelle entrate nette totali; puoi
          classificarle da «Dettagli».
        </p>
      )}
      <div className="analytics-grid">
        <section className="analytics-panel">
          <h2>Il ritmo del tuo denaro</h2>
          <p className="muted small">Entrate e spese, mese dopo mese</p>
          <Bars
            rows={months}
            series={[
              { key: "salary", label: "Stipendio", color: "var(--blue)" },
              { key: "yieldNet", label: "Rendite", color: "var(--series-0)" },
              { key: "otherIncome", label: "Altre entrate", color: "var(--series-6)" },
              { key: "spending", label: "Spese", color: "var(--series-2)" },
            ]}
          />
        </section>
        <section className="analytics-panel">
          <h2>Dove spendi</h2>
          <p className="muted small">Seleziona una categoria per esplorarla</p>
          {spendingGroups.length ? (
            <div className="category-list">
              {spendingGroups.map((g) => (
                <button
                  className="category-bar"
                  key={g.name}
                  onClick={() => {
                    setCategory(g.name);
                    setType("withdrawal");
                  }}
                >
                  <span>
                    {g.name}
                    <strong>{money(g.spending)}</strong>
                  </span>
                  <span className="bar-track">
                    <span style={{ width: `${(g.spending / totals.spending) * 100}%` }} />
                  </span>
                  <small>{((g.spending / totals.spending) * 100).toFixed(1)}% delle spese</small>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">Nessuna spesa nel periodo.</p>
          )}
        </section>
      </div>
      <div className="analytics-grid">
        <section className="analytics-panel">
          <h2>Essenziale o discrezionale?</h2>
          {(["essential", "discretionary", "unclassified"] as const).map((k) => (
            <button
              className="split-row"
              key={k}
              onClick={() => {
                setClassification(k);
                setType("withdrawal");
              }}
            >
              <span className={`classification-dot ${k}`} />
              {CLASSES[k]}
              <strong>{money(totals[k])}</strong>
            </button>
          ))}
          <p className="muted small">
            Apri una transazione per classificarla. Le spese senza classificazione restano visibili.
          </p>
        </section>
        <section className="analytics-panel yield-panel">
          <div className="analytics-eyebrow">ENTRATE DIVERSE DALLO STIPENDIO</div>
          <h2>Altre entrate incassate</h2>
          <div className="yield-values">
            <div>
              <span>Netto</span>
              <strong>{money(totals.yieldNet)}</strong>
            </div>
            <div>
              <span>{grossLabel(totals.yieldGross, totals.unknownGross)}</span>
              <strong>{grossValue(totals.yieldGross, totals.unknownGross)}</strong>
            </div>
          </div>
          <p className="small">
            {totals.unknownGross
              ? `${totals.unknownGross} rendite senza lordo: il totale lordo è incompleto.`
              : "Lordo inserito nelle annotazioni delle rendite."}{" "}
            Classifica come rendita interessi, dividendi o affitti tramite «Dettagli».
          </p>
          <button
            onClick={() => {
              setYieldOnly(!yieldOnly);
            }}
          >
            {yieldOnly ? "Mostra tutti i flussi" : "Esplora le rendite"}
          </button>
        </section>
      </div>
      <section className="analytics-panel">
        <div className="toolbar">
          <h2>Confronta i gruppi</h2>
          <Field label="Raggruppa per">
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
              <option value="category">Categoria</option>
              <option value="month">Mese</option>
              <option value="tag">Tag</option>
              <option value="counterparty">Controparte</option>
            </select>
          </Field>
        </div>
        {groupBy === "tag" && (
          <p className="muted small">
            Una transazione con più tag compare in più gruppi. I gruppi non si sommano al totale.
          </p>
        )}
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>Gruppo</th>
                <th>Entrate nette</th>
                <th>Spese</th>
                <th>Stipendio netto</th>
                <th>Rendite nette</th>
                <th>Rendite lorde</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.name}>
                  <td>{groupBy === "month" ? formatMonth(g.name) : g.name}</td>
                  <td className="num">{money(g.income)}</td>
                  <td className="num">{money(g.spending)}</td>
                  <td className="num">{money(g.salary)}</td>
                  <td className="num">{money(g.yieldNet)}</td>
                  <td className="num">
                    {grossValue(g.yieldGross, g.unknownGross)}
                    {g.unknownGross > 0 && (
                      <span className="muted small">
                        {" "}
                        · {g.yieldGross > 0 ? "parziale · " : ""}
                        {g.unknownGross} mancanti
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!groups.length && <p className="muted">Nessun movimento corrisponde ai filtri.</p>}
      </section>
      <section className="analytics-panel">
        <div className="toolbar">
          <div>
            <h2>Ogni transazione conta</h2>
            <p className="muted small">
              {rows.length} transazioni · {excluded} escluse dai totali. Saldi iniziali e
              trasferimenti non aumentano entrate o spese.
            </p>
          </div>
        </div>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Transazione</th>
                <th>Categoria / tag</th>
                <th>Classificazione</th>
                <th className="num">Importo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.slice(currentPage * 25, (currentPage + 1) * 25).map((m) => {
                const a = annotationOf(m);
                return (
                  <tr key={m.id} className={!a.included ? "excluded-row" : ""}>
                    <td>{formatDate(m.date)}</td>
                    <td>
                      <strong>{m.description || TYPE_LABELS[m.type] || m.type}</strong>
                      <div className="muted small">
                        {m.fromName} → {m.toName}
                      </div>
                      <span className={`movement-chip ${m.type}`}>
                        {TYPE_LABELS[m.type] ?? m.type}
                      </span>
                      {!a.included && <span className="movement-chip">Esclusa</span>}
                    </td>
                    <td>
                      {categoryOf(m)}
                      <div className="tag-list">
                        {a.tags.map((t) => (
                          <span key={t}>{t}</span>
                        ))}
                      </div>
                    </td>
                    <td>
                      {m.type === "withdrawal"
                        ? CLASSES[a.spendingClass]
                        : m.type === "deposit"
                          ? INCOME_LABELS[incomeKindOf(m)]
                          : "—"}
                    </td>
                    <td className="num">
                      {money(m.amount)}
                      {m.type === "deposit" && receiptAmounts(m, accountQuery.data).estimated && (
                        <div className="muted small">
                          Lordo · netto stimato {money(receiptAmounts(m, accountQuery.data).net)}
                        </div>
                      )}
                    </td>
                    <td>
                      <button
                        onClick={() => setEditing(m)}
                        aria-label={`Dettagli ${m.description || m.id}`}
                      >
                        Dettagli
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <p className="muted">
            Nessuna transazione. Modifica i filtri o importa un altro periodo da Firefly.
          </p>
        )}
        <div className="analytics-pagination">
          <button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>
            ← Precedente
          </button>
          <span>
            Pagina {currentPage + 1} di {pageCount}
          </span>
          <button disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>
            Successiva →
          </button>
        </div>
      </section>
      {editing && (
        <AnnotationEditor
          key={editing.id}
          movement={editing}
          accounts={accountQuery.data}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function AnnotationEditor({
  movement: m,
  accounts,
  onClose,
}: {
  movement: FireflyMovement;
  accounts: Account[];
  onClose: () => void;
}) {
  const receipt = receiptAmounts(m, accounts);
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState({
    ...annotationOf(m),
    ...(m.type !== "deposit"
      ? { isYield: false, grossAmount: null, incomeKind: null }
      : { incomeKind: incomeKindOf(m) }),
  });
  const [tags, setTags] = useState(draft.tags.join(", "));
  const [gross, setGross] = useState(draft.grossAmount?.toString() ?? "");
  const [error, setError] = useState("");
  const write = useWrite<{ id: string; annotation: MovementAnnotation }>(
    "PUT",
    ({ id }) => `/firefly/movements/${encodeURIComponent(id)}/annotation`,
    ({ annotation }) => annotation,
  );
  useEffect(() => {
    const d = dialog.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  async function save(e: FormEvent) {
    e.preventDefault();
    const grossAmount = receipt.estimated
      ? null
      : gross.trim()
        ? Number(gross.replace(",", "."))
        : null;
    if (grossAmount !== null && (!Number.isFinite(grossAmount) || grossAmount < m.amount)) {
      setError("Inserisci un lordo almeno pari al netto.");
      return;
    }
    try {
      await write.mutateAsync({
        id: m.id,
        annotation: {
          ...draft,
          grossAmount,
          tags: [
            ...new Set(
              tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
            ),
          ],
        },
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Salvataggio non riuscito");
    }
  }
  return (
    <dialog
      ref={dialog}
      className="analytics-dialog"
      aria-labelledby="transaction-title"
      onCancel={(e) => {
        if (write.isPending) e.preventDefault();
        else onClose();
      }}
    >
      <div className="toolbar">
        <h2 id="transaction-title">Dettaglio transazione</h2>
        <button onClick={onClose} disabled={write.isPending} aria-label="Chiudi dettagli">
          ✕
        </button>
      </div>
      <h3>{m.description || TYPE_LABELS[m.type]}</h3>
      <div className="transaction-amount">{money(m.amount)}</div>
      <p className="muted">
        {formatDate(m.date)} · {categoryOf(m)}
        <br />
        {m.fromName} → {m.toName}
      </p>
      <form className="stack" onSubmit={(e) => void save(e)}>
        {error && <Banner kind="error">{error}</Banner>}
        <Field label="Tag" hint="Separali con una virgola, ad esempio: casa, famiglia, ricorrente">
          <input autoFocus value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        {m.type === "withdrawal" && (
          <Field label="Tipo di spesa">
            <select
              value={draft.spendingClass}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  spendingClass: e.target.value as MovementAnnotation["spendingClass"],
                })
              }
            >
              {Object.entries(CLASSES).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
        )}
        {m.type === "deposit" && (
          <>
            <Field label="Tipo di entrata">
              <select
                value={draft.incomeKind ?? "other"}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    incomeKind: e.target.value as IncomeKind,
                    isYield: e.target.value === "yield",
                  })
                }
              >
                {Object.entries(INCOME_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            {receipt.estimated ? (
              <Banner kind="info">
                Importo Firefly lordo: {money(receipt.gross!)}. Aliquota del conto:{" "}
                {formatPercent(receipt.taxRate!, 2)}. Netto stimato: {money(receipt.net)}.{" "}
                <a href="#/conti">Modifica l’aliquota in Conti</a>.
              </Banner>
            ) : (
              <Field
                label="Importo lordo (€)"
                hint="Facoltativo. L’accredito Firefly rappresenta il netto; inserisci il lordo se lo conosci."
              >
                <input
                  inputMode="decimal"
                  value={gross}
                  onChange={(e) => setGross(e.target.value)}
                  placeholder="Non conosciuto"
                />
              </Field>
            )}
          </>
        )}
        <Field label="Includi nei conteggi analytics" check>
          <input
            type="checkbox"
            checked={draft.included}
            onChange={(e) => setDraft({ ...draft, included: e.target.checked })}
          />
        </Field>
        <p className="muted small">
          Le annotazioni vengono salvate in Lifebook e conservate alle successive importazioni. Le
          categorie e gli importi originali si aggiornano da Firefly.
        </p>
        <div className="row">
          <button type="submit" className="primary" disabled={write.isPending}>
            {write.isPending ? "Salvataggio…" : "Salva modifiche"}
          </button>
          <button type="button" onClick={onClose} disabled={write.isPending}>
            Annulla
          </button>
        </div>
      </form>
    </dialog>
  );
}

function ExclusionFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <div className="exclusion-filter">
      <Field label={label}>
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onChange([...selected, e.target.value]);
          }}
        >
          <option value="">Aggiungi una categoria o un conto…</option>
          {options
            .filter((value) => !selected.includes(value))
            .map((value) => (
              <option key={value}>{value}</option>
            ))}
        </select>
      </Field>
      {selected.length > 0 && (
        <ul className="exclusion-chips" aria-label={`${label}: selezione attiva`}>
          {selected.map((value) => (
            <li key={value}>
              <button
                type="button"
                aria-label={`${label}: rimuovi ${value}`}
                onClick={() => onChange(selected.filter((item) => item !== value))}
              >
                {value} <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
