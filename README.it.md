# cb

*[English](README.md)*

Branching per conversazioni Claude Code: albero dei rami, catalogo globale, ripresa da
qualsiasi messaggio — compresi i rami che hai abbandonato con un ripristino.

## Il problema

Claude Code ha "restore code and conversation" (Esc Esc), ma è un undo a senso unico:
una volta ripristinato, l'interfaccia non offre più modo di tornare ai prompt e alle
risposte che ti sei lasciato indietro.

I dati però ci sono tutti: i transcript sono **append-only**, il ramo abbandonato resta
fisicamente nel file. Manca solo chi lo mostra e chi ti ci fa ripartire.

## Prima di usarlo

Progetto non ufficiale, senza alcun rapporto con Anthropic. Si appoggia a dettagli interni
di Claude Code che possono cambiare a ogni aggiornamento:

- **legge e scrive** i transcript in `~/.claude/projects/` (solo in append, mai cancellando,
  più i file delle nuove sessioni che crea);
- **legge l'archivio di copie** con cui Claude Code ripristina i file
  (`~/.claude/file-history/`), che è un dettaglio interno e può cambiare;
- il ripristino dei file **sovrascrive** il lavoro non salvato successivo al punto scelto
  (cb ne tiene una copia in `~/.claude/cb/file-history/`, ma non c'è ancora un comando per
  ripescarla).

