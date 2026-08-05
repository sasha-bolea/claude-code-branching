import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sessioniRidondanti, copieScadute, applicaPiano, puliziaAutomatica } from './pulizia.js';

// Le impostazioni vere non si toccano: la pulizia automatica le legge per sapere
// la soglia, e senza questa riga leggerebbe quelle di chi esegue le prove.
process.env.CB_IMPOSTAZIONI = path.join(os.tmpdir(), 'cb-prove-impostazioni.json');

const GIORNO = 24 * 60 * 60 * 1000;
const ADESSO = Date.now();
const VECCHIO = ADESSO - 30 * GIORNO;
const ANTICO = ADESSO - 90 * GIORNO; // oltre i 60 giorni della pulizia automatica
const SOGLIA = ADESSO - 7 * GIORNO;

// Cartella temporanea per una prova.
function cartellaProva(nome) {
  const percorso = fs.mkdtempSync(path.join(os.tmpdir(), `cb-pulizia-${nome}-`));
  return percorso;
}

// Scrive un transcript finto con gli uuid dati, e gli impone una data.
function scriviSessione(cartella, nome, uuid, mtime) {
  const percorso = path.join(cartella, `${nome}.jsonl`);
  const righe = uuid.map((u) => JSON.stringify({ type: 'user', uuid: u }));
  fs.writeFileSync(percorso, `${righe.join('\n')}\n`, 'utf8');
  fs.utimesSync(percorso, new Date(mtime), new Date(mtime));
  return percorso;
}

const prove = [];
const prova = (nome, fn) => prove.push([nome, fn]);

prova('una sessione contenuta in un altra e ridondante', async () => {
  const radice = cartellaProva('sessioni');
  const progetto = path.join(radice, 'C--tizio-progetto');
  fs.mkdirSync(progetto);

  const intera = scriviSessione(progetto, 'intera', ['a', 'b', 'c'], VECCHIO);
  const troncata = scriviSessione(progetto, 'troncata', ['a', 'b'], VECCHIO);

  const esito = await sessioniRidondanti({ cartellaProgetti: radice, prima: SOGLIA });
  assert.deepEqual(
    esito.map((s) => s.percorso),
    [troncata],
    'va tolta solo la copia, mai la sessione che la contiene',
  );
  assert.ok(fs.existsSync(intera));
});

prova('una sessione proseguita non e piu un sottoinsieme', async () => {
  const radice = cartellaProva('proseguita');
  const progetto = path.join(radice, 'C--tizio-progetto');
  fs.mkdirSync(progetto);

  scriviSessione(progetto, 'intera', ['a', 'b', 'c'], VECCHIO);
  scriviSessione(progetto, 'ripartita', ['a', 'b', 'z'], VECCHIO);

  const esito = await sessioniRidondanti({ cartellaProgetti: radice, prima: SOGLIA });
  assert.deepEqual(esito, [], 'un solo messaggio nuovo basta a salvare il file');
});

prova('due file identici non si cancellano a vicenda', async () => {
  const radice = cartellaProva('gemelle');
  const progetto = path.join(radice, 'C--tizio-progetto');
  fs.mkdirSync(progetto);

  scriviSessione(progetto, 'una', ['a', 'b'], VECCHIO);
  scriviSessione(progetto, 'altra', ['a', 'b'], VECCHIO);

  const esito = await sessioniRidondanti({ cartellaProgetti: radice, prima: SOGLIA });
  assert.deepEqual(esito, [], 'sottoinsieme stretto: identici non conta');
});

prova('le sessioni recenti non si toccano', async () => {
  const radice = cartellaProva('recenti');
  const progetto = path.join(radice, 'C--tizio-progetto');
  fs.mkdirSync(progetto);

  scriviSessione(progetto, 'intera', ['a', 'b', 'c'], ADESSO);
  scriviSessione(progetto, 'troncata', ['a', 'b'], ADESSO);

  const esito = await sessioniRidondanti({ cartellaProgetti: radice, prima: SOGLIA });
  assert.deepEqual(esito, [], 'una sessione viva sta usando i file recenti');
});

prova('le copie vecchie escono dall archivio e dall indice', () => {
  const archivio = cartellaProva('copie');
  const vecchia = 'aaaa@1';
  const nuova = 'bbbb@2';
  fs.writeFileSync(path.join(archivio, vecchia), 'prima', 'utf8');
  fs.writeFileSync(path.join(archivio, nuova), 'dopo', 'utf8');
  fs.utimesSync(path.join(archivio, vecchia), new Date(VECCHIO), new Date(VECCHIO));
  fs.writeFileSync(
    path.join(archivio, 'indice.jsonl'),
    `${JSON.stringify({ percorso: 'x.js', nomeBlob: vecchia, tempo: VECCHIO })}\n` +
      `${JSON.stringify({ percorso: 'y.js', nomeBlob: nuova, tempo: ADESSO })}\n`,
    'utf8',
  );

  const esito = copieScadute({ archivioCb: archivio, prima: SOGLIA });
  assert.deepEqual(esito.blob, [path.join(archivio, vecchia)]);

  applicaPiano({ sessioni: [], copie: esito, ref: [] });
  assert.equal(fs.existsSync(path.join(archivio, vecchia)), false);
  assert.equal(fs.existsSync(path.join(archivio, nuova)), true, 'la copia recente resta');

  const indice = fs.readFileSync(path.join(archivio, 'indice.jsonl'), 'utf8');
  assert.equal(indice.includes(vecchia), false, 'la riga della copia tolta sparisce');
  assert.ok(indice.includes(nuova), 'la riga della copia tenuta resta');
});

