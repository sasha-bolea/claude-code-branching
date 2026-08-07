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
| `src/transcript.js` | Parsing dei `.jsonl`, albero da `parentUuid`, filtro biforcazioni tecniche, righe cambiate per record |
| `src/codice.js` | Ripristino dei file: archivio delle copie di Claude e di cb, regola temporale |
| `src/commit.js` | Commit automatici come ripiego: aggancio uuid → commit, lettura con `git show` |
| `src/attiva.js` | Riattivazione di un ramo abbandonato via append di `last-prompt` |
| `src/ramo.js` | Crea la sessione del nuovo ramo: copia la catena fino al turno scelto |
| `src/cartelle.js` | Selettore della cartella di lavoro: albero dei progetti, hand-off alla shell |
| `src/conversazioni.js` | Selettore delle conversazioni passate: albero in cima, elenco sotto |
| `src/vista.js` | Albero orizzontale: griglia, colore, navigazione, composizione della pagina |
| `src/stile.js` | Tavolozza dei colori, in un posto solo |
| `src/lingua.js` | Tutti i testi a schermo, inglese e italiano; scelta con `CB_LINGUA` |
| `src/impostazioni.js` | Lettura/scrittura di `~/.claude/cb/impostazioni.json`, precedenza dei valori |
| `src/profili.js` | Insiemi di variabili d'ambiente con un nome: rilancia Claude altrove senza uscire dalla conversazione |
| `src/coda.js` | La coda dei prompt: si scrivono mentre Claude lavora, ne parte uno per turno |
| `src/note.js` | Le note della cartella di lavoro: le stesse in ogni sessione aperta lì dentro |
| `src/pulizia.js` | I tre accumuli che non scadono: `cb prune` a mano, e la pulizia automatica |
| `src/configura.js` | Schermata del primo avvio: lingua, cartella di lavoro, scorciatoia |
| `src/prove.js` | Esecutore delle prove: un processo per file, lingua fissata a `it` |
| `src/albero.js` | Collasso ai soli prompt utente; elenco verticale numerato per i comandi da fuori |
| `src/anteprima.js` | Mostra l'overlay su una sessione vera, senza lanciare Claude |
| `src/indice.js` | Scansione globale di `~/.claude/projects` con cache su mtime+size |
| `src/percorsi.js` | Slug delle cartelle progetto, risoluzione del transcript di una sessione |
| `src/eseguibile.js` | Ricerca del binario nativo di Claude (node-pty non lancia gli shim) |
| `src/lancia.js` | Ripresa da fuori: spawn di `claude` con `stdio: 'inherit'` |
| `bin/cb.js` | Entrypoint e sottocomandi |
| `hooks/cb-commit.ps1` | Hook `Stop`: commit automatici su `refs/cb/<sid>/auto` |
| `hooks/cb-coda.ps1` | Hook `Stop`: consegna un prompt della coda per turno |

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
npm test                          esegue le prove (src/prove.js: un processo per file)
node bin/cb.js --version          numero di versione
node src/anteprima.js [file]      l'overlay su una sessione vera, senza lanciare Claude
node src/anteprima.js --menu[=n]  la stessa schermata con il menu del ripristino aperto
node src/cartelle.js              il selettore delle cartelle, da solo
node src/configura.js             la schermata delle impostazioni (scrive su un file di prova)
node src/conversazioni.js [dir]   il selettore delle conversazioni, da solo
node src/coda.js [sessione]      la coda dei prompt, su una coda di prova
node src/note.js [cartella]      le note, su un archivio di prova
node src/verifica-reale.js [file] verifica il parser su una sessione vera
node bin/cb.js ls                 catalogo globale
node bin/cb.js tree <sessione>    albero dei rami
node bin/cb.js --scegli           avvio completo: cartella, conversazione, Claude
node bin/cb.js prune              cosa toglierebbe la pulizia (7 giorni, niente cancellato)
node bin/cb.js prune --giorni 1 --esegui   pulizia vera con una soglia stretta
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
- **Inoltrare il primo Esc non deve azzerare il conteggio.** Scaduti i 300 ms cb manda il
  primo Esc a Claude — e deve farlo, o si perde l'interruzione — ma azzerando lì le pressioni,
  due Esc battuti più piano diventavano due Esc singoli inoltrati a distanza, e Claude, che ha
  una finestra sua più larga, li rimetteva insieme aprendo il **suo** menu di ripristino: cioè
  esattamente ciò che cb sostituisce. Le pressioni si contano per `FINESTRA_SCORCIATOIA`
  (1 s, in `src/tasti.js`) indipendentemente da cosa è già stato inoltrato: così la coppia
  lenta resta di cb, e Claude ne ha visto uno solo. Il prezzo, dichiarato nella schermata
  delle impostazioni, è che due interruzioni a meno di un secondo aprono l'albero.
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
- **Canc esce da tutto, da ogni schermata.** Esc risale di un passo (sotto), ed è giusto — ma
  da tre schermate di profondità servono tre Esc, e chi si è perso non sa nemmeno quanti. Il
  valore di Canc sta **tutto** nell'essere lo stesso ovunque: una schermata in cui non
  funzionasse basterebbe a non fidarsene più, quindi va aggiunto anche dove non aggiunge niente
  (l'albero e gli avvisi, dove Esc porta già a Claude). Il segnale viaggia come stringa `'esci'`
  fino al wrapper, che chiude l'overlay: ogni schermata nuova deve produrlo, e ogni chiamante
  deve distinguerlo da `'indietro'` — trattarlo come "non hai ancora scelto" riaprirebbe la
  schermata da cui si sta uscendo. **Va aggiunto anche a `navigazioneDa`**: senza, `azioniNavigazione`
  lo produce ma `.filter(Boolean)` lo scarta e il tasto muore in silenzio, con l'albero che non
  risponde (già successo, colto dalla prova `testCancEsceDaOgniSchermata`).
- **Nella coda togliere un prompt è `ctrl+canc`**, non `canc`: l'azione frequente cede il tasto
  semplice all'uscita, perché la coerenza fra schermate vale più della comodità in una sola.
  I modificatori nelle sequenze CSI stanno in un parametro in mezzo (`ESC[3;5~` = ctrl+canc, il
  numero è 1 + la somma dei bit, 4 = ctrl): vanno letti, o `shift+canc` toglierebbe per sbaglio.
- **Esc risale di un passo, non esce.** Una schermata aperta da un'altra deve poter tornare da
  dove è venuta: dall'elenco delle conversazioni si torna alle cartelle (un `while` in
  `cambiaConversazione` e in `bin/cb.js`), e dal navigatore delle cartelle si torna all'albero
  o all'avviso che lo ha aperto (`cambiaConversazione` restituisce `'indietro'`, e il
  chiamante rifà `mostraOverlay()`). Si ricomincia da capo invece di riusare la vista: nel
  frattempo la conversazione può essere cresciuta. Solo il primo passo di `--scegli` esce
  davvero, perché prima non c'è niente.
