# Architettura

## Stack

- **Node.js 24**, ESM (`"type": "module"`). Unica dipendenza: `node-pty`.
- Hook opzionale in **PowerShell 7** (`pwsh`).
- Sviluppato e verificato su **Windows 11** con Claude Code **v2.1.220**.

## Il principio che tiene tutto insieme

cb non interpreta mai ciò che Claude **disegna**: legge solo i **transcript su disco**
(`~/.claude/projects/<slug-cwd>/<sessionId>.jsonl`). Un aggiornamento del CLI può cambiare la
grafica senza rompere niente. L'unica cosa che intercetta a schermo sono i tasti della
scorciatoia e le richieste di cambio titolo.

Corollario: ogni scrittura sui transcript è **additiva**. Niente viene modificato o rimosso,
ed è il motivo per cui i rami sopravvivono.

## Componenti

```
  bin/cb.js            entrypoint: sottocomandi, argomenti, ripiego non interattivo
        │
        ├── src/cartelle.js     selettore della cartella di lavoro (albero dei progetti)
        ├── src/conversazioni.js selettore delle conversazioni passate (albero + elenco)
        │
        ├── src/wrapper.js      il cuore: pty, tasti, overlay, cambio ramo
        │       ├── tasti.js       byte → tasti (3 codifiche) → azioni
        │       ├── titolo.js      filtra gli OSC di titolo dei figli
        │       ├── vista.js       albero orizzontale: griglia, colore, navigazione, pagina
        │       │     └── stile.js   tavolozza, in un posto solo
        │       ├── albero.js      collasso ai soli prompt + elenco verticale numerato
        │       ├── attiva.js      rende raggiungibile/troncato un turno
        │       └── ramo.js        crea la sessione del nuovo ramo
        │
        ├── src/codice.js       ripristino dei file: archivio delle copie, regola temporale
        │     └── commit.js       ripiego sui commit automatici (aggancio uuid → commit)
        ├── src/transcript.js   parsing .jsonl, albero da parentUuid, fusione famiglie
        ├── src/percorsi.js     slug delle cartelle, famiglia di sessioni
        ├── src/indice.js       catalogo globale con cache (mtime+size)
        ├── src/eseguibile.js   trova claude.exe (node-pty non lancia gli shim)
        ├── src/lancia.js       ripresa da fuori, senza pty
        └── src/anteprima.js    strumento: l'overlay su una sessione vera, senza Claude
```

Due rendering coesistono, e non è un doppione: l'**albero orizzontale** (`vista.js`) è
interattivo, si naviga a frecce e non ha numeri; l'**elenco verticale numerato** (`albero.js`)
serve ai comandi da fuori, dove `cb open <sessione> 3` ha bisogno di un numero a cui riferirsi.

## La vista dell'albero

Layout e disegno sono separati, ed è ciò che rende la navigazione istantanea:

```
componiVista(albero)              griglia di celle, UNA VOLTA SOLA
   │                              larghezza naturale, indipendente dal terminale
   ├── disegnaRighe(v, sel, fin)  colora in base al cursore, ritaglia in orizzontale
   └── schermata(v, sel, dim)     pagina intera: albero + prompt scelto + storia
```

Tre vincoli imparati costruendola:

- **Il ritaglio orizzontale si fa sulle celle, mai sul testo prodotto.** Le righe finite
  contengono sequenze ANSI: tagliarle per numero di caratteri ne spezzerebbe una a metà,
  lasciando il terminale colorato per sempre.
- **Le celle di raccordo portano `rami`**, gli uuid dei nodi a valle. Senza, una linea non
  saprebbe di che percorso fa parte e non si potrebbe colorare: hanno `uuid` nullo.
- **La griglia non dipende dalle dimensioni del terminale.** È ciò che permette di ridisegnare
  a ogni ridimensionamento e a ogni movimento del cursore senza ricalcolare niente.

