// Un campo di testo con il cursore dentro: quello della coda e quello delle
// note sono lo stesso campo, e scriverne due vorrebbe dire due comportamenti
// diversi al primo ritocco.
//
// Prima il testo si poteva solo allungare in fondo: una lettera sbagliata in
// mezzo a un prompt di dieci righe costringeva a cancellare tutto quello che
// veniva dopo. Le frecce ← → portano il cursore dove serve, e da li' in poi
// scrivere, cancellare e incollare avvengono **in quel punto**.
//
// Le funzioni sono pure e lavorano su `{ testo, cursore }`: cosi' si provano
// senza terminale, ed e' la stessa ragione per cui `applicaAzione` sta fuori dal
// ciclo dei tasti nelle due schermate che le usano.
//
// Il cursore si conta in **caratteri** e non in byte: `[...testo]` invece di
// `testo.length`, o una emoji lo farebbe cadere in mezzo a se' stessa.

// Posizione riportata dentro il testo. Serve dopo ogni operazione che accorcia
// il testo — cancellare una nota, caricarne un'altra — perche' un cursore
// rimasto oltre la fine inserirebbe di nuovo in fondo, senza dirlo.
// testo: contenuto del campo
// cursore: posizione, anche fuori scala
// ritorna: posizione dentro [0, lunghezza]
export function dentro(testo, cursore) {
  const lunghezza = [...testo].length;
  if (!Number.isFinite(cursore)) return lunghezza;
  return Math.max(0, Math.min(lunghezza, Math.trunc(cursore)));
}

// Inserisce testo nel punto del cursore, che si sposta alla fine di quello che
// hai appena scritto — come in un editor qualunque.
// testo: contenuto attuale
// cursore: dove sta il cursore
// aggiunta: carattere o blocco incollato
// ritorna: { testo, cursore }
export function inserisci(testo, cursore, aggiunta) {
  const caratteri = [...testo];
  const dove = dentro(testo, cursore);
  return {
    testo: caratteri.slice(0, dove).join('') + aggiunta + caratteri.slice(dove).join(''),
    cursore: dove + [...aggiunta].length,
  };
}

// Cancella il carattere **prima** del cursore: e' il backspace, non il canc.
// In fondo al testo si comporta come sempre; a cursore in testa non fa niente,
// invece di mangiare l'ultimo carattere come farebbe uno `slice(0, -1)`.
// ritorna: { testo, cursore }
export function cancella(testo, cursore) {
  const caratteri = [...testo];
  const dove = dentro(testo, cursore);
  if (dove === 0) return { testo, cursore: 0 };
  return {
    testo: caratteri.slice(0, dove - 1).join('') + caratteri.slice(dove).join(''),
    cursore: dove - 1,
  };
}

// Sposta il cursore di un carattere. Si ferma ai due capi invece di girare:
// tenendo premuta la freccia, un cursore che salta dall'inizio alla fine
// sposterebbe la scrittura dove non te l'aspetti.
// direzione: 'sinistra' | 'destra' (le altre non muovono niente)
// ritorna: la nuova posizione
export function muovi(testo, cursore, direzione) {
  const dove = dentro(testo, cursore);
  if (direzione === 'sinistra') return Math.max(0, dove - 1);
  if (direzione === 'destra') return Math.min([...testo].length, dove + 1);
  return dove;
}

// Margine fra il cursore e il bordo destro della finestra: senza, scrivendo si
// starebbe sempre sull'orlo, e di quello che viene dopo non si vedrebbe niente.
const MARGINE = 6;

// La parte di testo da mostrare in un campo alto una riga sola.
//
// Serve dove il testo puo' essere piu' largo dello spazio: il campo della coda e
// il titolo di una nota. Mostrarlo intero non e' un'opzione — una riga piu'
// larga del suo riquadro esce dal bordo e il terminale la manda a capo,
// sfasando tutto il disegno sotto (successo davvero: un titolo lungo usciva dal
// riquadro delle note).
//
// La finestra segue il cursore invece di mostrare sempre la coda del testo:
// correggendo una parola in mezzo, una finestra ferma in fondo lascerebbe il
// cursore fuori schermo, cioe' a scrivere alla cieca.
// testo: contenuto del campo
// cursore: posizione dentro al testo
// larghezza: colonne disponibili
// ritorna: { testo, cursore, prima, dopo } — `prima`/`dopo` dicono se si e'
//          tagliato di qua o di la', per annunciarlo con un segno
export function finestra(testo, cursore, larghezza) {
  const caratteri = [...testo];
  const dove = dentro(testo, cursore);
  const spazio = Math.max(1, larghezza);
  if (caratteri.length <= spazio) {
    return { testo, cursore: dove, prima: false, dopo: false };
  }

  const da = Math.max(0, Math.min(dove - spazio + MARGINE, caratteri.length - spazio));
  return {
    testo: caratteri.slice(da, da + spazio).join(''),
    cursore: dove - da,
    prima: da > 0,
    dopo: da + spazio < caratteri.length,
  };
}

// Il testo con il glifo del cursore infilato al suo posto, pronto da disegnare.
//
// Il glifo si **infila** e non copre il carattere sotto: coprirlo vorrebbe dire
// non vedere piu' la lettera su cui stai per scrivere, e a cursore in fondo —
// dove sta quasi sempre — non ci sarebbe niente da coprire.
// testo: contenuto del campo, senza colori
// cursore: posizione
// glifo: come disegnare il cursore, gia' colorato
// ritorna: stringa da mandare a schermo
export function conCursore(testo, cursore, glifo) {
  const caratteri = [...testo];
  const dove = dentro(testo, cursore);
  return caratteri.slice(0, dove).join('') + glifo + caratteri.slice(dove).join('');
}
