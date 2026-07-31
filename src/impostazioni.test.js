// Prove delle impostazioni e della schermata che le raccoglie.
//
// Il file su cui si scrive e' sempre uno temporaneo (CB_IMPOSTAZIONI): queste
// prove non devono toccare le impostazioni vere di chi le esegue.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const TEMP = path.join(os.tmpdir(), 'cb-prova-impostazioni');
process.env.CB_IMPOSTAZIONI = path.join(TEMP, 'impostazioni.json');

const {
  LINGUE,
  SCORCIATOIE,
  impostazione,
  impostazioniPresenti,
  leggiImpostazioni,
  scriviImpostazioni,
} = await import('./impostazioni.js');
const { applicaAzione, disegnaImpostazioni, statoIniziale, configura } = await import(
  './configura.js'
);

// Riporta il file allo stato "mai visto" fra una prova e l'altra.
function pulisci() {
  fs.rmSync(TEMP, { recursive: true, force: true });
  delete process.env.CB_LINGUA;
  delete process.env.CB_TASTO;
  delete process.env.CB_RADICE;
}

function testPrimaVoltaNonCiSonoImpostazioni() {
  pulisci();
  assert.equal(impostazioniPresenti(), false, 'senza file e la prima volta');
  assert.deepEqual(leggiImpostazioni(), {}, 'e non c e niente da leggere');

  scriviImpostazioni({ lingua: 'en', radice: 'C:/lavoro', scorciatoia: 'f2' });
  assert.equal(impostazioniPresenti(), true, 'dopo la schermata il file c e');
  assert.deepEqual(leggiImpostazioni(), {
    lingua: 'en',
    radice: 'C:/lavoro',
    scorciatoia: 'f2',
  });
  console.log('ok  testPrimaVoltaNonCiSonoImpostazioni');
}

// Un file rotto non deve impedire l'avvio: le impostazioni sono una comodita'.
function testFileRottoValeComeAssente() {
  pulisci();
  fs.mkdirSync(TEMP, { recursive: true });
  fs.writeFileSync(process.env.CB_IMPOSTAZIONI, '{ questo non e json', 'utf8');

  assert.deepEqual(leggiImpostazioni(), {}, 'illeggibile = vuoto, non un errore');
  assert.equal(impostazione('lingua', 'it'), 'it', 'e si ripiega sul predefinito');
  console.log('ok  testFileRottoValeComeAssente');
}

// L'ordine che conta: ambiente, poi file, poi predefinito. Se saltasse, tutto
// quello che il README documenta sulle variabili smetterebbe di valere.
function testAmbientePrimaDelFilePrimaDelPredefinito() {
  pulisci();
  assert.equal(impostazione('scorciatoia', 'esc esc'), 'esc esc', 'senza niente, il predefinito');

  scriviImpostazioni({ scorciatoia: 'f2' });
  assert.equal(impostazione('scorciatoia', 'esc esc'), 'f2', 'il file batte il predefinito');

  process.env.CB_TASTO = 'f4';
  assert.equal(impostazione('scorciatoia', 'esc esc'), 'f4', 'e l ambiente batte il file');
  delete process.env.CB_TASTO;
  console.log('ok  testAmbientePrimaDelFilePrimaDelPredefinito');
}

// ctrl+g non deve comparire fra le scelte: era la scorciatoia delle prime
// versioni, abbandonata perche' Claude Code la usa gia'.
function testLeScorciatoieProposteSonoLibere() {
  assert.ok(SCORCIATOIE.length >= 2, 'c e piu di una scelta');
  assert.ok(!SCORCIATOIE.includes('ctrl+g'), 'ctrl+g e preso da Claude Code');
  assert.ok(!SCORCIATOIE.some((s) => s === 'f10' || s === 'f11'), 'f10 e f11 le prende il terminale');
  console.log('ok  testLeScorciatoieProposteSonoLibere');
}

function testFrecceCambianoIlValore() {
  pulisci();
  const stato = statoIniziale();
  const primaLingua = stato.valori.lingua;

  applicaAzione(stato, 'destra'); // riga 0 = lingua
  assert.notEqual(stato.valori.lingua, primaLingua, 'destra cambia lingua');
  applicaAzione(stato, 'sinistra');
  assert.equal(stato.valori.lingua, primaLingua, 'sinistra la riporta indietro');

  // La rosa gira: da capo si torna in fondo.
  applicaAzione(stato, 'sinistra');
  assert.equal(stato.valori.lingua, LINGUE[LINGUE.length - 1], 'la rosa e circolare');
  console.log('ok  testFrecceCambianoIlValore');
}

