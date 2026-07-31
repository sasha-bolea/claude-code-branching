# Storico sessioni

Archivio append-only. Voce più recente in alto.

---

## 2026-07-31 (18:19) — Il codice segue la conversazione

Sessione dedicata al versionamento del codice, nata da una domanda: *come fa Claude Code a
ripristinare i file, e possiamo sfruttarlo invece di rifarlo?* La risposta ha cambiato il
motore del ripristino, e da lì sono venuti tre bug veri, il menu a tre voci, l'hook dei commit
e due correzioni al disegno dell'albero.

### Cosa è stato scoperto

**Claude Code non usa git.** Ha un archivio di copie integrali in
`~/.claude/file-history/<sessione>/<hash>@v<N>`, indicizzato da due record dentro il transcript
(`file-history-snapshot`, uno per prompt utente, e `file-history-delta`). Ogni copia è il
contenuto **precedente** alla modifica che l'ha generata, quindi lo stato di un file
all'istante T è la **prima copia con `backupTime ≥ T`**. Verificato sui dati veri: ricostruito
lo stato all'inizio di una sessione, **20 file su 20 identici byte per byte** al commit che era
HEAD in quel momento, compresi 4 correttamente riconosciuti come «non esisteva ancora».

Le versioni ripartono da `v1` in ogni sessione; `backupFileName: null` significa che il file non
esisteva; la retention è di qualche settimana.

### Cosa è stato fatto

**Il ripristino legge l'archivio invece di chiamarlo** (`src/codice.js`). Sparisce lo spawn di
`claude --rewind-files` a ogni cambio ramo, sparisce `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING`,
e soprattutto si guardano le copie di **tutta la famiglia** di sessioni: il flag nativo ne
conosce una sola, mentre i rami di una conversazione stanno in file diversi.

**Fuori dalla cartella di lavoro non si scrive.** La controprova ha mostrato che nell'archivio
finiscono anche il profilo PowerShell e i file di memoria sotto `~/.claude`: riportarli indietro
insieme al codice sarebbe stato un danno silenzioso. Si contano e si dicono.

**Menu a tre voci** come Esc Esc: conversazione e codice / solo conversazione / solo codice,
sull'albero di F2 e nel selettore delle conversazioni, con `1`-`3` per la scelta diretta ed Esc
che torna all'albero. «Solo codice» è l'unico caso in cui Claude **non** viene riavviato.

**L'archivio di cb**, che è ciò che permette di tornare *avanti*: nell'archivio di Claude non
c'è mai lo stato finale di un file, quindi cb copia ciò che sta per sovrascrivere prima di
toccarlo. Nato da un bug segnalato dall'utente (file di test cancellato e mai più tornato).

**L'hook dei commit installato**, con l'aggancio **uuid → commit**: l'hook legge le ultime righe
del transcript e scrive nel messaggio l'uuid dell'ultimo messaggio del turno; `src/commit.js`
risolve un punto dell'albero in un commit e ne estrae i file con `git show`. `ripristinaA` lo
interroga solo per le copie scadute. Catena provata end-to-end lanciando l'hook con il payload
vero.

**Due correzioni al disegno**, entrambe da screenshot: la coda dei rami si consuma in profondità
e i rami di una stessa catena si disegnano **da destra a sinistra**, così nessuna discesa
incrocia più un altro ramo.

**Righe cambiate nell'intestazione**: fra l'ora del prompt e «riparti da qui» compaiono `+42` in
verde e `-7` in rosso, sommate su tutto il turno. Il dato viene dal diff che Claude scrive già
nel transcript (`toolUseResult.structuredPatch`): non dipende né dall'archivio né da git, e vale
anche sulle conversazioni vecchie. Verde e rosso hanno la stessa saturazione e luminosità
dell'arancione del marchio, cambia solo la tonalità.

### Cambiamenti al codice

