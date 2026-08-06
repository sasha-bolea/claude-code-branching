// Prove del selettore delle conversazioni passate.
// I colori si spengono prima di importare i moduli: le righe si misurano nude.
process.env.NO_COLOR = '1';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import {
  caricaFamiglia,
  disegnaConversazioni,
  esitoScelta,
  raggruppaPerFamiglia,
  selezionaConversazione,
} from './conversazioni.js';

const cartella = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-conversazioni-'));

// Record minimo di messaggio, nella forma dei transcript veri.
function msg(uuid, parentUuid, tipo, testo, sessionId) {
  return {
    type: tipo,
    uuid,
    parentUuid,
    sessionId,
    timestamp: `2026-07-29T10:00:0${uuid.length}.000Z`,
    message: { content: [{ type: 'text', text: testo }] },
  };
}

// Scrive un transcript di sessione nella cartella di prova.
function scriviSessione(sessionId, record) {
  const percorso = path.join(cartella, `${sessionId}.jsonl`);
  fs.writeFileSync(percorso, `${record.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
  return percorso;
}

// Una conversazione in due file, com'e' dopo un fork:
//   madre:  a → b → c1 → d1   (ramo poi lasciato)
//   figlia: a → b → c2        (copia la storia fino a b, stessi uuid)
const madre = scriviSessione('sess-madre', [
  msg('a', null, 'user', 'come si struttura il progetto', 'sess-madre'),
  msg('b', 'a', 'assistant', 'ecco la struttura', 'sess-madre'),
  msg('c1', 'b', 'user', 'strada uno', 'sess-madre'),
  msg('d1', 'c1', 'assistant', 'risposta uno', 'sess-madre'),
  { type: 'last-prompt', leafUuid: 'd1', sessionId: 'sess-madre' },
]);
const figlia = scriviSessione('sess-figlia', [
  msg('a', null, 'user', 'come si struttura il progetto', 'sess-figlia'),
  msg('b', 'a', 'assistant', 'ecco la struttura', 'sess-figlia'),
  msg('c2', 'b', 'user', 'strada due', 'sess-figlia'),
  { type: 'last-prompt', leafUuid: 'c2', sessionId: 'sess-figlia' },
]);
// Una conversazione a se', con un'altra radice.
const sola = scriviSessione('sess-sola', [
  msg('z', null, 'user', 'tutt altra conversazione', 'sess-sola'),
  msg('y', 'z', 'assistant', 'risposta', 'sess-sola'),
]);

// Schede come le produce l'indice, senza passare dalla scansione vera.
const scheda = (percorso, sessionId, radice, extra = {}) => ({
  percorso,
  sessionId,
  radice,
  progetto: 'prova',
  titolo: null,
  primoPrompt: 'come si struttura il progetto',
  ultimoTimestamp: '2026-07-29T10:00:00.000Z',
  messaggi: 4,
  rami: 1,
  ripristini: 0,
  ...extra,
});

// --- raggruppaPerFamiglia ------------------------------------------------

{
  const famiglie = raggruppaPerFamiglia([
    scheda(figlia, 'sess-figlia', 'a', {
      ultimoTimestamp: '2026-07-29T12:00:00.000Z',
      titolo: 'Struttura del progetto',
      messaggi: 3,
      ripristini: 1,
    }),
    scheda(madre, 'sess-madre', 'a', { messaggi: 4 }),
    scheda(sola, 'sess-sola', 'z', {
      ultimoTimestamp: '2026-07-28T09:00:00.000Z',
      primoPrompt: 'tutt altra conversazione',
    }),
  ]);

  assert.equal(famiglie.length, 2, 'i due file dello stesso fork sono una conversazione sola');
  assert.equal(famiglie[0].radice, 'a', 'la conversazione toccata per ultima sta in cima');
  assert.equal(famiglie[0].schede.length, 2);
  assert.equal(famiglie[0].titolo, 'Struttura del progetto', 'il titolo e\' quello aggiornato');
  assert.equal(famiglie[0].messaggi, 4, 'i messaggi sono quelli del file piu' + ' lungo');
  assert.equal(famiglie[0].ripristini, 1, 'i ripristini si sommano su tutta la famiglia');
  assert.equal(
    famiglie[0].schede[0].percorso,
    figlia,
    'la sessione piu\' recente e\' la prima: e\' da li\' che si riprende',
  );
  assert.equal(famiglie[1].titolo, 'tutt altra conversazione', 'senza titolo vale il primo prompt');
}

{
  const famiglie = raggruppaPerFamiglia([scheda(sola, 'sess-sola', null)]);
  assert.equal(famiglie.length, 1, 'una sessione senza radice leggibile resta nell\'elenco');
}

// --- caricaFamiglia ------------------------------------------------------

const famigliaUnita = {
  radice: 'a',
  schede: [scheda(figlia, 'sess-figlia', 'a'), scheda(madre, 'sess-madre', 'a')],
  titolo: 'Struttura del progetto',
  ultimoTimestamp: '2026-07-29T12:00:00.000Z',
  ripristini: 1,
  messaggi: 4,
};

const caricata = await caricaFamiglia(famigliaUnita);

{
  assert.equal(caricata.percorso, figlia, 'si riparte dalla sessione piu\' recente');
  assert.equal(caricata.albero.nodi.size, 5, 'l\'albero unito ha i nodi di tutti e due i file');
  assert.ok(caricata.albero.nodi.has('d1'), 'il ramo lasciato nella sessione madre c\'e\' ancora');
  assert.equal(caricata.alberi.size, 2, 'ogni file conserva il proprio albero');
  assert.ok(caricata.vista.nodi.length >= 3, 'la vista contiene i prompt della conversazione');
}

// --- esitoScelta ---------------------------------------------------------

{
  // c2 e' la fine della sessione figlia: non c'e' niente da tagliare.
  const esito = esitoScelta(caricata, 'c2');
  assert.equal(esito.riprendi, 'sess-figlia', 'la punta della conversazione si riprende com\'e\'');
  assert.equal(esito.voce.uuid, 'c2');
}

{
  // a sta a meta' conversazione: ripartire da li' richiede il taglio.
  const esito = esitoScelta(caricata, 'a');
  assert.equal(esito.riprendi, null, 'un punto a meta\' va tagliato, non ripreso');
  assert.equal(esito.percorso, figlia);
  assert.equal(esito.albero, caricata.albero);
}

{
  // c1 vive solo nella sessione madre, ed e' la fine di quel file (con d1).
  const esito = esitoScelta(caricata, 'c1');
  assert.equal(esito.riprendi, 'sess-madre', 'il ramo lasciato riparte dalla sessione che lo contiene');
}

// --- disegnaConversazioni ------------------------------------------------

const famiglie = raggruppaPerFamiglia([
  scheda(figlia, 'sess-figlia', 'a', { titolo: 'Struttura del progetto', ripristini: 1 }),
  scheda(madre, 'sess-madre', 'a'),
  scheda(sola, 'sess-sola', 'z', {
    ultimoTimestamp: '2026-07-28T09:00:00.000Z',
    primoPrompt: 'tutt altra conversazione',
  }),
]);

{
  const righe = disegnaConversazioni(
    { cartella, famiglie, indice: 0, caricata, selezione: 'c2', modo: 'lista' },
    { colonne: 90, altezza: 20 },
  );

  assert.equal(righe.length, 20, 'la pagina riempie esattamente lo schermo');
  assert.ok(
    righe.every((r) => r.length <= 90),
    'nessuna riga eccede la larghezza: una piu\' lunga sfaserebbe il disegno',
  );
  const testo = righe.join('\n');
  assert.match(testo, /2 conversazioni/, 'l\'intestazione dice quante sono');
  assert.match(testo, /rami: 2/, 'in cima si vede l\'albero unito, con i suoi due rami');
  assert.match(testo, /▸.*Struttura del progetto/, 'la conversazione selezionata e\' marcata');
  assert.match(testo, /tutt altra conversazione/, 'le altre restano nell\'elenco');
  assert.match(righe[righe.length - 1], /invio entra nell'albero/, 'legenda dell\'elenco in fondo');
  assert.equal(righe[righe.length - 2], '', 'con una riga di stacco sopra');
}

{
  // Schermo basso: l'elenco arriva quasi in fondo, e lo stacco dalla legenda
  // deve restare comunque.
  const righe = disegnaConversazioni(
    { cartella, famiglie, indice: 0, caricata, selezione: 'c2', modo: 'lista' },
    { colonne: 90, altezza: 13 },
  );
  assert.equal(righe.length, 13);
  assert.equal(righe[11], '', 'la riga sopra la legenda resta vuota anche stretti');
  assert.match(righe[12], /esc/, 'e la legenda e\' l\'ultima');
}

{
  // Scelta la conversazione, l'elenco sparisce: si vede la stessa schermata
  // dell'overlay dentro la sessione, con il prompt scelto e la sua storia.
  const righe = disegnaConversazioni(
    { cartella, famiglie, indice: 0, caricata, selezione: 'c2', modo: 'albero' },
    { colonne: 90, altezza: 24 },
  );
  const testo = righe.join('\n');

  assert.match(testo, /riparti da qui/, 'il prompt scelto e\' in chiaro');
  assert.match(testo, /strada due/, 'e con il suo testo per intero');
  assert.match(testo, /precedenti:/, 'sotto c\'e\' la storia che quel punto porta con se\'');
  assert.doesNotMatch(testo, /tutt altra conversazione/, 'l\'elenco non si vede piu\'');
  assert.match(righe[righe.length - 1], /esc = (torna all')?elenco/, 'esc riporta all\'elenco');
  assert.ok(
    righe.every((r) => r.length <= 90),
    'anche qui nessuna riga eccede la larghezza',
  );
}

{
  const righe = disegnaConversazioni(
    { cartella, famiglie, indice: 0, caricata: null, selezione: null, modo: 'lista' },
    { colonne: 90, altezza: 20 },
  );
  assert.match(righe.join('\n'), /carico la conversazione/, 'l\'attesa si vede');
}

{
  // Scorrendo l'elenco gli alberi hanno altezze diverse: il separatore e le
  // righe dell'elenco devono restare dove sono, o tutto salta a ogni freccia.
  const solaCaricata = await caricaFamiglia(famiglie[1]);
  assert.notEqual(
    caricata.vista.griglia.length,
    solaCaricata.vista.griglia.length,
    'le due conversazioni hanno alberi di altezza diversa: e il caso che ci interessa',
  );

  const dove = (stato) => {
    const righe = disegnaConversazioni(stato, { colonne: 90, altezza: 20 });
    return {
      separatore: righe.findIndex((r) => r.includes('───')),
      prima: righe.findIndex((r) => r.includes('Struttura del progetto')),
      righe: righe.length,
    };
  };

  const conAlberoAlto = dove({
    cartella,
    famiglie,
    indice: 0,
    caricata,
    selezione: 'c2',
    modo: 'lista',
  });
  const conAlberoBasso = dove({
    cartella,
    famiglie,
    indice: 1,
    caricata: solaCaricata,
    selezione: solaCaricata.vista.nodi[0],
    modo: 'lista',
  });
  const inCaricamento = dove({
    cartella,
    famiglie,
    indice: 1,
    caricata: null,
    selezione: null,
    modo: 'lista',
  });

  assert.deepEqual(conAlberoBasso, conAlberoAlto, 'un albero piu\' corto non alza l\'elenco');
  assert.deepEqual(inCaricamento, conAlberoAlto, 'e nemmeno l\'attesa del caricamento');
}

{
  const righe = disegnaConversazioni(
    { cartella, famiglie: [], indice: 0, caricata: null, selezione: null, modo: 'lista' },
    { colonne: 90, altezza: 20 },
  );
  const testo = righe.join('\n');
  assert.match(testo, /Nessuna conversazione/, 'cartella senza conversazioni');
  assert.doesNotMatch(testo, /carico/, 'e nessun caricamento che non finirebbe mai');
}

// --- ciclo interattivo ---------------------------------------------------

function terminaleFinto() {
  const ingresso = new EventEmitter();
  ingresso.isTTY = false;
  ingresso.resume = () => {};
  ingresso.pause = () => {};

  const uscita = new EventEmitter();
  uscita.scritto = '';
  uscita.rows = 24;
  uscita.columns = 90;
  uscita.write = (testo) => {
    uscita.scritto += testo;
  };

  return { ingresso, uscita };
}

// Attende che il caricamento della conversazione selezionata sia finito: e'
// asincrono, e i tasti mandati prima arriverebbero su uno stato non pronto.
const respiro = () => new Promise((r) => setTimeout(r, 30));

{
  const { ingresso, uscita } = terminaleFinto();
  const attesa = selezionaConversazione({ cartella, famiglie, ingresso, uscita });
  await respiro();

  ingresso.emit('data', Buffer.from('\r')); // entra nell'albero
  ingresso.emit('data', Buffer.from('\r')); // apre il menu del ripristino
  ingresso.emit('data', Buffer.from('\r')); // conferma "conversazione e codice"
  const scelta = await attesa;

  assert.equal(scelta.riprendi, 'sess-figlia', 'confermando la punta si riprende quella sessione');
  assert.equal(scelta.modo, 'entrambi', 'con la voce preselezionata torna indietro anche il codice');
  assert.match(uscita.scritto, /\x1b\[\?1049h/, 'la pagina va sullo schermo alternativo');
  assert.match(uscita.scritto, /\x1b\[\?1049l/, 'e all\'uscita il terminale torna com\'era');
}

{
  const { ingresso, uscita } = terminaleFinto();
  const attesa = selezionaConversazione({ cartella, famiglie, ingresso, uscita });
  await respiro();

  ingresso.emit('data', Buffer.from('\r')); // entra nell'albero
  ingresso.emit('data', Buffer.from('\x1b')); // esce dall'albero: torna all'elenco
  ingresso.emit('data', Buffer.from('\x1b')); // e qui annulla
  assert.equal(await attesa, null, 'esc nell\'albero torna all\'elenco, esc nell\'elenco annulla');
}

{
  const { ingresso, uscita } = terminaleFinto();
  const attesa = selezionaConversazione({ cartella, famiglie, ingresso, uscita });
  await respiro();

  ingresso.emit('data', Buffer.from('\x1b[B')); // seconda conversazione
  await respiro();
  ingresso.emit('data', Buffer.from('\r'));
  ingresso.emit('data', Buffer.from('\r'));
  ingresso.emit('data', Buffer.from('\r'));
  const scelta = await attesa;
  assert.equal(scelta.riprendi, 'sess-sola', 'la freccia giu\' cambia conversazione');
}

{
  // Il menu di cosa riportare indietro: le cifre scelgono una voce direttamente.
  const { ingresso, uscita } = terminaleFinto();
  const attesa = selezionaConversazione({ cartella, famiglie, ingresso, uscita });
  await respiro();

  ingresso.emit('data', Buffer.from('\r')); // entra nell'albero
  ingresso.emit('data', Buffer.from('\r')); // apre il menu
  assert.match(uscita.scritto, /cosa riporto indietro/, 'il menu compare sopra l\'albero');

  ingresso.emit('data', Buffer.from('3')); // solo il codice
  const scelta = await attesa;

  assert.equal(scelta.modo, 'codice', 'la cifra sceglie la voce');
  assert.equal(scelta.riprendi, 'sess-figlia', 'la conversazione riparte dov\'era, senza tagli');
}

{
  // Riprendendo una conversazione da fuori (`cb -r`) la scelta sul prompt si fa
  // lo stesso, ma vale per quella volta: si parte sempre da «resta inviato» e
  // non c'e' la casella che la salva.
  const { ingresso, uscita } = terminaleFinto();
  const attesa = selezionaConversazione({ cartella, famiglie, ingresso, uscita });
  await respiro();

  ingresso.emit('data', Buffer.from('\r')); // entra nell'albero
  ingresso.emit('data', Buffer.from('\r')); // apre il menu

  assert.match(uscita.scritto, /il prompt che hai scelto resta inviato/, 'si parte da inviato');
  assert.doesNotMatch(uscita.scritto, /ricordati questa scelta/, 'e non c e la casella');

  // La freccia cambia davvero lo stato.
  const primaDellaFreccia = uscita.scritto.length;
  ingresso.emit('data', Buffer.from('\x1b[D'));
  assert.match(
    uscita.scritto.slice(primaDellaFreccia),
    /torna nella barra/,
    'la freccia passa all altro stato',
  );

  // `r` invece non deve fare niente: qui non si ricorda.
  const primaDellaErre = uscita.scritto.length;
  ingresso.emit('data', Buffer.from('r'));
  assert.doesNotMatch(
    uscita.scritto.slice(primaDellaErre),
    /ricordati questa scelta/,
    'la casella non si accende con r',
  );

  ingresso.emit('data', Buffer.from('\r')); // conferma la voce preselezionata
  const scelta = await attesa;

  assert.equal(scelta.modo, 'entrambi', 'la voce preselezionata e ancora quella');
  assert.equal(scelta.daRimandare, true, 'e la scelta sul prompt arriva al wrapper');
  assert.equal(scelta.riprendi, null, 'col prompt da rimandare non c e la scorciatoia');
}

{
  // Esc nel menu torna all'albero, non chiude il selettore.
  const { ingresso, uscita } = terminaleFinto();
  const attesa = selezionaConversazione({ cartella, famiglie, ingresso, uscita });
  await respiro();

  ingresso.emit('data', Buffer.from('\r')); // albero
  ingresso.emit('data', Buffer.from('\r')); // menu
  ingresso.emit('data', Buffer.from('\x1b')); // torna all'albero
  ingresso.emit('data', Buffer.from('\x1b')); // torna all'elenco
  ingresso.emit('data', Buffer.from('\x1b')); // annulla
  assert.equal(await attesa, null, 'esc nel menu non salta fuori dal selettore');
}

{
  const { ingresso, uscita } = terminaleFinto();
  const attesa = selezionaConversazione({ cartella, famiglie: [], ingresso, uscita });
  await respiro();
  ingresso.emit('data', Buffer.from('\r'));
  assert.deepEqual(await attesa, { nuova: true }, 'senza conversazioni si parte da zero');
}

fs.rmSync(cartella, { recursive: true, force: true });
console.log('conversazioni.test.js: tutto a posto');
