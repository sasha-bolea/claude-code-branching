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
        ├── src/wrapper.js      il cuore: pty, tasti, overlay, cambio ramo
        │       ├── tasti.js       byte → tasti (3 codifiche) → azioni
        │       ├── titolo.js      filtra gli OSC di titolo dei figli
        │       ├── vista.js       albero orizzontale: griglia, colore, navigazione, pagina
        │       │     └── stile.js   tavolozza, in un posto solo
        │       ├── albero.js      collasso ai soli prompt + elenco verticale numerato
        │       ├── attiva.js      rende raggiungibile/troncato un turno
        │       └── ramo.js        crea la sessione del nuovo ramo
        │
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

Navigazione: `←→` seguono la conversazione (e in fondo a un ramo la destra prosegue su uno
affiancato); `↑↓` passano al ramo disegnato sopra o sotto, non ai *fratelli* — ogni riga del
disegno è un ramo, quindi cambiare riga è cambiare ramo, ed è quello che l'occhio si aspetta.

Geometria e glifi vengono da `esempio-albero.txt`, il disegno di riferimento: passo di 4
colonne fra i nodi, `⬤━┳━⬤`, ramo che parte con `┗` sulla colonna della forca.

## Flusso: dalla scorciatoia al nuovo ramo

```
1. tastiera → tokenizza() → contaInTesta() → scorciatoia riconosciuta
2. trovaTranscript()          quale file leggere (con ripiego su percorsoOrigine)
3. sessioniDellaFamiglia()    tutti i transcript con la stessa radice
4. unisciAlberi()             un albero solo, ogni nodo con le sue `origini`
5. componiVista()             griglia orizzontale, una volta sola
6. ciclo: schermata() → azioniTastiera() → muovi()   finché invio o esc
7. scegliOrigine()            da quale sessione ripartire per quel nodo
8. chiudiProcesso()           attende l'uscita reale di Claude
9. fineDelTurno()             dove tagliare: prompt + sua risposta
10. riattivaConVerifica()     ramo raggiungibile, con verifica e ritentativi
11. ripristinaFile()          --rewind-files sui file di lavoro
12. creaSessioneTroncata()    nuovo .jsonl con la sola catena fino al taglio
13. avviaClaude({riprendi})   --resume <nuova sessione>
```

L'ordine di 8-12 non è arbitrario: le scritture devono essere le ultime (Claude in uscita
appende un `last-prompt`), e il rewind dei file richiede che il messaggio sia nella catena
attiva della sessione di partenza.

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

Due meccanismi indipendenti, con orizzonti diversi:

| | Copertura | Durata |
|---|---|---|
| `--rewind-files` (checkpoint nativi) | file toccati da Claude | legata al session-id, con retention |
| `hooks/cb-commit.ps1` (opzionale) | tutto il working tree | permanente, ref git nascosti |

L'hook scrive su `refs/cb/<sessione>/auto` via `write-tree`/`commit-tree`/`update-ref`, con un
index temporaneo (`GIT_INDEX_FILE`): non compare in `git log`/`branch`/`tag`/`status`, non
tocca il branch corrente né l'area di staging.