**Ripristino del codice (nuovo)**
- `src/codice.js` (nuovo): `leggiStoricoFile`, `leggiStoricoCb`, `annotaCopia`,
  `preferisciCopiePresenti`, `statoAllIstante`, `ripristinaA`, `riassumiRipristino`
- `src/commit.js` (nuovo): `radiceGit`, `commitDiCb`, `commitDelPunto`, `contenutoDaCommit`,
  `ripiegoDaiCommit`
- `src/codice.test.js`, `src/commit.test.js` (nuovi): 18 prove, con archivi finti e repo git veri
- `hooks/cb-commit.ps1`: legge `transcript_path`, scrive `sessione:` e `messaggio: <uuid>` nel
  corpo del commit

**Wrapper**
- `ripristinaFile`: da spawn di `--rewind-files` a `ripristinaA` sulla famiglia, con
  `ripiegoDaiCommit`; il punto è la **fine del turno**, non il prompt
- `scegliModoRipristino`: menu a tre voci, cifre incluse, con consumo della coda dei tasti
- `cambiaRamo(percorso, albero, voce, modo)`: `codice` non chiude Claude e non taglia niente;
  `conversazione` salta il ripristino
- `cambiaConversazione`: `alberiFamiglia` impostato anche sul ramo di ripresa, modo propagato

**Vista e albero**
- `src/vista.js`: `VOCI_RIPRISTINO`, opzione `menu` in `schermata`, `cambiamenti` (conteggio
  colorato); coda in profondità e rami ordinati per colonna decrescente
- `src/stile.js`: `verde` e `rosso`, stessa saturazione e luminosità dell'arancione
- `src/transcript.js`: `righeCambiate` (da `structuredPatch`, e `type: 'create'` come aggiunte)
- `src/albero.js`: `alberoPrompt` somma le righe cambiate sul turno, con indice dei figli
  ricavato da `parentUuid`
- `src/conversazioni.js`: modo `menu` nel ciclo, `esitoScelta(caricata, uuid, modo)`
- `src/anteprima.js`: `--menu[=indice]` per guardare la schermata del menu

**Prove**
- `package.json`: `codice.test.js` e `commit.test.js` nella suite
- riscritte tre prove che fissavano il vecchio ordine di disegno; aggiornate quelle
  dell'overlay per il menu; nuove prove su conteggio righe, colori, ripiego sui commit

---

## 2026-07-31 (00:57) — cb si prende l'avvio: selettore di cartella e di conversazioni

Sessione che sposta dentro cb tutto quello che stava intorno: la scelta della cartella (prima
nel profilo PowerShell) e la scelta della conversazione da riprendere (prima il selettore
nativo di `claude -r`). Più cinque correzioni alla navigazione dell'albero, tutte nate
guardando screenshot dell'interfaccia vera.

### Cosa è stato fatto

**Il selettore di cartella dentro cb** (`src/cartelle.js`). L'albero delle cartelle sotto la
home, navigabile a frecce, con `r` che alterna avvio normale e ripresa. Era `Select-RepoFolder`
nel profilo: ora il profilo passa solo `--scegli`. La cartella scelta la sa solo cb — un
processo figlio non cambia la cwd del padre — quindi cb la scrive nel file indicato da
`CB_CARTELLA_SCELTA` e la shell ci si sposta all'uscita, com'era prima con `Set-Location`.

**Il selettore di conversazioni** (`src/conversazioni.js`), che sostituisce quello nativo.
La differenza è il raggruppamento: un fork crea un file nuovo, quindi il selettore di Claude
elenca i rami della stessa conversazione come conversazioni diverse. Qui le sessioni si
raggruppano per uuid di radice e **una conversazione è tutto il suo albero**. In cima l'albero
della conversazione selezionata, sotto l'elenco; `↑↓` scorrono e l'albero sopra cambia; invio
entra nell'albero e da lì si sceglie il punto, con la stessa schermata dell'overlay F2.

