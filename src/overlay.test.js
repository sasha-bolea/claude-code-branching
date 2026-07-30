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
  wrapper.ripristinaFile = async (sessione, uuid) => {
    ripristini.push({ sessione, uuid });
    return opzioni.esitoRipristino ?? { ok: true, uscita: 'Restored 2 files', senzaSnapshot: false };
  };

  return { wrapper, schermo: () => schermo.join(''), ripristini };
}

// Simula la pressione di tasti sullo stdin che l'overlay sta ascoltando.
const esc = String.fromCharCode(27);
const premi = (testo) => process.stdin.emit('data', Buffer.from(testo, 'latin1'));

// Attende che l'overlay abbia finito di disegnare e sia in ascolto dei tasti.
// L'attesa e' sul prompt "> " a schermo, non su un numero fisso di tick: il
// disegno passa da una lettura di file asincrona.
async function attendiPrompt(schermo) {
  for (let tentativo = 0; tentativo < 200; tentativo += 1) {
    if (schermo().includes('> ')) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('overlay non pronto: il prompt non e mai comparso');
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
  // Voci: 1 = "primo prompt", 2 = "strada uno" (in disparte), 3 = "strada due" (attivo)
  premi('2\r');
  await attesa;

  const testo = schermo();
  assert.match(testo, /rami di questa conversazione/, 'intestazione presente');
  assert.match(testo, /primo prompt/, 'i prompt compaiono nell albero');
  assert.match(testo, /strada uno/, 'compare il ramo in disparte');
  assert.match(testo, /strada due/, 'compare il ramo attivo');
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
  premi('\r'); // invio a vuoto = torna a Claude
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

  premi('\r'); // ora lo chiudo davvero
  await attesa;
  assert.equal(wrapper.inOverlay, false, 'l invio chiude l overlay');

  fs.unlinkSync(percorso);
}

// Crea un transcript con due rami e lascia scegliere una voce.
// opzioni: passate a wrapperFinto
// scelta: numero digitato nell'overlay
// ritorna: { wrapper, schermo, ripristini, percorso }
async function scegliRamo(sessionId, scelta, opzioni = {}) {
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
  premi(`${scelta}\r`);
  await attesa;

  return { ...contesto, percorso };
}

async function testRipristinaAncheIFile() {
  // Senza questo la conversazione torna indietro ma il codice resta quello di
  // adesso, e Claude si limita a suggerire il comando da lanciare a mano.
  const sessionId = '00000000-0000-4000-8000-0000000000b1';
  const { wrapper, schermo, ripristini, percorso } = await scegliRamo(sessionId, 2);

  assert.equal(ripristini.length, 1, 'il ripristino dei file viene eseguito');
  assert.equal(ripristini[0].sessione, sessionId, 'sulla sessione di partenza');
  assert.equal(ripristini[0].uuid, 'c1', 'sul messaggio scelto');
  assert.match(schermo(), /ripristino i file/, 'lo dice a schermo');
  assert.match(schermo(), /Restored 2 files/, 'riporta l esito');
  assert.equal(wrapper.ramoAvviato, true, 'poi riparte Claude');

  fs.unlinkSync(percorso);
}

async function testSenzaFileNonRipristina() {
  const sessionId = '00000000-0000-4000-8000-0000000000b2';
  const { wrapper, schermo, ripristini, percorso } = await scegliRamo(sessionId, 2, {
    wrapper: { ripristinaCodice: false },
  });

  assert.equal(ripristini.length, 0, 'con ripristinaCodice=false i file non si toccano');
  assert.match(schermo(), /i file restano come sono/, 'l overlay lo dichiara');
  assert.equal(wrapper.ramoAvviato, true, 'il ramo parte comunque');

  fs.unlinkSync(percorso);
}

async function testNessunoSnapshotNonEUnErrore() {
  // Se da quel messaggio i file non sono stati toccati non c'e' niente da
  // ripristinare: va detto con calma, non come un guasto.
  const sessionId = '00000000-0000-4000-8000-0000000000b3';
  const { wrapper, schermo, percorso } = await scegliRamo(sessionId, 2, {
    esitoRipristino: {
      ok: true,
      uscita: 'Error: No file checkpoint found for this message.',
      senzaSnapshot: true,
    },
  });

  assert.match(schermo(), /nessuna modifica ai file/, 'messaggio non allarmante');
  assert.doesNotMatch(schermo(), /NON ripristinati/, 'non viene dato per errore');
  assert.equal(wrapper.ramoAvviato, true, 'il ramo parte comunque');

  fs.unlinkSync(percorso);
}

async function testRipristinoFallitoAvvisaEProsegue() {
  const sessionId = '00000000-0000-4000-8000-0000000000b4';
  const { wrapper, schermo, percorso } = await scegliRamo(sessionId, 2, {
    esitoRipristino: { ok: false, uscita: 'Failed to rewind: disco pieno', senzaSnapshot: false },
  });

  assert.match(schermo(), /file NON ripristinati/, 'avvisa che i file non sono tornati indietro');
  assert.match(schermo(), /disco pieno/, 'riporta il motivo');
  assert.equal(wrapper.ramoAvviato, true, 'la conversazione riparte comunque');

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

  assert.match(schermo(), /strada abbandonata/, 'il ramo del padre e visibile dal figlio');
  assert.match(schermo(), /strada nuova/, 'e c e anche quello corrente');

  premi('2\r'); // voci: 1 = ciao, 2 = strada abbandonata, 3 = strada nuova
  await attesa;

  assert.equal(ripristini[0]?.sessione, sidPadre, 'il fork riparte dalla sessione del padre');
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
  premi('2\r'); // "strada uno"
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
  const nuovo = contesto.schermo().slice(schermoPrima);

  assert.doesNotMatch(nuovo, /non ha ancora un transcript/, 'non dichiara il transcript assente');
  assert.match(nuovo, /rami di questa conversazione/, 'l albero viene ancora disegnato');
  assert.match(nuovo, /strada uno/, 'con tutti i rami');
  assert.match(nuovo, /strada due/, 'compreso quello lasciato');

  premi('\r'); // chiudo senza scegliere
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
  premi('2\r'); // "strada uno", ramo in disparte
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

  // Primo cambio ramo: scelgo "come sati?"
  const primo = wrapper.mostraOverlay();
  await attendiPrompt(contesto.schermo);
  premi('2\r');
  await primo;

  assert.ok(avvii[0], 'primo cambio ramo avvenuto');
  assert.equal(contesto.ripristini[0].uuid, 'c1', 'primo ramo scelto');

  // Secondo cambio ramo: scelgo "cosa fai?"
  const lunghezza = contesto.schermo().length;
  const secondo = wrapper.mostraOverlay();
  await attendiPrompt(() => contesto.schermo().slice(lunghezza));
  premi('3\r');
  await secondo;

  assert.equal(avvii.length, 2, 'anche il secondo cambio ramo avviene');
  assert.notEqual(avvii[1], avvii[0], 'ogni ramo e una sessione distinta');
  assert.equal(contesto.ripristini[1].uuid, 'c2', 'secondo ramo scelto');
  assert.equal(
    contesto.ripristini[1].sessione,
    sessionId,
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
  premi('2\r'); // voci: 1 = ciao, 2 = "cosa fai?", 3 = "test"
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

const prove = [
  testOverlaySenzaTranscript,
  testPuntoIntermedioTagliaLaConversazione,
  testRamoDelPadreVisibileESelezionabile,
  testAlberoRestaDopoIlCambioRamo,
  testRiattivazioneSopravviveAScrittureInRitardo,
  testDueCambiRamoDiFila,
  testOverlayDisegnaAlberoEScegliRamo,
  testOverlayAnnullatoNonTocca,
  testOverlaySopravviveAiRilasci,
  testRipristinaAncheIFile,
  testSenzaFileNonRipristina,
  testNessunoSnapshotNonEUnErrore,
  testRipristinoFallitoAvvisaEProsegue,
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
