import assert from 'node:assert/strict';
import {
  tokenizza,
  contaInTesta,
  analizzaScorciatoia,
  azioniTastiera,
  VK_ESCAPE,
} from './tasti.js';

const ESC = 0x1b;
const esc = String.fromCharCode(27);
const buf = (...byte) => Buffer.from(byte);
const testo = (s) => Buffer.from(s, 'latin1');

// Costruisce una sequenza win32-input-mode: ESC[Vk;Sc;Uc;Kd;Cs;Rc_
const win32 = (vk, uc, kd = 1, cs = 32) => testo(`${esc}[${vk};1;${uc};${kd};${cs};1_`);

const ESC_ESC = analizzaScorciatoia('esc esc');
const CTRL_G = analizzaScorciatoia('ctrl+g');

function testEscGrezzoSingolo() {
  const token = tokenizza(buf(ESC));
  assert.equal(token.length, 1);
  assert.equal(token[0].tasto.vk, VK_ESCAPE);
  assert.equal(contaInTesta(token, ESC_ESC).pressioni, 1);
}

function testDoppioEscGrezzoStessoBuffer() {
  // I due tasti arrivano in una sola lettura se premuti velocemente.
  assert.equal(contaInTesta(tokenizza(buf(ESC, ESC)), ESC_ESC).pressioni, 2);
}

function testFrecciaNonEscGrezzo() {
  // Freccia su = ESC [ A : l'Esc introduce una sequenza, non e' il tasto.
  assert.equal(contaInTesta(tokenizza(buf(ESC, 0x5b, 0x41)), ESC_ESC).pressioni, 0);
}

function testEscKitty() {
  assert.equal(contaInTesta(tokenizza(testo(`${esc}[27u`)), ESC_ESC).pressioni, 1);
}

function testDoppioEscKitty() {
  assert.equal(contaInTesta(tokenizza(testo(`${esc}[27u${esc}[27u`)), ESC_ESC).pressioni, 2);
}

function testEscWin32() {
  // La codifica reale osservata su Windows Terminal: ESC[27;1;27;1;32;1_
  const token = tokenizza(win32(27, 27));
  assert.equal(token.length, 1, 'la sequenza win32 e un solo token');
  assert.equal(token[0].tasto.vk, VK_ESCAPE);
  assert.equal(token[0].tasto.rilascio, false);
  assert.equal(contaInTesta(token, ESC_ESC).pressioni, 1);
}

function testDoppioEscWin32() {
  // Due pressioni intervallate dai rilasci, come le manda il terminale.
  const dati = Buffer.concat([win32(27, 27, 1), win32(27, 27, 0), win32(27, 27, 1)]);
  const { pressioni, consumati } = contaInTesta(tokenizza(dati), ESC_ESC);
  assert.equal(pressioni, 2, 'due pressioni riconosciute');
  assert.equal(consumati, 3, 'anche il rilascio in mezzo viene consumato');
}

function testRilascioNonContaComePressione() {
  const token = tokenizza(win32(27, 27, 0));
  assert.equal(token[0].tasto.rilascio, true);
  assert.equal(contaInTesta(token, ESC_ESC).pressioni, 0, 'il rilascio non e una pressione');
}

function testAltroTastoWin32NonScorciatoia() {
  // Tasto S rilasciato: ESC[83;31;83;0;1072;1_
  assert.equal(contaInTesta(tokenizza(win32(83, 83, 0, 1072)), ESC_ESC).pressioni, 0);
}

function testCtrlGWin32() {
  // Ctrl+G: vk 71 ('G'), stato con bit ctrl (0x8 = ctrl sinistro).
  const token = tokenizza(win32(71, 7, 1, 8));
  assert.equal(token[0].tasto.ctrl, true, 'il bit ctrl viene letto');
  assert.equal(contaInTesta(token, CTRL_G).pressioni, 1);
}

function testCtrlGNonScattaSenzaCtrl() {
  assert.equal(contaInTesta(tokenizza(win32(71, 103, 1, 32)), CTRL_G).pressioni, 0);
}

function testCtrlGByteGrezzo() {
  // Fuori da win32-input-mode Ctrl+G e' il byte 0x07.
  const token = tokenizza(buf(0x07));
  assert.equal(contaInTesta(token, CTRL_G).pressioni, 0, 'byte grezzo non porta il vk');
}

function testAnalizzaScorciatoie() {
  assert.equal(analizzaScorciatoia('esc esc').ripetizioni, 2);
  assert.equal(analizzaScorciatoia('esc').ripetizioni, 1);
  assert.equal(analizzaScorciatoia('ctrl+g').ctrl, true);
  assert.equal(analizzaScorciatoia('f2').vk, 0x71);
  assert.equal(analizzaScorciatoia('ctrl+shift+b').shift, true);
  assert.throws(() => analizzaScorciatoia('pippo'), /non riconosciuta/);
}

