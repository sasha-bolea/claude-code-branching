import assert from 'node:assert/strict';
import { Wrapper, senzaRipresa, chiedeRipresa } from './wrapper.js';
import { MODI_MOUSE } from './tasti.js';

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

async function testDoppioEscBattutoPiano() {
  // Il caso segnalato: due Esc premuti piu' lenti dell'attesa. Il primo e' gia'
  // stato inoltrato — deve esserlo, o si perderebbe l'interruzione — ma se il
  // conteggio si azzerasse li', il secondo partirebbe da capo e finirebbe anche
  // lui a Claude: due Esc a distanza, che lui rimette insieme e apre il **suo**
  // menu di ripristino. Cioe' quello che cb esiste per sostituire.
  const { wrapper, inoltrati, stato } = wrapperFinto();

  wrapper.gestisciInput(Buffer.from([ESC]));
  await attendi(400); // scade l'attesa: il primo Esc parte verso Claude
  assert.equal(inoltrati.length, 1, 'il primo Esc raggiunge Claude, come deve');
  assert.equal(stato.overlay, 0, 'e da solo non apre niente');

  wrapper.gestisciInput(Buffer.from([ESC]));
  assert.equal(stato.overlay, 1, 'il secondo, seppur tardivo, apre l albero');

  await attendi(400);
  assert.equal(inoltrati.length, 1, 'e non viene inoltrato: Claude ne ha visto uno solo');
}

async function testDueEscLontaniRestanoDueInterruzioni() {
  // Il rovescio: oltre la finestra sono due interruzioni distinte, e l'albero
  // non deve aprirsi. Senza questo limite un Esc premuto adesso e uno fra un
  // minuto aprirebbero l'albero a sorpresa.
  const { wrapper, inoltrati, stato } = wrapperFinto();

  wrapper.gestisciInput(Buffer.from([ESC]));
  await attendi(400);
  // Finestra scaduta a mano: aspettare un secondo vero allungherebbe le prove
  // di un secondo per una cosa che si verifica cosi'.
  wrapper.ultimaPressione = Date.now() - 5000;

  wrapper.gestisciInput(Buffer.from([ESC]));
  assert.equal(stato.overlay, 0, 'l albero non si apre');

  await attendi(400);
  assert.equal(inoltrati.length, 2, 'e tutt e due gli Esc arrivano a Claude');
}

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

function testSenzaRipresa() {
  // Nessun flag di ripresa: gli argomenti passano intatti.
  assert.deepEqual(senzaRipresa(['--dangerously-skip-permissions']), [
    '--dangerously-skip-permissions',
  ]);

  // -r da solo: il selettore lo apriva Claude, al rilancio non serve piu'.
  assert.deepEqual(senzaRipresa(['--dangerously-skip-permissions', '-r']), [
    '--dangerously-skip-permissions',
  ]);
  assert.deepEqual(senzaRipresa(['--resume']), []);
  assert.deepEqual(senzaRipresa(['-c']), []);
  assert.deepEqual(senzaRipresa(['--continue']), []);

  // -r con id: se ne va anche l'id, o Claude lo prenderebbe per un prompt.
  assert.deepEqual(senzaRipresa(['-r', 'abc-123', '--verbose']), ['--verbose']);
  assert.deepEqual(senzaRipresa(['--resume', 'abc-123']), []);
  assert.deepEqual(senzaRipresa(['--resume=abc-123', '--verbose']), ['--verbose']);

  // -r seguito da un altro flag: l'id non c'era, il flag non va mangiato.
  assert.deepEqual(senzaRipresa(['-r', '--verbose']), ['--verbose']);

  // Riconoscimento della richiesta di ripresa, in tutte le sue forme.
  assert.equal(chiedeRipresa(['-r']), true);
  assert.equal(chiedeRipresa(['--resume', 'abc']), true);
  assert.equal(chiedeRipresa(['--resume=abc']), true);
  assert.equal(chiedeRipresa(['-c']), true);
  assert.equal(chiedeRipresa(['--verbose']), false);
  assert.equal(chiedeRipresa([]), false);
}

function testCambioRamoNonRiapreIlSelettore() {
  // Il bug segnalato: avviando con `claude -r` e poi ripristinando un punto,
  // ricompariva l'elenco delle conversazioni della cartella. Il `-r` dell'utente
  // restava in coda agli argomenti, e Claude riceveva due richieste di ripresa:
  // la seconda senza id, quindi riapriva il selettore.
  const avvii = [];
  const wrapper = new Wrapper({ argomentiExtra: ['--dangerously-skip-permissions', '-r'] });
  wrapper.scrivi = () => {};
  wrapper.registra = () => {};
  wrapper.eseguibile = 'claude.exe';
  // Intercetto lo spawn: interessa cosa viene chiesto a Claude, non lanciarlo.
  wrapper.creaProcesso = (argomenti) => {
    avvii.push(argomenti);
    return { onData: () => {}, onExit: () => {}, write: () => {}, kill: () => {}, resize: () => {} };
  };

  // Primo avvio: il -r dell'utente deve arrivare, e' lui che vuole il selettore.
  wrapper.avviaClaude();
  assert.ok(avvii[0].includes('-r'), 'al primo avvio il selettore lo apre Claude');
  assert.ok(!avvii[0].includes('--session-id'), 'e l id non glielo imponiamo');

  // Cambio ramo: cb riprende la sessione che ha creato, e il -r non va ripetuto.
  wrapper.avviaClaude({ riprendi: 'ramo-nuovo' });
  assert.deepEqual(
    avvii[1],
    ['--resume', 'ramo-nuovo', '--dangerously-skip-permissions'],
    'una sola richiesta di ripresa, con l id del ramo',
  );
  assert.equal(avvii[1].filter((a) => a === '-r' || a === '--resume').length, 1);

  // Secondo cambio ramo di fila: deve restare pulito.
  wrapper.avviaClaude({ riprendi: 'ramo-ancora' });
  assert.deepEqual(avvii[2], ['--resume', 'ramo-ancora', '--dangerously-skip-permissions']);
}

