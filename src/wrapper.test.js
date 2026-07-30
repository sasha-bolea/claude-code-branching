import assert from 'node:assert/strict';
import { Wrapper } from './wrapper.js';

// Costruisce un wrapper con pty e terminale finti, per provare la logica dei
// tasti senza lanciare Claude.
// opzioni: passate al costruttore
// ritorna: { wrapper, inoltrati, stato }
function wrapperFinto(opzioni = {}) {
  const wrapper = new Wrapper(opzioni);
  const inoltrati = [];
  const stato = { overlay: 0 };

  wrapper.processo = { write: () => {}, kill: () => {}, resize: () => {} };
  wrapper.inoltra = (dati) => inoltrati.push([...dati]);
  wrapper.mostraOverlay = () => {
    stato.overlay += 1;
  };
  wrapper.scrivi = () => {};

  return { wrapper, inoltrati, stato };
}

const ESC = 0x1b;
const esc = String.fromCharCode(27);
const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

// Sequenza win32-input-mode: e' la codifica reale su Windows Terminal.
const win32 = (vk, uc, kd = 1, cs = 32) =>
  Buffer.from(`${esc}[${vk};1;${uc};${kd};${cs};1_`, 'latin1');

const ESC_GIU = win32(27, 27, 1);
const ESC_SU = win32(27, 27, 0);

async function testDoppioEscInLettureSeparate() {
  const { wrapper, inoltrati, stato } = wrapperFinto();

  wrapper.gestisciInput(Buffer.from([ESC]));
  assert.equal(inoltrati.length, 0, 'il primo Esc viene trattenuto');

  wrapper.gestisciInput(Buffer.from([ESC]));
  assert.equal(stato.overlay, 1, 'il secondo Esc apre l albero');

  await attendi(400);
  assert.equal(inoltrati.length, 0, 'nessun Esc raggiunge Claude');
}

async function testDoppioEscNellaStessaLettura() {
  // Regressione: premendo Esc Esc velocemente i due tasti arrivano insieme.
  const { wrapper, inoltrati, stato } = wrapperFinto();

  wrapper.gestisciInput(Buffer.from([ESC, ESC]));

  assert.equal(stato.overlay, 1, 'due Esc nella stessa lettura aprono l albero');
  assert.equal(inoltrati.length, 0, 'nessun Esc raggiunge Claude');
}

async function testDoppioEscWin32() {
  // Il caso reale: Claude abilita win32-input-mode e i tasti arrivano come
  // ESC[27;1;27;1;32;1_, con gli eventi di rilascio in mezzo.
  const { wrapper, inoltrati, stato } = wrapperFinto();

  wrapper.gestisciInput(ESC_GIU);
  assert.equal(stato.overlay, 0, 'una sola pressione non basta');

  wrapper.gestisciInput(ESC_SU);
  wrapper.gestisciInput(ESC_GIU);

  assert.equal(stato.overlay, 1, 'la seconda pressione apre l albero');
  assert.equal(inoltrati.length, 0, 'niente raggiunge Claude');
}

async function testDoppioEscWin32NellaStessaLettura() {
  const { wrapper, inoltrati, stato } = wrapperFinto();

  wrapper.gestisciInput(Buffer.concat([ESC_GIU, ESC_SU, ESC_GIU]));

  assert.equal(stato.overlay, 1, 'apre l albero anche tutto in una lettura');
  assert.equal(inoltrati.length, 0, 'niente raggiunge Claude');
}

async function testEscSingoloWin32ArrivaAClaude() {
  const { wrapper, inoltrati, stato } = wrapperFinto();

  wrapper.gestisciInput(ESC_GIU);
  await attendi(400);

  assert.equal(stato.overlay, 0, 'un Esc solo non apre l albero');
  assert.equal(inoltrati.length, 1, 'viene inoltrato dopo l attesa');
  assert.deepEqual(Buffer.from(inoltrati[0]), ESC_GIU, 'la sequenza e identica all originale');
}

