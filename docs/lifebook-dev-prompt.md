# Prompt per l'agente di sviluppo

Copia il testo qui sotto e passalo a un altro agente.

---

Sei l'agente di sviluppo di **Lifebook**, una webapp personale per monitorare patrimonio e investimenti e capire quando si può smettere di lavorare. Lavori nella cartella `/home/vince/projects/lifebook`, un monorepo che ospiterà più webapp e backend.

**Prima di scrivere codice, leggi per intero `docs/lifebook-spec.md`.** È la fonte di verità: modello dati, formule e decisioni di prodotto sono lì. Non reinterpretare le formule. Se trovi un'ambiguità o un'incoerenza, fermati e chiedimelo, non decidere in silenzio.

## Stack e struttura

- pnpm workspaces, TypeScript ovunque, Node LTS.
- `apps/finanze/core`: motore di calcolo in TS puro, senza I/O, funzioni pure e deterministiche.
- `apps/finanze/api`: Fastify, SQLite con Drizzle e better-sqlite3, validazione con zod, OpenAPI generata dagli schemi zod. Login locale per la UI e token API per accessi esterni.
- `apps/finanze/web`: React con Vite, TanStack Query e Recharts. Interfaccia in italiano.
- Test con Vitest.
- Ogni pacchetto ha `package.json`, `tsconfig` e script `build`, `test`, `lint` propri. Alla radice ci sono `pnpm-workspace.yaml`, un `tsconfig.base.json`, ESLint e Prettier condivisi, e un `.gitignore` che esclude database SQLite, `.env` e dati reali.
- Struttura la radice in modo che altre app possano essere aggiunte in `apps/` senza modifiche.

## Punti che richiedono attenzione particolare

1. **Costo della vita.** Si hanno solo saldi periodici, non i movimenti. L'utente marca alcuni conti come conti di spesa (`isSpendingAccount`). La spesa del periodo è: entrate nette meno la variazione dei saldi dei conti di spesa meno i trasferimenti netti verso i conti non di spesa. Questo evita di confondere un rendimento negativo con una spesa. Implementa esattamente la sezione 5 della specifica, compresa la gestione dei conti `declared` e `inferred`, delle passività e dei mesi mancanti.
2. **Pensione pubblica.** È disabilitata di default e un toggle globale la esclude da **tutti** i metodi. Scrivi test che verifichino i risultati con il toggle acceso e spento, in particolare per i metodi "copertura per strati" e "ponte fino alla pensione".
3. **Spesa essenziale.** È un dato inserito dall'utente in tre modalità: percentuale, importo fisso da una data, importo per un singolo mese, con le regole di precedenza della sezione 4 (`EssentialSpending`). Non usare valori di default: se manca, il metodo "copertura per strati" restituisce `dati mancanti` ed è escluso dal verdetto. Prevedi la schermata di inserimento e l'endpoint `essential-spending`.
4. **Tutto è datato.** Ogni inserimento ha una data scelta dall'utente, con inserimento retroattivo, modifica e cancellazione. Anche impostazioni e parametri dei conti hanno `validFrom` e ogni calcolo usa il valore in vigore in quel periodo. Il core deve offrire il calcolo **as-of** per qualunque data passata, e l'API le serie storiche, così il cruscotto può mostrare lo storico (elenco dei grafici nella sezione 9). Progetta questo fin dalla fase 2: aggiungerlo dopo costerebbe una riscrittura.
5. **Termini reali.** Tutte le proiezioni sono in euro di oggi, con inflazione configurabile.
6. **Cruscotto comparativo.** Ogni metodo restituisce esito, copertura percentuale e distanza. Il verdetto sintetico deve elencare i metodi che lo determinano.
7. **Predisposizione futura.** Non implementare Monte Carlo, backtest o stress test, ma progetta l'interfaccia dei metodi in modo che se ne possano aggiungere senza modificare quelli esistenti (ad esempio un registro di metodi con un'interfaccia comune).

## Piano di lavoro

Procedi per fasi. Al termine di ogni fase esegui test, lint e typecheck, poi fai un commit con un messaggio chiaro. Non passare alla fase successiva se qualcosa è rosso.

1. **Scaffolding**: monorepo, pacchetti vuoti che compilano, CI locale (`pnpm -r test`), README con i comandi.
2. **`finanze-core`**: tipi del dominio, calcolo del costo della vita, rendimenti lordi e netti (Modified Dietz), capitale investibile, tutti i metodi della sezione 7, verdetto. Test unitari estesi con dati sintetici e casi limite.
3. **`finanze-api`**: schema del database e migrazioni, CRUD di conti, snapshot, contributi, entrate e impostazioni. Endpoint `results/*` che invocano il core. Autenticazione. Test di integrazione su SQLite in memoria.
4. **Import CSV**: parser con mapping configurabile per conto (colonne, separatore, formato di data e numeri, encoding). **Non inventare i formati di UniCredit, Crédit Agricole, Mediolanum e BBVA.** Chiedimi file di esempio (anche anonimizzati) prima di scrivere i preset e costruisci intanto solo il parser generico.
5. **`finanze-web`**: cruscotto, giro mensile, conti, rendimenti, entrate, impostazioni, come nella sezione 9. Il giro mensile deve essere veloce da compilare: un'unica schermata con il saldo precedente, il campo del nuovo saldo, i contributi solo per i conti `declared` e l'import CSV dove disponibile.
6. **Rifinitura**: validazioni e avvisi del costo della vita (sezione 5), seed di dati di esempio fittizi, script di backup del database, documentazione in `docs/`.

## Regole di lavoro

- Nessun dato finanziario reale nel repository, nei test o nei log.
- Non aggiungere funzionalità fuori dalla specifica. Le proposte vanno elencate a parte alla fine di ogni fase.
- Il codice del core non importa nulla dall'API, dalla web app o da librerie di I/O.
- Commenti solo dove il perché non è ovvio. Nomi in inglese nel codice, testi della UI in italiano.
- A fine di ogni fase riassumi cosa è stato fatto, cosa è stato testato e quali decisioni hai dovuto prendere. Segnala esplicitamente ogni deviazione dalla specifica.

Inizia dalla fase 1.
