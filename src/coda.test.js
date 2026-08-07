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

  const righe = disegnaCoda(
    { prompt: voci('aggiornare il README', 'fare il commit'), indice: 1, testo: 'sto scrivendo' },
    { colonne: 100, altezza: 20 },
  );
  const testo = righe.join('\n');

  assert.equal(righe.length, 20, 'la schermata riempie lo schermo esatto');
  assert.match(testo, /2 prompt in attesa/, 'dice quanti ne aspettano');
  assert.match(testo, /1\. aggiornare il README {2}il prossimo/, 'il primo e marcato come prossimo');
  assert.match(testo, /▸ {2}2\. fare il commit/, 'il cursore sta su quello scelto');
  assert.match(testo, /> sto scrivendo█/, 'il campo mostra il testo con il cursore');
  // La legenda in fondo allo schermo, come in ogni altra schermata di cb.
  assert.match(righe[19], /invio accoda/, 'la legenda e l ultima riga');
  assert.match(righe[18], /^ +─+$/, 'con il separatore sopra');

  const vuota = disegnaCoda({ prompt: [], indice: 0, testo: '' }, { colonne: 100, altezza: 20 });
  assert.match(vuota.join('\n'), /la coda è vuota/, 'una coda vuota lo dice');

  // «il prossimo» sta su quello che partirebbe davvero, non sul primo: con un
  // salta di mezzo l'ordine non si legge piu' dalla numerazione.
  const conMarchi = disegnaCoda(
    {
      prompt: [
        { testo: 'scavalcato', stop: false, salta: true },
        { testo: 'questo parte', stop: false, salta: false },
        { testo: 'barriera', stop: true, salta: false },
        { testo: 'dietro la barriera', stop: false, salta: false },
      ],
      indice: 0,
      testo: '',
    },
    { colonne: 100, altezza: 20 },
  ).join('\n');
  assert.match(conMarchi, /1\. scavalcato {2}⤼ salta/, 'il salta si vede');
  assert.match(conMarchi, /2\. questo parte {2}il prossimo/, 'e il prossimo e quello dopo');
  assert.match(conMarchi, /3\. barriera {2}⏸ stop/, 'lo stop si vede');

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
  batti('\x1b[B'); // sul secondo
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

const prove = [
  testCodaVuotaEQuellaCheNonCE,
  testAccodaEToglie,
  testLaCodaSegueLaSessione,
  testStopESaltaDecidonoChiParte,
  testCommutaESposta,
  testDisegno,
  testCicloDeiTasti,
  testUnCtrlDaSoloNonRidisegna,
];

for (const prova of prove) {
  await prova();
  console.log(`ok  ${prova.name}`);
}

fs.rmSync(process.env.CB_CODA, { recursive: true, force: true });
console.log(`\n${prove.length} prove superate`);
