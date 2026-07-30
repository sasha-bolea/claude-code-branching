// Prove del selettore della cartella di lavoro.
// I colori si spengono prima di importare il modulo: le righe vanno misurate
// nude, altrimenti si conterebbero anche le sequenze ANSI.
process.env.NO_COLOR = '1';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { azioniNavigazione } from './tasti.js';
import {
  annotaCartellaScelta,
  applicaAzione,
  componiRighe,
  disegna,
  figli,
  selezionaCartella,
  statoIniziale,
} from './cartelle.js';

// Albero finto su disco: una home con dentro la radice dei progetti.
//   home/
//     REPOSITORY/
//       alfa/  (con sotto/ e nota.txt)
//       beta/
//     .nascosta/
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-cartelle-'));
const radice = path.join(base, 'REPOSITORY');
const alfa = path.join(radice, 'alfa');
fs.mkdirSync(path.join(alfa, 'sotto'), { recursive: true });
fs.mkdirSync(path.join(radice, 'beta'), { recursive: true });
fs.mkdirSync(path.join(base, '.nascosta'), { recursive: true });
fs.writeFileSync(path.join(alfa, 'nota.txt'), 'x');

const contestoBase = (espansi) => ({ home: base, radice, extra: null, espansi: new Set(espansi) });

// --- figli ---------------------------------------------------------------

{
  const voci = figli(base, { home: base, radice });
  assert.deepEqual(
    voci.map((v) => v.percorso),
    [radice],
    'la home mostra solo la radice dei progetti',
  );
}

{
  const voci = figli(base, { home: base, radice, extra: '/altrove' });
  assert.equal(voci.length, 2, 'la cartella corrente fuori dalla radice compare sotto la home');
  assert.equal(voci[1].percorso, '/altrove');
}

{
  const voci = figli(alfa, { home: base, radice });
  assert.deepEqual(
    voci.map((v) => path.basename(v.percorso)),
    ['sotto', 'nota.txt'],
    'prima le cartelle, poi i file',
  );
  assert.equal(voci[0].cartella, true);
  assert.equal(voci[1].cartella, false);
}

{
  const voci = figli(path.join(base, 'inesistente'), { home: base, radice });
  assert.deepEqual(voci, [], 'una cartella illeggibile si comporta come vuota');
}

// --- componiRighe --------------------------------------------------------

{
  const righe = componiRighe(contestoBase([base, radice]));
  assert.deepEqual(
    righe.map((r) => r.percorso),
    [base, radice, alfa, path.join(radice, 'beta')],
    'con home e radice aperte si vedono i progetti, non il loro contenuto',
  );
  assert.match(righe[2].etichetta, /^ {3}├─ 📁 alfa$/, 'connettore di fratello non ultimo');
  assert.match(righe[3].etichetta, /^ {3}└─ 📁 beta$/, 'connettore di ultimo fratello');
  assert.equal(righe[2].haFigli, true);
  assert.equal(righe[3].haFigli, false, 'beta e\' vuota: non si puo\' espandere');
}

{
  const righe = componiRighe(contestoBase([base, radice, alfa]));
  const dentroAlfa = righe.filter((r) => r.livello === 3).map((r) => r.etichetta);
  assert.equal(dentroAlfa.length, 2, 'alfa aperta mostra i suoi due figli');
  assert.match(
    dentroAlfa[0],
    /^ {3}│ {2}├─ 📁 sotto$/,
    'il ramo di alfa continua sotto i suoi figli',
  );
  assert.match(dentroAlfa[1], /^ {3}│ {2}└─ 📄 nota\.txt$/);
}

// --- statoIniziale -------------------------------------------------------

{
  const stato = statoIniziale({ home: base, radice, cwd: alfa });
  assert.equal(stato.selezione, alfa, 'dentro la radice la selezione cade sulla cwd');
  assert.equal(stato.extra, null);
  assert.ok(stato.espansi.has(radice) && stato.espansi.has(alfa), 'la catena fino alla cwd e\' aperta');
}

{
  const fuori = path.join(base, 'altrove');
  const stato = statoIniziale({ home: base, radice, cwd: fuori });
  assert.equal(stato.extra, fuori, 'una cwd fuori dalla radice compare come voce in piu\'');
  assert.equal(stato.selezione, fuori);
}

{
  const stato = statoIniziale({ home: base, radice, cwd: base });
  assert.equal(stato.extra, null, 'la home non si duplica come voce extra');
  assert.equal(stato.selezione, radice);
}

