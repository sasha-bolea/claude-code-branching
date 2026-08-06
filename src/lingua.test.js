// Prove sulla tabella dei testi.
//
// Le altre prove girano in una lingua sola (vedi prove.js), quindi non direbbero
// niente se la tabella inglese perdesse una voce: si accorgerebbe di tutto solo
// un utente inglese, davanti a un `undefined` a schermo. Qui le due tabelle si
// confrontano fra loro, che e' l'unico modo di verificarle entrambe senza
// riscrivere ogni prova due volte.

import assert from 'node:assert';
import { EN, IT } from './lingua.js';

// Percorre le due tabelle in parallelo e chiama `verifica` su ogni foglia.
// en, it: rami corrispondenti delle due tabelle
// strada: percorso della voce, per i messaggi d'errore
// verifica: (en, it, strada) => void
function confronta(en, it, strada, verifica) {
  assert.deepEqual(
    Object.keys(en).sort(),
    Object.keys(it).sort(),
    `voci diverse in ${strada || 'radice'}`,
  );

  for (const chiave of Object.keys(en)) {
    const dove = strada ? `${strada}.${chiave}` : chiave;
    const a = en[chiave];
    const b = it[chiave];
    assert.equal(typeof a, typeof b, `tipi diversi in ${dove}`);
    if (Array.isArray(a)) {
      assert.equal(a.length, b.length, `varianti diverse in ${dove}`);
      confronta({ ...a }, { ...b }, dove, verifica);
    } else if (a && typeof a === 'object') {
      confronta(a, b, dove, verifica);
    } else {
      verifica(a, b, dove);
    }
  }
}

// Le due tabelle devono avere esattamente le stesse voci: una voce in piu' da una
// parte e' una voce che a schermo diventa `undefined` dall'altra.
function testStessaForma() {
  confronta(EN, IT, '', (a, b, dove) => {
    assert.ok(a !== undefined && a !== '', `voce inglese vuota: ${dove}`);
    assert.ok(b !== undefined && b !== '', `voce italiana vuota: ${dove}`);
  });
  console.log('ok  testStessaForma');
}

// Le varianti di una legenda vanno dalla piu' lunga alla piu' corta.
//
// Non e' pignoleria: chi disegna prende la **prima** variante che entra nella
// larghezza del terminale (`primaCheEntra` in vista.js). Se una variante fosse
// piu' lunga di quella che la precede non verrebbe mai scelta — o peggio,
// verrebbe scelta al posto di una che ci stava, e la riga sfonderebbe.
//
// Vale dentro ogni lingua separatamente: che l'inglese sia piu' corto
// dell'italiano non serve, serve che ognuno dei due sia una scala.
function testVariantiInOrdine() {
  for (const [nome, tabella] of [
    ['en', EN],
    ['it', IT],
  ]) {
    const scale = [
      ['albero.legenda', tabella.albero.legenda],
      ['albero.legendaMenu', tabella.albero.legendaMenu],
      ['albero.legendaProfili', tabella.albero.legendaProfili],
      ['albero.promptInviato', tabella.albero.promptInviato],
      ['albero.promptDaRimandare', tabella.albero.promptDaRimandare],
      ['albero.ricordaScelta', tabella.albero.ricordaScelta],
      ['cartelle.legende', tabella.cartelle.legende],
      ['cartelle.legendeConProfilo', tabella.cartelle.legendeConProfilo],
      ['conversazioni.legende[0]', tabella.conversazioni.legende[0]],
      ['conversazioni.legende[1]', tabella.conversazioni.legende[1]],
      ['conversazioni.legendaVuota', tabella.conversazioni.legendaVuota],
    ];

    for (const [dove, varianti] of scale) {
      const lunghezze = varianti.map((v) => v.length);
      const ordinate = [...lunghezze].sort((a, b) => b - a);
      assert.deepEqual(
        lunghezze,
        ordinate,
        `${nome}.${dove}: le varianti non vanno dalla piu' lunga alla piu' corta (${lunghezze})`,
      );
    }
  }
  console.log('ok  testVariantiInOrdine');
}

// Il menu del ripristino ha tre voci in tutte e due le lingue: il wrapper le
// abbina per posizione ai tre modi ('entrambi', 'conversazione', 'codice'). Dove
// finisce il prompt e' una scelta a parte, non una quarta voce.
function testTreVociDiRipristino() {
  assert.equal(EN.albero.vociRipristino.length, 3);
  assert.equal(IT.albero.vociRipristino.length, 3);
  console.log('ok  testTreVociDiRipristino');
}

testStessaForma();
testVariantiInOrdine();
testTreVociDiRipristino();
console.log('\n3 prove superate');
