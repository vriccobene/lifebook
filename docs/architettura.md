# Architettura e sviluppo

## Struttura

```
packages/lifebook-core/   motore di calcolo in TypeScript puro, senza I/O
apps/lifebook-api/        REST (Fastify) su SQLite (Drizzle + better-sqlite3)
apps/lifebook-web/        interfaccia React (Vite, TanStack Query, Recharts)
docs/                     specifiche e documentazione
```

Il core non importa nulla dall'API, dalla web app né da librerie di I/O: una regola ESLint lo impedisce. L'API e la web app lo importano direttamente dai sorgenti TypeScript (pacchetto interno), quindi non serve compilarlo.

Comandi: `pnpm check` (format, lint, typecheck e test di tutto: è anche l'hook pre-commit), `pnpm dev`, `pnpm build`.

## Il core

Tutte le funzioni sono pure. Il punto d'ingresso è `computeAsOf(data, asOf)`, che restituisce costo della vita, capitale, metodi e verdetto **usando solo i dati e i parametri validi a quella data**: `prepareDataset` scarta tutto ciò che è successivo e risolve le impostazioni alla data. Le serie storiche sono `computeSeries(data, {from, to, step}, compute)`, che ripete il calcolo per ogni data. Non c'è nessuna serie salvata da invalidare: una modifica retroattiva cambia semplicemente il risultato del prossimo calcolo.

- **Parametri datati.** Impostazioni e parametri dei conti sono patch con `validFrom` sovrapposte in ordine di data (`resolveSettings`, `resolveAccountParams`). Per un periodo vale il valore in vigore alla sua data di fine.
- **Periodi mensili.** Un periodo è un mese di calendario, chiuso dall'ultima lettura di un conto di spesa in quel mese (`roundDates`). La spesa è entrate − variazione dei conti di spesa − trasferimenti verso gli altri conti, divisa per i mesi coperti (`livingCost.ts`).
- **Metodi.** Ogni metodo implementa `Method { id, family, countsForVerdict, evaluate(ctx) }` e restituisce esito, copertura, distanza. `MethodRegistry` è immutabile: `register` restituisce un nuovo registro.

### Aggiungere un metodo (ad esempio Monte Carlo)

1. Implementa `Method` in `packages/lifebook-core/src/methods/` (deve essere puro e deterministico: se serve casualità, il seme è un parametro).
2. Registralo: `defaultRegistry.register(myMethod)`, oppure aggiungilo a `defaultMethods`.
3. Aggiungi l'etichetta italiana in `apps/lifebook-web/src/lib/labels.ts`.

I metodi esistenti non cambiano. Un metodo che non deve pesare sul verdetto ha `countsForVerdict: false`.

## L'API

- Prefisso `/api/v1`, autenticazione `Authorization: Bearer <token>` (sessione da 30 giorni dal login oppure token API senza scadenza; entrambi salvati come hash SHA-256).
- Il denaro è salvato in **centesimi interi**; l'API e il core parlano in euro. La conversione avviene nel confine del repository (`repo.ts`).
- Gli schemi zod validano gli ingressi e generano la documentazione OpenAPI (`/api/v1/openapi.json`).
- `results/*` non contiene logica di calcolo: carica i dati (`loadLifebookData`) e invoca il core con `asOf` o `from`/`to`/`step`.
- Le migrazioni si generano con `pnpm --filter @lifebook/api db:generate` e si applicano all'avvio.
- Il server ascolta solo su 127.0.0.1 e non registra token né corpi delle richieste.

Script: `backup` (copia consistente con rotazione) e `seed` (dati fittizi, solo su database vuoto).

## Test

| Pacchetto | Cosa | Come |
| --- | --- | --- |
| core | unit test con dati sintetici e casi limite: mese mancante, spesa negativa, conto archiviato, più conti di spesa, pensione accesa e spenta, dati retroattivi, parametri nel tempo, calcolo as-of | Vitest |
| api | integrazione su SQLite in memoria: autenticazione, CRUD, isolamento tra utenti, risultati, OpenAPI, backup, seed | Vitest |
| web | logica pura (formati, giro, impostazioni, grafici) ed end to end: la vera app React in jsdom contro la vera API e il vero core | Vitest + Testing Library |

Ogni bug corretto ha un test di regressione. **Nessun dato finanziario reale** va nel repository, nei test o nei log: i dati di prova sono sintetici.
