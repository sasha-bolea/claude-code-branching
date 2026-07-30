import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { leggiTranscript, biforcazioni, foglie, catenaFinoA, unisciAlberi } from './transcript.js';
import { attivaRamoDi, nelRamoAttivo } from './attiva.js';

// Scrive un .jsonl temporaneo da un array di record.
// record: array di oggetti da serializzare una riga ciascuno
// ritorna: path del file creato
function scriviTemporaneo(record) {
  const file = path.join(os.tmpdir(), `cb-test-${process.pid}-${record.length}.jsonl`);
  fs.writeFileSync(file, record.map((r) => JSON.stringify(r)).join('\n'), 'utf8');
  return file;
}

// Costruisce un record utente/assistente minimo per i test.
function msg(uuid, parentUuid, tipo, testo, extra = {}) {
  return {
    type: tipo,
    uuid,
    parentUuid,
    sessionId: 'sess-test',
    timestamp: `2026-07-29T10:0${uuid.length}:00.000Z`,
    message: { content: [{ type: 'text', text: testo }] },
    ...extra,
  };
}

async function testAlberoConBiforcazione() {
  // a -> b -> {c1 (ramo abbandonato), c2 (ramo ripreso)}
  const file = scriviTemporaneo([
    msg('a', null, 'user', 'primo prompt'),
    msg('b', 'a', 'assistant', 'prima risposta'),
    msg('c1', 'b', 'user', 'strada uno'),
    msg('d1', 'c1', 'assistant', 'risposta strada uno'),
    msg('c2', 'b', 'user', 'strada due'),
    { type: 'last-prompt', leafUuid: 'c2', lastPrompt: 'strada due', sessionId: 'sess-test' },
  ]);

  const albero = await leggiTranscript(file);

  assert.equal(albero.nodi.size, 5, 'cinque nodi nell albero');
  assert.equal(albero.radici.length, 1, 'una sola radice');
  assert.equal(albero.radici[0].uuid, 'a');
  assert.equal(albero.leafAttivo, 'c2', 'leaf attivo letto da last-prompt');
  assert.equal(albero.sessionId, 'sess-test');

  const forche = biforcazioni(albero);
  assert.equal(forche.length, 1, 'una sola biforcazione');
  assert.equal(forche[0].uuid, 'b');
  assert.equal(forche[0].figli.length, 2, 'due rami da b');

  const punte = foglie(albero);
  assert.deepEqual(punte.map((n) => n.uuid).sort(), ['c2', 'd1'], 'due rami percorribili');

  // Il ramo abbandonato resta raggiungibile: e' il punto di tutto il progetto.
  const abbandonato = catenaFinoA(albero, 'd1');
  assert.deepEqual(abbandonato.map((n) => n.uuid), ['a', 'b', 'c1', 'd1']);

  const attivo = catenaFinoA(albero, 'c2');
  assert.deepEqual(attivo.map((n) => n.uuid), ['a', 'b', 'c2']);

  fs.unlinkSync(file);
}

async function testSidechainEsclusi() {
  // Un subagent appende record con parentUuid sul messaggio principale:
  // senza filtro isSidechain risulterebbe una biforcazione inesistente.
  const file = scriviTemporaneo([
    msg('a', null, 'user', 'prompt'),
    msg('b', 'a', 'assistant', 'risposta'),
    msg('sc', 'a', 'user', 'prompt del subagent', { isSidechain: true }),
  ]);

  const albero = await leggiTranscript(file);

  assert.equal(albero.sidechain, 1, 'un record di sidechain contato');
  assert.equal(albero.nodi.size, 2, 'il sidechain non entra nell albero');
  assert.equal(biforcazioni(albero).length, 0, 'nessuna biforcazione falsa');

  fs.unlinkSync(file);
}

async function testRigaCorrotta() {
  // Il file puo' essere letto mentre Claude ci sta scrivendo: l'ultima riga
  // puo' essere troncata e non deve far fallire il parsing.
  const file = path.join(os.tmpdir(), `cb-test-corrotto-${process.pid}.jsonl`);
  fs.writeFileSync(
    file,
    `${JSON.stringify(msg('a', null, 'user', 'ok'))}\n{"type":"user","uuid":"b","par`,
    'utf8',
  );

  const albero = await leggiTranscript(file);
  assert.equal(albero.nodi.size, 1, 'la riga troncata viene saltata');

  fs.unlinkSync(file);
}

async function testRiattivazioneRamoAbbandonato() {
  // Il caso centrale del progetto: d1 sta su un ramo abbandonato, la sessione e'
  // posizionata su c2. Senza riattivazione il CLI risponde "No message found".
  const file = scriviTemporaneo([
    msg('a', null, 'user', 'primo prompt'),
    msg('b', 'a', 'assistant', 'prima risposta'),
    msg('c1', 'b', 'user', 'strada uno'),
    msg('d1', 'c1', 'assistant', 'risposta strada uno'),
    msg('c2', 'b', 'user', 'strada due'),
    { type: 'last-prompt', leafUuid: 'c2', lastPrompt: 'strada due', sessionId: 'sess-test' },
  ]);

  const albero = await leggiTranscript(file);
  assert.equal(nelRamoAttivo(albero, 'c2'), true, 'c2 e nel ramo attivo');
  assert.equal(nelRamoAttivo(albero, 'd1'), false, 'd1 e su un ramo abbandonato');

  // Nodo gia' attivo: nessuna scrittura.
  const dimensionePrima = fs.statSync(file).size;
  assert.equal(attivaRamoDi(file, albero, 'c2'), null, 'nessun intervento se gia attivo');
  assert.equal(fs.statSync(file).size, dimensionePrima, 'file non toccato');

  // Nodo abbandonato: appende un last-prompt sulla foglia del suo ramo.
  const foglia = attivaRamoDi(file, albero, 'c1');
  assert.equal(foglia, 'd1', 'attiva la foglia piu profonda del ramo di c1');

  const dopo = await leggiTranscript(file);
  assert.equal(dopo.leafAttivo, 'd1', 'il ramo abbandonato e ora quello attivo');
  assert.equal(nelRamoAttivo(dopo, 'c1'), true, 'c1 e ora raggiungibile');
  assert.equal(dopo.nodi.size, 5, 'nessun messaggio perso: append puro');
  assert.equal(nelRamoAttivo(dopo, 'c2'), false, 'c2 e ora il ramo in disparte, ma esiste ancora');
  assert.ok(dopo.nodi.has('c2'), 'il ramo precedente resta nel file');

  fs.unlinkSync(file);
}