// Con l'overlay a schermo il mouse deve tornare a selezionare il testo.
// Claude accende il tracciamento del mouse e da quel momento il terminale manda
// gli eventi all'applicazione invece di selezionare: cb quegli eventi li scarta,
// quindi dall'albero non si riusciva a copiare niente.
function testIlMouseTornaASelezionareNellOverlay() {
  const scritto = [];
  const wrapper = new Wrapper({});
  wrapper.scrivi = (t) => scritto.push(t);
  wrapper.registra = () => {};

  // Quello che Claude manda avviando la sua interfaccia.
  wrapper.osservaMouse('\x1b[?1002h\x1b[?1006h');
  assert.deepEqual([...wrapper.mouseAcceso], ['1002', '1006'], 'presi nota dei modi accesi');

  scritto.length = 0;
  wrapper.mouse(false);
  const spegne = scritto.join('');
  assert.ok(spegne.includes('\x1b[?1002l'), 'spegne 1002');
  assert.ok(spegne.includes('\x1b[?1006l'), 'spegne 1006');

  scritto.length = 0;
  wrapper.mouse(true);
  const accende = scritto.join('');
  assert.ok(accende.includes('\x1b[?1002h') && accende.includes('\x1b[?1006h'), 'e li rimette');
  assert.ok(!accende.includes('1003'), 'senza accendere modi che Claude non aveva chiesto');
}

// Nessuna schermata di cb accende un tracciamento suo. Prima si accendeva il
// minimo che fa arrivare la rotella (?1000+?1006), e la selezione del testo
// restava solo tenendo premuto shift: fra la rotella e il poter copiare quello
// che c'e' a schermo vince il copiare, perche' l'albero si scorre gia' con le
// frecce mentre un testo che non si prende non ha alternative.
function testNessunaSchermataAccendeIlMouse() {
  const scritto = [];
  const wrapper = new Wrapper({});
  wrapper.scrivi = (t) => scritto.push(t);
  wrapper.registra = () => {};

  wrapper.spegniMouse();
  const testo = scritto.join('');
  assert.ok(!/\x1b\[\?\d+h/.test(testo), 'non accende niente');
  for (const modo of MODI_MOUSE) {
    assert.ok(testo.includes(`\x1b[?${modo}l`), `spegne anche ${modo}`);
  }
}

// Lo stato va seguito, non fotografato una volta: se Claude spegne un modo, alla
// chiusura dell'overlay non va riacceso.
function testUnModoSpentoDaClaudeNonTorna() {
  const wrapper = new Wrapper({});
  wrapper.scrivi = () => {};
  wrapper.registra = () => {};

  wrapper.osservaMouse('\x1b[?1003h');
  wrapper.osservaMouse('\x1b[?1003l');
  assert.equal(wrapper.mouseAcceso.size, 0, 'acceso e poi spento vale spento');
}

// L'output del pty arriva a blocchi, e una sequenza puo' essere spezzata a meta'
// fra due letture: senza la coda, quel modo resterebbe acceso sotto l'overlay.
function testSequenzaSpezzataFraDueBlocchi() {
  const wrapper = new Wrapper({});
  wrapper.scrivi = () => {};
  wrapper.registra = () => {};

  wrapper.osservaMouse('roba a schermo\x1b[?10');
  wrapper.osservaMouse('06h altra roba');
  assert.deepEqual([...wrapper.mouseAcceso], ['1006'], 'riconosciuta a cavallo dei due blocchi');
}

// Senza mouse acceso non si scrive niente: un terminale che non lo usa non deve
// ricevere sequenze che non ha chiesto.
function testSenzaMouseNonScriveNiente() {
  const scritto = [];
  const wrapper = new Wrapper({});
  wrapper.scrivi = (t) => scritto.push(t);
  wrapper.registra = () => {};

  wrapper.mouse(false);
  wrapper.mouse(true);
  assert.equal(scritto.length, 0, 'nessuna sequenza inventata');
}

const prove = [
  testIlMouseTornaASelezionareNellOverlay,
  testNessunaSchermataAccendeIlMouse,
  testUnModoSpentoDaClaudeNonTorna,
  testSequenzaSpezzataFraDueBlocchi,
  testSenzaMouseNonScriveNiente,
  testSenzaRipresa,
  testCambioRamoNonRiapreIlSelettore,
  testDoppioEscInLettureSeparate,
  testDoppioEscBattutoPiano,
  testDueEscLontaniRestanoDueInterruzioni,
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
