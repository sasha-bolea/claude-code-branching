// Le prove scrivono su una cartella temporanea: una coda di prova non deve
// toccare quella vera di chi le esegue.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

process.env.CB_CODA = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-coda-'));

const {
  leggiCoda,
  scriviCoda,
  accoda,
  togli,
  commuta,
  sposta,
  indiceProssimo,
  trasferisci,
  disegnaCoda,
  apriCoda,
  percorsoCoda,
} = await import('./coda.js');

// I prompt di una coda, senza gli interruttori: quasi tutte le prove guardano
// l'ordine e basta, e confrontare gli oggetti interi le renderebbe illeggibili.
const testi = (sessione) => leggiCoda(sessione).map((voce) => voce.testo);

function testCodaVuotaEQuellaCheNonCE() {
  assert.deepEqual(leggiCoda('mai-vista'), [], 'una sessione senza file ha la coda vuota');
  assert.deepEqual(leggiCoda(null), [], 'e senza id nemmeno si prova a leggere');

  // Un file corrotto vale come coda vuota: la coda e' una comodita', e non deve
  // poter impedire di lavorare.
  fs.mkdirSync(process.env.CB_CODA, { recursive: true });
  fs.writeFileSync(percorsoCoda('rotta'), '{ questo non e json', 'utf8');
  assert.deepEqual(leggiCoda('rotta'), [], 'un file illeggibile non e un errore');

  // Le code scritte prima che stop e salta esistessero hanno le voci come
  // stringhe: si leggono ancora, o una coda in attesa sparirebbe con
  // l'aggiornamento.
  fs.writeFileSync(percorsoCoda('vecchia-forma'), '{"prompt":["uno","due"]}', 'utf8');
  assert.deepEqual(
    leggiCoda('vecchia-forma'),
    [
      { testo: 'uno', stop: false, salta: false },
      { testo: 'due', stop: false, salta: false },
    ],
    'una coda del formato vecchio si legge lo stesso',
  );
}

function testAccodaEToglie() {
  assert.deepEqual(accoda('s', 'primo'), [{ testo: 'primo', stop: false, salta: false }]);
  assert.deepEqual(testi('s'), ['primo']);
  accoda('s', 'secondo');
  assert.deepEqual(testi('s'), ['primo', 'secondo'], 'i prompt vanno in fondo');
  accoda('s', '   ');
  assert.deepEqual(testi('s'), ['primo', 'secondo'], 'il vuoto non si accoda');
  accoda('s', '  con spazi  ');
  assert.deepEqual(testi('s'), ['primo', 'secondo', 'con spazi'], 'e si ripulisce');

  togli('s', 1);
  assert.deepEqual(testi('s'), ['primo', 'con spazi'], 'toglie quello scelto');
  togli('s', 9);
  assert.deepEqual(testi('s'), ['primo', 'con spazi'], 'un indice fuori elenco non fa niente');

  // Svuotandola il file sparisce, invece di restare come avanzo: e' cosi' che
  // l'hook capisce a colpo d'occhio che non c'e' niente da mandare.
  togli('s', 0);
  togli('s', 0);
  assert.equal(fs.existsSync(percorsoCoda('s')), false, 'una coda vuota non lascia il file');
}

// La coda e' legata all'id di sessione, e in cb quell'id cambia di continuo: un
// /clear fa nascere un file nuovo, ogni cambio ramo crea una sessione troncata.
// Senza il trasferimento i prompt gia' scritti resterebbero appesi a una
// sessione che non riceve piu' hook, cioe' sparirebbero in silenzio.
function testLaCodaSegueLaSessione() {
  scriviCoda('vecchia', ['uno', 'due']);
  trasferisci('vecchia', 'nuova');

  assert.deepEqual(testi('nuova'), ['uno', 'due'], 'i prompt arrivano nella sessione nuova');
  assert.deepEqual(leggiCoda('vecchia'), [], 'e non restano anche in quella vecchia');

  // Se di la' c'era gia' qualcosa, le due si uniscono: prima quelli che
  // aspettavano da prima.
  scriviCoda('a', ['gia qui']);
  scriviCoda('b', ['in arrivo']);
  trasferisci('b', 'a');
  assert.deepEqual(testi('a'), ['gia qui', 'in arrivo'], 'le code si uniscono in ordine');

  // Gli interruttori seguono il prompt: uno stop messo prima di un cambio ramo
  // deve valere anche dopo, o la coda ripartirebbe da sola.
  scriviCoda('c', [{ testo: 'fermo', stop: true, salta: false }]);
  trasferisci('c', 'd');
  assert.deepEqual(leggiCoda('d'), [{ testo: 'fermo', stop: true, salta: false }], 'lo stop segue');

  // Casi che non devono fare niente, ne' rompere.
  scriviCoda('sola', ['x']);
  trasferisci('sola', 'sola');
  assert.deepEqual(testi('sola'), ['x'], 'trasferire su se stessa non duplica');
  trasferisci(null, 'sola');
  trasferisci('sola', null);
  assert.deepEqual(testi('sola'), ['x'], 'senza un id non si sposta niente');
}

