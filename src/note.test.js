// Le prove scrivono su una cartella temporanea: le note di prova non devono
// toccare quelle vere di chi le esegue.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

process.env.CB_NOTE = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-note-'));

const {
  leggiNote,
  scriviNote,
  salvaNota,
  testoDaMandare,
  disegnaNote,
  applicaAzione,
  indiciVisibili,
  statoIniziale,
  apriNote,
  percorsoNote,
} = await import('./note.js');

const CARTELLA = 'C:\\Users\\tizio\\progetti\\web';
const ALTRA = 'C:\\Users\\tizio\\progetti\\api';

// Le note come coppie leggibili, per non confrontare oggetti interi.
const righe = (cartella) => leggiNote(cartella).map((n) => `${n.titolo}|${n.corpo}`);

function testNoteVuoteEQuelleCheNonCiSono() {
  assert.deepEqual(leggiNote(CARTELLA), [], 'una cartella senza file non ha note');
  assert.deepEqual(leggiNote(null), [], 'e senza cartella nemmeno si prova a leggere');

  fs.mkdirSync(process.env.CB_NOTE, { recursive: true });
  fs.writeFileSync(percorsoNote(CARTELLA), '{ questo non e json', 'utf8');
  assert.deepEqual(leggiNote(CARTELLA), [], 'un file illeggibile non e un errore');

  // Il titolo e' facoltativo, il corpo no: una nota senza titolo e' legittima,
  // una col solo titolo e' un'etichetta senza niente sotto e non si tiene.
  fs.writeFileSync(
    percorsoNote(CARTELLA),
    JSON.stringify({
      note: [{ corpo: 'solo corpo' }, { titolo: 'solo titolo' }, { titolo: '', corpo: '' }, 'stringa'],
    }),
    'utf8',
  );
  assert.deepEqual(righe(CARTELLA), ['|solo corpo', '|stringa'], 'senza corpo non e una nota');
}

// Le note stanno alla **cartella**, non alla sessione: e' la ragione per cui
// esistono, e la differenza con la coda dei prompt.
function testLeNoteSonoDellaCartella() {
  scriviNote(CARTELLA, [{ titolo: 'qui', corpo: 'note del web' }]);
  scriviNote(ALTRA, [{ titolo: 'la', corpo: 'note dell api' }]);

  assert.deepEqual(righe(CARTELLA), ['qui|note del web']);
  assert.deepEqual(righe(ALTRA), ['la|note dell api'], 'due cartelle non si mescolano');

  // Il nome del file e' lo slug della cartella, lo stesso che usa Claude per i
  // transcript: l'archivio si legge a occhio.
  assert.match(percorsoNote(CARTELLA), /C--Users-tizio-progetti-web\.json$/);
}

function testSalvaEcancella() {
  scriviNote(CARTELLA, []);
  assert.equal(fs.existsSync(percorsoNote(CARTELLA)), false, 'nessuna nota, nessun file');

  salvaNota(CARTELLA, 0, { titolo: 'prima', corpo: 'corpo uno' });
  salvaNota(CARTELLA, 9, { titolo: 'seconda', corpo: 'corpo due' });
  assert.deepEqual(righe(CARTELLA), ['prima|corpo uno', 'seconda|corpo due'], 'un indice fuori aggiunge');

  salvaNota(CARTELLA, 0, { titolo: 'prima', corpo: 'corpo uno corretto' });
  assert.deepEqual(righe(CARTELLA)[0], 'prima|corpo uno corretto', 'un indice dentro sostituisce');

  // Gli spazi ai bordi si ripuliscono, come nella coda.
  salvaNota(CARTELLA, 9, { titolo: '  spazi  ', corpo: '  intorno  ' });
  assert.equal(righe(CARTELLA)[2], 'spazi|intorno');

  // Svuotare una nota e' il modo di cancellarla: nessun tasto in piu' da imparare.
  salvaNota(CARTELLA, 2, { titolo: '', corpo: '' });
  assert.deepEqual(righe(CARTELLA), ['prima|corpo uno corretto', 'seconda|corpo due'], 'svuotata sparisce');

  // Una nota nuova lasciata vuota non si aggiunge: invio a vuoto non deve
  // riempire l'elenco di righe che non dicono niente.
  salvaNota(CARTELLA, 2, { titolo: '   ', corpo: '' });
  assert.equal(leggiNote(CARTELLA).length, 2, 'la nuova vuota non entra');

  // Il corpo e' obbligatorio: un titolo da solo non diventa una nota.
  salvaNota(CARTELLA, 9, { titolo: 'solo un titolo', corpo: '' });
  assert.equal(leggiNote(CARTELLA).length, 2, 'e nemmeno un titolo da solo');
}

