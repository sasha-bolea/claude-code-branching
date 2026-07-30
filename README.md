# cb

Branching per conversazioni Claude Code: albero dei rami, catalogo globale, ripresa da
qualsiasi messaggio — compresi i rami che hai abbandonato con un ripristino.

## Il problema

Claude Code ha "restore code and conversation" (Esc Esc), ma è un undo a senso unico:
una volta ripristinato, l'interfaccia non offre più modo di tornare ai prompt e alle
risposte che ti sei lasciato indietro.

I dati però ci sono tutti: i transcript sono **append-only**, il ramo abbandonato resta
fisicamente nel file. Manca solo chi lo mostra e chi ti ci fa ripartire.

## Uso

Su questa macchina è già agganciato al comando `claude` (vedi *Integrazione* sotto): scrivi
`claude`, scegli la cartella col selettore, e premi **Ctrl+G** quando vuoi l'albero dei rami.

Standalone, `cb` si lancia al posto di `claude`. Lavori normalmente; quando premi la
scorciatoia compare l'albero. Scegli un numero e **conversazione e file** tornano a quel
punto, in un ramo nuovo, senza uscire dalla sessione.

⚠️ Il ripristino dei file sovrascrive il lavoro non salvato successivo a quel messaggio.
Con `--senza-file` torna indietro solo la conversazione.

```
cb                      Claude avvolto: Esc Esc apre l'albero
cb --tasto ctrl+g       altra scorciatoia ("ctrl+g", "f2", "esc esc", "ctrl+shift+b")
cb --senza-file         cambiando ramo NON ripristina i file, solo la conversazione
cb --tasti              stampa i byte dei tasti premuti (diagnosi)
cb ls [filtro]          elenca le sessioni di tutti i progetti
cb tree <sessione>      albero dei rami di una sessione
cb open <sessione> [n]  riprendi da fuori, opzionalmente dal punto n
cb pick                 catalogo interattivo da fuori
```

Per fissare la scorciatoia una volta per tutte: `setx CB_TASTO "ctrl+g"`.

Un tasto singolo (`ctrl+g`, `f2`) scatta subito. Una scorciatoia ripetuta (`esc esc`)
costa 300 ms di ritardo sulla prima pressione, il tempo di capire se ne arriva una seconda.

`<sessione>` accetta id completo, prefisso di id, o percorso del `.jsonl`.

Nell'albero: numero + invio riparte da quel punto, invio torna a Claude.

Esempio di albero:

```
 22  └─ ● 07-24 15:51  l'app è diventata lentissima ⑂3
 23     ├─ ○ 07-24 15:57  molto più fluido, ma ancora troppo scattoso
 24     │  └─ ○ 07-24 17:26  Ultraplan terminated…
 27     ├─ ○ 07-29 10:17  molto più fluido, ma ancora troppo scattoso
 28     └─ ● 07-29 10:18  era diventato molto più fluido ma ho mandato un altro prompt…
```

`●` ramo attivo · `○` ramo in disparte · `⑂n` biforcazione con n rami.
Scegli un numero e riparti da lì: nasce un ramo nuovo, quello di prima resta.

## Come funziona

Quattro meccanismi. I tre che toccano i dati sono tutti additivi: niente viene cancellato.

0. **Claude gira dentro uno pseudo-terminale** (`node-pty`). `cb` sta tra la tastiera e
   Claude: inoltra tutto tranne la scorciatoia dell'albero. Non legge né interpreta mai
   ciò che Claude disegna — solo il transcript su disco — così un aggiornamento del CLI
   non lo rompe.

   I tasti vanno decodificati, non confrontati byte a byte: Claude attiva
   **win32-input-mode** (invia `ESC[?9001h`), quindi su Windows ogni tasto arriva come
   `ESC[Vk;Sc;Uc;Kd;Cs;Rc_` — Esc è `ESC[27;1;27;1;32;1_`, e arrivano anche gli eventi di
   rilascio. `src/tasti.js` gestisce le tre codifiche possibili (byte grezzi, kitty
   `ESC[27u`, win32) e normalizza tutto in un descrittore di tasto.

1. **L'albero si legge dai `.jsonl`.** Ogni record ha `parentUuid`: i rami sono già lì.
   Le forche tecniche (retry di tool) vengono filtrate, restano solo i ripristini veri.

2. **Il ramo nuovo è una sessione che cb scrive.** In modalità interattiva il CLI ignora
   `--resume-session-at` (e anche `last-prompt.leafUuid`): ricostruisce la conversazione
   dall'ultimo record messaggio del file, quindi scegliendo un punto intermedio ricomparivano
   sempre i turni successivi. Con `-p` invece taglia — l'help lo dice, *"use with --resume in
   print mode"*.

   `cb` scrive quindi un file di sessione nuovo con solo la catena fino alla **fine del turno
   scelto** (il prompt e la sua risposta), e lo riprende con `--resume`. Il file di partenza
   non viene toccato: i turni successivi restano nell'albero come ramo in disparte.

3. **Cambiando ramo i file tornano allo stato di quel messaggio**, automaticamente.
   Claude ha il ripristino (`--rewind-files <uuid-messaggio-utente>`) ma da solo si limita
   a suggerire il comando: cb lo esegue. Due dettagli scoperti sul campo:
   - `--rewind-files` gira in modalità non interattiva, e su quel percorso Claude abilita
     lo storico dei file **solo** se trova `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=1`
     nell'ambiente. Senza, risponde `File rewinding is not enabled`. cb la imposta.
   - vale lo stesso vincolo di `--resume-session-at`: il messaggio deve stare nella catena
     attiva, quindi il ripristino va fatto **dopo** la riattivazione del ramo (punto 4).

   `No file checkpoint found` non è un guasto: significa che da quel messaggio i file non
   sono stati toccati, o che il checkpoint è scaduto. Con `--senza-file` il ripristino non
   viene fatto e torna indietro solo la conversazione.

