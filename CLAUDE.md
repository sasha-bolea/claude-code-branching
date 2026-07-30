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
| `src/albero.js` | Albero collassato dei soli prompt utente, rendering ASCII |
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
node src/verifica-reale.js [file] verifica il parser su una sessione vera
node bin/cb.js ls                 catalogo globale
node bin/cb.js tree <sessione>    albero dei rami
```

Installazione dell'hook dei commit: vedi README, sezione "Commit automatici".

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
- Le prove stanno in `src/transcript.test.js` e `src/wrapper.test.js`, con `assert`.
  Niente framework. Nel wrapper i test usano un pty finto: la logica dei tasti è
  isolabile, l'interazione con la TUI vera no.

## 8. Riferimenti docs

- `docs/brief.md` — spec, vincoli scoperti e loro riscontro
- `README.md` — uso e installazione