prova('una copia orfana e vecchia se ne va, una recente no', () => {
  const archivio = cartellaProva('orfane');
  const orfanaVecchia = path.join(archivio, 'cccc@1');
  const orfanaNuova = path.join(archivio, 'dddd@2');
  fs.writeFileSync(orfanaVecchia, 'avanzo', 'utf8');
  fs.writeFileSync(orfanaNuova, 'appena fatta', 'utf8');
  fs.utimesSync(orfanaVecchia, new Date(VECCHIO), new Date(VECCHIO));

  const esito = copieScadute({ archivioCb: archivio, prima: SOGLIA });
  assert.deepEqual(esito.blob, [orfanaVecchia], 'senza indice contano le date dei file');
  assert.equal(esito.righeTenute, null, 'niente indice, niente riscrittura');
});

prova('l archivio che non esiste non e un errore', () => {
  const esito = copieScadute({ archivioCb: path.join(os.tmpdir(), 'cb-non-esiste'), prima: SOGLIA });
  assert.deepEqual(esito.blob, []);
});

// Prepara una pulizia automatica su cartelle finte: cartella di lavoro fuori da
// un repo (cosi' i ref veri non vengono nemmeno cercati), archivio e progetti
// temporanei, segnale a parte.
function scenarioAutomatico(nome) {
  const radice = cartellaProva(nome);
  const progetti = path.join(radice, 'projects');
  const archivio = path.join(radice, 'file-history');
  fs.mkdirSync(path.join(progetti, 'C--tizio-progetto'), { recursive: true });
  fs.mkdirSync(archivio);

  scriviSessione(path.join(progetti, 'C--tizio-progetto'), 'intera', ['a', 'b', 'c'], ANTICO);
  scriviSessione(path.join(progetti, 'C--tizio-progetto'), 'troncata', ['a', 'b'], ANTICO);

  return {
    cartella: radice,
    cartellaProgetti: progetti,
    archivioCb: archivio,
    segnale: path.join(radice, 'ultima-pulizia'),
    troncata: path.join(progetti, 'C--tizio-progetto', 'troncata.jsonl'),
  };
}

prova('la pulizia automatica toglie e lascia il segnale', async () => {
  const s = scenarioAutomatico('automatica');
  const esito = await puliziaAutomatica({ ...s, adesso: ADESSO });

  assert.equal(esito.sessioni, 1, 'la copia di tre mesi fa se ne va da sola');
  assert.equal(fs.existsSync(s.troncata), false);
  assert.equal(fs.readFileSync(s.segnale, 'utf8'), String(ADESSO));
});

prova('non si ripulisce due volte nello stesso giorno', async () => {
  const s = scenarioAutomatico('unaVoltaAlGiorno');
  fs.writeFileSync(s.segnale, String(ADESSO - 3600 * 1000), 'utf8');

  assert.equal(await puliziaAutomatica({ ...s, adesso: ADESSO }), null);
  assert.ok(fs.existsSync(s.troncata), 'un ora fa e troppo presto per rifarlo');

  // Passato un giorno, si riprova.
  fs.writeFileSync(s.segnale, String(ADESSO - 2 * GIORNO), 'utf8');
  const esito = await puliziaAutomatica({ ...s, adesso: ADESSO });
  assert.equal(esito.sessioni, 1);
});

prova('con giorniPulizia a 0 la pulizia automatica non parte', async () => {
  const s = scenarioAutomatico('spenta');
  process.env.CB_GIORNI_PULIZIA = '0';
  try {
    assert.equal(await puliziaAutomatica({ ...s, adesso: ADESSO }), null);
    assert.ok(fs.existsSync(s.troncata));
    assert.equal(fs.existsSync(s.segnale), false, 'spenta vuol dire che non tocca niente');
  } finally {
    delete process.env.CB_GIORNI_PULIZIA;
  }
});

prova('la soglia automatica e piu larga di due mesi', async () => {
  const s = scenarioAutomatico('soglia');
  const recente = path.join(s.cartellaProgetti, 'C--tizio-progetto');
  // Una copia di 30 giorni fa: il comando a mano (7 giorni) la toglierebbe, la
  // pulizia automatica (60) no.
  fs.rmSync(s.troncata);
  scriviSessione(recente, 'troncata', ['a', 'b'], ADESSO - 30 * GIORNO);

  const esito = await puliziaAutomatica({ ...s, adesso: ADESSO });
  assert.equal(esito.sessioni, 0, 'un mese fa e ancora roba che si puo voler riprendere');
});

let falliti = 0;
for (const [nome, fn] of prove) {
  try {
    await fn();
    console.log(`  ok  ${nome}`);
  } catch (errore) {
    falliti += 1;
    console.error(`  KO  ${nome}\n      ${errore.message}`);
  }
}
if (falliti) process.exit(1);
console.log(`${prove.length} prove superate`);
