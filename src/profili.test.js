// Prove sui profili di variabili d'ambiente.
//
// Il file su cui si legge e' sempre uno temporaneo (CB_IMPOSTAZIONI): senza,
// queste prove leggerebbero i profili veri di chi le esegue, e passerebbero o
// fallirebbero a seconda di come ha configurato cb.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-profili-'));
process.env.CB_IMPOSTAZIONI = path.join(TEMP, 'impostazioni.json');

const { leggiProfili, elencoProfili, ambienteConProfilo, PROFILO_BASE } = await import(
  './profili.js'
);

// Scrive le impostazioni di prova.
function scrivi(dati) {
  fs.writeFileSync(process.env.CB_IMPOSTAZIONI, JSON.stringify(dati), 'utf8');
}

function testSenzaProfiliNonCEniente() {
  scrivi({ lingua: 'it' });
  assert.equal(leggiProfili().size, 0, 'un file senza profili non ne inventa');

  fs.rmSync(process.env.CB_IMPOSTAZIONI, { force: true });
  assert.equal(leggiProfili().size, 0, 'e nemmeno un file che non esiste');
  console.log('ok  testSenzaProfiliNonCEniente');
}

function testProfiliMalfattiVengonoScartati() {
  // Le impostazioni sono una comodita': un file scritto male non deve impedire
  // di lavorare, e nemmeno far sparire i profili buoni che gli stanno accanto.
  scrivi({
    profili: {
      buono: { ANTHROPIC_BASE_URL: 'http://localhost:1' },
      stringa: 'non e un oggetto',
      lista: ['nemmeno'],
      vuoto: null,
    },
  });

  const profili = leggiProfili();
  assert.deepEqual([...profili.keys()], ['buono'], 'resta solo quello fatto bene');

  scrivi({ profili: 'tutto sbagliato' });
  assert.equal(leggiProfili().size, 0, 'un blocco profili non-oggetto vale come assente');
  console.log('ok  testProfiliMalfattiVengonoScartati');
}

function testAmbienteSiRicostruisceDallaPartenza() {
  const partenza = { PATH: '/bin', ANTHROPIC_API_KEY: 'sk-mia' };

  const conGateway = ambienteConProfilo(partenza, {
    ANTHROPIC_BASE_URL: 'http://localhost:20128',
    ANTHROPIC_MODEL: 'un-modello',
  });
  assert.equal(conGateway.ANTHROPIC_BASE_URL, 'http://localhost:20128', 'il profilo aggiunge');
  assert.equal(conGateway.PATH, '/bin', 'e non tocca il resto');
  assert.equal(conGateway.ANTHROPIC_API_KEY, 'sk-mia', 'nemmeno quello che non nomina');

  // Il punto della fotografia: tornando al profilo base le variabili aggiunte
  // spariscono da sole, senza doversi ricordare quali erano.
  const tornato = ambienteConProfilo(partenza, null);
  assert.equal(tornato.ANTHROPIC_BASE_URL, undefined, 'tornando indietro spariscono');
  assert.equal(tornato.ANTHROPIC_API_KEY, 'sk-mia', 'e torna quello di partenza');

  // L'ambiente di partenza non va mutato: ogni chiamata deve poter ripartire da
  // com'era davvero.
  assert.equal(partenza.ANTHROPIC_BASE_URL, undefined, 'la fotografia resta intatta');
  console.log('ok  testAmbienteSiRicostruisceDallaPartenza');
}

function testNullToglieLaVariabile() {
  // Serve quando e' l'ambiente di partenza ad avere qualcosa che il profilo deve
  // togliere: senza, non ci sarebbe modo di tornare all'API vera da una shell
  // che ha gia' ANTHROPIC_BASE_URL impostata.
  const partenza = { ANTHROPIC_BASE_URL: 'http://gateway', ANTHROPIC_API_KEY: 'sk-mia' };

  const diretto = ambienteConProfilo(partenza, { ANTHROPIC_BASE_URL: null });
  assert.equal(diretto.ANTHROPIC_BASE_URL, undefined, 'null toglie la variabile');
  assert.equal(diretto.ANTHROPIC_API_KEY, 'sk-mia', 'le altre restano');

  // Una variabile presente ma vuota non e' la stessa cosa di una assente: certe
  // librerie ci cascano, quindi anche la stringa vuota toglie.
  const vuota = ambienteConProfilo(partenza, { ANTHROPIC_BASE_URL: '' });
  assert.equal(vuota.ANTHROPIC_BASE_URL, undefined, 'e cosi la stringa vuota');
  console.log('ok  testNullToglieLaVariabile');
}

function testElencoMetteIlBasePerPrimo() {
  scrivi({ profili: { gateway: { A: '1' }, lavoro: { B: '2' } } });
  const elenco = elencoProfili(leggiProfili());

  assert.equal(elenco[0], PROFILO_BASE, "l'ambiente di partenza e sempre il primo");
  assert.deepEqual(elenco.slice(1), ['gateway', 'lavoro'], 'poi quelli del file, nel loro ordine');
  console.log('ok  testElencoMetteIlBasePerPrimo');
}

testSenzaProfiliNonCEniente();
testProfiliMalfattiVengonoScartati();
testAmbienteSiRicostruisceDallaPartenza();
testNullToglieLaVariabile();
testElencoMetteIlBasePerPrimo();

fs.rmSync(TEMP, { recursive: true, force: true });
console.log('\n5 prove superate');
