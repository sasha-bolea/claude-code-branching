# STATO

**Ultimo aggiornamento:** 2026-07-31 00:57

## Stato attuale

Progetto **funzionante e pubblicato**. Nato e cresciuto in quattro sessioni (29-31 luglio 2026).

- Repo pubblica: **https://github.com/sasha-bolea/claude-code-branching** (MIT, branch `master`)
- Cartella locale: `C:\Users\sasha\Documents\REPOSITORY\personale\cb`
- `cb` installato come comando globale (`npm link`)
- Agganciato alla funzione `claude` del profilo PowerShell: scrivi `claude`, poi **F2**
- **95 prove** nominali con `assert` più i due selettori (115 assert), nessun framework
  (`npm test`)

Il workflow funziona end-to-end. Scrivendo `claude`:

1. **cb chiede dove lavorare** — albero delle cartelle, `r` alterna avvio normale e ripresa;
2. in ripresa **cb chiede quale conversazione** — albero della conversazione selezionata in
   cima, elenco sotto, `↑↓` per scorrerle; una conversazione è tutta la sua famiglia di
   sessioni, non un file;
3. invio entra nell'albero e si sceglie il punto da cui ripartire;
4. dentro la sessione **F2** riapre lo stesso albero, e `c`/`p` riportano ai due selettori
   senza chiudere Claude.

L'albero è orizzontale e navigabile: la conversazione scorre da sinistra a destra, ogni
biforcazione fa scendere un ramo, e l'arancione marca il percorso dal cursore alla radice —
cioè quello che ripartirebbe premendo invio.

## Problemi aperti

- **Commit automatici del codice non installati.** `hooks/cb-commit.ps1` è scritto e provato,
  ma non registrato in `settings.json`. Finché non lo è, il ripristino dei file dipende dai
  checkpoint nativi, che sono legati al session-id e hanno una retention: su rami vecchi il
  codice non torna più indietro. Procedura in `procedure.md`.
- **Titolo della tab da verificare sul campo.** Il loop di rinomina che stava nel profilo è
  stato tolto: adesso il titolo lo scrive cb a ogni avvio di Claude. Se in una tab ricomparisse
  `…\claude.exe`, il loop va rimesso (sta nel backup del profilo).
- **Il conteggio dei messaggi nell'elenco delle conversazioni è una stima**: il file più lungo
  della famiglia. Il numero esatto si sa solo unendo gli alberi, e compare in cima quando la
  conversazione è selezionata.
- **Glifi a larghezza incerta.** `⬤ ◯ ━ ┳ ┃ ┣ ┗` sono tutti "East Asian Ambiguous": un
  terminale che li rendesse a doppia larghezza sfaserebbe il rientro dei rami, che è fatto di
  spazi. Sono in cima a `src/vista.js` e si sostituiscono in tre costanti.
- **Solo Windows.** Il parsing dei transcript è portabile; l'intercettazione dei tasti no
  (win32-input-mode). Su Linux/macOS mai provata.
- **Più terminali sulla stessa cartella**: con avvio `-r`/`--continue` cb ripiega sul
  transcript più recente della cartella e può agganciare la sessione sbagliata. Con l'avvio
  normale non succede, perché l'id lo impone cb.
- **Sessioni troncate accumulate**: ogni cambio ramo crea un `.jsonl`. Nessuna pulizia
  automatica.
- **Rami che nascono tardi partono a destra.** Un ramo comincia dalla colonna in cui si è
  diramato, quindi con biforcazioni avanzate nella conversazione va a capo presto.
- **Il selettore delle conversazioni rilegge la famiglia a ogni selezione** (con cache in
  memoria per la durata della schermata). Su conversazioni da 2000 messaggi si sente.

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
| 2026-07-30 | Scorciatoia **F2**, non più `ctrl+g` | `ctrl+g` è già usato da Claude Code |
| 2026-07-30 | Albero **orizzontale** navigabile, al posto dell'elenco numerato | La conversazione è una linea e i rami sono deviazioni |
| 2026-07-30 | L'arancione marca il percorso **dal cursore alla radice** | È quello che ripartirebbe premendo invio |
| 2026-07-30 | Layout separato dal disegno (`componiVista` / `disegnaRighe` / `schermata`) | Muovere il cursore o ridimensionare non ricalcola il layout |
| 2026-07-31 | Il selettore di cartella passa dal profilo PowerShell **dentro cb** | Una cosa sola da mantenere, e la stessa tavolozza del resto |
| 2026-07-31 | La cartella scelta torna alla shell per **file** (`CB_CARTELLA_SCELTA`) | Un processo figlio non può cambiare la cwd del padre |
| 2026-07-31 | Selettore di conversazioni proprio, al posto di quello nativo di `claude -r` | Il nativo elenca i **file**: dopo un fork i rami della stessa conversazione sembrano conversazioni diverse |
| 2026-07-31 | Una conversazione = tutta la famiglia, raggruppata per **uuid di radice** | È l'unica chiave che il fork copia insieme alla storia |
| 2026-07-31 | Scegliendo la punta si **riprende** la sessione, non si taglia | Tagliare comunque duplicherebbe l'intera conversazione a ogni ripresa |
| 2026-07-31 | Scelta la conversazione si mostra la stessa schermata di F2 | Una sola interfaccia per «da dove riparto», ovunque la si apra |
| 2026-07-31 | Pannello dell'albero ad **altezza fissa** nel selettore | Alberi di altezza diversa facevano saltare l'elenco a ogni freccia |
| 2026-07-31 | `←→` cambiano ramo quando l'albero lo suggerisce all'occhio | Il disegno è la mappa: se un ramo finisce sotto al cursore, la destra ci deve scendere |

## Backlog

- **Aggiungere il codice al versionamento** (deciso per la prossima sessione)
- Installare l'hook dei commit automatici
- Pulizia delle sessioni troncate accumulate (`cb prune`?)
- Portare la vista orizzontale anche a `cb tree`/`pick` (oggi usano l'elenco numerato, che
  serve a `cb open <sessione> 3` per avere un numero a cui riferirsi)
- Un comando che apra il selettore delle conversazioni da fuori (`cb riprendi`), oggi ci si
  arriva solo da `--scegli` o da F2
- Verifica su Linux/macOS: parsing e codifiche ANSI dovrebbero reggere, il resto no
- Valutare lo scorrimento "fermo finché non tocchi il bordo" al posto del cursore centrato
- Rinominare `master` → `main` (scelta rimandata)

## Riferimenti

- `brief.md` — spec e vincoli scoperti, con i riscontri
- `architettura.md` — stack, componenti, flussi, i due selettori, la vista dell'albero
- `bug-risolti.md` — 23 bug con causa e fix
- `procedure.md` — installazione, aggancio a `claude`, pubblicazione, diagnosi
- `storico-sessioni.md` — archivio delle sessioni
