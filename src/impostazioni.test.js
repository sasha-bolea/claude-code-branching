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
const { applicaAzione, applicaTesto, disegnaImpostazioni, espandiTilde, statoIniziale, configura } =
  await import('./configura.js');

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
  applicaAzione(stato, 'conferma');
  assert.equal(stato.modifica, stato.valori.radice, 'sulla cartella apre il campo di testo');
  applicaTesto(stato, { tipo: 'annulla' });

  applicaAzione(stato, 'giu'); // scorciatoia
  const prima = stato.valori.scorciatoia;
  applicaAzione(stato, 'conferma');
  assert.notEqual(stato.valori.scorciatoia, prima, 'sulla scorciatoia ruota');

  applicaAzione(stato, 'giu'); // fatto
  assert.equal(applicaAzione(stato, 'conferma').esito, 'fatto', 'e fatto chiude');
  console.log('ok  testInvioAgisceSullaRiga');
}

// Il percorso si scrive, non si sceglie da un albero.
function testIlPercorsoSiScrive() {
  pulisci();
  const stato = statoIniziale();
  applicaAzione(stato, 'giu'); // cartella
  applicaAzione(stato, 'conferma');

  // Si parte dal percorso in vigore, cosi' lo si corregge invece di riscriverlo.
  assert.equal(stato.modifica, stato.valori.radice, 'il campo parte da quello di adesso');

  for (const c of 'C:\\lavoro') applicaTesto(stato, { tipo: 'carattere', valore: c });
  assert.ok(stato.modifica.endsWith('C:\\lavoro'), 'i caratteri si accodano');
  assert.ok(stato.modifica.includes('C:'), 'le maiuscole restano maiuscole');

  applicaTesto(stato, { tipo: 'cancella' });
  assert.ok(stato.modifica.endsWith('lavor'), 'backspace toglie l ultimo');

  console.log('ok  testIlPercorsoSiScrive');
}

function testInvioConfermaEscLasciaComEra() {
  pulisci();
  const stato = statoIniziale();
  const prima = stato.valori.radice;

  stato.modifica = 'C:\\altrove';
  applicaTesto(stato, { tipo: 'invio' });
  assert.equal(stato.valori.radice, 'C:\\altrove', 'invio prende quello che si e scritto');
  assert.equal(stato.modifica, null, 'e chiude il campo');

  stato.modifica = 'C:\\mai';
  applicaTesto(stato, { tipo: 'annulla' });
  assert.equal(stato.valori.radice, 'C:\\altrove', 'esc lascia il percorso di prima');
  assert.equal(stato.modifica, null, 'e chiude comunque il campo');

  // Un campo svuotato non e' una scelta.
  stato.modifica = '';
  applicaTesto(stato, { tipo: 'invio' });
  assert.equal(stato.valori.radice, 'C:\\altrove', 'vuoto non cancella la cartella');
  void prima;
  console.log('ok  testInvioConfermaEscLasciaComEra');
}

// Il tasto Invio arriva come `\r\n` su molti terminali: due azioni per una
// pressione sola. La prima chiude il campo, la seconda cadeva su un campo che
// non c'era piu' — 'invio' moriva su null.trim(), 'carattere' scriveva la
// stringa "nullx" dentro il percorso.
function testUnInvioCheArrivaDoppioNonRompeNiente() {
  pulisci();
  const stato = statoIniziale();
  applicaAzione(stato, 'giu'); // cartella
  applicaAzione(stato, 'conferma'); // apre il campo
  stato.modifica = 'C:\\scritto';

  // Le due azioni che azioniTesto produce da un solo Invio.
  applicaTesto(stato, { tipo: 'invio' });
  applicaTesto(stato, { tipo: 'invio' });

  assert.equal(stato.valori.radice, 'C:\\scritto', 'il percorso resta quello scritto');
  assert.equal(stato.modifica, null, 'e il campo resta chiuso');

  // Stessa storia per un carattere arrivato in ritardo.
  applicaTesto(stato, { tipo: 'carattere', valore: 'x' });
  assert.equal(stato.modifica, null, 'a campo chiuso non si scrive');
  assert.equal(stato.valori.radice, 'C:\\scritto', 'e il percorso non si sporca');
  console.log('ok  testUnInvioCheArrivaDoppioNonRompeNiente');
}