// Le due regole sono diverse apposta: salta scavalca un prompt solo, stop e' una
// barriera e ferma anche tutti quelli dopo di lui.
function testStopESaltaDecidonoChiParte() {
  const coda = (voci) => voci.map((v) => ({ testo: v[0], stop: !!v[1], salta: !!v[2] }));

  assert.equal(indiceProssimo([]), -1, 'a coda vuota non parte niente');
  assert.equal(indiceProssimo(coda([['a'], ['b']])), 0, 'senza interruttori parte il primo');
  assert.equal(indiceProssimo(coda([['a', false, true], ['b']])), 1, 'un salta si scavalca');
  assert.equal(
    indiceProssimo(coda([['a', false, true], ['b', false, true], ['c']])),
    2,
    'e se ne scavalcano quanti ce ne sono',
  );
  assert.equal(indiceProssimo(coda([['a', true], ['b']])), -1, 'uno stop ferma tutto');
  assert.equal(
    indiceProssimo(coda([['a'], ['b', true], ['c']])),
    0,
    'ma solo da se stesso in giu: quelli prima partono',
  );
  assert.equal(
    indiceProssimo(coda([['a', false, true], ['b', true]])),
    -1,
    'scavalcando un salta si puo finire su uno stop',
  );
}

function testCommutaESposta() {
  scriviCoda('i', ['uno', 'due', 'tre']);

  commuta('i', 1, 'stop');
  assert.deepEqual(leggiCoda('i')[1], { testo: 'due', stop: true, salta: false }, 'accende');
  commuta('i', 1, 'stop');
  assert.equal(leggiCoda('i')[1].stop, false, 'e ripremendo spegne');

  // I due interruttori sono indipendenti: si possono avere tutt e due.
  commuta('i', 0, 'salta');
  commuta('i', 0, 'stop');
  assert.deepEqual(leggiCoda('i')[0], { testo: 'uno', stop: true, salta: true }, 'convivono');
  commuta('i', 9, 'stop');
  assert.equal(leggiCoda('i').length, 3, 'un indice fuori elenco non fa niente');

  scriviCoda('o', ['uno', 'due', 'tre']);
  sposta('o', 2, 'su');
  assert.deepEqual(testi('o'), ['uno', 'tre', 'due'], 'su scambia con quello sopra');
  sposta('o', 0, 'giu');
  assert.deepEqual(testi('o'), ['tre', 'uno', 'due'], 'giu con quello sotto');

  // Ai bordi non succede niente, ed e' il modo in cui il chiamante non deve
  // controllarli.
  sposta('o', 0, 'su');
  sposta('o', 2, 'giu');
  assert.deepEqual(testi('o'), ['tre', 'uno', 'due'], 'ai bordi non si sposta niente');

  // Gli interruttori viaggiano col prompt, non con la posizione.
  scriviCoda('m', [{ testo: 'fermo', stop: true, salta: false }, 'libero']);
  sposta('m', 0, 'giu');
  assert.deepEqual(
    leggiCoda('m').map((v) => `${v.testo}:${v.stop}`),
    ['libero:false', 'fermo:true'],
    'lo stop resta attaccato al suo prompt',
  );
}

