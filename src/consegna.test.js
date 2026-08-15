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
process.env.CB_LIMITI = path.join(process.env.CB_CODA, 'limiti.json');

const { Wrapper } = await import('./wrapper.js');
const { scriviCoda, leggiCoda } = await import('./coda.js');

// Scrive i limiti come li scriverebbe la statusline. `usato` in percentuale,
// `fraMinuti` quanto manca al reset — null cancella il file, cioe' la statusline
// non e' agganciata e la funzione e' spenta.
function limiti(usato, fraMinuti = 90) {
  if (usato === null) {
    fs.rmSync(process.env.CB_LIMITI, { force: true });
    return;
  }
  fs.writeFileSync(
    process.env.CB_LIMITI,
    JSON.stringify({
      cinqueOre: { usato, resetIl: Math.floor(Date.now() / 1000) + fraMinuti * 60 },
    }),
    'utf8',
  );
}

// Il wrapper con un pty finto che registra cosa gli viene scritto: e' l'unica
// cosa che conta qui, e non serve un terminale.
//
// Prima del prompt parte sempre un ctrl+u che svuota la barra: quello che c'era
// scritto va sostituito, non allungato. Nelle prove interessa il prompt, quindi
// `scritto` lo tiene da parte — che ci sia lo verifica testLaBarraSiSvuotaPrima.
function wrapperFinto(sessione) {
  const wrapper = new Wrapper({ cwd: process.cwd() });
  const tutto = [];
  const scritto = [];
  wrapper.sessionId = sessione;
  wrapper.scrivi = () => {};
  wrapper.registra = () => {};
  wrapper.processo = {
    write: (t) => {
      tutto.push(t);
      if (t !== SVUOTA_BARRA) scritto.push(t);
    },
    resize: () => {},
    kill: () => {},
  };
  return { wrapper, scritto, tutto };
}

// Ctrl+u: lo stesso carattere che il wrapper manda per svuotare la barra.
const SVUOTA_BARRA = '\x15';

const respiro = (ms) => new Promise((r) => setTimeout(r, ms));

// I prompt di una coda, senza gli interruttori.
const testi = (sessione) => leggiCoda(sessione).map((voce) => voce.testo);

