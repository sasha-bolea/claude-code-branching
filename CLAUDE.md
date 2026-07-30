# CLAUDE.md — cb

## 1. Progetto & scopo

`cb` dà a Claude Code il branching che gli manca: l'albero dei rami di una conversazione,
un catalogo globale delle sessioni, e la ripresa da qualsiasi messaggio — compresi i rami
abbandonati con un ripristino. Vedi `docs/brief.md`.

## 2. Team & ruoli

Sasha, singolo sviluppatore.

## 3. Stack

- Node.js 24 (ESM, `"type": "module"`); unica dipendenza `node-pty`
- Hook in PowerShell 7 (`pwsh`)
- Windows 11. I path ESM assoluti richiedono `file://`: negli script usare import relativi.

## 4. Struttura chiave

| File | Ruolo |
|---|---|
| `src/wrapper.js` | Pseudo-terminale, intercettazione tasti, overlay dell'albero, cambio ramo |
| `src/tasti.js` | Decodifica dei tasti nelle tre codifiche, scorciatoie configurabili |
| `src/titolo.js` | Filtra le richieste di cambio titolo dei processi figli |
| `src/transcript.js` | Parsing dei `.jsonl`, albero da `parentUuid`, filtro biforcazioni tecniche |
| `src/attiva.js` | Riattivazione di un ramo abbandonato via append di `last-prompt` |
| `src/ramo.js` | Crea la sessione del nuovo ramo: copia la catena fino al turno scelto |
| `src/cartelle.js` | Selettore della cartella di lavoro: albero dei progetti, hand-off alla shell |
| `src/conversazioni.js` | Selettore delle conversazioni passate: albero in cima, elenco sotto |
| `src/vista.js` | Albero orizzontale: griglia, colore, navigazione, composizione della pagina |
| `src/stile.js` | Tavolozza dei colori, in un posto solo |
| `src/albero.js` | Collasso ai soli prompt utente; elenco verticale numerato per i comandi da fuori |
| `src/anteprima.js` | Mostra l'overlay su una sessione vera, senza lanciare Claude |
| `src/indice.js` | Scansione globale di `~/.claude/projects` con cache su mtime+size |
| `src/percorsi.js` | Slug delle cartelle progetto, risoluzione del transcript di una sessione |
| `src/eseguibile.js` | Ricerca del binario nativo di Claude (node-pty non lancia gli shim) |
| `src/lancia.js` | Ripresa da fuori: spawn di `claude` con `stdio: 'inherit'` |
| `bin/cb.js` | Entrypoint e sottocomandi |
| `hooks/cb-commit.ps1` | Hook `Stop`: commit automatici su `refs/cb/<sid>/auto` |

## 5. Integrazione

`cb` può essere agganciato alla funzione `claude` del profilo PowerShell (`$PROFILE`), che
resta responsabile di quello che già faceva (selettore di cartella, titolo della tab, ecc.):
vedi README, sezione «Agganciarlo al comando `claude`». Fare un backup del profilo prima di
modificarlo.

Regole del contratto con il chiamante:

- Uscita **78** = cb non è partito → il chiamante ripiega su Claude diretto. Qualsiasi
  altro codice è l'uscita di Claude e **non** va rilanciato.
- Tutto ciò che segue `--` è destinato a Claude, non a cb.
- Con `-p`/`--print` o stdin non TTY, cb esegue Claude senza pty (`lanciaClaudeDiretto`).

## 6. Comandi

```
npm test                          esegue le prove (assert, nessun framework)
node src/anteprima.js [file]      l'overlay su una sessione vera, senza lanciare Claude
node src/cartelle.js              il selettore delle cartelle, da solo
node src/conversazioni.js [dir]   il selettore delle conversazioni, da solo
node src/verifica-reale.js [file] verifica il parser su una sessione vera
node bin/cb.js ls                 catalogo globale
node bin/cb.js tree <sessione>    albero dei rami
node bin/cb.js --scegli           avvio completo: cartella, conversazione, Claude
```

`anteprima.js` senza argomenti prende la sessione con più ripristini, che è quella con
l'albero più ramificato. `NO_COLOR=1` per leggerlo senza sequenze ANSI.

Procedure multi-passo (installazione, aggancio a `claude`, hook dei commit, spostamento della
cartella, pubblicazione su GitHub, diagnosi): **`docs/procedure.md`**.

