# Brief — cb

## Cosa costruiamo

Un sistema di versionamento per le conversazioni di Claude Code: poter tornare indietro a
un messaggio passato *e* poter tornare avanti, dividendo la chat in rami separati da cui
proseguire su strade diverse.

## Perché

Claude Code offre "restore code and conversation" (Esc Esc): ripristina la conversazione a
un messaggio precedente. Ma è un'operazione a senso unico — l'interfaccia non offre più
alcun modo di raggiungere i prompt e le risposte che si sono lasciati indietro, né mostra
che esistono. Non nasce un ramo: nasce un vicolo cieco all'indietro.

Il workflow voluto:

1. Esc Esc → storico conversazione
2. ripristino la conversazione a un messaggio passato (fin qui Claude fa lo stesso)
3. **si crea un ramo nuovo**
4. **il ramo di prima non si cancella e volendo posso sempre riprenderlo in mano**

Più un catalogo: salvare, caricare e catalogare le conversazioni di tutti i progetti, e il
codice che le accompagna.

## Vincoli scoperti in fase di analisi

Verificati sul CLI v2.1.220 installato, non assunti. Determinano l'intera architettura.

1. **I transcript sono append-only.** Al ripristino Claude non cancella: appende record
   con `parentUuid` che punta al messaggio scelto. L'albero dei rami **esiste già** nei
   file. Non c'è niente da salvare, solo da leggere e mostrare.
   Riscontro: in `d19054ba-….jsonl` 7 biforcazioni, una con 3 rami distinti (24/07 e 29/07).

2. **Il rewind è puramente in memoria** e non emette alcun evento hook. Nessun hook può
   accorgersi che è avvenuto: l'unica via per intercettare quel gesto sarebbe la tastiera.

3. **Esistono i flag per ripartire da un messaggio qualsiasi**, non documentati in `--help`
   ma implementati: `--resume-session-at <uuid>`, `--fork-session`, `--rewind-files`.
   L'unico vincolo nel binario è che richiedono `--resume`; il riferimento a "print mode"
   nell'help non è validato, il fork interattivo funziona.

4. **`--resume-session-at` vede solo la catena attiva.** Su un nodo di un ramo abbandonato
   il CLI risponde `No message found with message.uuid of: …`. È il vincolo centrale: il
   caso d'uso principale non è coperto dai flag da soli.
   → Risolto appendendo un record `last-prompt` con `leafUuid` sulla foglia del ramo
   voluto, che lo rende di nuovo la catena attiva. Verificato end-to-end.

5. **Quello che si perde davvero è il codice.** I checkpoint nativi sono legati al
   session-id: al fork nasce un id nuovo e non lo seguono, e hanno una retention.
   → Da qui i commit automatici su ref git nascosti.

## Scelte

| Scelta | Decisione | Motivo |
|---|---|---|
| Interfaccia | Launcher, non wrapper | Non parsa mai l'output di Claude: non si rompe agli aggiornamenti del CLI |
| Scope | Globale, tutti i progetti | Il catalogo richiesto è trasversale |
| Codice | Commit automatici git | Richiesto esplicitamente |
| Quando committare | Fine turno con modifiche | 1 commit = 1 nodo dell'albero |
| Dove committare | Ref nascosti `refs/cb/<sid>/auto` | Invisibili agli strumenti quotidiani, nessun checkout per cambiare ramo |
| Staging | Index temporaneo (`GIT_INDEX_FILE`) | L'area di staging reale non viene mai toccata |
| Stack | Node.js, zero dipendenze | Nessuna toolchain da mantenere |

## Fuori scope per ora

- Wrapper PTY con hotkey che sostituisce Esc Esc (valutato, rimandato: fragile e non
  necessario per il workflow)
- Vista cross-sessione delle parentele tra fork (`forkParentSessionId`)
- Navigazione a frecce nella TUI
