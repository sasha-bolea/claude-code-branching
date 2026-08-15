// Testi visibili all'utente, in inglese e in italiano.
//
// Stanno tutti qui e non sparsi nel codice per due motivi: una stringa scritta
// altrove sarebbe una stringa non tradotta, e le varianti accorciate (legende,
// barre dei tasti) vanno confrontate fra loro per lunghezza, cosa che si fa solo
// vedendole vicine.
//
// Regola per chi traduce: **la variante inglese non deve essere piu' lunga
// dell'italiana**. Chi disegna sceglie la prima variante che entra nella
// larghezza del terminale (`primaCheEntra` in vista.js): una traduzione piu'
// lunga farebbe perdere una variante sui terminali stretti.

import { impostazione } from './impostazioni.js';

// Glifi dell'albero, ripetuti nelle legende. Restano in vista.js, che li disegna:
// qui servono solo per comporre il testo della legenda.
const VUOTO = '◯';
const FORCA = '┳';
const COMPATTAZIONE = '©';

export const EN = {
  aiuto: (scorciatoia) => `
cb — branching for Claude Code conversations

  cb                    Claude wrapped: ${scorciatoia} opens the branch tree
  cb --scegli           ask first where to work (project tree; root from
                        CB_RADICE, "r" toggles normal start and resume).
                        On resume it lists that folder's conversations, each
                        with its own tree: ↑↓ pick, enter goes into the tree
  cb --tasto <key>      same, with another shortcut: "f2", "esc esc", "ctrl+shift+b"
                        (function keys are free; ctrl+g is taken by Claude Code)
  cb --senza-file       on a branch switch do NOT restore files, only the conversation
  cb --tasti            print the bytes of the keys pressed, and write
                        ~/.claude/cb/diagnosi.log (combinable: cb --tasti --tasto f2)
  cb ls [filter]        list the sessions (filter on project or prompt)
  cb tree <session>     show the branch tree of a session
  cb open <session> [n]   resume a session from outside, optionally from branch n
  cb pick               interactive catalogue: pick a session, then a branch
  cb prune [--giorni N] [--esegui]
                        remove what cb leaves behind and never expires: truncated
                        sessions, file copies, auto commits. Older than N days
                        (7); without --esegui it only shows what it would remove.
                        cb does it by itself too, once a day, over 2 months
                        (CB_GIORNI_PULIZIA, 0 turns it off)
  cb --impostazioni     settings screen: language, work folder, shortcut
                        (it opens by itself the first time)
  cb --version          version number
  cb --help             this text

In the tree inside a session: ←→ (or a/d) move along the conversation, ↑↓ (or
w/s) switch branch, enter restarts from there, esc goes back to Claude. From
there "c" opens the folder navigator, where "r" switches between resuming
a conversation and starting a new one: you change conversation, project or start
over without closing Claude. The commands above use the
numbered list, so that "cb open <session> 3" has a number to refer to.
Set the shortcut once and for all with the CB_TASTO variable, and the language
with CB_LINGUA (en, it).
<session> = full id, id prefix, or path of the .jsonl
`,

  // bin/cb.js — comandi da fuori
  comandi: {
    nessunaSessione: 'No session found in ~/.claude/projects.',
    sessioneNonTrovata: (id) => `Session not found: ${id}`,
    ramoNonValido: (n, massimo) => `Branch ${n} is not valid (1-${massimo}).`,
    comandoSconosciuto: (comando) => `Unknown command: ${comando}`,
    quanteSessioni: (n) => `${n} sessions`,
    sceltaNonValida: 'Invalid choice.',
    chiediSessione: (massimo) => `\nSession (1-${massimo}): `,
    chiediPunto: (massimo) => `Restart from point (1-${massimo}, enter = continue the active branch): `,
    ramoRiattivato: (foglia) => `\n  abandoned branch reactivated (leaf ${foglia})`,
    legendaElenco: '● = active branch   ⑂ = fork',
  },

  // bin/cb.js — cb prune
  pulizia: {
    anteprima: (giorni) => `\ncb prune — older than ${giorni} days (nothing removed yet)\n`,
    fatto: (giorni) => `\ncb prune — older than ${giorni} days\n`,
    sessioni: 'truncated sessions',
    copie: 'file copies of cb',
    ref: 'auto commits',
    quantiFile: (n, dim) => `${n} files, ${dim}`,
    quantiRef: (n) => `${n} refs`,
    tolti: (n) => `${n} removed`,
    nienteDaTogliere: 'Nothing to remove.',
    comeProcedere: '\ncb prune --esegui to remove them',
    dopoRef: 'the commits free their space with: git gc --prune=now',
    fuoriRepo: '(not a git repository: auto commits not checked)',
    giorniNonValidi: 'The value of --giorni must be a positive number.',
  },

  // src/vista.js — l'albero dentro la sessione
  albero: {
    legenda: [
      `${VUOTO} restart here   ${FORCA} fork   ${COMPATTAZIONE} compacted`,
      `${VUOTO} restart here   ${FORCA} fork`,
      `${VUOTO} restart here`,
    ],
    vociRipristino: [
      'the conversation and the files',
      'the conversation only (files stay as they are)',
      'the files only (the conversation stays where it is)',
    ],
    titolo: 'branches of the conversation',
    titoloCorto: 'tree',
    escLunga: 'back to Claude',
    escCorta: 'exit',
    // Le due parole dell'uscita, uguali in ogni schermata: esc risale di un
    // passo, canc esce da tutto. Vedi `uscita` in vista.js.
    indietro: 'back',
    esci: 'exit',
    righeSopra: (n) => `↑ ${n} rows above`,
    righeSotto: (n) => `↓ ${n} rows below`,
    promptPrima: (n) => `← ${n} prompts back`,
    promptDopo: (n) => `${n} prompts ahead →`,
    ripartiDaQui: 'restart here',
    compattazione: '© conversation compacted',
    // Il turno di questo prompt e' stato fermato a meta': la risposta che porta
    // con se' e' monca. Non e' un nodo a parte — da un'interruzione non si
    // riparte — ma va detto prima di sceglierlo.
    interrotto: '⎋ interrupted',
    precedenti: (n) => `earlier: ${n}`,
    riportaIndietro: 'what do I roll back?',
    // Il prompt scelto: due stati, e si mostra per intero quello attivo. E' una
    // frase e non un'etichetta perche' deve dire cosa succedera', non nominare
    // un'opzione.
    promptInviato: [
      'the prompt you picked stays sent, with the answer it got',
      'the prompt stays sent, with its answer',
      'the prompt stays sent',
    ],
    promptDaRimandare: [
      'the prompt you picked comes back in the bar, still unsent',
      'the prompt comes back in the bar, unsent',
      'the prompt comes back in the bar',
    ],
    ricordaScelta: [
      'remember this for next time',
      'remember this choice',
      'remember',
    ],
    legendaMenu: [
      '↑↓ pick   ←→ the prompt   1-3 direct choice   enter confirm   i help   esc back   canc exit',
      '↑↓ pick  ←→ the prompt  1-3 direct choice  enter confirm  i help  esc back  canc exit',
      '↑↓ pick  ←→ prompt  enter confirm  i help  esc back  canc exit',
      '↑↓ ←→ enter  i help  esc back  canc exit',
      '↑↓ ←→ enter  i  esc back  canc exit',
    ],
    invioConFile: 'enter restart',
    invioSenzaFile: 'enter restart (files stay as they are)',
    // Le quattro frecce in una voce sola: erano due ("←→ avanti e indietro",
    // "↑↓ cambia ramo"), ma sono lo stesso gesto e dividerle costringeva a
    // leggere due voci per capire come ci si muove.
    //
    // «Il punto» e non «spostati»: le frecce non servono a spostarsi, servono a
    // scegliere il punto da cui ripartire — ed e' la stessa parola con cui
    // l'albero lo chiama dappertutto («riparti da qui», «il punto scelto»).
    // Dove portino le singole direzioni lo dice l'albero stesso, che e'
    // orizzontale nei prompt e verticale nei rami.
    puntoLungo: '←→↑↓ wasd pick the point, across prompts and branches',
    punto: '←→↑↓ wasd pick the point',
    puntoCorto: '←→↑↓ pick the point',
    frecce: '←→↑↓',
    invioRiparti: 'enter restart',
    // L'uscita arriva gia' composta: puo' essere un tasto solo o due (vedi
    // `uscita` in vista.js).
    barraMinima: (uscita) => `←→↑↓ the point  enter restart  ${uscita}`,
    // Tasti in piu' disponibili solo dentro la sessione, e nome dell'uscita
    // quando l'albero e' stato aperto dal selettore delle conversazioni.
    extraLunga: 'c folder and conversation   m profile   p queue   n notes   i help',
    extraCorta: 'c other conv.   m profile   p queue   n notes   i help',
    // Profili: si vedono solo se ne hai configurato almeno uno.
    qualeProfilo: 'which profile?',
    profiloBase: "Claude, the way you launched it",
    profiloResta: 'the conversation stays where it is: only the process restarts',
    legendaProfili: [
      '↑↓ pick   enter confirm   i help   esc back   canc exit',
      '↑↓ pick  enter confirm  i help  esc back  canc exit',
      '↑↓ pick  enter  i help  esc back  canc exit',
      '↑↓ enter  i help  esc back  canc exit',
      '↑↓ enter  i  esc back  canc exit',
    ],
    escElencoLunga: 'back to the list',
    escElencoCorta: 'list',
  },

  // src/coda.js — la coda dei prompt che partono da soli a fine turno
  coda: {
    titolo: 'prompt queue',
    sottotitolo: 'they go out one at a time, when Claude finishes a turn',
    vuota: 'the queue is empty: write below and press enter',
    quanti: (n) => (n === 1 ? '1 prompt waiting' : `${n} prompts waiting`),
    // La pausa per i token va detta qui e non solo nel diagnosi.log: una coda
    // ferma e una coda che non parte si assomigliano troppo, e senza l'ora del
    // reset si finisce per credere che sia rotta.
    // Due varianti, dalla piu' lunga alla piu' corta, come le legende: su un
    // terminale stretto a essere tagliata era la **coda** della riga, cioe'
    // proprio l'ora — e «in pausa» senza un «fino a quando» dice meno di niente.
    // Il glifo e' `‖` e non un'emoji: un terminale che le rende a doppia
    // larghezza sfaserebbe la riga di una colonna.
    inPausa: (ora) => [`paused · out of tokens, resuming at ${ora}`, `‖ ${ora}`],
    // Il posto in fondo resta annunciato anche quando il cursore sta su un
    // altro prompt: senza, l'elenco sembrerebbe finire con l'ultimo. Dice cosa
    // ci si fa — accodare — e non come si chiama la riga.
    nuovo: 'queue a prompt',
    // Righe che non ci stanno a schermo, come nelle note: si dice invece di
    // tagliare zitti, o un elenco troncato in silenzio si legge come completo.
    fuoriSchermo: (n) => `${n} more lines, ↑↓ to see them`,
    // Il prompt che partira' per primo si riconosce dal colore: era scritto
    // accanto («next»), ma una parola in piu' su una riga dell'elenco si legge
    // peggio di un colore, che si vede senza leggere.
    // Gli interruttori, come compaiono accanto al prompt che li porta.
    // La barra doppia e non il pulsante di pausa (U+23F8): quello e' un emoji,
    // e un terminale che lo rende a doppia larghezza sfasa la riga di una
    // colonna. Come i glifi dell'albero, si sta in una cella sola.
    marchioStop: '‖ stop',
    marchioSalta: '⤼ skip',
    // Vedi la nota sulla tabella italiana: la scala perde voci intere, non le
    // parole che le spiegano.
    legende: [
      'enter queue   shift+enter new line   ←→ in the text   ↑↓ pick and edit   ctrl+↑↓ move   ctrl+s stop   ctrl+x skip   ctrl+canc remove   f1 help   esc back   canc exit',
      'enter queue  shift+enter new line  ←→ in the text  ↑↓ pick and edit  ctrl+↑↓ move  ctrl+s stop  ctrl+x skip  ctrl+canc remove  f1 help  esc back  canc exit',
      'enter queue  shift+enter new line  ←→ in the text  ↑↓ pick and edit  ctrl+↑↓ move  ctrl+s/x stop,skip  ctrl+canc remove  f1 help  esc back  canc exit',
      'enter queue  shift+enter new line  ←→ in the text  ↑↓ edit  ctrl+↑↓ move  ctrl+s/x stop,skip  ctrl+canc remove  f1 help  esc back  canc exit',
      'enter queue  shift+enter new line  ←→ in the text  ↑↓ edit  ctrl+canc remove  f1 help  esc back  canc exit',
      'enter queue  shift+enter new line  ←→ in the text  ctrl+canc remove  f1 help  esc back  canc exit',
      'enter queue  ←→ in the text  ctrl+canc remove  f1 help  esc back  canc exit',
      // Vedi le note: l'ultima tiene f1 e lascia cadere il resto.
      'enter queue  ←→ in the text  f1 help  esc back  canc exit',
    ],
    // Cosa l'hook antepone al prompt quando lo consegna a Claude: senza, un
    // prompt breve arriva senza contesto e sembra una frase caduta dal nulla.
    intestazione: 'Queued by the user while you were working. Do this now:',
  },

  // src/note.js — le note della cartella di lavoro
  note: {
    titolo: 'notes',
    // Il legame con la cartella e non con la conversazione e' la cosa meno
    // ovvia della schermata, ed e' la ragione per cui esiste: va detto in cima.
    sottotitolo: (cartella) => `of ${cartella} — the same in every session here`,
    vuota: 'no note yet: write a title, enter, then the body',
    quante: (n) => (n === 1 ? '1 note' : `${n} notes`),
    // Solo il titolo si annuncia facoltativo: e' l'informazione che serve, perche'
    // e' il campo che si puo' saltare. Scrivere «obbligatorio» sull'altro
    // ripeterebbe la stessa cosa al contrario.
    titoloNota: 'title (optional)',
    corpo: 'body',
    // Il posto della nota nuova resta annunciato in fondo anche quando il cursore
    // sta altrove: senza, l'elenco sembrerebbe finire con l'ultima nota.
    nuova: 'new note',
    // Righe che non ci stanno a schermo. Si dice invece di tagliare zitti: un
    // elenco troncato in silenzio si legge come un elenco completo.
    fuoriSchermo: (n) => `${n} more lines, ↑↓ to see them`,
    cerca: 'search: ',
    quanteTrovate: (n) => (n === 1 ? '1 match' : `${n} matches`),
    nessunaCorrispondenza: 'no note matches',
    // Quante sono segnate per la cancellazione: e' il numero che ctrl+canc
    // toglierebbe, e va saputo anche quando sono scorse fuori dallo schermo.
    quanteSegnate: (n) => (n === 1 ? '1 marked' : `${n} marked`),
    legendeRicerca: [
      'type to search   ↑↓ move through the matches   ctrl+enter to the bar   enter edit this one   ctrl+space mark   ctrl+canc delete   f1 help   esc back   canc exit',
      'type to search  ↑↓ matches  ctrl+enter to the bar  enter edit  ctrl+space mark  ctrl+canc delete  f1 help  esc back  canc exit',
      'type to search  ↑↓ matches  ctrl+enter to the bar  ctrl+space mark  ctrl+canc delete  f1 help  esc back  canc exit',
      'type to search  ↑↓ matches  ctrl+enter bar  ctrl+canc delete  f1 help  esc back  canc exit',
      'search  ↑↓ matches  ctrl+canc delete  f1 help  esc back  canc exit',
      'search  ↑↓ matches  f1 help  esc back  canc exit',
    ],
    // Vedi la nota sulla tabella italiana: si perdono voci intere, mai le parole
    // che le spiegano.
    legende: [
      'enter title→body, then save   shift+enter new line   ←→ in the text   ctrl+enter into the bar   ctrl+f search   ctrl+space mark   ctrl+canc delete   ↑↓ notes   f1 help   esc back   canc exit',
      'enter save  shift+enter new line  ←→ in the text  ctrl+enter into the bar  ctrl+f search  ctrl+space mark  ctrl+canc delete  ↑↓ notes  f1 help  esc back  canc exit',
      'enter save  shift+enter new line  ←→ in the text  ctrl+enter bar  ctrl+f search  ctrl+space mark  ctrl+canc delete  f1 help  esc back  canc exit',
      'enter save  shift+enter new line  ←→ in the text  ctrl+enter bar  ctrl+f search  ctrl+canc delete  ↑↓ notes  f1 help  esc back  canc exit',
      'enter save  shift+enter new line  ←→ in the text  ctrl+enter bar  ctrl+f search  ctrl+canc delete  f1 help  esc back  canc exit',
      'enter save  shift+enter new line  ←→ in the text  ctrl+f search  ctrl+canc delete  f1 help  esc back  canc exit',
      'enter save  shift+enter new line  ←→ in the text  ctrl+f search  f1 help  esc back  canc exit',
      'enter save  ←→ in the text  ctrl+f search  f1 help  esc back  canc exit',
      // L'ultima tiene f1 e lascia cadere il resto: vedi la tabella italiana.
      'enter save  ←→ in the text  f1 help  esc back  canc exit',
    ],
  },

  // src/configura.js — schermata delle impostazioni, al primo avvio
  configura: {
    titolo: 'settings',
    sottotitolo: 'chosen once, remembered — cb --impostazioni to come back',
    voci: {
      lingua: 'language',
      radice: 'work folder',
      scorciatoia: 'shortcut',
      fatto: 'done',
    },
    nomiLingua: { it: 'italiano', en: 'English' },
    scegliCartella: 'enter to type it',
    consigliata: 'recommended',
    // Avviso su "esc esc": e' anche la scorciatoia di Claude, e cb la copre solo
    // se i due Esc arrivano entro la finestra.
    avvisoEscEsc: (ms) => [
      `esc esc is Claude's own rewind too: cb takes it over if the two arrive`,
      `within ${ms / 1000}s. Slower, and Claude's menu opens instead of the tree.`,
      'Two separate interrupts closer than that open the tree as well.',
    ],
    nonEsiste: 'this folder does not exist',
    legende: [
      '↑↓ pick the setting   ←→ change   enter acts on the row   i help   esc keep these',
      '↑↓ setting   ←→ change   enter acts   i help   esc keep',
      '↑↓ ←→ enter  i help  esc keep',
      '↑↓ ←→ enter  i  esc keep',
    ],
    legendeTesto: [
      'type the path   ~ is your home   enter confirms   f1 help   esc leaves it as it was',
      'type the path   enter ok   f1 help   esc back',
      'enter ok   f1 help   esc back',
      'enter ok   f1   esc back',
    ],
  },

  // src/cartelle.js — selettore della cartella di lavoro
  cartelle: {
    legende: [
      '↑↓ scroll   →← open/close   space open/close   r switch mode   enter confirm   i help   + new folder   esc back   canc exit',
      '↑↓ scroll  →← open/close  space open/close  r switch mode  enter confirm  i help  + new folder  esc back  canc exit',
      '↑↓ scroll  →← open/close  r mode  enter ok  i help  + new folder  esc back  canc exit',
      '↑↓ →←  r mode  enter ok  i help  + new folder  esc back  canc exit',
      // Ogni lettera singola apre la propria voce: in mezzo ad altri tasti non
      // si colora, perche' li' una lettera sola e' una parola (vedi coloraTasti).
      '↑↓ →← enter  r mode  i help  + new folder  esc back  canc exit',
      '↑↓ →← enter  r mode  i  + new folder  esc back  canc exit',
    ],
    // Con almeno un profilo configurato: `m` lo alterna, come `r` fa col modo.
    legendeConProfilo: [
      '↑↓ scroll   →← open/close   r switch mode   m profile   enter confirm   i help   + new folder   esc back   canc exit',
      '↑↓ scroll  →← open/close  r switch mode  m profile  enter confirm  i help  + new folder  esc back  canc exit',
      '↑↓ scroll  →← open/close  r mode  m profile  enter ok  i help  + new folder  esc back  canc exit',
      '↑↓ →←  r mode  m profile  enter ok  i help  + new folder  esc back  canc exit',
      '↑↓ →← enter  r mode  m profile  i help  + new folder  esc back  canc exit',
      '↑↓ →← enter  r mode  m profile  i  + new folder  esc back  canc exit',
    ],
    titolo: '  Working folder for Claude',
    modoRipresa: 'resume a conversation (-r)',
    modoNormale: 'normal start',
    conProfilo: (nome) => `profile: ${nome}`,
    // Cartella nuova: si scrive il nome in un campo sotto l'albero, dentro alla
    // cartella scelta. Il nome del genitore si dice, o non si saprebbe dove
    // finisce quella che stai creando.
    nuovaIn: (cartella) => `new folder in ${cartella}: `,
    nuovaLegende: [
      'type the name   enter creates it   f1 help   esc never mind',
      'type the name   enter creates it   esc never mind',
      'enter creates it   esc never mind',
    ],
    // Il nome non va bene: si dice **perche'**, invece di non fare niente.
    nomeNonValido: 'a name cannot contain  \\ / : * ? " < > |  nor be . or ..',
    nuovaNonCreata: (motivo) => `cannot create it: ${motivo}`,
  },

  // src/conversazioni.js — selettore delle conversazioni passate
  conversazioni: {
    legende: [
      [
        '↑↓ pick the conversation   enter go into the tree   i help   esc back   canc exit',
        '↑↓ pick the conversation  enter go into the tree  i help  esc back  canc exit',
        '↑↓ conversation  enter tree  i help  esc back  canc exit',
        '↑↓ conversation  enter tree  i  esc back  canc exit',
      ],
      [
        '←→↑↓ wasd pick the point, across prompts and branches   enter restart here   i help   esc back   canc exit',
        '←→↑↓ wasd pick the point  enter restart  i help  esc back  canc exit',
        '←→↑↓ pick the point  enter restart  i help  esc back  canc exit',
        '←→↑↓ the point  enter restart  i  esc back  canc exit',
      ],
    ],
    quante: (n) => (n === 1 ? '1 conversation' : `${n} conversations`),
    inCartella: (quante, cartella) => `${quante} in ${cartella}`,
    nessuna: 'No conversation in this folder.',
    carico: 'loading the conversation…',
    nessunMessaggio: 'no message in this conversation',
    legendaVuota: ['enter or esc: start a new conversation', 'enter/esc: new'],
    sopra: (n) => `↑ ${n} above`,
    sotto: (n) => `↓ ${n} below`,
    messaggi: 'msg',
  },

  // src/wrapper.js — messaggi durante il cambio ramo
  wrapper: {
    invioPerTornare: 'enter to go back to Claude',
    // Da un avviso non si risale da nessuna parte: dietro c'e' Claude, e i due
    // tasti fanno la stessa cosa. Si scrivono quindi insieme, come nell'albero.
    tastiAvviso: 'c pick folder and conversation   i help   esc/canc exit',
    // Le stesse voci della barra dell'albero: queste schermate lo sostituiscono,
    // quindi devono accettarne i tasti.
    tastiAvvisoCompleta: 'c other conv.   m profile   p queue   n notes   i help   esc/canc exit',
    senzaTranscript: (scorciatoia, sessione) => [
      'This conversation has no transcript on disk yet.',
      '',
      'Claude writes it at the first exchange: send a prompt, wait for the',
      `answer, then press ${scorciatoia} again.`,
      '',
      'Or start somewhere else: c opens the folder navigator, where "r"',
      'switches between resuming a conversation and starting a new one.',
      '',
      'm picks the profile to run Claude under — here is the best moment,',
      'with no conversation to carry over yet.',
      '',
      'p is the prompt queue, n the notes of this folder: neither needs a',
      'conversation to already exist.',
      '',
      `session: ${sessione}`,
    ],
    senzaMessaggi: (sessione, transcript) => [
      'This conversation has no message to restart from yet.',
      '',
      'c opens the folder navigator, where "r" switches between resuming',
      'a conversation and starting a new one.',
      '',
      'm picks the profile, p is the prompt queue, n the notes of this folder.',
      '',
      `session: ${sessione}`,
      `transcript: ${transcript}`,
    ],
    ripartoDa: (testo) => `restarting from: ${testo}`,
    profiloAttivo: (nome) => `restarting with: ${nome}`,
    // Premuto senza profili configurati, `m` taceva: un tasto che non risponde e
    // un tasto rotto sono la stessa cosa, da fuori. Meglio spiegare.
    senzaProfili: (percorso) => [
      'No profiles configured.',
      '',
      'A profile is a named set of environment variables. It lets you relaunch',
      'Claude somewhere else — a local gateway, another key — without leaving',
      'the conversation you are in.',
      '',
      `They live in ${percorso}:`,
      '',
      '  "profili": {',
      '    "gateway": { "ANTHROPIC_BASE_URL": "http://localhost:20128" },',
      '    "direct":  { "ANTHROPIC_BASE_URL": null }',
      '  }',
      '',
      'null (or "") removes the variable instead of overriding it.',
    ],
    profiloSconosciuto: (nome, noti) =>
      `cb: no profile named "${nome}". Configured: ${noti || '(none)'}`,
    ramoDiSessione: (sessione) => `(branch of session ${sessione})`,
    ripristinoFile: 'restoring the files to that point…',
    fileNonRipristinati: (riassunto) => `files NOT restored: ${riassunto}`,
    messaggioAltrove: 'that message is not in this session',
    senzaOrario: 'no timestamp for that turn: cannot restore the files',
    ramoNonCreato: (motivo) => `cannot create the branch (${motivo})`,
    ramoNonFissato: 'cannot pin the chosen branch: try again',
    serveTerminale: 'cb wrap needs an interactive terminal',
    tagioNonTrovato: (uuid) => `cut point not found in the transcript: ${uuid}`,
    nodoNonTrovato: (uuid) => `node not found in the transcript: ${uuid}`,
    scorciatoiaIgnota: (testo) => `shortcut not recognised: ${testo}`,
  },

  // src/istruzioni.js — una pagina per schermata. Le righe rientrate di due
  // spazi sono voci di tasti e si colorano da se': `coloraTasti` riconosce la
  // testa di ogni voce e si ferma alla prima parola che non e' un tasto, quindi
  // una riga di prosa non deve cominciare con una parola di una lettera sola.
  istruzioni: {
    intestazione: (titolo) => `cb — help: ${titolo}`,
    altre: (n) => `↓ ${n} more lines`,
    legenda: 'esc back   canc exit',
    legendaScorri: '↑↓ scroll   esc back   canc exit',

    albero: {
      titolo: 'the branches of this conversation',
      righe: [
        'Every dot is a prompt you sent, left to right in time. Where the',
        'conversation forked the tree steps down: the branches below are the',
        'roads you left, and they stay reachable.',
        '',
        'Pick a point, press enter, and you restart from there: cb asks first',
        'what to bring back (the conversation, the files, or both).',
        '',
        'Keys',
        '  ←→↑↓ wasd  pick the point: left and right between prompts, up and',
        '  down between branches',
        '  enter  opens the menu of what to bring back',
        '  c  change folder and conversation',
        '  m  relaunch Claude under another environment profile',
        '  p  the prompt queue',
        '  n  the notes of this folder',
        '  i/f1  this help',
        '  esc/canc  back to Claude',
        '',
        'Worth knowing',
        '  ⬤ a prompt   ◯ the one picked   ┳ a fork',
        '  © the conversation was compacted at that point',
        '  ⎋ the turn was interrupted: its answer is cut short',
        'Restarting from a point restarts the Claude process: there is no way',
        'to reload a conversation into a live process.',
        'The tree scrolls with the arrows only: while a cb screen is up the',
        'mouse stays free to select and copy.',
      ],
    },

    menu: {
      titolo: 'what to bring back',
      righe: [
        'The three entries are the same as Claude\'s own menu, because the',
        'choice is the same: the conversation and the files can come back',
        'together or separately.',
        '',
        'Keys',
        '  ↑↓  pick the entry',
        '  1-3  pick directly, without the arrows',
        '  ←→  decides where the chosen prompt ends up: sent, with the answer',
        '  it got, or back in the input bar still to send',
        '  r  remember this choice for next time',
        '  enter  confirm and restart',
        '  i/f1  this help',
        '  esc  back to the tree',
        '  canc  exit everything',
        '',
        'Worth knowing',
        'With "files only" the conversation does not move and Claude does not',
        'restart: only the files come back, and the conversation goes on from',
        'where it was.',
        'The files are not asked of Claude: cb reads its archive of copies',
        '(~/.claude/file-history), kept one per prompt. If a copy has expired',
        'the file stays as it is, and cb says so instead of keeping quiet.',
        'The cut is at the end of the chosen turn: the prompt and its answer',
        'stay, and what came after stays as a branch aside.',
      ],
    },

    profili: {
      titolo: 'which profile',
      righe: [
        'A profile is a named set of environment variables. It serves to',
        'relaunch Claude elsewhere — a local gateway, another key — without',
        'leaving the conversation you are in.',
        '',
        'Keys',
        '  ↑↓  pick the profile',
        '  enter  relaunch Claude under it',
        '  i/f1  this help',
        '  esc  back',
        '  canc  exit everything',
        '',
        'Worth knowing',
        'The conversation stays where it is: only the process restarts, with',
        'the variables of the chosen profile.',
        'Profiles live in ~/.claude/cb/impostazioni.json under the "profili"',
        'key: null (or "") removes a variable instead of overriding it.',
      ],
    },

    avviso: {
      titolo: 'no tree to show',
      righe: [
        'This screen stands in for the tree when there is no tree: before the',
        'first exchange, or on a conversation with no messages.',
        '',
        'Keys',
        '  c  change folder and conversation',
        '  m  relaunch Claude under another environment profile',
        '  p  the prompt queue',
        '  n  the notes of this folder',
        '  i/f1  this help',
        '  esc/canc  back to Claude',
        '',
        'Worth knowing',
        'Claude writes the transcript at the first exchange: send a prompt,',
        'wait for the answer, and from then on the tree is there.',
        'The queue and the notes do not need the conversation to have started',
        '— this is in fact the best moment to write down what you want done',
        'next.',
      ],
    },

    cartelle: {
      titolo: 'the working folder',
      righe: [
        'The folders you have already worked in with Claude, as a tree. The one',
        'you pick becomes the working folder: Claude looks for conversations',
        'inside the current folder, and from another one it finds none.',
        '',
        'Keys',
        '  ↑↓  scroll',
        '  →←  open and close a folder',
        '  space  opens and closes, like the arrows',
        '  r  switches between resuming a conversation and starting fresh',
        '  m  picks the profile to run Claude under',
        '  +  makes a folder inside the chosen one: type the name, enter creates',
        '  it. Once made the cursor moves onto it — but it is not picked yet:',
        '  that still takes enter.',
        '  enter  confirm the folder',
        '  i/f1  this help',
        '  esc  back',
        '  canc  exit everything',
        '',
        'Worth knowing',
        'With resume on, confirming the folder leads to the list of its',
        'conversations; with a normal start Claude begins fresh in there.',
        'The chosen folder reaches the shell only if whoever launched cb reads',
        'CB_CARTELLA_SCELTA: a child process cannot change its parent\'s',
        'directory.',
      ],
    },

    conversazioni: {
      titolo: 'the conversations in this folder',
      righe: [
        'The past conversations in this folder, most recent on top. The tree of',
        'the selected one shows at the top, so you know where you are about to',
        'go before going there.',
        '',
        'Keys',
        '  ↑↓  pick the conversation',
        '  enter  step into the tree, and pick the point to restart from',
        '  i/f1  this help',
        '  esc  back to the folders',
        '  canc  exit everything',
        '',
        'Worth knowing',
        'A conversation is a family of sessions, not a file: branches born of a',
        'fork live in different files but show up here as one entry. Claude\'s',
        'own picker lists files, and shows the same conversation more than',
        'once.',
        'In a folder with no conversations, enter or esc starts fresh.',
      ],
    },

    coda: {
      titolo: 'the prompt queue',
      righe: [
        'The prompts you write while Claude is working. One leaves per turn, as',
        'soon as Claude has finished answering: instead of waiting around to',
        'send them by hand, you leave them here and they go on their own.',
        '',
        'Keys',
        '  type  the text of the next prompt',
        '  enter  queues it; on a prompt already queued, saves your edit',
        '  shift+enter  new line inside the prompt, without queueing it',
        '  ←→  move the cursor inside the text you are writing',
        '  ↑↓  pick a prompt in the queue: the box moves onto it, and you edit',
        '  it right there',
        '  ctrl+↑↓  move it up and down',
        '  ctrl+s  stop: from there on nothing leaves',
        '  ctrl+x  skip: steps over that one prompt only',
        '  ctrl+canc  remove the chosen prompt',
        '  f1  this help',
        '  esc  back',
        '  canc  exit everything',
        '',
        'Worth knowing',
        'Removing a prompt takes ctrl+canc, not canc: canc exits from every',
        'screen, and being the same everywhere is worth more than being handy',
        'in one screen. Same reason the help is on f1 here: i is a letter of',
        'the prompt you are typing.',
        'Stop is a barrier and holds back the prompts after it too; skip steps',
        'over one alone.',
        'What you paste is one prompt, newlines and all: Claude gets the whole',
        'thing.',
        'A prompt already queued is fixed where it sits, in the box: queueing it',
        'is no longer the last chance to reread it. Emptying it removes it, like',
        'an emptied note.',
        'The new prompt you are writing is not queued when you move onto another',
        'one: it stays put and you find it again at the bottom. Queueing it',
        'half-written would mean watching it leave on its own next turn.',
        'A prompt leaves when Claude has been quiet for a second and a half —',
        'and not while you are typing, or the text would mix with yours.',
        'The queue belongs to this session, and cb moves it along by itself',
        'when the session changes (a /clear, a branch switch).',
      ],
    },

    note: {
      titolo: 'the notes of this folder',
      righe: [
        'Notes belong to the folder, not to the conversation: the same ones in',
        'every session opened in here. That is why they exist — a note is',
        'useful precisely when the conversation you wrote it in is over.',
        '',
        'Keys',
        '  type  the title, then the body',
        '  enter  from the title steps down to the body, from the body saves',
        '  shift+enter  new line inside the body',
        '  ←→  move the cursor inside the field you are writing',
        '  ctrl+enter  puts the note in Claude\'s input bar, unsent',
        '  ctrl+f  search the notes',
        '  ctrl+space  mark the chosen note',
        '  ctrl+canc  delete the marked ones',
        '  ↑↓  pick a note',
        '  f1  this help',
        '  esc  back',
        '  canc  exit everything',
        '',
        'Worth knowing',
        'The cursor always starts on the title: from the title you go down to',
        'the body, from the body you cannot go up, and starting on the body the',
        'title of an old note would be impossible to fix.',
        'With ctrl+enter the text lands in the bar ready to fix or finish, and',
        'you send it: the queue sends, the notes hand over.',
        'What you paste is one note, newlines and all, and it stays in the field',
        'you are writing in. In the title, one line by nature, they turn to spaces.',
        'The help is on f1 and not on i for the same reason as the queue: here',
        'i is a letter.',
      ],
    },

    configura: {
      titolo: 'the settings',
      righe: [
        'The three things worth choosing once. You come back here with',
        'cb --impostazioni.',
        '',
        'Keys',
        '  ↑↓  pick the setting',
        '  ←→  change the value',
        '  enter  acts on the row: opens the field or confirms',
        '  i/f1  this help',
        '  esc  keep these and move on',
        '',
        'Worth knowing',
        'Values take precedence environment, then file, then default: a',
        'variable passed by hand wins over the file, for that one run.',
        'A flag in the PowerShell profile mutes the matching setting: if the',
        'snippet passes --tasto, the shortcut chosen here never shows.',
        'With "esc esc" the shortcut is also Claude\'s own rewind: cb covers it',
        'only when the two Esc arrive close enough together.',
        'Changing language relaunches cb once, or the first session would come',
        'out half in one language and half in the other.',
      ],
    },
  },

  // src/codice.js — riassunto del ripristino dei file
  codice: {
    ripristinati: (n) => `${n} files restored`,
    cancellati: (n) => `${n} removed`,
    mancanti: (n) => `${n} not restorable (expired copies)`,
    fuori: (n) => `${n} outside the folder, untouched`,
    giaCosi: 'the files were already in that state',
  },

  // src/eseguibile.js — ricerca del binario di Claude
  eseguibile: {
    forzatoAssente: (percorso) => `CB_CLAUDE_EXE does not exist: ${percorso}`,
    nonTrovato:
      'Claude Code executable not found. Install Claude Code, or set CB_CLAUDE_EXE to its full path.',
  },
};