// Il titolo entra nel prompt: e' il contesto della nota, e un corpo scritto per
// stare sotto un titolo, mandato da solo, arriva senza il suo perche'.
function testTestoDaMandare() {
  // Il titolo fa da etichetta alla richiesta, attaccato con i due punti: e'
  // corto, e una riga vuota lo farebbe sembrare una prima frase a se'.
  assert.equal(testoDaMandare({ titolo: 'Porte', corpo: 'liberane una' }), 'Porte: liberane una');
  assert.equal(testoDaMandare({ titolo: '', corpo: 'Solo corpo' }), 'Solo corpo', 'senza titolo');
  assert.equal(testoDaMandare({ titolo: '  Spazi  ', corpo: '  intorno  ' }), 'Spazi: intorno');
  assert.equal(testoDaMandare({ titolo: 'Solo titolo', corpo: '' }), '', 'senza corpo non si manda');
  assert.equal(testoDaMandare({ titolo: '  ', corpo: '  ' }), '', 'niente da mandare');
}

// Il corpo e' obbligatorio, e finche' manca la nota non si salva **e non si
// lascia**: lasciarla andare vorrebbe dire buttare il titolo appena scritto senza
// dirlo, che e' peggio di un invio che sembra non funzionare.
function testSenzaCorpoNonSiSalvaNeSiPerde() {
  scriviNote(CARTELLA, [{ titolo: 'c e gia', corpo: 'questa' }]);
  const stato = statoIniziale(CARTELLA);
  const batti = (tipo, valore) => applicaAzione(stato, { tipo, valore });
  const scrivi = (testo) => [...testo].forEach((c) => batti('carattere', c));

  scrivi('un titolo');
  batti('invio'); // dal titolo al corpo
  batti('invio'); // corpo vuoto: non salva
  assert.equal(leggiNote(CARTELLA).length, 1, 'senza corpo non si salva');
  assert.equal(stato.bozza.titolo, 'un titolo', 'e il titolo non si perde');
  assert.equal(stato.campo, 'corpo', 'si resta nel corpo, che e quello che manca');

  // Nemmeno le frecce la lasciano indietro.
  batti('freccia', 'su');
  assert.equal(stato.bozza.titolo, 'un titolo', 'la freccia non la abbandona');
  assert.equal(stato.indice, 1, 'e il cursore non si muove');

  // Nemmeno ctrl+invio: un titolo da solo non e' una richiesta.
  assert.equal(applicaAzione(stato, { tipo: 'manda' }), null, 'e non si manda');

  // Scritto il corpo, tutto riprende a funzionare.
  scrivi('adesso c e');
  batti('invio');
  assert.deepEqual(righe(CARTELLA), ['c e gia|questa', 'un titolo|adesso c e'], 'ora si salva');

  // Con tutt e due i campi vuoti invece si passa: e' la bozza mai cominciata, e
  // su una nota che esiste e' il modo di cancellarla.
  batti('freccia', 'su');
  assert.equal(stato.indice, 1, 'sulla nota appena scritta');
  assert.equal(stato.campo, 'titolo', 'il cursore parte dal titolo');
  for (let i = 0; i < 40; i += 1) batti('cancella'); // svuota il titolo
  batti('invio'); // giu' nel corpo
  for (let i = 0; i < 40; i += 1) batti('cancella'); // e svuota anche quello
  batti('freccia', 'giu');
  assert.deepEqual(righe(CARTELLA), ['c e gia|questa'], 'svuotata del tutto, sparisce');
}

// Tutta la logica della schermata sta in applicaAzione, quindi si prova senza
// terminale: quale campo ha il cursore, quando una nota si salva, cosa fanno i
// tre invii.
function testIlGiroDeiTreInvii() {
  scriviNote(CARTELLA, []);
  const stato = statoIniziale(CARTELLA);
  const batti = (tipo, valore) => applicaAzione(stato, { tipo, valore });
  const scrivi = (testo) => [...testo].forEach((c) => batti('carattere', c));

  assert.equal(stato.campo, 'titolo', 'si parte dal titolo della nota nuova');
  scrivi('Porte');
  batti('invio');
  assert.equal(stato.campo, 'corpo', 'invio dal titolo porta al corpo');
  assert.deepEqual(leggiNote(CARTELLA), [], 'e non salva ancora niente');

  scrivi('la 4310');
  batti('acapo');
  scrivi('la 4311');
  assert.equal(stato.bozza.corpo, 'la 4310\nla 4311', 'shift+invio va a capo nel corpo');

  batti('invio');
  assert.deepEqual(righe(CARTELLA), ['Porte|la 4310\nla 4311'], 'invio dal corpo salva');
  assert.equal(stato.campo, 'titolo', 'e apre la nota nuova');
  assert.equal(stato.bozza.titolo, '', 'con la bozza pulita');
  assert.equal(stato.indice, 1, 'in fondo all elenco');

  // Backspace cancella nel campo attivo, non la nota.
  scrivi('sbagliatx');
  batti('cancella');
  scrivi('o');
  assert.equal(stato.bozza.titolo, 'sbagliato');
}