function testTestoNormaleNonScorciatoia() {
  assert.equal(contaInTesta(tokenizza(testo('ciao')), ESC_ESC).pressioni, 0);
}

function testBufferVuoto() {
  assert.deepEqual(tokenizza(Buffer.alloc(0)), []);
  assert.equal(contaInTesta([], ESC_ESC).pressioni, 0);
}

function testAzioniIgnoranoIRilasci() {
  // Il bug che chiudeva l'overlay all'istante: il rilascio di Ctrl arriva come
  // sequenza che inizia con 0x1b e veniva scambiato per Esc.
  const rilascioCtrl = win32(17, 0, 0);
  assert.deepEqual(azioniTastiera(rilascioCtrl), [], 'il rilascio non produce azioni');

  const rilascioG = win32(71, 7, 0, 8);
  assert.deepEqual(azioniTastiera(rilascioG), [], 'nessuna azione dal rilascio di G');
}

function testAzioniCifreEInvioWin32() {
  const due = win32(50, 50, 1); // tasto "2"
  assert.deepEqual(azioniTastiera(due), [{ tipo: 'cifra', valore: '2' }]);

  const invio = win32(13, 13, 1);
  assert.deepEqual(azioniTastiera(invio), [{ tipo: 'invio' }]);

  const escape = win32(27, 27, 1);
  assert.deepEqual(azioniTastiera(escape), [{ tipo: 'annulla' }]);

  const backspace = win32(8, 8, 1);
  assert.deepEqual(azioniTastiera(backspace), [{ tipo: 'cancella' }]);
}

function testAzioniIgnoranoIlMouse() {
  // Muovendo il mouse arrivano sequenze piene di cifre (le coordinate): non
  // devono finire nel numero digitato.
  const mouse = testo(`${esc}[<35;74;20M`);
  assert.deepEqual(azioniTastiera(mouse), [], 'le coordinate del mouse non sono cifre');
}

function testAzioniFrecce() {
  // Servono a navigare l'albero: prima venivano scartate con le altre sequenze.
  assert.deepEqual(azioniTastiera(buf(ESC, 0x5b, 0x41)), [{ tipo: 'freccia', valore: 'su' }]);
  assert.deepEqual(azioniTastiera(testo(`${esc}[B`)), [{ tipo: 'freccia', valore: 'giu' }]);
  assert.deepEqual(azioniTastiera(testo(`${esc}[C`)), [{ tipo: 'freccia', valore: 'destra' }]);
  assert.deepEqual(azioniTastiera(testo(`${esc}[D`)), [{ tipo: 'freccia', valore: 'sinistra' }]);

  // Codifica SS3, usata da alcuni terminali in modalita' applicazione.
  assert.deepEqual(azioniTastiera(testo(`${esc}OA`)), [{ tipo: 'freccia', valore: 'su' }]);
  // Con modificatori: ctrl+destra resta una freccia destra.
  assert.deepEqual(azioniTastiera(testo(`${esc}[1;5C`)), [{ tipo: 'freccia', valore: 'destra' }]);

  // In win32-input-mode le frecce arrivano come codice virtuale, senza carattere.
  assert.deepEqual(azioniTastiera(win32(38, 0, 1)), [{ tipo: 'freccia', valore: 'su' }]);
  assert.deepEqual(azioniTastiera(win32(40, 0, 1)), [{ tipo: 'freccia', valore: 'giu' }]);
  assert.deepEqual(azioniTastiera(win32(37, 0, 0)), [], 'il rilascio non muove il cursore');

  // Due frecce nella stessa lettura: succede tenendo premuto.
  assert.deepEqual(azioniTastiera(testo(`${esc}[A${esc}[A`)), [
    { tipo: 'freccia', valore: 'su' },
    { tipo: 'freccia', valore: 'su' },
  ]);
}

