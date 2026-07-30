// Le prove confrontano il disegno carattere per carattere: con i colori accesi
// ogni riga porterebbe le sequenze ANSI e il confronto sarebbe illeggibile.
// Basta impostarlo qui: coloriAttivi() legge l'ambiente a ogni disegno, non
// all'import (che in ESM avverrebbe comunque prima di questa riga).
process.env.NO_COLOR = '1';

import assert from 'node:assert/strict';
import {
  componiVista,
  disegnaRighe,
  muovi,
  puntaRamoAttivo,
  antenati,
  aCapo,
  schermata,
} from './vista.js';

// Costruisce un albero nella forma che restituisce leggiTranscript.
// righe: terne [uuid, parentUuid, tipo], con tipo 'u' per i prompt utente
// leafAttivo: foglia scritta in last-prompt
// ultimoNodo: ultimo record messaggio del file (per difetto la stessa foglia)
// ritorna: albero finto
function alberoFinto(righe, leafAttivo, ultimoNodo = leafAttivo) {
  const nodi = new Map();
  righe.forEach(([uuid, parentUuid, tipo], i) => {
    nodi.set(uuid, {
      uuid,
      parentUuid,
      isPromptUtente: tipo === 'u',
      testo: uuid,
      timestamp: `2026-07-30T10:${String(i).padStart(2, '0')}:00.000Z`,
      figli: [],
    });
  });
  return { nodi, leafAttivo, ultimoNodo };
}

// Disegna una vista in testo semplice, per intero.
const disegna = (albero, selezione = null) => disegnaRighe(componiVista(albero), selezione);

function testCatenaSuUnaRiga() {
  const albero = alberoFinto(
    [
      ['a', null, 'u'],
      ['ra', 'a', 'r'],
      ['b', 'ra', 'u'],
      ['rb', 'b', 'r'],
      ['c', 'rb', 'u'],
    ],
    'c',
  );

  // Le risposte non compaiono: l'albero e' dei soli prompt digitati.
  assert.deepEqual(disegna(albero), ['⬤━━━⬤━━━⬤']);
}

function testBiforcazione() {
  const albero = alberoFinto(
    [
      ['a', null, 'u'],
      ['r', 'a', 'r'],
      ['b', 'r', 'u'],
      ['c', 'r', 'u'],
    ],
    'b',
  );

  assert.deepEqual(disegna(albero), [
    '⬤━┳━⬤', // linea principale: il primo figlio resta in linea
    '  ┗━⬤', // il secondo pende dalla forca
  ]);
}

function testTreRamiDallaStessaForca() {
  const albero = alberoFinto(
    [
      ['a', null, 'u'],
      ['r', 'a', 'r'],
      ['b', 'r', 'u'],
      ['c', 'r', 'u'],
      ['d', 'r', 'u'],
    ],
    'b',
  );

  assert.deepEqual(disegna(albero), ['⬤━┳━⬤', '  ┣━⬤', '  ┗━⬤']);
}

function testDiscesaAttraversaLeRigheIntermedie() {
  // Ramo che parte da un punto piu' avanzato della linea: la discesa deve
  // arrivare fino alla sua riga, sotto a quelle gia' disegnate.
  const albero = alberoFinto(
    [
      ['a', null, 'u'],
      ['r1', 'a', 'r'],
      ['b', 'r1', 'u'], // primo figlio di a
      ['c', 'r1', 'u'], // secondo figlio di a: riga 1
      ['r2', 'b', 'r'],
      ['d', 'r2', 'u'], // primo figlio di b
      ['e', 'r2', 'u'], // secondo figlio di b: riga 2, discesa dalla colonna 6
    ],
    'b',
  );

  assert.deepEqual(disegna(albero), [
    '⬤━┳━⬤━┳━⬤',
    '  ┗━⬤ ┃', // la discesa verso la riga 2 attraversa questa riga
    '      ┗━⬤',
  ]);
}

