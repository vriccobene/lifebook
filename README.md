# Lifebook

Webapp personale per monitorare patrimonio e investimenti e capire quando si può smettere di lavorare. Le specifiche sono in [docs/lifebook-spec.md](docs/lifebook-spec.md).

## Struttura

```
apps/lifebook-api/       backend REST (Fastify, SQLite)
apps/lifebook-web/       frontend React (Vite)
packages/lifebook-core/  motore di calcolo in TS puro, senza I/O
docs/                    specifiche e documentazione
```

Una nuova app si aggiunge creando una cartella in `apps/` (o `packages/`) con il proprio `package.json`: il workspace la rileva da solo.

## Requisiti

Node 22 LTS e pnpm 10 (`corepack enable`).

## Comandi

Dalla radice, su tutti i pacchetti:

| Comando          | Cosa fa                                      |
| ---------------- | -------------------------------------------- |
| `pnpm install`   | installa le dipendenze                       |
| `pnpm build`     | compila tutti i pacchetti                    |
| `pnpm test`      | esegue i test (Vitest)                       |
| `pnpm lint`      | ESLint                                       |
| `pnpm typecheck` | controllo dei tipi                           |
| `pnpm check`     | format, lint, typecheck e test: la CI locale |
| `pnpm format`    | formatta con Prettier                        |

`lifebook-core` è un pacchetto interno: gli altri pacchetti lo importano direttamente dai sorgenti TypeScript, quindi non serve compilarlo prima. `build` dell'API controlla solo i tipi: il server si avvia con `tsx`.

Su un solo pacchetto: `pnpm --filter @lifebook/core test`.

## API

```
pnpm --filter @lifebook/api start      # http://127.0.0.1:3000/api/v1
```

| Variabile     | Default                | Cosa fa                  |
| ------------- | ---------------------- | ------------------------ |
| `LIFEBOOK_DB` | `data/lifebook.sqlite` | percorso del file SQLite |
| `PORT`        | `3000`                 | porta                    |
| `HOST`        | `127.0.0.1`            | ascolta solo in locale   |

Al primo avvio crea l'utente con `POST /api/v1/auth/setup`. Poi `POST /api/v1/auth/login` restituisce un token di sessione (30 giorni); i token per accessi esterni si creano con `POST /api/v1/auth/tokens`. Ogni richiesta usa `Authorization: Bearer <token>`. La documentazione OpenAPI, generata dagli schemi zod, è su `/api/v1/openapi.json`.

Dopo aver modificato `src/db/schema.ts` genera la migrazione con `pnpm --filter @lifebook/api db:generate`: viene applicata all'avvio.

## Dati

I database SQLite, i file `.env`, i backup e i CSV sono ignorati da git. Nessun dato finanziario reale va nel repository.

## Hook pre-commit

`pnpm install` attiva `.githooks/pre-commit`, che esegue `pnpm check` prima di ogni commit. Se qualcosa è rosso il commit viene bloccato.
