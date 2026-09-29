# Lifebook

Monorepo delle app personali di Lifebook. Per ora contiene **Lifebook Finanze**, la webapp personale per monitorare patrimonio e investimenti e capire quando si può smettere di lavorare. Le specifiche sono in [docs/lifebook-spec.md](docs/lifebook-spec.md).

## Struttura

```
apps/                   le app di Lifebook, una cartella ciascuna
  finanze/              Lifebook Finanze
    api/                backend REST (Fastify, SQLite)
    web/                frontend React (Vite)
    core/               motore di calcolo in TS puro, senza I/O
bin/                    script di amministrazione degli utenti
docs/                   specifiche e documentazione
```

Una nuova app si aggiunge come cartella `apps/<app>/` con i suoi pacchetti (`api`, `web`, …), ognuno con il proprio `package.json` chiamato `@lifebook/<app>-<pacchetto>`: il workspace (`apps/*/*`) li rileva da solo.

## Requisiti

Node 22 LTS e pnpm 10 (`corepack enable`).

## Avvio rapido

Dalla cartella del progetto:

```bash
pnpm install     # solo la prima volta, o dopo un aggiornamento delle dipendenze
pnpm dev         # avvia l'API e la web app insieme (oppure bin/start, da qualsiasi cartella)
```

Poi apri **http://localhost:5173**. Al primo accesso l'app ti chiede di creare nome utente e password (almeno 8 caratteri): questo primo utente è l'amministratore. Per fermare tutto premi `Ctrl+C`.

L'app è multiutente: l'amministratore crea gli altri utenti dalla pagina **Profilo** (clic sul tuo nome in alto). Ogni utente vede solo i propri dati; nemmeno l'amministratore vede i dati degli altri.

- L'API gira su `http://127.0.0.1:3000` ed è raggiungibile solo dal tuo computer. La web app la raggiunge da sola tramite un proxy.
- I tuoi dati sono in un solo file, `apps/finanze/api/data/lifebook.sqlite`, creato al primo avvio e ignorato da git. Fanne una copia ogni tanto (vedi «Backup»).
- Accanto c'è `lifebook.sqlite.key`, la chiave che cifra i token di Firefly III (vedi «Import da Firefly III»).

### Provare l'app con dati fittizi

Per esplorare l'app senza inserire dati tuoi, carica una famiglia fittizia in un database a parte:

```bash
LIFEBOOK_DB=data/demo.sqlite pnpm --filter @lifebook/finanze-api seed
LIFEBOOK_DB=data/demo.sqlite pnpm dev
```

Accedi con utente `demo` e password `demo-password-1234`. Per tornare ai tuoi dati rilancia `pnpm dev` senza `LIFEBOOK_DB`. Il comando `seed` funziona solo su un database senza utenti: se il file esiste già, accedi con le credenziali demo oppure cancella il file (con i suoi `-wal` e `-shm`) e rilancialo.

### Backup

```bash
pnpm --filter @lifebook/finanze-api backup
```

Crea una copia consistente in `apps/finanze/api/backups/` e tiene le ultime 30. Con l'API in funzione non serve fermarla. Per ripristinare: ferma l'app, copia il file di backup sopra `apps/finanze/api/data/lifebook.sqlite` e riavvia.

Il backup contiene i dati di tutti gli utenti ma non la chiave `lifebook.sqlite.key`, apposta: un backup copiato altrove non contiene token di Firefly III utilizzabili. Se ripristini su una macchina senza la chiave, ogni utente deve solo reinserire il proprio token.

### Import da Firefly III