- **I selettori si aprono da `apriCartelle`/`apriConversazioni`**, non chiamando direttamente
  le funzioni importate: i moduli ESM sono in sola lettura e non si possono sostituire da
  fuori, quindi senza questi due metodi le prove non potrebbero verificare **in che ordine**
  vengono aperti — ed è l'ordine, non il singolo selettore, a dire se il ritorno indietro
  esiste. Stessa ragione di `creaProcesso`.
- **`c` e `p` portano tutt'e due al navigatore delle cartelle**, e da lì `r` alterna ripresa e
  avvio normale: è così che si comincia una conversazione nuova senza uscire da Claude. Prima
  `c` saltava dritto all'elenco delle conversazioni, che offre «parti da zero» **solo in una
  cartella vuota** (`conversazioni.js:488`) — quindi con conversazioni passate presenti non
  c'era alcun modo di cominciarne una. La schermata mostrata quando manca il transcript
  accetta gli stessi tasti: prima del primo prompt era un vicolo cieco, proprio nel momento in
  cui l'albero non c'è.
- **Seguire «il transcript più recente della cartella» e basta è sbagliato.** Nella cartella
  convivono i file della stessa famiglia — dopo un fork quello di partenza sta lì accanto — e
  due scritture possono cadere nello stesso millisecondo: la scelta diventa una monetina e cb
  salta sulla sessione sbagliata (prova `testUnParenteNonSiRubaLaSessione`, che falliva a
  giri alterni). La regola giusta è **si tiene il nostro file, a meno che non ne esista uno di
  un'altra sessione _strettamente_ più recente**: dopo un clear il nostro smette di crescere e
  il nuovo continua, mentre i parenti restano fermi. A parità di istante vince quello che cb
  sta già seguendo.
