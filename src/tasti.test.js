import assert from 'node:assert/strict';
import {
  tokenizza,
  contaInTesta,
  analizzaScorciatoia,
  azioniTastiera,
  azioniNavigazione,
  azioniCoda,
  azioniNote,
  VK_ESCAPE,
  MODI_MOUSE,
  SPEGNI_MODI_INPUT,
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
  // Un clic non muove il cursore: l'albero non ha un bersaglio da cliccare.
  assert.deepEqual(azioniTastiera(testo(`${esc}[<0;74;20M`)), [], 'il clic non e un movimento');
}

// La rotella scorre la conversazione come le frecce sinistra e destra: l'albero
// e' orizzontale, e sono i rami — non i turni — a stare uno sotto l'altro.
function testRotellaScorreOrizzontalmente() {
  const sinistra = [{ tipo: 'freccia', valore: 'sinistra' }];
  const destra = [{ tipo: 'freccia', valore: 'destra' }];

  // Codifica SGR (modo ?1006), quella che cb chiede.
  assert.deepEqual(azioniTastiera(testo(`${esc}[<64;74;20M`)), sinistra, 'rotella su');
  assert.deepEqual(azioniTastiera(testo(`${esc}[<65;74;20M`)), destra, 'rotella giu');
  // Rotella orizzontale: trackpad e mouse con la rotella inclinabile.
  assert.deepEqual(azioniTastiera(testo(`${esc}[<66;74;20M`)), sinistra, 'rotella a sinistra');
  assert.deepEqual(azioniTastiera(testo(`${esc}[<67;74;20M`)), destra, 'rotella a destra');
  // Con shift premuto il codice porta il bit 4: senza toglierlo non si
  // riconoscerebbe piu' la rotella.
  assert.deepEqual(azioniTastiera(testo(`${esc}[<68;74;20M`)), sinistra, 'shift+rotella su');
  // Codifica storica: ESC[M e tre byte, con 32 sommato a ciascuno. La usa un
  // terminale che non capisce ?1006.
  assert.deepEqual(
    azioniTastiera(buf(ESC, 0x5b, 0x4d, 64 + 32, 10 + 32, 5 + 32)),
    sinistra,
    'rotella su nella codifica vecchia',
  );
  // Due giri di rotella in una lettura sola sono due movimenti, non uno.
  assert.deepEqual(
    azioniTastiera(testo(`${esc}[<65;74;20M${esc}[<65;74;20M`)),
    [...destra, ...destra],
    'due scorrimenti nella stessa lettura',
  );

  // Anche l'albero dentro il selettore delle conversazioni si scorre con la
  // rotella: legge con azioniNavigazione, che parla per stringhe.
  assert.deepEqual(azioniNavigazione(testo(`${esc}[<64;74;20M`)), ['sinistra']);
  assert.deepEqual(azioniNavigazione(testo(`${esc}[<65;74;20M`)), ['destra']);
  assert.deepEqual(azioniNavigazione(testo(`${esc}[<0;74;20M`)), [], 'il clic non naviga');
}

