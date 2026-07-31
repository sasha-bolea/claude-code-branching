import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { leggiStoricoFile, statoAllIstante, ripristinaA, riassumiRipristino } from './codice.js';

// Banco di prova: una cartella con il progetto finto, i due archivi delle copie
// (quello di Claude e quello di cb) e i transcript, tutto sotto una radice
// temporanea che viene rimossa alla fine.
// ritorna: { radice, progetto, archivio, archivioCb, sessioni, pulisci }
function banco(nome) {
  const radice = fs.mkdtempSync(path.join(os.tmpdir(), `cb-codice-${nome}-`));
  const progetto = path.join(radice, 'progetto');
  const archivio = path.join(radice, 'file-history');
  const archivioCb = path.join(radice, 'file-history-cb');
  const sessioni = path.join(radice, 'sessioni');
  fs.mkdirSync(progetto, { recursive: true });
  fs.mkdirSync(archivio, { recursive: true });
  fs.mkdirSync(sessioni, { recursive: true });

  return {
    radice,
    progetto,
    archivio,
    archivioCb,
    sessioni,
    pulisci: () => fs.rmSync(radice, { recursive: true, force: true }),
  };
}

// Scrive una copia nell'archivio di una sessione.
// ritorna: il nome del blob, da mettere nel record
function copia(banco, sessione, nome, contenuto) {
  const cartella = path.join(banco.archivio, sessione);
  fs.mkdirSync(cartella, { recursive: true });
  fs.writeFileSync(path.join(cartella, nome), contenuto, 'utf8');
  return nome;
}

// Record di snapshot: la mappa dei file tracciati a un dato prompt.
// tracciati: { 'percorso relativo': [nomeBlob|null, quando] }
function snapshot(messageId, cartellaReale, tracciati) {
  const backups = {};
  for (const [percorso, [nomeBlob, quando]] of Object.entries(tracciati)) {
    backups[percorso] = {
      backupFileName: nomeBlob,
      version: 1,
      backupTime: quando,
      realParentDir: cartellaReale,
    };
  }
  return { type: 'file-history-snapshot', messageId, snapshot: { messageId, trackedFileBackups: backups } };
}

// Record di delta: una copia fatta a meta' turno.
function delta(messageId, tracciato, cartellaReale, nomeBlob, quando) {
  return {
    type: 'file-history-delta',
    messageId,
    snapshotMessageId: 'snap',
    trackingPath: tracciato,
    backup: { backupFileName: nomeBlob, version: 1, backupTime: quando, realParentDir: cartellaReale },
  };
}

// Scrive un transcript finto e ne restituisce il percorso.
function scriviSessione(banco, sessione, record) {
  const percorso = path.join(banco.sessioni, `${sessione}.jsonl`);
  fs.writeFileSync(percorso, record.map((r) => JSON.stringify(r)).join('\n'), 'utf8');
  return percorso;
}

async function testPrimaCopiaDopoLIstante() {
  const b = banco('prima');
  const file = path.join(b.progetto, 'app.js');
  fs.writeFileSync(file, 'versione di adesso', 'utf8');

  // Tre copie: la piu' vecchia descrive il passato, la prima successiva
  // all'istante scelto e' quella che contiene lo stato di quel momento.
  copia(b, 'sess', 'aaa@v1', 'stato vecchio');
  copia(b, 'sess', 'aaa@v2', 'stato al momento scelto');
  copia(b, 'sess', 'aaa@v3', 'stato successivo');

  const percorso = scriviSessione(b, 'sess', [
    delta('m1', 'app.js', b.progetto, 'aaa@v1', '2026-07-30T10:00:00.000Z'),
    delta('m2', 'app.js', b.progetto, 'aaa@v2', '2026-07-30T12:00:00.000Z'),
    delta('m3', 'app.js', b.progetto, 'aaa@v3', '2026-07-30T14:00:00.000Z'),
  ]);

  const esito = await ripristinaA({
    percorsiSessione: [percorso],
    istante: Date.parse('2026-07-30T11:00:00.000Z'),
    radice: b.progetto,
    archivio: b.archivio,
    archivioCb: b.archivioCb,
  });

  assert.deepEqual(esito.ripristinati, [file], 'il file viene riscritto');
  assert.equal(fs.readFileSync(file, 'utf8'), 'stato al momento scelto', 'con la prima copia successiva');
  b.pulisci();
}