function testDisegno() {
  const voci = (...testi) => testi.map((t) => ({ testo: t, stop: false, salta: false }));

  // Il cursore sul prompt nuovo, in fondo: e' dove si sta appena aperta la
  // schermata, e i due prompt gia' in coda restano righe dell'elenco.
  const righe = disegnaCoda(
    { prompt: voci('aggiornare il README', 'fare il commit'), indice: 2, testo: 'sto scrivendo' },
    { colonne: 100, altezza: 20 },
  );
  const testo = righe.join('\n');

  assert.equal(righe.length, 20, 'la schermata riempie lo schermo esatto');
  assert.match(testo, /2 prompt in attesa/, 'dice quanti ne aspettano');
  assert.match(testo, /1\. aggiornare il README/, 'il primo sta in cima all elenco');
  assert.match(testo, /2\. fare il commit/, 'e il secondo sta sotto');
  // Il campo sta dentro il riquadro, come la nota che si sta scrivendo: le due
  // schermate fanno la stessa cosa e si impaginano allo stesso modo.
  assert.match(testo, /╭─+╮/, 'il campo e in un riquadro');
  // «Accoda prompt» sta su una riga sua, col testo sotto: e' una frase, e il
  // testo accanto partirebbe da meta' riquadro. Il numero di un prompt, che e'
  // corto, resta invece sulla stessa riga del testo (verificato piu' sotto).
  assert.match(testo, /│ accoda prompt\s+│/, 'la frase sta su una riga sua');
  assert.match(testo, /│ sto scrivendo█/, 'e il testo sotto');
  // Un separatore sopra ogni prompt e sopra il riquadro, come nelle note.
  assert.equal(
    righe.filter((r) => /^ +─+$/.test(r)).length,
    4,
    'uno per prompt, uno per il riquadro, e quello sopra la legenda',
  );

  // Con il cursore su un prompt gia' in coda, il riquadro si sposta **su di
  // lui**: e' li' che lo si modifica, come una nota. La sua intestazione tiene
  // il numero e lo stato, o non si saprebbe quale si sta toccando.
  const sulPrimo = disegnaCoda(
    { prompt: voci('aggiornare il README', 'fare il commit'), indice: 0, testo: 'aggiornare il README', cursore: 20 },
    { colonne: 100, altezza: 20 },
  ).join('\n');
  assert.match(
    sulPrimo,
    /│ {2}1\. aggiornare il README█/,
    'il numero apre la riga e il testo segue, modificabile',
  );
  assert.match(sulPrimo, / {4}2\. fare il commit/, 'l altro resta una riga dell elenco');
  assert.match(sulPrimo, /accoda prompt/, 'e il posto in fondo resta annunciato');
  // La legenda in fondo allo schermo, come in ogni altra schermata di cb. Qui i
  // tasti sono tanti e sta su due righe: accorciarla fino a farceli stare tutti
  // su una sola vorrebbe dire buttarne via, cioe' tasti che non sai di avere.
  assert.match(righe[19], /esc indietro/, 'la legenda finisce sull ultima riga');
  assert.match(righe[18], /invio accoda/, 'e comincia su quella sopra');
  assert.match(righe[17], /^ +─+$/, 'col separatore sopra a tutt e due');
  // Ogni tasto della schermata compare, nessuno escluso.
  const barra = `${righe[18]}${righe[19]}`;
  for (const tasto of ['invio', 'shift+invio', '←→', '↑↓', 'ctrl+↑↓', 'ctrl+canc', 'f1', 'esc', 'canc']) {
    assert.ok(barra.includes(tasto), `la legenda nomina ${tasto}`);
  }

  const vuota = disegnaCoda({ prompt: [], indice: 0, testo: '' }, { colonne: 100, altezza: 20 });
  assert.match(vuota.join('\n'), /la coda è vuota/, 'una coda vuota lo dice');

  // Quello che partirebbe davvero non e' per forza il primo dell'elenco: con un
  // salta di mezzo l'ordine non si legge dalla numerazione, e infatti si
  // riconosce dal colore (verificato piu' sotto, coi colori accesi).
  const conMarchi = disegnaCoda(
    {
      prompt: [
        { testo: 'scavalcato', stop: false, salta: true },
        { testo: 'questo parte', stop: false, salta: false },
        { testo: 'barriera', stop: true, salta: false },
        { testo: 'dietro la barriera', stop: false, salta: false },
      ],
      // Il cursore sul prompt nuovo: cosi' tutti e quattro restano righe
      // dell'elenco, che e' dove si leggono i marchi.
      indice: 4,
      testo: '',
    },
    { colonne: 100, altezza: 24 },
  ).join('\n');
  assert.match(conMarchi, /1\. scavalcato {2}⤼ salta/, 'il salta si vede');
  assert.match(conMarchi, /3\. barriera {2}‖ stop/, 'lo stop si vede');

  // Il prompt che partira' e' arancione, e non porta piu' un'etichetta scritta:
  // con un salta di mezzo e' il secondo, non il primo dell'elenco.
  process.env.NO_COLOR = '';
  process.env.CB_COLORI = '1';
  try {
    const colorata = disegnaCoda(
      {
        prompt: [
          { testo: 'scavalcato', stop: false, salta: true },
          { testo: 'questo parte', stop: false, salta: false },
        ],
        indice: 2,
        testo: '',
      },
      { colonne: 100, altezza: 20 },
    );
    // L'arancione forte porta anche il grassetto: e' il colore con cui cb marca
    // quello che conta (vedi stile.js).
    const arancio = '\x1b[1;38;2;255;140;102m';
    const riga = (testo) => colorata.find((r) => r.includes(testo));
    assert.ok(riga('questo parte').startsWith(arancio), 'il prossimo e arancione');
    assert.ok(!riga('scavalcato').startsWith(arancio), 'lo scavalcato no');
    assert.doesNotMatch(colorata.join('\n'), /il prossimo/, 'e l etichetta non c e piu');
  } finally {
    process.env.CB_COLORI = '';
    process.env.NO_COLOR = '1';
  }

  // Nessuna riga puo' eccedere la larghezza: una piu' lunga andrebbe a capo, e
  // il capo sfasa tutto il disegno sotto.
  const stretta = disegnaCoda(
    {
      prompt: [{ testo: 'un prompt molto piu lungo di quanto lo schermo sia largo', stop: true, salta: true }],
      indice: 0,
      testo: 'x',
    },
    { colonne: 40, altezza: 12 },
  );
  for (const riga of stretta) assert.ok(riga.length <= 40, `riga lunga ${riga.length}: ${riga}`);
}