4. **L'albero unisce tutta la famiglia di sessioni.** `--fork-session` crea un file nuovo
   che copia la storia **solo fino al punto di fork**: i rami abbandonati restano nel file
   di partenza e, guardando la sola sessione corrente, diventano invisibili. Riscontro su
   dati reali: sessione padre `ciao → come va? → come stai?`, figlia `ciao → buuu`,
   biforcazioni viste dalla figlia: **zero**.

   Il fork però copia i record **mantenendo gli stessi uuid** (87% di sovrapposizione
   misurata), e le sessioni parenti condividono lo stesso uuid di radice. `cb` raggruppa
   quindi i transcript per radice (`sessioniDellaFamiglia`, che legge solo la testa dei
   file) e unisce i nodi per uuid: l'albero completo riemerge. Ogni nodo si porta dietro le
   `origini`, così un ramo del padre viene ripreso dalla sessione giusta e la riattivazione
   viene scritta nel file giusto.

5. **I rami abbandonati vengono riattivati appendendo un `last-prompt`.**
   `--resume-session-at` cerca il messaggio nella catena attiva, che il CLI ricostruisce
   dall'ultimo `last-prompt.leafUuid`. Un nodo su un ramo abbandonato non è in quella
   catena e il CLI risponde `No message found`. Appendendo un `last-prompt` che punta
   alla foglia del ramo voluto, quel ramo torna percorribile. Vedi `src/attiva.js`.

## Integrazione col comando `claude`

La funzione `claude` nel profilo PowerShell (`$PROFILE`) faceva già due cose: selettore
della cartella di lavoro e blocco della sospensione. Ora lancia Claude **dentro cb**,
lasciando il resto invariato:

```powershell
& node "…\cb\bin\cb.js" --tasto ctrl+g -- --dangerously-skip-permissions @args
if ($LASTEXITCODE -eq 78) { & $claudeShim --dangerously-skip-permissions @args }
```

Tre accorgimenti perché non possa peggiorare le cose:

- **Ripiego automatico**: se cb non parte esce con **78**, e la funzione rilancia Claude
  diretto. Un'uscita normale di Claude non usa quel codice, quindi non viene mai rilanciato
  per sbaglio. Se node non è installato cb non viene nemmeno tentato.
- **Usi non interattivi** (`-p`, `--print`, stdin non TTY): niente pseudo-terminale, cb
  esegue Claude direttamente. Altrimenti il pty sporcherebbe l'output negli script.
- **Argomenti**: tutto quello che segue `--` va a Claude, non a cb. Così `-r`, i prompt e
  i flag non collidono coi comandi di cb.

Con `--resume`/`--continue` l'id sessione lo sceglie Claude: cb non impone `--session-id` e
scopre la sessione dal transcript più recente della cartella.

Per cambiare scorciatoia basta modificare `--tasto ctrl+g` nel profilo.

## Commit automatici (opzionale)

`hooks/cb-commit.ps1` è un hook `Stop`: a ogni fine turno che ha modificato file, salva
lo stato del codice su un ref nascosto `refs/cb/<sessione>/auto`.

- Non compare in `git log`, `git branch`, `git tag`, `git status`
- Non tocca il branch su cui lavori né l'area di staging (usa un index temporaneo)
- Recupero: `git show refs/cb/<sessione>/auto~2:percorso/file.js`

Installazione: aggiungi in `~/.claude/settings.json` sotto `hooks.Stop` (in coda agli
hook esistenti, senza sostituirli):

```json
{ "type": "command", "command": "pwsh -NoProfile -File C:/Users/sasha/Documents/REPOSITORY/personale/cb/hooks/cb-commit.ps1" }
```

## Test

```
npm test
```

## Limiti noti

- Ogni cambio di ramo **riavvia il processo Claude**: non si può ricaricare una
  conversazione in un processo già avviato. Il wrapper lo rende invisibile, non lo evita —
  vedi il tempo di avvio della TUI a ogni salto.
- Il ripristino dei file usa i checkpoint nativi, che sono legati al session-id e hanno una
  retention: su rami vecchi può rispondere `No file checkpoint found`. Per uno storico che
  non scade servono i commit automatici (sotto).
- Rubare `Esc Esc` costa 300 ms di ritardo su un Esc singolo (l'interruzione), e sostituisce
  il menu di ripristino nativo. Con una scorciatoia a tasto singolo (`--tasto ctrl+g`) il
  ritardo sparisce e il menu nativo resta disponibile.
- Il salto è possibile solo dopo il primo turno: prima non esiste un transcript da leggere.
- `--resume-session-at` non è documentato: può cambiare a un aggiornamento del CLI.
- La parentela tra sessioni forkate vive nei campi `forkParentSessionId` scritti dal CLI;
  `cb` non li aggrega ancora in una vista cross-sessione.
- Nessuna interfaccia a frecce: la selezione è per numero.
- `node-pty` richiede il binario nativo di Claude, non lo shim npm. `cb` lo cerca da sé;
  se l'installazione non è standard, imposta `CB_CLAUDE_EXE`.
