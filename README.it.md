# cb

[![npm](https://img.shields.io/npm/v/claude-code-branching)](https://www.npmjs.com/package/claude-code-branching)
[![downloads](https://img.shields.io/npm/dm/claude-code-branching)](https://www.npmjs.com/package/claude-code-branching)
[![license](https://img.shields.io/npm/l/claude-code-branching)](LICENSE)

*[English](README.md)*

Branching per conversazioni Claude Code: albero dei rami, catalogo globale, ripresa da
qualsiasi messaggio — compresi i rami che hai abbandonato con un ripristino.

![L'albero di una conversazione, con il menu del ripristino aperto](https://raw.githubusercontent.com/sasha-bolea/claude-code-branching/master/assets/tree.png)

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
cosa riporto indietro?
▸ 1. la conversazione e i file
  2. solo la conversazione (i file restano come sono)
  3. solo i file (la conversazione resta dov'è)

  ←→  il prompt che hai scelto resta inviato, con la risposta che ha avuto
   r  [ ] ricordati questa scelta per le prossime volte
```

`↑↓` scelgono la voce (o le cifre `1-3`), invio conferma. Le prime due ripartono in un ramo
nuovo senza uscire dalla sessione; la terza non riavvia nemmeno Claude, riporta solo i file.
Accanto all'ora del prompt vedi quanto codice quel turno ha cambiato (`+42 -7`).

`←→` decidono una cosa a parte, che vale insieme a tutt'e tre: **dove finisce il prompt che
hai scelto**.

- *resta inviato, con la risposta che ha avuto* — il taglio cade dopo quel turno: riparti da
  lì con la risposta già data. È il modo di sempre.
- *torna nella barra, ancora da inviare* — il taglio cade **prima** del prompt: quel turno
  esce dalla conversazione, i file tornano a com'erano prima che partisse, e il testo ti
  ricompare nella barra di input da correggere e rimandare. È quello che fa il ripristino
  nativo di Claude (Esc Esc). Con «solo i file» vale solo la seconda metà, cioè se le
  modifiche di quel turno restano o se ne vanno.

`r` accende «ricordati questa scelta»: confermando, la preferenza finisce in
`~/.claude/cb/impostazioni.json` (`promptDaRimandare`) e il menu si apre già così le volte
dopo.

Riprendendo una conversazione da fuori (`cb -r`, `cb --scegli`, il tasto `c`) la scelta
sul prompt si fa lo stesso, frecce comprese: sparisce solo la casella. Lì vale per quella
volta, e si riparte **sempre** da «resta inviato» — una preferenza ricordata deciderebbe per
te proprio riaprendo una conversazione di mesi fa, cioè quando non te ne ricordi.

```
cosa riporto indietro?
▸ 1. la conversazione e i file
  2. solo la conversazione (i file restano come sono)
  3. solo i file (la conversazione resta dov'è)

  ←→  il prompt che hai scelto resta inviato, con la risposta che ha avuto
```

⚠️ Il ripristino dei file sovrascrive il lavoro non salvato successivo a quel messaggio.
Con `--senza-file` la voce preselezionata diventa «solo la conversazione».

```
cb                      Claude avvolto: Esc Esc apre l'albero
cb --scegli             prima chiede cartella e conversazione (vedi sotto)
cb --tasto f2           altra scorciatoia ("f2", "esc esc", "ctrl+shift+b")
cb --senza-file         cambiando ramo NON ripristina i file, solo la conversazione
cb --profilo <nome>     lancia con un profilo di variabili (vedi «Profili»)
cb --tasti              stampa i byte dei tasti premuti (diagnosi)
cb ls [filtro]          elenca le sessioni di tutti i progetti
cb tree <sessione>      albero dei rami di una sessione
cb open <sessione> [n]  riprendi da fuori, opzionalmente dal punto n
cb pick                 catalogo interattivo da fuori
cb prune [--esegui]     toglie ciò che cb lascia dietro: sessioni troncate, copie
                        dei file, commit automatici più vecchi di 7 giorni
                        (--giorni N). Senza --esegui dice solo cosa toglierebbe.
                        cb lo fa anche da solo, una volta al giorno, oltre i 2 mesi
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
| `CB_GIORNI_PULIZIA` | età in giorni di ciò che la pulizia automatica toglie (default `60`, con `0` si spegne) |

Ordine di precedenza, per tutte: **variabile d'ambiente → file delle impostazioni → predefinito.**

Per fissare la scorciatoia una volta per tutte: `setx CB_TASTO "f2"` su Windows, oppure
`export CB_TASTO=f2` nel `.bashrc` / `.zshrc`.

### Scegliere cartella e conversazione all'avvio

Con `cb --scegli` cb mette due schermate davanti a Claude: l'albero delle cartelle sotto la
home (radice da `CB_RADICE`), dove `r` alterna avvio normale e ripresa, e —
in ripresa — l'elenco delle conversazioni di quella cartella, ognuna con il suo albero in
cima. `↑↓` scorrono le conversazioni, invio entra nell'albero, dove si sceglie il punto da
cui ripartire. Nel menu che compare lì la scelta su dove finisce il prompt c'è, ma parte
sempre da «resta inviato» e non si può far ricordare: vale per quella volta.

Perché non il selettore di `claude -r`: quello elenca i **file** di sessione, e siccome un
fork ne crea uno nuovo, i rami della stessa conversazione compaiono come conversazioni
diverse. Qui le sessioni si raggruppano per uuid di radice, e una conversazione è tutto il
suo albero.

Le stesse due schermate si riaprono a sessione avviata premendo `c` — dall'albero, o
dall'avviso che compare quando un transcript ancora non c'è. Porta al navigatore delle
cartelle, e lì `r` alterna la ripresa di una conversazione e l'avvio di una nuova. Così
si cambia conversazione, si cambia progetto o si riparte da zero senza chiudere Claude.

**`+` crea una cartella** dentro quella scelta: si scrive il nome, invio la fa. Il cursore ci
va sopra, ma sceglierla resta un gesto a parte — per quello serve invio. Un nome che non si può
usare (con dentro `\ / : * ? " < > |`, oppure `.` e `..`) non viene rifiutato in silenzio: il
campo resta aperto e dice cosa non va, così lo correggi invece di riscriverlo. Una cartella che
esiste già non è un errore: il cursore ci si sposta e basta. Serve per cominciare un progetto
nuovo senza uscire da Claude per fare un `mkdir`.

Se la variabile `CB_CARTELLA_SCELTA` punta a un file, cb ci scrive la cartella scelta: chi
lancia cb può leggerla all'uscita e spostarcisi (un processo figlio non può cambiare la
cartella corrente di chi lo ha lanciato).

Un tasto singolo (`f2`) scatta subito. Una scorciatoia ripetuta (`esc esc`) costa 300 ms
di ritardo sulla prima pressione, il tempo di capire se ne arriva una seconda. Le due
pressioni contano come scorciatoia se arrivano **entro un secondo**: passato quel tempo il
primo Esc è già stato inoltrato e vale come interruzione. Il rovescio è che due interruzioni
distinte, battute a meno di un secondo l'una dall'altra, aprono l'albero.

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
  ──────────────────────────────────────────────────────────────────────
  ◯ riparti da qui   ┳ biforcazione   © compattata
  ──────────────────────────────────────────────────────────────────────

  ⬤━━━⬤━━━⬤━━━⬤━┳━⬤━━━⬤━━━⬤━━━⬤
                ┗━⬤━┳━⬤━━━◯
                    ┗━⬤━━━⬤━━━⬤

  ╭────────────────────────────────────────────────────────────────────╮
  │ 24-07 15:51  +42 -7  riparti da qui                                │
  │ l'app è diventata lentissima, il rendering della lista si blocca    │
  ╰────────────────────────────────────────────────────────────────────╯

  precedenti: 3
    24-07 15:40  aggiungi il filtro per data
    24-07 15:12  rimetti l'ordinamento per nome
    24-07 15:10  facciamo la lista dei clienti

  ──────────────────────────────────────────────────────────────────────
  ←→↑↓ wasd scegli il punto   invio riparti   p coda   n note   i istruzioni   esc/canc esci
```

Nell'albero ci sono solo i prompt che hai scritto tu. Le notifiche dei task in background,
i promemoria di sistema, i comandi slash e il loro output non diventano nodi: nel transcript
sono record `user` come gli altri, ma non sono punti da cui abbia senso ripartire. Restano le
compattazioni (`©`), che dicono dove la storia è stata riassunta. Un turno che hai interrotto
non è un nodo a sé: il prompt che l'ha subita porta scritto `⎋ interrotto`, così sai che la
risposta che ti porti dietro è monca.

`←` `→` risalgono e scendono la conversazione, `↑` `↓` passano da un ramo all'altro della
stessa biforcazione. In alternativa `a` `d` e `w` `s`, se la mano preferisce restare sulle
lettere. Il cursore parte da dove sei adesso. Invio fa nascere un ramo nuovo da quel punto:
quello di prima resta dov'è.

In nessuna schermata di cb il mouse è agganciato: il testo si seleziona e si copia come in un
terminale qualunque, senza tenere premuto shift. Il prezzo è che la rotella non scorre
l'albero — lo fanno le frecce.

**Due tasti per uscire, in ogni schermata di cb.** `esc` risale di un passo: dall'elenco delle
conversazioni torni alle cartelle, dal menu del ripristino torni all'albero — sbagliare tasto
non deve costarti l'uscita. `canc` invece esce da tutto e ti riporta dritto a Claude, da
qualunque profondità, senza risalire le schermate una per una.

**`i` apre le istruzioni della schermata in cui sei**: cosa fa, tutti i suoi tasti, e le cose
che una barra su una riga non può dire — perché nella coda si toglie con `ctrl+canc` e non con
`canc`, o perché le note stanno alla cartella e non alla conversazione. Si legge e si torna
dov'eri, senza perdere il punto in cui stavi. Nella coda e nelle note, dove `i` è una lettera
del testo che stai scrivendo, il tasto è `f1` — che funziona comunque in tutte le schermate.

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

### La coda dei prompt

Un prompt mandato mentre Claude sta ancora rispondendo si accoda da solo, ma **quando** entra
nel contesto lo decide Claude: te ne accorgi perché l'indicatore di caricamento resta sopra
quello che hai appena scritto, e l'unico modo di forzarlo è Esc.

Con `p` dall'albero si apre una coda che tieni tu. Scrivi i prossimi prompt, li vedi in
elenco nell'ordine in cui partiranno, e ne parte **uno per turno**: ognuno vede il lavoro
fatto da quello prima.

```
  cb  coda dei prompt
  partono uno alla volta, quando Claude finisce un turno

  4 prompt in attesa

  ─────────────────────────────────────────────────────────────────────────────────────────
     1. sistemare il test che fallisce
  ─────────────────────────────────────────────────────────────────────────────────────────
     2. aggiornare il README  ⤼ salta
  ─────────────────────────────────────────────────────────────────────────────────────────
  ╭───────────────────────────────────────────────────────────────────────────────────────╮
  │  3. ‖ stop alzare il numero di versione█                                              │
  ╰───────────────────────────────────────────────────────────────────────────────────────╯
  ─────────────────────────────────────────────────────────────────────────────────────────
     4. fare il commit
  ─────────────────────────────────────────────────────────────────────────────────────────
    accoda prompt

  ─────────────────────────────────────────────────────────────────────────────────────────
  invio accoda  ←→ nel testo  ↑↓ scegli e modifica  ctrl+↑↓ sposta  ctrl+canc togli  esc  canc
```

Invio accoda quello che hai scritto e lascia il campo pronto per il prossimo. `↑` `↓` scelgono
un prompt della coda: **il riquadro si sposta su di lui e lo modifichi lì dentro**, come una
nota — accodarlo non è l'ultimo momento per correggerlo, e svuotarlo lo toglie. `←` `→` muovono
il cursore dentro al testo, `shift+invio` va a capo, `ctrl+↑` `ctrl+↓` spostano il prompt su e
giù, `ctrl+canc` lo toglie — backspace resta per correggere una lettera. In fondo c'è sempre il
posto per accodarne uno nuovo, ed è lì che la schermata si apre. Esc torna all'albero, dove
l'avevi lasciato.

Il prompt che partirà per primo è **arancione**: con uno stop o un salta di mezzo non è per
forza il primo dell'elenco, e un colore si vede senza doverlo leggere.

Due interruttori decidono cosa parte davvero, e sono diversi apposta:

- **`ctrl+s` — stop.** È una barriera: quel prompt e **tutti quelli dopo** restano fermi
  finché è acceso. Serve per «da qui in poi aspetta che te lo dica io».
- **`ctrl+x` — salta.** Riguarda un prompt solo, che viene scavalcato finché è acceso; quelli
  dopo continuano a partire. Serve per «questo non ancora».

Si accendono e si spengono con lo stesso tasto, seguono il prompt anche dopo un `/clear` o un
cambio ramo, e un prompt fermo o scavalcato si vede sbiadito nell'elenco: dov'è che la coda si
ferma si legge a colpo d'occhio.

**Dentro cb non serve installare niente.** Il prompt lo scrive cb stesso nella barra di
Claude, seguito da invio: esattamente come lo scriveresti tu, quindi diventa un prompt vero e
un nodo dell'albero da cui puoi ripartire.

Il momento non lo indovina leggendo lo schermo — cb non lo fa mai — ma dal **silenzio
dell'output**: finché Claude lavora l'indicatore si anima e i byte continuano ad arrivare;
quando l'output si ferma per un secondo e mezzo, la risposta è finita e parte il prossimo. Se
Claude è già fermo quando accodi, il prompt parte appena chiudi la schermata.

Finché stai digitando non viene iniettato niente: il testo si mescolerebbe a quello che stai
scrivendo, e l'invio manderebbe il miscuglio.

La coda è legata alla singola sessione, quindi due finestre aperte sulla stessa cartella non
si rubano i prompt. Un `/clear` e i cambi di ramo cambiano l'id di sessione: cb sposta la coda
da sola, e quello che avevi scritto ti segue.

L'hook `hooks/cb-coda.ps1` (più sotto) serve solo a far funzionare la coda **fuori** da cb, in
una sessione Claude lanciata a mano.

### Le note

`n` dall'albero apre le note. Sono legate alla **cartella**, non alla conversazione: le stesse
note si vedono da ogni sessione aperta lì dentro, e restano dopo un `/clear`, un cambio ramo o
una finestra chiusa. È la differenza con la coda, e la ragione per cui esistono — una nota
serve proprio quando la conversazione in cui l'hai scritta è finita.

```
  cb  note
  di C:\Users\tizio\progetti\web — le stesse in ogni sessione qui

  2 note

  ────────────────────────────────────────────────────────────────────────────
    Porte
    la 4310 e la 4311 sono prese da omniroute
  ────────────────────────────────────────────────────────────────────────────
    ricordati di pubblicare prima di toccare i profili
  ────────────────────────────────────────────────────────────────────────────
  ╭──────────────────────────────────────────────────────────────────────────╮
  │ Nota nuova                                                               │
  │                                                                          │
  │ sto scrivendo qui█                                                       │
  ╰──────────────────────────────────────────────────────────────────────────╯

  ────────────────────────────────────────────────────────────────────────────
  invio salva  shift+invio a capo  ctrl+invio manda  ctrl+f cerca  ↑↓ note  esc  canc
```

Ogni nota ha un corpo e un **titolo facoltativo**: il corpo è la nota, il titolo è come la
chiami. La schermata si apre già sulla nota nuova, col cursore nel titolo — se non ti serve,
invio e passi al corpo.

I tre invii fanno tre cose, e sono tutte azioni frequenti:

- **invio** salva la nota e apre subito la prossima, così ne scrivi una dietro l'altra senza
  toccare altro. Dal titolo invece porta al corpo.
- **shift+invio** va a capo dentro il corpo: una nota è un testo, non una riga.
- **ctrl+invio** porta la nota nella barra di input di Claude come `titolo: corpo`, **senza
  inviarla**: torni alla conversazione e il testo è lì, pronto da correggere, completare o
  mandare con un invio. La nota se ne va dall'elenco — l'hai usata, e ritrovarsela domani
  vorrebbe dire non sapere più se è ancora da fare. Il testo non si perde: è nella barra, e
  mandandolo diventa un nodo dell'albero.

`↑` `↓` si spostano fra le note, e quella su cui sei è modificabile subito, **col cursore
sempre nel titolo**: è l'unico dei due campi da cui si raggiunge l'altro, perché dal titolo si
scende al corpo con un invio ma dal corpo non si risale. Quello che stavi scrivendo viene
salvato da solo quando ti muovi. **Per cancellare una nota si svuota** — niente titolo, niente
corpo — così non c'è un tasto in più da imparare.

**`ctrl+f` cerca**, su titolo e corpo insieme: non sempre ti ricordi in quale dei due stava la
parola. `↑` `↓` passano fra le trovate, invio smette di cercare lasciando selezionata quella su
cui sei — pronta da modificare — e ctrl+invio la porta nella barra senza nemmeno uscire dalla
ricerca.

Le note stanno in `~/.claude/cb/note/<cartella>.json`, con lo stesso nome che Claude dà alle
cartelle dei transcript.

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

## Usarlo insieme ad altri strumenti

cb possiede il terminale e legge i file di Claude Code. Che un altro strumento gli conviva
accanto dipende da **dove si mette**:

```
cb            ← sopra: possiede il terminale (pty, tasti, albero, transcript)
  claude      ← il CLI vero, invariato
    un proxy  ← sotto: intercetta le chiamate HTTP e sceglie il provider
```

**Sotto Claude Code** — proxy e router delle API (OmniRoute, claude-code-router, LiteLLM, un
gateway tuo). Funzionano senza cambiare niente. cb non fa nessuna chiamata di rete e passa
l'ambiente intero al pty, quindi `ANTHROPIC_BASE_URL` e il token arrivano al CLI intatti:

```powershell
$env:ANTHROPIC_BASE_URL = "http://localhost:20128/v1"
$env:ANTHROPIC_AUTH_TOKEN = "<il token del gateway>"
cb
```

L'albero, il taglio e il ripristino dei file continuano a funzionare anche se il turno l'ha
risposto un altro modello: il transcript `.jsonl`, i diff in `structuredPatch` e le copie in
`~/.claude/file-history/` li scrive il CLI, non chi ha risposto. Due cose da sapere: un router
con provider gratuiti «keyless» manda i tuoi prompt — e il codice che ci sta dentro — a terzi
che non hai scelto uno per uno; e un proxy che comprime le richieste significa che il contesto
che Claude ha davvero visto può essere meno di quello che l'albero mostra. Se un ramo sembra
smemorato, la causa sta lì, non in cb.

**Sopra Claude Code** — wrapper di terminale, TUI, multiplexer di sessioni. Di solito
confliggono, perché a cb servono tre cose in esclusiva:

1. **Lo stdin e il pty.** cb legge i tasti prima di Claude; due wrapper che vogliono lo stdin
   non convivono.
2. **L'eseguibile nativo.** cb cerca `claude.exe`, mai lo shim npm: node-pty non lancia i
   `.ps1`/`.cmd`. Uno strumento che espone solo uno shim o una funzione di shell non è
   lanciabile da cb.
3. **I transcript veri** in `~/.claude/projects/`. Uno strumento che reimplementa il client, o
   che tiene la conversazione in un formato suo, toglie a cb l'unica cosa che legge.

**Sopra cb** — questo invece è previsto: è così che funziona la funzione `claude` qui sopra.
Il contratto è il codice di uscita. **78** vuol dire che cb non è partito e il chiamante deve
ripiegare su Claude diretto; qualsiasi altro codice è l'uscita di Claude e non va rilanciato.

### Profili: cambiare provider senza perdere la conversazione

Impostare le variabili prima di lanciare cb funziona, ma per cambiarle bisogna uscire. Un
**profilo** è un insieme di variabili con un nome, e cb sa rilanciare Claude con un altro
profilo **senza muovere la conversazione**. È l'unica cosa che dalla shell non si può fare:
le variabili le legge il processo all'avvio, e il processo lo possiede cb.

In `~/.claude/cb/impostazioni.json`:

```json
{
  "profili": {
    "gateway": {
      "ANTHROPIC_BASE_URL": "http://localhost:20128",
      "ANTHROPIC_MODEL": "un-modello-del-gateway"
    },
    "diretto": {
      "ANTHROPIC_BASE_URL": null
    }
  }
}
```

`null` (o `""`) **toglie** la variabile invece di sovrascriverla: serve quando è l'ambiente
di partenza ad avere qualcosa che il profilo deve rimuovere.

Dall'albero, `m` apre l'elenco:

```
con quale profilo?
    Claude, come l'hai lanciato
  ▸ gateway
    diretto

  la conversazione resta dov'è: riparte solo il processo
```

Confermando, cb chiude Claude e lo riapre sulla **stessa** sessione con l'ambiente nuovo.
Nessun taglio, nessun ripristino di file: la conversazione continua dov'era. Per partire già
con un profilo: `cb --profilo gateway`.

Lo si sceglie anche negli altri due punti in cui l'albero non c'è:

- **prima del primo scambio**, dalla schermata che avvisa che il transcript non esiste ancora
  — è anzi il momento migliore, perché non c'è una conversazione da portarsi dietro;
- **nel navigatore delle cartelle**, dove `m` alterna i profili in intestazione come `r`
  alterna ripresa e avvio normale. Lì decidi dove lavorare e con cosa nello stesso passo, e
  Claude parte già configurato.

Ogni processo nasce dalla fotografia dell'ambiente che cb aveva all'avvio, con sopra il
profilo attivo. Per questo tornare a «Claude, come l'hai lanciato» rimette esattamente le
condizioni di partenza, e le variabili aggiunte da un profilo spariscono da sole.

Due cose da sapere:

- **I valori stanno in chiaro in un file di configurazione.** Per i segreti conviene lasciarli
  alla shell e mettere nel profilo solo ciò che non è una credenziale. cb non scrive mai i
  valori nel log: del cambio di profilo registra solo il nome.
- **Cambiare provider a conversazione lunga può fallire subito**, se il nuovo ha una finestra
  di contesto più piccola di quanto è già occupato. cb non può prevederlo, ma se il processo
  rilanciato muore entro pochi secondi te lo dice invece di sparire.

Senza `profili` nel file, `m` non apre niente: chi non li configura non vede la funzione.

Per verificare una configurazione in fretta, `cb ls` e `cb tree <sessione>` leggono solo il
disco: dopo qualche turno ti dicono subito se i transcript sono ancora quelli che cb si
aspetta.

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

## Coda dei prompt fuori da cb (opzionale, Windows)

**Non serve se usi cb**: dentro il wrapper la coda parte da sola (vedi *La coda dei prompt*).
`hooks/cb-coda.ps1` è l'hook `Stop` che la fa funzionare in una sessione Claude lanciata a
mano: a fine turno prende il primo prompt in attesa, lo passa a Claude e lo toglie dall'elenco.

L'hook e cb non si pestano i piedi: cb mette `CB_CODA_PTY=1` nell'ambiente di Claude, e l'hook
la eredita e si fa da parte. Senza quella variabile — cioè fuori da cb — consegna lui.

Installazione: aggiungi in `~/.claude/settings.json` sotto `hooks.Stop`, **prima** di
`cb-commit.ps1` se hai anche quello — così il turno che il prompt farà proseguire viene
salvato quando finisce davvero:

```json
{
  "type": "command",
  "command": "pwsh -NoProfile -ExecutionPolicy Bypass -File \"C:/percorso/di/cb/hooks/cb-coda.ps1\"",
  "timeout": 15
}
```

⚠️ L'hook gira su **ogni** sessione Claude: se per quella sessione non c'è una coda, esce
subito senza scrivere niente.

Consegna con `{"decision":"block","reason":"<prompt>"}`, che è l'unico modo che gli hook danno
per far proseguire una conversazione. Il testo arriva quindi come motivo del blocco e **non**
come un prompt digitato: per questa strada nell'albero non diventa un nodo. È la differenza
con la consegna dentro cb, che invece lo scrive nella barra.

Le code stanno in `~/.claude/cb/coda/<sessione>.json`. Non esiste ancora l'equivalente per
macOS e Linux.

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

## Sostenere il progetto

cb è gratuito, MIT, e scritto la sera. Se ti ha restituito una conversazione che davi per
persa, [sponsorizzarlo](https://github.com/sponsors/sasha-bolea) è ciò che lo tiene al passo
con un CLI che cambia ogni settimana.

Una stella sul repo non costa niente, ed è ciò che permette agli altri di trovarlo.

## Licenza

MIT — vedi [LICENSE](LICENSE).