// Lo stesso, ma dai byte: e' la prova che coglierebbe il ciclo se smettesse di
// fermarsi alla chiusura del campo.
async function testInvioDoppioDaiByte() {
  pulisci();
  const ingresso = new EventEmitter();
  ingresso.resume = () => {};
  ingresso.pause = () => {};
  const uscita = new EventEmitter();
  uscita.write = () => {};
  uscita.rows = 30;
  uscita.columns = 100;

  const premi = async (testo) => {
    ingresso.emit('data', Buffer.from(testo, 'latin1'));
    await new Promise((r) => setTimeout(r, 5));
  };

  const attesa = configura({ ingresso, uscita });
  await premi('\x1b[B'); // giu -> cartella
  await premi('\r'); // apre il campo
  await premi('\x7f'.repeat(200)); // svuota
  await premi('C:\\Doppio');
  await premi('\r\n'); // UN Invio, due azioni
  await premi('\x1b[B');
  await premi('\x1b[B'); // giu giu -> fatto
  await premi('\r');

  const scelte = await attesa;
  assert.equal(scelte.radice, 'C:\\Doppio', 'il percorso sopravvive all invio doppio');
  console.log('ok  testInvioDoppioDaiByte');
}

// La schermata mostra i percorsi con la tilde, quindi deve accettarli riscritti
// cosi': chi legge `~\Documents` e lo ridigita non deve ottenere una cartella
// chiamata "~".
function testTildeSiEspande() {
  assert.equal(espandiTilde('~'), os.homedir());
  assert.equal(espandiTilde('~/progetti'), path.join(os.homedir(), 'progetti'));
  assert.equal(espandiTilde('~\\progetti'), path.join(os.homedir(), 'progetti'));
  assert.equal(espandiTilde('  C:\\lavoro  '), 'C:\\lavoro', 'e toglie gli spazi ai lati');
  assert.equal(espandiTilde('/opt/~strano'), '/opt/~strano', 'ma solo la tilde iniziale');
  console.log('ok  testTildeSiEspande');
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

function testAvvisoSuEscEsc() {
  // "esc esc" e' anche la scorciatoia di ripristino di Claude, e cb la copre
  // solo se i due Esc arrivano vicini: premendoli piano si apre il menu di
  // Claude, e da fuori sembra che cb non risponda. Va detto dove la si sceglie.
  pulisci();
  const stato = statoIniziale();
  const nudo = (t) => t.replace(/\x1b\[[0-9;]*m/g, '');

  stato.valori.scorciatoia = 'esc esc';
  const conAvviso = nudo(disegnaImpostazioni(stato, 20, 100).join('\n'));
  assert.match(conAvviso, /ripristino di Claude/, 'dice con cosa va a sovrapporsi');
  assert.match(conAvviso, /1s/, "e quanto tempo si ha per il secondo Esc");

  // L'avviso segue il valore, non la riga selezionata: e' una conseguenza della
  // scelta, e vale anche col cursore altrove.
  stato.indice = 0;
  assert.match(
    nudo(disegnaImpostazioni(stato, 20, 100).join('\n')),
    /ripristino di Claude/,
    'e resta visibile anche col cursore su un altra riga',
  );

  // Con un tasto funzione non c'e' niente da avvisare.
  stato.valori.scorciatoia = 'f2';
  assert.doesNotMatch(
    nudo(disegnaImpostazioni(stato, 20, 100).join('\n')),
    /ripristino di Claude/,
    'con f2 l avviso non compare',
  );

  // Nemmeno l'avviso puo' sfondare la larghezza del terminale.
  stato.valori.scorciatoia = 'esc esc';
  for (const larghezza of [100, 60, 40]) {
    for (const riga of disegnaImpostazioni(stato, 20, larghezza)) {
      assert.ok(nudo(riga).length <= larghezza, `riga di ${nudo(riga).length} su ${larghezza}`);
    }
  }
  console.log('ok  testAvvisoSuEscEsc');
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

// La schermata conosce tre voci; nel file ce ne sono altre, che si scrivono solo
// a mano. Salvando l'oggetto intero le cancellava — perdita silenziosa, te ne
// accorgi la volta dopo quando quello che avevi configurato non c'e' piu'.
async function testChiudereNonCancellaLeAltreImpostazioni() {
  pulisci();
  scriviImpostazioni({
    lingua: 'it',
    radice: 'C:\\lavoro',
    scorciatoia: 'f2',
    giorniPulizia: 0,
    promptDaRimandare: true,
    profili: { gateway: { ANTHROPIC_BASE_URL: 'http://localhost:20128' } },
  });

  const ingresso = new EventEmitter();
  ingresso.resume = () => {};
  ingresso.pause = () => {};
  const uscita = new EventEmitter();
  uscita.write = () => {};
  uscita.rows = 30;
  uscita.columns = 100;

  const attesa = configura({ ingresso, uscita });
  for (const tasto of ['\x1b[B', '\x1b[B', '\x1b[B', '\r']) {
    ingresso.emit('data', Buffer.from(tasto, 'latin1'));
    await new Promise((r) => setTimeout(r, 5));
  }
  await attesa;

  const dopo = leggiImpostazioni();
  assert.equal(dopo.giorniPulizia, 0, 'la soglia della pulizia resta');
  assert.equal(dopo.promptDaRimandare, true, 'e la scelta sul prompt');
  assert.deepEqual(
    dopo.profili,
    { gateway: { ANTHROPIC_BASE_URL: 'http://localhost:20128' } },
    'e i profili, che si scrivono solo a mano',
  );
  assert.equal(dopo.scorciatoia, 'f2', 'mentre le tre voci della schermata sono salvate');
  console.log('ok  testChiudereNonCancellaLeAltreImpostazioni');
}

// Il percorso digitato davvero, dai byte fino al file salvato. E' la prova che
// coglie gli errori di collegamento: le prove che chiamano applicaTesto a mano
// confermerebbero anche un ciclo che non chiama mai il tokenizzatore giusto.
async function testSiScriveDavveroDaTastiera() {
  pulisci();
  const ingresso = new EventEmitter();
  ingresso.resume = () => {};
  ingresso.pause = () => {};
  const uscita = new EventEmitter();
  uscita.write = () => {};
  uscita.rows = 30;
  uscita.columns = 100;

  const premi = async (testo) => {
    ingresso.emit('data', Buffer.from(testo, 'latin1'));
    await new Promise((r) => setTimeout(r, 5));
  };

  const attesa = configura({ ingresso, uscita });
  await premi('\x1b[B'); // giu -> cartella
  await premi('\r'); // apre il campo
  await premi('\x7f'.repeat(200)); // svuota quello che c era
  await premi('C:\\Da\\Tastiera'); // "d" e "a" qui sono lettere, non frecce
  await premi('\r'); // conferma il percorso
  await premi('\x1b[B'); // giu -> scorciatoia
  await premi('\x1b[B'); // giu -> fatto
  await premi('\r'); // chiude

  const scelte = await attesa;
  assert.equal(scelte.radice, 'C:\\Da\\Tastiera', 'il percorso e quello digitato');
  assert.equal(leggiImpostazioni().radice, 'C:\\Da\\Tastiera', 'e finisce sul disco');
  console.log('ok  testSiScriveDavveroDaTastiera');
}

testPrimaVoltaNonCiSonoImpostazioni();
testFileRottoValeComeAssente();
testAmbientePrimaDelFilePrimaDelPredefinito();
testLeScorciatoieProposteSonoLibere();
testFrecceCambianoIlValore();
testInvioAgisceSullaRiga();
testIlPercorsoSiScrive();
testInvioConfermaEscLasciaComEra();
testUnInvioCheArrivaDoppioNonRompeNiente();
testTildeSiEspande();
testEscTieneQuelloCheSiVede();
testLaSchermataDiceTutto();
testAvvisoSuEscEsc();
await testIlCicloSalvaSuDisco();
await testChiudereNonCancellaLeAltreImpostazioni();
await testSiScriveDavveroDaTastiera();
await testInvioDoppioDaiByte();

pulisci();
console.log('\n17 prove superate');