Chi usa [Firefly III](https://www.firefly-iii.org) può importare da lì saldi e trasferimenti invece di inserirli a mano. Ogni utente collega il proprio Firefly III dalla pagina **Firefly III** con l'indirizzo e un token di accesso personale (in Firefly III: Opzioni → Profilo → OAuth → Personal Access Tokens). Il token è salvato cifrato e non viene mai mostrato di nuovo. Come funziona l'import è spiegato nella [guida](docs/guida-utente.md#import-da-firefly-iii).

È l'API a contattare Firefly III: l'indirizzo deve essere raggiungibile dal server di Lifebook (in Docker, dal container `api`).

### Se qualcosa non parte

| Problema                                     | Cosa fare                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm: command not found`                    | esegui `corepack enable`, poi riprova                                                                                                                                                                                                                                                                                                                |
| errore sulla versione di Node                | serve Node 22 o superiore (`node -v`)                                                                                                                                                                                                                                                                                                                |
| porta 3000 o 5173 occupata                   | chiudi il programma che la usa: la web app raggiunge l'API solo sulla 3000                                                                                                                                                                                                                                                                           |
| errore su `better-sqlite3` all'installazione | riesegui `pnpm install`; se persiste servono gli strumenti di compilazione del sistema (su Debian/Ubuntu `build-essential` e `python3`)                                                                                                                                                                                                              |
| la pagina non carica i dati                  | controlla che `pnpm dev` sia ancora in esecuzione e senza errori nel terminale                                                                                                                                                                                                                                                                       |
| password dimenticata                         | `pnpm --filter @lifebook/finanze-api users reset-password NOME` stampa una nuova password (con `--password` la scegli tu). `users list` elenca gli utenti, `users make-admin NOME` ridà il ruolo di amministratore. In Docker: `docker compose exec api pnpm users reset-password NOME`. **Non cancellare il file `.sqlite`**: contiene tutti i dati |

Per cambiare porta, file del database o indirizzo di ascolto dell'API vedi la tabella delle variabili nella sezione «API».

## Deploy con Docker

Per tenere l'app sempre attiva su un server serve solo Docker con Compose:

```bash
docker compose up -d --build     # costruisce e avvia (si riavvia da solo dopo un reboot)
```

Poi apri **http://localhost:8080** e crea l'amministratore al primo accesso. Ci sono due container: `web` (nginx, serve la web app e inoltra `/api`) e `api` (non esposto all'esterno). I dati stanno nel volume `lifebook-data`, i backup in `lifebook-backups`.

| Variabile       | Default     | Cosa fa                                                              |
| --------------- | ----------- | -------------------------------------------------------------------- |
| `LIFEBOOK_PORT` | `8080`      | porta pubblicata                                                     |
| `LIFEBOOK_BIND` | `127.0.0.1` | indirizzo di ascolto: con `0.0.0.0` l'app è raggiungibile dalla rete |

L'app parla solo HTTP: se la esponi fuori da casa mettila dietro un reverse proxy con HTTPS.

```bash
docker compose exec api pnpm backup --dest /backups                 # backup nel volume
docker compose logs -f                                              # log
git pull && docker compose up -d --build                            # aggiornamento (i dati restano)
```

Non usare `docker compose down -v`: cancella i volumi, cioè i tuoi dati.

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

`finanze-core` è un pacchetto interno: gli altri pacchetti lo importano direttamente dai sorgenti TypeScript, quindi non serve compilarlo prima. `build` dell'API controlla solo i tipi: il server si avvia con `tsx`.

Su un solo pacchetto: `pnpm --filter @lifebook/finanze-core test`.

## Sviluppo

`pnpm dev` avvia insieme l'API (porta 3000) e la web app (http://localhost:5173, con proxy verso l'API).

## API

```
pnpm --filter @lifebook/finanze-api start      # http://127.0.0.1:3000/api/v1
```

| Variabile                  | Default                | Cosa fa                                                                       |
| -------------------------- | ---------------------- | ----------------------------------------------------------------------------- |
| `LIFEBOOK_DB`              | `data/lifebook.sqlite` | percorso del file SQLite                                                      |
| `PORT`                     | `3000`                 | porta                                                                         |
| `HOST`                     | `127.0.0.1`            | ascolta solo in locale                                                        |
| `LIFEBOOK_SECRET_KEY`      | —                      | chiave (32 byte in base64) che cifra i token di Firefly III; prevale sul file |
| `LIFEBOOK_SECRET_KEY_FILE` | `<LIFEBOOK_DB>.key`    | file della chiave, creato al primo avvio con permessi 600 se non esiste       |

Al primo avvio crea l'amministratore con `POST /api/v1/auth/setup`. Gli altri utenti li crea un amministratore con `POST /api/v1/users` (gestione in `/users`); ognuno cambia la propria password con `POST /api/v1/auth/password`. Poi `POST /api/v1/auth/login` restituisce un token di sessione (30 giorni); i token per accessi esterni si creano con `POST /api/v1/auth/tokens`. Ogni richiesta usa `Authorization: Bearer <token>`. L'integrazione con Firefly III è sotto `/api/v1/firefly/*`. La documentazione OpenAPI, generata dagli schemi zod, è su `/api/v1/openapi.json`.

Dopo aver modificato `src/db/schema.ts` genera la migrazione con `pnpm --filter @lifebook/finanze-api db:generate`: viene applicata all'avvio.

## Backup e dati di esempio

```
pnpm --filter @lifebook/finanze-api backup                 # copia consistente in backups/ (ultimi 30)
pnpm --filter @lifebook/finanze-api users reset-password NOME   # recupero password (anche ad API avviata)
bin/useradd NOME · bin/chpasswd NOME · bin/userdel NOME · bin/users   # con Docker: prima source bin/set_docker
LIFEBOOK_DB=data/demo.sqlite pnpm --filter @lifebook/finanze-api seed   # dati fittizi, solo su database vuoto
```

Guida all'uso: [docs/guida-utente.md](docs/guida-utente.md). Architettura e sviluppo: [docs/architettura.md](docs/architettura.md).

## Dati

I database SQLite, i file `.env`, i backup e i CSV sono ignorati da git. Nessun dato finanziario reale va nel repository.

## Hook pre-commit

`pnpm install` attiva `.githooks/pre-commit`, che esegue `pnpm check` prima di ogni commit. Se qualcosa è rosso il commit viene bloccato.