**Cambio conversazione o cartella a sessione avviata**: dall'overlay F2, `c` apre l'elenco
delle conversazioni della cartella, `p` prima il selettore delle cartelle. Il wrapper chiude
Claude, aggiorna `cwd` e titolo, e riparte da quello che è stato scelto.

**Cinque correzioni all'albero**, tutte da screenshot:
1. le giunzioni `┣`/`┗` attraversate dal percorso restavano grigie: una cella può appartenere
   a più rami, e conosceva solo il primo che l'aveva occupata;
2. `→` in fondo a un ramo ora scende anche su un ramo che finisce **esattamente dove siamo**,
   non solo su uno che va più avanti;
3. `←` sul primo prompt di un ramo **sale e basta**, invece di salire e tornare indietro in
   diagonale fino alla forca;
4. la biforcazione **sul primo prompt** disegnava due linee separate, senza niente che le
   collegasse: ora ha la sua forca prima della prima colonna;
5. scorrendo l'elenco delle conversazioni, alberi di altezza diversa facevano salire e
   scendere il separatore e tutto l'elenco. Il pannello dell'albero ha ora altezza fissa.

### Cambiamenti al codice

**Selettori (nuovi)**
- `src/cartelle.js` (nuovo): `figli`, `componiRighe`, `statoIniziale`, `applicaAzione`,
  `disegna`, `selezionaCartella`, `annotaCartellaScelta`, `radicePredefinita` (radice da
  `CB_RADICE`, ripiego su `~/Documents/REPOSITORY` e poi sulla home)
- `src/conversazioni.js` (nuovo): `raggruppaPerFamiglia`, `famiglieDellaCartella`,
  `caricaFamiglia`, `disegnaConversazioni`, `pannelloAlbero`, `esitoScelta`,
  `selezionaConversazione`
- `src/cartelle.test.js`, `src/conversazioni.test.js` (nuovi): 115 assert in tutto, con
  terminale finto (EventEmitter) per provare i cicli interattivi senza un TTY

**Albero e navigazione**
- `src/vista.js`: `aggiungiRami` (una cella attraversata da più rami li conosce tutti);
  forca di radice quando le radici sono più d'una; `aSinistra` (sale invece di tagliare in
  diagonale, e vale anche per le radici senza padre); `proseguiSuUnRamoAffiancato` accetta
  verso il basso anche un ramo che finisce alla colonna del cursore; `schermata` parametrica
  su `titolo`, `esc` e `extra` (i tasti in più da annunciare), con le varianti della barra
  ordinate per preferenza e non solo per lunghezza

**Wrapper**
- `src/wrapper.js`: `avvia({ripartenza})` — riusa `cambiaRamo` anche quando un processo non
  c'è ancora; `cambiaConversazione({ancheCartella})` per i tasti `c`/`p`, con restituzione
  dello stdin al wrapper in un `finally`; `cambiaRamo` restituisce se Claude è ripartito;
  `leggiNavigazione` passa da `azioniNavigazione`

**Tastiera**
- `src/tasti.js`: `azioniNavigazione` — unico lettore di tasti per le schermate a elenco e ad
  albero (frecce, `wasd`, spazio, `r`, `c`, `p`, invio, esc), al posto della copia che stava
  in `cartelle.js`

**Indice**
- `src/indice.js`: la scheda porta `radice` (uuid), che serve a raggruppare le conversazioni;
  `primoPrompt` salta il rumore di protocollo (una conversazione aperta con `/clear` si
  chiamava «/clear»); le schede in cache senza `radice` valgono come assenti

**Entrypoint e profilo**
- `bin/cb.js`: flag `--scegli`, orchestrazione cartella → conversazione → wrapper, `await`
  su `avvia()` perché l'errore arrivi al ripiego 78
- `src/anteprima.js`: annuncia gli stessi tasti dell'overlay vero
- Profilo PowerShell (fuori repo): `Select-RepoFolder` resta solo per `vai`; la funzione
  `claude` passa `--scegli`, legge il file di hand-off e fa `Set-Location`; tolto il loop di
  rinomina della tab, che ora è compito di cb

