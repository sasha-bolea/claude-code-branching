# STATO

**Ultimo aggiornamento:** 2026-07-30 16:45

## Stato attuale

Progetto **funzionante e pubblicato**. Nato e completato in due sessioni (29-30 luglio 2026).

- Repo pubblica: **https://github.com/sasha-bolea/claude-code-branching** (MIT, branch `master`)
- Cartella locale: `C:\Users\sasha\Documents\REPOSITORY\personale\cb`
- `cb` installato come comando globale (`npm link`)
- Agganciato alla funzione `claude` del profilo PowerShell: scrivi `claude`, poi **Ctrl+G**
- **59 prove** con `assert`, nessun framework (`npm test`)

Il workflow richiesto funziona end-to-end: Ctrl+G apre l'albero dei rami, si scegli un punto
(anche intermedio), conversazione **e** file tornano lì in un ramo nuovo, e il ramo precedente
resta nell'albero ripescabile.

## Problemi aperti

- **Commit automatici del codice non installati.** `hooks/cb-commit.ps1` è scritto e provato,
  ma non registrato in `settings.json`. Finché non lo è, il ripristino dei file dipende dai
  checkpoint nativi, che sono legati al session-id e hanno una retention: su rami vecchi il
  codice non torna più indietro. Procedura in `procedure.md`.
- **Cartella vuota residua** `REPOSITORY\cb`: 0 file, handle tenuto da un terminale. Si
  cancella chiudendo quel terminale.
- **Solo Windows.** Il parsing dei transcript è portabile; l'intercettazione dei tasti no
  (win32-input-mode). Su Linux/macOS mai provata.
- **Più terminali sulla stessa cartella**: con avvio `-r`/`--continue` cb ripiega sul
  transcript più recente della cartella e può agganciare la sessione sbagliata. Con l'avvio
  normale non succede, perché l'id lo impone cb.
- **Sessioni troncate accumulate**: ogni cambio ramo crea un `.jsonl`. Nessuna pulizia
  automatica.

## Decisioni

| Data | Decisione | Motivo |
|---|---|---|
| 2026-07-29 | Launcher/wrapper che non parsa mai lo schermo di Claude, solo i transcript | Non si rompe agli aggiornamenti del CLI |
| 2026-07-29 | Ogni scrittura sui transcript è additiva | È il motivo per cui i rami sopravvivono |
| 2026-07-29 | Zero dipendenze tranne `node-pty` | Nessuna toolchain da mantenere |
| 2026-07-29 | Commit automatici su ref nascosti `refs/cb/<sid>/auto` con index temporaneo | Invisibili a `git log`/`status`, non toccano branch né staging |
| 2026-07-30 | Wrapper con pty invece del solo launcher esterno | Era il workflow richiesto: intervenire *dentro* la sessione |
| 2026-07-30 | Scorciatoia configurabile, `ctrl+g` di fatto | Un tasto singolo scatta subito; `esc esc` costa 300 ms e ruba il rewind nativo |
| 2026-07-30 | Albero costruito unendo **tutta la famiglia** di sessioni | Un fork lascia i rami precedenti nel file di partenza |
| 2026-07-30 | Il taglio della conversazione lo scrive cb, non lo chiede al CLI | `--resume-session-at` tronca solo in print mode |
| 2026-07-30 | Log diagnostico **sempre attivo** | Le decisioni sul cambio ramo non sono ricostruibili dallo schermo |
| 2026-07-30 | Repo pubblica con sezione «Prima di usarlo» | Usa flag non documentati e scrive nei transcript: chi la clona deve saperlo |

## Backlog

- Installare l'hook dei commit automatici (il pezzo mancante più utile)
- Pulizia delle sessioni troncate accumulate (`cb prune`?)
- Navigazione a frecce nell'overlay, al posto della scelta per numero
- Vista cross-sessione delle parentele (`cb ls` non mostra le famiglie)
- Verifica su Linux/macOS: il parsing dovrebbe reggere, i tasti no
- Rinominare `master` → `main` (scelta rimandata)

## Riferimenti

- `brief.md` — spec e vincoli scoperti, con i riscontri
- `architettura.md` — stack, componenti, flussi
- `bug-risolti.md` — 14 bug con causa e fix
- `procedure.md` — installazione, aggancio a `claude`, pubblicazione, diagnosi
- `storico-sessioni.md` — archivio delle sessioni
