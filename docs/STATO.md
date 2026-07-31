# STATO

**Ultimo aggiornamento:** 2026-07-31 18:19

## Stato attuale

Progetto **funzionante e pubblicato**. Nato e cresciuto in cinque sessioni (29-31 luglio 2026).

- Repo pubblica: **https://github.com/sasha-bolea/claude-code-branching** (MIT, branch `master`)
- Cartella locale: `C:\Users\sasha\Documents\REPOSITORY\personale\cb`
- `cb` installato come comando globale (`npm link`), agganciato alla funzione `claude` del
  profilo PowerShell: scrivi `claude`, poi **F2**
- **121 prove** con `assert` più i due selettori, nessun framework (`npm test`)
- Hook dei commit automatici **installato** in `~/.claude/settings.json` (vedi `procedure.md`)

Il workflow funziona end-to-end. Scrivendo `claude`: cb chiede dove lavorare, poi quale
conversazione riprendere (una conversazione è tutta la sua famiglia di sessioni), poi da quale
punto ripartire. Dentro la sessione **F2** riapre lo stesso albero; `c`/`p` riportano ai due
selettori senza chiudere Claude.

Premendo invio su un punto si sceglie **cosa riportare indietro**: conversazione e codice, solo
la conversazione, solo il codice. Con «solo il codice» Claude non viene nemmeno riavviato.

**Il codice segue la conversazione** leggendo l'archivio di copie di Claude (che non usa git:
vedi `architettura.md`), con due ripieghi: le copie che cb fa prima di sovrascrivere, e i commit
automatici su ref nascosti, agganciati all'albero per uuid del messaggio.

## Problemi aperti

- **Copertura parziale del ripristino.** L'archivio di Claude contiene solo i file che *Claude*
  ha toccato: modifiche a mano, altri terminali, build, `npm install` non ci sono. Ripristinare
  un punto dà un albero **misto** — i file di Claude com'erano allora, il resto com'è adesso.
  I commit automatici coprono tutto il working tree, ma oggi sono solo un ripiego per le copie
  scadute, non la sorgente principale.
- **Nessuna pulizia, da nessuna parte.** L'archivio di cb cresce a ogni ripristino (copie
  integrali, nessuna deduplica); i ref `refs/cb/*` non scadono; le sessioni troncate si
  accumulano (19 in venti minuti di prove). Serve un `cb prune` che li tenga tutti e tre.
- **Non si può guardare dentro agli archivi.** Nessun `cb files`, nessuna anteprima di «cosa
  cambierà», nessun annulla. Se un ripristino sovrascrive del lavoro, la copia c'è ma va
  ripescata a mano dall'indice.
- **Nessuna atomicità nel ripristino**: se una scrittura fallisce a metà (permessi, file
  bloccato) l'albero resta misto e nessuno lo riporta indietro.
- **Scadenza dell'archivio nativo (~30 giorni)**: dedotta dalle date delle cartelle e da
  `.last-cleanup`, non dalla documentazione. La politica esatta non è verificata.
- **L'hook gira su ogni sessione in ogni repo git**, non solo qui: in un repo con file grossi
  non ignorati l'`add -A` a fine turno si sente.
- **Il conteggio dei messaggi nell'elenco delle conversazioni è una stima** (il file più lungo
  della famiglia); il numero esatto compare in cima quando la conversazione è selezionata.
- **Glifi a larghezza incerta.** `⬤ ◯ ━ ┳ ┃ ┣ ┗` sono "East Asian Ambiguous": un terminale che
  li rendesse a doppia larghezza sfaserebbe il rientro dei rami. Sono in cima a `src/vista.js`.
- **Solo Windows.** Il parsing è portabile, l'intercettazione dei tasti no (win32-input-mode).
- **Più terminali sulla stessa cartella**: con avvio `-r`/`--continue` cb ripiega sul transcript
  più recente e può agganciare la sessione sbagliata.
- **Il selettore delle conversazioni rilegge la famiglia a ogni selezione** (cache in memoria per
  la durata della schermata). Su conversazioni da 2000 messaggi si sente.

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
| 2026-07-31 | I selettori di cartella e conversazione stanno **dentro cb** | Una cosa sola da mantenere, e la stessa tavolozza |
| 2026-07-31 | Una conversazione = tutta la famiglia, raggruppata per **uuid di radice** | È l'unica chiave che il fork copia insieme alla storia |
| 2026-07-31 | Il ripristino **legge** l'archivio di Claude invece di chiamare `--rewind-files` | Niente processo da lanciare, e si vede tutta la famiglia invece di una sessione sola |
| 2026-07-31 | Regola unica: lo stato a T è la **prima copia con `backupTime ≥ T`** | Ogni copia è il "prima" di una modifica: è l'unica lettura coerente dell'archivio |
| 2026-07-31 | cb **copia prima di sovrascrivere**, nel proprio archivio | Nell'archivio di Claude non c'è mai lo stato finale di un file: senza, non si torna avanti |
| 2026-07-31 | Fuori dalla cartella di lavoro **non si scrive** | Nell'archivio finiscono anche il profilo PowerShell e i file di memoria |
| 2026-07-31 | Menu a tre voci sul punto scelto, come Esc Esc | La domanda è la stessa, e una sola interfaccia ovunque |
| 2026-07-31 | «Solo codice» **non riavvia Claude** | La conversazione non cambia: non c'è niente da ricaricare |
| 2026-07-31 | I rami si disegnano in profondità e **da destra a sinistra** | È l'unico ordine in cui nessuna discesa incrocia un altro ramo |
| 2026-07-31 | L'uuid del messaggio nel corpo del commit automatico | Senza aggancio, i commit sono uno storico ispezionabile ma inutilizzabile |
| 2026-07-31 | I commit sono un **ripiego per file**, non un ripristino d'albero | Riportare indietro tutto sovrascriverebbe ciò che il ripristino non doveva toccare |
| 2026-07-31 | Verde e rosso con la stessa saturazione e luminosità dell'arancione | La tavolozza distingue per tinta, non per luminosità |

## Backlog

- **`cb prune`**: sessioni troncate, archivio di cb, ref `refs/cb/*` — i tre accumuli
- **Usare i commit come sorgente e non solo come ripiego**, per coprire i file che Claude non ha
  toccato (serve decidere cosa fare delle modifiche non versionate)
- **Ispezione degli archivi**: `cb files <punto>`, anteprima delle modifiche prima di premere
  invio, annulla dell'ultimo ripristino
- Portare la vista orizzontale anche a `cb tree`/`pick` (oggi usano l'elenco numerato)
- Un comando che apra il selettore delle conversazioni da fuori (`cb riprendi`)
- Verifica su Linux/macOS: parsing e codifiche ANSI dovrebbero reggere, il resto no
- Valutare lo scorrimento "fermo finché non tocchi il bordo" al posto del cursore centrato
- Rinominare `master` → `main` (scelta rimandata)

## Riferimenti

- `brief.md` — spec e vincoli scoperti, con i riscontri
- `architettura.md` — stack, componenti, flussi, archivio delle copie, vista dell'albero
- `bug-risolti.md` — 28 bug con causa e fix (grep-abile)
- `procedure.md` — installazione, aggancio a `claude`, hook dei commit, pubblicazione, diagnosi
- `storico-sessioni.md` — archivio delle sessioni