// Invio agisce sulla riga su cui sei: e' l'unica regola che rende prevedibile
// una schermata dove una voce si sceglie da una rosa e un'altra da un albero.
function testInvioAgisceSullaRiga() {
  pulisci();
  const stato = statoIniziale();

  assert.equal(applicaAzione(stato, 'conferma').esito, 'continua', 'su lingua ruota');

  applicaAzione(stato, 'giu'); // cartella
  assert.equal(applicaAzione(stato, 'conferma').esito, 'cartella', 'apre l albero');

  applicaAzione(stato, 'giu'); // scorciatoia
  const prima = stato.valori.scorciatoia;
  applicaAzione(stato, 'conferma');
  assert.notEqual(stato.valori.scorciatoia, prima, 'sulla scorciatoia ruota');

  applicaAzione(stato, 'giu'); // fatto
  assert.equal(applicaAzione(stato, 'conferma').esito, 'fatto', 'e fatto chiude');
  console.log('ok  testInvioAgisceSullaRiga');
}

// Esc non annulla: tiene quello che si vede. Richiedere la schermata a ogni
// avvio finche' non la si completa sarebbe una molestia.
function testEscTieneQuelloCheSiVede() {
  pulisci();
  const stato = statoIniziale();
  assert.equal(applicaAzione(stato, 'annulla').esito, 'fatto');
  console.log('ok  testEscTieneQuelloCheSiVede');
}

function testLaSchermataDiceTutto() {
  pulisci();
  const stato = statoIniziale();
  const testo = disegnaImpostazioni(stato, 20, 100).join('\n');

  assert.match(testo, /impostazioni|settings/, 'ha un titolo');
  assert.ok(testo.includes(stato.valori.scorciatoia), 'mostra la scorciatoia in vigore');
  assert.match(testo, /esc/, 'la legenda dice come si esce');

  // Nessuna riga puo' eccedere la larghezza: verrebbe mandata a capo dal
  // terminale, e il capo sfasa tutto il disegno sotto.
  const nudo = (r) => r.replace(/\x1b\[[0-9;]*m/g, '');
  for (const riga of disegnaImpostazioni(stato, 20, 40)) {
    assert.ok(nudo(riga).length <= 40, `riga troppo lunga: ${JSON.stringify(nudo(riga))}`);
  }
  console.log('ok  testLaSchermataDiceTutto');
}

// Il ciclo vero, con un terminale finto: alla chiusura le impostazioni devono
// stare sul disco, o al prossimo avvio la schermata tornerebbe.
async function testIlCicloSalvaSuDisco() {
  pulisci();
  const ingresso = new EventEmitter();
  ingresso.resume = () => {};
  ingresso.pause = () => {};
  const uscita = new EventEmitter();
  uscita.write = () => {};
  uscita.rows = 30;
  uscita.columns = 100;

  const attesa = configura({ ingresso, uscita });
  // giu giu giu -> "fatto", poi invio.
  for (const tasto of ['\x1b[B', '\x1b[B', '\x1b[B', '\r']) {
    ingresso.emit('data', Buffer.from(tasto, 'latin1'));
    await new Promise((r) => setTimeout(r, 5));
  }
  const scelte = await attesa;

  assert.equal(impostazioniPresenti(), true, 'il file esiste');
  assert.deepEqual(leggiImpostazioni(), scelte, 'e contiene quello che ha restituito');
  assert.ok(LINGUE.includes(scelte.lingua), 'la lingua e una di quelle previste');
  console.log('ok  testIlCicloSalvaSuDisco');
}

testPrimaVoltaNonCiSonoImpostazioni();
testFileRottoValeComeAssente();
testAmbientePrimaDelFilePrimaDelPredefinito();
testLeScorciatoieProposteSonoLibere();
testFrecceCambianoIlValore();
testInvioAgisceSullaRiga();
testEscTieneQuelloCheSiVede();
testLaSchermataDiceTutto();
await testIlCicloSalvaSuDisco();

pulisci();
console.log('\n9 prove superate');
