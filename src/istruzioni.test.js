// Prove sulla pagina delle istruzioni.
//
// Quello che puo' rompersi qui non e' il testo — quello lo verifica
// lingua.test.js — ma il disegno: una pagina piu' alta dello schermo che non si
// scorre e' una pagina di cui si legge solo la prima meta', e una riga piu'
// larga del terminale sfasa tutto il disegno sotto.

import assert from 'node:assert';
import { paginaIstruzioni, massimoScorrimento, sovrapposizioneIstruzioni } from './istruzioni.js';
import { T } from './lingua.js';

const DIMENSIONI = { colonne: 90, altezza: 20 };

// La pagina riempie lo schermo esatto e non lo sfonda in larghezza: sono i due
// vincoli di ogni schermata di cb, e valgono anche qui.
function testLaPaginaStaNelloSchermo() {
  for (const nome of Object.keys(T.istruzioni)) {
    const pagina = T.istruzioni[nome];
    if (!pagina?.righe) continue; // intestazione, legende: non sono pagine
    const righe = paginaIstruzioni(pagina, DIMENSIONI);
    assert.equal(righe.length, 20, `${nome}: la pagina riempie esattamente lo schermo`);
    assert.ok(
      righe.every((r) => [...r.replace(/\x1b\[[0-9;]*m/g, '')].length <= 90),
      `${nome}: nessuna riga eccede la larghezza`,
    );
    // La legenda in fondo dice sempre come si esce, anche su una pagina lunga:
    // e' l'unica riga che non puo' mancare.
    assert.match(righe[righe.length - 1], /esc/, `${nome}: la legenda e' l'ultima riga`);
  }
  console.log('ok  testLaPaginaStaNelloSchermo');
}

// Su uno schermo basso il testo non ci sta: si scorre, e si dice quanto resta.
// Senza dirlo, una pagina tagliata si legge come una pagina finita.
function testLoScorrimentoDiceQuantoResta() {
  const basso = { colonne: 90, altezza: 12 };
  const massimo = massimoScorrimento(T.istruzioni.albero, basso);
  assert.ok(massimo > 0, 'su uno schermo basso c e da scorrere');

  const prima = paginaIstruzioni(T.istruzioni.albero, basso).join('\n');
  assert.match(prima, /altre \d+ righe/, 'lo dice accanto al titolo');
  assert.match(prima, /↑↓/, 'e la legenda annuncia le frecce');

  // In fondo non si dice piu' che c'e' altro: non c'e'.
  const infondo = paginaIstruzioni(T.istruzioni.albero, { ...basso, scorrimento: massimo });
  assert.doesNotMatch(infondo.join('\n'), /altre \d+ righe/, 'in fondo non resta niente');

  // Oltre il fondo non si va: lo scorrimento si ferma, invece di svuotare la
  // pagina lasciando lo schermo bianco.
  const oltre = paginaIstruzioni(T.istruzioni.albero, { ...basso, scorrimento: massimo + 50 });
  assert.deepEqual(oltre, infondo, 'oltre il fondo la pagina resta l ultima');
  console.log('ok  testLoScorrimentoDiceQuantoResta');
}

// La sovrapposizione e' quella che usano i selettori: si apre, prende i tasti,
// e restituisce la schermata a chi ce l'aveva. I due tasti dell'uscita fanno qui
// quello che fanno ovunque: esc torna indietro di un passo, canc esce da tutto.
function testLaSovrapposizioneRestituisceLaSchermata() {
  const sopra = sovrapposizioneIstruzioni(T.istruzioni.coda);
  assert.equal(sopra.aperta, false, 'nasce chiusa');

  sopra.apri();
  assert.equal(sopra.aperta, true);
  assert.equal(sopra.tasti([{ tipo: 'annulla' }], DIMENSIONI), 'chiusa', 'esc chiude');
  assert.equal(sopra.aperta, false, 'e la schermata sotto torna a vedersi');

  sopra.apri();
  assert.equal(sopra.tasti([{ tipo: 'esci' }], DIMENSIONI), 'esci', 'canc esce da tutto');

  // Le azioni arrivano in due forme: stringhe dai selettori che navigano,
  // oggetti da quelli con un campo di testo. Devono valere tutt'e due, o le
  // istruzioni funzionerebbero in meta' delle schermate.
  sopra.apri();
  assert.equal(sopra.tasti(['annulla'], DIMENSIONI), 'chiusa', 'anche come stringa');

  // Un tasto che non la riguarda la lascia aperta: dentro la coda si continua a
  // premere di tutto, e ogni tasto non doveva chiudere la pagina.
  sopra.apri();
  assert.equal(sopra.tasti([{ tipo: 'carattere', valore: 'x' }], DIMENSIONI), 'aperta');
  console.log('ok  testLaSovrapposizioneRestituisceLaSchermata');
}

// Le frecce scorrono la pagina sovrapposta, nelle due forme in cui arrivano.
function testLaSovrapposizioneScorre() {
  const basso = { colonne: 90, altezza: 12 };
  const sopra = sovrapposizioneIstruzioni(T.istruzioni.albero);
  sopra.apri();

  const inCima = sopra.disegna(basso);
  sopra.tasti([{ tipo: 'freccia', valore: 'giu' }], basso);
  const scorsa = sopra.disegna(basso);
  assert.notDeepEqual(scorsa, inCima, 'giu scorre');

  sopra.tasti(['su'], basso);
  assert.deepEqual(sopra.disegna(basso), inCima, 'su torna indietro, anche come stringa');

  // Riaprendola si riparte dall'inizio: ritrovarla a meta' di dove l'avevi
  // lasciata vorrebbe dire un testo che comincia a caso.
  sopra.tasti(['giu', 'giu'], basso);
  sopra.tasti(['annulla'], basso);
  sopra.apri();
  assert.deepEqual(sopra.disegna(basso), inCima, 'si riapre dall inizio');
  console.log('ok  testLaSovrapposizioneScorre');
}

testLaPaginaStaNelloSchermo();
testLoScorrimentoDiceQuantoResta();
testLaSovrapposizioneRestituisceLaSchermata();
testLaSovrapposizioneScorre();
console.log('\n4 prove superate');