---

## 2026-07-30 (19:10) — Interfaccia dell'albero: vista orizzontale, colori, navigazione

Sessione tutta sull'**interfaccia**: l'albero verticale numerato è stato sostituito da una
vista orizzontale navigabile a frecce. Punto di partenza un disegno fornito dall'utente
(`docs/esempio-albero.txt`), da cui sono usciti geometria e glifi.

### Cosa è stato fatto

**La vista.** La conversazione scorre da sinistra a destra, un nodo per prompt, e ogni
biforcazione fa scendere un ramo. Sotto l'albero il prompt selezionato per intero, sotto
ancora la storia che quel punto porta con sé fino alla radice. Il layout è separato dal
disegno: `componiVista` calcola la griglia una volta sola, `disegnaRighe` la colora in base
al cursore, `schermata` compone la pagina. Muovere il cursore non ricalcola nulla.

**La navigazione**, arrivata in tre passi su richiesta:
1. frecce al posto del numero, più `wasd` per chi tiene le mani sulle lettere;
2. `↑↓` passano al ramo disegnato sopra/sotto invece che ai *fratelli* — prima da un figlio
   unico il tasto era inerte, e capitava di rado di trovarsi su una biforcazione;
3. `→` in fondo a un ramo prosegue su uno affiancato che vada più avanti: fra due vince il
   più corto, a parità quello di sopra.

**Lo scorrimento.** Le catene non vanno più a capo (un ramo lungo sembrava tanti rami corti):
l'albero ha la sua larghezza naturale — 357 colonne su una conversazione vera — e se ne mostra
una finestra che insegue il cursore in orizzontale e in verticale, con gli avvisi di quanto
resta fuori ai lati.

**I colori.** Arancione del marchio Claude in truecolor. Tre giri di correzione su richiesta:
prima l'interfaccia sembrava a luminosità abbassata (quasi tutto era grigio scuro), poi tutto
al massimo tranne la legenda, infine l'arancione è passato a marcare **il percorso dal cursore
alla radice** — nodi *e* linee di collegamento — invece del ramo attivo.

**Tre bug corretti**, due dei quali preesistenti e trovati dai test nuovi: cursore che partiva
sul prompt sbagliato, selettore delle conversazioni che riappariva dopo un ripristino avviato
con `claude -r`, overlay che non si ridisegnava al ridimensionamento della finestra.

Cambiata anche la scorciatoia: **Ctrl+G → F2**, perché Ctrl+G è già usato da Claude Code.

### Cambiamenti al codice

**Vista (nuova)**
- `src/vista.js` (nuovo): `componiVista` (griglia orizzontale, `rami` sulle celle di raccordo
  per poterle colorare), `disegnaRighe` (colore + ritaglio orizzontale sulle celle),
  `schermata` (pagina intera, pura e testabile), `muovi`, `puntaRamoAttivo`, `antenati`,
  `aCapo`, `tagliaVisibile`, `primaCheEntra`, `finestraAttorno`
- `src/stile.js` (nuovo): tavolozza in un posto solo, `NO_COLOR`/`CB_COLORI`
- `src/anteprima.js` (nuovo): mostra l'overlay su una sessione vera senza lanciare Claude
- `src/albero.js`: esportate `uuidRamoAttivo` e `testoLeggibile`; l'albero verticale numerato
  resta per `cb tree`/`pick`/`open`

**Tastiera**
- `src/tasti.js`: frecce riconosciute (CSI, SS3, win32) — prima erano scartate; `wasd`;
  tasti funzione in codifica ANSI (`ESC OQ`, `ESC[12~`, con i buchi 16 e 22 della numerazione)

