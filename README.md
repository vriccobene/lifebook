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

## Avvio rapido

Dalla cartella del progetto:

```bash
pnpm install     # solo la prima volta, o dopo un aggiornamento delle dipendenze
pnpm dev         # avvia l'API e la web app insieme
```

Poi apri **http://localhost:5173**. Al primo accesso l'app ti chiede di creare nome utente e password (almeno 8 caratteri). Per fermare tutto premi `Ctrl+C`.

- L'API gira su `http://127.0.0.1:3000` ed è raggiungibile solo dal tuo computer. La web app la raggiunge da sola tramite un proxy.
- I tuoi dati sono in un solo file, `apps/lifebook-api/data/lifebook.sqlite`, creato al primo avvio e ignorato da git. Fanne una copia ogni tanto (vedi «Backup»).

### Provare l'app con dati fittizi

Per esplorare l'app senza inserire dati tuoi, carica una famiglia fittizia in un database a parte:

```bash
LIFEBOOK_DB=data/demo.sqlite pnpm --filter @lifebook/api seed
LIFEBOOK_DB=data/demo.sqlite pnpm dev
```

Accedi con utente `demo` e password `demo-password-1234`. Per tornare ai tuoi dati rilancia `pnpm dev` senza `LIFEBOOK_DB`. Il comando `seed` funziona solo su un database senza utenti: se il file esiste già, accedi con le credenziali demo oppure cancella il file (con i suoi `-wal` e `-shm`) e rilancialo.

### Backup

```bash
pnpm --filter @lifebook/api backup
```

Crea una copia consistente in `apps/lifebook-api/backups/` e tiene le ultime 30. Con l'API in funzione non serve fermarla. Per ripristinare: ferma l'app, copia il file di backup sopra `apps/lifebook-api/data/lifebook.sqlite` e riavvia.

### Se qualcosa non parte

| Problema                                     | Cosa fare                                                                                                                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm: command not found`                    | esegui `corepack enable`, poi riprova                                                                                                                                |
| errore sulla versione di Node                | serve Node 22 o superiore (`node -v`)                                                                                                                                |
| porta 3000 o 5173 occupata                   | chiudi il programma che la usa: la web app raggiunge l'API solo sulla 3000                                                                                           |
| errore su `better-sqlite3` all'installazione | riesegui `pnpm install`; se persiste servono gli strumenti di compilazione del sistema (su Debian/Ubuntu `build-essential` e `python3`)                              |
| la pagina non carica i dati                  | controlla che `pnpm dev` sia ancora in esecuzione e senza errori nel terminale                                                                                       |
| password dimenticata                         | non esiste ancora un ripristino della password. **Non cancellare il file `.sqlite`**: conterrebbe tutti i tuoi dati. Conservalo e chiedi di aggiungere il ripristino |

Per cambiare porta, file del database o indirizzo di ascolto dell'API vedi la tabella delle variabili nella sezione «API».

## Comandi

Dalla radice, su tutti i pacchetti:

| Comando          | Cosa fa                                 |
| ---------------- | --------------------------------------- |
| `pnpm install`   | installa le dipendenze                  |
| `pnpm build`     | compila tutti i pacchetti               |
| `pnpm test`      | esegue i test (Vitest)                  |
| `pnpm lint`      | ESLint                                  |
| `pnpm typecheck` | controllo dei tipi                      |
| `pnpm dev`       | avvia API e web app per l'uso in locale |
| `pnpm check`     | format, lint, typecheck, build e test   |
| `pnpm format`    | formatta con Prettier                   |

`lifebook-core` è un pacchetto interno: gli altri pacchetti lo importano direttamente dai sorgenti TypeScript, quindi non serve compilarlo prima. `build` dell'API controlla solo i tipi: il server si avvia con `tsx`.

Su un solo pacchetto: `pnpm --filter @lifebook/core test`.

## Sviluppo

`pnpm dev` avvia insieme l'API (porta 3000) e la web app (http://localhost:5173, con proxy verso l'API).

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

## Backup e dati di esempio

```
pnpm --filter @lifebook/api backup                 # copia consistente in backups/ (ultimi 30)
LIFEBOOK_DB=data/demo.sqlite pnpm --filter @lifebook/api seed   # dati fittizi, solo su database vuoto
```

Guida all'uso: [docs/guida-utente.md](docs/guida-utente.md). Architettura e sviluppo: [docs/architettura.md](docs/architettura.md).

## Dati

I database SQLite, i file `.env`, i backup e i CSV sono ignorati da git. Nessun dato finanziario reale va nel repository.

## Hook pre-commit

`pnpm install` attiva `.githooks/pre-commit`, che esegue `pnpm check` prima di ogni commit. Se qualcosa è rosso il commit viene bloccato.
