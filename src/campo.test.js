// Prove sul campo di testo con il cursore: le funzioni sono pure, quindi si
// provano senza terminale e senza premere niente.
//
// Sono le stesse per la coda e per le note — e' il motivo per cui stanno in un
// modulo solo — quindi un errore qui si vedrebbe in tutte e due le schermate.

import assert from 'node:assert/strict';
import { inserisci, cancella, muovi, conCursore, dentro, finestra } from './campo.js';

// Scrivere avviene nel punto del cursore, e il cursore lo segue.
function testSiScriveDoveStaIlCursore() {
  assert.deepEqual(inserisci('ciao', 4, '!'), { testo: 'ciao!', cursore: 5 }, 'in fondo');
  assert.deepEqual(inserisci('ciao', 0, '>'), { testo: '>ciao', cursore: 1 }, 'in testa');
  assert.deepEqual(inserisci('cao', 1, 'i'), { testo: 'ciao', cursore: 2 }, 'in mezzo');
  // Un blocco incollato sposta il cursore di tutta la sua lunghezza, non di uno.
  assert.deepEqual(inserisci('ab', 1, 'XYZ'), { testo: 'aXYZb', cursore: 4 }, 'un blocco intero');
  // Anche gli a capo sono testo: shift+invio scrive un \n dove sta il cursore.
  assert.deepEqual(inserisci('ab', 1, '\n'), { testo: 'a\nb', cursore: 2 }, 'e un a capo');
}

// Backspace toglie il carattere prima del cursore, non l'ultimo del testo.
function testSiCancellaPrimaDelCursore() {
  assert.deepEqual(cancella('ciao', 4), { testo: 'cia', cursore: 3 }, 'in fondo come sempre');
  assert.deepEqual(cancella('ciaao', 4), { testo: 'ciao', cursore: 3 }, 'in mezzo');
  // In testa non c'e' niente da togliere: senza questa guardia uno `slice(0,-1)`
  // si mangerebbe l'ultimo carattere, cioe' dalla parte opposta.
  assert.deepEqual(cancella('ciao', 0), { testo: 'ciao', cursore: 0 }, 'in testa non fa niente');
}

// Il cursore si ferma ai due capi invece di girare: tenendo premuta la freccia,
// saltare dall'inizio alla fine sposterebbe la scrittura dove non te l'aspetti.
function testIlCursoreSiFermaAiCapi() {
  assert.equal(muovi('ciao', 2, 'sinistra'), 1);
  assert.equal(muovi('ciao', 2, 'destra'), 3);
  assert.equal(muovi('ciao', 0, 'sinistra'), 0, 'in testa resta li');
  assert.equal(muovi('ciao', 4, 'destra'), 4, 'e in fondo pure');
  assert.equal(muovi('ciao', 2, 'giu'), 2, 'le altre direzioni non lo muovono');
}

// Una posizione fuori scala si riporta dentro: dopo aver cancellato una nota o
// caricato la successiva, un cursore rimasto oltre la fine scriverebbe di nuovo
// in fondo senza dirlo.
function testLaPosizioneTornaSempreDentro() {
  assert.equal(dentro('ciao', 99), 4);
  assert.equal(dentro('ciao', -3), 0);
  assert.equal(dentro('ciao', undefined), 4, 'senza posizione si sta in fondo');
  assert.deepEqual(inserisci('ab', 99, 'c'), { testo: 'abc', cursore: 3 }, 'e scrivere lo rispetta');
}

// Il cursore si conta in caratteri e non in byte: una emoji e' un carattere solo,
// e contandola in byte il cursore ci cadrebbe dentro spezzandola a schermo.
function testUnaEmojiEUnCarattereSolo() {
  const testo = 'a🌍b';
  assert.equal(dentro(testo, 99), 3, 'tre caratteri, non quattro');
  assert.deepEqual(inserisci(testo, 2, '!'), { testo: 'a🌍!b', cursore: 3 });
  assert.deepEqual(cancella(testo, 2), { testo: 'ab', cursore: 1 }, 'e se ne va tutta insieme');
}

// Il glifo si infila accanto al carattere invece di coprirlo: coprendolo non si
// vedrebbe piu' la lettera su cui stai per scrivere.
function testIlGlifoSiInfilaNelTesto() {
  assert.equal(conCursore('ciao', 2, '|'), 'ci|ao');
  assert.equal(conCursore('ciao', 4, '|'), 'ciao|', 'in fondo');
  assert.equal(conCursore('', 0, '|'), '|', 'e su un campo vuoto c e solo lui');
}

// Il campo alto una riga mostra la parte attorno al cursore, e dice da che parte
// ha tagliato: un testo piu' largo dello spazio, mostrato intero, esce dal suo
// riquadro e il terminale lo manda a capo — sfasando tutto il disegno sotto.
function testLaFinestraSegueIlCursore() {
  // Ci sta tutto: niente da tagliare e niente da dichiarare.
  assert.deepEqual(finestra('ciao', 2, 10), { testo: 'ciao', cursore: 2, prima: false, dopo: false });

  const lungo = 'abcdefghijklmnopqrstuvwxyz';

  // Cursore in fondo: si vede la coda, e i puntini dicono che sopra c'e' altro.
  const infondo = finestra(lungo, 26, 10);
  assert.equal(infondo.testo, 'qrstuvwxyz');
  assert.equal(infondo.cursore, 10, 'il cursore resta dentro la finestra');
  assert.deepEqual([infondo.prima, infondo.dopo], [true, false]);

  // Cursore in testa: si vede l'inizio.
  const intesta = finestra(lungo, 0, 10);
  assert.equal(intesta.testo, 'abcdefghij');
  assert.equal(intesta.cursore, 0);
  assert.deepEqual([intesta.prima, intesta.dopo], [false, true]);

  // In mezzo la finestra si sposta e resta della misura chiesta: e' quello che
  // tiene il bordo destro fermo mentre si scrive.
  const meta = finestra(lungo, 13, 10);
  assert.equal([...meta.testo].length, 10, 'la finestra e sempre larga uguale');
  assert.ok(meta.cursore >= 0 && meta.cursore <= 10, 'e il cursore ci sta dentro');
  assert.deepEqual([meta.prima, meta.dopo], [true, true], 'tagliata da tutt e due le parti');
}

const prove = [
  testSiScriveDoveStaIlCursore,
  testSiCancellaPrimaDelCursore,
  testIlCursoreSiFermaAiCapi,
  testLaPosizioneTornaSempreDentro,
  testUnaEmojiEUnCarattereSolo,
  testIlGlifoSiInfilaNelTesto,
  testLaFinestraSegueIlCursore,
];

for (const prova of prove) {
  prova();
  console.log(`ok  ${prova.name}`);
}
console.log(`\n${prove.length} prove superate`);
