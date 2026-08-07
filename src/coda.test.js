// Le prove scrivono su una cartella temporanea: una coda di prova non deve
// toccare quella vera di chi le esegue.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

process.env.CB_CODA = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-coda-'));

const { leggiCoda, scriviCoda, accoda, togli, trasferisci, disegnaCoda, apriCoda, percorsoCoda } =
  await import('./coda.js');

function testCodaVuotaEQuellaCheNonCE() {
  assert.deepEqual(leggiCoda('mai-vista'), [], 'una sessione senza file ha la coda vuota');
  assert.deepEqual(leggiCoda(null), [], 'e senza id nemmeno si prova a leggere');

  // Un file corrotto vale come coda vuota: la coda e' una comodita', e non deve
  // poter impedire di lavorare.
  fs.mkdirSync(process.env.CB_CODA, { recursive: true });
  fs.writeFileSync(percorsoCoda('rotta'), '{ questo non e json', 'utf8');
  assert.deepEqual(leggiCoda('rotta'), [], 'un file illeggibile non e un errore');
}

function testAccodaEToglie() {
  assert.deepEqual(accoda('s', 'primo'), ['primo']);
  assert.deepEqual(accoda('s', 'secondo'), ['primo', 'secondo'], 'i prompt vanno in fondo');
  assert.deepEqual(accoda('s', '   '), ['primo', 'secondo'], 'il vuoto non si accoda');
  assert.deepEqual(accoda('s', '  con spazi  '), ['primo', 'secondo', 'con spazi'], 'e si ripulisce');

  assert.deepEqual(togli('s', 1), ['primo', 'con spazi'], 'toglie quello scelto');
  assert.deepEqual(togli('s', 9), ['primo', 'con spazi'], 'un indice fuori elenco non fa niente');

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

  assert.deepEqual(leggiCoda('nuova'), ['uno', 'due'], 'i prompt arrivano nella sessione nuova');
  assert.deepEqual(leggiCoda('vecchia'), [], 'e non restano anche in quella vecchia');

  // Se di la' c'era gia' qualcosa, le due si uniscono: prima quelli che
  // aspettavano da prima.
  scriviCoda('a', ['gia qui']);
  scriviCoda('b', ['in arrivo']);
  trasferisci('b', 'a');
  assert.deepEqual(leggiCoda('a'), ['gia qui', 'in arrivo'], 'le code si uniscono in ordine');

  // Casi che non devono fare niente, ne' rompere.
  scriviCoda('sola', ['x']);
  trasferisci('sola', 'sola');
  assert.deepEqual(leggiCoda('sola'), ['x'], 'trasferire su se stessa non duplica');
  trasferisci(null, 'sola');
  trasferisci('sola', null);
  assert.deepEqual(leggiCoda('sola'), ['x'], 'senza un id non si sposta niente');
}

function testDisegno() {
  const righe = disegnaCoda(
    { prompt: ['aggiornare il README', 'fare il commit'], indice: 1, testo: 'sto scrivendo' },
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

  // Nessuna riga puo' eccedere la larghezza: una piu' lunga andrebbe a capo, e
  // il capo sfasa tutto il disegno sotto.
  const stretta = disegnaCoda(
    { prompt: ['un prompt molto piu lungo di quanto lo schermo sia largo'], indice: 0, testo: 'x' },
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
  assert.deepEqual(leggiCoda('ciclo'), ['ciao'], 'invio accoda quello che si e scritto');

  batti('secondo');
  batti('\r');
  assert.deepEqual(leggiCoda('ciclo'), ['ciao', 'secondo'], 'e si continua a scrivere');

  // Backspace cancella una lettera del testo, non un prompt della coda.
  batti('sbagliatx\x7f');
  batti('o\r');
  assert.deepEqual(leggiCoda('ciclo'), ['ciao', 'secondo', 'sbagliato'], 'backspace e per il testo');

  // Ctrl+canc toglie dalla coda: freccia giu' due volte per arrivare sul terzo.
  // Canc semplice no: quello esce dall'interfaccia, in questa schermata come in
  // tutte le altre, ed e' il prezzo che l'azione frequente paga alla coerenza.
  batti('\x1b[B');
  batti('\x1b[B');
  batti('\x1b[3;5~');
  assert.deepEqual(leggiCoda('ciclo'), ['ciao', 'secondo'], 'ctrl+canc toglie il prompt scelto');

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

const prove = [
  testCodaVuotaEQuellaCheNonCE,
  testAccodaEToglie,
  testLaCodaSegueLaSessione,
  testDisegno,
  testCicloDeiTasti,
];

for (const prova of prove) {
  await prova();
  console.log(`ok  ${prova.name}`);
}

fs.rmSync(process.env.CB_CODA, { recursive: true, force: true });
console.log(`\n${prove.length} prove superate`);