async function testUnioneRitrovaIlRamoDelPadre() {
  // Il caso reale: forkando, Claude crea un file nuovo che copia la storia solo
  // fino al punto di fork (con gli stessi uuid). Il ramo abbandonato resta nel
  // file di partenza e guardando solo la sessione corrente e' invisibile.
  const filePadre = scriviTemporaneo([
    msg('a', null, 'user', 'ciao'),
    msg('b', 'a', 'assistant', 'risposta'),
    msg('c1', 'b', 'user', 'come va'),
    msg('d1', 'c1', 'assistant', 'bene'),
    { type: 'last-prompt', leafUuid: 'd1', lastPrompt: 'come va', sessionId: 'padre' },
  ]);
  // Il figlio ripete a e b con gli stessi uuid, poi prende un'altra strada.
  const fileFiglio = scriviTemporaneo([
    msg('a', null, 'user', 'ciao'),
    msg('b', 'a', 'assistant', 'risposta'),
    msg('c2', 'b', 'user', 'altra strada'),
    { type: 'last-prompt', leafUuid: 'c2', lastPrompt: 'altra strada', sessionId: 'figlio' },
  ]);

  const padre = await leggiTranscript(filePadre);
  const figlio = await leggiTranscript(fileFiglio);

  // Da sola, la sessione figlia non vede alcuna biforcazione.
  assert.equal(biforcazioni(figlio).length, 0, 'il figlio da solo non ha rami');

  const unito = unisciAlberi([figlio, padre], [fileFiglio, filePadre]);

  assert.equal(unito.nodi.size, 5, 'a e b non vengono duplicati');
  assert.equal(unito.radici.length, 1, 'una sola radice');
  assert.equal(biforcazioni(unito).length, 1, 'la biforcazione riemerge');
  assert.equal(unito.nodi.get('b').figli.length, 2, 'b ha entrambi i rami');
  assert.equal(unito.leafAttivo, 'c2', 'il ramo attivo resta quello della sessione corrente');

  // Le origini dicono da quale sessione ripartire per ogni nodo.
  assert.deepEqual(
    unito.nodi.get('c1').origini.map((o) => o.percorso),
    [filePadre],
    'il ramo abbandonato si riprende dal file del padre',
  );
  assert.deepEqual(
    unito.nodi.get('c2').origini.map((o) => o.percorso),
    [fileFiglio],
    'il ramo attivo dal file corrente',
  );
  assert.equal(unito.nodi.get('a').origini.length, 2, 'i nodi condivisi hanno due origini');

  fs.unlinkSync(filePadre);
  fs.unlinkSync(fileFiglio);
}

async function testTroncaAlTurnoScelto() {
  // Il caso segnalato: scegliendo un punto intermedio la conversazione ripartiva
  // fino alla fine del ramo. --resume-session-at tronca solo in print mode, in
  // interattivo carica tutto: il taglio deve stare nel transcript.
  const file = scriviTemporaneo([
    msg('a', null, 'user', 'ciao'),
    msg('b', 'a', 'assistant', 'ciao a te'),
    msg('c', 'b', 'user', 'cosa fai?'),
    msg('d', 'c', 'assistant', 'sono Claude'),
    msg('e', 'd', 'user', 'test'),
    msg('f', 'e', 'assistant', 'ricevuto'),
    { type: 'last-prompt', leafUuid: 'f', lastPrompt: 'test', sessionId: 'sess-test' },
  ]);

  const albero = await leggiTranscript(file);
  // "cosa fai?" e' nel ramo attivo, ma la catena continua oltre: prima non
  // veniva appeso nulla e non si troncava niente.
  assert.equal(nelRamoAttivo(albero, 'c'), true, 'il nodo scelto e gia raggiungibile');

  const foglia = attivaRamoDi(file, albero, 'c');
  assert.equal(foglia, 'd', 'la catena finisce con la risposta a "cosa fai?", non con "test"');

  const dopo = await leggiTranscript(file);
  const catena = catenaFinoA(dopo, dopo.leafAttivo).map((n) => n.uuid);
  assert.deepEqual(catena, ['a', 'b', 'c', 'd'], 'la conversazione riparte troncata al turno');
  assert.ok(dopo.nodi.has('e'), '"test" resta nel file come ramo in disparte');
  assert.equal(dopo.nodi.size, 6, 'nessun messaggio perso');

  // Scegliendo l'ultimo turno non serve toccare nulla.
  assert.equal(attivaRamoDi(file, dopo, 'c'), null, 'idempotente: la catena finiva gia li');

  fs.unlinkSync(file);
}

const prove = [
  testAlberoConBiforcazione,
  testUnioneRitrovaIlRamoDelPadre,
  testTroncaAlTurnoScelto,
  testSidechainEsclusi,
  testRigaCorrotta,
  testRiattivazioneRamoAbbandonato,
];

for (const prova of prove) {
  await prova();
  console.log(`ok  ${prova.name}`);
}
console.log(`\n${prove.length} prove superate`);
