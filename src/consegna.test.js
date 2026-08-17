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

// Scrive i limiti come li scriverebbe la statusline: `fraMinuti` quanto manca al
// reset, `usato` la percentuale consumata (100 = finestra finita). `null` cancella
// il file, cioe' la statusline non e' agganciata.
function limiti(fraMinuti, usato = 20) {
  if (fraMinuti === null) {
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

// L'invio come arriva davvero dai byte grezzi.
const INVIO = Buffer.from('\r');

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

// Il prompt del reset: parte all'ora in cui la finestra dei token riparte, e va
// **acceso**. Spento non deve accadere niente, nemmeno un timer che gira.
function testSpentoNonMandaNiente() {
  const { wrapper, scritto } = wrapperFinto('r1');
  limiti(90);
  delete process.env.CB_PROMPT_RESET;

  wrapper.programmaPromptDelReset();
  assert.equal(wrapper.timerReset, null, 'spento non arma nessuna sveglia');

  // E anche chiamandolo a mano non scrive: l impostazione si ricontrolla allo
  // scatto, perche' fra l armare e lo scattare passano ore.
  wrapper.mandaPromptDelReset();
  assert.deepEqual(scritto, [], 'e non scrive niente');
}

// Acceso, allo scatto scrive il prompt nella barra seguito da invio.
function testAccesoMandaIlPrompt() {
  const { wrapper, scritto } = wrapperFinto('r2');
  limiti(90);
  process.env.CB_PROMPT_RESET = '1';

  wrapper.mandaPromptDelReset();
  assert.equal(scritto.length, 1, 'un prompt solo');
  assert.match(scritto[0], /^\[automatic\] The usage window just reset\./, 'si dichiara automatico');
  assert.match(scritto[0], /continue it from where it stopped/, 'dice cosa fare se era stato tagliato');
  assert.match(scritto[0], /reply with exactly: OK\r$/, 'e come costare poco se non serviva');

  clearTimeout(wrapper.timerReset);
  delete process.env.CB_PROMPT_RESET;
}

// `'0'` e `'false'` dall'ambiente sono stringhe vere: senza riconoscerle a mano
// passerebbero per «acceso», che e' il contrario di quello che si e' scritto.
function testZeroDallAmbienteSpegneDavvero() {
  process.env.CB_PROMPT_RESET = '0';
  const { wrapper, scritto } = wrapperFinto('r3');
  limiti(90);
  wrapper.mandaPromptDelReset();
  assert.deepEqual(scritto, [], "'0' spegne");

  process.env.CB_PROMPT_RESET = 'false';
  wrapper.mandaPromptDelReset();
  assert.deepEqual(scritto, [], "'false' pure");

  delete process.env.CB_PROMPT_RESET;
}

// Mentre l'utente scrive si rimanda: iniettare in quel momento mescolerebbe il
// prompt automatico al testo che ha in mano, e l'invio manderebbe il miscuglio.
// Stessa cosa con una schermata di cb aperta.
function testNonIniettaAddossoAChiScrive() {
  process.env.CB_PROMPT_RESET = '1';
  const { wrapper, scritto } = wrapperFinto('r4');
  limiti(90);

  wrapper.ultimoTasto = Date.now();
  wrapper.mandaPromptDelReset();
  assert.deepEqual(scritto, [], 'con un tasto appena battuto aspetta');

  wrapper.ultimoTasto = 0;
  wrapper.inOverlay = true;
  wrapper.mandaPromptDelReset();
  assert.deepEqual(scritto, [], 'e con una schermata di cb aperta pure');

  wrapper.inOverlay = false;
  wrapper.mandaPromptDelReset();
  assert.equal(scritto.length, 1, 'passata la finestra, parte');

  clearTimeout(wrapper.timerReset);
  delete process.env.CB_PROMPT_RESET;
}

// Dopo lo scatto la sveglia si riarma da sola per la finestra dopo: senza, il
// prompt partirebbe una volta sola e poi mai piu'.
function testDopoLoScattoSiRiarma() {
  process.env.CB_PROMPT_RESET = '1';
  const { wrapper } = wrapperFinto('r5');
  limiti(90);

  wrapper.mandaPromptDelReset();
  assert.notEqual(wrapper.timerReset, null, 'la sveglia e di nuovo armata');

  clearTimeout(wrapper.timerReset);
  delete process.env.CB_PROMPT_RESET;
}

// Senza il file della statusline non si sa quando sia il reset: si riprova piu'
// tardi invece di rinunciare, perche' al primo avvio quel file non c'e' ancora.
function testSenzaLimitiRiprovaInveceDiRinunciare() {
  process.env.CB_PROMPT_RESET = '1';
  const { wrapper, scritto } = wrapperFinto('r6');
  limiti(null);

  wrapper.programmaPromptDelReset();
  assert.notEqual(wrapper.timerReset, null, 'una sveglia c e, per riguardare');
  assert.deepEqual(scritto, [], 'ma non ha mandato niente');

  clearTimeout(wrapper.timerReset);
  delete process.env.CB_PROMPT_RESET;
}

// Coi token **esauriti** la coda si sospende: un prompt consegnato adesso resta
// senza risposta, cioe' e' speso. A 99 invece parte: la coda si ferma quando i
// token sono finiti, non quando stanno per finire.
function testATokenEsauritiLaCodaSiSospende() {
  const { wrapper, scritto } = wrapperFinto('p1');
  scriviCoda('p1', ['non partire adesso']);

  limiti(90, 99);
  wrapper.consegnaCoda();
  assert.deepEqual(scritto, ['non partire adesso\r'], 'a 99 la coda parte ancora');

  scriviCoda('p1', ['questo no']);
  limiti(90, 100);
  wrapper.consegnaCoda();
  assert.deepEqual(scritto.length, 1, 'a 100 si sospende');
  assert.equal(wrapper.codaSospesa, true, 'e resta segnata come sospesa');
  assert.deepEqual(testi('p1'), ['questo no'], 'il prompt resta in coda, non si perde');
}

// La sospensione **non** finisce da sola quando la finestra riparte: la finestra
// nuova e' dell'utente, e la coda non se la prende senza che lui abbia ricominciato.
function testLaFinestraNuovaDaSolaNonRiattivaLaCoda() {
  const { wrapper, scritto } = wrapperFinto('p2');
  scriviCoda('p2', ['aspetta il mio via']);

  limiti(90, 100);
  wrapper.consegnaCoda();
  assert.deepEqual(scritto, [], 'sospesa');

  // Finestra ripartita: la percentuale e' tornata bassa, ma non basta.
  limiti(300, 5);
  wrapper.consegnaCoda();
  assert.deepEqual(scritto, [], 'la coda resta ferma anche a token tornati');
  assert.deepEqual(testi('p2'), ['aspetta il mio via'], 'e il prompt e ancora li');
}

// Col prompt automatico acceso, la coda riparte **insieme** a quello: e' lui il
// segnale che la finestra nuova e' cominciata, e aspettare anche un invio
// dell'utente vorrebbe dire tenerla ferma per niente.
function testConIlPromptAutomaticoLaCodaRipartelInsieme() {
  process.env.CB_PROMPT_RESET = '1';
  const { wrapper, scritto } = wrapperFinto('p3');
  scriviCoda('p3', ['riprendi da qui']);

  limiti(90, 100);
  wrapper.consegnaCoda();
  assert.equal(wrapper.codaSospesa, true, 'sospesa');

  limiti(300, 5); // finestra ripartita
  wrapper.mandaPromptDelReset();
  assert.equal(wrapper.codaSospesa, false, 'il prompt del reset la riattiva');
  assert.match(scritto[0], /^\[automatic\]/, 'e il primo a partire e il prompt automatico');

  wrapper.consegnaCoda();
  assert.deepEqual(scritto[1], 'riprendi da qui\r', 'poi riparte la coda');

  clearTimeout(wrapper.timerReset);
  delete process.env.CB_PROMPT_RESET;
}

// Col prompt automatico spento, la riattiva il primo invio dell'utente — ma solo
// a finestra ripartita: prima del reset i token sono ancora finiti, e la coda
// tornerebbe a sospendersi al controllo dopo.
function testSenzaPromptAutomaticoLaRiattivaIlPrimoInvio() {
  delete process.env.CB_PROMPT_RESET;
  const { wrapper, scritto } = wrapperFinto('p4');
  scriviCoda('p4', ['dopo il tuo via']);

  limiti(90, 100);
  wrapper.consegnaCoda();
  assert.equal(wrapper.codaSospesa, true, 'sospesa');

  // Invio con i token ancora finiti: non riattiva niente.
  wrapper.gestisciInput(INVIO);
  assert.equal(wrapper.codaSospesa, true, 'un invio prima del reset non riattiva');

  // Finestra ripartita, e adesso l'invio vale.
  limiti(300, 5);
  wrapper.gestisciInput(INVIO);
  assert.equal(wrapper.codaSospesa, false, 'il primo invio della finestra nuova riattiva');

  // La consegna aspetta comunque che tu smetta di scrivere: l'invio appena battuto
  // conta come «sta scrivendo», ed e' giusto.
  wrapper.ultimoTasto = 0;
  wrapper.consegnaCoda();
  // I due invii di prima sono nell'elenco perche' il wrapper li inoltra a Claude,
  // ed e' giusto: erano tasti dell'utente. Qui interessa solo che dopo di loro
  // arrivi il prompt della coda.
  assert.equal(scritto.at(-1), 'dopo il tuo via\r', 'e poi la coda riparte');
  assert.deepEqual(testi('p4'), [], 'la coda si e svuotata');
}

const prove = [
  testMandaIlPrimoQuandoClaudeEFermo,
  testATokenEsauritiLaCodaSiSospende,
  testLaFinestraNuovaDaSolaNonRiattivaLaCoda,
  testConIlPromptAutomaticoLaCodaRipartelInsieme,
  testSenzaPromptAutomaticoLaRiattivaIlPrimoInvio,
  testSpentoNonMandaNiente,
  testAccesoMandaIlPrompt,
  testZeroDallAmbienteSpegneDavvero,
  testNonIniettaAddossoAChiScrive,
  testDopoLoScattoSiRiarma,
  testSenzaLimitiRiprovaInveceDiRinunciare,
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
