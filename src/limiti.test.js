// I limiti d'uso letti dal file che scrive la statusline.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cartella = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-limiti-'));
process.env.CB_LIMITI = path.join(cartella, 'limiti.json');
process.env.CB_IMPOSTAZIONI = path.join(cartella, 'impostazioni.json');

const { leggiLimiti, limiteEsaurito, istanteReset, attesaFinoAlReset } = await import('./limiti.js');

// Scrive il file come lo scriverebbe la statusline.
function scrivi(dati) {
  fs.writeFileSync(process.env.CB_LIMITI, JSON.stringify(dati), 'utf8');
}

// Senza il file la funzione e' spenta, e spenta vuol dire «non fermare niente»:
// un errore di lettura che bloccasse la coda sarebbe peggio del problema che
// questa funzione risolve.
function testSenzaFileNonSiFermaNiente() {
  fs.rmSync(process.env.CB_LIMITI, { force: true });
  assert.equal(leggiLimiti(), null, 'niente file, niente limiti');
  assert.equal(limiteEsaurito(null), false, 'e senza limiti non si sospende');
  assert.equal(istanteReset(null), null);
  assert.equal(attesaFinoAlReset(null), null);

  // Un file illeggibile vale come assente, non come «fermati».
  fs.writeFileSync(process.env.CB_LIMITI, '{ meta', 'utf8');
  assert.equal(leggiLimiti(), null, 'un json monco non blocca la coda');
}

// La soglia sta sotto il 100 apposta: fra l'ultimo aggiornamento della barra e il
// prompt che parte c'e' un margine, e un turno che comincia al 99% muore a meta'.
function testLaSogliaFermaPrimaDelCento() {
  scrivi({ cinqueOre: { usato: 94, resetIl: 2000000000 } });
  assert.equal(limiteEsaurito(leggiLimiti()), false, 'sotto soglia si continua');

  scrivi({ cinqueOre: { usato: 95, resetIl: 2000000000 } });
  assert.equal(limiteEsaurito(leggiLimiti()), true, 'alla soglia ci si ferma');

  scrivi({ cinqueOre: { usato: 100, resetIl: 2000000000 } });
  assert.equal(limiteEsaurito(leggiLimiti()), true, 'e a serbatoio vuoto pure');

  // Una percentuale che non c'e' non e' uno zero: la statusline la omette finche'
  // non arriva la prima risposta dell'API, e li' non si sa niente.
  scrivi({ cinqueOre: { resetIl: 2000000000 } });
  assert.equal(limiteEsaurito(leggiLimiti()), false, 'senza percentuale non si sospende');
}

// La soglia si sposta, perche' chi ha turni lunghi vuole fermarsi prima.
function testLaSogliaSiCambia() {
  scrivi({ cinqueOre: { usato: 80, resetIl: 2000000000 } });
  assert.equal(limiteEsaurito(leggiLimiti()), false, 'con la soglia normale si continua');

  process.env.CB_SOGLIA_LIMITE = '75';
  assert.equal(limiteEsaurito(leggiLimiti()), true, 'abbassandola ci si ferma prima');
  delete process.env.CB_SOGLIA_LIMITE;
}

// Il CLI da' i secondi, ma campi affini girano in millisecondi: si riconosce dalla
// grandezza invece di fidarsi dell'uno o dell'altro.
function testSecondiEMillisecondi() {
  const adesso = 1_700_000_000_000;

  scrivi({ cinqueOre: { usato: 99, resetIl: 1_700_000_600 } }); // secondi
  assert.equal(istanteReset(leggiLimiti(), adesso), 1_700_000_600_000, 'i secondi diventano millisecondi');

  scrivi({ cinqueOre: { usato: 99, resetIl: 1_700_000_600_000 } }); // gia' millisecondi
  assert.equal(istanteReset(leggiLimiti(), adesso), 1_700_000_600_000, 'i millisecondi restano tali');
}

// Un reset gia' passato vuol dire che il file e' vecchio: non c'e' niente da
// aspettare, e sospendere sarebbe un'attesa che non finisce mai.
function testUnResetGiaPassatoNonFermaLaCoda() {
  const adesso = 1_700_000_000_000;
  scrivi({ cinqueOre: { usato: 99, resetIl: 1_600_000_000 } });
  assert.equal(istanteReset(leggiLimiti(), adesso), null, 'un reset nel passato non vale');
  assert.equal(attesaFinoAlReset(leggiLimiti(), adesso), null, 'e non si aspetta niente');
}

// setTimeout sopra 2^31-1 ms scatta **subito**: il numero va in overflow e diventa
// negativo. Un epoch sbagliato di anni trasformerebbe l'attesa in una sveglia
// immediata, cioe' esattamente il contrario di quello che serve.
function testUnEpochAssurdoNonDiventaUnaSvegliaImmediata() {
  const adesso = 1_700_000_000_000;
  scrivi({ cinqueOre: { usato: 99, resetIl: 4_000_000_000 } }); // anno 2096
  const attesa = attesaFinoAlReset(leggiLimiti(), adesso);
  assert.ok(attesa > 0, 'l attesa resta positiva');
  assert.ok(attesa <= 6 * 60 * 60 * 1000, 'e non supera il tetto delle sei ore');
  assert.ok(attesa < 2 ** 31 - 1, 'quindi setTimeout non va in overflow');
}

const prove = [
  testSenzaFileNonSiFermaNiente,
  testLaSogliaFermaPrimaDelCento,
  testLaSogliaSiCambia,
  testSecondiEMillisecondi,
  testUnResetGiaPassatoNonFermaLaCoda,
  testUnEpochAssurdoNonDiventaUnaSvegliaImmediata,
];

for (const prova of prove) {
  prova();
  console.log(`ok  ${prova.name}`);
}

fs.rmSync(cartella, { recursive: true, force: true });
console.log(`\n${prove.length} prove superate`);