Verificato su Claude Code **v2.1.220**, Windows 11, PowerShell 7. Per le altre piattaforme
vedi [Requisiti](#requisiti). Un backup di `~/.claude/projects/` prima di provarlo è tempo
bene speso.

## Requisiti

| | |
|---|---|
| **Node.js** | 18 o più recente |
| **Claude Code** | installato e funzionante (`claude` nel PATH, oppure `CB_CLAUDE_EXE`) |
| **Windows 10/11** | la piattaforma provata; PowerShell 7 per l'hook dei commit, opzionale |
| **macOS, Linux** | best effort — vedi sotto |

Su **macOS e Linux** il parsing dei transcript, l'albero e i selettori funzionano, ma
l'intercettazione dei tasti non è stata provata e l'hook dei commit è solo PowerShell.

⚠️ **Su Linux `npm install` compila.** `node-pty` pubblica i binari precompilati per
`win32-*` e `darwin-*` ma non per `linux-*`: lì l'installazione ripiega su node-gyp e
servono `python3`, `make` e un compilatore C++ (`build-essential`).

## Installazione

```
npm install -g claude-code-branching
```

Il comando è `cb`. Dai sorgenti invece:

```
git clone https://github.com/sasha-bolea/claude-code-branching.git
cd claude-code-branching
npm install
npm link          # rende `cb` disponibile da qualsiasi cartella
```

## Primo avvio

La prima volta che lanci `cb` ti fa tre domande, una volta sola:

```
  cb  impostazioni
  si scelgono una volta — cb --impostazioni per tornarci

  ▸ lingua              italiano
    cartella di lavoro  ~\Documents\REPOSITORY
    scorciatoia         f2

    fatto

  ↑↓ scegli l'impostazione   ←→ cambia   invio agisce sulla riga   esc tieni queste
```

`↑↓` passano da un'impostazione all'altra, `←→` cambiano il valore, invio agisce sulla riga
dove sei — sulla cartella di lavoro apre l'albero delle cartelle. Esc tiene quello che vedi:
la schermata non torna più da sola, si riapre con `cb --impostazioni`.

Le impostazioni stanno in `~/.claude/cb/impostazioni.json`. Le variabili d'ambiente
continuano a vincere su di esse, quindi niente di quanto scritto sotto cambia.

## Uso

`cb` si lancia al posto di `claude`. Lavori normalmente; quando premi la scorciatoia
compare l'albero dei rami. Ti muovi con le frecce, premi invio e scegli **cosa riportare
indietro**:

```
riporta indietro:
▸ 1. conversazione e codice
  2. solo la conversazione (i file restano come sono)
  3. solo il codice (la conversazione resta dov'è)
```

Le prime due ripartono in un ramo nuovo senza uscire dalla sessione; la terza non riavvia
nemmeno Claude, riporta solo i file. Accanto all'ora del prompt vedi quanto codice quel
turno ha cambiato (`+42 -7`).

⚠️ Il ripristino dei file sovrascrive il lavoro non salvato successivo a quel messaggio.
Con `--senza-file` la voce preselezionata diventa «solo la conversazione».

```
cb                      Claude avvolto: Esc Esc apre l'albero
cb --scegli             prima chiede cartella e conversazione (vedi sotto)
cb --tasto f2           altra scorciatoia ("f2", "esc esc", "ctrl+shift+b")
cb --senza-file         cambiando ramo NON ripristina i file, solo la conversazione
cb --tasti              stampa i byte dei tasti premuti (diagnosi)
cb ls [filtro]          elenca le sessioni di tutti i progetti
cb tree <sessione>      albero dei rami di una sessione
cb open <sessione> [n]  riprendi da fuori, opzionalmente dal punto n
cb pick                 catalogo interattivo da fuori
cb --impostazioni       schermata delle impostazioni (la prima volta si apre da sola)
cb --version            numero di versione
```

### Variabili d'ambiente

| Variabile | A cosa serve |
|---|---|
| `CB_TASTO` | la scorciatoia che apre l'albero (`f2`, `esc esc`, `ctrl+shift+b`) |
| `CB_LINGUA` | lingua dell'interfaccia: `it` o `en`. Senza, decide il locale di sistema |
| `CB_RADICE` | radice dell'albero delle cartelle (default `~/Documents/REPOSITORY`, altrimenti la home) |
| `CB_CLAUDE_EXE` | percorso completo dell'eseguibile di Claude Code, per installazioni non standard |
| `CB_CARTELLA_SCELTA` | file in cui cb scrive la cartella scelta, per la shell chiamante |
| `CB_IMPOSTAZIONI` | percorso del file delle impostazioni, se lo vuoi altrove |

Ordine di precedenza, per tutte: **variabile d'ambiente → file delle impostazioni → predefinito.**

Per fissare la scorciatoia una volta per tutte: `setx CB_TASTO "f2"` su Windows, oppure
`export CB_TASTO=f2` nel `.bashrc` / `.zshrc`.

### Scegliere cartella e conversazione all'avvio

Con `cb --scegli` cb mette due schermate davanti a Claude: l'albero delle cartelle sotto la
home (radice da `CB_RADICE`), dove `r` alterna avvio normale e ripresa, e —
in ripresa — l'elenco delle conversazioni di quella cartella, ognuna con il suo albero in
cima. `↑↓` scorrono le conversazioni, invio entra nell'albero, dove si sceglie il punto da
cui ripartire.

Perché non il selettore di `claude -r`: quello elenca i **file** di sessione, e siccome un
fork ne crea uno nuovo, i rami della stessa conversazione compaiono come conversazioni
diverse. Qui le sessioni si raggruppano per uuid di radice, e una conversazione è tutto il
suo albero.

Le stesse due schermate si riaprono a sessione avviata premendo `c` o `p` — dall'albero, o
dall'avviso che compare quando un transcript ancora non c'è. Portano tutt'e due al navigatore
delle cartelle, e lì `r` alterna la ripresa di una conversazione e l'avvio di una nuova. Così
si cambia conversazione, si cambia progetto o si riparte da zero senza chiudere Claude.

Se la variabile `CB_CARTELLA_SCELTA` punta a un file, cb ci scrive la cartella scelta: chi
lancia cb può leggerla all'uscita e spostarcisi (un processo figlio non può cambiare la
cartella corrente di chi lo ha lanciato).

Un tasto singolo (`f2`) scatta subito. Una scorciatoia ripetuta (`esc esc`) costa 300 ms
di ritardo sulla prima pressione, il tempo di capire se ne arriva una seconda.

**Quale tasto scegliere.** I tasti funzione sono la scelta sicura: Claude Code non li usa,
e non li usa nemmeno l'editing da riga di comando. Evita `f10` e `f11`, che il terminale
intercetta per la barra dei menu e lo schermo intero. Le combinazioni con Ctrl sono quasi
tutte prese: dall'editing (`ctrl+a/e/k/u/w`), dalla cronologia (`ctrl+r`), dai comandi di
Claude Code (fra cui `ctrl+g`), e `ctrl+s`/`ctrl+q` sono il controllo di flusso del
terminale — con quelli lo schermo si blocca.

`<sessione>` accetta id completo, prefisso di id, o percorso del `.jsonl`.

### L'albero dentro la sessione

La conversazione scorre da sinistra a destra, un nodo per prompt; ogni biforcazione fa
scendere un ramo. Sotto l'albero c'è il prompt su cui sta il cursore, e sotto ancora la
storia che quel punto porta con sé fino alla radice.