// --- applicaAzione -------------------------------------------------------

// Stato di prova con home e radice aperte, selezione su alfa (indice 2).
const statoDiProva = (indice = 2) => {
  const contesto = contestoBase([base, radice]);
  return { contesto, righe: componiRighe(contesto), indice, ripresa: false };
};

{
  const stato = statoDiProva();
  assert.equal(applicaAzione(stato, 'giu').esito, 'continua');
  assert.equal(stato.indice, 3);
  applicaAzione(stato, 'giu');
  assert.equal(stato.indice, 0, 'l\'elenco gira: sotto l\'ultimo si torna in cima');
  applicaAzione(stato, 'su');
  assert.equal(stato.indice, 3, 'e sopra il primo si va in fondo');
}

{
  const stato = statoDiProva();
  applicaAzione(stato, 'apri');
  assert.ok(stato.contesto.espansi.has(alfa), 'spazio apre la cartella selezionata');
  assert.equal(stato.righe[stato.indice].percorso, alfa, 'la selezione resta sulla stessa cartella');
  assert.equal(stato.righe.length, 6, 'i due figli di alfa sono comparsi');
  applicaAzione(stato, 'apri');
  assert.equal(stato.righe.length, 4, 'un secondo spazio la richiude');
}

{
  const stato = statoDiProva();
  applicaAzione(stato, 'destra');
  assert.ok(stato.contesto.espansi.has(alfa), 'la freccia destra espande');
  applicaAzione(stato, 'destra');
  assert.equal(
    stato.righe[stato.indice].percorso,
    path.join(alfa, 'sotto'),
    'su una cartella gia\' aperta la freccia destra entra nel primo figlio',
  );
  applicaAzione(stato, 'sinistra');
  assert.equal(
    stato.righe[stato.indice].percorso,
    alfa,
    'da un figlio senza sottocartelle aperte la freccia sinistra risale al genitore',
  );
  applicaAzione(stato, 'sinistra');
  assert.equal(stato.contesto.espansi.has(alfa), false, 'e sul genitore aperto lo richiude');
}

{
  const stato = statoDiProva(3); // beta, senza figli
  applicaAzione(stato, 'destra');
  assert.equal(stato.righe.length, 4, 'una cartella vuota non si espande');
  assert.equal(stato.indice, 3, 'e la selezione non si muove');
}

{
  const stato = statoDiProva();
  applicaAzione(stato, 'modo');
  assert.equal(stato.ripresa, true, '"r" alterna avvio normale e ripresa');
  applicaAzione(stato, 'modo');
  assert.equal(stato.ripresa, false);
}

{
  assert.equal(applicaAzione(statoDiProva(), 'conferma').esito, 'conferma');
  assert.equal(applicaAzione(statoDiProva(), 'annulla').esito, 'annulla');
}

// --- azioniNavigazione ------------------------------------------------------

{
  assert.deepEqual(azioniNavigazione(Buffer.from('\x1b[A\x1b[B')), ['su', 'giu'], 'frecce ANSI');
  assert.deepEqual(azioniNavigazione(Buffer.from('wsad')), ['su', 'giu', 'sinistra', 'destra'], 'wasd');
  assert.deepEqual(azioniNavigazione(Buffer.from(' ')), ['apri']);
  assert.deepEqual(azioniNavigazione(Buffer.from('r')), ['modo']);
  assert.deepEqual(azioniNavigazione(Buffer.from('\r')), ['conferma']);
  assert.deepEqual(azioniNavigazione(Buffer.from('\x1b')), ['annulla']);
  assert.deepEqual(azioniNavigazione(Buffer.from('\x03')), ['annulla'], 'ctrl+c annulla');
}

{
  // win32-input-mode: pressione di "r" (vk 82) e suo rilascio, che non conta.
  assert.deepEqual(azioniNavigazione(Buffer.from('\x1b[82;19;114;1;0;1_')), ['modo']);
  assert.deepEqual(azioniNavigazione(Buffer.from('\x1b[82;19;114;0;0;1_')), [], 'il rilascio si ignora');
  // Invio e freccia su nella stessa lettura: due azioni, non una.
  assert.deepEqual(azioniNavigazione(Buffer.from('\x1b[38;72;0;1;0;1_\x1b[13;28;13;1;0;1_')), [
    'su',
    'conferma',
  ]);
}