// La coda dei prompt e' l'unica schermata dove si scrive testo **e** si naviga
// un elenco: serve un decodificatore suo, perche' azioniTesto le frecce le
// scarta e azioniTastiera mappa w/a/s/d sulle direzioni — che in un prompt
// servono come lettere.
function testAzioniDellaCoda() {
  // Le maiuscole contano: un prompt e' testo, non una scorciatoia. In
  // win32-input-mode `carattere` arriva gia' minuscolo, quindi si usa `grezzo`.
  assert.deepEqual(azioniCoda(win32(65, 65)), [{ tipo: 'carattere', valore: 'A' }], 'la A resta A');
  assert.deepEqual(azioniCoda(testo('Ciao')), [
    { tipo: 'carattere', valore: 'C' },
    { tipo: 'carattere', valore: 'i' },
    { tipo: 'carattere', valore: 'a' },
    { tipo: 'carattere', valore: 'o' },
  ]);

  // w/a/s/d sono lettere, non direzioni: e' la differenza con azioniTastiera.
  assert.deepEqual(azioniCoda(testo('was')), [
    { tipo: 'carattere', valore: 'w' },
    { tipo: 'carattere', valore: 'a' },
    { tipo: 'carattere', valore: 's' },
  ]);

  // Le frecce invece navigano l'elenco, in tutt'e due le codifiche.
  assert.deepEqual(azioniCoda(testo(`${esc}[B`)), [{ tipo: 'freccia', valore: 'giu' }]);
  assert.deepEqual(azioniCoda(win32(38, 0)), [{ tipo: 'freccia', valore: 'su' }]);

  // Con ctrl la stessa freccia sposta il prompt invece di scorrere l'elenco: e'
  // il motivo per cui i modificatori delle sequenze CSI vanno letti e non
  // scartati (ESC[1;5A, dove 5 = 1 + ctrl).
  assert.deepEqual(azioniCoda(testo(`${esc}[1;5A`)), [{ tipo: 'sposta', valore: 'su' }], 'ANSI');
  assert.deepEqual(azioniCoda(win32(40, 0, 1, 8)), [{ tipo: 'sposta', valore: 'giu' }], 'win32');
  // Shift no: sposterebbe per sbaglio selezionando.
  assert.deepEqual(azioniCoda(testo(`${esc}[1;2A`)), [{ tipo: 'freccia', valore: 'su' }], 'shift');
  // Destra e sinistra non hanno dove andare: l'elenco e' verticale.
  assert.deepEqual(azioniCoda(testo(`${esc}[1;5C`)), [], 'ctrl+destra non sposta niente');

  // Ctrl+s e ctrl+x accendono gli interruttori. Con ctrl premuto il terminale
  // consegna il carattere di controllo (0x13), non "s": si guarda il codice
  // virtuale, e nei byte grezzi il carattere di controllo stesso.
  assert.deepEqual(azioniCoda(win32(0x53, 0x13, 1, 8)), [{ tipo: 'commuta', valore: 'stop' }]);
  assert.deepEqual(azioniCoda(win32(0x58, 0x18, 1, 8)), [{ tipo: 'commuta', valore: 'salta' }]);
  assert.deepEqual(azioniCoda(testo('\x13')), [{ tipo: 'commuta', valore: 'stop' }], 'ctrl+s grezzo');
  assert.deepEqual(azioniCoda(testo('\x18')), [{ tipo: 'commuta', valore: 'salta' }], 'ctrl+x grezzo');
  // Senza ctrl restano lettere del prompt.
  assert.deepEqual(azioniCoda(testo('sx')), [
    { tipo: 'carattere', valore: 's' },
    { tipo: 'carattere', valore: 'x' },
  ]);

  // Backspace cancella una lettera del testo che stai scrivendo: un tasto solo
  // non puo' fare due cose a seconda di quanto hai scritto.
  assert.deepEqual(azioniCoda(testo('\x7f')), [{ tipo: 'cancella' }]);

  // Canc esce dall'interfaccia, qui come in ogni altra schermata: e' l'unico
  // tasto che vale lo stesso ovunque, ed e' quello che lo rende utile. Togliere
  // un prompt e' ctrl+canc — l'azione frequente paga il prezzo della coerenza.
  assert.deepEqual(azioniCoda(testo(`${esc}[3~`)), [{ tipo: 'esci' }], 'canc in ANSI');
  assert.deepEqual(azioniCoda(win32(46, 0)), [{ tipo: 'esci' }], 'e in win32');
  // ESC[3;5~: il parametro e' 1 + i modificatori, e 4 e' ctrl.
  assert.deepEqual(azioniCoda(testo(`${esc}[3;5~`)), [{ tipo: 'togli' }], 'ctrl+canc in ANSI');
  assert.deepEqual(azioniCoda(win32(46, 0, 1, 8)), [{ tipo: 'togli' }], 'e in win32');
  // Shift+canc non e' ctrl: non deve togliere per sbaglio.
  assert.deepEqual(azioniCoda(testo(`${esc}[3;2~`)), [{ tipo: 'esci' }], 'shift+canc esce');

  assert.deepEqual(azioniCoda(win32(27, 27)), [{ tipo: 'annulla' }]);
  assert.deepEqual(azioniCoda(win32(65, 65, 0)), [], 'il rilascio non scrive niente');

  // La rotella scorre l'elenco, che qui e' verticale: su e giu', non i lati.
  assert.deepEqual(azioniCoda(testo(`${esc}[<64;10;5M`)), [{ tipo: 'freccia', valore: 'su' }]);
  assert.deepEqual(azioniCoda(testo(`${esc}[<65;10;5M`)), [{ tipo: 'freccia', valore: 'giu' }]);
}