- **«Il più recente» non distingue un `/clear` da una seconda finestra.** Due finestre aperte
  sulla stessa cartella danno lo stesso quadro di un clear — il nostro file fermo perché non
  stiamo scrivendo, l'altro che cresce — e cb saltava sulla conversazione dell'altra finestra
  (misurato: due volte in una mattina nel `diagnosi.log` del 2026-08-06, una dopo 41 minuti di
  inattività). Poi bastava invio per biforcare la conversazione di qualcun altro. Le due
  situazioni si distinguono da **quando la conversazione è cominciata**: il timestamp del
  primo record (`inizioConversazione` in `src/percorsi.js`), non la data del filesystem.
  **`birthtime` su Windows mente**: cancellando e ricreando un file con lo stesso nome entro
  pochi secondi il sistema gli rimette la data vecchia (*file tunneling*, verificato) — e una
  sessione troncata da cb copia record vecchi in un file nuovo, quindi la data di nascita
  direbbe comunque la cosa sbagliata. Il filtro vale solo quando cb sa chi è: con
  `--resume`/`--continue` l'id lo sceglie Claude e la conversazione da trovare è per forza
  vecchia.
- **`/clear` fa nascere un file di sessione nuovo**, non taglia dentro a quello corrente: le
  due sessioni hanno radici diverse, quindi non sono parenti e nel selettore compaiono come
  due conversazioni, che è giusto. Ma **l'id in mano al wrapper resta quello di prima**:
  `trovaTranscript` deve rileggere il disco a ogni chiamata (`transcriptPiuRecente`, il più
  recente scritto dopo `avviatoIl`) e non fidarsi di `this.sessionId`. Agganciandosi una volta
  sola, l'albero mostrava la conversazione precedente il clear — e invio ci forkava sopra,
  ripristinando i file all'istante di un turno di un'altra conversazione. La prova è
  `testSeguelaSessioneDopoUnClear`, che impone le date con `utimesSync` perché due scritture
  possono cadere nello stesso millisecondo.
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
- **Il ripristino del codice non chiede niente a Claude: legge il suo archivio.** Claude non usa
  git — salva copie **integrali** in `~/.claude/file-history/<sessione>/<hash>@v<N>` e le annota
  nel transcript (`file-history-snapshot`, uno per prompt, e `file-history-delta`). Ogni copia è
  il contenuto **precedente** alla modifica che l'ha generata, quindi vale una regola sola:
  lo stato a T è la **prima copia con `backupTime ≥ T`**; nessuna copia dopo T = il file è già
  così; copia `null` = a T non esisteva. (Il vecchio `--rewind-files` voleva
  `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=1`, lanciava un processo e vedeva una sessione
  sola: è per questo che non lo usiamo più.)
- **Le versioni delle copie ripartono da `v1` in ogni sessione**: il nome di una copia identifica
  qualcosa solo insieme alla sua cartella. Le sessioni troncate copiano i record ma non le copie,
  quindi la stessa voce compare più volte e quella della troncata punta a una cartella che non
  esiste: `preferisciCopiePresenti` sceglie fra voci identiche quella che c'è davvero sul disco.
- **Nell'archivio di Claude non c'è mai lo stato finale di un file.** Prima di sovrascrivere o
  cancellare, cb copia nel proprio archivio (`~/.claude/cb/file-history/`): senza, un file
  cancellato da un ripristino non torna più indietro andando avanti.
- **Fuori dalla cartella di lavoro non si scrive.** Nell'archivio finisce ogni file toccato da
  Claude, profilo PowerShell e file di memoria compresi.
- L'ordine in `cambiaRamo` non è arbitrario: **chiudere Claude → riattivare il ramo →
  ripristinare i file → rilanciare**. Gli interventi su transcript e file devono essere gli
  ultimi, senza il processo vecchio che scrive sopra. Con «solo codice» il flusso si ferma al
  ripristino: la conversazione non cambia, quindi Claude non va riavviato.
