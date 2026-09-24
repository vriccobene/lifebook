# Lifebook: specifiche

Webapp personale, single-user e self-hosted, per monitorare patrimonio e investimenti e capire quando si può smettere di lavorare. Deve richiedere il minimo sforzo: una sessione di aggiornamento al mese, senza categorizzare le spese.

Questo documento riassume le decisioni prese in fase di discovery. Dove è scritto "configurabile" il valore è un'impostazione modificabile dall'utente, non una costante nel codice.

## 1. Obiettivi

1. Tenere traccia dei saldi di tutti i conti: correnti, titoli, depositi, investimenti esterni, immobili, passività.
2. Calcolare il rendimento (lordo e netto) di ogni conto.
3. Dedurre automaticamente il costo della vita dai saldi, senza registrare le singole spese.
4. Verificare se il costo della vita è coperto dal capitale, con più metodi a confronto.

## 2. Non obiettivi dell'MVP

- Categorizzazione delle spese o import di movimenti.
- Open banking (PSD2) e quotazioni di mercato automatiche.
- Multivaluta: tutto in EUR.
- Multiutente: solo un utente, ma con un campo `ownerId` già previsto nel modello.
- Simulazioni probabilistiche (Monte Carlo, backtest storico, stress test sulla sequenza dei rendimenti). Il modello dati e il motore devono restare predisposti per aggiungerle dopo.
- Consulenza fiscale: le aliquote sono una stima configurabile.

## 3. Architettura

Monorepo con pnpm workspaces e TypeScript ovunque.

```
/
├── apps/
│   ├── lifebook-web/      # frontend React (Vite)
│   └── lifebook-api/      # backend REST (Fastify)
├── packages/
│   └── lifebook-core/     # motore di calcolo in TS puro, senza I/O
└── docs/
```

Altre webapp e altri backend futuri diventano nuove cartelle in `apps/`.

- **`lifebook-core`**: funzioni pure e deterministiche. Riceve dati e configurazione, restituisce risultati. Nessun accesso a DB, rete o file. Contiene tutta la logica descritta in questo documento ed è coperto da test unitari.
- **`lifebook-api`**: REST con Fastify e SQLite (file locale) tramite Drizzle e better-sqlite3. Validazione con zod. Login locale per la UI e token API per accessi esterni. Espone i dati e i risultati del motore. La REST API è un requisito di prima classe: la web app la usa come unico canale verso i dati.
- **`lifebook-web`**: React con Vite, TanStack Query e Recharts. In italiano.
- Tutto gira in locale. Nessun dato finanziario esce dalla macchina.

## 4. Modello dati

### Principio: ogni dato ha una data

Ogni inserimento, di qualunque tipo, ha una **data scelta dall'utente**, non la data di inserimento. Deve essere possibile inserire dati retroattivi, modificarli e cancellarli, così il sistema costruisce lo storico e i grafici. Vale per:

- saldi (`BalanceSnapshot.date`), contributi, entrate, spesa essenziale;
- **parametri che cambiano nel tempo**. Le impostazioni globali (SWR, inflazione, pensione, soglie, ecc.) e i parametri dei conti (`taxRate`, `interestRate`, `expectedReturn`, `passiveYield`, `monthlyPayment`, `isSpendingAccount`, `inInvestableCapital`) sono valori con `validFrom`. Ogni calcolo su un periodo usa il valore in vigore in quel periodo, non quello attuale.

Il motore deve supportare il calcolo **as-of**: ogni risultato (costo della vita, rendimenti, metodi, verdetto) può essere ricalcolato per qualunque data passata usando solo i dati e i parametri validi a quella data. Questo produce le serie storiche del cruscotto senza dati duplicati. Le modifiche retroattive invalidano e rigenerano le serie.

Le UI di inserimento hanno sempre un campo data, precompilato con la data di riferimento più sensata (fine del mese corrente o del mese che si sta aggiornando).

### EssentialSpending (spesa essenziale)

Il sistema non può dedurre dai saldi quanto del costo della vita sia essenziale e quanto discrezionale, quindi è un dato che inserisce l'utente, da statistiche che ha già.