// La quiete vera e' 1500 ms: le prove non la aspettano, chiamano direttamente
// il controllo. Che sia il silenzio dell'output a farlo scattare lo verifica
// testLaConsegnaAspettaCheClaudeTaccia.
async function testMandaIlPrimoQuandoClaudeEFermo() {
  const { wrapper, scritto } = wrapperFinto('s1');
  scriviCoda('s1', ['primo prompt', 'secondo prompt']);

  wrapper.consegnaCoda();
  assert.deepEqual(scritto, ['primo prompt\r'], 'il prompt parte con l invio in coda');
  assert.deepEqual(testi('s1'), ['secondo prompt'], 'e sparisce dalla coda');

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

// Quello che c'era nella barra va **sostituito**, non allungato: un abbozzo
// lasciato li' da prima si incollerebbe in testa al prompt che parte, e l'invio
// manderebbe il miscuglio. E' lo stesso guaio che `ultimoTasto` evita mentre stai
// digitando, ma con un testo fermo da minuti, che nessuna quiete puo' rivelare.
function testLaBarraSiSvuotaPrima() {
  const { wrapper, tutto } = wrapperFinto('s7');
  scriviCoda('s7', ['il prompt vero']);

  wrapper.consegnaCoda();
  assert.deepEqual(tutto, [SVUOTA_BARRA, 'il prompt vero\r'], 'prima ctrl+u, poi il prompt');
  // In due scritture separate e non in una: arrivando nello stesso blocco, il
  // carattere di controllo e il testo verrebbero letti come un incollaggio solo.
  assert.equal(tutto.length, 2, 'due scritture, non una');
}

// Mentre l'utente digita non si inietta: il testo si mescolerebbe a quello che
// sta scrivendo, e l'invio manderebbe il miscuglio.
function testNonInterrompeChiStaScrivendo() {
  const { wrapper, scritto } = wrapperFinto('s2');
  scriviCoda('s2', ['non devi partire adesso']);

  wrapper.ultimoTasto = Date.now();
  wrapper.consegnaCoda();
  assert.deepEqual(scritto, [], 'con un tasto appena battuto la coda tace');
  assert.deepEqual(testi('s2'), ['non devi partire adesso'], 'e il prompt resta in coda');

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

// Gli interruttori valgono anche qui, e non solo nell'hook: dentro cb la
// consegna la fa il pty, quindi e' questo il posto dove stop e salta devono
// fermare qualcosa davvero.
function testStopESaltaFermanoLaConsegna() {
  const { wrapper, scritto } = wrapperFinto('s6');
  scriviCoda('s6', [
    { testo: 'scavalcato', stop: false, salta: true },
    { testo: 'questo parte', stop: false, salta: false },
    { testo: 'barriera', stop: true, salta: false },
    { testo: 'dietro la barriera', stop: false, salta: false },
  ]);

  wrapper.consegnaCoda();
  assert.deepEqual(scritto, ['questo parte\r'], 'parte il primo non saltato');
  assert.deepEqual(
    testi('s6'),
    ['scavalcato', 'barriera', 'dietro la barriera'],
    'e sparisce solo lui: il saltato resta al suo posto',
  );

  // Adesso in testa c'e' il saltato, e subito dopo la barriera: non deve
  // partire piu' niente, nemmeno quello che sta dietro.
  wrapper.consegnaCoda();
  assert.equal(scritto.length, 1, 'oltre lo stop non passa niente');

  // Tolto lo stop, la coda riprende — e il saltato resta scavalcato.
  scriviCoda('s6', [
    { testo: 'scavalcato', stop: false, salta: true },
    { testo: 'barriera', stop: false, salta: false },
    { testo: 'dietro la barriera', stop: false, salta: false },
  ]);
  wrapper.consegnaCoda();
  assert.deepEqual(scritto, ['questo parte\r', 'barriera\r'], 'spento lo stop, riparte');
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

// Una nota consegnata con ctrl+invio finisce **nella barra, non inviata**: la
// coda manda, le note consegnano. Il testo resta li' pronto da correggere o da
// completare, e a mandarlo e' un invio dell'utente.
//
// Si sostituisce `apriNote`, non `mostraNote`: la schermata vera si prende lo
// stdin, ma quello che conta qui — cosa arriva al pty — sta in mostraNote, e
// stubbando quella non si proverebbe niente.
async function testLaNotaFinisceNellaBarraSenzaInvio() {
  const { wrapper, tutto } = wrapperFinto('s8');
  wrapper.apriNote = async () => ({ manda: 'il corpo della nota' });

  assert.equal(await wrapper.mostraNote(), 'esci', 'consegnata la nota si torna a Claude');
  assert.deepEqual(tutto, [SVUOTA_BARRA, 'il corpo della nota'], 'barra svuotata, poi il testo');
  assert.ok(
    !tutto.some((t) => t.endsWith('\r')),
    'nessuna scrittura finisce con invio: la nota non parte da sola',
  );

  // Su piu' righe va incollata, o gli a capo verrebbero letti come invii — cioe'
  // proprio la cosa che questo modo esiste per non fare.
  const seconda = wrapperFinto('s9');
  seconda.wrapper.apriNote = async () => ({ manda: 'prima riga\nseconda riga' });
  await seconda.wrapper.mostraNote();
  assert.equal(seconda.tutto[1], '\x1b[200~prima riga\nseconda riga\x1b[201~', 'incollata');
  assert.ok(!seconda.tutto[1].endsWith('\r'), 'e sempre senza invio');

  // Esc e Canc invece non scrivono niente nella barra.
  const terza = wrapperFinto('s10');
  terza.wrapper.apriNote = async () => 'indietro';
  assert.equal(await terza.wrapper.mostraNote(), 'indietro');
  assert.deepEqual(terza.tutto, [], 'tornando indietro la barra non si tocca');
}

// Coi token quasi finiti la coda si ferma: spendere quel che resta su un turno
// che morira' a meta' non salva niente, e il prompt e' comunque speso.
function testCoiTokenQuasiFinitiLaCodaSiFerma() {
  const { wrapper, scritto } = wrapperFinto('l1');
  scriviCoda('l1', ['non partire adesso']);

  limiti(97);
  wrapper.consegnaCoda();
  assert.deepEqual(scritto, [], 'a serbatoio quasi vuoto non si consegna');
  assert.deepEqual(testi('l1'), ['non partire adesso'], 'e il prompt resta in coda');

  // Tornati sotto soglia — la finestra si e' resettata — riparte da sola.
  limiti(10);
  wrapper.consegnaCoda();
  assert.deepEqual(scritto, ['non partire adesso\r'], 'con i token di nuovo pieni parte');

  clearTimeout(wrapper.timerRisveglio);
}

// Senza il file dei limiti la funzione e' spenta: chi non aggancia la statusline
// deve vedere cb comportarsi esattamente come prima.
function testSenzaStatuslineNienteCambia() {
  const { wrapper, scritto } = wrapperFinto('l2');
  scriviCoda('l2', ['parti come sempre']);

  limiti(null);
  wrapper.consegnaCoda();
  assert.deepEqual(scritto, ['parti come sempre\r'], 'senza limiti si consegna come prima');
}

// Un prompt consegnato che non ha fatto in tempo ad avere risposta torna in
// **cima** alla coda: era il prossimo, e l'ordine e' l'unica cosa che la coda
// promette. E' la parte che rende l'attesa indolore invece che una perdita.
function testIlPromptRimastoSenzaRispostaTornaInCima() {
  const { wrapper, scritto } = wrapperFinto('l3');
  scriviCoda('l3', ['primo', 'secondo']);

  limiti(10);
  wrapper.consegnaCoda();
  assert.deepEqual(scritto, ['primo\r'], 'il primo parte');
  assert.deepEqual(testi('l3'), ['secondo'], 'e lascia la coda');

  // I token finiscono mentre quel turno e' ancora in corso.
  limiti(99);
  wrapper.consegnaCoda();
  assert.deepEqual(scritto, ['primo\r'], 'non parte nient altro');
  assert.deepEqual(testi('l3'), ['primo', 'secondo'], 'e il primo e tornato in testa');

  clearTimeout(wrapper.timerRisveglio);
}

// Se invece il turno si era chiuso normalmente, il prompt non torna: la conferma
// e' il giro successivo passato senza sospensione.
function testUnTurnoFinitoBeneNonRimandaIlPrompt() {
  const { wrapper } = wrapperFinto('l4');
  scriviCoda('l4', ['unico']);

  limiti(10);
  wrapper.consegnaCoda();
  assert.deepEqual(testi('l4'), [], 'consegnato, la coda e vuota');

  wrapper.consegnaCoda(); // giro a vuoto: il turno e' finito, niente da mandare
  limiti(99);
  wrapper.consegnaCoda(); // adesso i token finiscono, ma quel prompt e' andato
  assert.deepEqual(testi('l4'), [], 'un prompt gia risposto non viene rimandato');

  clearTimeout(wrapper.timerRisveglio);
}

// Al reset, con la coda vuota, si manda `continue`: il lavoro interrotto sta nel
// contesto, e questa e' la parola che lo fa proseguire senza aggiungere richieste
// che non erano state fatte.
function testAlResetConCodaVuotaMandaContinue() {
  const { wrapper, scritto } = wrapperFinto('l5');

  limiti(10);
  wrapper.risvegliaDopoIlReset();
  assert.deepEqual(scritto, ['continue\r'], 'a coda vuota prosegue da solo');

  clearTimeout(wrapper.timerRisveglio);
}

// Con qualcosa in coda, invece, si riprende da quella: e' quasi sempre cio' che
// si vuole, e `continue` resta il ripiego.
function testAlResetConCodaPienaRiprendeLaCoda() {
  const { wrapper, scritto } = wrapperFinto('l6');
  scriviCoda('l6', ['riprendi da qui']);

  limiti(10);
  wrapper.risvegliaDopoIlReset();
  assert.deepEqual(scritto, ['riprendi da qui\r'], 'riparte dalla coda, non da continue');

  clearTimeout(wrapper.timerRisveglio);
}

const prove = [
  testMandaIlPrimoQuandoClaudeEFermo,
  testCoiTokenQuasiFinitiLaCodaSiFerma,
  testSenzaStatuslineNienteCambia,
  testIlPromptRimastoSenzaRispostaTornaInCima,
  testUnTurnoFinitoBeneNonRimandaIlPrompt,
  testAlResetConCodaVuotaMandaContinue,
  testAlResetConCodaPienaRiprendeLaCoda,
  testNonInterrompeChiStaScrivendo,
  testConLOverlayApertoNonParte,
  testLaBarraSiSvuotaPrima,
  testLaNotaFinisceNellaBarraSenzaInvio,
  testStopESaltaFermanoLaConsegna,
  testIlPromptSuPiuRigheSiIncolla,
  testLaConsegnaAspettaCheClaudeTaccia,
];

for (const prova of prove) {
  await prova();
  console.log(`ok  ${prova.name}`);
}

fs.rmSync(process.env.CB_CODA, { recursive: true, force: true });
console.log(`\n${prove.length} prove superate`);