- **I commit automatici sono un ripiego per file, non un ripristino d'albero.** L'hook scrive
  `messaggio: <uuid>` nel corpo del commit ed è quello l'aggancio con l'albero; `src/commit.js`
  risolve il punto (prima per uuid, poi per istante) e prende un file per volta con `git show`.
  Riportare indietro l'albero intero sovrascriverebbe anche ciò che il ripristino non doveva
  toccare.
- **Il ramo attivo è l'ultimo record messaggio del file** (`ultimoNodo`), non
  `last-prompt.leafUuid`: è da lì che il CLI ricostruisce la conversazione riprendendo in
  interattivo, e `last-prompt` resta spesso indietro (misurato: divergevano in 7 sessioni su
  12). `leafAttivo` resta però quello giusto per **scrivere**: la riattivazione di un ramo
  funziona appendendo un `last-prompt`, che è il campo che il CLI legge quando riprende in
  modalità non interattiva.
- **L'ordine in cui si assegnano le righe dell'albero decide se le linee si incrociano.** Un ramo
  scende lungo la colonna della sua forca, attraversando le righe che trova: i rami di una catena
  vanno quindi disegnati **in profondità** (subito sotto la catena da cui nascono) e **da destra
  a sinistra**, così ogni discesa passa a sinistra di ciò che è già disegnato, dove non c'è
  niente. È l'unico ordine in cui nessuna discesa incrocia un altro ramo — e rende corretta anche
  la scelta fra `┣` e `┗`, perché l'ultimo ramo di una forca è davvero il più in basso.
- **Le righe di codice cambiate non si calcolano**: stanno già nel transcript, in
  `toolUseResult.structuredPatch`. Un file creato da zero non ha diff (`type: 'create'`) e le sue
  righe contano tutte come aggiunte. Il totale mostrato è quello del **turno**, fino al prompt
  successivo: lo stesso confine di `fineDelTurno`.
- **`alberoPrompt` lavora solo su `parentUuid`**, mai su `nodo.figli`: quel campo lo popola
  `leggiTranscript` ma non chi costruisce un albero a mano, e dipenderne rende muto il conteggio
  senza dirlo (già successo, colto da una prova).
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
- **La legenda sta in fondo allo schermo in ogni schermata**, non subito sotto il contenuto:
  gli avvisi e gli elenchi hanno altezze diverse, e una legenda che sale e scende si legge
  peggio di una che sta sempre nello stesso posto. Si riempie l'altezza **esatta** e si unisce
  con `\r\n` senza a capo finale — una riga in più fa scorrere via l'intestazione. Il taglio
  del contenuto va fatto **prima** di aggiungere la legenda: tagliando la pagina finita
  sparirebbe proprio lei, cioè l'unica riga che dice come si esce.
- **Nel selettore delle conversazioni il pannello dell'albero ha altezza fissa**: gli alberi
  hanno altezze diverse, e un pannello che si adatta fa saltare separatore ed elenco a ogni
  freccia. Il riempimento è invisibile, il salto no.
- **Nessuna stringa visibile all'utente sta nel codice**: stanno tutte in `src/lingua.js`,
  che ne tiene due tabelle (`EN`, `IT`) e ne esporta una sola, `T`, scelta da `CB_LINGUA` o
  dal locale di sistema. Una stringa scritta altrove è una stringa non tradotta, che per
  metà degli utenti diventa la lingua sbagliata. `src/lingua.test.js` confronta le due
  tabelle fra loro: stesse voci, e varianti di legenda in ordine di lunghezza decrescente
  **dentro ogni lingua** — è quell'ordine, non il confronto fra le lingue, che rende
  corretto `primaCheEntra`.
- **Una sessione troncata si riconosce dagli uuid, non da un marchio.** Un transcript i cui uuid
  stanno **tutti** dentro un altro transcript della stessa cartella è una copia mai proseguita:
  un solo messaggio scritto dall'utente basta a dargli un uuid che nell'originale non c'è. Il
  confronto è per sottoinsieme **stretto**, o due file identici sarebbero l'uno il sottoinsieme
  dell'altro e verrebbero cancellati tutti e due. Non marcare i file alla creazione è ciò che
  rende il criterio valido anche sulle sessioni già accumulate, che un marchio non ce l'hanno.
