# Guida all'uso

Lifebook risponde a una domanda: **posso smettere di lavorare?** Lo fa partendo solo dai saldi dei tuoi conti, letti una volta al mese, senza registrare le singole spese. Tutto gira in locale: nessun dato lascia il tuo computer.

## Avvio

```bash
pnpm install
pnpm dev            # API su :3000 e web su http://localhost:5173
```

Al primo accesso crei nome utente e password (almeno 8 caratteri). Il database è il file `apps/lifebook-api/data/lifebook.sqlite`, ignorato da git; puoi spostarlo con la variabile `LIFEBOOK_DB`.

Per esplorare l'app con dati **fittizi**, senza toccare i tuoi:

```bash
LIFEBOOK_DB=data/demo.sqlite pnpm --filter @lifebook/api seed
LIFEBOOK_DB=data/demo.sqlite pnpm dev     # utente demo, password demo-password-1234
```

Il comando rifiuta di lavorare su un database che ha già un utente.

## Prima configurazione

1. **Conti.** Crea un conto per ogni saldo che vuoi seguire: conti correnti, depositi, titoli, investimenti esterni, immobili, mutui e altre passività.
   - Marca come **conto di spesa** quello (o quelli) da cui paghi la vita quotidiana. È la base del calcolo del costo della vita.
   - Per i **titoli** i contributi (versamenti e prelievi) li inserisci tu ogni mese. Per i **depositi** vengono dedotti dal saldo, conoscendo il tasso.
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

## Leggere il cruscotto

- **Verdetto.** Verde se almeno 3 metodi (impostabile) sono verdi, giallo se ne manca uno, rosso altrimenti. Sotto il verdetto trovi i metodi che lo determinano e quelli esclusi perché mancano dati.
- **Metodi.** Ogni riga ha esito (verde da 100% di copertura, giallo da 80%), copertura e distanza dall'obiettivo in euro (e in anni, per il Numero FI). Tutto è in euro di oggi.
- **Senza pensione pubblica.** La pensione è disattivata di default e nessun metodo la considera. Si attiva in Impostazioni con età di inizio e importo netto mensile, e vale per tutti i metodi.
- **Avvisi sui dati.** Spesa negativa, spesa molto diversa dalla media, conto di spesa senza lettura, conto a contributi dichiarati che varia molto senza contributi, conto fermo da troppo tempo. Il dettaglio mese per mese è in «Come è calcolato il costo della vita».
- **Storico.** Il selettore in alto (3 mesi, 1 anno, tutto, personalizzato) vale per tutti i grafici. Ogni punto è ricalcolato con i dati e i parametri validi a quella data.

## Cambiare un dato del passato

Tutto è datato. Puoi inserire saldi o contributi retroattivi, modificarli o cancellarli: lo storico si ricalcola. Anche le impostazioni e i parametri di un conto (tassazione, tasso, conto di spesa…) hanno una data «valido dal»: una modifica non riscrive il passato, che continua a usare i valori che valevano allora.

## Backup e ripristino

```bash
pnpm --filter @lifebook/api backup                      # backups/lifebook-AAAAMMGG-HHMMSS.sqlite
pnpm --filter @lifebook/api backup --dest ~/backup --keep 60
```

La copia è consistente anche con l'API in funzione e tiene gli ultimi 30 file (`--keep 0` per tenerli tutti). I backup contengono dati finanziari reali: conservali in un posto sicuro e non metterli in git (la cartella `backups/` è già ignorata).

Per ripristinare: ferma l'API, copia il file di backup sopra il database (`data/lifebook.sqlite`) e riavvia.

## Cosa non c'è ancora

- L'import dei CSV delle banche (UniCredit, Crédit Agricole, Mediolanum, BBVA): per ora i saldi si inseriscono a mano.
- Simulazioni probabilistiche (Monte Carlo, backtest, stress test), quotazioni automatiche e più utenti.

Le formule e le decisioni di prodotto sono in [lifebook-spec.md](lifebook-spec.md).