async function testCopiaNullaCancellaIlFile() {
  const b = banco('nulla');
  const file = path.join(b.progetto, 'nato-dopo.js');
  fs.writeFileSync(file, 'contenuto', 'utf8');

  // backupFileName null: a quell'istante il file non esisteva ancora.
  const percorso = scriviSessione(b, 'sess', [
    delta('m1', 'nato-dopo.js', b.progetto, null, '2026-07-30T12:00:00.000Z'),
  ]);

  const esito = await ripristinaA({
    percorsiSessione: [percorso],
    istante: Date.parse('2026-07-30T11:00:00.000Z'),
    radice: b.progetto,
    archivio: b.archivio,
    archivioCb: b.archivioCb,
  });

  assert.deepEqual(esito.cancellati, [file], 'il file viene rimosso');
  assert.equal(fs.existsSync(file), false, 'e non esiste piu sul disco');
  b.pulisci();
}

async function testNessunaCopiaDopoLasciaIlFileComEra() {
  const b = banco('nessuna');
  const file = path.join(b.progetto, 'app.js');
  fs.writeFileSync(file, 'stato corrente', 'utf8');

  const percorso = scriviSessione(b, 'sess', [
    delta('m1', 'app.js', b.progetto, copia(b, 'sess', 'aaa@v1', 'vecchio'), '2026-07-30T10:00:00.000Z'),
  ]);

  const esito = await ripristinaA({
    percorsiSessione: [percorso],
    istante: Date.parse('2026-07-30T18:00:00.000Z'),
    radice: b.progetto,
    archivio: b.archivio,
    archivioCb: b.archivioCb,
  });

  assert.deepEqual(esito.ripristinati, [], 'niente da ripristinare');
  assert.equal(fs.readFileSync(file, 'utf8'), 'stato corrente', 'il file non viene toccato');
  b.pulisci();
}

async function testCopiaScadutaVieneContata() {
  const b = banco('scaduta');
  const file = path.join(b.progetto, 'app.js');
  fs.writeFileSync(file, 'stato corrente', 'utf8');

  // Il record c'e' ma la copia e' stata ripulita: e' il caso dei rami vecchi.
  const percorso = scriviSessione(b, 'sess', [
    delta('m1', 'app.js', b.progetto, 'sparito@v1', '2026-07-30T12:00:00.000Z'),
  ]);

  const esito = await ripristinaA({
    percorsiSessione: [percorso],
    istante: Date.parse('2026-07-30T11:00:00.000Z'),
    radice: b.progetto,
    archivio: b.archivio,
    archivioCb: b.archivioCb,
  });

  assert.deepEqual(esito.mancanti, [file], 'contato fra i non ripristinabili');
  assert.equal(fs.readFileSync(file, 'utf8'), 'stato corrente', 'il file resta comunque intatto');
  assert.match(riassumiRipristino(esito), /copie scadute/, 'il riassunto lo dice');
  b.pulisci();
}

async function testCopiaScadutaRipiegaSuiCommit() {
  // Quando la copia di Claude e' scaduta il file non e' perso: se l'hook dei
  // commit e' installato, il contenuto si prende da li'. E' l'unica strada per
  // ripristinare un ramo piu' vecchio della retention dell'archivio nativo.
  const b = banco('ripiego');
  const file = path.join(b.progetto, 'app.js');
  fs.writeFileSync(file, 'adesso', 'utf8');

  const percorso = scriviSessione(b, 'sess', [
    delta('m1', 'app.js', b.progetto, 'sparito@v1', '2026-07-30T12:00:00.000Z'),
  ]);

  const chiesti = [];
  const esito = await ripristinaA({
    percorsiSessione: [percorso],
    istante: Date.parse('2026-07-30T11:00:00.000Z'),
    radice: b.progetto,
    archivio: b.archivio,
    archivioCb: b.archivioCb,
    ripiego: (chiesto) => {
      chiesti.push(chiesto);
      return Buffer.from('versione dal commit', 'utf8');
    },
  });

  assert.deepEqual(chiesti, [file], 'il ripiego viene interrogato sul file mancante');
  assert.deepEqual(esito.mancanti, [], 'e il file non risulta piu perso');
  assert.deepEqual(esito.ripristinati, [file], 'viene ripristinato');
  assert.equal(fs.readFileSync(file, 'utf8'), 'versione dal commit', 'con il contenuto del commit');

  // Se nemmeno il ripiego ha quel file, resta fra i mancanti come prima.
  fs.writeFileSync(file, 'adesso', 'utf8');
  const senza = await ripristinaA({
    percorsiSessione: [percorso],
    istante: Date.parse('2026-07-30T11:00:00.000Z'),
    radice: b.progetto,
    archivio: b.archivio,
    archivioCb: b.archivioCb,
    ripiego: () => null,
  });
  assert.deepEqual(senza.mancanti, [file], 'senza nemmeno il commit il file resta indietro');
  assert.equal(fs.readFileSync(file, 'utf8'), 'adesso', 'e non viene toccato');

  b.pulisci();
}