| Campo | Note |
|---|---|
| `mode` | `percent` (quota del costo della vita), `amount` (importo mensile fisso da una data in poi) oppure `month_amount` (importo di un mese specifico) |
| `value` | la percentuale (0-100) oppure l'importo in euro |
| `validFrom` | per `percent` e `amount`: data da cui il valore è in vigore |
| `month` | per `month_amount`: il mese di riferimento (`YYYY-MM`) |

- L'utente può inserire più valori nel tempo, anche retroattivi. Sono possibili tutte e tre le modalità insieme, ad esempio un importo fisso di base con qualche mese corretto a mano.
- **Precedenza** per un dato mese: prima `month_amount` di quel mese, altrimenti l'ultimo `amount` o `percent` con `validFrom` non successivo al mese.
- Con `percent` la spesa essenziale segue il costo della vita dedotto del mese. Con `amount` e `month_amount` è un importo in euro e la parte discrezionale è il resto.
- Se l'importo supera il costo della vita del mese, la parte discrezionale è zero e la UI mostra un avviso.
- Per i metodi che usano un unico valore corrente (copertura per strati) conta il valore del mese più recente. Se non esiste alcun dato per quel mese, il metodo restituisce `dati mancanti` (né verde né rosso) ed è escluso dal verdetto. Non esiste un valore di default.

### Account (conto)

| Campo | Note |
|---|---|
| `id`, `ownerId`, `name`, `institution` | `ownerId` sempre lo stesso utente nell'MVP |
| `type` | `checking`, `deposit`, `brokerage`, `external_investment`, `real_estate`, `liability` |
| `isSpendingAccount` | **il conto da cui l'utente spende** (vedi sezione 5) |
| `inInvestableCapital` | se il conto conta nel capitale investibile |
| `realEstateUse` | solo per `real_estate`: `primary_residence` (esclusa dal capitale investibile) oppure `income` (inclusa, con affitto netto) |
| `expectedReturn` | rendimento annuo atteso reale, per le proiezioni |
| `passiveYield` | quota di rendimento incassata in modo passivo (interessi, dividendi, affitto netto), annua |
| `taxRate` | regime fiscale del conto (es. 26%, 12,5% titoli di stato, cedolare secca 21%) |
| `contributionsMode` | `declared` oppure `inferred` (vedi sezione 5) |
| `interestRate` | tasso dichiarato, per depositi e passività |
| `monthlyPayment`, `countsAsLivingCost` | solo per `liability`: rata mensile e se la rata rientra nel costo della vita (default sì) |
| `archivedAt` | soft delete |

### BalanceSnapshot

`accountId`, `date`, `balance` (le passività sono negative), `source` (`csv`, `manual`). Un giro mensile produce uno snapshot per ogni conto alla stessa data di riferimento.

### Contribution

`accountId`, `date`, `amount`: versamento (positivo) o prelievo (negativo) verso un conto non di spesa. Per le passività rappresenta il capitale rimborsato.

### IncomeItem

`name`, `amount` netto, `kind` (`recurring` con periodicità e date di inizio e fine, oppure `one_off` con data). Copre stipendio, tredicesima, bonus e altre entrate. Nessun calcolo del netto dal lordo.

### Settings

| Impostazione | Default | Note |
|---|---|---|
| `inflationRate` | 2% | tutte le proiezioni sono in termini reali (euro di oggi) |
| `safeWithdrawalRate` | 3,5% | |
| `emergencyBufferMonths` | 6 | mesi di costo vita esclusi dal capitale investibile |
| `essentialSpending` | non impostato | spesa essenziale inserita dall'utente, vedi sotto |
| `leanFactor`, `fatFactor` | 0,8 e 1,3 | per Lean e Fat FIRE |
| `targetRetirementAge`, `currentAge`, `endOfPlanAge` | -, -, 90 | |
| `publicPension.enabled` | **false** | vedi sezione 7 |
| `publicPension.startAge`, `publicPension.netMonthlyAmount` | 67, 0 | inseriti a mano |
| `trafficLight.greenAt`, `trafficLight.yellowAt` | 100%, 80% | soglie del semaforo |
| `verdict.minGreenMethods` | 3 | metodi verdi necessari per il verdetto sintetico |

