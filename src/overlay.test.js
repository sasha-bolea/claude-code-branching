import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Wrapper } from './wrapper.js';
import { leggiTranscript } from './transcript.js';
import { CARTELLA_PROGETTI, slugProgetto } from './percorsi.js';

// Crea un transcript finto nella posizione in cui Claude lo scriverebbe, per
// provare l'overlay senza lanciare Claude.
// sessionId: id della sessione
// cartella: cwd simulato
// record: righe da scrivere
// ritorna: percorso del file creato
function creaTranscript(sessionId, cartella, record) {
  const cartellaProgetto = path.join(CARTELLA_PROGETTI, slugProgetto(cartella));
  fs.mkdirSync(cartellaProgetto, { recursive: true });
  const percorso = path.join(cartellaProgetto, `${sessionId}.jsonl`);
  fs.writeFileSync(percorso, record.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  return percorso;
}

// Record di messaggio minimo.
function msg(uuid, parentUuid, tipo, testo, istante) {
  return {
    type: tipo,
    uuid,
    parentUuid,
    sessionId: 'sess-overlay',
    timestamp: `2026-07-30T10:0${istante}:00.000Z`,
    cwd: 'C:\\finta',
    message: { content: [{ type: 'text', text: testo }] },
  };
}

// Prepara un wrapper con terminale finto e cattura di quanto scritto a schermo.
// Il ripristino dei file e' sostituito da una finzione: lanciare Claude davvero
// riscriverebbe file di lavoro veri.
// opzioni.esitoRipristino: cosa deve restituire il finto ripristino
function wrapperFinto(sessionId, cartella, opzioni = {}) {
  const wrapper = new Wrapper({ cwd: cartella, ...opzioni.wrapper });
  const schermo = [];
  const ripristini = [];

  wrapper.sessionId = sessionId;
  wrapper.scrivi = (testo) => schermo.push(testo);
  // Il pty vero notifica l'uscita: senza emularla il wrapper aspetterebbe la
  // rete di sicurezza, e non verificheremmo l'attesa di chiusura.
  wrapper.processo = {
    write: () => {},
    resize: () => {},
    kill: () => {
      setImmediate(() => {
        const risolvi = wrapper.risolviUscita;
        wrapper.risolviUscita = null;
        wrapper.uscitaVolontaria = false;
        risolvi?.();
      });
    },
  };
  wrapper.avviaClaude = ({ riprendi } = {}) => {
    wrapper.ramoAvviato = true;
    wrapper.sessioneRipresa = riprendi;
  };
  wrapper.ripristinaFile = async (albero, uuid, percorsoOrigine) => {
    ripristini.push({ uuid, percorso: percorsoOrigine, albero });
    return opzioni.esitoRipristino ?? { ok: true, riassunto: '2 file ripristinati' };
  };

  return { wrapper, schermo: () => schermo.join(''), ripristini };
}

// Simula la pressione di tasti sullo stdin che l'overlay sta ascoltando.
const esc = String.fromCharCode(27);
const premi = (testo) => process.stdin.emit('data', Buffer.from(testo, 'latin1'));

// Tasti di navigazione, nella codifica ANSI.
const SU = `${esc}[A`;
const GIU = `${esc}[B`;
const SINISTRA = `${esc}[D`;
const INVIO = '\r';
const ANNULLA = esc;

// Invio apre il menu di cosa riportare indietro: le cifre scelgono una voce
// direttamente, senza passare dalle frecce.
const ENTRAMBI = '1';
const SOLO_CONVERSAZIONE = '2';
const SOLO_CODICE = '3';

// Preme una sequenza di tasti, cedendo il controllo fra uno e l'altro: dopo ogni
// tasto l'overlay ridisegna e riattacca l'ascoltatore, e senza la pausa il tasto
// successivo arriverebbe quando non c'e' nessuno in ascolto.
async function premiTasti(...tasti) {
  for (const tasto of tasti) {
    premi(tasto);
    await new Promise((r) => setTimeout(r, 10));
  }
}

// Attende che l'overlay abbia finito di disegnare e sia in ascolto dei tasti.
// L'attesa e' sulla barra dei tasti a schermo (che nomina sempre l'invio), non
// su un numero fisso di tick: il disegno passa da una lettura di file asincrona.
async function attendiPrompt(schermo) {
  for (let tentativo = 0; tentativo < 200; tentativo += 1) {
    if (schermo().includes('invio')) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('overlay non pronto: la barra dei tasti non e mai comparsa');
}

const CARTELLA = path.join(os.tmpdir(), 'cb-prova-overlay');

// Svuota la cartella progetto finta. Serve fra una prova e l'altra: i transcript
// di prova condividono l'uuid di radice, quindi i residui verrebbero raccolti
// come sessioni della stessa famiglia e falserebbero l'albero.
function pulisciCartella() {
  const dir = path.join(CARTELLA_PROGETTI, slugProgetto(CARTELLA));
  try {
    for (const nome of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, nome));
  } catch {
    // cartella non ancora creata
  }
}

async function testOverlaySenzaTranscript() {
  const { wrapper, schermo } = wrapperFinto('00000000-0000-4000-8000-00000000dead', CARTELLA);

  const attesa = wrapper.mostraOverlay();
  await attendiPrompt(schermo);
  premi('\r');
  await attesa;

  const testo = schermo();
  assert.match(testo, /non ha ancora un transcript/, 'spiega perche non puo mostrare l albero');
  assert.match(testo, /manda un prompt/i, 'dice cosa fare');
  assert.equal(wrapper.inOverlay, false, 'l overlay si richiude');
}

// Dopo un /clear Claude non taglia dentro al file: comincia un file di sessione
// nuovo. cb si era agganciato all'id all'avvio e non lo ricontrollava, quindi
// continuava a mostrare la conversazione precedente il clear — e invio ci
// forkava sopra, ripristinando i file all'istante di un'altra conversazione.
// Senza transcript non c'e' albero, ma la schermata non deve essere un vicolo
// cieco: da li' si arriva al navigatore delle cartelle, dove "r" alterna la
// ripresa e l'avvio di una conversazione nuova. E' il caso di chi preme la
// scorciatoia prima ancora di aver scritto un prompt.
async function testSenzaTranscriptSiArrivaAiSelettori() {
  for (const tasto of ['c', 'p']) {
    pulisciCartella();
    const { wrapper, schermo } = wrapperFinto('00000000-0000-4000-8000-00000000dea0', CARTELLA);
    let aperture = 0;
    wrapper.cambiaConversazione = async () => {
      aperture += 1;
      wrapper.inOverlay = false;
    };

    const attesa = wrapper.mostraOverlay();
    // Non c'e' barra dei tasti dell'albero: si aspetta il testo dell'avviso.
    for (let i = 0; i < 200 && !schermo().includes('transcript'); i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.match(schermo(), /non ha ancora un transcript/, 'spiega perche non c e l albero');
    assert.match(schermo(), /c e p|c o p/, 'e annuncia i tasti per ripartire da altrove');

    await premiTasti(tasto);
    await attesa;
    assert.equal(aperture, 1, `"${tasto}" apre il navigatore anche senza transcript`);
  }

  // Esc invece torna a Claude, come prima.
  pulisciCartella();
  const { wrapper, schermo } = wrapperFinto('00000000-0000-4000-8000-00000000dea1', CARTELLA);
  wrapper.cambiaConversazione = async () => assert.fail('esc non deve aprire niente');
  const attesa = wrapper.mostraOverlay();
  for (let i = 0; i < 200 && !schermo().includes('transcript'); i += 1) {
    await new Promise((r) => setTimeout(r, 5));
  }
  premi(ANNULLA);
  await attesa;
  assert.equal(wrapper.inOverlay, false, 'esc chiude e basta');
}

// La legenda dell'avviso sta in fondo allo schermo, come negli altri selettori:
// gli avvisi hanno lunghezze diverse, e una legenda che sale e scende col testo
// si legge peggio di una che sta sempre nello stesso posto. Deve restare
// l'ultima riga anche quando il testo e' piu' alto dello schermo — tagliando la
// pagina finita sarebbe sparita proprio lei, cioe' l'unica riga che dice come
// si esce.
async function testLaLegendaDellAvvisoStaInFondo() {
  pulisciCartella();
  const { wrapper, schermo } = wrapperFinto('00000000-0000-4000-8000-00000000dea2', CARTELLA);

  const alte = process.stdout.rows;
  process.stdout.rows = 12;
  try {
    const attesa = wrapper.mostraAvviso(Array.from({ length: 40 }, (_, i) => `riga ${i}`));
    await new Promise((r) => setTimeout(r, 20));

    const righe = schermo().split('\r\n');
    assert.match(righe[righe.length - 1], /invio o esc|enter or esc/, 'la legenda e l ultima riga');
    assert.equal(righe.length, 12, 'e la pagina riempie lo schermo esatto');

    premi(ANNULLA);
    await attesa;
  } finally {
    process.stdout.rows = alte;
  }
  wrapper.chiudiOverlay();
}

// Il passo interno del "torna indietro": Esc nell'elenco delle conversazioni
// riporta al navigatore delle cartelle, non chiude i selettori. Si prova sul
// vero cambiaConversazione, con i due selettori finti: e' la sequenza delle
// chiamate a dire se il ciclo esiste davvero.
async function testEscDalleConversazioniTornaAlleCartelle() {
  pulisciCartella();
  const { wrapper } = wrapperFinto('00000000-0000-4000-8000-00000000ba02', CARTELLA);

  const passi = [];
  // Prima volta: si sceglie una cartella. Seconda: si esce, cioe' "indietro".
  let visiteCartelle = 0;
  wrapper.apriCartelle = async () => {
    passi.push('cartelle');
    visiteCartelle += 1;
    return visiteCartelle === 1 ? { percorso: CARTELLA, ripresa: true } : null;
  };
  // L'elenco delle conversazioni viene annullato: deve riportare alle cartelle.
  wrapper.apriConversazioni = async () => {
    passi.push('conversazioni');
    return null;
  };

  const esito = await wrapper.cambiaConversazione();
  assert.deepEqual(
    passi,
    ['cartelle', 'conversazioni', 'cartelle'],
    'esc dalle conversazioni riapre le cartelle invece di chiudere',
  );
  assert.equal(esito, 'indietro', 'e esc sulle cartelle riporta a chi ha aperto i selettori');
}

// Una schermata aperta da un'altra deve poter tornare da dove e' venuta: Esc nel
// primo selettore riporta all'albero, non fuori dall'overlay. Sbagliare tasto
// non deve costare l'uscita.
async function testEscNeiSelettoriTornaAllAlbero() {
  pulisciCartella();
  const sessionId = '00000000-0000-4000-8000-00000000ba01';
  creaTranscript(sessionId, CARTELLA, [
    msg('a', null, 'user', 'il prompt di partenza', 1),
    { type: 'last-prompt', leafUuid: 'a', sessionId },
  ]);

  const { wrapper, schermo } = wrapperFinto(sessionId, CARTELLA);
  let aperture = 0;
  // Il selettore vero legge il disco e si prende lo stdin: qui basta dire che
  // l'utente ha premuto Esc sul primo passo.
  wrapper.cambiaConversazione = async () => {
    aperture += 1;
    return 'indietro';
  };

  const attesa = wrapper.mostraOverlay();
  await attendiPrompt(schermo);

  const da = schermo().length;
  await premiTasti('c');
  // Ci si aspetta che l'albero sia stato ridisegnato dopo il ritorno.
  for (let i = 0; i < 200 && !schermo().slice(da).includes('il prompt di partenza'); i += 1) {
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(aperture, 1, 'il selettore e stato aperto');
  assert.match(schermo().slice(da), /il prompt di partenza/, 'e l albero e tornato a schermo');
  assert.equal(wrapper.inOverlay, true, 'restando dentro l overlay');

  premi(ANNULLA);
  await attesa;
  assert.equal(wrapper.inOverlay, false, 'e da li esc chiude come sempre');
}

async function testSeguelaSessioneDopoUnClear() {
  const primaDelClear = '00000000-0000-4000-8000-0000000c1ea1';
  const dopoIlClear = '00000000-0000-4000-8000-0000000c1ea2';

  const vecchio = creaTranscript(primaDelClear, CARTELLA, [
    msg('v1', null, 'user', 'prima del clear', 1),
    { type: 'last-prompt', leafUuid: 'v1', sessionId: primaDelClear },
  ]);
  const nuovo = creaTranscript(dopoIlClear, CARTELLA, [
    // Radice diversa: dopo un clear le due sessioni non sono parenti, quindi
    // l'albero non le unisce e l'una non puo' comparire dentro l'altra.
    msg('n1', null, 'user', 'dopo il clear', 1),
    { type: 'last-prompt', leafUuid: 'n1', sessionId: dopoIlClear },
  ]);

  // Le due scritture possono cadere nello stesso millisecondo: l'ordine va
  // imposto, altrimenti la prova passerebbe o no a seconda del disco.
  const adesso = Date.now() / 1000;
  fs.utimesSync(vecchio, adesso - 60, adesso - 60);
  fs.utimesSync(nuovo, adesso, adesso);

  // Lo stato in cui cb si trovava: l'id della sessione di prima del clear.
  const { wrapper, schermo } = wrapperFinto(primaDelClear, CARTELLA);
  wrapper.avviatoIl = 0;

  const attesa = wrapper.mostraOverlay();
  await attendiPrompt(schermo);
  premi(ANNULLA);
  await attesa;

  assert.match(schermo(), /dopo il clear/, 'mostra la conversazione viva');
  assert.doesNotMatch(schermo(), /prima del clear/, 'e non quella di prima del clear');
  assert.equal(wrapper.sessionId, dopoIlClear, 'e da qui in poi forka la sessione giusta');
}

// Il rovescio della medaglia del test qui sopra: i file di una famiglia stanno
// nella stessa cartella, e uno di loro non deve rubarsi l'albero solo perche' il
// disco gli ha dato lo stesso millisecondo. Seguire "il piu' recente" e basta
// rendeva la scelta una monetina, e cb saltava sulla sessione sbagliata.
async function testUnParenteNonSiRubaLaSessione() {
  const nostra = '00000000-0000-4000-8000-0000000d0001';
  const parente = '00000000-0000-4000-8000-0000000d0002';

  const fileNostro = creaTranscript(nostra, CARTELLA, [
    msg('a', null, 'user', 'la nostra conversazione', 1),
    { type: 'last-prompt', leafUuid: 'a', sessionId: nostra },
  ]);
  const fileParente = creaTranscript(parente, CARTELLA, [
    msg('a', null, 'user', 'il ramo di un parente', 1),
    { type: 'last-prompt', leafUuid: 'a', sessionId: parente },
  ]);

  // Stesso istante esatto: e' il caso che rendeva la prova una monetina.
  const adesso = Date.now() / 1000;
  fs.utimesSync(fileNostro, adesso, adesso);
  fs.utimesSync(fileParente, adesso, adesso);

  const { wrapper, schermo } = wrapperFinto(nostra, CARTELLA);
  wrapper.avviatoIl = 0;

  const attesa = wrapper.mostraOverlay();
  await attendiPrompt(schermo);
  premi(ANNULLA);
  await attesa;

  assert.match(schermo(), /la nostra conversazione/, 'resta sulla sessione che stiamo seguendo');
  assert.equal(wrapper.sessionId, nostra, 'e l id non cambia');
}

async function testOverlayDisegnaAlberoEScegliRamo() {
  const sessionId = '00000000-0000-4000-8000-00000000beef';
  const percorso = creaTranscript(sessionId, CARTELLA, [
    msg('a', null, 'user', 'primo prompt', 1),
    msg('b', 'a', 'assistant', 'prima risposta', 2),
    msg('c1', 'b', 'user', 'strada uno', 3),
    msg('c2', 'b', 'user', 'strada due', 4),
    { type: 'last-prompt', leafUuid: 'c2', lastPrompt: 'strada due', sessionId },
  ]);

  const { wrapper, schermo } = wrapperFinto(sessionId, CARTELLA);

  const attesa = wrapper.mostraOverlay();
  await attendiPrompt(schermo);

  // Il cursore parte dalla punta del ramo attivo, cioe' "strada due".
  assert.match(schermo(), /rami di questa conversazione/, 'intestazione presente');
  assert.match(schermo(), /strada due/, 'il ramo attivo e quello selezionato all apertura');
  assert.match(schermo(), /primo prompt/, 'e sotto c e la storia che lo precede');

  // Su = ramo fratello: "strada uno", quello in disparte.
  await premiTasti(SU);
  assert.match(schermo(), /strada uno/, 'la freccia porta sul ramo in disparte');

  // Le lettere muovono come le frecce: guardo solo quello che viene ridisegnato
  // dopo il tasto, perche' lo schermo finto accumula tutto.
  let da = schermo().length;
  await premiTasti('s');
  assert.match(schermo().slice(da), /strada due/, 's muove come la freccia giu');
  da = schermo().length;
  await premiTasti('w');
  assert.match(schermo().slice(da), /strada uno/, 'w muove come la freccia su');

  await premiTasti(INVIO, ENTRAMBI);
  await attesa;

  const testo = schermo();
  assert.match(testo, /riporta indietro/, 'invio chiede prima cosa riportare indietro');
  assert.match(testo, /riparto da/, 'conferma la ripartenza');
  assert.equal(wrapper.ramoAvviato, true, 'viene lanciato un nuovo processo Claude');

  // Il ramo scelto era in disparte: deve essere stato riattivato nel file.
  const righe = fs.readFileSync(percorso, 'utf8').trim().split('\n').map((r) => JSON.parse(r));
  const ultimoLastPrompt = righe.filter((r) => r.type === 'last-prompt').pop();
  assert.equal(ultimoLastPrompt.leafUuid, 'c1', 'il ramo in disparte e stato riattivato');
  assert.equal(righe.filter((r) => r.uuid).length, 4, 'nessun messaggio perso');

  fs.unlinkSync(percorso);
}

async function testOverlayAnnullatoNonTocca() {
  const sessionId = '00000000-0000-4000-8000-00000000cafe';
  const percorso = creaTranscript(sessionId, CARTELLA, [
    msg('a', null, 'user', 'unico prompt', 1),
    { type: 'last-prompt', leafUuid: 'a', lastPrompt: 'unico prompt', sessionId },
  ]);
  const dimensionePrima = fs.statSync(percorso).size;

  const { wrapper, schermo } = wrapperFinto(sessionId, CARTELLA);

  const attesa = wrapper.mostraOverlay();
  await attendiPrompt(schermo);
  premi(ANNULLA); // esc = torna a Claude senza scegliere
  await attesa;

  assert.equal(wrapper.inOverlay, false, 'l overlay si richiude');
  assert.equal(wrapper.ramoAvviato, undefined, 'nessun nuovo processo');
  assert.equal(fs.statSync(percorso).size, dimensionePrima, 'il transcript non viene toccato');

  fs.unlinkSync(percorso);
}

async function testOverlaySopravviveAiRilasci() {
  // Regressione dal caso reale: dopo Ctrl+G arrivano i rilasci di Ctrl e di G,
  // che iniziano con 0x1b. Venivano scambiati per Esc e chiudevano l'overlay
  // all'istante, producendo solo uno sfarfallio a schermo.
  const sessionId = '00000000-0000-4000-8000-0000000000aa';
  const percorso = creaTranscript(sessionId, CARTELLA, [
    msg('a', null, 'user', 'ciao', 1),
    msg('b', 'a', 'assistant', 'risposta', 2),
    { type: 'last-prompt', leafUuid: 'b', lastPrompt: 'ciao', sessionId },
  ]);

  const { wrapper, schermo } = wrapperFinto(sessionId, CARTELLA);
  const attesa = wrapper.mostraOverlay();
  await attendiPrompt(schermo);

  // I rilasci come li manda davvero Windows Terminal (dal log di diagnosi).
  const rilascioCtrl = Buffer.from(`${esc}[17;29;0;0;32;1_`, 'latin1');
  const rilascioG = Buffer.from(`${esc}[71;34;7;0;40;1_`, 'latin1');
  process.stdin.emit('data', rilascioCtrl);
  process.stdin.emit('data', rilascioG);
  // Anche il mouse, che riempie lo stdin di cifre.
  process.stdin.emit('data', Buffer.from(`${esc}[<35;74;20M`, 'latin1'));

  await new Promise((r) => setTimeout(r, 30));
  assert.equal(wrapper.inOverlay, true, 'l overlay resta aperto dopo i rilasci');

  premi(ANNULLA); // ora lo chiudo davvero
  await attesa;
  assert.equal(wrapper.inOverlay, false, 'l esc chiude l overlay');

  fs.unlinkSync(percorso);
}

// Crea un transcript con due rami e sceglie il ramo in disparte.
// Il cursore parte da "strada due" (punta del ramo attivo): un colpo di freccia
// su lo porta sul fratello "strada uno". Invio apre il menu, e la voce si conferma
// premendo invio sulla preselezione.
// opzioni: passate a wrapperFinto
// ritorna: { wrapper, schermo, ripristini, percorso }
async function scegliRamo(sessionId, opzioni = {}) {
  const percorso = creaTranscript(sessionId, CARTELLA, [
    msg('a', null, 'user', 'primo prompt', 1),
    msg('b', 'a', 'assistant', 'prima risposta', 2),
    msg('c1', 'b', 'user', 'strada uno', 3),
    msg('c2', 'b', 'user', 'strada due', 4),
    { type: 'last-prompt', leafUuid: 'c2', lastPrompt: 'strada due', sessionId },
  ]);

  const contesto = wrapperFinto(sessionId, CARTELLA, opzioni);
  const attesa = contesto.wrapper.mostraOverlay();
  await attendiPrompt(contesto.schermo);
  await premiTasti(SU, INVIO, INVIO);
  await attesa;

  return { ...contesto, percorso };
}

async function testOverlaySiRidisegnaAlRidimensionamento() {
  // Il problema: l'overlay ridisegnava solo dopo un tasto, quindi allargando o
  // stringendo la finestra restava a schermo con le dimensioni vecchie — tagliato,
  // o con lo scorrimento calcolato su una larghezza che non esisteva piu'.
  const sessionId = '00000000-0000-4000-8000-0000000000f5';
  const percorso = creaTranscript(sessionId, CARTELLA, [
    msg('a', null, 'user', 'primo prompt', 1),
    msg('b', 'a', 'assistant', 'prima risposta', 2),
    msg('c', 'b', 'user', 'secondo prompt', 3),
    { type: 'last-prompt', leafUuid: 'c', lastPrompt: 'secondo prompt', sessionId },
  ]);

  const colonneVere = process.stdout.columns;
  const righeVere = process.stdout.rows;
  const ridimensionamentiAlPty = [];

  try {
    process.stdout.columns = 100;
    process.stdout.rows = 30;

    const contesto = wrapperFinto(sessionId, CARTELLA);
    const { wrapper } = contesto;
    wrapper.processo.resize = (c, r) => ridimensionamentiAlPty.push([c, r]);

    const attesa = wrapper.mostraOverlay();
    await attendiPrompt(contesto.schermo);

    // Il disegno iniziale sta nelle 100 colonne dichiarate.
    const nudo = (t) => t.replace(/\x1b\[[0-9;]*m/g, '');
    const righeDi = (testo) => nudo(testo).split('\r\n').filter((r) => r.length > 0);
    for (const riga of righeDi(contesto.schermo())) {
      assert.ok(riga.length <= 100, `riga di ${riga.length} colonne prima del ridimensionamento`);
    }

    // Stringo la finestra e annuncio il ridimensionamento, senza premere tasti.
    // Chiamo il metodo invece di emettere l'evento: l'ascoltatore lo registra
    // avvia(), che i test non invocano perche' metterebbe lo stdin in raw mode.
    const primaDelRidimensionamento = contesto.schermo().length;
    process.stdout.columns = 48;
    process.stdout.rows = 20;
    wrapper.ridimensiona();

    // Il pty va avvisato subito: al ritorno Claude deve gia' sapere le misure.
    assert.deepEqual(
      ridimensionamentiAlPty.at(-1),
      [48, 20],
      'il processo Claude viene avvisato del ridimensionamento',
    );

    // Il ridisegno e' ritardato per non sfarfallare mentre si trascina il bordo.
    await new Promise((r) => setTimeout(r, 200));
    const dopo = contesto.schermo().slice(primaDelRidimensionamento);
    assert.ok(dopo.length > 0, 'l overlay si ridisegna senza bisogno di premere tasti');
    for (const riga of righeDi(dopo)) {
      assert.ok(riga.length <= 48, `riga di ${riga.length} colonne dopo il ridimensionamento`);
    }
    assert.match(nudo(dopo), /rami di questa conversazione/, 'ed e di nuovo l albero');

    // Chiuso l'overlay, un ridimensionamento non deve piu' disegnarci sopra:
    // lo schermo torna di Claude.
    premi(ANNULLA);
    await attesa;

    const dopoLaChiusura = contesto.schermo().length;
    process.stdout.columns = 70;
    wrapper.ridimensiona();
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(
      contesto.schermo().length,
      dopoLaChiusura,
      'a overlay chiuso il ridimensionamento non scrive nulla',
    );
  } finally {
    process.stdout.columns = colonneVere;
    process.stdout.rows = righeVere;
    fs.unlinkSync(percorso);
  }
}

async function testRipristinaAncheIFile() {
  // Senza questo la conversazione torna indietro ma il codice resta quello di
  // adesso, e Claude si limita a suggerire il comando da lanciare a mano.
  const sessionId = '00000000-0000-4000-8000-0000000000b1';
  const { wrapper, schermo, ripristini, percorso } = await scegliRamo(sessionId);

  assert.equal(ripristini.length, 1, 'il ripristino dei file viene eseguito');
  assert.equal(ripristini[0].percorso, percorso, 'sul transcript della sessione di partenza');
  assert.equal(ripristini[0].uuid, 'c1', 'sul messaggio scelto');
  assert.match(schermo(), /ripristino i file/, 'lo dice a schermo');
  assert.match(schermo(), /2 file ripristinati/, 'riporta l esito');
  assert.equal(wrapper.ramoAvviato, true, 'poi riparte Claude');

  fs.unlinkSync(percorso);
}

async function testSenzaFileNonRipristina() {
  const sessionId = '00000000-0000-4000-8000-0000000000b2';
  const { wrapper, schermo, ripristini, percorso } = await scegliRamo(sessionId, {
    wrapper: { ripristinaCodice: false },
  });

  assert.equal(ripristini.length, 0, 'con ripristinaCodice=false i file non si toccano');
  assert.match(schermo(), /i file restano come sono/, 'l overlay lo dichiara');
  assert.equal(wrapper.ramoAvviato, true, 'il ramo parte comunque');

  fs.unlinkSync(percorso);
}

async function testNessunaCopiaNonEUnErrore() {
  // Se da quel messaggio i file non sono stati toccati non c'e' niente da
  // ripristinare: va detto con calma, non come un guasto.
  const sessionId = '00000000-0000-4000-8000-0000000000b3';
  const { wrapper, schermo, percorso } = await scegliRamo(sessionId, {
    esitoRipristino: { ok: true, riassunto: "i file erano gia' in quello stato" },
  });

  assert.match(schermo(), /erano gia' in quello stato/, 'messaggio non allarmante');
  assert.doesNotMatch(schermo(), /NON ripristinati/, 'non viene dato per errore');
  assert.equal(wrapper.ramoAvviato, true, 'il ramo parte comunque');

  fs.unlinkSync(percorso);
}

async function testRipristinoFallitoAvvisaEProsegue() {
  const sessionId = '00000000-0000-4000-8000-0000000000b4';
  const { wrapper, schermo, percorso } = await scegliRamo(sessionId, {
    esitoRipristino: { ok: false, riassunto: 'disco pieno' },
  });

  assert.match(schermo(), /file NON ripristinati/, 'avvisa che i file non sono tornati indietro');
  assert.match(schermo(), /disco pieno/, 'riporta il motivo');
  assert.equal(wrapper.ramoAvviato, true, 'la conversazione riparte comunque');

  fs.unlinkSync(percorso);
}

async function testSoloCodiceNonToccaLaConversazione() {
  // "Solo il codice" e' l'unico caso in cui Claude non va riavviato: la
  // conversazione resta dov'e', tornano indietro solo i file.
  const sessionId = '00000000-0000-4000-8000-0000000000b5';
  const percorso = creaTranscript(sessionId, CARTELLA, [
    msg('a', null, 'user', 'primo prompt', 1),
    msg('b', 'a', 'assistant', 'prima risposta', 2),
    msg('c1', 'b', 'user', 'strada uno', 3),
    msg('c2', 'b', 'user', 'strada due', 4),
    { type: 'last-prompt', leafUuid: 'c2', lastPrompt: 'strada due', sessionId },
  ]);

  const contesto = wrapperFinto(sessionId, CARTELLA);
  const { wrapper } = contesto;
  let ucciso = false;
  const kill = wrapper.processo.kill;
  wrapper.processo.kill = () => {
    ucciso = true;
    kill();
  };

  const attesa = wrapper.mostraOverlay();
  await attendiPrompt(contesto.schermo);
  await premiTasti(SU, INVIO, SOLO_CODICE);
  await attesa;

  assert.equal(contesto.ripristini.length, 1, 'i file tornano indietro');
  assert.equal(contesto.ripristini[0].uuid, 'c1', 'al punto scelto nell albero');
  assert.equal(ucciso, false, 'il processo Claude non viene chiuso');
  assert.equal(wrapper.ramoAvviato, undefined, 'e nessuna sessione nuova viene avviata');
  assert.equal(wrapper.inOverlay, false, 'l overlay si richiude');

  // Il transcript non viene toccato: nessuna riattivazione, nessun taglio.
  const dopo = await leggiTranscript(percorso);
  assert.equal(dopo.leafAttivo, 'c2', 'il ramo attivo resta quello di prima');

  fs.unlinkSync(percorso);
}

async function testSoloConversazioneNonToccaIFile() {
  const sessionId = '00000000-0000-4000-8000-0000000000b6';
  const percorso = creaTranscript(sessionId, CARTELLA, [
    msg('a', null, 'user', 'primo prompt', 1),
    msg('b', 'a', 'assistant', 'prima risposta', 2),
    msg('c1', 'b', 'user', 'strada uno', 3),
    msg('c2', 'b', 'user', 'strada due', 4),
    { type: 'last-prompt', leafUuid: 'c2', lastPrompt: 'strada due', sessionId },
  ]);

  const contesto = wrapperFinto(sessionId, CARTELLA);
  const attesa = contesto.wrapper.mostraOverlay();
  await attendiPrompt(contesto.schermo);
  await premiTasti(SU, INVIO, SOLO_CONVERSAZIONE);
  await attesa;

  assert.equal(contesto.ripristini.length, 0, 'i file non si toccano');
  assert.equal(contesto.wrapper.ramoAvviato, true, 'ma la conversazione riparte dal punto scelto');

  fs.unlinkSync(percorso);
  const creata = path.join(
    CARTELLA_PROGETTI,
    slugProgetto(CARTELLA),
    `${contesto.wrapper.sessioneRipresa}.jsonl`,
  );
  if (fs.existsSync(creata)) fs.unlinkSync(creata);
}

async function testDoppioInvioNellaStessaLettura() {
  // Due invii battuti in fretta arrivano in una lettura sola: il primo apre il
  // menu, il secondo finiva nella coda della navigazione e il menu restava li'
  // ad aspettare un tasto che l'utente aveva gia' premuto.
  const sessionId = '00000000-0000-4000-8000-0000000000b8';
  const percorso = creaTranscript(sessionId, CARTELLA, [
    msg('a', null, 'user', 'primo prompt', 1),
    msg('b', 'a', 'assistant', 'prima risposta', 2),
    msg('c1', 'b', 'user', 'strada uno', 3),
    msg('c2', 'b', 'user', 'strada due', 4),
    { type: 'last-prompt', leafUuid: 'c2', lastPrompt: 'strada due', sessionId },
  ]);

  const contesto = wrapperFinto(sessionId, CARTELLA);
  const attesa = contesto.wrapper.mostraOverlay();
  await attendiPrompt(contesto.schermo);

  premi(`${INVIO}${INVIO}`); // una sola lettura con due invii
  await attesa;

  assert.equal(contesto.ripristini.length, 1, 'il secondo invio conferma la preselezione');
  assert.equal(contesto.wrapper.ramoAvviato, true, 'e il ramo parte senza altri tasti');

  fs.unlinkSync(percorso);
  const creata = path.join(
    CARTELLA_PROGETTI,
    slugProgetto(CARTELLA),
    `${contesto.wrapper.sessioneRipresa}.jsonl`,
  );
  if (fs.existsSync(creata)) fs.unlinkSync(creata);
}

async function testEscNelMenuTornaAllAlbero() {
  const sessionId = '00000000-0000-4000-8000-0000000000b7';
  const percorso = creaTranscript(sessionId, CARTELLA, [
    msg('a', null, 'user', 'primo prompt', 1),
    msg('b', 'a', 'assistant', 'prima risposta', 2),
    msg('c1', 'b', 'user', 'strada uno', 3),
    msg('c2', 'b', 'user', 'strada due', 4),
    { type: 'last-prompt', leafUuid: 'c2', lastPrompt: 'strada due', sessionId },
  ]);

  const contesto = wrapperFinto(sessionId, CARTELLA);
  const attesa = contesto.wrapper.mostraOverlay();
  await attendiPrompt(contesto.schermo);

  await premiTasti(INVIO);
  assert.match(contesto.schermo(), /riporta indietro/, 'invio apre il menu');

  // Esc nel menu non chiude l'overlay: riporta all'albero, dove si puo'
  // cambiare punto e riprovare.
  const da = contesto.schermo().length;
  await premiTasti(ANNULLA);
  assert.equal(contesto.wrapper.inOverlay, true, 'l overlay resta aperto');
  assert.match(contesto.schermo().slice(da), /invio = riparti/, 'e torna la barra dei tasti');

  premi(ANNULLA); // ora chiudo davvero
  await attesa;

  assert.equal(contesto.ripristini.length, 0, 'niente e stato ripristinato');
  assert.equal(contesto.wrapper.ramoAvviato, undefined, 'e nessun ramo e partito');

  fs.unlinkSync(percorso);
}

async function testRamoDelPadreVisibileESelezionabile() {
  // Il problema segnalato: dopo un fork il ramo abbandonato resta nel file della
  // sessione di partenza, e guardando solo la sessione corrente non si recupera.
  const sidPadre = '00000000-0000-4000-8000-0000000000c1';
  const sidFiglio = '00000000-0000-4000-8000-0000000000c2';

  const filePadre = creaTranscript(sidPadre, CARTELLA, [
    msg('a', null, 'user', 'ciao', 1),
    msg('b', 'a', 'assistant', 'risposta', 2),
    msg('vecchio', 'b', 'user', 'strada abbandonata', 3),
    { type: 'last-prompt', leafUuid: 'vecchio', lastPrompt: 'strada abbandonata', sessionId: sidPadre },
  ]);
  // Il fork copia a e b con gli stessi uuid: e' cosi' che si riconosce la famiglia.
  const fileFiglio = creaTranscript(sidFiglio, CARTELLA, [
    msg('a', null, 'user', 'ciao', 1),
    msg('b', 'a', 'assistant', 'risposta', 2),
    msg('nuovo', 'b', 'user', 'strada nuova', 4),
    { type: 'last-prompt', leafUuid: 'nuovo', lastPrompt: 'strada nuova', sessionId: sidFiglio },
  ]);

  const { wrapper, schermo, ripristini } = wrapperFinto(sidFiglio, CARTELLA);
  const attesa = wrapper.mostraOverlay();
  await attendiPrompt(schermo);

  assert.match(schermo(), /strada nuova/, 'il cursore parte dal ramo corrente');

  // Su = fratello precedente, che vive solo nel file del padre.
  await premiTasti(SU);
  assert.match(schermo(), /strada abbandonata/, 'il ramo del padre e raggiungibile dal figlio');

  await premiTasti(INVIO, ENTRAMBI);
  await attesa;

  assert.equal(ripristini[0]?.percorso, filePadre, 'il fork riparte dalla sessione del padre');
  assert.equal(ripristini[0]?.uuid, 'vecchio', 'dal messaggio scelto');
  assert.match(schermo(), /ramo della sessione/, 'avvisa che il ramo viene da un altra sessione');

  // La riattivazione va scritta nel file del padre, non in quello corrente.
  const righePadre = fs.readFileSync(filePadre, 'utf8').trim().split('\n').map((r) => JSON.parse(r));
  assert.equal(
    righePadre.filter((r) => r.type === 'last-prompt').pop().leafUuid,
    'vecchio',
    'ramo riattivato nel file del padre',
  );
  const righeFiglio = fs.readFileSync(fileFiglio, 'utf8').trim().split('\n').map((r) => JSON.parse(r));
  assert.equal(
    righeFiglio.filter((r) => r.type === 'last-prompt').length,
    1,
    'il file del figlio non viene toccato',
  );

  fs.unlinkSync(filePadre);
  fs.unlinkSync(fileFiglio);
}

async function testAlberoRestaDopoIlCambioRamo() {
  // Il problema segnalato: dopo aver ripristinato con la scorciatoia, l'albero
  // spariva e cb diceva che la conversazione non ha un transcript. Claude infatti
  // scrive il file della sessione forkata solo al primo messaggio.
  const sessionId = '00000000-0000-4000-8000-0000000000d1';
  const percorso = creaTranscript(sessionId, CARTELLA, [
    msg('a', null, 'user', 'primo prompt', 1),
    msg('b', 'a', 'assistant', 'prima risposta', 2),
    msg('c1', 'b', 'user', 'strada uno', 3),
    msg('c2', 'b', 'user', 'strada due', 4),
    { type: 'last-prompt', leafUuid: 'c2', lastPrompt: 'strada due', sessionId },
  ]);

  const contesto = wrapperFinto(sessionId, CARTELLA);
  const { wrapper } = contesto;

  const primo = wrapper.mostraOverlay();
  await attendiPrompt(contesto.schermo);
  await premiTasti(SU, INVIO, ENTRAMBI); // dal ramo attivo al fratello: "strada uno"
  await primo;

  assert.ok(wrapper.sessioneRipresa, 'il primo cambio ramo crea e riprende una sessione');
  assert.equal(wrapper.percorsoOrigine, percorso, 'ricorda il transcript di provenienza');

  // La sessione creata da cb ha subito il suo file: e' cosi' che l'albero
  // sopravvive anche prima del primo messaggio.
  const creata = path.join(CARTELLA_PROGETTI, slugProgetto(CARTELLA), `${wrapper.sessioneRipresa}.jsonl`);
  assert.ok(fs.existsSync(creata), 'il transcript del ramo esiste su disco');

  // Secondo Ctrl+G subito dopo, senza aver mandato messaggi.
  const schermoPrima = contesto.schermo().length;
  const secondo = wrapper.mostraOverlay();
  await attendiPrompt(() => contesto.schermo().slice(schermoPrima));

  assert.doesNotMatch(
    contesto.schermo().slice(schermoPrima),
    /non ha ancora un transcript/,
    'non dichiara il transcript assente',
  );
  assert.match(
    contesto.schermo().slice(schermoPrima),
    /rami di questa conversazione/,
    'l albero viene ancora disegnato',
  );
  assert.match(contesto.schermo().slice(schermoPrima), /strada uno/, 'il ramo appena preso');

  // Il ramo lasciato e' ancora raggiungibile: e' il fratello successivo.
  await premiTasti(GIU);
  assert.match(contesto.schermo().slice(schermoPrima), /strada due/, 'compreso quello lasciato');

  premi(ANNULLA); // chiudo senza scegliere
  await secondo;

  fs.unlinkSync(percorso);
  fs.unlinkSync(creata);
}

async function testRiattivazioneSopravviveAScrittureInRitardo() {
  // Il caso reale: Claude, uscendo, appende un ultimo last-prompt che
  // sovrascriveva la riattivazione. Risultato: --rewind-files rispondeva
  // "requires a user message UUID" perche' il messaggio non era piu' nel ramo.
  const sessionId = '00000000-0000-4000-8000-0000000000e1';
  const percorso = creaTranscript(sessionId, CARTELLA, [
    msg('a', null, 'user', 'primo prompt', 1),
    msg('b', 'a', 'assistant', 'prima risposta', 2),
    msg('c1', 'b', 'user', 'strada uno', 3),
    msg('c2', 'b', 'user', 'strada due', 4),
    { type: 'last-prompt', leafUuid: 'c2', lastPrompt: 'strada due', sessionId },
  ]);

  const contesto = wrapperFinto(sessionId, CARTELLA);
  const { wrapper } = contesto;

  // Alla prima riattivazione simulo la scrittura tardiva di Claude, che riporta
  // il ramo attivo su c2. Il wrapper deve accorgersene e riprovare.
  let sabotaggi = 0;
  const kill = wrapper.processo.kill;
  wrapper.processo.kill = () => {
    kill();
    setTimeout(() => {
      if (sabotaggi > 0) return;
      sabotaggi += 1;
      fs.appendFileSync(
        percorso,
        `${JSON.stringify({ type: 'last-prompt', leafUuid: 'c2', sessionId })}\n`,
      );
    }, 60);
  };

  const attesa = wrapper.mostraOverlay();
  await attendiPrompt(contesto.schermo);
  await premiTasti(SU, INVIO, ENTRAMBI); // "strada uno", ramo in disparte
  await attesa;

  assert.equal(sabotaggi, 1, 'la scrittura tardiva e stata simulata');

  const finale = await leggiTranscript(percorso);
  assert.equal(finale.leafAttivo, 'c1', 'il ramo scelto resta quello attivo');
  assert.equal(wrapper.ramoAvviato, true, 'e la nuova sessione parte');

  fs.unlinkSync(percorso);
}

async function testDueCambiRamoDiFila() {
  // Il caso segnalato: primo ripristino ok, il secondo fallisce con
  // "No conversation found with session ID". La sessione forkata non ha ancora
  // un file, e cb provava a riprendere quella invece del transcript da cui
  // stava leggendo l'albero.
  const sessionId = '00000000-0000-4000-8000-0000000000f1';
  const percorso = creaTranscript(sessionId, CARTELLA, [
    msg('a', null, 'user', 'ciao', 1),
    msg('b', 'a', 'assistant', 'risposta', 2),
    msg('c1', 'b', 'user', 'come sati?', 3),
    msg('c2', 'b', 'user', 'cosa fai?', 4),
    { type: 'last-prompt', leafUuid: 'c2', lastPrompt: 'cosa fai?', sessionId },
  ]);

  const contesto = wrapperFinto(sessionId, CARTELLA);
  const { wrapper } = contesto;
  const avvii = [];

  wrapper.avviaClaude = ({ riprendi } = {}) => {
    avvii.push(riprendi);
    wrapper.sessionId = riprendi;
  };

  // Primo cambio ramo: dal ramo attivo ("cosa fai?") al fratello "come sati?"
  const primo = wrapper.mostraOverlay();
  await attendiPrompt(contesto.schermo);
  await premiTasti(SU, INVIO, ENTRAMBI);
  await primo;

  assert.ok(avvii[0], 'primo cambio ramo avvenuto');
  assert.equal(contesto.ripristini[0].uuid, 'c1', 'primo ramo scelto');

  // Secondo cambio ramo: adesso il cursore parte su "come sati?", e il fratello
  // successivo e' "cosa fai?", rimasto nel file di partenza.
  const lunghezza = contesto.schermo().length;
  const secondo = wrapper.mostraOverlay();
  await attendiPrompt(() => contesto.schermo().slice(lunghezza));
  await premiTasti(GIU, INVIO, ENTRAMBI);
  await secondo;

  assert.equal(avvii.length, 2, 'anche il secondo cambio ramo avviene');
  assert.notEqual(avvii[1], avvii[0], 'ogni ramo e una sessione distinta');
  assert.equal(contesto.ripristini[1].uuid, 'c2', 'secondo ramo scelto');
  assert.equal(
    contesto.ripristini[1].percorso,
    percorso,
    'il ripristino dei file usa la sessione che ha il transcript',
  );

  fs.unlinkSync(percorso);
  for (const id of avvii) {
    const f = path.join(CARTELLA_PROGETTI, slugProgetto(CARTELLA), `${id}.jsonl`);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

async function testPuntoIntermedioTagliaLaConversazione() {
  // Il problema segnalato: scegliendo un punto intermedio ripartiva la
  // conversazione fino alla fine del ramo. Il taglio deve stare nel file della
  // nuova sessione, perche' in interattivo il CLI ignora i flag di troncamento.
  const sessionId = '00000000-0000-4000-8000-000000000a01';
  const percorso = creaTranscript(sessionId, CARTELLA, [
    msg('r1', null, 'user', 'ciao', 1),
    msg('r2', 'r1', 'assistant', 'ciao a te', 2),
    msg('r3', 'r2', 'user', 'cosa fai?', 3),
    msg('r4', 'r3', 'assistant', 'sono Claude', 4),
    msg('r5', 'r4', 'user', 'test', 5),
    msg('r6', 'r5', 'assistant', 'ricevuto', 6),
    { type: 'last-prompt', leafUuid: 'r6', lastPrompt: 'test', sessionId },
  ]);

  const contesto = wrapperFinto(sessionId, CARTELLA);
  const { wrapper } = contesto;

  const attesa = wrapper.mostraOverlay();
  await attendiPrompt(contesto.schermo);
  // Catena unica: il cursore parte da "test", sinistra risale a "cosa fai?"
  await premiTasti(SINISTRA, INVIO, ENTRAMBI);
  await attesa;

  assert.ok(wrapper.sessioneRipresa, 'viene creata una sessione per il ramo');

  const creata = path.join(
    CARTELLA_PROGETTI,
    slugProgetto(CARTELLA),
    `${wrapper.sessioneRipresa}.jsonl`,
  );
  const ramo = await leggiTranscript(creata);
  const prompt = [...ramo.nodi.values()].filter((n) => n.isPromptUtente).map((n) => n.testo);

  assert.deepEqual(prompt, ['ciao', 'cosa fai?'], 'la conversazione finisce al turno scelto');
  assert.ok(ramo.nodi.has('r4'), 'la risposta al prompt scelto e inclusa');
  assert.equal(ramo.nodi.has('r5'), false, '"test" non c e piu');
  assert.equal(ramo.nodi.has('r6'), false, 'nemmeno la sua risposta');
  assert.equal(ramo.leafAttivo, 'r4', 'la catena termina con la risposta al turno scelto');

  // Il file di partenza non viene svuotato: i turni successivi restano lì come
  // ramo in disparte, ripescabili.
  const originale = await leggiTranscript(percorso);
  assert.ok(originale.nodi.has('r5'), 'la sessione di partenza conserva tutto');

  fs.unlinkSync(percorso);
  fs.unlinkSync(creata);
}

// Dall'albero si esce anche verso un'altra conversazione o un'altra cartella,
// senza chiudere Claude: qui si verifica che i due tasti arrivino, e con quale
// richiesta. Cosa fanno poi i selettori e' provato in conversazioni.test.js e
// cartelle.test.js, che non hanno bisogno di un pty finto.
async function testTastiPerCambiareConversazioneOCartella() {
  const sessionId = '00000000-0000-4000-8000-0000000000c1';
  creaTranscript(sessionId, CARTELLA, [
    msg('a', null, 'user', 'primo prompt', 1),
    msg('b', 'a', 'assistant', 'prima risposta', 2),
    { type: 'last-prompt', leafUuid: 'b', sessionId },
  ]);

  // c e p portano allo stesso posto: il navigatore delle cartelle, dove "r"
  // alterna ripresa e avvio normale. Prima "c" saltava direttamente all'elenco
  // delle conversazioni, e da li' non c'era modo di cominciarne una nuova.
  for (const tasto of ['c', 'p']) {
    const { wrapper, schermo } = wrapperFinto(sessionId, CARTELLA);
    let aperture = 0;
    // Il selettore vero prende lo stdin e legge il disco: qui interessa solo
    // che il tasto arrivi fin qui.
    wrapper.cambiaConversazione = async () => {
      aperture += 1;
      wrapper.inOverlay = false;
    };

    const attesa = wrapper.mostraOverlay();
    await attendiPrompt(schermo);
    assert.match(schermo(), /c = altra conversazione|c\/p altra conv/, 'la barra li annuncia');

    await premiTasti(tasto);
    await attesa;

    assert.equal(aperture, 1, `"${tasto}" apre il navigatore`);
    pulisciCartella();
    creaTranscript(sessionId, CARTELLA, [
      msg('a', null, 'user', 'primo prompt', 1),
      msg('b', 'a', 'assistant', 'prima risposta', 2),
      { type: 'last-prompt', leafUuid: 'b', sessionId },
    ]);
  }

  pulisciCartella();
}

const prove = [
  testTastiPerCambiareConversazioneOCartella,
  testOverlaySenzaTranscript,
  testSenzaTranscriptSiArrivaAiSelettori,
  testLaLegendaDellAvvisoStaInFondo,
  testEscNeiSelettoriTornaAllAlbero,
  testEscDalleConversazioniTornaAlleCartelle,
  testSeguelaSessioneDopoUnClear,
  testUnParenteNonSiRubaLaSessione,
  testPuntoIntermedioTagliaLaConversazione,
  testRamoDelPadreVisibileESelezionabile,
  testAlberoRestaDopoIlCambioRamo,
  testRiattivazioneSopravviveAScrittureInRitardo,
  testDueCambiRamoDiFila,
  testOverlayDisegnaAlberoEScegliRamo,
  testOverlayAnnullatoNonTocca,
  testOverlaySopravviveAiRilasci,
  testOverlaySiRidisegnaAlRidimensionamento,
  testRipristinaAncheIFile,
  testSenzaFileNonRipristina,
  testNessunaCopiaNonEUnErrore,
  testRipristinoFallitoAvvisaEProsegue,
  testSoloCodiceNonToccaLaConversazione,
  testSoloConversazioneNonToccaIFile,
  testDoppioInvioNellaStessaLettura,
  testEscNelMenuTornaAllAlbero,
];

for (const prova of prove) {
  pulisciCartella();
  await prova();
  console.log(`ok  ${prova.name}`);
}

// I test creano una cartella progetto finta in ~/.claude/projects: va rimossa,
// altrimenti compare nel catalogo delle sessioni vere.
fs.rmSync(path.join(CARTELLA_PROGETTI, slugProgetto(CARTELLA)), { recursive: true, force: true });

console.log(`\n${prove.length} prove superate`);
process.exit(0);