## 7. Convenzioni

- **Mai modificare o rimuovere record esistenti nei `.jsonl`.** Ogni intervento sui
  transcript è un append: è il motivo per cui i rami sopravvivono, e va preservato.
- Il file di sessione può non terminare con `\n`: prima di appendere va verificato
  (`terminaConACapo` in `src/attiva.js`), altrimenti il record si incolla all'ultima riga
  e la corrompe.
- Mai parsare l'output a schermo di Claude Code: si romperebbe a ogni aggiornamento del
  CLI. Si legge solo il transcript su disco.
- I flag `--resume-session-at` / `--fork-session` non sono documentati: ogni loro uso va
  accompagnato da un commento che spiega il comportamento verificato.
- Il `cwd` va sempre passato allo spawn: Claude cerca le sessioni nella cartella del
  progetto corrente, e da una cartella diversa risponde `No conversation found`.
- **Mai `shell: true` con argomenti separati**: la shell li riconcatena e li rispezza sugli
  spazi, troncando i prompt (`-p "rispondi solo: X"` diventava `rispondi`). Usare
  l'eseguibile risolto da `trovaEseguibileClaude()` senza shell.
- **node-pty non lancia gli shim npm** (`claude.ps1`/`.cmd`): dà `error code: 2`. Serve
  `claude.exe`, risolto da `src/eseguibile.js`.
- **I tasti non arrivano come byte grezzi.** Claude abilita win32-input-mode
  (`ESC[?9001h`) e il protocollo kitty (`ESC[>1u`). Su Windows la codifica reale è la
  prima: `ESC[Vk;Sc;Uc;Kd;Cs;Rc_`, con eventi di rilascio inclusi (Esc premuto =
  `ESC[27;1;27;1;32;1_`). Mai confrontare i byte direttamente: usare `tokenizza` di
  `src/tasti.js`, che gestisce tutte e tre le codifiche.
- I tasti premuti in rapida successione **arrivano in un'unica lettura di stdin**: la
  logica deve tokenizzare il buffer, non trattarlo come un tasto solo. È l'errore che ha
  fatto passare `Esc Esc` a Claude aprendo il menu nativo.
- **Anche l'input dell'overlay va tokenizzato** (`azioniTastiera`), mai letto a byte. In
  win32-input-mode ogni evento comincia con `0x1b`, quindi il rilascio del tasto appena
  premuto veniva scambiato per Esc e chiudeva l'overlay all'istante: a schermo si vedeva
  solo uno sfarfallio. Vanno ignorati anche gli eventi di rilascio (`Kd=0`) e le sequenze
  del mouse, che altrimenti iniettano le proprie coordinate come cifre digitate.
- Se qualcosa non risponde, **leggere `~/.claude/cb/diagnosi.log`** (`cb --tasti`) invece
  di dedurre dallo schermo: registra byte, interpretazione e decisioni dell'overlay.
- Ogni cambio di ramo **riavvia il processo Claude**: non esiste modo di ricaricare una
  conversazione in un processo vivo.
- **Un fork spezza la conversazione su due file.** Il file nuovo copia la storia solo fino
  al punto di fork, quindi i rami abbandonati restano in quello di partenza: leggere solo la
  sessione corrente li perde. Gli uuid però sono stabili nella copia e la radice è comune,
  quindi le sessioni si raggruppano per uuid di radice (`sessioniDellaFamiglia`) e si
  uniscono per uuid (`unisciAlberi`). Mai costruire l'albero da un solo file.
- L'id sessione per `--resume` è il **nome del file**, non il `sessionId` dei record: i
  record copiati da un fork possono riferirsi alla sessione di provenienza.
- **Il transcript di una sessione forkata non esiste finché non arriva il primo messaggio.**
  Subito dopo un cambio ramo `percorsoTranscript` torna quindi `null`: senza ripiegare sul
  transcript di provenienza (`percorsoOrigine`) l'albero sparirebbe e cb dichiarerebbe la
  sessione senza transcript. Anche `leafAttivo` va sovrascritto con `uuidRipreso`, perché
  quello scritto nel file di provenienza è il ramo dell'altra sessione.