// Il ciclo vero, con un terminale finto: e' l'unico modo di verificare che i
// tasti arrivino dove devono. Le prove unitarie sulle azioni non se ne
// accorgerebbero.
async function testCicloDeiTasti() {
  const ingresso = new EventEmitter();
  ingresso.resume = () => {};
  ingresso.pause = () => {};
  const uscita = new EventEmitter();
  uscita.write = () => {};
  uscita.columns = 100;
  uscita.rows = 24;

  const attesa = apriCoda({ sessione: 'ciclo', ingresso, uscita });
  const batti = (testo) => ingresso.emit('data', Buffer.from(testo, 'latin1'));

  batti('ciao');
  batti('\r');
  assert.deepEqual(testi('ciclo'), ['ciao'], 'invio accoda quello che si e scritto');

  batti('secondo');
  batti('\r');
  assert.deepEqual(testi('ciclo'), ['ciao', 'secondo'], 'e si continua a scrivere');

  // Backspace cancella una lettera del testo, non un prompt della coda.
  batti('sbagliatx\x7f');
  batti('o\r');
  assert.deepEqual(testi('ciclo'), ['ciao', 'secondo', 'sbagliato'], 'backspace e per il testo');

  // Ctrl+↑↓ sposta il prompt scelto, e il cursore lo segue: senza, il secondo
  // ctrl+↑ sposterebbe un altro prompt.
  //
  // Si parte dal prompt nuovo, in fondo — la schermata si apre per scrivere —
  // quindi per arrivare sul secondo si sale di due.
  batti('\x1b[A\x1b[A'); // sul secondo
  batti('\x1b[1;5B'); // ctrl+giu: scende in fondo
  assert.deepEqual(testi('ciclo'), ['ciao', 'sbagliato', 'secondo'], 'ctrl+giu sposta in giu');
  batti('\x1b[1;5A');
  assert.deepEqual(testi('ciclo'), ['ciao', 'secondo', 'sbagliato'], 'e ctrl+su lo riporta su');

  // Ctrl+s e ctrl+x accendono gli interruttori sul prompt scelto: le lettere
  // semplici finiscono nel campo di testo, quindi qui servono con ctrl.
  batti('\x13');
  assert.equal(leggiCoda('ciclo')[1].stop, true, 'ctrl+s mette lo stop');
  batti('\x18');
  assert.equal(leggiCoda('ciclo')[1].salta, true, 'ctrl+x mette il salta');
  batti('\x13');
  assert.equal(leggiCoda('ciclo')[1].stop, false, 'e ripremendo si spegne');

  // Ctrl+canc toglie dalla coda: freccia giu' per arrivare sul terzo.
  // Canc semplice no: quello esce dall'interfaccia, in questa schermata come in
  // tutte le altre, ed e' il prezzo che l'azione frequente paga alla coerenza.
  batti('\x1b[B');
  batti('\x1b[3;5~');
  assert.deepEqual(testi('ciclo'), ['ciao', 'secondo'], 'ctrl+canc toglie il prompt scelto');

  // Esc risale di un passo: chi ci ha chiamato riapre l'albero.
  batti('\x1b');
  assert.equal(await attesa, 'indietro', 'esc torna indietro di un passo');

  // Chiudendo, lo stdin resta com'era prima: e' il chiamante a rimetterlo come
  // lo vuole (vedi wrapper.mostraCoda).
  assert.equal(ingresso.listenerCount('data'), 0, 'la schermata si stacca dallo stdin');

  // Canc invece esce dall'interfaccia intera: chi ci ha chiamato non riapre
  // niente e torna dritto a Claude.
  const seconda = apriCoda({ sessione: 'ciclo', ingresso, uscita });
  ingresso.emit('data', Buffer.from('\x1b[3~', 'latin1'));
  assert.equal(await seconda, 'esci', 'canc esce da tutto');
}

