// Consegna della coda dal pty: i prompt accodati partono da soli quando Claude
// smette di scrivere.
//
// E' la strada che vale dentro cb, e batte l'hook: il prompt viene scritto nel
// pty seguito da invio, cioe' esattamente come lo scriveresti tu, quindi nel
// transcript diventa un record `user` vero e nell'albero un nodo da cui si puo'
// ripartire. L'hook puo' solo consegnarlo come motivo di un `decision: block`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

process.env.CB_CODA = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-consegna-'));

const { Wrapper } = await import('./wrapper.js');
const { scriviCoda, leggiCoda } = await import('./coda.js');

// Il wrapper con un pty finto che registra cosa gli viene scritto: e' l'unica
// cosa che conta qui, e non serve un terminale.
function wrapperFinto(sessione) {
  const wrapper = new Wrapper({ cwd: process.cwd() });
  const scritto = [];
  wrapper.sessionId = sessione;
  wrapper.scrivi = () => {};
  wrapper.registra = () => {};
  wrapper.processo = { write: (t) => scritto.push(t), resize: () => {}, kill: () => {} };
  return { wrapper, scritto };
}

const respiro = (ms) => new Promise((r) => setTimeout(r, ms));

// La quiete vera e' 1500 ms: le prove non la aspettano, chiamano direttamente
// il controllo. Che sia il silenzio dell'output a farlo scattare lo verifica
// testLaConsegnaAspettaCheClaudeTaccia.
async function testMandaIlPrimoQuandoClaudeEFermo() {
  const { wrapper, scritto } = wrapperFinto('s1');
  scriviCoda('s1', ['primo prompt', 'secondo prompt']);

  wrapper.consegnaCoda();
  assert.deepEqual(scritto, ['primo prompt\r'], 'il prompt parte con l invio in coda');
  assert.deepEqual(leggiCoda('s1'), ['secondo prompt'], 'e sparisce dalla coda');

  // Uno per volta: il secondo parte al controllo dopo, cioe' a fine del turno
  // che il primo ha appena aperto.
  wrapper.consegnaCoda();
  assert.deepEqual(scritto, ['primo prompt\r', 'secondo prompt\r'], 'poi tocca al secondo');
  assert.deepEqual(leggiCoda('s1'), [], 'la coda si svuota');

  // Coda vuota: non si scrive niente, o si manderebbe un invio a vuoto a ogni
  // quiete, cioe' un turno per niente ogni secondo e mezzo.
  wrapper.consegnaCoda();
  assert.equal(scritto.length, 2, 'a coda vuota non parte niente');
}

// Mentre l'utente digita non si inietta: il testo si mescolerebbe a quello che
// sta scrivendo, e l'invio manderebbe il miscuglio.
function testNonInterrompeChiStaScrivendo() {
  const { wrapper, scritto } = wrapperFinto('s2');
  scriviCoda('s2', ['non devi partire adesso']);

  wrapper.ultimoTasto = Date.now();
  wrapper.consegnaCoda();
  assert.deepEqual(scritto, [], 'con un tasto appena battuto la coda tace');
  assert.deepEqual(leggiCoda('s2'), ['non devi partire adesso'], 'e il prompt resta in coda');

  // Passata la finestra, parte.
  wrapper.ultimoTasto = Date.now() - 5000;
  wrapper.consegnaCoda();
  assert.deepEqual(scritto, ['non devi partire adesso\r'], 'smesso di scrivere, parte');
}

// Con una schermata di cb aperta i tasti sono per cb, non per Claude: iniettare
// li' dentro scriverebbe nel pty mentre l'utente guarda tutt'altro.
function testConLOverlayApertoNonParte() {
  const { wrapper, scritto } = wrapperFinto('s3');
  scriviCoda('s3', ['aspetta']);

  wrapper.inOverlay = true;
  wrapper.consegnaCoda();
  assert.deepEqual(scritto, [], 'con l overlay aperto non si consegna');

  wrapper.inOverlay = false;
  wrapper.consegnaCoda();
  assert.deepEqual(scritto, ['aspetta\r'], 'chiuso l overlay, parte');
}

// Un prompt su piu' righe va incollato: gli a capo grezzi verrebbero letti come
// invii, e il prompt partirebbe a pezzi.
function testIlPromptSuPiuRigheSiIncolla() {
  const { wrapper, scritto } = wrapperFinto('s4');
  scriviCoda('s4', ['prima riga\nseconda riga']);

  wrapper.consegnaCoda();
  assert.match(scritto[0], /^\x1b\[200~prima riga\nseconda riga\x1b\[201~\r$/, 'incollato, poi invio');
}

// E' il silenzio dell'output a far partire la coda: finche' Claude disegna, il
// conto si riarma. cb non legge quello che c'e' a schermo — cambia a ogni
// versione del CLI — ma quando l'output smette di arrivare.
async function testLaConsegnaAspettaCheClaudeTaccia() {
  const { wrapper, scritto } = wrapperFinto('s5');
  scriviCoda('s5', ['parti quando ha finito']);

  // Output che continua: il conto riparte da capo ogni volta.
  for (let i = 0; i < 6; i += 1) {
    wrapper.rimandaConsegna();
    await respiro(60);
  }
  assert.deepEqual(scritto, [], 'finche arriva output, la coda aspetta');

  // Il pty tace: scaduta la quiete, il prompt parte da solo.
  wrapper.rimandaConsegna();
  await respiro(1700);
  assert.deepEqual(scritto, ['parti quando ha finito\r'], 'taciuto il pty, parte da solo');

  clearTimeout(wrapper.timerCoda);
}

const prove = [
  testMandaIlPrimoQuandoClaudeEFermo,
  testNonInterrompeChiStaScrivendo,
  testConLOverlayApertoNonParte,
  testIlPromptSuPiuRigheSiIncolla,
  testLaConsegnaAspettaCheClaudeTaccia,
];

for (const prova of prove) {
  await prova();
  console.log(`ok  ${prova.name}`);
}

fs.rmSync(process.env.CB_CODA, { recursive: true, force: true });
console.log(`\n${prove.length} prove superate`);