**Wrapper**
- `src/wrapper.js`: ciclo di navigazione al posto della lettura di un numero, `creaProcesso`
  estratto per poter verificare gli argomenti passati a Claude, `senzaRipresa`/`chiedeRipresa`,
  `ridimensiona` con ridisegno ritardato, coda dei tasti arrivati in gruppo
- `src/transcript.js`: nuovo campo `ultimoNodo` (ultimo record messaggio del file)

**Documentazione e integrazione**
- `README.md`: sezione sull'albero interattivo, guida alla scelta della scorciatoia
- `bin/cb.js`: aiuto aggiornato, distinzione fra albero interattivo ed elenco numerato
- `$PROFILE` (fuori repo): `--tasto ctrl+g` → `--tasto f2`

**Test** — da 59 a 89 prove
- `src/vista.test.js` (nuovo): 25 prove su layout, colore, ritaglio, navigazione
- `src/tasti.test.js`: frecce, `wasd`, tasti funzione
- `src/wrapper.test.js`: argomenti passati a Claude al rilancio
- `src/overlay.test.js`: navigazione a frecce al posto dei numeri, ridimensionamento

---

## 2026-07-30 (16:45) — Wrapper interattivo, taglio della conversazione, pubblicazione

Sessione lunga, guidata dai sintomi: ogni problema segnalato ha smentito un'assunzione sul
CLI di Claude Code, e la correzione è arrivata solo dopo averlo **misurato**.

### Cosa è stato fatto

Consegnato prima un launcher esterno (fase 1 del piano), poi — su richiesta — il **wrapper con
pty** che era il workflow vero: Ctrl+G *dentro* la sessione, senza uscire.

Da lì una catena di problemi reali, tutti riprodotti prima di essere corretti:

1. La scorciatoia non rispondeva → i tasti non arrivano come byte grezzi (**win32-input-mode**),
   e premuti in rapida successione arrivano in una sola lettura.
2. L'overlay sfarfallava → il **rilascio** del tasto appena premuto veniva letto come Esc e
   auto-annullava la schermata.
3. I rami precedenti a un fork sparivano → un fork copia la storia solo fino al punto di fork;
   serve **unire la famiglia** di sessioni per uuid di radice.
4. L'albero spariva dopo un cambio ramo → il transcript di una sessione forkata non esiste
   finché non arriva il primo messaggio.
5. Il ripristino veniva annullato → **corsa**: Claude, uscendo, appende un `last-prompt` che
   sovrascriveva la riattivazione.
6. Il secondo cambio ramo falliva → le `origini` mancavano quando la famiglia era di un solo file.
7. **Il punto intermedio non tagliava** → `--resume-session-at` tronca solo in print mode; in
   interattivo il CLI ricostruisce dall'ultimo record del file. Il taglio ora lo scrive cb.
8. Il titolo della tab diventava `claude.exe` → è **ConPTY**, non Claude, a emettere l'OSC di
   titolo a ogni avvio di processo.

Aggiunto il **ripristino automatico dei file** (`--rewind-files`, che richiede
`CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=1`), spostato il progetto in `personale/`, e
pubblicata la repo pubblica su GitHub dopo aver ripulito percorsi e uuid della macchina.

Dettaglio di ogni bug (sintomo, causa, fix) in `bug-risolti.md`.

### Cambiamenti al codice

**Wrapper interattivo (pty)**
- `src/wrapper.js` (nuovo): pseudo-terminale, intercettazione della scorciatoia, overlay
  dell'albero, cambio ramo, ripristino file, riaffermazione del titolo
- `src/eseguibile.js` (nuovo): trova `claude.exe` (node-pty non lancia gli shim npm)
- `src/percorsi.js` (nuovo): slug delle cartelle progetto, `sessioniDellaFamiglia`,
  `transcriptPiuRecente`, `sessioneDaPercorso`

**Tastiera**
- `src/tasti.js` (nuovo): `tokenizza` per tre codifiche (byte grezzi, kitty, win32-input-mode),
  `analizzaScorciatoia` / `contaInTesta` / `soloRilasci`, `azioniTastiera` per l'input
  dell'overlay