// Un testo incollato e' una nota sola, a capo compresi: prima ogni a capo
// arrivava come invio, e incollare tre righe faceva tre note (quando il blocco
// non veniva scartato in blocco dai marcatori del bracketed paste).
//
// Incollando sul titolo — dove il cursore parte sempre — la prima riga fa da
// titolo e il resto scende nel corpo: l'alternativa e' un titolo di dieci righe
// schiacciate su una.
function testIncollareFaUnaNotaSola() {
  scriviNote(CARTELLA, []);
  const stato = statoIniziale(CARTELLA);
  const batti = (tipo, valore) => applicaAzione(stato, { tipo, valore });

  // Quello che incolli resta nel campo in cui stai scrivendo, tutto: spezzarlo
  // fra titolo e corpo vorrebbe dire dividere un testo in due punti che non hai
  // scelto tu. Nel titolo, che e' una riga sola, gli a capo diventano spazi.
  batti('incolla', 'Porte del progetto\nla 4310 e la 4311\nla 4312 e libera');
  assert.equal(
    stato.bozza.titolo,
    'Porte del progetto la 4310 e la 4311 la 4312 e libera',
    'tutto nel titolo, con gli a capo come spazi',
  );
  assert.equal(stato.bozza.corpo, '', 'niente e finito nel corpo');
  assert.equal(stato.campo, 'titolo', 'e il cursore resta dove stavi scrivendo');
  assert.deepEqual(leggiNote(CARTELLA), [], 'niente e stato salvato per conto suo');

  // Nel corpo invece gli a capo restano quelli che sono.
  batti('invio');
  batti('incolla', 'la 4310 e la 4311\nla 4312 e libera');
  assert.equal(stato.bozza.corpo, 'la 4310 e la 4311\nla 4312 e libera', 'nel corpo restano');

  batti('invio');
  assert.deepEqual(
    righe(CARTELLA),
    ['Porte del progetto la 4310 e la 4311 la 4312 e libera|la 4310 e la 4311\nla 4312 e libera'],
    'una nota sola',
  );
}

// Le frecce ← → muovono il cursore dentro al campo, e da li' si scrive e si
// cancella: prima il testo si poteva solo allungare in fondo, e una parola
// sbagliata a meta' di una nota lunga costringeva a cancellare tutto il resto.
// Su e giu' restano il passaggio da una nota all'altra.
function testIlCursoreSiMuoveNelTesto() {
  scriviNote(CARTELLA, []);
  const stato = statoIniziale(CARTELLA);
  const batti = (tipo, valore) => applicaAzione(stato, { tipo, valore });
  const scrivi = (testo) => [...testo].forEach((c) => batti('carattere', c));

  scrivi('Prte');
  assert.equal(stato.cursore, 4, 'scrivendo, il cursore sta in coda');

  // Tre frecce a sinistra e la lettera che mancava, subito dopo la P.
  batti('freccia', 'sinistra');
  batti('freccia', 'sinistra');
  batti('freccia', 'sinistra');
  assert.equal(stato.cursore, 1);
  scrivi('o');
  assert.equal(stato.bozza.titolo, 'Porte', 'la lettera entra dove sta il cursore');
  assert.equal(stato.cursore, 2, 'che si sposta di uno');

  // In testa la freccia si ferma, e il backspace non ha niente da togliere.
  batti('freccia', 'sinistra');
  batti('freccia', 'sinistra');
  batti('freccia', 'sinistra');
  batti('freccia', 'sinistra');
  assert.equal(stato.cursore, 0, 'il cursore si ferma in testa');
  batti('cancella');
  assert.equal(stato.bozza.titolo, 'Porte', 'e li backspace non mangia niente');

  // Scendendo al corpo il cursore ci arriva in fondo a quello che c'e' gia'.
  batti('freccia', 'destra');
  batti('invio');
  assert.equal(stato.campo, 'corpo');
  assert.equal(stato.cursore, 0, 'corpo vuoto: il cursore e in testa');
  scrivi('la 4310');
  batti('freccia', 'sinistra');
  batti('freccia', 'sinistra');
  scrivi('0');
  assert.equal(stato.bozza.corpo, 'la 43010', 'anche nel corpo si scrive dove sta il cursore');

  // Salvata e riaperta, il cursore torna in fondo al titolo: la si riapre per
  // continuarla, non per riscriverla da capo.
  batti('invio');
  batti('freccia', 'su');
  assert.equal(stato.campo, 'titolo');
  assert.equal(stato.cursore, [...stato.bozza.titolo].length, 'in fondo al titolo');
}