- **La pulizia automatica scrive il proprio segnale prima di lavorare, non dopo**
  (`~/.claude/cb/ultima-pulizia`): se lancia — disco pieno, permesso negato — si riprova domani
  invece che a ogni singolo avvio. Gira **senza `await`** accanto alla sessione, perché legge
  tutti i transcript di tutti i progetti e Claude non deve aspettarla, e inghiotte ogni errore:
  una pulizia che fallisce non è un motivo per non far partire Claude. La soglia larga (60
  giorni contro i 7 del comando a mano) è ciò che rende accettabile il «senza chiedere».
- **La precedenza delle impostazioni è ambiente → file → predefinito** (`impostazione` in
  `src/impostazioni.js`). Il predefinito non si sceglie con `||`: uno `0` salvato è un valore
  vero — è così che si spegne la pulizia automatica — e con `||` cadeva sul predefinito insieme
  ai valori assenti. Vale «assente o stringa vuota», non «falso». L'ambiente per primo perché è la scelta più esplicita: chi scrive
  `CB_TASTO=f5 cb` per una volta non vuole che il file glielo ignori, e tutto ciò che il
  README documenta sulle variabili continua a valere. `impostazioni.js` **non importa
  `lingua.js`**: è `lingua.js` a leggere di lì quale lingua è stata scelta, e importarsi a
  vicenda sarebbe un ciclo.
- **Chi salva le impostazioni deve fondere, non sostituire.** `scriviImpostazioni` riscrive il
  file intero: passandogli i valori di una schermata che ne conosce solo alcune, tutto il resto
  spariva. La schermata del primo avvio cancellava così `profili`, `promptDaRimandare` e
  `giorniPulizia` — cioè tutto quello che si configura a mano — a ogni passaggio da
  `cb --impostazioni`, in silenzio e senza errori. Si salva con `aggiornaImpostazioni`, che
  legge-fonde-scrive; `scriviImpostazioni` resta solo per la sostituzione integrale.
- **Un flag nel profilo rende muta l'impostazione corrispondente.** `--tasto` vince sul file,
  ed è giusto — è la scelta più esplicita — ma lo snippet del README montava `--tasto f2`
  fisso, così chi sceglieva `esc esc` nella schermata continuava a vedere F2 e concludeva che
  il wizard fosse rotto (successo davvero, il 2026-08-01). Lo snippet ora non passa `--tasto`:
  la scorciatoia viene dalle impostazioni. Vale per ogni impostazione nuova — se ha un flag
  corrispondente, il profilo consigliato non deve passarlo.
- **Con l'overlay a schermo il tracciamento del mouse va spento.** Claude accende i modi
  `ESC[?1002h`/`?1006h` e simili; finché sono accesi il terminale manda movimenti e clic
  all'applicazione invece di selezionare, e dall'albero non si riesce a copiare niente (cb
  quegli eventi li scarta e basta). Quali siano accesi **non si indovina**: `osservaMouse`
  legge l'output del pty di passaggio e ne tiene lo stato, e alla chiusura si rimette
  esattamente quello — riaccendere un modo che Claude non aveva chiesto gli farebbe arrivare
  eventi che non si aspetta. L'output arriva a blocchi, quindi si conserva una coda di 9
  caratteri: una sequenza spezzata fra due letture andrebbe altrimenti persa.
- **Un tasto solo può produrre più azioni, e il ciclo deve fermarsi quando lo stato cambia.**
  Invio arriva come `\r\n` su molti terminali: `azioniTesto` ne ricava due `invio`. La prima
  chiude il campo di testo, la seconda cadeva su `stato.modifica === null` — `'invio'` moriva
  su `null.trim()`, `'carattere'` scriveva la stringa `"nullx"` dentro il percorso. Ogni ciclo
  che consuma le azioni di una lettura deve controllare lo stato **fra un'azione e l'altra**,
  non solo all'inizio: è lo stesso motivo per cui il ciclo di navigazione esce appena il campo
  si apre. Le prove sono `testUnInvioCheArrivaDoppioNonRompeNiente` e `testInvioDoppioDaiByte`.