async function testEscSingoloGrezzoArrivaAClaude() {
  const { wrapper, inoltrati, stato } = wrapperFinto();

  wrapper.gestisciInput(Buffer.from([ESC]));
  await attendi(400);

  assert.equal(stato.overlay, 0, 'un Esc solo non apre l albero');
  assert.deepEqual(inoltrati, [[ESC]], 'viene inoltrato dopo l attesa');
}

async function testCtrlGScattaSubito() {
  const { wrapper, inoltrati, stato } = wrapperFinto({ scorciatoia: 'ctrl+g' });

  wrapper.gestisciInput(win32(71, 7, 1, 8));

  assert.equal(stato.overlay, 1, 'Ctrl+G apre l albero senza attesa');
  assert.equal(inoltrati.length, 0, 'non raggiunge Claude');
}

async function testF2ComeScorciatoia() {
  // La scorciatoia e' configurabile: nessun vincolo su Esc.
  const { wrapper, stato } = wrapperFinto({ scorciatoia: 'f2' });

  wrapper.gestisciInput(win32(0x71, 0, 1));

  assert.equal(stato.overlay, 1, 'F2 apre l albero');
}

async function testAltriTastiPassanoIntatti() {
  const { wrapper, inoltrati, stato } = wrapperFinto();
  const tastoS = win32(83, 115, 1);

  wrapper.gestisciInput(tastoS);

  assert.equal(stato.overlay, 0, 'un tasto qualsiasi non apre l albero');
  assert.deepEqual(Buffer.from(inoltrati[0]), tastoS, 'passa intatto');
}

async function testFrecceNonSonoScorciatoia() {
  const { wrapper, inoltrati, stato } = wrapperFinto();

  // Freccia su = ESC [ A
  wrapper.gestisciInput(Buffer.from([ESC, 0x5b, 0x41]));

  assert.equal(stato.overlay, 0, 'le frecce non aprono l albero');
  assert.deepEqual(inoltrati, [[ESC, 0x5b, 0x41]], 'la sequenza passa intatta');
}

async function testEscTrattenutoNonPerdeOrdine() {
  // Esc seguito da un tasto normale: Claude riceve prima l Esc, poi il tasto.
  const { wrapper, inoltrati, stato } = wrapperFinto();

  wrapper.gestisciInput(Buffer.from([ESC]));
  wrapper.gestisciInput(Buffer.from('a'));
  await attendi(400);

  assert.equal(stato.overlay, 0, 'Esc + lettera non apre l albero');
  assert.deepEqual(inoltrati, [[ESC], [0x61]], 'ordine dei tasti conservato');
}

async function testCodaDopoLaScorciatoiaVieneInoltrata() {
  const { wrapper, inoltrati, stato } = wrapperFinto();

  wrapper.gestisciInput(Buffer.from([ESC, ESC, 0x78]));

  assert.equal(stato.overlay, 1, 'l albero si apre');
  assert.deepEqual(inoltrati, [[0x78]], 'il carattere in coda viene inoltrato');
}

async function testTastiIgnoratiInOverlay() {
  const { wrapper, inoltrati } = wrapperFinto();
  wrapper.inOverlay = true;

  wrapper.gestisciInput(Buffer.from('ciao'));

  assert.equal(inoltrati.length, 0, 'mentre l albero e aperto Claude non riceve tasti');
}

const prove = [
  testDoppioEscInLettureSeparate,
  testDoppioEscNellaStessaLettura,
  testDoppioEscWin32,
  testDoppioEscWin32NellaStessaLettura,
  testEscSingoloWin32ArrivaAClaude,
  testEscSingoloGrezzoArrivaAClaude,
  testCtrlGScattaSubito,
  testF2ComeScorciatoia,
  testAltriTastiPassanoIntatti,
  testFrecceNonSonoScorciatoia,
  testEscTrattenutoNonPerdeOrdine,
  testCodaDopoLaScorciatoiaVieneInoltrata,
  testTastiIgnoratiInOverlay,
];

for (const prova of prove) {
  await prova();
  console.log(`ok  ${prova.name}`);
}
console.log(`\n${prove.length} prove superate`);