```
  cb  rami di questa conversazione
  ◯ riparti da qui   ┳ biforcazione   arancione = storia di questo punto

  ⬤━━━⬤━━━⬤━━━⬤━┳━⬤━━━⬤━━━⬤━━━⬤
                ┗━⬤━┳━⬤━━━◯
                    ┗━⬤━━━⬤━━━⬤

  ───────────────────────────────────────────────────────────────────
  24-07 15:51  riparti da qui
  l'app è diventata lentissima, il rendering della lista si blocca

  precedenti: 3
    24-07 15:40  aggiungi il filtro per data
    24-07 15:12  /login
    24-07 15:10  facciamo la lista dei clienti

  ←→ ad avanti e indietro   ↑↓ ws cambia ramo   invio = riparti   esc = torna a Claude
```

`←` `→` risalgono e scendono la conversazione, `↑` `↓` passano da un ramo all'altro della
stessa biforcazione. In alternativa `a` `d` e `w` `s`, se la mano preferisce restare sulle
lettere. Il cursore parte da dove sei adesso. Invio fa nascere un ramo nuovo da quel punto:
quello di prima resta dov'è.

I comandi da fuori (`cb tree`, `cb pick`, `cb open`) usano invece l'elenco verticale
numerato, perché `cb open <sessione> 3` ha bisogno di un numero a cui riferirsi:

```
 22  └─ ● 07-24 15:51  l'app è diventata lentissima ⑂3
 23     ├─ ○ 07-24 15:57  molto più fluido, ma ancora troppo scattoso
 24     │  └─ ○ 07-24 17:26  Ultraplan terminated…
 27     ├─ ○ 07-29 10:17  molto più fluido, ma ancora troppo scattoso
 28     └─ ● 07-29 10:18  era diventato molto più fluido ma ho mandato un altro prompt…
```

`●` ramo attivo · `○` ramo in disparte · `⑂n` biforcazione con n rami.

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

3. **Cambiando ramo i file tornano allo stato di quel turno**, automaticamente.

   Claude Code non usa git per i suoi checkpoint: salva copie **integrali** dei file in
   `~/.claude/file-history/<sessione>/`, annotandole nel transcript accanto ai messaggi.
   Ogni copia è il contenuto *precedente* alla modifica che l'ha generata, quindi lo stato
   di un file a un dato istante è la **prima copia successiva** a quell'istante.

   cb legge quell'archivio invece di chiamare il ripristino nativo: niente processo da
   lanciare, e soprattutto si guardano le copie di **tutta la famiglia** di sessioni —
   il comando nativo ne conosce una sola, mentre i rami di una conversazione stanno in file
   diversi. Riscontro: ricostruito lo stato all'inizio di una sessione vera, 20 file su 20
   identici byte per byte al commit che era HEAD in quel momento.

   Due limiti da conoscere: l'archivio copre **solo i file che Claude ha toccato**, e ha una
   scadenza di qualche settimana. Per il resto c'è l'hook dei commit (sotto).

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

## Agganciarlo al comando `claude`

Per non dover ricordarsi di scrivere `cb`, si può far passare `claude` attraverso di esso.
In PowerShell, dentro `$PROFILE`:

Fare un backup del profilo prima di modificarlo.