// Un tasto che non fa niente non deve ridisegnare niente.
//
// Ogni ridisegno ripulisce lo schermo, e con lui se ne va la selezione del testo
// fatta col mouse: premendo ctrl per copiare — che come evento di tastiera
// arriva, ma non produce nessuna azione — la selezione sparivo proprio nel
// momento in cui serviva. Vale per tutte le schermate, e questa e' quella dove
// si prova, perche' ha il terminale finto.
async function testUnCtrlDaSoloNonRidisegna() {
  const ingresso = new EventEmitter();
  ingresso.resume = () => {};
  ingresso.pause = () => {};
  const disegni = [];
  const uscita = new EventEmitter();
  uscita.write = (t) => disegni.push(t);
  uscita.columns = 100;
  uscita.rows = 24;

  const attesa = apriCoda({ sessione: 'ctrl', ingresso, uscita });
  const batti = (testo) => ingresso.emit('data', Buffer.from(testo, 'latin1'));

  disegni.length = 0;
  // Ctrl premuto da solo, in win32-input-mode: vk 17, nessun carattere, ctrl fra
  // i modificatori. E il suo rilascio subito dopo.
  batti('\x1b[17;29;0;1;8;1_');
  batti('\x1b[17;29;0;0;0;1_');
  assert.equal(disegni.length, 0, 'ctrl da solo non ridisegna');

  // Un tasto vero invece ridisegna, o non si vedrebbe piu' niente.
  batti('x');
  assert.equal(disegni.length, 1, 'una lettera si');

  batti('\x1b[3~');
  await attesa;
}

// Le istruzioni qui stanno su F1, e la i resta una lettera del prompt: e' la
// ragione per cui esiste il tasto funzione, e va provata proprio qui — dove
// premere "i" per l'aiuto scriverebbe una lettera nel testo che stai per
// accodare. Mentre la pagina e' aperta il campo resta com'era.
async function testF1ApreLeIstruzioniELaISeneResta() {
  const ingresso = new EventEmitter();
  ingresso.resume = () => {};
  ingresso.pause = () => {};
  let schermo = '';
  const uscita = new EventEmitter();
  uscita.write = (t) => {
    schermo = t;
  };
  uscita.columns = 100;
  uscita.rows = 30;

  const attesa = apriCoda({ sessione: 'aiuto', ingresso, uscita });
  const batti = (testo) => ingresso.emit('data', Buffer.from(testo, 'latin1'));

  batti('ciao');
  assert.match(schermo, /ciao/, 'quello che scrivi si vede');

  batti('\x1bOP'); // F1
  assert.match(schermo, /istruzioni: la coda/, 'F1 apre la pagina della coda');
  assert.match(schermo, /ctrl\+canc/, 'che spiega perche togliere non e canc');

  // I tasti sono della pagina: quello che digiti non finisce nel campo.
  batti('zzz');
  assert.doesNotMatch(schermo, /ciaozzz/, 'il testo non si allunga di nascosto');

  batti('\x1b'); // esc: si torna alla coda, col campo com'era
  assert.match(schermo, /ciao/, 'e il campo e ancora quello di prima');
  assert.doesNotMatch(schermo, /istruzioni: la coda/, 'la pagina se n e andata');

  // La i, in questa schermata, resta una lettera.
  batti('i');
  assert.match(schermo, /ciaoi/, 'la i si scrive, non apre niente');

  batti('\x1b[3~');
  assert.equal(await attesa, 'esci');
}