## 5. Calcolo del costo della vita

Vincolo di partenza: si hanno solo saldi periodici, non i movimenti. Da soli non permettono di distinguere una spesa da un rendimento negativo o da un trasferimento verso un altro conto.

**Soluzione**: l'utente indica quali conti sono **conti di spesa** (`isSpendingAccount`), cioè quelli da cui paga la vita quotidiana. Tutto ciò che esce da questi conti e non finisce in un altro conto tracciato è una spesa. I rendimenti, positivi o negativi, avvengono solo sui conti non di spesa e quindi non contaminano il costo della vita.

Per ogni periodo tra due giri consecutivi di saldi (di norma un mese):

```
spesa del periodo =
    entrate nette del periodo
  − Δ saldo dei conti di spesa
  − trasferimenti netti verso i conti non di spesa
```

I **trasferimenti netti verso i conti non di spesa** sono, per ogni conto non di spesa:

- `contributionsMode = declared`: la somma dei `Contribution` inseriti nel periodo. Vale per titoli e investimenti esterni.
- `contributionsMode = inferred`: `Δ saldo − interessi maturati al tasso dichiarato`. Vale per depositi e altri conti con rendimento prevedibile. L'utente non inserisce nulla.
- Immobili: nessun trasferimento. Le variazioni di valore sono rivalutazioni e non incidono sul costo della vita.
- Passività: il capitale rimborsato è un trasferimento (declared). Se `countsAsLivingCost` è attivo, la rata intera è considerata costo della vita, quindi il capitale rimborsato viene sommato alla spesa. Se è disattivato, la rata è esclusa dal costo della vita.

Il costo della vita finale è la **media mobile a 3, 6 e 12 mesi** della spesa del periodo, normalizzata a un mese. L'utente sceglie quale finestra usare come riferimento (default 12). Se manca un giro, il periodo si allunga e la spesa viene normalizzata sui giorni effettivi.

Validazioni da mostrare all'utente: spesa del periodo negativa, spesa molto diversa dalla media, conto di spesa senza snapshot nel periodo, contributi dichiarati mancanti per un conto `declared` il cui saldo è variato molto.

Il sistema mostra anche il **costo della vita a regime**, cioè senza le rate di passività che terminano prima dell'età target, come indicazione ulteriore.

## 6. Rendimento dei conti

Per periodo e su base annualizzata, per ogni conto non di spesa:

- `declared`: `rendimento = Δ saldo − contributi netti`.
- `inferred` (depositi): interessi al `interestRate` dichiarato.
- Immobili a reddito: affitto netto (`passiveYield`) più rivalutazione dal `Δ saldo`.

Ogni rendimento è mostrato **lordo e netto** applicando `taxRate` del conto. Il rendimento percentuale usa il metodo Modified Dietz per pesare i versamenti nel periodo.

Il sistema riporta anche il rendimento passivo (interessi, dividendi, affitti), che alimenta i metodi della sezione 7.

## 7. Metodi "posso smettere di lavorare?"

Tutti in termini reali. Il **capitale investibile** è la somma dei saldi dei conti con `inInvestableCapital`, esclusa l'abitazione principale e al netto del buffer di emergenza (`emergencyBufferMonths × costo mensile`). Le passività non di spesa riducono il capitale solo se sono su immobili a reddito.