// Un titolo piu' largo del riquadro scorre invece di uscirne.
//
// Uscendo veniva mandato a capo dal terminale, e quel capo sfasava tutto il
// disegno sotto: il riquadro si apriva e non si chiudeva piu' (visto su una
// nota vera, con un titolo incollato lungo due righe).
function testUnTitoloLungoRestaDentroAlRiquadro() {
  scriviNote(CARTELLA, []);
  const lungo = 'si deve poter incollare un testo lungo nel titolo, molto piu largo del riquadro che lo contiene, senza che ne esca';
  const stato = statoIniziale(CARTELLA);
  stato.bozza = { titolo: lungo, corpo: 'un corpo qualunque' };
  stato.campo = 'titolo';

  // Il cursore in fondo, a meta' e in testa: sono i tre casi in cui la finestra
  // si sposta, e in tutti il bordo destro deve restare dov'e'.
  for (const cursore of [lungo.length, 40, 0]) {
    stato.cursore = cursore;
    const righe = disegnaNote(stato, { colonne: 100, altezza: 16 });
    const box = righe.filter((r) => r.includes('│'));
    assert.ok(box.length >= 3, `cursore ${cursore}: il riquadro c e`);
    assert.equal(
      new Set(box.map((r) => r.length)).size,
      1,
      `cursore ${cursore}: il bordo destro sta su una colonna sola`,
    );
    assert.ok(
      righe.every((r) => r.length <= 100),
      `cursore ${cursore}: nessuna riga eccede il terminale`,
    );
    // Il cursore si vede sempre: tagliato via, si scriverebbe alla cieca.
    assert.ok(righe.join('\n').includes('█'), `cursore ${cursore}: il cursore resta visibile`);
  }

  // Il taglio si dichiara con i puntini invece di far sparire il testo in
  // silenzio: un titolo troncato zitto si legge come un titolo intero.
  stato.cursore = lungo.length;
  assert.match(disegnaNote(stato, { colonne: 100, altezza: 16 }).join('\n'), /…/, 'e si dice');

  // Un carattere di controllo rimasto nel titolo non manda a capo il terminale:
  // un \r riporterebbe il cursore a inizio riga e il disegno si riscriverebbe
  // sopra se stesso, che e' il modo in cui il riquadro si e' rotto davvero.
  // Normalizzarlo all'ingresso non basta come garanzia: qui c'e' la rete.
  stato.bozza = { titolo: 'prima\rdopo e ancora', corpo: 'un corpo' };
  stato.cursore = 3;
  const conControlli = disegnaNote(stato, { colonne: 100, altezza: 16 });
  assert.ok(
    conControlli.every((r) => !/[\u0000-\u0008\u000b-\u001f]/.test(r.replace(/\u001b\[[0-9;]*m/g, ''))),
    'niente caratteri di controllo a schermo',
  );
  const bordi = conControlli.filter((r) => r.includes('│'));
  assert.equal(new Set(bordi.map((r) => r.length)).size, 1, 'e il riquadro resta dritto');
}

function testLeFrecceSalvanoEsiSpostano() {
  scriviNote(CARTELLA, [{ titolo: 'una', corpo: 'prima' }, { titolo: 'due', corpo: 'seconda' }]);
  const stato = statoIniziale(CARTELLA);
  const batti = (tipo, valore) => applicaAzione(stato, { tipo, valore });

  assert.equal(stato.indice, 2, 'si apre sulla nota nuova');

  // Scrivendo qualcosa e poi salendo, quello che si e' scritto non si perde:
  // perderlo per una freccia sarebbe la cosa piu' sgradevole possibile. Il corpo
  // ci vuole, o la nota non e' salvabile (vedi testSenzaCorpoNonSiSalvaNeSiPerde).
  stato.campo = 'corpo';
  applicaAzione(stato, { tipo: 'carattere', valore: 'x' });
  batti('freccia', 'su');
  assert.equal(righe(CARTELLA).length, 3, 'la bozza e stata salvata');
  assert.equal(stato.bozza.corpo, 'seconda', 'e il cursore e su una nota che esiste');
  // Sempre sul titolo: e' l'unico dei due campi da cui si raggiunge l'altro.
  assert.equal(stato.campo, 'titolo', 'con il cursore nel titolo');

  batti('freccia', 'su');
  assert.equal(stato.bozza.corpo, 'prima');
  batti('freccia', 'su');
  assert.equal(stato.indice, 0, 'in cima non si sale oltre');

  // Modificare una nota che esiste e confermare non ne aggiunge una: si
  // sostituisce. Un invio per scendere dal titolo al corpo, poi si scrive.
  batti('invio');
  applicaAzione(stato, { tipo: 'carattere', valore: '!' });
  batti('invio');
  assert.deepEqual(righe(CARTELLA)[0], 'una|prima!', 'la nota e stata modificata');
  assert.equal(righe(CARTELLA).length, 3, 'e non se ne e aggiunta una');

  // Destra e sinistra non muovono niente: l'elenco e verticale.
  const prima = stato.indice;
  batti('freccia', 'destra');
  assert.equal(stato.indice, prima);
}

function testMandaESce() {
  scriviNote(CARTELLA, []);
  const stato = statoIniziale(CARTELLA);
  stato.bozza = { titolo: 'Chiedi', corpo: 'aggiorna il README' };

  const esito = applicaAzione(stato, { tipo: 'manda' });
  assert.deepEqual(esito, { manda: 'Chiedi: aggiorna il README' }, 'ctrl+invio consegna titolo e corpo');
  // Mandata, la nota ha fatto il suo lavoro: se ne va. Il testo non si perde —
  // diventa un prompt, quindi un nodo dell'albero.
  assert.deepEqual(leggiNote(CARTELLA), [], 'la nota nuova mandata non si accumula');

  // E vale anche per una nota che era gia' in elenco.
  scriviNote(CARTELLA, [
    { titolo: 'resta', corpo: 'questa no' },
    { titolo: 'Chiedi', corpo: 'da mandare' },
  ]);
  const seconda = statoIniziale(CARTELLA);
  applicaAzione(seconda, { tipo: 'freccia', valore: 'su' }); // sulla seconda
  assert.deepEqual(applicaAzione(seconda, { tipo: 'manda' }), { manda: 'Chiedi: da mandare' });
  assert.deepEqual(righe(CARTELLA), ['resta|questa no'], 'mandata, sparisce dall elenco');

  // A nota vuota non c'e' niente da mandare, e non e' un errore.
  const vuoto = statoIniziale(CARTELLA);
  assert.equal(applicaAzione(vuoto, { tipo: 'manda' }), null);
  assert.deepEqual(righe(CARTELLA), ['resta|questa no'], 'e non tocca le altre');

  assert.equal(applicaAzione(vuoto, { tipo: 'annulla' }), 'indietro', 'esc risale di un passo');
  assert.equal(applicaAzione(vuoto, { tipo: 'esci' }), 'esci', 'canc esce da tutto');
}

function testDisegno() {
  scriviNote(CARTELLA, []);
  const stato = statoIniziale(CARTELLA);
  stato.note = [{ titolo: 'Porte', corpo: 'la 4310 e presa' }, { titolo: '', corpo: 'senza titolo' }];
  stato.indice = 2;
  stato.bozza = { titolo: 'Nuova', corpo: 'riga uno\nriga due' };
  stato.campo = 'corpo';
  // Il cursore sta dove lo stato dice, non per forza in fondo: da quando le
  // frecce lo muovono, la schermata deve disegnarlo nel punto in cui la
  // prossima lettera andra' davvero a finire. Qui lo si mette in fondo, che e'
  // il caso di chi sta scrivendo.
  stato.cursore = stato.bozza.corpo.length;

  const disegno = disegnaNote(stato, { colonne: 90, altezza: 26 });
  const testo = disegno.join('\n');

  assert.equal(disegno.length, 26, 'la schermata riempie lo schermo esatto');
  assert.match(testo, /2 note/, 'dice quante sono');
  assert.match(testo, /di C:\\Users\\tizio\\progetti\\web/, 'e di quale cartella');
  assert.match(testo, /Porte/);
  assert.match(testo, /senza titolo/);
  // Il separatore sta sopra ogni nota, compresa la prima: e' quello che apre
  // l'elenco.
  assert.match(disegno[5], /^ +─+$/, 'il separatore apre l elenco');
  assert.equal(
    disegno.filter((r) => /^ +─+$/.test(r)).length,
    4,
    'uno per nota, uno per il riquadro, e quello sopra la legenda',
  );
  // La nota su cui si scrive sta in un riquadro, come il prompt scelto
  // nell'albero e come la barra di stato di Claude Code.
  assert.match(testo, /╭─+╮/, 'il riquadro e attorno a quella attiva');
  assert.match(testo, /│ riga due█/, 'con il cursore nel campo attivo');
  // La legenda sta in fondo, e qui i tasti sono tanti: se non ci stanno su una
  // riga si spezza su due invece di perderne. Ogni tasto della schermata
  // compare, o sarebbe un tasto che non sai di avere.
  const barra = `${disegno[24]}${disegno[25]}`;
  for (const tasto of ['invio', 'shift+invio', '←→', 'ctrl+invio', 'ctrl+f', 'ctrl+canc', 'f1', 'esc', 'canc']) {
    assert.ok(barra.includes(tasto), `la legenda nomina ${tasto}`);
  }
  assert.match(disegno[23], /^ +─+$/, 'col separatore sopra a tutt e due');

  // Con il cursore su una nota di prima, il posto della nota nuova resta
  // annunciato in fondo: senza, l'elenco sembrerebbe finire con l'ultima nota.
  stato.indice = 0;
  stato.bozza = { titolo: 'Porte', corpo: 'la 4310 e presa' };
  const suUnaVecchia = disegnaNote(stato, { colonne: 90, altezza: 26 });
  assert.match(suUnaVecchia.join('\n'), /nota nuova/, 'il posto della nota nuova si vede');
  // L'ultima riga piena **prima** del separatore che chiude la pagina: si conta
  // da li' e non dal fondo, perche' la legenda puo' essere alta una riga o due.
  const chiusura = suUnaVecchia.findLastIndex((r) => /^ +─+$/.test(r));
  const ultimaPiena = suUnaVecchia
    .slice(0, chiusura)
    .filter((r) => r.trim() !== '')
    .at(-1);
  assert.match(ultimaPiena, /nota nuova/, 'ed e in fondo all elenco');

  // I campi vuoti si annunciano, o non si saprebbe cosa scrivere. Solo il titolo
  // si dichiara facoltativo: e' quello che si puo' saltare, e dirlo anche
  // sull'altro sarebbe la stessa cosa scritta al contrario.
  const nuova = disegnaNote(statoIniziale(CARTELLA), { colonne: 90, altezza: 20 }).join('\n');
  assert.match(nuova, /titolo \(facoltativo\)/);
  assert.match(nuova, /^ +│ corpo +│$/m, 'il corpo si annuncia e basta');
  assert.match(nuova, /nessuna nota/, 'e a elenco vuoto lo dice');

  // Nessuna riga puo' eccedere la larghezza: una piu' lunga andrebbe a capo, e
  // il capo sfasa tutto il disegno sotto.
  stato.bozza.corpo = 'una nota molto piu lunga di quanto lo schermo sia largo, e va a capo';
  for (const riga of disegnaNote(stato, { colonne: 40, altezza: 14 })) {
    assert.ok(riga.length <= 40, `riga lunga ${riga.length}: ${riga}`);
  }
}

// Con qualche nota in archivio il riquadro non deve finire sotto il bordo dello
// schermo: si scriverebbe alla cieca. Lo scorrimento si ancora al riquadro, non
// all'inizio dell'elenco.
function testIlRiquadroRestaSempreVisibile() {
  scriviNote(CARTELLA, []);
  const stato = statoIniziale(CARTELLA);
  stato.note = Array.from({ length: 12 }, (_, i) => ({
    titolo: `nota ${i + 1}`,
    corpo: `corpo della nota ${i + 1}`,
  }));

  // Sulla nota nuova, in fondo: e' il caso in cui il riquadro e' piu' lontano
  // dall'inizio dell'elenco.
  stato.indice = 12;
  stato.bozza = { titolo: 'sto scrivendo', corpo: 'qui' };
  const inFondo = disegnaNote(stato, { colonne: 90, altezza: 20 });
  assert.equal(inFondo.length, 20, 'la schermata riempie lo schermo esatto');
  assert.match(inFondo.join('\n'), /sto scrivendo/, 'il riquadro si vede');
  assert.match(inFondo.join('\n'), /╰─+╯/, 'compreso il bordo di sotto');
  assert.match(inFondo.join('\n'), /altre \d+ righe/, 'e si dice quante restano fuori');

  // Salendo su una nota di mezzo il riquadro si vede lo stesso.
  stato.indice = 5;
  stato.bozza = { titolo: 'quella di mezzo', corpo: 'modificata' };
  const inMezzo = disegnaNote(stato, { colonne: 90, altezza: 20 }).join('\n');
  assert.match(inMezzo, /quella di mezzo/, 'il riquadro si vede anche a meta elenco');
  assert.match(inMezzo, /╰─+╯/, 'con il suo bordo');

  // Anche su uno schermo molto basso, dove ci sta poco piu' del riquadro.
  const basso = disegnaNote(stato, { colonne: 90, altezza: 12 }).join('\n');
  assert.match(basso, /quella di mezzo/, 'e su uno schermo basso');
}

// Cancellare piu' note in una volta: si segnano con ctrl+spazio e si tolgono con
// ctrl+canc. Senza niente di segnato, ctrl+canc toglie quella sotto il cursore —
// cosi' segnare non e' obbligatorio per cancellarne una sola.
function testCancellazioneMultipla() {
  const cinque = () =>
    scriviNote(
      CARTELLA,
      Array.from({ length: 5 }, (_, i) => ({ titolo: `n${i + 1}`, corpo: `corpo ${i + 1}` })),
    );

  cinque();
  const stato = statoIniziale(CARTELLA);
  const batti = (tipo, valore) => applicaAzione(stato, { tipo, valore });
  const vaiSu = (n) => {
    for (let i = 0; i < n; i += 1) batti('freccia', 'su');
  };

  // Senza segni, ctrl+canc toglie quella sotto il cursore.
  vaiSu(1); // sull ultima (indice 4)
  assert.equal(stato.indice, 4);
  batti('togli');
  assert.deepEqual(
    righe(CARTELLA).map((r) => r.split('|')[0]),
    ['n1', 'n2', 'n3', 'n4'],
    'senza segni toglie quella corrente',
  );

  // Segnandone piu' d'una, ctrl+canc le toglie tutte insieme.
  cinque();
  const secondo = statoIniziale(CARTELLA);
  const battiB = (tipo, valore) => applicaAzione(secondo, { tipo, valore });
  const suB = (n) => {
    for (let i = 0; i < n; i += 1) battiB('freccia', 'su');
  };

  suB(5); // in cima (indice 0)
  battiB('segna');
  battiB('freccia', 'giu');
  battiB('freccia', 'giu');
  battiB('segna'); // indice 2
  battiB('freccia', 'giu');
  battiB('freccia', 'giu');
  battiB('segna'); // indice 4
  assert.equal(secondo.segnate.size, 3, 'tre segnate');

  battiB('togli');
  assert.deepEqual(
    righe(CARTELLA).map((r) => r.split('|')[0]),
    ['n2', 'n4'],
    'toglie tutte quelle segnate, non solo la prima',
  );
  assert.equal(secondo.segnate.size, 0, 'e i segni si azzerano');

  // Ripremendo ctrl+spazio il segno si toglie.
  cinque();
  const terzo = statoIniziale(CARTELLA);
  const battiC = (tipo, valore) => applicaAzione(terzo, { tipo, valore });
  battiC('freccia', 'su');
  battiC('segna');
  assert.equal(terzo.segnate.size, 1);
  battiC('segna');
  assert.equal(terzo.segnate.size, 0, 'il segno si toglie ripremendo');

  // La nota nuova non si segna: non esiste ancora.
  battiC('freccia', 'giu'); // giu' dall ultima si torna alla nota nuova
  assert.equal(terzo.indice, 5, 'sulla nota nuova');
  battiC('segna');
  assert.equal(terzo.segnate.size, 0, 'la nota nuova non si segna');
  // E ctrl+canc li' non toglie niente, invece di togliere l ultima per sbaglio.
  battiC('togli');
  assert.equal(leggiNote(CARTELLA).length, 5, 'e non cancella niente');

  // Il marchio sta dentro il rientro, non prima: segnare non sposta il testo di
  // lato, o le note segnate e quelle no non sarebbero piu' incolonnate.
  // Il cursore va spostato dopo aver segnato: la nota su cui sta si disegna nel
  // riquadro, non nell'elenco, e il marchio non si vedrebbe.
  const conSegno = statoIniziale(CARTELLA);
  applicaAzione(conSegno, { tipo: 'freccia', valore: 'su' });
  applicaAzione(conSegno, { tipo: 'segna' });
  applicaAzione(conSegno, { tipo: 'freccia', valore: 'su' });
  const disegno = disegnaNote(conSegno, { colonne: 90, altezza: 30 });
  const rigaSegnata = disegno.find((r) => r.includes('✗'));
  assert.match(rigaSegnata, /^ {2}✗ \S/, 'il marchio sta nel rientro di quattro colonne');

  // I segni sono indici: se l elenco cambia lunghezza si azzerano, o starebbero
  // su note diverse da quelle scelte.
  battiC('freccia', 'su');
  battiC('segna');
  assert.equal(terzo.segnate.size, 1);
  terzo.bozza = { titolo: '', corpo: '' }; // svuotata: sparisce, e gli indici scalano
  battiC('freccia', 'su');
  assert.equal(terzo.segnate.size, 0, 'cambiando il numero di note i segni si azzerano');
}

// La ricerca filtra su titolo **e** corpo: non si sa in quale dei due sta la
// parola che ti e' venuta in mente.
function testLaRicerca() {
  scriviNote(CARTELLA, [
    { titolo: 'Porte', corpo: 'la 4310 e presa' },
    { titolo: 'Deploy', corpo: 'ricordati il passo delle migrazioni' },
    { titolo: 'Varie', corpo: 'la porta di servizio e chiusa' },
  ]);
  const stato = statoIniziale(CARTELLA);
  const batti = (tipo, valore) => applicaAzione(stato, { tipo, valore });
  const scrivi = (testo) => [...testo].forEach((c) => batti('carattere', c));

  assert.equal(stato.ricerca, null, 'appena aperta non si sta cercando');

  batti('cerca');
  assert.equal(stato.ricerca, '', 'ctrl+f apre la ricerca, ancora vuota');
  assert.deepEqual(indiciVisibili(stato), [0, 1, 2], 'e a filtro vuoto si vede tutto');

  // Cercando, i caratteri vanno nella ricerca e non nella nota.
  scrivi('port');
  assert.equal(stato.ricerca, 'port');
  assert.deepEqual(indiciVisibili(stato), [0, 2], 'trova nel titolo e nel corpo');
  assert.equal(stato.indice, 0, 'e il cursore va sulla prima trovata');

  // Le frecce passano fra le trovate, saltando quelle che il filtro esclude.
  batti('freccia', 'giu');
  assert.equal(stato.indice, 2, 'la freccia salta la nota che non corrisponde');
  batti('freccia', 'giu');
  assert.equal(stato.indice, 2, 'e in fondo alle trovate si ferma');

  // Maiuscole e minuscole non contano.
  batti('cancella');
  batti('cancella');
  batti('cancella');
  batti('cancella');
  scrivi('DEPLOY');
  assert.deepEqual(indiciVisibili(stato), [1], 'la ricerca non guarda le maiuscole');
  assert.equal(stato.indice, 1, 'e il cursore la segue');

  // Invio smette di cercare lasciando il cursore sulla nota trovata: e' il senso
  // di aver cercato.
  batti('invio');
  assert.equal(stato.ricerca, null, 'invio chiude la ricerca');
  assert.equal(stato.indice, 1, 'e la nota trovata resta selezionata');
  assert.equal(stato.bozza.titolo, 'Deploy', 'pronta da modificare');

  // Da qui i caratteri tornano nella nota. Si scende al corpo con l'invio e non
  // spostando il campo a mano: e' l'invio a portarci anche il cursore, in fondo
  // a quello che c'e' gia'.
  batti('invio');
  assert.equal(stato.campo, 'corpo');
  scrivi('!');
  batti('invio');
  assert.match(righe(CARTELLA)[1], /!$/, 'la nota trovata si modifica');

  // Una ricerca che non trova niente non seleziona niente e non rompe.
  batti('cerca');
  scrivi('zzz');
  assert.deepEqual(indiciVisibili(stato), [], 'nessuna corrispondenza');
  batti('freccia', 'giu');
  assert.match(
    disegnaNote(stato, { colonne: 90, altezza: 20 }).join('\n'),
    /nessuna nota corrisponde/,
    'e lo dice a schermo',
  );

  // Esc smette di cercare invece di uscire: e' il solito passo indietro.
  assert.equal(batti('annulla'), null, 'esc non chiude la schermata');
  assert.equal(stato.ricerca, null, 'chiude la ricerca');
  // Il secondo esc invece esce, perche' ora non si sta piu' cercando.
  assert.equal(batti('annulla'), 'indietro');
}

// Il ciclo vero con un terminale finto: e' l'unico modo di verificare che i tasti
// arrivino dove devono, compresi i tre invii nelle loro codifiche.
async function testCicloDeiTasti() {
  scriviNote(CARTELLA, []);
  const ingresso = new EventEmitter();
  ingresso.resume = () => {};
  ingresso.pause = () => {};
  const disegni = [];
  const uscita = new EventEmitter();
  uscita.write = (t) => disegni.push(t);
  uscita.columns = 90;
  uscita.rows = 24;

  const attesa = apriNote({ cartella: CARTELLA, ingresso, uscita });
  const batti = (testo) => ingresso.emit('data', Buffer.from(testo, 'latin1'));

  batti('Titolo');
  batti('\r'); // invio semplice: dal titolo al corpo
  batti('corpo');
  // shift+invio in codifica win32 (vk 13, shift fra i modificatori): a capo.
  batti('\x1b[13;28;13;1;16;1_');
  batti('due');
  batti('\r'); // invio dal corpo: salva
  assert.deepEqual(righe(CARTELLA), ['Titolo|corpo\ndue'], 'i tre invii fanno tre cose');

  // Un ctrl da solo non ridisegna: cancellerebbe la selezione del testo.
  disegni.length = 0;
  batti('\x1b[17;29;0;1;8;1_');
  assert.equal(disegni.length, 0, 'ctrl da solo non ridisegna');

  // Esc risale di un passo.
  batti('\x1b');
  assert.equal(await attesa, 'indietro');
  assert.equal(ingresso.listenerCount('data'), 0, 'la schermata si stacca dallo stdin');

  // ctrl+invio in codifica kitty consegna la nota: titolo, due punti, corpo.
  const seconda = apriNote({ cartella: CARTELLA, ingresso, uscita });
  batti('Titolo');
  batti('\r');
  batti('da mandare');
  batti('\x1b[13;5u');
  assert.deepEqual(await seconda, { manda: 'Titolo: da mandare' }, 'ctrl+invio manda la nota');

  // Canc esce da tutto.
  const terza = apriNote({ cartella: CARTELLA, ingresso, uscita });
  batti('\x1b[3~');
  assert.equal(await terza, 'esci');
}

const prove = [
  testNoteVuoteEQuelleCheNonCiSono,
  testLeNoteSonoDellaCartella,
  testSalvaEcancella,
  testTestoDaMandare,
  testSenzaCorpoNonSiSalvaNeSiPerde,
  testIlGiroDeiTreInvii,
  testIncollareFaUnaNotaSola,
  testIlCursoreSiMuoveNelTesto,
  testUnTitoloLungoRestaDentroAlRiquadro,
  testLeFrecceSalvanoEsiSpostano,
  testMandaESce,
  testDisegno,
  testIlRiquadroRestaSempreVisibile,
  testCancellazioneMultipla,
  testLaRicerca,
  testCicloDeiTasti,
];

for (const prova of prove) {
  await prova();
  console.log(`ok  ${prova.name}`);
}

fs.rmSync(process.env.CB_NOTE, { recursive: true, force: true });
console.log(`\n${prove.length} prove superate`);