function testCatenaLungaNonVaACapo() {
  // Prima le catene si spezzavano su piu' righe: un ramo lungo sembrava tanti
  // rami corti. Ora l'albero ha la sua larghezza naturale e a mostrarne un pezzo
  // ci pensa la finestra di `schermata`.
  const righe = [['n0', null, 'u']];
  for (let i = 1; i < 10; i += 1) righe.push([`n${i}`, `n${i - 1}`, 'u']);
  const vista = componiVista(alberoFinto(righe, 'n9'));

  assert.equal(vista.griglia.length, 1, 'una catena senza rami resta una riga sola');
  assert.equal(vista.larghezza, 37, '10 nodi a 4 colonne di passo, meno i 3 raccordi finali');
  assert.equal(disegnaRighe(vista, null)[0].length, 37);
}

function testRitaglioOrizzontale() {
  const albero = alberoFinto(
    [
      ['a', null, 'u'],
      ['b', 'a', 'u'],
      ['c', 'b', 'u'],
      ['d', 'c', 'u'],
    ],
    'd',
  );
  const vista = componiVista(albero);
  assert.deepEqual(disegnaRighe(vista, null), ['⬤━━━⬤━━━⬤━━━⬤']);

  // Finestra di 5 colonne a partire dalla quarta: si vede il secondo nodo.
  assert.deepEqual(disegnaRighe(vista, null, { da: 4, quante: 5 }), ['⬤━━━⬤']);
  // Dal fondo: la finestra si ferma dove finisce l'albero.
  assert.deepEqual(disegnaRighe(vista, null, { da: 12, quante: 5 }), ['⬤']);
  // Oltre la fine non produce spazzatura.
  assert.deepEqual(disegnaRighe(vista, null, { da: 40, quante: 5 }), ['']);
}