{
  // Le coordinate del mouse non devono diventare comandi.
  assert.deepEqual(azioniNavigazione(Buffer.from('\x1b[<35;40;12M')), []);
}

// --- disegna -------------------------------------------------------------

{
  const stato = statoDiProva();
  const pagina = disegna(stato, 12, 60);
  const righe = pagina.replace(/^\x1b\[H\x1b\[2J/, '').split('\r\n');
  assert.equal(righe.length, 12, 'la pagina riempie esattamente lo schermo');
  assert.ok(
    righe.every((r) => r.length <= 60),
    'nessuna riga eccede la larghezza: una piu\' lunga andrebbe a capo e sfaserebbe il disegno',
  );
  assert.match(righe[1], /avvio normale/);
  assert.ok(
    righe.some((r) => r.includes('▸') && r.includes('alfa')),
    'la riga selezionata e\' marcata',
  );
  assert.match(righe[righe.length - 1], /esc annulla/, 'la legenda resta in fondo allo schermo');
}

{
  const stato = { ...statoDiProva(), ripresa: true };
  assert.match(disegna(stato, 12, 60), /ripresa della conversazione/);
}

{
  // Schermo basso: la finestra scorre e tiene dentro la selezione.
  const contesto = contestoBase([base, radice, alfa]);
  const righe = componiRighe(contesto);
  const stato = { contesto, righe, indice: righe.length - 1, ripresa: false };
  const pagina = disegna(stato, 7, 60).replace(/^\x1b\[H\x1b\[2J/, '');
  assert.ok(pagina.includes('▸'), 'la selezione resta visibile anche in fondo all\'elenco');
  assert.equal(pagina.includes('REPOSITORY'), false, 'le righe in cima sono scorse via');
}

// --- ciclo interattivo e hand-off ---------------------------------------

// Terminale finto: basta un emettitore con write/resume/pause. Il selettore non
// tocca altro, e cosi' il ciclo intero e' verificabile senza un TTY.
function terminaleFinto() {
  const ingresso = new EventEmitter();
  ingresso.isTTY = false;
  ingresso.resume = () => {};
  ingresso.pause = () => {};

  const uscita = new EventEmitter();
  uscita.scritto = '';
  uscita.rows = 20;
  uscita.columns = 80;
  uscita.write = (testo) => {
    uscita.scritto += testo;
  };

  return { ingresso, uscita };
}

{
  const { ingresso, uscita } = terminaleFinto();
  const attesa = selezionaCartella({ radice, cwd: alfa, ingresso, uscita });
  ingresso.emit('data', Buffer.from('r')); // passa alla ripresa
  ingresso.emit('data', Buffer.from('\r'));
  const scelta = await attesa;
  assert.deepEqual(scelta, { percorso: alfa, ripresa: true }, 'invio conferma cartella e modo');
  assert.match(uscita.scritto, /\x1b\[\?1049h/, 'la pagina va sullo schermo alternativo');
  assert.match(uscita.scritto, /\x1b\[\?1049l/, 'e all\'uscita il terminale torna com\'era');
}

{
  const { ingresso, uscita } = terminaleFinto();
  const attesa = selezionaCartella({ radice, cwd: alfa, ingresso, uscita });
  ingresso.emit('data', Buffer.from('\x1b'));
  assert.equal(await attesa, null, 'esc annulla la scelta');
}

{
  const { ingresso, uscita } = terminaleFinto();
  const attesa = selezionaCartella({ radice, cwd: alfa, ingresso, uscita });
  // La cwd parte gia' aperta: due "s" scendono su "sotto" e poi su nota.txt.
  ingresso.emit('data', Buffer.from('ss'));
  ingresso.emit('data', Buffer.from('\r'));
  const scelta = await attesa;
  assert.equal(scelta.percorso, alfa, 'scegliendo un file si prende la cartella che lo contiene');
}

{
  const file = path.join(base, 'scelta.txt');
  process.env.CB_CARTELLA_SCELTA = file;
  annotaCartellaScelta(alfa);
  assert.equal(fs.readFileSync(file, 'utf8'), alfa, 'la cartella scelta finisce nel file di hand-off');
  delete process.env.CB_CARTELLA_SCELTA;
  annotaCartellaScelta(radice);
  assert.equal(fs.readFileSync(file, 'utf8'), alfa, 'senza la variabile non scrive niente');
}

fs.rmSync(base, { recursive: true, force: true });
console.log('cartelle.test.js: tutto a posto');
