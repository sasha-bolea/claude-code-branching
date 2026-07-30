# STATO

**Ultimo aggiornamento:** 2026-07-30 19:10

## Stato attuale

Progetto **funzionante e pubblicato**. Nato e completato in tre sessioni (29-30 luglio 2026).

- Repo pubblica: **https://github.com/sasha-bolea/claude-code-branching** (MIT, branch `master`)
- Cartella locale: `C:\Users\sasha\Documents\REPOSITORY\personale\cb`
- `cb` installato come comando globale (`npm link`)
- Agganciato alla funzione `claude` del profilo PowerShell: scrivi `claude`, poi **F2**
- **89 prove** con `assert`, nessun framework (`npm test`)

Il workflow funziona end-to-end: F2 apre l'albero dei rami, ci si muove con le frecce (o
`wasd`), si sceglie un punto anche intermedio, conversazione **e** file tornano lì in un ramo
nuovo, e il ramo precedente resta nell'albero ripescabile.

L'albero è **orizzontale e navigabile**: la conversazione scorre da sinistra a destra, ogni
biforcazione fa scendere un ramo, e l'arancione marca il percorso dal cursore alla radice —
cioè quello che ripartirebbe premendo invio. Sotto, il prompt selezionato per intero e la
storia che lo precede.

## Problemi aperti

- **Commit automatici del codice non installati.** `hooks/cb-commit.ps1` è scritto e provato,
  ma non registrato in `settings.json`. Finché non lo è, il ripristino dei file dipende dai
  checkpoint nativi, che sono legati al session-id e hanno una retention: su rami vecchi il
  codice non torna più indietro. Procedura in `procedure.md`.
- **Glifi a larghezza incerta.** `⬤ ◯ ━ ┳ ┃ ┣ ┗` sono tutti "East Asian Ambiguous": un
  terminale che li rendesse a doppia larghezza sfaserebbe il rientro dei rami, che è fatto di
  spazi. Sono in cima a `src/vista.js` e si sostituiscono in tre costanti.
- **Solo Windows.** Il parsing dei transcript è portabile; l'intercettazione dei tasti no
  (win32-input-mode). Su Linux/macOS mai provata — le frecce e i tasti funzione ora sono
  riconosciuti anche in codifica ANSI, ma non è stato verificato sul campo.
- **Più terminali sulla stessa cartella**: con avvio `-r`/`--continue` cb ripiega sul
  transcript più recente della cartella e può agganciare la sessione sbagliata. Con l'avvio
  normale non succede, perché l'id lo impone cb.
- **Sessioni troncate accumulate**: ogni cambio ramo crea un `.jsonl`. Nessuna pulizia
  automatica.
- **Rami che nascono tardi partono a destra.** Un ramo comincia dalla colonna in cui si è
  diramato, quindi con biforcazioni avanzate nella conversazione va a capo presto. Si vede da
  dove nasce, si perde un po' di larghezza.
- **Il verticale condiviso fra tre o più rami resta grigio** se il cursore sta sul secondo: la
  cella è già occupata dal primo che l'ha disegnata. Un carattere, cosmetico.

## Decisioni

| Data | Decisione | Motivo |
|---|---|---|
| 2026-07-29 | Launcher/wrapper che non parsa mai lo schermo di Claude, solo i transcript | Non si rompe agli aggiornamenti del CLI |
| 2026-07-29 | Ogni scrittura sui transcript è additiva | È il motivo per cui i rami sopravvivono |
| 2026-07-29 | Zero dipendenze tranne `node-pty` | Nessuna toolchain da mantenere |
| 2026-07-29 | Commit automatici su ref nascosti `refs/cb/<sid>/auto` con index temporaneo | Invisibili a `git log`/`status`, non toccano branch né staging |
| 2026-07-30 | Wrapper con pty invece del solo launcher esterno | Era il workflow richiesto: intervenire *dentro* la sessione |
| 2026-07-30 | Albero costruito unendo **tutta la famiglia** di sessioni | Un fork lascia i rami precedenti nel file di partenza |
| 2026-07-30 | Il taglio della conversazione lo scrive cb, non lo chiede al CLI | `--resume-session-at` tronca solo in print mode |
| 2026-07-30 | Log diagnostico **sempre attivo** | Le decisioni sul cambio ramo non sono ricostruibili dallo schermo |
| 2026-07-30 | Repo pubblica con sezione «Prima di usarlo» | Usa flag non documentati e scrive nei transcript: chi la clona deve saperlo |
| 2026-07-30 | Scorciatoia **F2**, non più `ctrl+g` | `ctrl+g` è già usato da Claude Code; i tasti funzione sono l'unica fascia libera |
| 2026-07-30 | Albero **orizzontale** navigabile, al posto dell'elenco numerato | La conversazione è una linea e i rami sono deviazioni: in verticale un ramo lungo e uno corto occupano lo stesso spazio |
| 2026-07-30 | Le catene **non vanno a capo**: si scorre in orizzontale | A capo, un ramo lungo sembrava tanti rami corti |
| 2026-07-30 | `↑↓` cambiano **riga del disegno**, non fratello nell'albero | Ogni riga è un ramo; coi fratelli il tasto era inerte quasi sempre |
| 2026-07-30 | L'arancione marca il percorso **dal cursore alla radice**, non il ramo attivo | È quello che ripartirebbe premendo invio |
| 2026-07-30 | Tutto alla massima luminosità tranne la legenda; il ramo si distingue per **tinta** | Abbassare i rami in disparte faceva sembrare mezzo schermo spento |
| 2026-07-30 | Layout separato dal disegno (`componiVista` / `disegnaRighe` / `schermata`) | Muovere il cursore o ridimensionare non ricalcola il layout |
| 2026-07-30 | Il ramo attivo si legge da `ultimoNodo`, non da `last-prompt` | È da lì che il CLI ricostruisce in interattivo; divergevano in 7 sessioni su 12 |

## Backlog

- Installare l'hook dei commit automatici (il pezzo mancante più utile)
- Pulizia delle sessioni troncate accumulate (`cb prune`?)
- Portare la vista orizzontale anche a `cb tree`/`pick` (oggi usano l'elenco numerato, che
  serve a `cb open <sessione> 3` per avere un numero a cui riferirsi)
- Vista cross-sessione delle parentele (`cb ls` non mostra le famiglie)
- Verifica su Linux/macOS: parsing e codifiche ANSI dovrebbero reggere, il resto no
- Valutare lo scorrimento "fermo finché non tocchi il bordo" al posto del cursore centrato
- Rinominare `master` → `main` (scelta rimandata)

## Riferimenti

- `brief.md` — spec e vincoli scoperti, con i riscontri
- `architettura.md` — stack, componenti, flussi, la vista dell'albero
- `bug-risolti.md` — 19 bug con causa e fix
- `procedure.md` — installazione, aggancio a `claude`, pubblicazione, diagnosi
- `storico-sessioni.md` — archivio delle sessioni