function testRitaglioNonSpezzaLeSequenzeAnsi() {
  // Con i colori accesi ogni riga contiene sequenze ANSI: tagliare per numero di
  // caratteri ne spezzerebbe una a meta', lasciando il terminale colorato. Il
  // taglio va fatto sulle celle, ed e' quello che si verifica qui.
  process.env.NO_COLOR = '';
  process.env.CB_COLORI = '1';
  try {
    const albero = alberoFinto(
      [
        ['a', null, 'u'],
        ['b', 'a', 'u'],
        ['c', 'b', 'u'],
      ],
      'c',
    );
    const vista = componiVista(albero);
    const riga = disegnaRighe(vista, 'b', { da: 2, quante: 6 })[0];

    // Ogni sequenza aperta deve essere chiusa: tanti azzeramenti quanti colori.
    const aperture = (riga.match(/\x1b\[[0-9;]+m/g) ?? []).filter((s) => s !== '\x1b[0m');
    const chiusure = riga.match(/\x1b\[0m/g) ?? [];
    assert.equal(aperture.length, chiusure.length, 'ogni colore aperto viene chiuso');
    assert.ok(!/\x1b\[[0-9;]*$/.test(riga), 'nessuna sequenza troncata in coda');
    assert.equal(riga.replace(/\x1b\[[0-9;]*m/g, '').length, 6, 'la finestra e larga 6 celle');
  } finally {
    process.env.CB_COLORI = '';
    process.env.NO_COLOR = '1';
  }
}

function testSelezioneEIlCerchioVuoto() {
  const albero = alberoFinto(
    [
      ['a', null, 'u'],
      ['b', 'a', 'u'],
    ],
    'b',
  );

  assert.deepEqual(disegna(albero, 'a'), ['◯━━━⬤']);
  assert.deepEqual(disegna(albero, 'b'), ['⬤━━━◯']);
}

function testMovimenti() {
  const albero = alberoFinto(
    [
      ['a', null, 'u'],
      ['b', 'a', 'u'],
      ['c', 'a', 'u'],
      ['d', 'b', 'u'],
    ],
    'd',
  );
  const vista = componiVista(albero);

  assert.equal(muovi(vista, 'a', 'destra'), 'b', 'destra scende al primo figlio');
  assert.equal(muovi(vista, 'b', 'sinistra'), 'a', 'sinistra risale al padre');
  assert.equal(muovi(vista, 'b', 'giu'), 'c', 'giu passa al ramo di sotto');
  assert.equal(muovi(vista, 'c', 'su'), 'b', 'su torna al ramo di sopra');

  assert.equal(muovi(vista, 'a', 'sinistra'), 'a', 'dalla radice non si risale');
  assert.equal(muovi(vista, 'd', 'destra'), 'd', 'dalla punta non si scende');
  assert.equal(muovi(vista, 'b', 'su'), 'b', 'dalla prima riga non si sale');
  assert.equal(muovi(vista, 'c', 'giu'), 'c', 'dall ultima riga non si scende');
  assert.equal(muovi(vista, 'd', 'su'), 'd', 'e nemmeno da un nodo della prima riga');
}

function testCambioRamoDaQualsiasiPunto() {
  // Il limite di prima: su e giu' cercavano i fratelli, quindi da un nodo che non
  // nasce da una biforcazione non facevano nulla. Ora passano al ramo disegnato
  // sopra o sotto, sul nodo piu' vicino in orizzontale.
  //
  //   riga 0:  a━┳━b━━━c━━━d
  //   riga 1:    ┗━e━━━f
  const albero = alberoFinto(
    [
      ['a', null, 'u'],
      ['b', 'a', 'u'], // primo figlio: resta in linea
      ['c', 'b', 'u'],
      ['d', 'c', 'u'],
      ['e', 'a', 'u'], // secondo figlio: scende di una riga
      ['f', 'e', 'u'],
    ],
    'd',
  );
  const vista = componiVista(albero);

  // "c" e "d" sono figli unici: prima su/giu' erano inerti.
  assert.equal(vista.posizioni.get('c').colonna, 8, 'c sta in colonna 8');
  assert.equal(vista.posizioni.get('f').colonna, 8, 'e f pure, sulla riga sotto');
  assert.equal(muovi(vista, 'c', 'giu'), 'f', 'da un figlio unico si cambia ramo lo stesso');
  assert.equal(muovi(vista, 'f', 'su'), 'c', 'e si torna indietro');

  // "d" e' oltre la fine del ramo di sotto: si prende il nodo piu' vicino.
  assert.equal(muovi(vista, 'd', 'giu'), 'f', 'oltre la fine si atterra sul piu vicino');

  // I bordi restano fermi: non si esce dall'albero.
  assert.equal(muovi(vista, 'b', 'su'), 'b', 'dalla prima riga non si sale');
  assert.equal(muovi(vista, 'f', 'giu'), 'f', 'dall ultima non si scende');

  // Sinistra e destra continuano a seguire la conversazione.
  assert.equal(muovi(vista, 'c', 'sinistra'), 'b');
  assert.equal(muovi(vista, 'c', 'destra'), 'd');
}

function testCambioRamoAParitaDiDistanza() {
  // Due candidati equidistanti: vince quello piu' a sinistra, cioe' il piu'
  // indietro nella conversazione, che fa perdere meno storia.
  //
  //   riga 0:  a━┳━b━━━c
  //   riga 1:    ┗━d━━━e   (d in colonna 4, e in colonna 8)
  const albero = alberoFinto(
    [
      ['a', null, 'u'],
      ['b', 'a', 'u'],
      ['c', 'b', 'u'],
      ['d', 'a', 'u'],
      ['e', 'd', 'u'],
    ],
    'c',
  );
  const vista = componiVista(albero);

  // Da "b" (colonna 4) il nodo piu' vicino sotto e' "d", esattamente sotto.
  assert.equal(muovi(vista, 'b', 'giu'), 'd');
  // Da "c" (colonna 8) e' "e".
  assert.equal(muovi(vista, 'c', 'giu'), 'e');
}

function testDestraInFondoAUnRamoProsegueSuUnAffiancato() {
  // In fondo a un ramo la destra non si blocca: passa al ramo affiancato che va
  // piu' avanti. Fra i due vince il piu' corto, a parita' quello di sopra.
  //
  //   riga 0:  a━┳━b━━━c━━━d━━━e     finisce in colonna 16
  //   riga 1:    ┣━f                 f e' una foglia, in colonna 4
  //   riga 2:    ┗━g━━━h             finisce in colonna 8
  const vista = componiVista(
    alberoFinto(
      [
        ['a', null, 'u'],
        ['b', 'a', 'u'],
        ['c', 'b', 'u'],
        ['d', 'c', 'u'],
        ['e', 'd', 'u'],
        ['f', 'a', 'u'],
        ['g', 'a', 'u'],
        ['h', 'g', 'u'],
      ],
      'e',
    ),
  );

  // Il disegno e' quello che mi aspetto: le regole dipendono dalle colonne.
  assert.equal(vista.posizioni.get('f').riga, 1, 'f sta sulla riga di mezzo');
  assert.equal(vista.posizioni.get('f').colonna, 4);
  assert.deepEqual(vista.perUuid.get('f').figli, [], 'ed e una foglia');

  // Sopra finisce in colonna 16, sotto in colonna 8: vince il piu' corto.
  assert.equal(muovi(vista, 'f', 'destra'), 'h', 'fra due rami piu lunghi vince il piu corto');

  // Dalla fine del ramo piu' lungo non c'e' niente oltre: si resta fermi.
  assert.equal(muovi(vista, 'e', 'destra'), 'e');
  // Idem dalla fine di quello di sotto, che e' la riga piu' bassa.
  assert.equal(muovi(vista, 'h', 'destra'), 'h');
}

function testDestraSceglieIlRamoDiSopraAParita() {
  //   riga 0:  a━┳━b━━━c     finisce in colonna 8
  //   riga 1:    ┣━d         foglia in colonna 4
  //   riga 2:    ┗━e━━━f     finisce in colonna 8, come sopra
  const vista = componiVista(
    alberoFinto(
      [
        ['a', null, 'u'],
        ['b', 'a', 'u'],
        ['c', 'b', 'u'],
        ['d', 'a', 'u'],
        ['e', 'a', 'u'],
        ['f', 'e', 'u'],
      ],
      'c',
    ),
  );

  assert.equal(vista.posizioni.get('c').colonna, 8, 'i due rami finiscono alla stessa colonna');
  assert.equal(vista.posizioni.get('f').colonna, 8);
  assert.equal(muovi(vista, 'd', 'destra'), 'c', 'a parita di lunghezza vince quello di sopra');
}

function testDestraIgnoraIRamiCheFinisconoPrima() {
  //   riga 0:  a━┳━b         finisce dove siamo: non offre niente
  //   riga 1:    ┣━c         foglia in colonna 4
  //   riga 2:    ┗━d━━━e     l unico che va oltre
  const vista = componiVista(
    alberoFinto(
      [
        ['a', null, 'u'],
        ['b', 'a', 'u'],
        ['c', 'a', 'u'],
        ['d', 'a', 'u'],
        ['e', 'd', 'u'],
      ],
      'b',
    ),
  );

  assert.equal(muovi(vista, 'c', 'destra'), 'e', 'si va sull unico ramo che prosegue');

  // Nessun ramo affiancato che vada oltre: il cursore resta dov e.
  const soloDue = componiVista(
    alberoFinto(
      [
        ['a', null, 'u'],
        ['b', 'a', 'u'],
        ['c', 'a', 'u'],
      ],
      'b',
    ),
  );
  assert.equal(muovi(soloDue, 'c', 'destra'), 'c', 'senza niente oltre non ci si muove');
}

function testPuntaRamoAttivo() {
  const albero = alberoFinto(
    [
      ['a', null, 'u'],
      ['b', 'a', 'u'], // ramo in disparte
      ['c', 'a', 'u'],
      ['d', 'c', 'u'], // punta del ramo attivo
    ],
    'd',
  );

  const vista = componiVista(albero);
  assert.equal(puntaRamoAttivo(vista), 'd', 'si parte da dove si trova la conversazione');
  assert.deepEqual(
    antenati(vista, 'd').map((v) => v.uuid),
    ['c', 'a'],
    'la storia risale fino alla radice',
  );
  assert.deepEqual(antenati(vista, 'a'), [], 'la radice non ha storia dietro');
}

function testPuntaSegueLUltimoRecord() {
  // Il caso vero: last-prompt e' rimasto sul prompt 'b' di due turni prima, ma la
  // conversazione e' andata avanti fino a 'd'. Il cursore deve aprirsi su 'd',
  // cioe' sul prompt da cui si e' premuta la scorciatoia.
  const albero = alberoFinto(
    [
      ['a', null, 'u'],
      ['b', 'a', 'u'],
      ['rb', 'b', 'r'],
      ['d', 'rb', 'u'],
      ['rd', 'd', 'r'],
    ],
    'b', // last-prompt indietro di due turni
    'rd', // ultimo record scritto nel file: la risposta a 'd'
  );

  const vista = componiVista(albero);
  assert.equal(puntaRamoAttivo(vista), 'd', 'il cursore parte dall ultimo prompt vero');
  // E il ramo intero risulta attivo, non solo il pezzo fino a last-prompt.
  assert.ok(vista.attivi.has('d'), 'la catena attiva arriva fino in fondo');
}

function testPuntaRipiegaSuLastPrompt() {
  // Se l'ultimo record non e' nell'albero (file troncato, record di sidechain)
  // resta valido last-prompt: meglio una punta vecchia che nessuna.
  const albero = alberoFinto(
    [
      ['a', null, 'u'],
      ['b', 'a', 'u'],
    ],
    'b',
    'inesistente',
  );

  const vista = componiVista(albero);
  assert.equal(puntaRamoAttivo(vista), 'b');
}

function testPuntaSenzaRamoAttivo() {
  // Un file senza last-prompt valido non deve lasciare l'overlay senza cursore.
  const albero = alberoFinto(
    [
      ['a', null, 'u'],
      ['b', 'a', 'u'],
    ],
    null,
  );

  const vista = componiVista(albero);
  assert.equal(puntaRamoAttivo(vista), 'b', 'si ripiega sull ultimo nodo disegnato');
}

function testAlberoVuoto() {
  const vista = componiVista(alberoFinto([], null));
  assert.deepEqual(vista.nodi, [], 'nessun prompt, nessun nodo');
  assert.deepEqual(disegnaRighe(vista, null), []);
  assert.equal(puntaRamoAttivo(vista), null);
}

function testSchermata() {
  const albero = alberoFinto(
    [
      ['a', null, 'u'],
      ['b', 'a', 'u'],
      ['c', 'b', 'u'],
    ],
    'c',
  );
  const vista = componiVista(albero);
  const righe = schermata(vista, 'b', { colonne: 100, altezza: 30 }).join('\n');

  assert.match(righe, /rami di questa conversazione/, 'intestazione');
  assert.match(righe, /riparti da qui/, 'il prompt selezionato e dichiarato');
  assert.match(righe, /precedenti: 1/, 'la storia conta gli antenati');
  assert.match(righe, /ripristina anche i file/, 'la barra dice cosa fa l invio');

  const senzaFile = schermata(vista, 'b', { ripristinaCodice: false }).join('\n');
  assert.match(senzaFile, /i file restano come sono/, 'e lo dice anche al contrario');
}

function testSchermataStaNelloSchermo() {
  // Con un albero piu' alto dello schermo la finestra si stringe intorno al
  // cursore invece di spingere fuori il prompt e la barra dei tasti.
  const righe = [['r0', null, 'u']];
  // Ogni prompt biforca: trenta righe di albero.
  for (let i = 1; i < 30; i += 1) {
    righe.push([`r${i}`, 'r0', 'u']);
  }
  const albero = alberoFinto(righe, 'r29');
  const vista = componiVista(albero);
  const disegno = schermata(vista, 'r20', { colonne: 100, altezza: 30 });

  assert.ok(disegno.length <= 30, `la schermata sta in 30 righe (ne usa ${disegno.length})`);
  const testo = disegno.join('\n');
  assert.match(testo, /righe sopra/, 'avvisa che l albero continua sopra');
  assert.match(testo, /righe sotto/, 'e anche sotto');
  // La barra dei tasti nomina sempre l'invio, in tutte le sue varianti di lunghezza.
  assert.match(testo, /invio/, 'la barra dei tasti non viene spinta fuori');
}

function testBarraETestateSiAccorcianoSuTerminaleStretto() {
  // Legenda e barra dei tasti avevano lunghezza fissa: su un terminale stretto
  // andavano a capo e sfasavano tutto il disegno sotto.
  const vista = componiVista(alberoFinto([['a', null, 'u'], ['b', 'a', 'u']], 'b'));
  const nudo = (riga) => riga.replace(/\x1b\[[0-9;]*m/g, '');

  // Nessuna riga sfora, a nessuna larghezza: sotto i 20 e' un caso assurdo, ma il
  // disegno non deve comunque rompersi.
  for (const colonne of [120, 80, 60, 40, 24, 12, 4]) {
    const disegno = schermata(vista, 'b', { colonne, altezza: 24 });
    for (const riga of disegno) {
      assert.ok(
        nudo(riga).length <= colonne,
        `riga di ${nudo(riga).length} colonne su un terminale di ${colonne}: "${nudo(riga)}"`,
      );
    }
  }

  // Alle larghezze plausibili i due tasti che contano restano nominati: sotto,
  // non ci starebbero fisicamente e la riga viene mozzata.
  for (const colonne of [120, 80, 60, 40]) {
    const testo = schermata(vista, 'b', { colonne, altezza: 24 }).join('\n');
    assert.match(testo, /invio/, `l invio resta detto a ${colonne} colonne`);
    assert.match(testo, /esc/, `e anche l esc a ${colonne} colonne`);
  }
}

function testTaglioNonLasciaIlColoreAcceso() {
  // Se il taglio cade dentro un tratto colorato il colore va richiuso, o
  // resterebbe acceso su tutto quello che il terminale stampa dopo.
  process.env.NO_COLOR = '';
  process.env.CB_COLORI = '1';
  try {
    const righe = [['n0', null, 'u']];
    for (let i = 1; i < 20; i += 1) righe.push([`n${i}`, `n${i - 1}`, 'u']);
    const vista = componiVista(alberoFinto(righe, 'n19'));

    for (const colonne of [80, 40, 20, 9]) {
      for (const riga of schermata(vista, 'n10', { colonne, altezza: 24 })) {
        const aperture = (riga.match(/\x1b\[[0-9;]+m/g) ?? []).filter((s) => s !== '\x1b[0m');
        const chiusure = riga.match(/\x1b\[0m/g) ?? [];
        assert.equal(aperture.length, chiusure.length, `colore non chiuso a ${colonne}: "${riga}"`);
      }
    }
  } finally {
    process.env.CB_COLORI = '';
    process.env.NO_COLOR = '1';
  }
}

function testSchermataScorreDietroAlCursore() {
  // Conversazione lunga: l'albero e' molto piu' largo del terminale, quindi la
  // finestra deve inseguire il cursore invece di mostrare sempre l'inizio.
  const righe = [['n0', null, 'u']];
  for (let i = 1; i < 60; i += 1) righe.push([`n${i}`, `n${i - 1}`, 'u']);
  const vista = componiVista(alberoFinto(righe, 'n59'));
  const dimensioni = { colonne: 60, altezza: 30 };

  // Nessuna riga puo' sforare la larghezza del terminale, altrimenti il terminale
  // manderebbe a capo da solo e la griglia si sfalderebbe.
  const nudo = (riga) => riga.replace(/\x1b\[[0-9;]*m/g, '');
  for (const sel of ['n0', 'n30', 'n59']) {
    for (const riga of schermata(vista, sel, dimensioni)) {
      assert.ok(nudo(riga).length <= 60, `riga larga ${nudo(riga).length} con cursore su ${sel}`);
    }
  }

  // In ogni posizione il cursore deve essere dentro la finestra: e' il punto
  // dello scorrimento.
  for (const sel of ['n0', 'n15', 'n30', 'n45', 'n59']) {
    const disegno = schermata(vista, sel, dimensioni).join('\n');
    assert.ok(disegno.includes('◯'), `il cursore su ${sel} resta visibile`);
  }

  // All'inizio non c'e' niente a sinistra, in fondo niente a destra.
  const inizio = schermata(vista, 'n0', dimensioni).join('\n');
  assert.ok(!inizio.includes('prompt prima'), 'sulla radice non si e scorso');
  assert.match(inizio, /dopo →/, 'ma dice quanto resta avanti');

  const fondo = schermata(vista, 'n59', dimensioni).join('\n');
  assert.match(fondo, /← \d+ prompt prima/, 'in fondo dice quanto resta indietro');
  assert.ok(!fondo.includes('dopo →'), 'e non promette prompt che non ci sono');

  // Albero piu' stretto del terminale: nessun avviso di scorrimento.
  const corto = componiVista(alberoFinto([['a', null, 'u'], ['b', 'a', 'u']], 'b'));
  const disegnoCorto = schermata(corto, 'b', dimensioni).join('\n');
  assert.ok(!disegnoCorto.includes('prompt prima') && !disegnoCorto.includes('dopo →'));
}

function testACapo() {
  assert.deepEqual(aCapo('uno due tre', 100), ['uno due tre']);
  assert.deepEqual(aCapo('uno due tre', 7), ['uno due', 'tre']);
  assert.deepEqual(aCapo('', 10), [''], 'un prompt vuoto resta una riga vuota');

  // Parola piu' lunga della riga (un percorso, un url): si taglia secco.
  assert.deepEqual(aCapo('abcdefghij', 4), ['abcd', 'efgh', 'ij']);

  // Oltre il massimo di righe il resto va dichiarato, non troncato zitto.
  const tagliato = aCapo('uno due tre quattro cinque', 8, 2);
  assert.equal(tagliato.length, 2);
  assert.match(tagliato[1], /…$/, 'l ultima riga dice che il testo continua');

  // Gli spazi multipli e i ritorni a capo del prompt vengono normalizzati.
  assert.deepEqual(aCapo('  uno\n\n  due  ', 100), ['uno due']);
}

const prove = [
  testCatenaSuUnaRiga,
  testBiforcazione,
  testTreRamiDallaStessaForca,
  testDiscesaAttraversaLeRigheIntermedie,
  testCatenaLungaNonVaACapo,
  testRitaglioOrizzontale,
  testRitaglioNonSpezzaLeSequenzeAnsi,
  testSelezioneEIlCerchioVuoto,
  testMovimenti,
  testCambioRamoDaQualsiasiPunto,
  testCambioRamoAParitaDiDistanza,
  testDestraInFondoAUnRamoProsegueSuUnAffiancato,
  testDestraSceglieIlRamoDiSopraAParita,
  testDestraIgnoraIRamiCheFinisconoPrima,
  testPuntaRamoAttivo,
  testPuntaSegueLUltimoRecord,
  testPuntaRipiegaSuLastPrompt,
  testPuntaSenzaRamoAttivo,
  testAlberoVuoto,
  testSchermata,
  testSchermataStaNelloSchermo,
  testBarraETestateSiAccorcianoSuTerminaleStretto,
  testTaglioNonLasciaIlColoreAcceso,
  testSchermataScorreDietroAlCursore,
  testACapo,
];

for (const prova of prove) {
  prova();
  console.log(`ok  ${prova.name}`);
}

console.log(`\n${prove.length} prove superate`);