- **Il percorso della cartella di lavoro si scrive, non si sceglie da un albero.** Serve
  `azioniTesto` e non `azioniTastiera`: quella mappa w/a/s/d sulle direzioni, e in un campo di
  testo servono come lettere. Serve anche `tasto.grezzo` e non `tasto.carattere`, che
  win32-input-mode consegna già in minuscolo: in un percorso `C:` non è `c:`.
- **Cambiare lingua a processo avviato non basta.** `T` si risolve all'import, e `vista.js`
  ne cattura `LEGENDA` e `VOCI_RIPRISTINO` in costanti: dopo la schermata del primo avvio,
  se la lingua scelta è diversa da `LINGUA`, `bin/cb.js` si rilancia con `spawnSync` — una
  volta sola nella vita, ed è l'unico modo perché la prima sessione non esca metà in una
  lingua e metà nell'altra.
- **Le azioni della tastiera sono stringhe, non oggetti**: `azioniNavigazione` produce
  `'giu'`, `'conferma'`, e ogni `applicaAzione` fa `switch (azione)`. Scrivendo
  `switch (azione.tipo)` la schermata non risponde a niente, e le prove unitarie che passano
  `{tipo:'giu'}` a mano non se ne accorgono: se ne accorge solo la prova col terminale finto.
  È già successo scrivendo `configura.js`.
- **Le prove girano con la lingua fissata** (`src/prove.js` impone `CB_LINGUA=it`): senza,
  confrontando stringhe a schermo passerebbero o fallirebbero a seconda del locale della
  macchina, cioè verdi qui e rosse in CI. Che l'inglese sia completo lo dice `lingua.test.js`,
  che non guarda lo schermo.
- **Un processo per file di prova.** `overlay.test.js` finisce con `process.exit(0)` — gli
  servono handle che restano aperti — e caricando tutto in un processo solo quella riga si
  porta via le prove che vengono dopo, uscendo 0: verde, con metà delle prove mai eseguite.
- **Gli import dinamici del wrapper stanno dentro il `try` che esce 78.** `wrapper.js`
  importa `node-pty` in cima: su una macchina dove il modulo nativo non è compilato è
  l'import stesso a lanciare, e fuori dal try quell'errore usciva 1 — cioè il ripiego su
  Claude mancava esattamente nel caso per cui esiste.
- L'eseguibile di Claude si cerca prima nei percorsi noti e poi nel `PATH`
  (`src/eseguibile.js`): i percorsi noti sono Windows, il `PATH` copre npm, homebrew e nvm
  altrove. Su Windows si cerca solo `claude.exe`, mai `claude`: quello è lo shim, che
  node-pty non lancia.
- **La coda ha due strade di consegna, e dentro cb vince il pty.** L'hook `Stop` può solo
  rispondere `{"decision":"block","reason":<testo>}`: Claude non si ferma e riceve il testo,
  ma **come motivo del blocco**, non come record `user` — nel transcript non c'è un prompt,
  quindi nell'albero non nasce un nodo e da lì non si riparte. Dentro cb il prompt lo scrive
  invece il pty (`consegnaCoda`), seguito da invio, cioè **come lo scriveresti tu**: diventa
  un record `user` vero e un nodo dell'albero. Le due strade non devono convivere o ogni
  prompt partirebbe due volte: cb mette `CB_CODA_PTY=1` nell'ambiente di Claude (`ambiente()`)
  e l'hook, che la eredita, esce subito. Fuori da cb la variabile non c'è e l'hook resta
  l'unica strada — è il motivo per cui l'hook si tiene lo stesso.
- **Quando Claude è fermo non si deduce dallo schermo, ma dal silenzio dell'output.** cb non
  parsa mai la TUI. Mentre Claude lavora l'indicatore si anima e i byte continuano ad
  arrivare; quando ha finito l'output si ferma. `rimandaConsegna` riarma il conto a ogni
  blocco di output **e a ogni tasto dell'utente**: il secondo serve perché iniettare mentre
  stai digitando mescolerebbe il prompt accodato a quello che stai scrivendo, e l'invio
  manderebbe il miscuglio. `QUIETE_CODA` (1500 ms) è più larga di `QUIETE_AVVIO` (600): lì si
  aspetta che compaia una barra di input, qui si decide se una risposta è finita.