export const IT = {
  aiuto: (scorciatoia) => `
cb — branching per conversazioni Claude Code

  cb                    avvia Claude avvolto: ${scorciatoia} apre l'albero dei rami
  cb --scegli           prima chiede in quale cartella lavorare (albero dei progetti;
                        radice da CB_RADICE, "r" alterna avvio normale e ripresa).
                        In ripresa mostra le conversazioni della cartella, ognuna
                        con il suo albero: ↑↓ scegli, invio entra nell'albero
  cb --tasto <tasto>    come sopra con un'altra scorciatoia: "f2", "esc esc", "ctrl+shift+b"
                        (i tasti funzione sono liberi; ctrl+g lo usa Claude Code)
  cb --senza-file       cambiando ramo NON ripristina i file, solo la conversazione
  cb --tasti            stampa i byte dei tasti e scrive ~/.claude/cb/diagnosi.log
                        (combinabile: cb --tasti --tasto f2)
  cb ls [filtro]        elenca le sessioni (filtro su progetto o prompt)
  cb tree <sessione>    mostra l'albero dei rami di una sessione
  cb open <sessione> [n]  riprendi una sessione da fuori, opzionalmente dal ramo n
  cb pick               catalogo interattivo: scegli sessione, poi ramo
  cb prune [--giorni N] [--esegui]
                        toglie ciò che cb lascia dietro e non scade mai: sessioni
                        troncate, copie dei file, commit automatici. Più vecchi
                        di N giorni (7); senza --esegui dice solo cosa toglierebbe.
                        cb lo fa anche da solo, una volta al giorno, oltre i 2 mesi
                        (CB_GIORNI_PULIZIA, con 0 si spegne)
  cb --impostazioni     schermata delle impostazioni: lingua, cartella, scorciatoia
                        (la prima volta si apre da sola)
  cb --version          numero di versione
  cb --aiuto            questo testo

Nell'albero dentro la sessione: ←→ (o a/d) scorrono la conversazione, ↑↓ (o w/s)
cambiano ramo, invio riparte da lì, esc torna a Claude. Da lì "c" apre
il navigatore delle cartelle, dove "r" alterna la ripresa di una conversazione e
l'avvio di una nuova: si cambia conversazione, progetto o si riparte da zero
senza chiudere Claude. I comandi qui sopra usano
l'elenco numerato, così "cb open <sessione> 3" ha un numero a cui riferirsi.
La scorciatoia si fissa una volta per tutte con CB_TASTO, la lingua con CB_LINGUA
(en, it).
<sessione> = id completo, prefisso di id, o percorso del .jsonl
`,

  comandi: {
    nessunaSessione: 'Nessuna sessione trovata in ~/.claude/projects.',
    sessioneNonTrovata: (id) => `Sessione non trovata: ${id}`,
    ramoNonValido: (n, massimo) => `Ramo ${n} non valido (1-${massimo}).`,
    comandoSconosciuto: (comando) => `Comando sconosciuto: ${comando}`,
    quanteSessioni: (n) => `${n} sessioni`,
    sceltaNonValida: 'Scelta non valida.',
    chiediSessione: (massimo) => `\nSessione (1-${massimo}): `,
    chiediPunto: (massimo) => `Ripartire dal punto (1-${massimo}, invio = continua il ramo attivo): `,
    ramoRiattivato: (foglia) => `\n  ramo abbandonato riattivato (foglia ${foglia})`,
    legendaElenco: '● = ramo attivo   ⑂ = biforcazione',
  },

  pulizia: {
    anteprima: (giorni) => `\ncb prune — più vecchi di ${giorni} giorni (non ho tolto niente)\n`,
    fatto: (giorni) => `\ncb prune — più vecchi di ${giorni} giorni\n`,
    sessioni: 'sessioni troncate',
    copie: 'copie dei file di cb',
    ref: 'commit automatici',
    quantiFile: (n, dim) => `${n} file, ${dim}`,
    quantiRef: (n) => `${n} ref`,
    tolti: (n) => `${n} tolti`,
    nienteDaTogliere: 'Non c\'è niente da togliere.',
    comeProcedere: '\ncb prune --esegui per toglierli',
    dopoRef: 'lo spazio dei commit torna con: git gc --prune=now',
    fuoriRepo: '(non siamo in un repo git: commit automatici non controllati)',
    giorniNonValidi: 'Il valore di --giorni deve essere un numero positivo.',
  },

  albero: {
    legenda: [
      `${VUOTO} riparti da qui   ${FORCA} biforcazione   ${COMPATTAZIONE} compattata`,
      `${VUOTO} riparti da qui   ${FORCA} biforcazione`,
      `${VUOTO} riparti da qui`,
    ],
    vociRipristino: [
      'la conversazione e i file',
      'solo la conversazione (i file restano come sono)',
      "solo i file (la conversazione resta dov'è)",
    ],
    titolo: 'rami di questa conversazione',
    titoloCorto: 'rami',
    escLunga: 'torna a Claude',
    escCorta: 'esci',
    // Le due parole dell'uscita, uguali in ogni schermata: esc risale di un
    // passo, canc esce da tutto. Vedi `uscita` in vista.js.
    indietro: 'indietro',
    esci: 'esci',
    righeSopra: (n) => `↑ ${n} righe sopra`,
    righeSotto: (n) => `↓ ${n} righe sotto`,
    promptPrima: (n) => `← ${n} prompt prima`,
    promptDopo: (n) => `${n} prompt dopo →`,
    ripartiDaQui: 'riparti da qui',
    compattazione: '© conversazione compattata',
    // Il turno di questo prompt e' stato fermato a meta': la risposta che porta
    // con se' e' monca. Non e' un nodo a parte — da un'interruzione non si
    // riparte — ma va detto prima di sceglierlo.
    interrotto: '⎋ interrotto',
    precedenti: (n) => `precedenti: ${n}`,
    riportaIndietro: 'cosa riporto indietro?',
    // Il prompt scelto: due stati, e si mostra per intero quello attivo. E' una
    // frase e non un'etichetta perche' deve dire cosa succedera', non nominare
    // un'opzione.
    promptInviato: [
      'il prompt che hai scelto resta inviato, con la risposta che ha avuto',
      'il prompt resta inviato, con la sua risposta',
      'il prompt resta inviato',
    ],
    promptDaRimandare: [
      'il prompt che hai scelto torna nella barra, ancora da inviare',
      'il prompt torna nella barra, da inviare',
      'il prompt torna nella barra',
    ],
    ricordaScelta: [
      'ricordati questa scelta per le prossime volte',
      'ricordati questa scelta',
      'ricordala',
    ],
    legendaMenu: [
      '↑↓ scegli   ←→ il prompt   1-3 scelta diretta   invio conferma   i istruzioni   esc indietro   canc esci',
      '↑↓ scegli  ←→ il prompt  1-3 scelta diretta  invio conferma  i istruzioni  esc indietro  canc esci',
      '↑↓ scegli  ←→ il prompt  invio conferma  i istruzioni  esc indietro  canc esci',
      '↑↓ ←→ invio  i istruzioni  esc indietro  canc esci',
      '↑↓ ←→ invio  i  esc indietro  canc esci',
    ],
    invioConFile: 'invio riparti',
    invioSenzaFile: 'invio riparti (i file restano come sono)',
    // Le quattro frecce in una voce sola: erano due ("←→ avanti e indietro",
    // "↑↓ cambia ramo"), ma sono lo stesso gesto e dividerle costringeva a
    // leggere due voci per capire come ci si muove.
    //
    // «Il punto» e non «spostati»: le frecce non servono a spostarsi, servono a
    // scegliere il punto da cui ripartire — ed e' la stessa parola con cui
    // l'albero lo chiama dappertutto («riparti da qui», «il punto scelto»).
    // Dove portino le singole direzioni lo dice l'albero stesso, che e'
    // orizzontale nei prompt e verticale nei rami.
    puntoLungo: '←→↑↓ wasd scegli il punto, fra i prompt e i rami',
    punto: '←→↑↓ wasd scegli il punto',
    puntoCorto: '←→↑↓ scegli il punto',
    frecce: '←→↑↓',
    invioRiparti: 'invio riparti',
    // L'uscita arriva gia' composta: puo' essere un tasto solo o due (vedi
    // `uscita` in vista.js).
    barraMinima: (uscita) => `←→↑↓ il punto  invio riparti  ${uscita}`,
    extraLunga: 'c cartella e conversazione   m profilo   p coda   n note   i istruzioni',
    extraCorta: 'c altra conv.   m profilo   p coda   n note   i istruzioni',
    // Profili: si vedono solo se ne hai configurato almeno uno.
    qualeProfilo: 'con quale profilo?',
    profiloBase: "Claude, come l'hai lanciato",
    profiloResta: "la conversazione resta dov'è: riparte solo il processo",
    legendaProfili: [
      '↑↓ scegli   invio conferma   i istruzioni   esc indietro   canc esci',
      '↑↓ scegli  invio conferma  i istruzioni  esc indietro  canc esci',
      '↑↓ scegli  invio  i istruzioni  esc indietro  canc esci',
      '↑↓ invio  i istruzioni  esc indietro  canc esci',
      '↑↓ invio  i  esc indietro  canc esci',
    ],
    escElencoLunga: "torna all'elenco",
    escElencoCorta: 'elenco',
  },

  // src/coda.js — la coda dei prompt che partono da soli a fine turno
  coda: {
    titolo: 'coda dei prompt',
    sottotitolo: 'partono uno alla volta, quando Claude finisce un turno',
    vuota: 'la coda è vuota: scrivi qui sotto e premi invio',
    quanti: (n) => (n === 1 ? '1 prompt in attesa' : `${n} prompt in attesa`),
    // La pausa per i token va detta qui e non solo nel diagnosi.log: una coda
    // ferma e una coda che non parte si assomigliano troppo, e senza l'ora del
    // reset si finisce per credere che sia rotta.
    // Due varianti, dalla piu' lunga alla piu' corta, come le legende: su un
    // terminale stretto a essere tagliata era la **coda** della riga, cioe'
    // proprio l'ora — e «in pausa» senza un «fino a quando» dice meno di niente.
    // Il glifo e' `‖` e non un'emoji: un terminale che le rende a doppia
    // larghezza sfaserebbe la riga di una colonna.
    inPausa: (ora) => [`in pausa · token finiti, riprendo alle ${ora}`, `‖ ${ora}`],
    // Il posto in fondo resta annunciato anche quando il cursore sta su un
    // altro prompt: senza, l'elenco sembrerebbe finire con l'ultimo. Dice cosa
    // ci si fa — accodare — e non come si chiama la riga.
    nuovo: 'accoda prompt',
    // Righe che non ci stanno a schermo, come nelle note: si dice invece di
    // tagliare zitti, o un elenco troncato in silenzio si legge come completo.
    fuoriSchermo: (n) => `altre ${n} righe, ↑↓ per vederle`,
    // Il prompt che partira' per primo si riconosce dal colore: era scritto
    // accanto («il prossimo»), ma una parola in piu' su una riga dell'elenco si
    // legge peggio di un colore, che si vede senza leggere.
    // Gli interruttori, come compaiono accanto al prompt che li porta.
    // La barra doppia e non il pulsante di pausa (U+23F8): quello e' un emoji,
    // e un terminale che lo rende a doppia larghezza sfasa la riga di una
    // colonna. Come i glifi dell'albero, si sta in una cella sola.
    marchioStop: '‖ stop',
    marchioSalta: '⤼ salta',
    // La scala perde **voci intere**, non le parole che le spiegano: un tasto
    // senza il suo verbo e' un tasto che non sai cosa faccia, e una barra fatta
    // di soli nomi di tasto si legge come una formula. Meglio dire cinque cose
    // che elencarne undici senza dire niente.
    legende: [
      'invio accoda   shift+invio a capo   ←→ nel testo   ↑↓ scegli e modifica   ctrl+↑↓ sposta   ctrl+s stop   ctrl+x salta   ctrl+canc togli   f1 istruzioni   esc indietro   canc esci',
      'invio accoda  shift+invio a capo  ←→ nel testo  ↑↓ scegli e modifica  ctrl+↑↓ sposta  ctrl+s stop  ctrl+x salta  ctrl+canc togli  f1 istruzioni  esc indietro  canc esci',
      'invio accoda  shift+invio a capo  ←→ nel testo  ↑↓ scegli e modifica  ctrl+↑↓ sposta  ctrl+s/x stop,salta  ctrl+canc togli  f1 istruzioni  esc indietro  canc esci',
      'invio accoda  shift+invio a capo  ←→ nel testo  ↑↓ modifica  ctrl+↑↓ sposta  ctrl+s/x stop,salta  ctrl+canc togli  f1 istruzioni  esc indietro  canc esci',
      'invio accoda  shift+invio a capo  ←→ nel testo  ↑↓ modifica  ctrl+canc togli  f1 istruzioni  esc indietro  canc esci',
      'invio accoda  shift+invio a capo  ←→ nel testo  ctrl+canc togli  f1 istruzioni  esc indietro  canc esci',
      'invio accoda  ←→ nel testo  ctrl+canc togli  f1 istruzioni  esc indietro  canc esci',
      // Vedi le note: l'ultima tiene f1 e lascia cadere il resto.
      'invio accoda  ←→ nel testo  f1 istruzioni  esc indietro  canc esci',
    ],
    // Cosa l'hook antepone al prompt quando lo consegna a Claude: senza, un
    // prompt breve arriva senza contesto e sembra una frase caduta dal nulla.
    intestazione: 'Accodato dall\'utente mentre lavoravi. Fai questo adesso:',
  },

  note: {
    titolo: 'note',
    // Il legame con la cartella e non con la conversazione e' la cosa meno
    // ovvia della schermata, ed e' la ragione per cui esiste: va detto in cima.
    sottotitolo: (cartella) => `di ${cartella} — le stesse in ogni sessione qui`,
    vuota: 'nessuna nota: scrivi un titolo, invio, poi il corpo',
    quante: (n) => (n === 1 ? '1 nota' : `${n} note`),
    // Solo il titolo si annuncia facoltativo: e' l'informazione che serve, perche'
    // e' il campo che si puo' saltare. Scrivere «obbligatorio» sull'altro
    // ripeterebbe la stessa cosa al contrario.
    titoloNota: 'titolo (facoltativo)',
    corpo: 'corpo',
    // Il posto della nota nuova resta annunciato in fondo anche quando il cursore
    // sta altrove: senza, l'elenco sembrerebbe finire con l'ultima nota.
    nuova: 'nota nuova',
    // Righe che non ci stanno a schermo. Si dice invece di tagliare zitti: un
    // elenco troncato in silenzio si legge come un elenco completo.
    fuoriSchermo: (n) => `altre ${n} righe, ↑↓ per vederle`,
    cerca: 'cerca: ',
    quanteTrovate: (n) => (n === 1 ? '1 trovata' : `${n} trovate`),
    nessunaCorrispondenza: 'nessuna nota corrisponde',
    // Quante sono segnate per la cancellazione: e' il numero che ctrl+canc
    // toglierebbe, e va saputo anche quando sono scorse fuori dallo schermo.
    quanteSegnate: (n) => (n === 1 ? '1 segnata' : `${n} segnate`),
    legendeRicerca: [
      'scrivi per cercare   ↑↓ passa fra le trovate   ctrl+invio nella barra   invio modifica questa   ctrl+spazio segna   ctrl+canc cancella   f1 istruzioni   esc indietro   canc esci',
      'scrivi per cercare  ↑↓ trovate  ctrl+invio nella barra  invio modifica  ctrl+spazio segna  ctrl+canc cancella  f1 istruzioni  esc indietro  canc esci',
      'scrivi per cercare  ↑↓ trovate  ctrl+invio nella barra  ctrl+spazio segna  ctrl+canc cancella  f1 istruzioni  esc indietro  canc esci',
      'scrivi per cercare  ↑↓ trovate  ctrl+invio barra  ctrl+canc cancella  f1 istruzioni  esc indietro  canc esci',
      'cerca  ↑↓ trovate  ctrl+canc cancella  f1 istruzioni  esc indietro  canc esci',
      'cerca  ↑↓ trovate  f1 istruzioni  esc indietro  canc esci',
    ],
    // Come nella coda: si perdono voci intere, mai le parole che le spiegano.
    // Erano le varianti strette a ridursi a un elenco di nomi di tasto —
    // "invio shift+invio ctrl+invio ctrl+f ctrl+spazio ctrl+canc" — cioe' la
    // barra che si vede sui terminali normali, dove serviva di piu'.
    legende: [
      'invio titolo→corpo, poi salva   shift+invio a capo   ←→ nel testo   ctrl+invio nella barra   ctrl+f cerca   ctrl+spazio segna   ctrl+canc cancella   ↑↓ note   f1 istruzioni   esc indietro   canc esci',
      'invio salva  shift+invio a capo  ←→ nel testo  ctrl+invio barra  ctrl+f cerca  ctrl+spazio segna  ctrl+canc cancella  ↑↓ note  f1 istruzioni  esc indietro  canc esci',
      'invio salva  shift+invio a capo  ←→ nel testo  ctrl+invio barra  ctrl+f cerca  ctrl+spazio segna  ctrl+canc cancella  f1 istruzioni  esc indietro  canc esci',
      'invio salva  shift+invio a capo  ←→ nel testo  ctrl+invio barra  ctrl+f cerca  ctrl+canc cancella  ↑↓ note  f1 istruzioni  esc indietro  canc esci',
      'invio salva  shift+invio a capo  ←→ nel testo  ctrl+invio barra  ctrl+f cerca  ctrl+canc cancella  f1 istruzioni  esc indietro  canc esci',
      'invio salva  shift+invio a capo  ←→ nel testo  ctrl+f cerca  ctrl+canc cancella  f1 istruzioni  esc indietro  canc esci',
      'invio salva  shift+invio a capo  ←→ nel testo  ctrl+f cerca  f1 istruzioni  esc indietro  canc esci',
      'invio salva  ←→ nel testo  ctrl+f cerca  f1 istruzioni  esc indietro  canc esci',
      // L'ultima tiene f1 e lascia cadere il resto: e' la barra dei terminali
      // stretti, cioe' di chi ha meno posto per essere aiutato dalla barra.
      'invio salva  ←→ nel testo  f1 istruzioni  esc indietro  canc esci',
    ],
  },

  configura: {
    titolo: 'impostazioni',
    sottotitolo: 'si scelgono una volta — cb --impostazioni per tornarci',
    voci: {
      lingua: 'lingua',
      radice: 'cartella di lavoro',
      scorciatoia: 'scorciatoia',
      fatto: 'fatto',
    },
    nomiLingua: { it: 'italiano', en: 'English' },
    scegliCartella: 'invio per scriverla',
    consigliata: 'consigliata',
    // Avviso su "esc esc": e' anche la scorciatoia di Claude, e cb la copre solo
    // se i due Esc arrivano entro la finestra.
    avvisoEscEsc: (ms) => [
      'esc esc è anche il ripristino di Claude: cb la copre se i due arrivano',
      `entro ${ms / 1000}s. Più lenti, e si apre il suo menu invece dell'albero.`,
      "Anche due interruzioni distinte, se più vicine di così, aprono l'albero.",
    ],
    nonEsiste: 'questa cartella non esiste',
    legende: [
      "↑↓ scegli l'impostazione   ←→ cambia   invio agisce sulla riga   i istruzioni   esc tieni queste",
      '↑↓ impostazione   ←→ cambia   invio agisce   i istruzioni   esc tieni',
      '↑↓ ←→ invio  i istruzioni  esc tieni',
      '↑↓ ←→ invio  i  esc tieni',
    ],
    legendeTesto: [
      'scrivi il percorso   ~ e la tua home   invio conferma   f1 istruzioni   esc lascia com era',
      'scrivi il percorso   invio ok   f1 istruzioni   esc indietro',
      'invio ok   f1 istruzioni   esc indietro',
      'invio ok   f1   esc indietro',
    ],
  },

  cartelle: {
    legende: [
      '↑↓ scorri   →← apri/chiudi   spazio apri/chiudi   r cambia modo   invio conferma   i istruzioni   + cartella nuova   esc indietro   canc esci',
      '↑↓ scorri  →← apri/chiudi  spazio apri/chiudi  r cambia modo  invio conferma  i istruzioni  + cartella nuova  esc indietro  canc esci',
      '↑↓ scorri  →← apri/chiudi  r modo  invio ok  i istruzioni  + cartella nuova  esc indietro  canc esci',
      '↑↓ →←  r modo  invio ok  i istruzioni  + cartella nuova  esc indietro  canc esci',
      // Ogni lettera singola apre la propria voce: in mezzo ad altri tasti non
      // si colora, perche' li' una lettera sola e' una parola (vedi coloraTasti).
      '↑↓ →← invio  r modo  i istruzioni  + cartella nuova  esc indietro  canc esci',
      '↑↓ →← invio  r modo  i  + cartella nuova  esc indietro  canc esci',
    ],
    // Con almeno un profilo configurato: `m` lo alterna, come `r` fa col modo.
    legendeConProfilo: [
      '↑↓ scorri   →← apri/chiudi   r cambia modo   m profilo   invio conferma   i istruzioni   + cartella nuova   esc indietro   canc esci',
      '↑↓ scorri  →← apri/chiudi  r cambia modo  m profilo  invio conferma  i istruzioni  + cartella nuova  esc indietro  canc esci',
      '↑↓ scorri  →← apri/chiudi  r modo  m profilo  invio ok  i istruzioni  + cartella nuova  esc indietro  canc esci',
      '↑↓ →←  r modo  m profilo  invio ok  i istruzioni  + cartella nuova  esc indietro  canc esci',
      '↑↓ →← invio  r modo  m profilo  i istruzioni  + cartella nuova  esc indietro  canc esci',
      '↑↓ →← invio  r modo  m profilo  i  + cartella nuova  esc indietro  canc esci',
    ],
    titolo: '  Cartella di lavoro per Claude',
    modoRipresa: 'ripresa della conversazione (-r)',
    modoNormale: 'avvio normale',
    conProfilo: (nome) => `profilo: ${nome}`,
    // Cartella nuova: si scrive il nome in un campo sotto l'albero, dentro alla
    // cartella scelta. Il nome del genitore si dice, o non si saprebbe dove
    // finisce quella che stai creando.
    nuovaIn: (cartella) => `cartella nuova in ${cartella}: `,
    nuovaLegende: [
      'scrivi il nome   invio crea   f1 istruzioni   esc lascia perdere',
      'scrivi il nome   invio crea   esc lascia perdere',
      'invio crea   esc lascia perdere',
    ],
    // Il nome non va bene: si dice **perche'**, invece di non fare niente.
    nomeNonValido: 'nel nome non ci vanno  \\ / : * ? " < > |  né . o ..',
    nuovaNonCreata: (motivo) => `non riesco a crearla: ${motivo}`,
  },

  conversazioni: {
    legende: [
      [
        "↑↓ scegli la conversazione   invio entra nell'albero   i istruzioni   esc indietro   canc esci",
        "↑↓ conversazione  invio entra nell'albero  i istruzioni  esc indietro  canc esci",
        '↑↓ conversazione  invio albero  i istruzioni  esc indietro  canc esci',
        '↑↓ conversazione  invio albero  i  esc indietro  canc esci',
      ],
      [
        '←→↑↓ wasd scegli il punto, fra i prompt e i rami   invio riparti da qui   i istruzioni   esc indietro   canc esci',
        '←→↑↓ wasd scegli il punto  invio riparti  i istruzioni  esc indietro  canc esci',
        '←→↑↓ scegli il punto  invio riparti  i istruzioni  esc indietro  canc esci',
        '←→↑↓ il punto  invio riparti  i  esc indietro  canc esci',
      ],
    ],
    quante: (n) => (n === 1 ? '1 conversazione' : `${n} conversazioni`),
    inCartella: (quante, cartella) => `${quante} in ${cartella}`,
    nessuna: 'Nessuna conversazione in questa cartella.',
    carico: 'carico la conversazione…',
    nessunMessaggio: 'nessun messaggio in questa conversazione',
    legendaVuota: ['invio o esc: parti da una conversazione nuova', 'invio/esc: nuova'],
    sopra: (n) => `↑ ${n} sopra`,
    sotto: (n) => `↓ ${n} sotto`,
    messaggi: 'msg',
  },

  wrapper: {
    invioPerTornare: 'invio per tornare a Claude',
    // Da un avviso non si risale da nessuna parte: dietro c'e' Claude, e i due
    // tasti fanno la stessa cosa. Si scrivono quindi insieme, come nell'albero.
    tastiAvviso: 'c scegli cartella e conversazione   i istruzioni   esc/canc esci',
    // Le stesse voci della barra dell'albero: queste schermate lo sostituiscono,
    // quindi devono accettarne i tasti.
    tastiAvvisoCompleta:
      'c altra conv.   m profilo   p coda   n note   i istruzioni   esc/canc esci',
    senzaTranscript: (scorciatoia, sessione) => [
      'Questa conversazione non ha ancora un transcript su disco.',
      '',
      'Claude lo scrive al primo scambio: manda un prompt, attendi la',
      `risposta, poi ripremi ${scorciatoia}.`,
      '',
      'Oppure riparti da un altro punto: c apre il navigatore delle',
      'cartelle, dove "r" alterna la ripresa di una conversazione e l\'avvio',
      'di una nuova.',
      '',
      'm sceglie il profilo con cui far girare Claude — qui è il momento',
      'migliore, perché non c\'è ancora una conversazione da portarsi dietro.',
      '',
      'p è la coda dei prompt, n le note della cartella: né l\'una né le',
      'altre hanno bisogno che la conversazione sia già cominciata.',
      '',
      `sessione: ${sessione}`,
    ],
    senzaMessaggi: (sessione, transcript) => [
      'La conversazione non contiene ancora messaggi da cui ripartire.',
      '',
      'c apre il navigatore delle cartelle, dove "r" alterna la ripresa',
      'di una conversazione e l\'avvio di una nuova.',
      '',
      'm sceglie il profilo, p è la coda dei prompt, n le note della cartella.',
      '',
      `sessione: ${sessione}`,
      `transcript: ${transcript}`,
    ],
    ripartoDa: (testo) => `riparto da: ${testo}`,
    profiloAttivo: (nome) => `riparto con: ${nome}`,
    // Premuto senza profili configurati, `m` taceva: un tasto che non risponde e
    // un tasto rotto sono la stessa cosa, da fuori. Meglio spiegare.
    senzaProfili: (percorso) => [
      'Nessun profilo configurato.',
      '',
      "Un profilo è un insieme di variabili d'ambiente con un nome. Serve a",
      'rilanciare Claude altrove — un gateway locale, un\'altra chiave — senza',
      'uscire dalla conversazione in cui sei.',
      '',
      `Si scrivono in ${percorso}:`,
      '',
      '  "profili": {',
      '    "gateway": { "ANTHROPIC_BASE_URL": "http://localhost:20128" },',
      '    "diretto": { "ANTHROPIC_BASE_URL": null }',
      '  }',
      '',
      'null (o "") toglie la variabile invece di sovrascriverla.',
    ],
    profiloSconosciuto: (nome, noti) =>
      `cb: nessun profilo di nome «${nome}». Configurati: ${noti || '(nessuno)'}`,
    ramoDiSessione: (sessione) => `(ramo della sessione ${sessione})`,
    ripristinoFile: 'ripristino i file a quel punto…',
    fileNonRipristinati: (riassunto) => `file NON ripristinati: ${riassunto}`,
    messaggioAltrove: "il messaggio non e' in questa sessione",
    senzaOrario: 'non so a quando riportare i file (turno senza orario)',
    ramoNonCreato: (motivo) => `non riesco a creare il ramo (${motivo})`,
    ramoNonFissato: 'non riesco a fissare il ramo scelto: riprova',
    serveTerminale: 'cb wrap richiede un terminale interattivo',
    tagioNonTrovato: (uuid) => `punto di taglio non trovato nel transcript: ${uuid}`,
    nodoNonTrovato: (uuid) => `nodo non trovato nel transcript: ${uuid}`,
    scorciatoiaIgnota: (testo) => `scorciatoia non riconosciuta: ${testo}`,
  },

  // src/istruzioni.js — una pagina per schermata. Le righe rientrate di due
  // spazi sono voci di tasti e si colorano da se': `coloraTasti` riconosce la
  // testa di ogni voce e si ferma alla prima parola che non e' un tasto, quindi
  // una riga di prosa non deve cominciare con una parola di una lettera sola.
  istruzioni: {
    intestazione: (titolo) => `cb — istruzioni: ${titolo}`,
    altre: (n) => `↓ altre ${n} righe`,
    legenda: 'esc indietro   canc esci',
    legendaScorri: '↑↓ scorri   esc indietro   canc esci',

    albero: {
      titolo: 'i rami della conversazione',
      righe: [
        'Ogni pallino è un prompt che hai mandato, da sinistra a destra nel',
        "tempo. Dove la conversazione si è biforcata l'albero scende: i rami",
        'sotto sono le strade che hai lasciato, e restano raggiungibili.',
        '',
        'Scegliendo un punto e premendo invio si riparte da lì: cb chiede prima',
        'cosa riportare indietro (la conversazione, i file, o tutt\'e due).',
        '',
        'Tasti',
        '  ←→↑↓ wasd  scegli il punto: destra e sinistra fra i prompt, su e giù',
        '  fra i rami',
        '  invio  apre il menu di cosa riportare indietro',
        '  c  cambia cartella e conversazione',
        '  m  rilancia Claude con un altro profilo di variabili',
        '  p  la coda dei prompt',
        '  n  le note di questa cartella',
        '  i/f1  queste istruzioni',
        '  esc/canc  torna a Claude',
        '',
        'Da sapere',
        '  ⬤ un prompt   ◯ quello scelto   ┳ una biforcazione',
        '  © la conversazione è stata compattata a quel punto',
        '  ⎋ il turno è stato interrotto: la risposta è monca',
        'Ripartire da un punto riavvia il processo di Claude: non esiste modo',
        'di ricaricare una conversazione in un processo vivo.',
        "L'albero si scorre solo con le frecce: finché una schermata di cb è a",
        'video il mouse resta libero di selezionare e copiare.',
      ],
    },

    menu: {
      titolo: 'cosa riporto indietro',
      righe: [
        'Le tre voci sono le stesse del menu di Claude, perché la scelta è la',
        'stessa: la conversazione e i file possono tornare indietro insieme o',
        'separatamente.',
        '',
        'Tasti',
        '  ↑↓  scegli la voce',
        '  1-3  scegli direttamente, senza passare dalle frecce',
        '  ←→  decide dove finisce il prompt scelto: resta inviato con la sua',
        '  risposta, oppure torna nella barra ancora da mandare',
        '  r  ricorda questa scelta per le prossime volte',
        '  invio  conferma e riparte',
        '  i/f1  queste istruzioni',
        '  esc  torna all\'albero',
        '  canc  esce da tutto',
        '',
        'Da sapere',
        'Con «solo i file» la conversazione non si muove e Claude non riparte:',
        'tornano indietro soltanto i file, e la conversazione prosegue da dove',
        'era.',
        'I file non li chiede a Claude: cb legge il suo archivio di copie',
        '(~/.claude/file-history), che le tiene per ogni prompt. Se una copia',
        'è scaduta il file resta com\'è, e cb lo dice invece di tacerlo.',
        'Il taglio è alla fine del turno scelto: restano il prompt e la sua',
        'risposta, e quello che veniva dopo resta come ramo in disparte.',
      ],
    },

    profili: {
      titolo: 'con quale profilo',
      righe: [
        "Un profilo è un insieme di variabili d'ambiente con un nome. Serve a",
        "rilanciare Claude altrove — un gateway locale, un'altra chiave — senza",
        'uscire dalla conversazione in cui sei.',
        '',
        'Tasti',
        '  ↑↓  scegli il profilo',
        '  invio  rilancia Claude con quello',
        '  i/f1  queste istruzioni',
        '  esc  torna indietro',
        '  canc  esce da tutto',
        '',
        'Da sapere',
        "La conversazione resta dov'è: riparte solo il processo, con le",
        'variabili del profilo scelto.',
        'I profili si scrivono in ~/.claude/cb/impostazioni.json, sotto la',
        'chiave "profili": null (o "") toglie una variabile invece di',
        'sovrascriverla.',
      ],
    },

    avviso: {
      titolo: 'nessun albero da mostrare',
      righe: [
        'Questa schermata prende il posto dell\'albero quando un albero non c\'è:',
        'prima del primo scambio, o su una conversazione senza messaggi.',
        '',
        'Tasti',
        '  c  cambia cartella e conversazione',
        '  m  rilancia Claude con un altro profilo di variabili',
        '  p  la coda dei prompt',
        '  n  le note di questa cartella',
        '  i/f1  queste istruzioni',
        '  esc/canc  torna a Claude',
        '',
        'Da sapere',
        'Claude scrive il transcript al primo scambio: manda un prompt, attendi',
        "la risposta, e da lì in poi l'albero c'è.",
        'La coda e le note non hanno bisogno che la conversazione sia già',
        'cominciata — anzi, è proprio qui che conviene scriverci dentro quello',
        'che vuoi far fare dopo.',
      ],
    },

    cartelle: {
      titolo: 'la cartella di lavoro',
      righe: [
        'Le cartelle in cui hai già lavorato con Claude, in un albero. Quella',
        'scelta diventa la cartella di lavoro: Claude cerca le conversazioni',
        'dentro la cartella corrente, e da una cartella diversa non le trova.',
        '',
        'Tasti',
        '  ↑↓  scorri',
        '  →←  apri e chiudi una cartella',
        '  spazio  apre e chiude, come le frecce',
        '  r  alterna la ripresa di una conversazione e l\'avvio da zero',
        '  m  sceglie il profilo con cui far girare Claude',
        '  +  crea una cartella dentro quella scelta: si scrive il nome e invio',
        '  la fa. Creata, il cursore ci va sopra — ma non è ancora scelta:',
        '  per quello serve invio.',
        '  invio  conferma la cartella',
        '  i/f1  queste istruzioni',
        '  esc  torna indietro',
        '  canc  esce da tutto',
        '',
        'Da sapere',
        'Con la ripresa accesa, confermata la cartella si passa all\'elenco',
        "delle sue conversazioni; con l'avvio normale Claude parte da zero lì",
        'dentro.',
        'La cartella scelta torna alla shell solo se chi ha lanciato cb legge',
        'CB_CARTELLA_SCELTA: un processo figlio non può cambiare la cartella',
        'del padre.',
      ],
    },

    conversazioni: {
      titolo: 'le conversazioni della cartella',
      righe: [
        'Le conversazioni passate in questa cartella, la più recente in cima.',
        "In alto si vede l'albero di quella scelta, così si sa dove si sta per",
        'entrare prima di entrarci.',
        '',
        'Tasti',
        '  ↑↓  scegli la conversazione',
        "  invio  entra nell'albero, e lì scegli il punto da cui ripartire",
        '  i/f1  queste istruzioni',
        '  esc  torna alle cartelle',
        '  canc  esce da tutto',
        '',
        'Da sapere',
        'Una conversazione è una famiglia di sessioni, non un file: i rami nati',
        'da un fork stanno in file diversi ma compaiono qui come una voce sola.',
        "Il selettore di Claude elenca i file, e mostra la stessa conversazione",
        'più volte.',
        'In una cartella senza conversazioni invio o esc partono da zero.',
      ],
    },

    coda: {
      titolo: 'la coda dei prompt',
      righe: [
        'I prompt che scrivi mentre Claude sta lavorando. Ne parte uno per',
        'turno, appena Claude ha finito di rispondere: invece di aspettare per',
        'mandarli a mano, li lasci qui e vanno da soli.',
        '',
        'Tasti',
        '  scrivi  il testo del prossimo prompt',
        '  invio  lo accoda; su un prompt già in coda salva la modifica',
        '  shift+invio  va a capo dentro al prompt, senza accodarlo',
        '  ←→  muovono il cursore dentro al testo che stai scrivendo',
        '  ↑↓  scelgono un prompt della coda: il riquadro si sposta su di lui e',
        '  lo si modifica lì dentro',
        '  ctrl+↑↓  lo sposta su e giù',
        '  ctrl+s  stop: da lì in poi non parte più niente',
        '  ctrl+x  salta: scavalca quel prompt soltanto',
        '  ctrl+canc  toglie il prompt scelto',
        '  f1  queste istruzioni',
        '  esc  torna indietro',
        '  canc  esce da tutto',
        '',
        'Da sapere',
        'Per togliere un prompt serve ctrl+canc e non canc: canc esce da ogni',
        'schermata, e la coerenza vale più della comodità in una schermata',
        'sola. Per la stessa ragione qui le istruzioni sono su f1: la i è una',
        'lettera del prompt che stai scrivendo.',
        'Stop è una barriera e ferma anche i prompt che vengono dopo; salta ne',
        'scavalca uno solo.',
        'Quello che incolli è un prompt solo, anche se ha degli a capo dentro:',
        'a Claude arriva intero.',
        'Un prompt già in coda si corregge dove sta, nel riquadro: accodarlo non',
        'è più l\'ultimo momento per rileggerlo. Svuotarlo lo toglie, come una',
        'nota svuotata.',
        'Il prompt nuovo che stai scrivendo non si accoda passando su un altro:',
        'resta lì e lo ritrovi tornando in fondo. Accodarlo a metà scrittura',
        'vorrebbe dire vederlo partire da solo al turno dopo.',
        'Il prompt parte quando Claude sta zitto da un secondo e mezzo — e non',
        'mentre stai digitando tu, o il testo si mescolerebbe al tuo.',
        'La coda è legata a questa sessione, e cb la sposta da sé quando la',
        'sessione cambia (un /clear, un cambio di ramo).',
      ],
    },

    note: {
      titolo: 'le note della cartella',
      righe: [
        'Le note stanno alla cartella, non alla conversazione: le stesse in',
        'ogni sessione aperta qui dentro. È il motivo per cui esistono — una',
        'nota serve proprio quando la conversazione in cui l\'hai scritta è',
        'finita.',
        '',
        'Tasti',
        '  scrivi  il titolo, poi il corpo',
        '  invio  dal titolo scende al corpo, dal corpo salva la nota',
        '  shift+invio  va a capo dentro il corpo',
        '  ←→  muovono il cursore dentro al campo che stai scrivendo',
        '  ctrl+invio  mette la nota nella barra di Claude, senza mandarla',
        '  ctrl+f  cerca fra le note',
        '  ctrl+spazio  segna la nota scelta',
        '  ctrl+canc  cancella quelle segnate',
        '  ↑↓  scegli una nota',
        '  f1  queste istruzioni',
        '  esc  torna indietro',
        '  canc  esce da tutto',
        '',
        'Da sapere',
        'Il cursore parte sempre dal titolo: dal titolo si scende al corpo, dal',
        'corpo non si risale, e partendo dal corpo il titolo di una nota vecchia',
        'sarebbe impossibile da correggere.',
        'Con ctrl+invio il testo arriva nella barra pronto da correggere o da',
        'completare, e lo mandi tu: la coda manda, le note consegnano.',
        'Quello che incolli è una nota sola, a capo compresi, e resta nel campo',
        'in cui stai scrivendo. Nel titolo, che è una riga, diventano spazi.',
        'Le istruzioni sono su f1 e non su i per la stessa ragione della coda:',
        'qui la i è una lettera.',
      ],
    },

    configura: {
      titolo: 'le impostazioni',
      righe: [
        'Le tre cose che conviene scegliere una volta sola. Si torna qui con',
        'cb --impostazioni.',
        '',
        'Tasti',
        "  ↑↓  scegli l'impostazione",
        '  ←→  cambia il valore',
        '  invio  agisce sulla riga: apre il campo o conferma',
        '  i/f1  queste istruzioni',
        '  esc  tieni queste e vai avanti',
        '',
        'Da sapere',
        'La precedenza dei valori è ambiente, poi file, poi predefinito: una',
        'variabile passata a mano vince sul file, per quella volta.',
        'Un flag nel profilo PowerShell rende muta l\'impostazione',
        'corrispondente: se lo snippet passa --tasto, la scorciatoia scelta qui',
        'non si vede.',
        'Con «esc esc» la scorciatoia è anche il ripristino di Claude: cb la',
        'copre solo se i due Esc arrivano abbastanza vicini.',
        'Cambiando lingua cb si rilancia una volta, o la prima sessione',
        "resterebbe metà in una lingua e metà nell'altra.",
      ],
    },
  },

  codice: {
    ripristinati: (n) => `${n} file ripristinati`,
    cancellati: (n) => `${n} rimossi`,
    mancanti: (n) => `${n} non ripristinabili (copie scadute)`,
    fuori: (n) => `${n} fuori dalla cartella, non toccati`,
    giaCosi: "i file erano gia' in quello stato",
  },

  eseguibile: {
    forzatoAssente: (percorso) => `CB_CLAUDE_EXE non esiste: ${percorso}`,
    nonTrovato:
      'eseguibile di Claude Code non trovato. Installa Claude Code, oppure imposta CB_CLAUDE_EXE col suo percorso completo.',
  },
};

// Lingua in uso: CB_LINGUA, poi quella scelta nelle impostazioni, poi il locale
// di sistema — cosi' chi ha il computer in italiano non deve configurare niente
// nemmeno prima di aver visto la schermata. Qualsiasi valore che non cominci per
// "it" vale inglese.
//
// L'import va in fondo e non in cima solo per leggibilita': impostazioni.js non
// importa nulla da qui, quindi non c'e' ciclo.
const scelta = impostazione('lingua', Intl.DateTimeFormat().resolvedOptions().locale || 'en');

// Lingua effettivamente in uso, normalizzata. Serve a chi deve accorgersi che la
// scelta dell'utente e' diversa da quella con cui il processo e' partito: `T` si
// risolve all'import, e vista.js ne cattura legenda e voci del menu in costanti,
// quindi cambiarla a processo avviato non basterebbe.
export const LINGUA = scelta.toLowerCase().startsWith('it') ? 'it' : 'en';

export const T = LINGUA === 'it' ? IT : EN;