Navigazione: `←→` seguono la conversazione; `↑↓` passano al ramo disegnato sopra o sotto, non
ai *fratelli* — ogni riga del disegno è un ramo, quindi cambiare riga è cambiare ramo, ed è
quello che l'occhio si aspetta. Le frecce orizzontali cambiano ramo quando l'albero lo suggerisce
all'occhio:

- **destra** in fondo a un ramo prosegue su uno affiancato che vada più avanti; se il ramo di
  sotto finisce *esattamente dove siamo*, ci si scende comunque. Verso l'alto la parità non vale,
  o due rami che finiscono alla stessa colonna si rimanderebbero il cursore a vicenda.
- **sinistra** sul primo prompt di un ramo sale di una riga restando incolonnata, invece di
  tornare al padre in diagonale. Salendo si arriva sulla riga dove il padre è in linea, e da lì
  la sinistra torna a essere un passo indietro.

Quando le radici sono più d'una — la biforcazione è sul **primo prompt** — non c'è un nodo padre
da cui far pendere i rami: la forca si mette prima della prima colonna, come se le radici
pendessero dall'inizio della conversazione. Senza, si vedevano due conversazioni separate.

**L'ordine in cui si assegnano le righe decide se le linee si incrociano.** Un ramo scende
dritto lungo la colonna della sua forca, attraversando tutte le righe che trova. Da qui due
regole, entrambe nella coda di `componiVista`:

1. **In profondità, non in ampiezza**: i rami nati da una catena si disegnano subito sotto di
   lei (`coda.unshift`), così ogni ramo occupa una fascia di righe contigua. In ampiezza un ramo
   nato presto ma scoperto tardi finiva in fondo, e la sua discesa attraversava tutti gli altri.
2. **Da destra a sinistra**: fra i rami di una stessa catena si disegna prima quello con la
   forca più a destra. Le fasce già disegnate cominciano da una colonna maggiore, quindi ogni
   discesa successiva passa **a sinistra** di tutto ciò che c'è, dove non c'è niente da
   attraversare. Non è estetica: con quest'ordine nessuna discesa può incrociare un altro ramo.

L'ordinamento è stabile, quindi i rami di una stessa forca (stessa colonna) restano nell'ordine
di accodamento: è ciò che rende corretta la scelta fra `┣` e `┗`.

Nell'intestazione, fra l'ora del prompt e «riparti da qui», stanno le righe di codice cambiate
in quel turno (`+42` in verde, `-7` in rosso). Il conteggio viene dal diff che Claude scrive già
nel transcript (`toolUseResult.structuredPatch`), sommato dal prompt fino al prompt successivo —
lo stesso confine di `fineDelTurno`, quindi descrive esattamente il pezzo che ripartirebbe.

Geometria e glifi vengono da `esempio-albero.txt`, il disegno di riferimento: passo di 4
colonne fra i nodi, `⬤━┳━⬤`, ramo che parte con `┗` sulla colonna della forca.

## I due selettori dell'avvio

`cb --scegli` mette due schermate davanti a Claude, prima che il pty esista:

```
selezionaCartella()          albero delle cartelle sotto la home (radice: CB_RADICE)
   │                         "r" alterna avvio normale / ripresa
   ├── avvio normale ──────► Wrapper.avvia()                    sessione nuova
   └── ripresa ────────────► selezionaConversazione()
                                 │  albero della conversazione in cima, elenco sotto
                                 │  invio → si entra nell'albero (schermata di F2)
                                 └─► Wrapper.avvia({ripartenza})
```

**Una conversazione è una famiglia, non un file.** Il selettore nativo di Claude elenca le
sessioni: siccome un fork crea un file nuovo, i rami della stessa conversazione compaiono come
conversazioni diverse. Qui le schede dell'indice si raggruppano per **uuid di radice** — che il
fork copia insieme alla storia — e l'albero mostrato è l'unione di tutta la famiglia.

`esitoScelta` decide come ripartire: se il punto scelto è già la fine di quella sessione basta
riprenderla (`--resume`), altrimenti si passa dal taglio, cioè dalla stessa strada del cambio
ramo. Senza questa distinzione ogni ripresa duplicherebbe l'intera conversazione in un file
nuovo.