// Un testo incollato e' un prompt solo, a capo compresi.
//
// Prima succedeva l'opposto in tutt'e due i modi in cui il terminale lo
// consegna: coi marcatori del bracketed paste (ESC[200~…ESC[201~) il blocco
// finiva fra i byte non riconosciuti e veniva scartato — si incollava e non
// compariva niente — e senza marcatori ogni a capo valeva come invio, quindi un
// prompt di tre righe si accodava come tre prompt.
async function testIncollareNonSpezzaIlPrompt() {
  for (const [nome, sequenza] of [
    ['coi marcatori', '\x1b[200~prima riga\nseconda riga\x1b[201~'],
    ['senza marcatori', 'prima riga\nseconda riga'],
  ]) {
    const ingresso = new EventEmitter();
    ingresso.resume = () => {};
    ingresso.pause = () => {};
    let schermo = '';
    const uscita = new EventEmitter();
    uscita.write = (t) => {
      schermo = t;
    };
    uscita.columns = 100;
    uscita.rows = 30;

    const sessione = `incolla-${nome.replace(/\s/g, '-')}`;
    const attesa = apriCoda({ sessione, ingresso, uscita });
    const batti = (testo) => ingresso.emit('data', Buffer.from(testo, 'utf8'));

    batti(sequenza);
    // Nel riquadro l'a capo e' un a capo vero, come nel corpo di una nota: il
    // campo non e' piu' una riga sola che scorre.
    assert.match(schermo, /prima riga/, `${nome}: la prima riga sta nel campo`);
    assert.match(schermo, /seconda riga█/, `${nome}: e la seconda pure, col cursore in fondo`);
    assert.deepEqual(leggiCoda(sessione), [], `${nome}: e non e' ancora partito niente`);

    batti('\r'); // ora sì: un prompt solo
    const coda = leggiCoda(sessione);
    assert.equal(coda.length, 1, `${nome}: un incolla fa un prompt solo`);
    assert.equal(coda[0].testo, 'prima riga\nseconda riga', `${nome}: con gli a capo dentro`);

    batti('\x1b[3~');
    await attesa;
  }
}

// Shift+invio va a capo dentro al prompt, e le frecce ← → portano il cursore
// dove serve: prima il testo si poteva solo allungare in fondo, e una lettera
// sbagliata in mezzo costringeva a cancellare tutto quello che veniva dopo.
async function testShiftInvioECursoreNelTesto() {
  const ingresso = new EventEmitter();
  ingresso.resume = () => {};
  ingresso.pause = () => {};
  let schermo = '';
  const uscita = new EventEmitter();
  uscita.write = (t) => {
    schermo = t;
  };
  uscita.columns = 100;
  uscita.rows = 30;

  const attesa = apriCoda({ sessione: 'cursore', ingresso, uscita });
  const batti = (testo) => ingresso.emit('data', Buffer.from(testo, 'utf8'));
  // Shift+invio in codifica CSI-u, quella che porta i modificatori: nei byte
  // grezzi i due invii sono lo stesso \r e non si distinguono.
  const shiftInvio = () => batti('\x1b[13;2u');

  // Il cursore (█) si disegna dove sta davvero, quindi compare in mezzo alle
  // stringhe che si verificano qui sotto: e' proprio quello che si vuole vedere.
  batti('prima');
  shiftInvio();
  batti('seconda');
  assert.match(schermo, /│ prima\s*│/, 'shift+invio va a capo invece di accodare');
  assert.match(schermo, /seconda█/, 'e il seguito sta sulla riga sotto');
  assert.deepEqual(leggiCoda('cursore'), [], 'e non ha accodato niente');

  // Tre frecce a sinistra e una lettera: entra dove sta il cursore, non in
  // fondo. Le tre frecce arrivano in un blocco solo — e' cosi' che stdin le
  // consegna tenendo premuto — e devono valere tre.
  batti('\x1b[D\x1b[D\x1b[D');
  batti('X');
  assert.match(schermo, /secoX█nda/, 'si scrive nel punto del cursore');

  // Backspace toglie prima del cursore, non l'ultimo carattere del testo.
  batti('\x7f');
  assert.match(schermo, /seco█nda/, 'e si cancella li');

  // Freccia a destra fino in fondo e invio: un prompt solo, con l'a capo dentro.
  batti('\x1b[C\x1b[C\x1b[C');
  batti('\r');
  const coda = leggiCoda('cursore');
  assert.equal(coda.length, 1, 'invio accoda');
  assert.equal(coda[0].testo, 'prima\nseconda', 'con l a capo di shift+invio');

  batti('\x1b[3~');
  await attesa;
}