// Nelle note l'invio fa tre cose a seconda dei modificatori, e sono tutte
// frequenti: e' il motivo per cui azioniCoda non basta.
function testAzioniDelleNote() {
  // Invio semplice: salva. Shift: a capo. Ctrl: manda la nota a Claude.
  assert.deepEqual(azioniNote(testo('\r')), [{ tipo: 'invio' }], 'invio grezzo');
  assert.deepEqual(azioniNote(win32(13, 13)), [{ tipo: 'invio' }], 'invio win32');
  assert.deepEqual(azioniNote(win32(13, 13, 1, 16)), [{ tipo: 'acapo' }], 'shift+invio win32');
  assert.deepEqual(azioniNote(win32(13, 13, 1, 8)), [{ tipo: 'manda' }], 'ctrl+invio win32');
  // Codifica kitty: ESC[13;2u e' shift, ESC[13;5u e' ctrl.
  assert.deepEqual(azioniNote(testo(`${esc}[13;2u`)), [{ tipo: 'acapo' }], 'shift+invio kitty');
  assert.deepEqual(azioniNote(testo(`${esc}[13;5u`)), [{ tipo: 'manda' }], 'ctrl+invio kitty');
  assert.deepEqual(azioniNote(testo(`${esc}[13u`)), [{ tipo: 'invio' }], 'invio kitty');

  // Il testo e' testo: maiuscole comprese, e w/a/s/d sono lettere.
  assert.deepEqual(azioniNote(win32(65, 65)), [{ tipo: 'carattere', valore: 'A' }], 'la A resta A');
  assert.deepEqual(azioniNote(testo('was')), [
    { tipo: 'carattere', valore: 'w' },
    { tipo: 'carattere', valore: 'a' },
    { tipo: 'carattere', valore: 's' },
  ]);

  // Le frecce cambiano nota, backspace corregge il testo.
  assert.deepEqual(azioniNote(testo(`${esc}[A`)), [{ tipo: 'freccia', valore: 'su' }]);
  assert.deepEqual(azioniNote(win32(40, 0)), [{ tipo: 'freccia', valore: 'giu' }]);
  assert.deepEqual(azioniNote(testo('\x7f')), [{ tipo: 'cancella' }]);

  // Esc risale di un passo, Canc esce da tutto: come in ogni altra schermata.
  assert.deepEqual(azioniNote(win32(27, 27)), [{ tipo: 'annulla' }]);
  assert.deepEqual(azioniNote(testo(`${esc}[3~`)), [{ tipo: 'esci' }], 'canc in ANSI');
  assert.deepEqual(azioniNote(win32(46, 0)), [{ tipo: 'esci' }], 'e in win32');

  // Ctrl+f apre la ricerca fra le note. Come per gli interruttori della coda, con
  // ctrl premuto il terminale consegna il carattere di controllo (0x06), non "f":
  // si guarda il codice virtuale, e nei byte grezzi il carattere di controllo.
  assert.deepEqual(azioniNote(win32(0x46, 0x06, 1, 8)), [{ tipo: 'cerca' }], 'ctrl+f win32');
  assert.deepEqual(azioniNote(testo('\x06')), [{ tipo: 'cerca' }], 'ctrl+f grezzo');
  assert.deepEqual(azioniNote(testo('f')), [{ tipo: 'carattere', valore: 'f' }], 'senza ctrl e una f');

  assert.deepEqual(azioniNote(win32(65, 65, 0)), [], 'il rilascio non scrive niente');
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

// Il testo incollato arriva in due forme, e vanno riconosciute tutt'e due.
//
// Coi marcatori del bracketed paste il blocco comincia con ESC: senza
// riconoscerlo finiva fra i byte non riconosciuti, che le schermate scartano
// come sequenze di controllo — si incollava e non compariva niente. Senza
// marcatori i byte passano uno per uno, e gli a capo diventano invii: un prompt
// di tre righe si accodava come tre prompt.
function testIncollaRiconosciutoNelleDueForme() {
  const atteso = [{ tipo: 'incolla', valore: 'due\nrighe' }];

  assert.deepEqual(azioniCoda(testo(`${esc}[200~due\nrighe${esc}[201~`)), atteso, 'coi marcatori');
  assert.deepEqual(azioniCoda(testo('due\nrighe')), atteso, 'e senza');
  assert.deepEqual(azioniNote(testo(`${esc}[200~due\nrighe${esc}[201~`)), atteso, 'anche le note');

  // Gli a capo si normalizzano in tutt'e due le strade, e non e' cosmesi: un \r
  // che arriva fino allo schermo riporta il cursore a inizio riga, e il disegno
  // si riscrive sopra se stesso. E' cosi' che un titolo incollato usciva dal
  // riquadro delle note — non era troppo lungo, erano i suoi \r.
  assert.deepEqual(azioniCoda(testo('due\r\nrighe')), atteso, 'i \\r\\n diventano \\n');
  assert.deepEqual(azioniCoda(testo(`${esc}[200~due\r\nrighe${esc}[201~`)), atteso, 'anche coi marcatori');
  assert.deepEqual(azioniCoda(testo(`${esc}[200~due\rrighe${esc}[201~`)), atteso, 'e il \\r da solo');
  assert.deepEqual(azioniNote(testo(`${esc}[200~due\r\nrighe${esc}[201~`)), atteso, 'e nelle note');

  // Gli accenti sopravvivono: dentro un incolla il testo si rilegge in utf8, non
  // byte per byte come i tasti.
  assert.deepEqual(
    azioniCoda(Buffer.from(`${esc}[200~perché\nquà${esc}[201~`, 'utf8')),
    [{ tipo: 'incolla', valore: 'perché\nquà' }],
    'gli accenti restano quelli',
  );

  // Dentro i marcatori il terminale mette **eventi di tastiera**, non caratteri:
  // con win32-input-mode acceso — e dentro cb lo e' sempre — gli a capo del
  // testo incollato arrivano come ESC[13;…_, con tanto di evento di rilascio.
  // Copiati alla lettera finivano nella nota come una fila di numeri.
  const invio = `${esc}[13;28;13;1;0;1_`;
  const rilasciato = `${esc}[13;28;13;0;0;1_`;
  assert.deepEqual(
    azioniNote(testo(`${esc}[200~prima riga${invio}${rilasciato}seconda riga${esc}[201~`)),
    [{ tipo: 'incolla', valore: 'prima riga\nseconda riga' }],
    'gli eventi invio dentro l incolla diventano a capo',
  );
  // Anche le lettere possono arrivare come eventi, e sono testo pure loro.
  const lettera = (vk, uc) => testo(`${esc}[${vk};1;${uc};1;32;1_`);
  const pezzi = Buffer.concat([
    testo(`${esc}[200~`),
    lettera(65, 97),
    lettera(66, 98),
    testo(invio),
    lettera(67, 99),
    testo(`${esc}[201~`),
  ]);
  assert.deepEqual(azioniCoda(pezzi), [{ tipo: 'incolla', valore: 'ab\nc' }], 'e le lettere pure');

  // Un incolla lungo arriva spezzato fra due letture: si prende quello che c'e',
  // e la fine che arriva da sola si consuma senza lasciare traccia a schermo.
  assert.deepEqual(azioniCoda(testo(`${esc}[200~meta del`)), [
    { tipo: 'incolla', valore: 'meta del' },
  ]);
  assert.deepEqual(azioniCoda(testo(`${esc}[201~`)), [], 'la fine da sola non produce niente');

  // Digitare resta digitare: un invio da solo invia, e una lettera sola non e'
  // un incolla nemmeno se la segue un a capo.
  assert.deepEqual(azioniCoda(testo('\r')), [{ tipo: 'invio' }]);
  assert.deepEqual(azioniCoda(testo('a\r')), [
    { tipo: 'carattere', valore: 'a' },
    { tipo: 'invio' },
  ]);

  // Dove non si scrive testo, un incolla si butta: letto lettera per lettera
  // diventerebbe una raffica di comandi — "c" e "p" aprono schermate.
  assert.deepEqual(azioniNavigazione(testo(`${esc}[200~cp\nnm${esc}[201~`)), []);
  assert.deepEqual(azioniNavigazione(testo('cp\nnm')), [], 'anche senza marcatori');
  assert.deepEqual(azioniTastiera(testo('12\n34')), [], 'e nel menu del ripristino');
}

function testSpegneOgniModoDiInput() {
  // Un modo dimenticato qui e' una shell inutilizzabile dopo un'uscita anomala:
  // il terminale continua a mandare le sue sequenze e PowerShell le stampa.
  // Aggiungendo un modo a MODI_MOUSE la prova cade da sola.
  for (const modo of MODI_MOUSE) {
    assert.ok(SPEGNI_MODI_INPUT.includes(`${esc}[?${modo}l`), `manca lo spegnimento di ?${modo}`);
  }
  assert.ok(SPEGNI_MODI_INPUT.includes(`${esc}[?9001l`), 'manca win32-input-mode');
  assert.ok(SPEGNI_MODI_INPUT.includes(`${esc}[>u`), 'manca il protocollo kitty');
  assert.ok(SPEGNI_MODI_INPUT.includes(`${esc}[?1004l`), 'manca il riporto del focus');
  assert.ok(SPEGNI_MODI_INPUT.includes(`${esc}[?2004l`), 'manca il bracketed paste');
  // L'unica cosa che la sequenza accende e' il cursore: qualsiasi altro `h`
  // riaccenderebbe proprio cio' che si sta spegnendo.
  assert.deepEqual(
    SPEGNI_MODI_INPUT.match(/\x1b\[\?\d+h/g),
    [`${esc}[?25h`],
    'la sequenza non deve accendere altro che il cursore',
  );
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
  testRotellaScorreOrizzontalmente,
  testAzioniDellaCoda,
  testAzioniDelleNote,
  testAzioniFrecce,
  testTastiFunzione,
  testAzioniWasd,
  testAzioniByteGrezzi,
  testIncollaRiconosciutoNelleDueForme,
  testSpegneOgniModoDiInput,
];

for (const prova of prove) {
  prova();
  console.log(`ok  ${prova.name}`);
}
console.log(`\n${prove.length} prove superate`);