Ogni metodo produce: `esito` (verde, giallo, rosso secondo le soglie), `copertura %` (quanto dell'obiettivo è raggiunto) e `distanza` in euro e, quando ha senso, in anni.

### Famiglia A: capitale

1. **SWR**: `capitale × swr ≥ costo annuo`. Copertura = `capitale × swr / costo annuo`.
2. **Fi-Number**: `costo annuo / swr` è il capitale obiettivo. Mostra distanza in euro e anni stimati, usando il tasso di risparmio attuale e `expectedReturn` reale.

### Famiglia B: flussi

3. **Solo rendite passive**: `rendite passive nette annue ≥ costo annuo`, senza toccare il capitale.
4. **Ibrido rendite più prelievo**: il prelievo necessario è `costo annuo − rendite passive nette`. Il metodo è verde se `prelievo necessario / capitale ≤ swr`.
5. **Copertura per strati**: la spesa essenziale (da `EssentialSpending`, in percentuale o in importo) deve essere coperta da flussi sicuri: interessi dei depositi, affitti netti e, se abilitata, pensione pubblica. La quota discrezionale può essere coperta da `capitale rischioso × swr`. Il metodo è verde se entrambi gli strati sono coperti. Senza `EssentialSpending` il metodo è `dati mancanti`.

### Famiglia D: scenari

6. **Coast FIRE**: il capitale attuale, senza altri versamenti, cresce al `expectedReturn` reale fino a `targetRetirementAge`. È verde se il valore finale ≥ Fi-Number a quell'età.
7. **Barista FIRE**: `reddito da lavoro residuo necessario = costo annuo − rendite passive nette − capitale × swr`, minimo zero.
8. **Lean / Regular / Fat FIRE**: SWR e Fi-Number ricalcolati con costo × `leanFactor`, ×1 e × `fatFactor`.
9. **Ponte fino alla pensione**: capitale necessario per coprire il costo dall'età di uscita fino a `publicPension.startAge`, poi pensione più prelievo ridotto. Se la pensione è disabilitata, l'orizzonte diventa `endOfPlanAge` e il capitale deve coprire tutto il periodo.

### Famiglia E: metriche di monitoraggio

10. **Tasso di risparmio**: `(entrate nette − costo della vita) / entrate nette`.
11. **Anni di autonomia**: `capitale investibile / costo annuo`.
12. **Runway senza rendimenti**: `liquidità / costo mensile`, in mesi.

### Pensione pubblica

L'utente non conta di riceverla, quindi è **disabilitata di default** con un toggle globale `publicPension.enabled`. Quando è disabilitata:

- **nessun** metodo la considera (strati, ponte, ibrido, proiezioni);
- il ponte diventa un piano fino a `endOfPlanAge`;
- la UI mostra un'indicazione visibile "senza pensione pubblica".

Quando è abilitata, età di inizio e importo netto mensile sono inseriti a mano, ad esempio dalla simulazione INPS "La mia pensione futura". Una stima automatica sarebbe meno affidabile perché richiede l'estratto contributivo. Il toggle vale per tutti i metodi allo stesso modo.

### Cruscotto e verdetto

Una riga per metodo con semaforo, copertura e distanza. In cima un verdetto sintetico: verde se almeno `verdict.minGreenMethods` metodi sono verdi, giallo se ne manca uno, rosso altrimenti. Il verdetto deve sempre elencare quali metodi lo determinano.

## 8. Import e inserimento dati

Il giro mensile ha due strade.

- **CSV** per i conti delle banche che le permettono. Ogni conto ha un mapping configurabile: colonna della data, colonna del saldo, separatore, formato di data e numeri, encoding. L'import estrae lo snapshot di fine periodo. Istituti usati: **UniCredit, Crédit Agricole, Mediolanum, BBVA**. I formati esatti vanno verificati su file di esempio reali. L'implementazione deve partire da un mapping generico e poi fornire preset per i quattro istituti dopo aver visto i file.
- **Inserimento manuale** del saldo globale per gli altri conti (titoli, immobili, investimenti esterni, ecc.), con eventuali contributi.

La UI mensile mostra tutti i conti in un'unica schermata con il saldo precedente, il campo del nuovo saldo, il campo contributi solo per i conti `declared`, e un pulsante di import CSV per quelli che lo hanno.

## 9. Schermate MVP

1. **Cruscotto**: verdetto, elenco dei metodi con semaforo, costo della vita, patrimonio netto, tasso di risparmio, e i grafici storici:
   - patrimonio netto totale nel tempo, con la composizione per tipo di conto;
   - saldo di ogni conto;
   - costo della vita mensile con le medie mobili a 3, 6 e 12 mesi;
   - spesa essenziale contro discrezionale;
   - entrate contro costo della vita;
   - rendimento lordo e netto per conto e in totale;
   - tasso di risparmio;
   - copertura di ogni metodo nel tempo (calcolo as-of), con l'evoluzione del semaforo e del verdetto.

   Un selettore di intervallo temporale (3 mesi, 1 anno, tutto, personalizzato) vale per tutti i grafici.
2. **Giro mensile**: aggiornamento dei saldi come sopra.
3. **Conti**: anagrafica e impostazioni di ogni conto.
4. **Rendimenti**: per conto, lordo e netto, con storico.
5. **Entrate**: stipendio e altre voci.
6. **Spesa essenziale**: inserimento e storico dei valori di `EssentialSpending`, in percentuale, importo fisso da una data o importo mese per mese, con il confronto visibile rispetto al costo della vita dedotto.
7. **Impostazioni**: tutti i parametri della sezione 4, incluso il toggle della pensione.

## 10. REST API

Prefisso `/api/v1`, token nell'header `Authorization: Bearer`. Risorse: `accounts`, `snapshots`, `contributions`, `income-items`, `settings`, `essential-spending`, `imports/csv`, `results/living-cost`, `results/returns`, `results/methods`, `results/verdict`. Le risorse `results/*` invocano `lifebook-core` e accettano il parametro `asOf` (singola data) oppure `from`, `to` e `step` per le serie storiche. Ogni risorsa scrivibile accetta e restituisce la data del dato. Documentazione OpenAPI generata dagli schemi zod.

## 11. Qualità

- Test unitari del motore con dati sintetici e casi limite: mese mancante, spesa negativa, conto archiviato, conto di spesa multiplo, pensione abilitata e disabilitata, dati retroattivi, parametri cambiati nel tempo, calcolo as-of.
- Test di integrazione dell'API su SQLite in memoria.
- Nessun dato reale nel repository. Seed di esempio e file `.env` fuori da git.
- Il database SQLite è un file locale ignorato da git, con backup semplice da script.

## 12. Fasi successive

Simulazioni (Monte Carlo, backtest storico, stress test), quotazioni automatiche, multiutente, open banking.

## 13. Decisioni di chiarimento

Prese in fase di revisione della specifica. Dove contraddicono le sezioni precedenti prevalgono queste.

### Passività e patrimonio netto

- Le passività sono sempre passività, qualunque sia l'immobile a cui si riferiscono. Riducono sempre il **patrimonio netto** (attivi meno passività: casa 200k con mutuo 100k = 100k). Questo sostituisce la frase della sezione 7 secondo cui riducono il capitale solo se su immobili a reddito. Non esiste un collegamento tra passività e immobile.
- Ogni conto ha un toggle `inInvestableCapital`, passività comprese. Per le passività il default è `false`.
- Simulazioni di estinzione anticipata del mutuo o di vendita prima dell'estinzione sono fuori dall'MVP.

### Periodi e date di calcolo

- La data di calcolo è la data dell'ultimo snapshot presente. Un conto la cui ultima lettura è più vecchia mantiene il saldo di quella lettura (riporto), con un avviso che indica da quanti giorni è fermo.
- Nel calcolo as-of vale lo stesso principio, con la data richiesta.
- Un parametro con `validFrom` vale per un periodo se `validFrom` è non successivo alla data di fine periodo.
- Contributi ed entrate contano nel periodo se la loro data è in `(giro precedente, giro corrente]`.

### Formule

- Interessi dei conti `inferred`: al netto di `taxRate`, perché il saldo cresce del netto accreditato.
- Media mobile: spesa totale della finestra divisa per il numero di mesi coperti (vedi «Periodi sempre mensili»).
- Rendimento annualizzato: `(1+r)^(365/giorni) − 1`. Il netto applica `taxRate` solo alla parte positiva.
- Entrate ricorrenti: periodicità mensile, trimestrale o annuale, con un importo per ogni scadenza che cade nel periodo.
- Rendite passive nette: `saldo × passiveYield × (1 − taxRate)` per conto, più gli interessi dei depositi, senza deflazione.
- Percentuale di spesa essenziale nei metodi a valore unico: applicata al costo della vita della finestra di riferimento.
- Copertura per strati: flussi sicuri = interessi dei depositi, affitti netti, pensione se abilitata. Capitale rischioso = brokerage e investimenti esterni.
- Ibrido: copertura = `capitale × swr / prelievo necessario`, con tetto a 100% se il prelievo è zero.
- Rendimento di portafoglio per Fi-Number in anni, Coast e Ponte: media dei `expectedReturn` pesata sui saldi dei conti investibili. Il ponte è scontato a questo rendimento reale.
- Senza `currentAge` o `targetRetirementAge`, Coast e Ponte restituiscono `dati mancanti`.
- Liquidità del runway: saldi dei conti `checking` e `deposit` non archiviati.

### Verdetto

Contano i metodi 1-9, con Lean/Regular/Fat come un solo metodo (verde se Regular è verde). I metodi di famiglia E sono solo informativi, senza semaforo. Un metodo `dati mancanti` è escluso dal conteggio.

### Tecnica

- Il DB salva il denaro in centesimi interi. Il core usa numeri in euro e la conversione avviene al confine dell'API. Le date sono stringhe `YYYY-MM-DD`, senza fuso orario.
- Autenticazione: utente e password creati al primo avvio, token API generati dalla UI e salvati come hash.

### Decisioni prese durante la fase 2 (`lifebook-core`)

Punti che la specifica non fissava; sono implementati e coperti da test.

- **Impostazioni aggiunte** (sezione 4 non le elencava): `livingCostWindow` (3, 6 o 12, default 12), `spendingDeviationThreshold` (0,5), `declaredBalanceChangeThreshold` (0,1), `staleAccountDays` (45). `inflationRate` esiste e il core espone `toRealRate`, ma nessun metodo la usa: `expectedReturn` è già reale e i flussi sono già in euro di oggi.
- **Campo aggiunto ai conti**: `paymentEndDate` (passività, con validFrom), necessario per il costo della vita a regime (rate che terminano entro l'età target). Senza data la rata non termina mai.
- **Periodi sempre mensili**: un periodo è un mese di calendario. Ogni mese in cui un conto di spesa ha una lettura dà un confine, datato all'ultima lettura di quel mese. Leggere il 29 o il 31 non cambia nulla e non nascono mai periodi più corti: la differenza si recupera il mese dopo. Entrate e contributi si contano tra le due date di taglio, così uno stipendio non va perso né contato due volte. Se un mese non ha letture, il periodo successivo copre più mesi e la spesa si divide per il numero di mesi (non per i giorni). Questo modifica la frase della sezione 5 «normalizzata sui giorni effettivi». Un conto senza saldo di apertura (prima lettura) non produce variazione in quel periodo e genera un avviso.
- **Conti archiviati**: dalla data `archivedAt` non contano più (saldi, trasferimenti, rendimenti).
- **Conti `inferred` non letti in un periodo**: trasferimento 0 e la variazione cade nel periodo in cui viene letta, con gli interessi calcolati sui giorni tra le due letture. Il tasso usato è quello in vigore a fine periodo, capitalizzato annualmente effettivo.
- **Passività con `countsAsLivingCost` disattivato**: si esclude dal costo della vita `max(capitale rimborsato, rata × numero di rate)`, così restano fuori anche gli interessi. Con il flag attivo la rata intera resta nella spesa. Il numero di rate è il numero di mesi del periodo.
- **Rendimenti**: un record per coppia di letture consecutive dello stesso conto. Per gli immobili a reddito `taxRate` si applica solo all'affitto, non alla rivalutazione. La tassa sui titoli si applica solo ai guadagni positivi.
- **Pensione pubblica**: se abilitata la considerano solo copertura per strati (flussi sicuri), ibrido e ponte. SWR, Fi-Number, Solo rendite, Coast e Barista non la usano mai. Con il toggle spento nessun metodo la usa, qualunque siano importo ed età inseriti.
- **Copertura per strati**: il valore della spesa essenziale è quello del mese corrente, cioè il mese della data di calcolo. La pensione abilitata conta tra i flussi sicuri senza tener conto dell'età di inizio (il ponte invece la applica dall'età di inizio).
- **Ponte**: l'età di uscita è `targetRetirementAge` (o l'età attuale se già superata). Il capitale attuale cresce al rendimento reale di portafoglio fino all'uscita e si confronta con il valore attuale dei prelievi, scontati allo stesso rendimento.
- **Distanza**: per i metodi di flusso è in euro annui, per gli altri in euro di capitale (`kind` lo indica). Gli anni sono stimati solo per il Fi-Number e il Coast.
- **Verdetto**: `determining` elenca i metodi verdi se il verdetto è verde, altrimenti i non verdi più vicini, quanti ne servono per arrivare al minimo.
- **Affitti e dividendi incassati**: vanno inseriti come entrate (`IncomeItem`) se finiscono su un conto di spesa. Se non lo sono, il loro accredito abbassa artificialmente il costo della vita.

