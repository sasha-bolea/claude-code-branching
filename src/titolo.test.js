import assert from 'node:assert/strict';
import { senzaTitolo, sequenzaTitolo } from './titolo.js';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

function testRimuoveIlTitoloDiConPty() {
  // La sequenza reale osservata: ConPTY annuncia il percorso dell'eseguibile e
  // il titolo della tab diventa "...\claude.exe".
  const dati = `${ESC}]0;C:\\Users\\utente\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe${BEL}`;
  assert.equal(senzaTitolo(dati), '', 'la richiesta di titolo viene rimossa');
}

function testConservaIlRestoDellOutput() {
  const dati = `prima${ESC}]0;titolo${BEL}dopo`;
  assert.equal(senzaTitolo(dati), 'primadopo', 'solo la sequenza di titolo sparisce');
}

function testAccettaVariantiOsc() {
  // 0 = icona+titolo, 1 = solo icona, 2 = solo titolo; chiusura con BEL o ESC \
  assert.equal(senzaTitolo(`${ESC}]1;x${BEL}ok`), 'ok');
  assert.equal(senzaTitolo(`${ESC}]2;x${BEL}ok`), 'ok');
  assert.equal(senzaTitolo(`${ESC}]0;x${ESC}\\ok`), 'ok', 'chiusura con string terminator');
}

function testNonToccaAltreSequenze() {
  // Le sequenze che disegnano lo schermo devono passare intatte, altrimenti la
  // TUI di Claude si romperebbe.
  const colore = `${ESC}[31mrosso${ESC}[0m`;
  assert.equal(senzaTitolo(colore), colore, 'i colori restano');

  const pulisci = `${ESC}[2J${ESC}[H`;
  assert.equal(senzaTitolo(pulisci), pulisci, 'la pulizia schermo resta');

  // OSC diverso dal titolo (es. 8 = link): non e' affar nostro.
  const link = `${ESC}]8;;https://esempio${BEL}testo`;
  assert.equal(senzaTitolo(link), link, 'gli altri OSC passano');
}

function testAccettaBuffer() {
  const buf = Buffer.from(`${ESC}]0;x${BEL}ciao`, 'binary');
  assert.equal(senzaTitolo(buf), 'ciao', 'funziona anche con un Buffer');
}

function testOutputSenzaSequenze() {
  assert.equal(senzaTitolo('testo semplice'), 'testo semplice');
  assert.equal(senzaTitolo(''), '');
}

function testSequenzaTitolo() {
  assert.equal(sequenzaTitolo('cb'), `${ESC}]0;cb${BEL}`);
  // Deve essere rimovibile da senzaTitolo: cosi' un wrapper annidato non accumula.
  assert.equal(senzaTitolo(sequenzaTitolo('cb')), '');
}

const prove = [
  testRimuoveIlTitoloDiConPty,
  testConservaIlRestoDellOutput,
  testAccettaVariantiOsc,
  testNonToccaAltreSequenze,
  testAccettaBuffer,
  testOutputSenzaSequenze,
  testSequenzaTitolo,
];

for (const prova of prove) {
  prova();
  console.log(`ok  ${prova.name}`);
}
console.log(`\n${prove.length} prove superate`);