async function testFamigliaDiSessioni() {
  const b = banco('famiglia');
  const file = path.join(b.progetto, 'app.js');
  fs.writeFileSync(file, 'adesso', 'utf8');

  // Due sessioni della stessa famiglia con copie omonime e contenuti diversi: le
  // versioni ripartono da v1 in ogni sessione, quindi il nome del blob da solo
  // non basta a identificare una copia.
  copia(b, 'madre', 'aaa@v1', 'copia della madre');
  copia(b, 'ramo', 'aaa@v1', 'copia del ramo');

  const madre = scriviSessione(b, 'madre', [
    delta('m1', 'app.js', b.progetto, 'aaa@v1', '2026-07-30T16:00:00.000Z'),
  ]);
  const ramo = scriviSessione(b, 'ramo', [
    delta('m2', 'app.js', b.progetto, 'aaa@v1', '2026-07-30T12:00:00.000Z'),
  ]);

  const esito = await ripristinaA({
    percorsiSessione: [madre, ramo],
    istante: Date.parse('2026-07-30T11:00:00.000Z'),
    radice: b.progetto,
    archivio: b.archivio,
    archivioCb: b.archivioCb,
  });

  assert.deepEqual(esito.ripristinati, [file], 'un solo file toccato');
  assert.equal(
    fs.readFileSync(file, 'utf8'),
    'copia del ramo',
    'vince la copia piu vicina all istante, presa dall archivio della sua sessione',
  );
  b.pulisci();
}

async function testFuoriDallaCartellaNonSiTocca() {
  const b = banco('fuori');
  const esterno = path.join(b.radice, 'profilo.ps1');
  fs.writeFileSync(esterno, 'profilo di adesso', 'utf8');

  // Nell'archivio finisce ogni file toccato da Claude, anche fuori dal progetto.
  const percorso = scriviSessione(b, 'sess', [
    delta('m1', 'profilo.ps1', b.radice, copia(b, 'sess', 'bbb@v1', 'profilo vecchio'), '2026-07-30T12:00:00.000Z'),
  ]);

  const esito = await ripristinaA({
    percorsiSessione: [percorso],
    istante: Date.parse('2026-07-30T11:00:00.000Z'),
    radice: b.progetto,
    archivio: b.archivio,
    archivioCb: b.archivioCb,
  });

  assert.deepEqual(esito.fuori, [esterno], 'segnalato come fuori dalla cartella');
  assert.equal(fs.readFileSync(esterno, 'utf8'), 'profilo di adesso', 'e lasciato comè');
  b.pulisci();
}