### Decisioni prese durante la fase 3 (`lifebook-api`)

- **Endpoint aggiunto**: `results/net-worth` (patrimonio netto, composizione per tipo di conto e capitale investibile, con `asOf` o serie). Serve al primo grafico del cruscotto, che la sezione 10 non copriva. `results/living-cost` restituisce anche la ripartizione spesa essenziale/discrezionale.
- **Autenticazione**: `POST /auth/setup` crea l'unico utente (una sola volta), `POST /auth/login` emette un token di sessione di 30 giorni, `POST /auth/tokens` un token API senza scadenza (mostrato una sola volta). Entrambi si usano come `Authorization: Bearer` e sono salvati solo come hash SHA-256. Le password usano scrypt.
- **Archiviazione**: denaro in centesimi interi, tassi come frazioni. Impostazioni e parametri dei conti sono patch JSON con `validFrom`; nelle risposte tornano in euro.
- **Conti**: `DELETE` è consentito solo per conti senza snapshot né contributi (altrimenti 409, va archiviato con `archivedAt`). Il tipo di un conto non si può cambiare.
- **Snapshot**: uno solo per conto e data (409 se esiste già; si modifica con `PATCH`).
- **Risultati**: senza parametri usano la data di oggi. Con `from` e `to` (e `step` = `month` o `round`) restituiscono la serie, un punto per data calcolato as-of.
- **Ascolto**: il server ascolta su 127.0.0.1 per default. Il logger non registra intestazioni di autenticazione né corpi delle richieste.