- `--session-id` **è** rispettato insieme a `--fork-session` (verificato: il file nasce con
  l'id richiesto). Il problema non era l'id, era il momento della scrittura.
- Riattivare un ramo va fatto nel file che lo contiene, usando **l'albero di quel file** e
  non quello unito: la foglia più profonda dell'albero unito può non esistere in quel file.
- **In interattivo il CLI ignora `--resume-session-at` e `last-prompt.leafUuid`.** Ricostruisce
  la catena dall'**ultimo record messaggio presente nel file**. Verificato catturando lo
  schermo di sessioni vere: con `-p` il taglio avviene, in interattivo il turno successivo
  ricompariva sempre, anche passando il flag e anche riscrivendo `last-prompt`. L'help lo
  dice: *"use with --resume in print mode"*.
  → Il taglio lo fa cb: `creaSessioneTroncata` scrive un **file di sessione nuovo** con solo
  la catena fino alla fine del turno scelto, e lo si riprende con `--resume <nuovo>` (niente
  `--fork-session`, niente `--session-id`: la sessione esiste già). Il file di partenza non
  viene toccato, quindi i turni successivi restano ripescabili come ramo in disparte.
- Il punto di taglio è la **fine del turno** (`fineDelTurno`), non la foglia più profonda del
  ramo: si scende fra i discendenti fermandosi al prompt utente successivo, così restano il
  prompt scelto e la sua risposta.
- **`kill()` è asincrono e Claude scrive un ultimo `last-prompt` uscendo.** Scrivendo subito
  dopo il kill, quella scrittura tardiva sovrascrive la riattivazione del ramo e la rende
  inefficace: `--resume-session-at` e `--rewind-files` non trovano più il messaggio
  (`requires a user message UUID`). Va attesa l'uscita effettiva (`chiudiProcesso`, con rete
  di sicurezza a 5s) e poi **verificato** che `leafAttivo` sia quello atteso, riprovando se
  no (`riattivaConVerifica`). Non basta appendere e sperare.
- Ogni chiamata a Claude fuori dal pty va fatta con **`spawn` e stdin chiuso**
  (`stdio: ['ignore','pipe','pipe']`): con stdin aperto Claude attende dati per 3 secondi
  (`no stdin data received in 3s`). Non usare `execFile`, che non dà la stessa garanzia.
- **`unisciAlberi` va chiamato sempre**, anche con una sola sessione nella famiglia:
  altrimenti i nodi non hanno `origini` e il cambio ramo ripiega su `this.sessionId` — che
  subito dopo un fork è una sessione senza transcript, e `--resume` risponde
  `No conversation found with session ID`. È l'errore che rompeva il secondo cambio ramo
  consecutivo.
- Se il processo rilanciato per un cambio ramo muore entro pochi secondi con codice diverso
  da zero, va detto a schermo: senza, cb spariva lasciando l'utente nella shell senza
  spiegazione.
- **ConPTY emette `ESC]0;<percorso eseguibile>BEL` a ogni avvio di processo**, sovrascrivendo
  il titolo della tab con `…\claude.exe`. Non dipende da Claude
  (`CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` non basta) e si ripresenta a ogni cambio ramo,
  perché il processo è nuovo. L'output del pty va quindi filtrato con `senzaTitolo` e il
  titolo riaffermato a ogni avvio. Filtrare solo gli OSC `0/1/2`: gli altri (es. `8` per i
  link) e tutte le sequenze `ESC[` devono passare intatti, o la TUI si rompe.
- **`--rewind-files` richiede `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=1` nell'ambiente.**
  Nel binario il gate è `T1()`: in modalità non interattiva (`yn()`) lo storico dei file è
  abilitato solo da quella variabile, altrimenti risponde `File rewinding is not enabled`.
  Verificato per differenza: senza variabile quell'errore, con variabile passa al successivo
  (`No file checkpoint found`).
- L'ordine in `cambiaRamo` non è arbitrario: **chiudere Claude → riattivare il ramo →
  ripristinare i file → rilanciare**. `--rewind-files` ha lo stesso vincolo di
  `--resume-session-at` (il messaggio deve stare nella catena attiva), e gli interventi su
  transcript e file devono essere gli ultimi, senza il processo vecchio che scrive sopra.
- **Il ramo attivo è l'ultimo record messaggio del file** (`ultimoNodo`), non
  `last-prompt.leafUuid`: è da lì che il CLI ricostruisce la conversazione riprendendo in
  interattivo, e `last-prompt` resta spesso indietro (misurato: divergevano in 7 sessioni su
  12). `leafAttivo` resta però quello giusto per **scrivere**: la riattivazione di un ramo
  funziona appendendo un `last-prompt`, e `--rewind-files` gira in modalità non interattiva,
  dove quel campo conta davvero.
