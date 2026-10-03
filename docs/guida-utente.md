# Guida all'uso

Lifebook Finanze risponde a una domanda: **posso smettere di lavorare?** Lo fa partendo solo dai saldi dei tuoi conti, letti una volta al mese, senza registrare le singole spese. Tutto gira in locale: nessun dato lascia il tuo computer.

## Avvio

```bash
pnpm install
pnpm dev            # API su :3000 e web su http://localhost:5173
```

Al primo accesso crei nome utente e password (almeno 8 caratteri): sei l'amministratore. Il database è il file `apps/finanze/api/data/lifebook.sqlite`, ignorato da git; puoi spostarlo con la variabile `LIFEBOOK_DB`.

Per esplorare l'app con dati **fittizi**, senza toccare i tuoi:

```bash
LIFEBOOK_DB=data/demo.sqlite pnpm --filter @lifebook/finanze-api seed
LIFEBOOK_DB=data/demo.sqlite pnpm dev     # utente demo, password demo-password-1234
```

Il comando rifiuta di lavorare su un database che ha già un utente.

## Utenti

Lifebook è multiutente: ogni persona ha i propri conti, saldi, entrate e impostazioni, e nessuno vede i dati degli altri, amministratore compreso. Clicca sul tuo nome in alto per aprire il **Profilo**:

- **Cambia password:** serve quella attuale. Le altre sessioni aperte (ad esempio su un altro browser) vengono chiuse; i token API restano validi.
- **Utenti** (solo per l'amministratore): crea un utente con una password iniziale, che poi potrà cambiare. Da qui cambi anche il ruolo (utente o amministratore), reimposti la password di chi l'ha dimenticata (le sue sessioni vengono chiuse) ed elimini un utente. **L'eliminazione cancella tutti i suoi dati** e non si può annullare. Deve restare sempre almeno un amministratore, e non puoi eliminare te stesso.

Non esiste la registrazione libera: un nuovo utente lo crea sempre un amministratore.

**Password dimenticata.** Un amministratore la reimposta dal Profilo. Se sei l'unico amministratore, o nessuno ricorda la propria, dal computer dove gira Lifebook:

```bash
pnpm --filter @lifebook/finanze-api users list                          # elenca gli utenti
pnpm --filter @lifebook/finanze-api users reset-password NOME           # stampa una nuova password casuale
pnpm --filter @lifebook/finanze-api users reset-password NOME --password nuova-password
pnpm --filter @lifebook/finanze-api users make-admin NOME               # ridà il ruolo di amministratore
```

Gli stessi comandi, più la creazione e l'eliminazione di utenti, sono in `bin/` come comandi shell, utilizzabili da qualsiasi cartella col loro percorso (non aggiungere `bin/` al `PATH`: i nomi coincidono con comandi di sistema). Chiedono la password senza mostrarla; con `--random` ne generano una e la stampano:

```bash
bin/users                                   # elenca gli utenti
bin/useradd [--admin] [--random] NOME
bin/chpasswd [--random] NOME                # nuova password, chiude le sessioni
bin/userdel [-y] NOME                       # elimina l'utente e TUTTI i suoi dati (chiede conferma)
```

Per avviare Lifebook c'è `bin/start`: in locale equivale a `pnpm dev`, dopo `source bin/set_docker` costruisce e avvia i container.

Il database è `apps/finanze/api/data/lifebook.sqlite`, oppure quello indicato da `LIFEBOOK_DB`. Con Docker, prima dei comandi esegui `source bin/set_docker` (e `source bin/unset_docker` per tornare al locale): i comandi girano nel container `api`, che deve essere avviato, sul database del volume. L'ultimo amministratore non si può eliminare.

Funziona anche con l'app avviata e non tocca i dati. Chi può eseguire questi comandi ha comunque accesso al file del database, quindi non indebolisce la protezione.

## Prima configurazione

1. **Conti.** Crea un conto per ogni saldo che vuoi seguire: conti correnti, depositi, titoli, investimenti esterni, immobili, mutui e altre passività.
   - Marca come **conto di spesa** quello (o quelli) da cui paghi la vita quotidiana. È la base del calcolo del costo della vita. Puoi farlo anche dopo, da **Conti → Dettagli → Conto di spesa**: la data «Dal» parte di default dall'inizio dello storico, così il costo della vita si ricalcola anche per i mesi passati.
   - Per i **titoli** i contributi (versamenti e prelievi) li inserisci tu ogni mese. Per i **depositi** vengono dedotti dal saldo, conoscendo il tasso.
   - Un **fondo pensione** ha contributi dichiarati come i titoli, ma per default resta **fuori dal capitale investibile**, perché è vincolato fino al pensionamento. Se vuoi contarlo, attiva «Nel capitale investibile» nei suoi parametri (anche da una data in poi).
- Per un **immobile** scegli se è abitazione principale (esclusa dal capitale investibile) o a reddito.
   - Per un **mutuo** indica rata mensile, data dell'ultima rata e se la rata è costo della vita.
2. **Entrate.** Inserisci lo stipendio netto, la tredicesima, i bonus. Inserisci anche affitti e dividendi che finiscono su un conto di spesa: se mancano, abbassano il costo della vita calcolato.
3. **Impostazioni.** Controlla il tasso di prelievo sicuro (3,5%), il buffer di emergenza (6 mesi), le età (necessarie per Coast FIRE e Ponte) e le soglie del semaforo.
4. **Spesa essenziale** (facoltativa). Serve al metodo «Copertura per strati». Non esiste un valore predefinito: finché non lo inserisci, quel metodo è escluso dal verdetto.

## Ogni mese: il giro

Apri **Giro mensile**. La data è precompilata con la fine del mese corrente e puoi cambiarla. Per ogni conto vedi il saldo precedente: scrivi il nuovo saldo (o premi «Invariato») e, solo per i conti a contributi dichiarati, l'eventuale versamento del mese (positivo) o prelievo (negativo). Poi «Salva giro». Le righe vuote vengono ignorate e un giro già salvato si può correggere e risalvare.

Un consiglio pratico: **leggi i conti più o meno nello stesso giorno del mese**. Un mese senza lettura viene spalmato su quello dopo, e una lettura anticipata o ritardata di qualche giorno si compensa il mese successivo.

Servono almeno due mesi di letture del conto di spesa prima che compaia un costo della vita: la prima è solo il punto di partenza.

## Trasferimenti e contributi

Nel giro mensile i contributi si inseriscono con la data del giro. La schermata **Trasferimenti** serve quando vuoi registrarli a parte, con una data qualsiasi, o correggerli:

- **Trasferimento tra due conti:** scegli «Da», «A», importo e data. Prima di salvare vedi cosa verrà registrato. Le voci si creano solo sui conti a contributi dichiarati (titoli, investimenti esterni, passività): un prelievo da chi cede e un versamento a chi riceve. Per i conti di spesa e per i depositi con movimenti dedotti non si inserisce nulla, perché il loro movimento si legge già dal saldo e una voce in più verrebbe contata due volte.
- **Versamento o prelievo su un conto:** per un singolo conto a contributi dichiarati.
- **Movimenti registrati:** l'elenco di tutti i contributi, filtrabile per conto, con modifica della data e dell'importo e cancellazione.

Le singole spese non si registrano: il costo della vita si deduce dai saldi.

### Quando la stima delle spese è attendibile

Per ogni intervallo tra due letture, il calcolo è:

```text
spese = entrate nette − variazione complessiva dei conti di spesa
        − versamenti netti verso i conti non di spesa
```

Un trasferimento tra due conti di spesa si annulla nella variazione complessiva.
Un versamento a un investimento viene sottratto dalle spese; un prelievo ha segno
negativo. Sui conti a contributi dichiarati, una perdita di mercato non aumenta le
spese, purché tutti i versamenti e prelievi siano registrati. La sola variazione del
saldo non permette di distinguere un prelievo da una perdita.

Sui conti con contributi dedotti, la variazione del saldo viene depurata
dell'interesse stimato al tasso impostato. È quindi una stima: un rendimento
effettivo diverso dal tasso previsto si riflette sulle spese. Per un investimento
con valore variabile usa i contributi dichiarati e registra i trasferimenti.

Per confrontare Excel e Firefly III, usa le stesse date di osservazione: un saldo
al **1° febbraio**, se rilevato all'inizio del giorno, corrisponde alla chiusura del
**31 gennaio**, non del 28 febbraio. Non convertire celle vuote in saldi zero.
Le letture di tutti i conti devono riferirsi allo stesso intervallo; letture
sfalsate possono far apparire un giroconto come spesa in un mese e compensarlo
soltanto in quello successivo.

Le entrate devono corrispondere agli accrediti effettivi dell'intervallo. Se lo
stipendio varia, puoi usare le entrate una tantum già disponibili. Tredicesima e
bonus devono avere la data di incasso, senza duplicare una voce ricorrente.
Un interesse o un affitto accreditato su un conto di spesa va incluso tra le
entrate. Saldi rimasti invariati e stipendio ricorrente configurato implicano
matematicamente che tutto lo stipendio sia stato speso: non provano che i
movimenti siano completi.

Controlla anche la data «valido dal» del flag **conto di spesa**: se vuoi
riclassificare tutto lo storico, scegli una data precedente alla prima lettura.
Il tipo del conto e l'inclusione nel capitale investibile sono impostazioni
distinte dal suo utilizzo come conto di spesa.

## Import da Firefly III

Se tieni i conti in [Firefly III](https://www.firefly-iii.org), la pagina **Firefly III** importa da lì i saldi e tutti i movimenti dei conti collegati. Il collegamento è personale: ogni utente usa il proprio Firefly III e il proprio token.

1. **Collega.** Inserisci l'indirizzo di Firefly III e un token di accesso personale (in Firefly III: Opzioni → Profilo → OAuth → Personal Access Tokens → Crea nuovo token). Lifebook lo verifica e lo salva cifrato; non potrai più rileggerlo, solo sostituirlo.
2. **Collega i conti.** Per ogni conto attivo o passività di Firefly III scegli il conto di Lifebook corrispondente, oppure «Crea…» per crearne uno nuovo con il tipo più probabile (conto corrente, deposito per i conti di risparmio, passività). Poi controlla il conto nella pagina **Conti**: tipo, **conto di spesa**, tassi. Solo i conti in euro si possono importare.
3. **Importa.** Scegli il periodo (di default gli ultimi 12 mesi fino alla fine del mese scorso) e premi **Anteprima** per vedere cosa cambierebbe senza salvare nulla, poi **Importa**.

Cosa viene importato:

- **Saldi:** il saldo di ogni conto collegato a ogni **fine mese** del periodo, come lo calcola Firefly III per quel giorno. Le passività diventano negative. I mesi prima che il conto esistesse in Firefly III vengono saltati, così non nascono saldi a zero finti.
- **Contributi:** i movimenti tra due tuoi conti di Firefly III (trasferimenti, rate pagate a un mutuo o a un prestito), con la stessa regola della schermata Trasferimenti: una voce solo sui conti a contributi dichiarati (titoli, investimenti esterni, fondi pensione, passività), positiva su chi riceve e negativa su chi cede. Entrate e spese (stipendio, spesa, dividendi) non sono contributi: si leggono dai saldi. Gli accrediti sono ora importati e visibili in **Entrate**, separati dalle voci manuali.
- **Trasferimenti:** ogni movimento tra due tuoi conti di Firefly III, qualunque sia il tipo del conto in Lifebook (anche dal conto corrente al deposito), con data, conto di partenza, conto di arrivo, importo e descrizione. Li trovi nella pagina **Trasferimenti**, in «Trasferimenti importati da Firefly III», filtrabili per conto. Se uno dei due conti non è collegato compare il suo nome in Firefly III. Entrano nel calcolo del costo della vita e dei rendimenti: un trasferimento non viene mai scambiato per una spesa o per un guadagno. Per depositi e immobili letti da Firefly III si usano i trasferimenti veri al posto della stima dal tasso dichiarato; il denaro spostato verso un tuo conto di Firefly III non collegato non conta come spesa. Sui conti a contributi dichiarati il trasferimento è già un contributo e non viene contato due volte. Si correggono in Firefly III e si aggiornano al prossimo import.

- **Registro completo:** accrediti, uscite, trasferimenti e aperture sono salvati con ID Firefly, data, importo, conti, descrizione e categoria. I saldi di apertura non sono redditi; i trasferimenti non sono spese, salvo rate verso passività configurate come costo della vita.

Nei mesi interamente coperti dall'import per tutti i conti di Lifebook, la spesa è calcolata dalle uscite effettive Firefly, inclusi commissioni e costi sui conti di investimento. Le entrate manuali non si sommano agli accrediti importati; restano salvate e vengono utilizzate negli altri periodi. Una copertura incompleta mantiene la stima dai saldi e viene segnalata. Un mese completo senza movimenti dà zero: non certifica che i dati alla fonte siano completi.

Gli accrediti su titoli, investimenti esterni e pensioni sono rendimenti, salvo che il conto sia marcato come conto delle entrate o di spesa. Nel dataset sintetico la categoria **Rendita Investimenti** su questi conti indica rivalutazioni: tali movimenti sono conservati, ma esclusi da redditi e spese, con un avviso per le perdite. Le altre uscite sono spese registrate; una perdita di mercato non deve essere registrata come un acquisto senza distinguerla con questa categoria. Non vengono dedotti automaticamente gli acquisti di titoli dalle descrizioni.

Il dettaglio mensile distingue **Uscite Firefly** da **Stima dai saldi**. Per i primi periodi, la formula dai saldi è soltanto diagnostica: il totale spese deriva dal registro. Gli scarti fra saldo iniziale, finale e movimenti sono segnalati separatamente. Il primo mese può essere calcolato dal registro completo anche senza un saldo precedente, ma in tal caso il saldo iniziale non è riconciliato.

Dopo l'aggiornamento dell'applicazione occorre reimportare lo storico per popolare il registro completo: le vecchie letture non costituiscono prova di importazione delle entrate e delle uscite.

Puoi importare di nuovo quando vuoi, anche lo stesso periodo: i dati importati vengono aggiornati, e i movimenti cancellati in Firefly III spariscono anche da Lifebook, senza duplicati. Quello che hai inserito a mano non viene mai sovrascritto: se un tuo saldo è diverso da quello di Firefly III resta il tuo e l'import lo segnala, e un contributo già inserito a mano con la stessa data e lo stesso importo non viene importato di nuovo.

Un saldo zero viene importato anche come prima lettura se Firefly III fornisce
una data di apertura già trascorsa. Senza data di apertura né storico precedente,
gli zeri iniziali vengono saltati perché non se ne può stabilire il significato.
Importi non validi o una paginazione oltre il limite supportato interrompono
l'import prima del salvataggio. Un movimento già importato che cambia in una
valuta non supportata viene segnalato e conserva il valore precedente: occorre
risolvere l'avviso prima di considerare aggiornato il calcolo.

## Leggere il cruscotto

- **Verdetto.** Verde se almeno 3 metodi (impostabile) sono verdi, giallo se ne manca uno, rosso altrimenti. Sotto il verdetto trovi i metodi che lo determinano e quelli esclusi perché mancano dati.
- **Metodi.** Ogni riga ha esito (verde da 100% di copertura, giallo da 80%), copertura e distanza dall'obiettivo in euro (e in anni, per il Numero FI). Tutto è in euro di oggi.
- **Senza pensione pubblica.** La pensione è disattivata di default e nessun metodo la considera. Si attiva in Impostazioni con età di inizio e importo netto mensile, e vale per tutti i metodi.
- **Avvisi sui dati.** Spesa negativa, spesa molto diversa dalla media, conto di spesa senza lettura, conto a contributi dichiarati che varia molto senza contributi, conto fermo da troppo tempo. Il dettaglio mese per mese è in «Come è calcolato il costo della vita».
- **Storico.** Il selettore in alto (3 mesi, 1 anno, tutto, personalizzato) vale per tutti i grafici. Ogni punto è ricalcolato con i dati e i parametri validi a quella data.

## Cambiare un dato del passato

Tutto è datato. Puoi inserire saldi o contributi retroattivi, modificarli o cancellarli: lo storico si ricalcola. Anche le impostazioni e i parametri di un conto (tassazione, tasso, conto di spesa…) hanno una data «valido dal»: una modifica non riscrive il passato, che continua a usare i valori che valevano allora. Per correggere un errore, in **Conti → Dettagli** puoi anche modificare una voce già salvata dello storico dei parametri («Modifica»), e cambiare in ogni momento nome, istituto, tipo, uso dell'immobile, modalità dei contributi e «la rata è costo della vita»: queste proprietà non sono datate, quindi la modifica vale per tutto lo storico del conto.

## Backup e ripristino

```bash
pnpm --filter @lifebook/finanze-api backup                      # backups/lifebook-AAAAMMGG-HHMMSS.sqlite
pnpm --filter @lifebook/finanze-api backup --dest ~/backup --keep 60
```

La copia è consistente anche con l'API in funzione e tiene gli ultimi 30 file (`--keep 0` per tenerli tutti). I backup contengono dati finanziari reali: conservali in un posto sicuro e non metterli in git (la cartella `backups/` è già ignorata).

Per ripristinare: ferma l'API, copia il file di backup sopra il database (`data/lifebook.sqlite`) e riavvia.

Il backup contiene i dati di tutti gli utenti, ma non la chiave che cifra i token di Firefly III (`data/lifebook.sqlite.key`). Se la chiave va persa basta reinserire il token nella pagina Firefly III.

## Cosa non c'è ancora

- L'import dei CSV delle banche (UniCredit, Crédit Agricole, Mediolanum, BBVA): per ora i saldi si inseriscono a mano o si importano da Firefly III.
- Simulazioni probabilistiche (Monte Carlo, backtest, stress test) e quotazioni automatiche.

Le formule e le decisioni di prodotto sono in [lifebook-spec.md](lifebook-spec.md).