function testTastiFunzione() {
  const F2 = analizzaScorciatoia('f2');

  // win32-input-mode: F2 arriva come vk 113, senza carattere unicode.
  assert.equal(contaInTesta(tokenizza(win32(113, 0, 1)), F2).pressioni, 1, 'F2 in win32');
  assert.equal(contaInTesta(tokenizza(win32(114, 0, 1)), F2).pressioni, 0, 'F3 non scatta');
  assert.equal(contaInTesta(tokenizza(win32(113, 0, 0)), F2).pressioni, 0, 'il rilascio non scatta');

  // Codifica ANSI: SS3 per i primi quattro, CSI numerico per tutti.
  assert.equal(contaInTesta(tokenizza(testo(`${esc}OQ`)), F2).pressioni, 1, 'F2 come SS3');
  assert.equal(contaInTesta(tokenizza(testo(`${esc}[12~`)), F2).pressioni, 1, 'F2 come CSI');
  assert.equal(contaInTesta(tokenizza(testo(`${esc}[12;5~`)), F2).pressioni, 1, 'con modificatori');
  assert.equal(contaInTesta(tokenizza(testo(`${esc}OP`)), F2).pressioni, 0, 'F1 non e F2');

  // La numerazione CSI ha due buchi: 15 e' F5, 16 non esiste, 17 e' F6.
  assert.equal(contaInTesta(tokenizza(testo(`${esc}[15~`)), analizzaScorciatoia('f5')).pressioni, 1);
  assert.equal(contaInTesta(tokenizza(testo(`${esc}[17~`)), analizzaScorciatoia('f6')).pressioni, 1);

  // Un CSI numerico che non e' un tasto funzione (Canc = ESC[3~) resta byte
  // grezzi da inoltrare a Claude, non diventa un tasto inventato.
  const canc = tokenizza(testo(`${esc}[3~`));
  assert.equal(canc[0].tasto, null, 'Canc non e un tasto funzione');
  assert.equal(canc[0].bytes.toString('latin1'), `${esc}[3~`, 'e viene inoltrato intatto');

  // Dentro l'overlay un tasto funzione non deve muovere il cursore ne' digitare.
  assert.deepEqual(azioniTastiera(win32(113, 0, 1)), [], 'F2 non e un movimento');
  assert.deepEqual(azioniTastiera(testo(`${esc}OQ`)), [], 'nemmeno in ANSI');
}

function testAzioniWasd() {
  // Le lettere valgono come le frecce: w su, s giu, a sinistra, d destra.
  assert.deepEqual(azioniTastiera(testo('wasd')), [
    { tipo: 'freccia', valore: 'su' },
    { tipo: 'freccia', valore: 'sinistra' },
    { tipo: 'freccia', valore: 'giu' },
    { tipo: 'freccia', valore: 'destra' },
  ]);

  // Anche maiuscole: con shift premuto il movimento resta lo stesso.
  assert.deepEqual(azioniTastiera(testo('W')), [{ tipo: 'freccia', valore: 'su' }]);

  // In win32-input-mode il carattere arriva nel campo unicode.
  assert.deepEqual(azioniTastiera(win32(87, 119, 1)), [{ tipo: 'freccia', valore: 'su' }]);
  assert.deepEqual(azioniTastiera(win32(68, 100, 1)), [{ tipo: 'freccia', valore: 'destra' }]);
  assert.deepEqual(azioniTastiera(win32(87, 119, 0)), [], 'il rilascio non muove il cursore');

  // Con Ctrl e' una scorciatoia, non un movimento: Ctrl+D non deve navigare.
  const ctrlD = testo(`${esc}[68;1;100;1;${8};1_`);
  assert.deepEqual(azioniTastiera(ctrlD), [], 'ctrl+d non e un movimento');

  // Le altre lettere escono come 'lettera': servono alle caselle che si
  // accendono con un tasto loro (la scelta ricordata, nel menu del ripristino).
  // Chi non le usa le ignora.
  assert.deepEqual(azioniTastiera(testo('qz')), [
    { tipo: 'lettera', valore: 'q' },
    { tipo: 'lettera', valore: 'z' },
  ]);
  assert.deepEqual(azioniTastiera(win32(82, 114, 1)), [{ tipo: 'lettera', valore: 'r' }]);
}

function testAzioniByteGrezzi() {
  // Fuori da win32-input-mode l'input resta quello classico.
  assert.deepEqual(azioniTastiera(testo('12')), [
    { tipo: 'cifra', valore: '1' },
    { tipo: 'cifra', valore: '2' },
  ]);
  assert.deepEqual(azioniTastiera(buf(0x0d)), [{ tipo: 'invio' }]);
  assert.deepEqual(azioniTastiera(buf(0x7f)), [{ tipo: 'cancella' }]);
  assert.deepEqual(azioniTastiera(buf(ESC)), [{ tipo: 'annulla' }]);
}

const prove = [
  testEscGrezzoSingolo,
  testDoppioEscGrezzoStessoBuffer,
  testFrecciaNonEscGrezzo,
  testEscKitty,
  testDoppioEscKitty,
  testEscWin32,
  testDoppioEscWin32,
  testRilascioNonContaComePressione,
  testAltroTastoWin32NonScorciatoia,
  testCtrlGWin32,
  testCtrlGNonScattaSenzaCtrl,
  testCtrlGByteGrezzo,
  testAnalizzaScorciatoie,
  testTestoNormaleNonScorciatoia,
  testBufferVuoto,
  testAzioniIgnoranoIRilasci,
  testAzioniCifreEInvioWin32,
  testAzioniIgnoranoIlMouse,
  testAzioniFrecce,
  testTastiFunzione,
  testAzioniWasd,
  testAzioniByteGrezzi,
];

for (const prova of prove) {
  prova();
  console.log(`ok  ${prova.name}`);
}
console.log(`\n${prove.length} prove superate`);