Le stesse schermate si riaprono a sessione avviata, dall'overlay F2: `c` le conversazioni,
`p` prima le cartelle (`Wrapper.cambiaConversazione`). I selettori si prendono lo stdin e alla
chiusura lo lasciano com'era prima: il wrapper se lo ripiglia in un `finally`, o i tasti non
arriverebbero più a Claude.

**La cartella scelta torna alla shell per file.** Un processo figlio non può cambiare la cwd
del padre: cb scrive il percorso in `CB_CARTELLA_SCELTA` (se impostata) e chi ha lanciato cb
la legge all'uscita. È il modo in cui la funzione `claude` del profilo continua a fare il `cd`
nella cartella scelta.

## Flusso: dalla scorciatoia al nuovo ramo

```
1. tastiera → tokenizza() → contaInTesta() → scorciatoia riconosciuta
2. trovaTranscript()          quale file leggere (con ripiego su percorsoOrigine)
3. sessioniDellaFamiglia()    tutti i transcript con la stessa radice
4. unisciAlberi()             un albero solo, ogni nodo con le sue `origini`
5. componiVista()             griglia orizzontale, una volta sola
6. ciclo: schermata() → azioniTastiera() → muovi()   finché invio o esc
7. menu: conversazione / codice / entrambi           (esc torna all'albero)
8. scegliOrigine()            da quale sessione ripartire per quel nodo
9. chiudiProcesso()           attende l'uscita reale di Claude
10. fineDelTurno()            dove tagliare: prompt + sua risposta
11. riattivaConVerifica()     ramo raggiungibile, con verifica e ritentativi
12. ripristinaFile()          copie dell'archivio sui file di lavoro
13. creaSessioneTroncata()    nuovo .jsonl con la sola catena fino al taglio
14. avviaClaude({riprendi})   --resume <nuova sessione>
```

L'ordine di 9-13 non è arbitrario: le scritture devono essere le ultime, perché Claude in uscita
appende un `last-prompt` che sovrascriverebbe la riattivazione del ramo.

Con **solo il codice** il flusso si ferma al 12: la conversazione resta dov'è, quindi non c'è
niente da chiudere né da tagliare e Claude non viene riavviato. È l'unico caso in cui il cambio
ramo non è un cambio di processo.

## Modello dei dati

**Un transcript è una lista di record**, non un albero: la struttura vive in `parentUuid`.
Nodi dell'albero solo i tipi con `uuid`: `user`, `assistant`, `attachment`, `system`. Gli
altri (`ai-title`, `mode`, `last-prompt`, `file-history-snapshot`…) sono metadati.

- **Biforcazione** = nodo con più figli. Filtrate quelle tecniche (retry di tool): un
  *ripristino vero* ha almeno due rami che portano a prompt utente distinti.
- **Sidechain** (`isSidechain: true`) esclusi: sono subagent, e punterebbero al messaggio
  padre creando biforcazioni inesistenti.
- **Famiglia**: un fork copia i record mantenendo gli **stessi uuid** e la stessa radice. Le
  sessioni si raggruppano per uuid di radice e si fondono per uuid, così i rami rimasti nel
  file di partenza tornano visibili. Ogni nodo fuso porta `origini: [{sessionId, percorso}]`.

## Perché il taglio lo fa cb

`--resume-session-at` tronca **solo in modalità print**. In interattivo il CLI ricostruisce
la conversazione dall'ultimo record messaggio del file, ignorando sia quel flag sia
`last-prompt.leafUuid` (verificato catturando lo schermo di sessioni reali in un pty).

Quindi cb scrive un file di sessione nuovo contenente solo la catena fino alla fine del turno
scelto: il taglio diventa un dato di fatto, non dipende da come il CLI interpreta i flag.
Il file di partenza resta intero, e i turni successivi restano un ramo in disparte.

## Contratto con il chiamante

- Uscita **78** = cb non è partito → chi lo lancia può ripiegare su Claude diretto. Qualsiasi
  altro codice è l'uscita di Claude e **non** va rilanciato.
