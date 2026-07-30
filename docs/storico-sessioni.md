# Storico sessioni

Archivio append-only. Voce più recente in alto.

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
