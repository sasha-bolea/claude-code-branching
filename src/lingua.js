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
  cb --impostazioni     settings screen: language, work folder, shortcut
                        (it opens by itself the first time)
  cb --version          version number
  cb --help             this text

In the tree inside a session: ←→ (or a/d) move along the conversation, ↑↓ (or
w/s) switch branch, enter restarts from there, esc goes back to Claude. From
there "c" opens the folder's conversations and "p" the folder picker: you change
conversation or project without closing Claude. The commands above use the
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

  // src/vista.js — l'albero dentro la sessione
  albero: {
    legenda: [
      `${VUOTO} restart here   ${FORCA} fork   orange = history of this point`,
      `${VUOTO} restart here   ${FORCA} fork`,
      `${VUOTO} restart here`,
    ],
    vociRipristino: [
      'conversation and code',
      'conversation only (files stay as they are)',
      'code only (the conversation stays where it is)',
    ],
    titolo: 'branches of the conversation',
    titoloCorto: 'tree',
    escLunga: 'back to Claude',
    escCorta: 'exit',
    righeSopra: (n) => `↑ ${n} rows above`,
    righeSotto: (n) => `↓ ${n} rows below`,
    promptPrima: (n) => `← ${n} prompts back`,
    promptDopo: (n) => `${n} prompts ahead →`,
    ripartiDaQui: 'restart here',
    precedenti: (n) => `earlier: ${n}`,
    riportaIndietro: 'roll back:',
    legendaMenu: [
      '↑↓ pick   1-3 direct choice   enter confirm   esc back to tree',
      '↑↓ pick   enter confirm   esc tree',
      '↑↓ enter esc',
    ],
    invioConFile: 'enter = restart (restores files too)',
    invioSenzaFile: 'enter = restart (files stay as they are)',
    avantiIndietro: '←→ ad back and forth',
    avantiIndietroCorto: '←→ ad back/forward',
    frecce: '←→ ad',
    cambiaRamo: '↑↓ ws switch branch',
    ramo: '↑↓ ws branch',
    frecceCorte: '↑↓ ws',
    invioRiparti: 'enter = restart',
    barraMinima: (esc) => `←→↑↓ move  enter restart  esc ${esc}`,
    // Tasti in piu' disponibili solo dentro la sessione, e nome dell'uscita
    // quando l'albero e' stato aperto dal selettore delle conversazioni.
    extraLunga: 'c = other conversation   p = other folder',
    extraCorta: 'c/p other conv.',
    escElencoLunga: 'back to the list',
    escElencoCorta: 'list',
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
    nonEsiste: 'this folder does not exist',
    legende: [
      '↑↓ pick the setting   ←→ change   enter acts on the row   esc keep these',
      '↑↓ setting   ←→ change   enter acts   esc keep',
      '↑↓ ←→ enter esc',
    ],
    legendeTesto: [
      'type the path   ~ is your home   enter confirms   esc leaves it as it was',
      'type the path   enter ok   esc back',
      'enter ok   esc back',
    ],
  },

  // src/cartelle.js — selettore della cartella di lavoro
  cartelle: {
    legende: [
      '↑↓ scroll   →← open/close   space open/close   r switch mode   enter confirm   esc cancel',
      '↑↓ scroll   →← open/close   r mode   enter ok   esc cancel',
      '↑↓ →←   r mode   enter ok   esc cancel',
      '↑↓ →← r enter esc',
    ],
    titolo: '  Working folder for Claude',
    modoRipresa: 'resume a conversation (-r)',
    modoNormale: 'normal start',
  },

  // src/conversazioni.js — selettore delle conversazioni passate
  conversazioni: {
    legende: [
      [
        "↑↓ pick the conversation   enter go into the tree   esc cancel",
        '↑↓ conversation   enter tree   esc exit',
      ],
      [
        '←→ back and forth   ↑↓ switch branch   enter restart here   esc back to list',
        '←→↑↓ move   enter restart   esc list',
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
    senzaTranscript: (scorciatoia, sessione) => [
      'This conversation has no transcript on disk yet.',
      '',
      'Claude writes it at the first exchange: send a prompt, wait for the',
      `answer, then press ${scorciatoia} again.`,
      '',
      `session: ${sessione}`,
    ],
    ripartoDa: (testo) => `restarting from: ${testo}`,
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
  cb --impostazioni     schermata delle impostazioni: lingua, cartella, scorciatoia
                        (la prima volta si apre da sola)
  cb --version          numero di versione
  cb --aiuto            questo testo

Nell'albero dentro la sessione: ←→ (o a/d) scorrono la conversazione, ↑↓ (o w/s)
cambiano ramo, invio riparte da lì, esc torna a Claude. Da lì "c" apre l'elenco
delle conversazioni della cartella e "p" prima il selettore delle cartelle: si
cambia conversazione o progetto senza chiudere Claude. I comandi qui sopra usano
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

  albero: {
    legenda: [
      `${VUOTO} riparti da qui   ${FORCA} biforcazione   arancione = storia di questo punto`,
      `${VUOTO} riparti da qui   ${FORCA} biforcazione`,
      `${VUOTO} riparti da qui`,
    ],
    vociRipristino: [
      'conversazione e codice',
      'solo la conversazione (i file restano come sono)',
      "solo il codice (la conversazione resta dov'è)",
    ],
    titolo: 'rami di questa conversazione',
    titoloCorto: 'rami',
    escLunga: 'torna a Claude',
    escCorta: 'esci',
    righeSopra: (n) => `↑ ${n} righe sopra`,
    righeSotto: (n) => `↓ ${n} righe sotto`,
    promptPrima: (n) => `← ${n} prompt prima`,
    promptDopo: (n) => `${n} prompt dopo →`,
    ripartiDaQui: 'riparti da qui',
    precedenti: (n) => `precedenti: ${n}`,
    riportaIndietro: 'riporta indietro:',
    legendaMenu: [
      '↑↓ scegli   1-3 scelta diretta   invio conferma   esc torna all albero',
      '↑↓ scegli   invio conferma   esc albero',
      '↑↓ invio esc',
    ],
    invioConFile: 'invio = riparti (ripristina anche i file)',
    invioSenzaFile: 'invio = riparti (i file restano come sono)',
    avantiIndietro: '←→ ad avanti e indietro',
    avantiIndietroCorto: '←→ ad indietro/avanti',
    frecce: '←→ ad',
    cambiaRamo: '↑↓ ws cambia ramo',
    ramo: '↑↓ ws ramo',
    frecceCorte: '↑↓ ws',
    invioRiparti: 'invio = riparti',
    barraMinima: (esc) => `←→↑↓ muovi  invio riparti  esc ${esc}`,
    extraLunga: 'c = altra conversazione   p = altra cartella',
    extraCorta: 'c/p altra conv.',
    escElencoLunga: "torna all'elenco",
    escElencoCorta: 'elenco',
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
    nonEsiste: 'questa cartella non esiste',
    legende: [
      "↑↓ scegli l'impostazione   ←→ cambia   invio agisce sulla riga   esc tieni queste",
      '↑↓ impostazione   ←→ cambia   invio agisce   esc tieni',
      '↑↓ ←→ invio esc',
    ],
    legendeTesto: [
      'scrivi il percorso   ~ e la tua home   invio conferma   esc lascia com era',
      'scrivi il percorso   invio ok   esc indietro',
      'invio ok   esc indietro',
    ],
  },

  cartelle: {
    legende: [
      '↑↓ scorri   →← apri/chiudi   spazio apri/chiudi   r cambia modo   invio conferma   esc annulla',
      '↑↓ scorri   →← apri/chiudi   r modo   invio ok   esc annulla',
      '↑↓ →←   r modo   invio ok   esc annulla',
      '↑↓ →← r invio esc',
    ],
    titolo: '  Cartella di lavoro per Claude',
    modoRipresa: 'ripresa della conversazione (-r)',
    modoNormale: 'avvio normale',
  },

  conversazioni: {
    legende: [
      [
        "↑↓ scegli la conversazione   invio entra nell'albero   esc annulla",
        '↑↓ conversazione   invio albero   esc esci',
      ],
      [
        "←→ avanti e indietro   ↑↓ cambia ramo   invio riparti da qui   esc torna all'elenco",
        '←→↑↓ muovi   invio riparti   esc elenco',
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
    senzaTranscript: (scorciatoia, sessione) => [
      'Questa conversazione non ha ancora un transcript su disco.',
      '',
      'Claude lo scrive al primo scambio: manda un prompt, attendi la',
      `risposta, poi ripremi ${scorciatoia}.`,
      '',
      `sessione: ${sessione}`,
    ],
    ripartoDa: (testo) => `riparto da: ${testo}`,
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
