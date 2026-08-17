// L'ora del reset, letta dal file che scrive la statusline.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cartella = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-limiti-'));
process.env.CB_LIMITI = path.join(cartella, 'limiti.json');

const { leggiLimiti, istanteReset, oraReset, attesaFinoAlReset } = await import('./limiti.js');

// Scrive il file come lo scriverebbe la statusline.
function scrivi(dati) {
  fs.writeFileSync(process.env.CB_LIMITI, JSON.stringify(dati), 'utf8');
}

// Senza il file non si sa niente, e non sapere niente vuol dire non fare niente:
// un errore di lettura che facesse partire un prompt sarebbe peggio del problema
// che questa funzione risolve.
function testSenzaFileNonSiSaNiente() {
  fs.rmSync(process.env.CB_LIMITI, { force: true });
  assert.equal(leggiLimiti(), null, 'niente file, niente limiti');
  assert.equal(istanteReset(null), null);
  assert.equal(oraReset(null), null);
  assert.equal(attesaFinoAlReset(null), null, 'e nessuna sveglia da armare');

  // Un file illeggibile vale come assente.
  fs.writeFileSync(process.env.CB_LIMITI, '{ meta', 'utf8');
  assert.equal(leggiLimiti(), null, 'un json monco non fa partire niente');
}

// Il CLI da' i secondi, ma campi affini girano in millisecondi: si riconosce dalla
// grandezza invece di fidarsi dell'uno o dell'altro.
function testSecondiEMillisecondi() {
  const adesso = 1_700_000_000_000;

  scrivi({ cinqueOre: { resetIl: 1_700_000_600 } }); // secondi
  assert.equal(istanteReset(leggiLimiti(), adesso), 1_700_000_600_000, 'i secondi diventano ms');

  scrivi({ cinqueOre: { resetIl: 1_700_000_600_000 } }); // gia' millisecondi
  assert.equal(istanteReset(leggiLimiti(), adesso), 1_700_000_600_000, 'i ms restano tali');
}

// Un reset gia' passato vuol dire che il file e' vecchio: non c'e' niente da
// aspettare, e armare una sveglia col passato la farebbe scattare subito.
function testUnResetGiaPassatoNonArmaNiente() {
  const adesso = 1_700_000_000_000;
  scrivi({ cinqueOre: { resetIl: 1_600_000_000 } });
  assert.equal(istanteReset(leggiLimiti(), adesso), null, 'un reset nel passato non vale');
  assert.equal(attesaFinoAlReset(leggiLimiti(), adesso), null, 'e non si aspetta niente');
}

// setTimeout sopra 2^31-1 ms scatta **subito**: il numero va in overflow e diventa
// negativo. Un epoch sbagliato di anni farebbe partire il prompt all'istante, cioe'
// esattamente il contrario di quello che serve.
function testUnEpochAssurdoNonFaScattareSubito() {
  const adesso = 1_700_000_000_000;
  scrivi({ cinqueOre: { resetIl: 4_000_000_000 } }); // anno 2096
  const attesa = attesaFinoAlReset(leggiLimiti(), adesso);
  assert.ok(attesa > 0, 'l attesa resta positiva');
  assert.ok(attesa <= 6 * 60 * 60 * 1000, 'e non supera il tetto delle sei ore');
  assert.ok(attesa < 2 ** 31 - 1, 'quindi setTimeout non va in overflow');
}

// L'ora serve al diagnosi.log: «fra 4200s» non si controlla, «alle 17:50» si.
function testLOraSiLeggeAOcchio() {
  const adesso = Date.now();
  const fra90Minuti = adesso + 90 * 60 * 1000;
  scrivi({ cinqueOre: { resetIl: Math.floor(fra90Minuti / 1000) } });

  const atteso = new Date(fra90Minuti);
  const previsto = `${String(atteso.getHours()).padStart(2, '0')}:${String(atteso.getMinutes()).padStart(2, '0')}`;
  assert.equal(oraReset(leggiLimiti(), adesso), previsto, 'ora e minuti nel fuso locale');
  assert.match(oraReset(leggiLimiti(), adesso), /^\d{2}:\d{2}$/, 'sempre due cifre e due cifre');
}

const prove = [
  testSenzaFileNonSiSaNiente,
  testSecondiEMillisecondi,
  testUnResetGiaPassatoNonArmaNiente,
  testUnEpochAssurdoNonFaScattareSubito,
  testLOraSiLeggeAOcchio,
];

for (const prova of prove) {
  prova();
  console.log(`ok  ${prova.name}`);
}

fs.rmSync(cartella, { recursive: true, force: true });
console.log(`\n${prove.length} prove superate`);
