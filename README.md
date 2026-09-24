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

Su un solo pacchetto: `pnpm --filter @lifebook/core test`.

## Dati

I database SQLite, i file `.env`, i backup e i CSV sono ignorati da git. Nessun dato finanziario reale va nel repository.

## Hook pre-commit

`pnpm install` attiva `.githooks/pre-commit`, che esegue `pnpm check` prima di ogni commit. Se qualcosa è rosso il commit viene bloccato.