- **Al rilancio dopo un cambio ramo vanno tolti i flag di ripresa dell'utente**
  (`senzaRipresa`): la ripresa la chiede già cb con la sessione che ha creato, e un `-r` in
  coda arriva a Claude come seconda richiesta senza id, che riapre il selettore delle
  conversazioni. Va tolto anche l'id che segue il flag, o resta sciolto e diventa un prompt.
- **Il ritaglio orizzontale dell'albero si fa sulle celle, mai sul testo prodotto**: le righe
  finite contengono sequenze ANSI, e tagliarle per numero di caratteri ne spezzerebbe una a
  metà lasciando il terminale colorato. Vale anche per il taglio di sicurezza finale
  (`tagliaVisibile`), che conta i caratteri visibili e richiude il colore.
- **Nessuna riga della schermata può eccedere la larghezza del terminale**: una riga più lunga
  viene mandata a capo dal terminale, e il capo sfasa tutto il disegno sotto. Le stringhe fisse
  (legenda, barra dei tasti) hanno varianti accorciate; `tagliaVisibile` è la rete finale.
- La griglia dell'albero **non dipende dalle dimensioni del terminale**: si compone una volta
  sola alla larghezza naturale, e finestra e colori si ricalcolano a ogni disegno. È ciò che
  permette di seguire il ridimensionamento e i movimenti del cursore senza rifare il layout.
- **Una conversazione è una famiglia di sessioni, non un file.** Le sessioni si raggruppano
  per uuid di radice (`scheda.radice`, prodotto da `src/indice.js`): è l'unica chiave che il
  fork copia insieme alla storia. Elencare i file, come fa il selettore nativo di Claude,
  mostra i rami della stessa conversazione come conversazioni diverse.
- **Un processo figlio non cambia la cwd del padre**: la cartella scelta si restituisce alla
  shell scrivendola nel file indicato da `CB_CARTELLA_SCELTA` (`annotaCartellaScelta`), che il
  chiamante legge all'uscita. Senza la variabile cb non scrive niente.
- **Riprendere la punta di una conversazione non richiede un taglio**: `esitoScelta` distingue
  i due casi, altrimenti ogni ripresa duplicherebbe l'intera conversazione in un file nuovo.
- **I selettori aperti dal wrapper si prendono lo stdin** e alla chiusura lo lasciano com'era
  (raw mode spento, flusso in pausa): va rimesso come lo vuole il wrapper in un `finally`, o i
  tasti non arrivano più a Claude. Mentre sono aperti `inOverlay` resta vero, così
  l'ascoltatore del wrapper ignora tutto e l'output del pty non copre la schermata.
- **Nel selettore delle conversazioni il pannello dell'albero ha altezza fissa**: gli alberi
  hanno altezze diverse, e un pannello che si adatta fa saltare separatore ed elenco a ogni
  freccia. Il riempimento è invisibile, il salto no.
- Le prove stanno in `src/transcript.test.js`, `src/tasti.test.js`, `src/titolo.test.js`,
  `src/vista.test.js`, `src/wrapper.test.js`, `src/overlay.test.js`, `src/cartelle.test.js` e
  `src/conversazioni.test.js`, con `assert`. I cicli interattivi dei selettori si provano con
  un terminale finto (un `EventEmitter` con `write`/`resume`/`pause`), senza TTY.
  Niente framework. Nel wrapper i test usano un pty finto: la logica dei tasti è
  isolabile, l'interazione con la TUI vera no. `creaProcesso` è estratto apposta perché i test
  possano verificare **cosa** viene chiesto a Claude senza lanciarlo.

## 8. Riferimenti docs

- `docs/STATO.md` — stato corrente, problemi aperti, decisioni, backlog
- `docs/brief.md` — spec, vincoli scoperti e loro riscontro
- `docs/architettura.md` — stack, componenti, flussi, modello dei dati
- `docs/bug-risolti.md` — registro dei bug con causa e fix (grep-abile)
- `docs/procedure.md` — runbook delle procedure multi-passo
- `docs/storico-sessioni.md` — archivio delle sessioni
- `README.md` — uso e installazione