async function testFileGiaInQuelloStato() {
  const b = banco('invariato');
  const file = path.join(b.progetto, 'app.js');
  fs.writeFileSync(file, 'identico', 'utf8');

  const percorso = scriviSessione(b, 'sess', [
    delta('m1', 'app.js', b.progetto, copia(b, 'sess', 'aaa@v1', 'identico'), '2026-07-30T12:00:00.000Z'),
  ]);

  const esito = await ripristinaA({
    percorsiSessione: [percorso],
    istante: Date.parse('2026-07-30T11:00:00.000Z'),
    radice: b.progetto,
    archivio: b.archivio,
    archivioCb: b.archivioCb,
  });

  assert.deepEqual(esito.ripristinati, [], 'non viene riscritto');
  assert.deepEqual(esito.invariati, [file], 'ma risulta fra i file gia in quello stato');
  assert.match(riassumiRipristino(esito), /gia' in quello stato/, 'e il riassunto non promette lavoro fatto');
  b.pulisci();
}

async function testSnapshotEDeltaInsieme() {
  const b = banco('snapshot');
  const sotto = path.join(b.progetto, 'src');
  fs.mkdirSync(sotto, { recursive: true });

  copia(b, 'sess', 'aaa@v2', 'app al momento scelto');
  copia(b, 'sess', 'ccc@v1', 'modulo al momento scelto');

  // Lo snapshot porta la mappa completa, il delta una copia fatta dopo: contano
  // entrambi, e i percorsi arrivano con i separatori di Windows.
  const percorso = scriviSessione(b, 'sess', [
    snapshot('m1', b.progetto, { 'app.js': ['aaa@v2', '2026-07-30T12:00:00.000Z'] }),
    delta('m2', 'src\\modulo.js', sotto, 'ccc@v1', '2026-07-30T13:00:00.000Z'),
  ]);

  const voci = await leggiStoricoFile(percorso, { archivio: b.archivio });
  assert.equal(voci.length, 2, 'snapshot e delta danno una voce ciascuno');

  const stato = statoAllIstante(voci, Date.parse('2026-07-30T11:00:00.000Z'));
  assert.equal(stato.length, 2, 'due file da riportare indietro');

  const esito = await ripristinaA({
    percorsiSessione: [percorso],
    istante: Date.parse('2026-07-30T11:00:00.000Z'),
    radice: b.progetto,
    archivio: b.archivio,
    archivioCb: b.archivioCb,
  });

  assert.equal(esito.ripristinati.length, 2, 'entrambi ripristinati');
  assert.equal(fs.readFileSync(path.join(b.progetto, 'app.js'), 'utf8'), 'app al momento scelto');
  assert.equal(fs.readFileSync(path.join(sotto, 'modulo.js'), 'utf8'), 'modulo al momento scelto');
  b.pulisci();
}

async function testAndataERitornoSuUnFileNuovo() {
  // Il caso reale: un file di test creato in un turno, ripristino a prima —
  // giustamente sparisce — e ripristino a dopo, dove deve tornare.
  //
  // Nell'archivio di Claude quel file ha una sola voce (`null`: non esisteva) e
  // il suo contenuto vive solo sul disco: cancellandolo senza copiarlo lo stato
  // piu' recente sarebbe perso per sempre.
  const b = banco('andata-ritorno');
  const test = path.join(b.progetto, 'prova.test.js');
  fs.writeFileSync(test, 'codice di prova', 'utf8');

  const percorso = scriviSessione(b, 'sess', [
    delta('m1', 'prova.test.js', b.progetto, null, '2026-07-30T12:00:00.000Z'),
  ]);
  const comune = {
    percorsiSessione: [percorso],
    radice: b.progetto,
    archivio: b.archivio,
    archivioCb: b.archivioCb,
  };

  // Indietro, a prima che il file esistesse.
  const indietro = await ripristinaA({
    ...comune,
    istante: Date.parse('2026-07-30T11:00:00.000Z'),
    adesso: Date.parse('2026-07-30T20:00:00.000Z'),
  });
  assert.deepEqual(indietro.cancellati, [test], 'andando indietro il file sparisce');
  assert.equal(fs.existsSync(test), false, 'e non e piu sul disco');

  // Avanti, a dopo che il file era stato creato.
  const avanti = await ripristinaA({
    ...comune,
    istante: Date.parse('2026-07-30T13:00:00.000Z'),
    adesso: Date.parse('2026-07-30T21:00:00.000Z'),
  });
  assert.deepEqual(avanti.ripristinati, [test], 'tornando avanti il file ricompare');
  assert.equal(fs.readFileSync(test, 'utf8'), 'codice di prova', 'con il contenuto che aveva');

  // E si puo' continuare ad andare avanti e indietro quante volte si vuole.
  const diNuovoIndietro = await ripristinaA({
    ...comune,
    istante: Date.parse('2026-07-30T11:00:00.000Z'),
    adesso: Date.parse('2026-07-30T22:00:00.000Z'),
  });
  assert.deepEqual(diNuovoIndietro.cancellati, [test], 'indietro un altra volta');
  assert.equal(fs.existsSync(test), false, 'il file sparisce di nuovo');

  b.pulisci();
}

async function testAndataERitornoSuUnaModifica() {
  // Stessa storia per un file che esisteva gia': indietro alla versione vecchia,
  // avanti a quella nuova, che nell'archivio di Claude non c'e'.
  const b = banco('modifica');
  const file = path.join(b.progetto, 'app.js');
  fs.writeFileSync(file, 'versione nuova', 'utf8');

  const percorso = scriviSessione(b, 'sess', [
    delta('m1', 'app.js', b.progetto, copia(b, 'sess', 'aaa@v1', 'versione vecchia'), '2026-07-30T12:00:00.000Z'),
  ]);
  const comune = {
    percorsiSessione: [percorso],
    radice: b.progetto,
    archivio: b.archivio,
    archivioCb: b.archivioCb,
  };

  await ripristinaA({
    ...comune,
    istante: Date.parse('2026-07-30T11:00:00.000Z'),
    adesso: Date.parse('2026-07-30T20:00:00.000Z'),
  });
  assert.equal(fs.readFileSync(file, 'utf8'), 'versione vecchia', 'indietro alla versione vecchia');

  await ripristinaA({
    ...comune,
    istante: Date.parse('2026-07-30T13:00:00.000Z'),
    adesso: Date.parse('2026-07-30T21:00:00.000Z'),
  });
  assert.equal(fs.readFileSync(file, 'utf8'), 'versione nuova', 'e avanti a quella nuova');

  b.pulisci();
}

async function testSessioniTroncateNonRomponoIlRipristino() {
  // Il caso reale (log del 31 luglio, 14:53:49): a ogni cambio ramo cb crea una
  // sessione troncata che copia i record di file-history dell'origine ma non le
  // copie dei file. La stessa voce compare quindi piu' volte, e quella della
  // sessione troncata punta a una cartella che non esiste. Vincendo lei, il
  // ripristino dichiarava "copie scadute" e non toccava niente.
  const b = banco('troncate');
  const file = path.join(b.progetto, 'app.js');
  fs.writeFileSync(file, 'adesso', 'utf8');

  const record = [
    delta('m1', 'app.js', b.progetto, copia(b, 'origine', 'aaa@v1', 'stato al punto scelto'), '2026-07-30T12:00:00.000Z'),
  ];
  // L'origine ha la copia; le troncate hanno gli stessi record e nessuna copia.
  const origine = scriviSessione(b, 'origine', record);
  const troncataUno = scriviSessione(b, 'troncata-1', record);
  const troncataDue = scriviSessione(b, 'troncata-2', record);

  // Le troncate sono le piu' recenti, quindi arrivano per prime: e' l'ordine in
  // cui la famiglia viene letta davvero.
  const esito = await ripristinaA({
    percorsiSessione: [troncataDue, troncataUno, origine],
    istante: Date.parse('2026-07-30T11:00:00.000Z'),
    radice: b.progetto,
    archivio: b.archivio,
    archivioCb: b.archivioCb,
  });

  assert.deepEqual(esito.mancanti, [], 'nessuna copia dichiarata scaduta');
  assert.deepEqual(esito.ripristinati, [file], 'il file torna indietro');
  assert.equal(fs.readFileSync(file, 'utf8'), 'stato al punto scelto', 'con la copia dell origine');
  b.pulisci();
}

async function testArchivioCbNonInventaFile() {
  // L'archivio di cb e' unico per tutta la macchina: le copie di un'altra
  // conversazione non devono comparire in questa.
  const b = banco('estranei');
  const mio = path.join(b.progetto, 'app.js');
  const altrui = path.join(b.progetto, 'altrui.js');
  fs.writeFileSync(mio, 'adesso', 'utf8');

  fs.mkdirSync(b.archivioCb, { recursive: true });
  fs.writeFileSync(path.join(b.archivioCb, 'zzz@1'), 'roba di un altra conversazione', 'utf8');
  fs.writeFileSync(
    path.join(b.archivioCb, 'indice.jsonl'),
    `${JSON.stringify({ percorso: altrui, nomeBlob: 'zzz@1', tempo: Date.parse('2026-07-30T12:00:00.000Z') })}\n`,
    'utf8',
  );

  const percorso = scriviSessione(b, 'sess', [
    delta('m1', 'app.js', b.progetto, copia(b, 'sess', 'aaa@v1', 'vecchio'), '2026-07-30T12:00:00.000Z'),
  ]);

  const esito = await ripristinaA({
    percorsiSessione: [percorso],
    istante: Date.parse('2026-07-30T11:00:00.000Z'),
    radice: b.progetto,
    archivio: b.archivio,
    archivioCb: b.archivioCb,
  });

  assert.deepEqual(esito.ripristinati, [mio], 'tocca solo i file di questa conversazione');
  assert.equal(fs.existsSync(altrui), false, 'il file di un altra conversazione non viene creato');
  b.pulisci();
}

const prove = [
  testPrimaCopiaDopoLIstante,
  testAndataERitornoSuUnFileNuovo,
  testAndataERitornoSuUnaModifica,
  testSessioniTroncateNonRomponoIlRipristino,
  testArchivioCbNonInventaFile,
  testCopiaNullaCancellaIlFile,
  testNessunaCopiaDopoLasciaIlFileComEra,
  testCopiaScadutaVieneContata,
  testCopiaScadutaRipiegaSuiCommit,
  testFamigliaDiSessioni,
  testFuoriDallaCartellaNonSiTocca,
  testFileGiaInQuelloStato,
  testSnapshotEDeltaInsieme,
];

for (const prova of prove) {
  await prova();
  console.log(`ok  ${prova.name}`);
}
console.log(`\n${prove.length} prove superate`);
