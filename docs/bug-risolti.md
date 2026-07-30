# Bug risolti

Registro append-only. Ogni voce: data, sintomo, causa, fix, file coinvolti.
Nota ricorrente: quasi tutti i bug di questo progetto nascono dal dare per scontato
un comportamento del CLI di Claude Code invece di misurarlo.

---

## 2026-07-30 — Punto intermedio: ripartiva sempre dalla fine del ramo

**Sintomo.** Scegliendo un prompt in mezzo a un ramo, la conversazione ripartiva con tutti
i turni successivi già presenti.

**Causa.** In modalità **interattiva** il CLI ignora sia `--resume-session-at` sia
`last-prompt.leafUuid`: ricostruisce la conversazione dall'ultimo record messaggio presente
nel file. Con `-p` invece tronca (l'help lo dice: *"use with --resume in print mode"*).
Verificato catturando lo schermo di sessioni vere in un pty: `-p` → turno successivo assente,
interattivo → sempre presente, anche riscrivendo `last-prompt`.
Secondo concorso: `attivaRamoDi` non appendeva nulla quando il nodo era già nella catena
attiva, quindi in quel caso non troncava comunque niente.

**Fix.** Il taglio lo fa cb: `creaSessioneTroncata` scrive un **file di sessione nuovo** con
solo la catena fino alla fine del turno scelto, e lo si riprende con `--resume <nuovo>`
(niente `--fork-session`, niente `--session-id`). Il file di partenza non viene toccato:
i turni successivi restano ripescabili come ramo in disparte.
`attivaRamoDi` confronta ora `leafAttivo` con la **fine del turno**, non con la
raggiungibilità del nodo.

**File.** `src/ramo.js` (nuovo), `src/attiva.js`, `src/wrapper.js`

---

## 2026-07-30 — Titolo della tab sostituito dal percorso di claude.exe

**Sintomo.** Dopo ogni ripristino il titolo della tab diventava
`C:\...\claude-code\bin\claude.exe`.

**Causa.** Non è Claude: è **ConPTY**, che a ogni creazione di processo emette
`ESC]0;<percorso eseguibile>BEL`. Per questo `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` non
bastava, e per questo si ripresentava a ogni cambio ramo (il processo è nuovo).

**Fix.** `senzaTitolo` filtra dall'output del pty gli OSC `0/1/2`, e il titolo viene
riaffermato a ogni avvio. Gli altri OSC (es. `8`, link) e tutte le `ESC[` passano intatti,
o la TUI si rompe.

**File.** `src/titolo.js` (nuovo), `src/wrapper.js`

---

## 2026-07-30 — Secondo cambio ramo: "No conversation found with session ID"

**Sintomo.** Il primo ripristino funzionava, il secondo no.

**Causa.** `unisciAlberi` veniva chiamato solo con più di una sessione nella famiglia. Con
un file solo i nodi non avevano le `origini`, e il ripiego usava `this.sessionId` — che dopo
il primo fork è una sessione **senza transcript**.

**Fix.** Unione sempre, anche con una sola sessione. Il ripiego deriva l'id dal **file** da
cui l'albero è stato letto (`sessioneDaPercorso`), non dallo stato del wrapper.

**File.** `src/wrapper.js`, `src/transcript.js`, `src/percorsi.js`

---

## 2026-07-30 — La riattivazione del ramo veniva annullata (corsa)

**Sintomo.** `--rewind-files` rispondeva `requires a user message UUID, but ... is not a user
message in this session`, pur avendo appena riattivato quel ramo.

**Causa.** `kill()` è asincrono e Claude, uscendo, appende un ultimo `last-prompt`. Arrivava
**dopo** il nostro e riportava il ramo attivo su quello vecchio. Visibile in coda al file:
due `last-prompt` consecutivi, il secondo di Claude.

**Fix.** `chiudiProcesso` attende l'uscita effettiva (rete di sicurezza a 5 s), poi
`riattivaConVerifica` **verifica** che `leafAttivo` sia quello atteso e riprova (3 tentativi).

**File.** `src/wrapper.js`

---

## 2026-07-30 — Warning "no stdin data received in 3s" a ogni ripristino

**Sintomo.** Il messaggio compariva in mezzo all'esito del ripristino file.

**Causa.** `execFile` non garantisce la chiusura di stdin; Claude aspettava dati per 3 s.

**Fix.** `spawn` con `stdio: ['ignore','pipe','pipe']`.

**File.** `src/wrapper.js`

---

## 2026-07-30 — L'albero spariva dopo un cambio ramo

**Sintomo.** Subito dopo un ripristino, Ctrl+G diceva *«questa sessione non ha ancora un
transcript su disco»*.

**Causa.** Claude scrive il file di una sessione forkata solo al primo messaggio.

**Fix.** `percorsoOrigine` tiene il transcript di provenienza come ripiego finché il nuovo
non esiste; `leafAttivo` viene sovrascritto con `uuidRipreso`, perché quello del file di
provenienza è il ramo dell'altra sessione. (Con `creaSessioneTroncata` il file esiste subito,
ma il ripiego resta utile per l'avvio con `-r`/`--continue`.)

**File.** `src/wrapper.js`, `src/percorsi.js`

---

## 2026-07-30 — I rami precedenti a un fork diventavano invisibili

**Sintomo.** Dopo un ripristino il ramo lasciato indietro non compariva più nell'albero.

**Causa.** `--fork-session` crea un file nuovo che copia la storia **solo fino al punto di
fork**: i rami abbandonati restano nel file di partenza. cb leggeva un solo file.
Riscontro reale: padre `ciao → come va? → come stai?`, figlia `ciao → buuu`, biforcazioni
viste dalla figlia: **zero**.

**Fix.** Il fork copia i record **mantenendo gli stessi uuid** (87% di sovrapposizione
misurata) e le sessioni parenti condividono l'uuid di radice. `sessioniDellaFamiglia`
raggruppa i transcript per radice (legge solo la testa dei file), `unisciAlberi` fonde per
uuid. Ogni nodo porta le `origini`, così si riparte dalla sessione giusta e la riattivazione
si scrive nel file giusto.

**File.** `src/percorsi.js`, `src/transcript.js`, `src/wrapper.js`

---

## 2026-07-30 — L'overlay si apriva e chiudeva subito (sfarfallio)

**Sintomo.** Premendo Ctrl+G lo schermo tremava e non appariva nulla.

**Causa.** `leggiNumero` trattava qualsiasi byte `0x1b` come "annulla". In win32-input-mode
**ogni** evento tastiera comincia con `0x1b`, incluso il rilascio del tasto appena premuto:
l'overlay si auto-annullava. Le sequenze del mouse, piene di cifre, iniettavano inoltre le
proprie coordinate come numero digitato.

**Fix.** `azioniTastiera` traduce i byte in azioni (cifra/invio/cancella/annulla), scartando
gli eventi di rilascio (`Kd=0`), le sequenze del mouse e le frecce.

**File.** `src/tasti.js`, `src/wrapper.js`

---

## 2026-07-30 — La scorciatoia non veniva riconosciuta (codifica dei tasti)

**Sintomo.** Ctrl+G non faceva nulla; Esc Esc apriva il menu nativo di Claude.

**Causa, in due strati.**
1. Premendo Esc Esc velocemente i due byte arrivano in **una sola lettura** (`[0x1b, 0x1b]`);
   il codice cercava `dati.length === 1` e li inoltrava entrambi a Claude.
2. I tasti non arrivano come byte grezzi: Claude abilita **win32-input-mode**
   (`ESC[?9001h`), quindi ogni tasto è `ESC[Vk;Sc;Uc;Kd;Cs;Rc_` — Esc premuto è
   `ESC[27;1;27;1;32;1_`. Si cercava `0x1b`, che non arriva mai.

**Fix.** `tokenizza` divide la lettura in token riconoscendo le tre codifiche (byte grezzi,
kitty `ESC[27u`, win32), `contaInTesta` conta le pressioni della scorciatoia indipendentemente
da come sono raggruppate. Scorciatoia configurabile (`analizzaScorciatoia`).

**File.** `src/tasti.js` (nuovo), `src/wrapper.js`

---

## 2026-07-30 — I prompt con spazi venivano troncati

**Sintomo.** `-p "rispondi solo: X"` arrivava a Claude come `rispondi`.

**Causa.** `spawn` con `shell: true` e argomenti separati: la shell li riconcatena e li
rispezza sugli spazi.

**Fix.** Eseguibile risolto da `trovaEseguibileClaude()`, senza shell. Via anche il warning
di sicurezza di Node.

**File.** `src/lancia.js`

---

## 2026-07-30 — `--rewind-files`: "File rewinding is not enabled"

**Sintomo.** Il ripristino dei file non partiva.

**Causa.** Nel binario il gate è `T1()`: in modalità non interattiva (`yn()`) lo storico dei
file è abilitato **solo** dalla variabile `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING`.
Verificato per differenza: senza variabile quell'errore, con variabile passa al successivo
(`No file checkpoint found`).

**Fix.** La variabile viene impostata nell'ambiente del processo di ripristino.
`No file checkpoint found` non è trattato come guasto: significa che da quel messaggio i file
non erano stati toccati, o che il checkpoint è scaduto.

**File.** `src/wrapper.js`

---

## 2026-07-29 — node-pty: "Cannot create process, error code: 2"

**Sintomo.** Il wrapper non riusciva ad avviare Claude.

**Causa.** node-pty non può lanciare gli shim npm (`claude.ps1`/`.cmd`): serve l'eseguibile
nativo.

**Fix.** `trovaEseguibileClaude()` cerca `claude.exe` nei percorsi noti, con
`CB_CLAUDE_EXE` come override.

**File.** `src/eseguibile.js` (nuovo)

---

## 2026-07-29 — Append su transcript senza newline finale corrompeva l'ultima riga

**Sintomo.** Trovato da un test, non a runtime.

**Causa.** Appendere a un file che non termina con `\n` incolla il nuovo record in coda
all'ultima riga, rendendo illeggibili entrambi.

**Fix.** `terminaConACapo` legge l'ultimo byte e antepone `\n` se serve.

**File.** `src/attiva.js`

---

## 2026-07-30 — (test) Le prove si contaminavano fra loro

**Sintomo.** `testDueCambiRamoDiFila` falliva con un uuid appartenente a un'altra prova.

**Causa.** I transcript di prova condividono l'uuid di radice: i file residui venivano
raccolti come sessioni della stessa famiglia, falsando l'albero.

**Fix.** `pulisciCartella()` svuota la cartella progetto finta prima di ogni prova.
Reso realistico anche il pty finto (notifica l'uscita): la suite passava da 44 s a 9 s,
perché prima aspettava le reti di sicurezza.

**File.** `src/overlay.test.js`

---

## 2026-07-30 — Il cursore dell'albero partiva su un prompt vecchio

**Sintomo.** Aprendo l'albero, il punto selezionato non era quello da cui si era premuta la
scorciatoia ma uno di qualche turno prima. Anche i colori sbagliavano: i turni successivi
erano disegnati come ramo in disparte.

**Causa.** Il ramo attivo si ricavava da `last-prompt.leafUuid`, che Claude aggiorna a
intermittenza. In interattivo il CLI ricostruisce invece dall'**ultimo record messaggio del
file**. Misurato su 12 sessioni vere: i due valori divergevano in **7**.

**Fix.** `leggiTranscript` restituisce `ultimoNodo`; `uuidRamoAttivo` parte da quello e ripiega
su `leafAttivo` solo se non è nell'albero (file troncato, record filtrati). Cursore e colori
derivano entrambi da qui, quindi si sistemano insieme. Nel caso fork va sovrascritto anche
`ultimoNodo`, non solo `leafAttivo`: l'ultimo record del file di provenienza sta sul ramo
lasciato.

**File.** `src/transcript.js`, `src/albero.js`, `src/wrapper.js`

---

## 2026-07-30 — Dopo un ripristino riappariva l'elenco delle conversazioni

**Sintomo.** Avviando con `claude -r`, scegliendo una sessione e poi ripristinando un punto
qualsiasi, invece del ramo ricompariva il selettore delle conversazioni della cartella.

**Causa.** `avviaClaude` riaccodava `argomentiExtra` a **ogni** rilancio. Con `-r` fra gli
argomenti dell'utente, dopo un cambio ramo il comando diventava
`--resume <ramo> … -r`: due richieste di ripresa, la seconda **senza id**, quindi Claude
riapriva il selettore. Non c'entrava il navigatore di cartelle del profilo.

**Fix.** `senzaRipresa()` toglie i flag di ripresa dagli argomenti dell'utente, ma solo al
rilancio dopo un cambio ramo — al primo avvio `-r` deve passare. Toglie anche l'id che segue
il flag, che altrimenti resterebbe sciolto e Claude lo prenderebbe per un prompt. Estratto
`creaProcesso()` per poter verificare nei test *cosa* viene chiesto a Claude: prima non era
verificabile, ed è il motivo per cui il bug è passato.

**File.** `src/wrapper.js`, `src/wrapper.test.js`

---

## 2026-07-30 — L'overlay non seguiva il ridimensionamento della finestra

**Sintomo.** Ridimensionando il terminale con l'albero aperto, il disegno restava con le
vecchie dimensioni finché non si premeva un tasto.

**Causa.** Il ciclo dell'overlay ridisegnava solo dopo un tasto; il gestore di `resize`
avvisava il pty di Claude ma non toccava l'overlay.

**Fix.** `ridimensiona()` avvisa sempre Claude (al ritorno deve conoscere le misure nuove) e
ridisegna l'overlay se aperto, tramite `this.ridisegnaOverlay` — riregistrata a ogni giro del
ciclo perché cattura la selezione corrente. Ridisegno ritardato di 80 ms: trascinando il bordo
gli eventi arrivano a decine al secondo. Alla chiusura il riferimento va azzerato e il timer
annullato, o l'albero verrebbe scritto sopra lo schermo di Claude.

Possibile solo perché `componiVista` non dipende più dalle dimensioni del terminale.

**File.** `src/wrapper.js`

---

## 2026-07-30 — Legenda e barra dei tasti sfondavano i terminali stretti

**Sintomo.** Trovato da un test nuovo, non segnalato. Sotto le ~115 colonne le due righe di
intestazione andavano a capo, e il capo sfasava tutto il disegno sotto.

**Causa.** Erano stringhe di lunghezza fissa (~70 e ~110 caratteri), scritte senza guardare la
larghezza disponibile.

**Fix.** Due livelli. `primaCheEntra` sceglie fra varianti in ordine di ricchezza (una legenda
o una barra accorciata si legge meglio di una troncata). Sopra, `tagliaVisibile` passa su tutte
le righe alla fine come rete di sicurezza: conta solo i caratteri visibili ignorando le
sequenze ANSI, lavora per punti di codice (un'emoji in un prompt non viene spezzata a metà) e
richiude il colore se il taglio cade dentro un tratto colorato.

**File.** `src/vista.js`

---

## 2026-07-30 — Albero disegnato tutto a cerchi vuoti

**Sintomo.** Trovato da un test durante il lavoro sui colori: `⬤◯◯◯⬤` invece di `⬤━━━⬤`.

**Causa.** Semplificando la colorazione era sparita la guardia su `cella.uuid`. I raccordi
hanno `uuid` nullo, quindi con `selezione` a `null` il confronto `cella.uuid === selezione`
era vero anche per loro, e venivano disegnati come cursore.

**Fix.** Ripristinata la guardia, con un commento che spiega perché non è ridondante.

**File.** `src/vista.js`