- Tutto ciò che segue `--` va a Claude, non a cb.
- Con `-p`/`--print` o stdin non TTY: niente pty, Claude eseguito direttamente
  (`lanciaClaudeDiretto`), altrimenti lo pseudo-terminale sporcherebbe l'output.

## Codice e file di lavoro

Il ripristino del codice non chiede niente a Claude: **legge il suo archivio di copie**
(`src/codice.js`). Claude non usa git — prima di modificare un file ne salva il contenuto
**intero** in `~/.claude/file-history/<sessione>/<hash del percorso>@v<N>`, e annota la copia
nel transcript con due tipi di record:

| Record | Cosa contiene |
|---|---|
| `file-history-snapshot` | uno per prompt utente: la mappa completa `percorso → copia` in quel punto |
| `file-history-delta` | una copia fatta a metà turno, con `trackingPath` e `backup` |

Ogni copia è il contenuto **precedente** alla modifica che l'ha generata. Da qui la regola, una
sola, che regge tutto il ripristino:

> lo stato di un file all'istante T è la **prima copia con `backupTime ≥ T`**.
> Nessuna copia dopo T = il file non è più stato toccato. Copia `null` = a T non esisteva.

Tre conseguenze che il codice deve rispettare:

- **Le versioni ripartono da `v1` in ogni sessione**, quindi il nome di una copia identifica
  qualcosa solo insieme alla sua cartella. Le sessioni troncate che cb crea copiano i record ma
  non le copie: la stessa voce compare più volte e quelle delle troncate puntano a cartelle che
  non esistono. `preferisciCopiePresenti` tiene, fra voci identiche, quella che c'è davvero.
- **Nell'archivio non c'è mai lo stato finale di un file**: è il "prima" di una modifica che non
  è ancora avvenuta. Perché si possa tornare *avanti*, cb copia ciò che sta per sovrascrivere
  nel proprio archivio (`~/.claude/cb/file-history/` + `indice.jsonl`), con la stessa semantica.
- **Fuori dalla cartella di lavoro non si scrive.** Nell'archivio finisce ogni file toccato da
  Claude, profilo PowerShell e file di memoria compresi: si contano e si dicono, non si toccano.

Rispetto al ripristino nativo (`--resume <id> --rewind-files <uuid>`, che cb usava prima) non
serve lanciare un processo né la variabile `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING`, e
soprattutto si guardano le copie di **tutta la famiglia**: il flag nativo ne conosce una sola,
mentre i rami di una conversazione stanno in file diversi.

### Il ripiego: i commit automatici

L'archivio nativo scade (le cartelle più vecchie durano qualche settimana) e copre solo i file
che Claude ha toccato. L'hook `Stop` (`hooks/cb-commit.ps1`) salva quindi **tutto il working
tree** a fine turno su `refs/cb/<sessione>/auto`, via `write-tree`/`commit-tree`/`update-ref`
con un index temporaneo (`GIT_INDEX_FILE`): non compare in `git log`/`branch`/`tag`/`status`,
non tocca il branch corrente né l'area di staging.

Nel messaggio del commit finisce l'**uuid dell'ultimo messaggio del turno** — l'hook lo legge
dalle ultime righe del transcript. È l'aggancio fra l'albero e lo storico del codice:
`src/commit.js` risolve un punto dell'albero in un commit (prima per uuid, poi ripiegando
sull'ultimo commit precedente a quell'istante) ed estrae un file per volta con `git show`. Un
file per volta e non l'albero intero: riportare indietro tutto sovrascriverebbe anche ciò che il
ripristino non aveva motivo di toccare.

`ripristinaA` interroga il ripiego solo per le copie mancanti, e vale `null` fuori da un repo o
senza commit: senza hook il comportamento è esattamente quello di prima.

| | Copertura | Durata |
|---|---|---|
| archivio di Claude | file toccati da Claude | qualche settimana (pulizia periodica) |
| archivio di cb | file toccati dai ripristini di cb | permanente, nessuna pulizia |
| commit automatici | tutto il working tree | permanente, ref git nascosti |