// Il riquadro segue la selezione, e il prompt che ci sta dentro si **modifica**:
// accodarlo non e' piu' l'ultimo momento per correggerlo. E' la stessa cosa che
// fanno le note, dove la nota scelta e' quella che si sta scrivendo.
//
// La bozza del prompt nuovo non si accoda passando su un altro: accodarla a
// meta' scrittura vorrebbe dire vederla partire da sola al turno dopo, per una
// freccia premuta.
async function testIlRiquadroSeguelaSceltaEilPromptSiModifica() {
  const ingresso = new EventEmitter();
  ingresso.resume = () => {};
  ingresso.pause = () => {};
  let schermo = '';
  const uscita = new EventEmitter();
  uscita.write = (t) => {
    schermo = t;
  };
  uscita.columns = 90;
  uscita.rows = 24;

  const attesa = apriCoda({ sessione: 'riquadro', ingresso, uscita });
  const batti = (testo) => ingresso.emit('data', Buffer.from(testo, 'utf8'));
  const testi = () => leggiCoda('riquadro').map((p) => p.testo);

  batti('primo');
  batti('\r');
  batti('secondo');
  batti('\r');
  assert.deepEqual(testi(), ['primo', 'secondo']);

  // Una bozza a meta', e poi via con le frecce: non deve finire in coda.
  batti('bozza a meta');
  batti('\x1b[A\x1b[A'); // su fino al primo
  assert.deepEqual(testi(), ['primo', 'secondo'], 'la bozza non si accoda da sola');
  assert.match(schermo, /1. primo█/, 'il riquadro e sul primo, col suo testo dentro');
  assert.match(schermo, /│ {2}1\./, 'e porta il numero del prompt');

  // Si scrive dentro: il prompt si corregge dove sta.
  batti(' corretto');
  batti('\x13'); // ctrl+s: lo stop vale sul prompt del riquadro
  batti('\x1b[B'); // giu: la modifica si salva uscendo, come una nota
  assert.deepEqual(testi(), ['primo corretto', 'secondo'], 'la modifica si salva');
  assert.equal(leggiCoda('riquadro')[0].stop, true, 'e lo stop e finito su quello giusto');

  // Tornando in fondo si ritrova la bozza dov'era, e invio la accoda.
  batti('\x1b[B');
  assert.match(schermo, /bozza a meta█/, 'la bozza e ancora li');
  batti('\r');
  assert.deepEqual(testi(), ['primo corretto', 'secondo', 'bozza a meta'], 'e ora si accoda');

  // Svuotare un prompt lo toglie, come una nota svuotata: nessun tasto in piu'.
  batti('\x1b[A\x1b[A'); // sul secondo
  for (let i = 0; i < 20; i += 1) batti('\x7f');
  batti('\x1b[B'); // uscendo, il prompt svuotato sparisce
  assert.deepEqual(testi(), ['primo corretto', 'bozza a meta'], 'svuotato, sparisce');

  batti('\x1b[3~');
  await attesa;
}

const prove = [
  testCodaVuotaEQuellaCheNonCE,
  testAccodaEToglie,
  testLaCodaSegueLaSessione,
  testStopESaltaDecidonoChiParte,
  testCommutaESposta,
  testDisegno,
  testCicloDeiTasti,
  testUnCtrlDaSoloNonRidisegna,
  testF1ApreLeIstruzioniELaISeneResta,
  testIncollareNonSpezzaIlPrompt,
  testShiftInvioECursoreNelTesto,
  testIlRiquadroSeguelaSceltaEilPromptSiModifica,
];

for (const prova of prove) {
  await prova();
  console.log(`ok  ${prova.name}`);
}

fs.rmSync(process.env.CB_CODA, { recursive: true, force: true });
console.log(`\n${prove.length} prove superate`);