### Decisioni prese durante le fasi 5 e 6 (`lifebook-web`, rifinitura)

- **Import CSV**: rimandato. Il giro mensile non ha ancora il pulsante di import (sezione 8): i saldi si inseriscono a mano. La fase 4 resta da fare.
- **Giro mensile**: i contributi si chiedono solo per i conti a contributi dichiarati che non sono conti di spesa né immobili. Il salvataggio aggiorna uno snapshot già presente alla data invece di duplicarlo. I contributi già salvati alla data si mostrano sommati e, se cambiano, vengono sostituiti da una sola voce.
- **Grafici**: usano un punto per ogni data con una lettura (`step=round`), così compare anche l'ultima lettura.
- **Cruscotto**: mostra anche il dettaglio mese per mese del costo della vita e le validazioni della sezione 5 in italiano, oltre a un avviso prima del salvataggio del giro se un conto a contributi dichiarati varia molto senza contributi.
- **Interfaccia**: i numeri sono sempre raggruppati con il punto (1.234), a differenza di quanto fanno di default i browser italiani per i numeri a quattro cifre.
- **Backup**: copia con l'API di backup di SQLite (consistente a database in uso), nome con data e ora locali, si tengono gli ultimi 30 file per default.
- **Dati di esempio**: 24 mesi di una famiglia fittizia, generati con un seme fisso attraverso la stessa API; si caricano solo in un database vuoto.

### Schermata Trasferimenti

- Aggiunta su richiesta (non era nella sezione 9). Non cambia il modello: un trasferimento è una o due `Contribution`. Le voci si creano solo sui conti a contributi dichiarati e non di spesa (negativa dal conto che cede, positiva su quello che riceve). Per i conti di spesa, per i depositi `inferred` e per gli immobili non si crea nulla: il movimento è già nei saldi e una voce in più lo conterebbe due volte. Se entrambi i conti sono di questo tipo l'app lo dice e non registra niente.
- Le singole spese restano fuori dall'MVP (sezione 2): il costo della vita si deduce dai saldi.