- **Il primo controllo della coda parte anche senza output.** Se Claude è già fermo — o non
  scrive nulla dopo l'avvio — la quiete non arriverebbe mai da sola, e i prompt già in coda
  resterebbero ad aspettare un turno che non esiste. Per questo `rimandaConsegna()` viene
  chiamata anche subito dopo `creaProcesso` e alla chiusura della schermata della coda, dove
  si azzera anche `ultimoTasto`: i tasti battuti dentro cb non sono «l'utente sta scrivendo a
  Claude».
- **La coda è legata all'id di sessione, quindi va spostata a mano.** In cb quell'id cambia di
  continuo — `/clear` fa nascere un file nuovo, ogni cambio ramo crea una sessione troncata — e
  i prompt appesi alla sessione vecchia non riceverebbero più hook, cioè sparirebbero in
  silenzio. Per questo `sessionId` **non si assegna mai direttamente**: si passa da
  `cambiaSessione`, che chiama `trasferisci` di `src/coda.js`. Sono tre i punti che lo fanno
  (`avviaClaude` e i due rami di `trovaTranscript`), ed è l'unico modo di non doverseli
  ricordare uno per uno.
- **Ogni operazione sulla coda rilegge il file prima di scriverlo.** Mentre la schermata è
  aperta Claude sta lavorando — è il motivo per cui esiste — e a fine turno l'hook toglie il
  primo prompt. Tenendo l'elenco in memoria, il primo carattere digitato dopo quella consegna
  lo avrebbe rimesso in coda già consegnato.
- **In PowerShell il `@()` va attorno alla pipeline, non al suo ingresso.** Un `Where-Object`
  che lascia passare un elemento solo restituisce **quell'elemento**, non un array da uno, e
  `$prompt[0]` su una stringa dà il primo *carattere*. Colto eseguendo l'hook a mano: con un
  solo prompt in coda consegnava `"s"` invece di `"secondo prompt"`. Ogni hook che filtra una
  lista va provato **anche nel caso da un elemento**.
- **L'hook della coda riscrive il file prima di consegnare, non dopo.** Se la scrittura fallisce
  — disco pieno, permesso negato — il prompt non parte, invece di ripartire a ogni turno per
  sempre. Un prompt perso si riscrive, un ciclo infinito no.
- **Nessuna schermata accende un tracciamento del mouse.** Serviva alla rotella (`?1000`+`?1006`),
  ma finché è acceso il terminale manda i clic all'applicazione invece di selezionare, e copiare
  richiedeva shift — un aggiramento standard, ma pur sempre un aggiramento. All'ingresso di ogni
  schermata si spengono **tutti** i modi (`spegniMouse`), all'uscita si rimettono esattamente
  quelli che Claude aveva chiesto (`osservaMouse` continua a seguirli). Prezzo dichiarato: l'albero
  si scorre solo con le frecce. Vale anche per `conversazioni.js`, che se li accendeva da sé.
- **Un tasto che non produce azioni non deve ridisegnare.** Ogni ridisegno ripulisce lo schermo, e
  con lui se ne va la selezione fatta col mouse: Ctrl premuto da solo **arriva** come evento
  (`ESC[17;29;0;1;8;1_`) ma non produce niente, e ridisegnando lì la selezione spariva proprio
  mentre la si stava per copiare. Ogni ciclo dei tasti esce subito se `azioni.length === 0`.
- **`esc indietro` e `canc esci`, con quelle parole, in ogni variante di ogni legenda.** Uniti in
  `esc/canc esci` **solo** dove fanno davvero la stessa cosa (albero e avvisi, dove dietro c'è
  Claude in entrambi i casi). Nominarli col posto dove portano — «esc albero», «esc elenco» —
  costringe a rileggere ogni volta un tasto che è sempre lo stesso. E un tasto scritto solo nella
  variante più lunga è un tasto che non sai di avere: le varianti accorciate si tagliano altrove.
- **La legenda si colora in ogni schermata** (`coloraTasti`, esportata da `vista.js`): colorarla
  solo nell'albero vorrebbe dire che i tasti si cercano con l'occhio in un posto e si leggono come
  prosa in tutti gli altri.