- `src/titolo.js` (nuovo): `senzaTitolo` filtra gli OSC 0/1/2 dei processi figli

**Rami**
- `src/ramo.js` (nuovo): `creaSessioneTroncata` — scrive il `.jsonl` del nuovo ramo con la sola
  catena fino al turno scelto
- `src/attiva.js`: `fineDelTurno` sostituisce `fogliaPiuProfonda`; il confronto è sulla fine del
  turno, non sulla raggiungibilità
- `src/transcript.js`: `unisciAlberi` (fusione per uuid con `origini`), `cwd`/`gitBranch`/
  `primoPrompt`/`ultimoTimestamp` nei metadati, `isPromptUtente`, `ripristini`

**Integrazione**
- `bin/cb.js`: separatore `--` per gli argomenti di Claude, `--tasto`/`--tasti`/`--senza-file`,
  uscita **78** quando cb non parte, ripiego senza pty per `-p`/stdin non TTY
- `src/lancia.js`: `lanciaClaudeDiretto`; rimosso `shell: true` che troncava i prompt
- `$PROFILE` (fuori repo): la funzione `claude` ora lancia Claude dentro cb, con ripiego

**Test** — da 4 a 59 prove
- `src/tasti.test.js`, `src/titolo.test.js`, `src/wrapper.test.js`, `src/overlay.test.js` (nuovi)
- isolamento fra prove (`pulisciCartella`) e pty finto realistico: suite da 44 s a 9 s

**Pubblicazione**
- `LICENSE` (MIT), README riscritto per chi arriva da fuori, percorsi e uuid della macchina
  rimossi, `verifica-reale.js` con argomento richiesto
- Due commit: scaffold completo + preparazione alla pubblicazione

---

## 2026-07-29 — Analisi, parser dell'albero, launcher, hook dei commit

Sessione iniziale: capire se il branching fosse possibile e costruire le basi.

### Cosa è stato fatto

L'analisi ha rovesciato la premessa di partenza: **la conversazione abbandonata non viene
persa**. I transcript sono append-only e l'albero dei rami è già nei file — mancava solo chi lo
legge. Riscontro su dati reali: 7 biforcazioni in una sessione, una con 3 rami.

Scoperti i flag non documentati (`--resume-session-at`, `--fork-session`, `--rewind-files`) e il
vincolo che li governa: cercano il messaggio nella **catena attiva**, quindi un ramo abbandonato
va prima riattivato. Risolto appendendo un `last-prompt`, verificato end-to-end ripescando un
ramo abbandonato cinque giorni prima.

Costruiti parser, catalogo globale, launcher esterno e hook dei commit automatici.

### Cambiamenti al codice

- `src/transcript.js`: parsing dei `.jsonl`, albero da `parentUuid`, filtro sidechain, filtro
  delle biforcazioni tecniche (7 forche → 3 ripristini veri)
- `src/attiva.js`: riattivazione di un ramo abbandonato; `terminaConACapo` per non corrompere
  l'ultima riga
- `src/albero.js`: albero collassato dei soli prompt utente, rendering ASCII con `●`/`○`/`⑂`,
  compressione dei prompt di protocollo
- `src/indice.js`: scansione globale di `~/.claude/projects` con cache su mtime+size
  (3,2 s a freddo su 90 MB, 0,5 s a caldo)
- `src/lancia.js`, `bin/cb.js`: launcher e sottocomandi `ls`/`tree`/`open`/`pick`
- `hooks/cb-commit.ps1`: hook `Stop`, commit su `refs/cb/<sid>/auto` via
  `write-tree`/`commit-tree`/`update-ref` con index temporaneo
- `src/transcript.test.js`: 4 prove, incluso il recupero di un ramo abbandonato
- Scaffold: `package.json`, `.gitignore`, `README.md`, `CLAUDE.md`, `docs/brief.md`
