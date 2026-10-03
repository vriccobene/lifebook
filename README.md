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

### Analytics dei movimenti Firefly

La sezione **Analytics** (`#/analytics`) analizza il giornale EUR importato da Firefly:
filtri combinabili per date, tipo, categoria, conto/controparte, tag, classificazione,
rendita e inclusione, con esclusioni multiple di categorie e conti/controparti;
andamento mensile, ripartizione delle spese, raggruppamenti
per categoria, mese, tag o controparte ed esportazione CSV delle transazioni filtrate.
I trasferimenti sono mostrati separatamente e non contribuiscono al saldo entrate
meno spese; i saldi iniziali non sono entrate. Le transazioni escluse restano
consultabili ma non contribuiscono ai riepiloghi.

Da **Dettagli** si possono assegnare tag, classificare una spesa come essenziale o
discrezionale e identificare una rendita. Le entrate nei conti titoli collegati
sono lorde; il netto stimato applica l’aliquota del conto alla data del movimento.
Per le altre rendite su conti collegati vale la stessa regola, con aliquota 0%
quando il dato è già tassato. Per entrate senza conto collegato il lordo resta
inseribile manualmente; i riepiloghi ne segnalano gli importi mancanti.
Le annotazioni sono personali, salvate nel database e associate all’identificativo
stabile del journal Firefly; sopravvivono alle successive importazioni. Non modificano
le transazioni in Firefly né i calcoli della pianificazione finanziaria.
Una transazione con più tag appartiene a più gruppi: quei gruppi non sono additivi.
I risultati descrivono i movimenti importati, non periodi non ancora importati.

Il riepilogo dei flussi Analytics distingue **Stipendio netto** e **Altre entrate
incassate**, oltre a entrate totali, spese e saldo. I rendimenti maturati sono
mostrati nel riepilogo dedicato, separato dagli incassi. Le categorie Firefly dedicate allo stipendio
(`Stipendio`, `Stipendi`, `Salario`, `Salari`, `Salary`, `Salaries`, `Wages`) vengono
riconosciute automaticamente. Da **Dettagli → Tipo di entrata** puoi scegliere
Stipendio, Rendita o Altra entrata: la scelta esplicita prevale sulla categoria ed
è conservata alle reimportazioni. In assenza di una scelta esplicita, le entrate
non riconosciute come stipendio confluiscono nelle rendite: non occorre annotarle
una per una. Per tenere separato un rimborso o un’altra entrata seleziona
esplicitamente «Altra entrata»; rimane comunque nel totale delle entrate.

Il box principale delle rendite mostra anche il lordo. Se manca per tutte le
transazioni è indicato come «Non disponibile»; se è noto solo in parte, il totale
è etichettato «Lordo noto (parziale)» con il numero di importi mancanti.
Per conti titoli e rendite su conti collegati il lordo è noto dall’importo Firefly
e il netto viene stimato applicando la tassazione configurata.

Analytics mostra **Rendimenti dei conti, anche senza vendere** separatamente dai
flussi incassati. Riutilizza il calcolo dei rendimenti da letture di saldo e
contributi: i trasferimenti di capitale non sono rendite. Mostra lordo, netto
stimato e imposte per conto e in totale, per i periodi di lettura chiusi
nell’intervallo; le date effettivamente misurate sono visibili nella tabella.
Questa sezione segue i filtri per date e conti; categorie, tag, tipo di movimento
e annotazioni di inclusione riguardano invece il giornale degli incassi.

Da **Tassazione** si salva un’aliquota del conto con una data di validità. Usa 0%
se il saldo/rendimento importato è già tassato: la base mostrata come lordo
coincide allora con il netto stimato, senza ricostruire il lordo fiscale originario.
La stima applica le aliquote dei conti ai guadagni positivi dei periodi; le perdite
non producono un credito fiscale. Non ricostruisce il costo fiscale dei singoli
titoli o compensazioni: è una stima del rendimento del periodo, non un preventivo
fiscale di liquidazione dell’intero patrimonio. Per maggior dettaglio si possono
creare conti distinti per ogni investimento.

Le entrate importate nei conti titoli collegati (titoli, investimenti esterni e
fondi pensione) sono trattate come **lorde**. Il netto stimato usa l’aliquota del
conto valida alla data della transazione: `lordo − imposte stimate`. La stessa
regola vale per le altre rendite su conti collegati; con aliquota 0% lordo e netto
coincidono. Riepiloghi, grafici, raggruppamenti, dettagli e CSV usano gli stessi
valori. L’importo Firefly originale resta visibile; i trasferimenti non sono
entrate tassabili. Per entrate senza conto collegato rimane disponibile il lordo
manuale: nessuna aliquota viene dedotta dal nome del conto.