```powershell
function claude {
    $cbEntry = "C:/percorso/di/cb/bin/cb.js"
    $claudeShim = "$env:APPDATA/npm/claude.ps1"

    # Senza argomenti (o con -r) apri i selettori di cartella e conversazione.
    $scegli = @()
    if ($args.Count -eq 0 -or $args[0] -in @('-r', '--resume')) { $scegli = @('--scegli') }

    # cb ci scrive la cartella scelta: la shell ci si sposta all'uscita.
    $fileCartella = Join-Path ([IO.Path]::GetTempPath()) "cb-cartella-$PID.txt"
    Remove-Item $fileCartella -ErrorAction SilentlyContinue
    $env:CB_CARTELLA_SCELTA = $fileCartella

    try {
        if ((Test-Path $cbEntry) -and (Get-Command node -ErrorAction SilentlyContinue)) {
            & node $cbEntry @scegli -- @args
            if ($LASTEXITCODE -ne 78) { return }   # 78 = cb non è partito
        }
        & $claudeShim @args                        # ripiego: Claude diretto
    } finally {
        if (Test-Path $fileCartella) {
            $scelta = (Get-Content $fileCartella -Raw).Trim()
            Remove-Item $fileCartella -ErrorAction SilentlyContinue
            if ($scelta -and (Test-Path -LiteralPath $scelta)) { Set-Location -LiteralPath $scelta }
        }
        $env:CB_CARTELLA_SCELTA = $null
    }
}
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

Nota che nello snippet **non** c'è `--tasto`: la scorciatoia viene dalle impostazioni, quindi
per cambiarla basta `cb --impostazioni`. Mettendo `--tasto` qui la scelta fatta nella
schermata verrebbe scavalcata a ogni avvio e sembrerebbe non avere effetto — il flag vince di
proposito, essendo la scelta più esplicita.

Nota: il titolo della tab viene mantenuto (ConPTY lo sovrascriverebbe col percorso di
`claude.exe` a ogni avvio di processo, quindi a ogni cambio ramo).

## Commit automatici (opzionale, Windows)

`hooks/cb-commit.ps1` è un hook `Stop`: a ogni fine turno che ha modificato file, salva
**tutto il working tree** su un ref nascosto `refs/cb/<sessione>/auto`.

- Non compare in `git log`, `git branch`, `git tag`, `git status`
- Non tocca il branch su cui lavori né l'area di staging (usa un index temporaneo)
- Recupero a mano: `git show refs/cb/<sessione>/auto~2:percorso/file.js`

Nel corpo del commit finisce l'**uuid dell'ultimo messaggio del turno**: è l'aggancio fra
l'albero e lo storico del codice. Quando la copia nativa di un file è scaduta, cb risale da
quel punto al commit e ripesca il file da lì — un file per volta, non l'albero intero.

Installazione: aggiungi in `~/.claude/settings.json` sotto `hooks.Stop` (in coda agli
hook esistenti, senza sostituirli):

```json
{
  "type": "command",
  "command": "pwsh -NoProfile -ExecutionPolicy Bypass -File \"C:/percorso/di/cb/hooks/cb-commit.ps1\"",
  "timeout": 60
}
```

⚠️ L'hook gira su **ogni** sessione Claude in **ogni** repo git, non solo su questo progetto.
Non metterlo `async`: girando in parallelo potrebbe leggere il working tree mentre un cambio
ramo lo sta riscrivendo.

Non esiste ancora l'equivalente per macOS e Linux.

## Test

```
npm test
```

## Limiti noti

- Ogni cambio di ramo **riavvia il processo Claude**: non si può ricaricare una
  conversazione in un processo già avviato. Il wrapper lo rende invisibile, non lo evita —
  vedi il tempo di avvio della TUI a ogni salto. Fa eccezione «solo il codice», che non
  tocca la conversazione e quindi non riavvia niente.
- **Il ripristino copre solo i file che Claude ha toccato.** Le modifiche fatte a mano, da un
  altro terminale o da una build non sono nell'archivio: ripristinando un punto ottieni un
  albero misto. I commit automatici coprono tutto, ma oggi servono solo da ripiego per le
  copie scadute.
- **Nessuna pulizia**: l'archivio delle copie di cb, i ref `refs/cb/*` e le sessioni troncate
  create a ogni cambio ramo si accumulano senza scadenza.
- **Nessun modo di guardare dentro agli archivi**: niente anteprima di cosa cambierà, niente
  annulla. Il ripristino non è atomico: se una scrittura fallisce a metà, l'albero resta misto.
- Rubare `Esc Esc` costa 300 ms di ritardo su un Esc singolo (l'interruzione), e sostituisce
  il menu di ripristino nativo. Con una scorciatoia a tasto singolo (`--tasto f2`) il
  ritardo sparisce e il menu nativo resta disponibile.
- Il salto è possibile solo dopo il primo turno: prima non esiste un transcript da leggere.
- `--resume-session-at` non è documentato: può cambiare a un aggiornamento del CLI.
- La parentela tra sessioni forkate vive nei campi `forkParentSessionId` scritti dal CLI;
  `cb` non li aggrega ancora in una vista cross-sessione.
- L'albero orizzontale fa partire ogni ramo dalla colonna in cui si è diramato: con
  biforcazioni molto avanti nella conversazione il ramo comincia a destra e va a capo
  presto. Si vede da dove nasce, si perde un po' di larghezza.
- I comandi da fuori (`tree`, `pick`, `open`) mostrano ancora l'elenco verticale numerato,
  non l'albero orizzontale.
- `node-pty` richiede il binario nativo di Claude, non lo shim npm. `cb` lo cerca da sé
  (prima i percorsi noti, poi il `PATH`); se l'installazione non è standard, imposta
  `CB_CLAUDE_EXE`.

## Licenza

MIT — vedi [LICENSE](LICENSE).