- **Prima di scrivere nella barra di Claude la si svuota** (`ctrl+u`, `SVUOTA_BARRA`), in una
  scrittura separata dal testo: quello che c'era va **sostituito**, non allungato — un abbozzo
  fermo da minuti nessuna quiete lo rivela. Non `ctrl+c`, che svuota ma la **seconda** volta esce.
  Verificato su una sessione vera.
- **Nella coda `stop` e `salta` sono regole diverse apposta**: `salta` scavalca un prompt solo,
  `stop` è una barriera e ferma anche tutti quelli dopo. `indiceProssimo` è l'unica regola di
  scelta, e la usano tutt'e due le strade di consegna (pty e hook): scriverla due volte
  significherebbe che dentro e fuori da cb la coda si comporta diversamente.
- **Un formato su disco che cambia si accetta, non si migra.** Le voci della coda sono passate da
  stringa a oggetto e le note accettano tutt'e due le forme (`normalizza`): una coda o una nota in
  attesa è roba dell'utente, e una migrazione che sbaglia la perde. Il prezzo è una funzione di
  normalizzazione in lettura, che costa molto meno.
- **Le note stanno alla cartella come la coda sta alla sessione.** È il motivo per cui esistono:
  una nota serve proprio quando la conversazione in cui l'hai scritta è finita. La chiave è lo
  slug della cartella (`slugProgetto`), lo stesso che usa Claude per i transcript, così l'archivio
  si legge a occhio.
- **Nelle note il cursore parte sempre dal titolo**, anche su una nota che ha già tutto: è l'unico
  dei due campi da cui si raggiunge l'altro — dal titolo si scende al corpo con un invio, dal
  corpo non si risale (invio lì salva). Partendo dal corpo, il titolo di una nota vecchia
  diventerebbe impossibile da correggere.
- **Cancellando più note si toglie dall'indice più alto al più basso**, o togliendo la prima tutte
  le altre scalano di uno e si cancella quella sbagliata. Gli indici segnati si azzerano appena il
  numero di note cambia: resterebbero su note diverse da quelle scelte.
- **`apriNote`/`apriCoda` si aprono da un metodo del wrapper**, non chiamando l'import diretto:
  stessa ragione di `apriCartelle` — i moduli ESM sono in sola lettura, e senza quel metodo le
  prove non potrebbero verificare *cosa arriva al pty* senza aprire una schermata che si prende lo
  stdin.
- Le prove stanno in `src/transcript.test.js`, `src/tasti.test.js`, `src/titolo.test.js`,
  `src/vista.test.js`, `src/wrapper.test.js`, `src/overlay.test.js`, `src/cartelle.test.js`,
  `src/conversazioni.test.js` e `src/pulizia.test.js`, con `assert`. Quelle che toccano
  impostazioni o archivi lavorano su cartelle temporanee e con `CB_IMPOSTAZIONI` puntato altrove:
  una prova della pulizia che parte dalla cwd cancellerebbe i `refs/cb/*` veri del repo. I cicli interattivi dei selettori si provano con
  un terminale finto (un `EventEmitter` con `write`/`resume`/`pause`), senza TTY.
  Niente framework. Nel wrapper i test usano un pty finto: la logica dei tasti è
  isolabile, l'interazione con la TUI vera no. `creaProcesso` è estratto apposta perché i test
  possano verificare **cosa** viene chiesto a Claude senza lanciarlo.

## 8. Riferimenti docs

`docs/` **non è nel repo pubblico** (è in `.gitignore` dalla pubblicazione su GitHub): è il
quaderno di lavoro, resta solo sul disco. Quello che serve a un utente sta nei due README.

- `docs/STATO.md` — stato corrente, problemi aperti, decisioni, backlog
- `docs/brief.md` — spec, vincoli scoperti e loro riscontro
- `docs/architettura.md` — stack, componenti, flussi, modello dei dati
- `docs/bug-risolti.md` — registro dei bug con causa e fix (grep-abile)
- `docs/procedure.md` — runbook delle procedure multi-passo
- `docs/storico-sessioni.md` — archivio delle sessioni
- `README.md` — uso e installazione, in inglese (è la vetrina del repo)
- `README.it.md` — la stessa cosa in italiano; le due vanno tenute allineate
