const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

// Sequenze OSC che cambiano il titolo della finestra: ESC ] 0;testo BEL
// (oppure 1; o 2;, e chiuse da ESC \ invece di BEL).
// ConPTY ne emette una a ogni avvio di processo, col percorso dell'eseguibile:
// e' cosi' che il titolo della tab diventa "...\claude.exe" dopo un cambio ramo.
const RE_TITOLO = new RegExp(`${ESC}\\][012];[^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, 'g');

// Rimuove dall'output le richieste di cambio titolo.
// Serve perche' il titolo della tab lo decide chi lancia cb (di solito il nome
// della cartella di lavoro) e non deve essere sovrascritto dai processi figli.
// dati: stringa o Buffer proveniente dallo pseudo-terminale
// ritorna: stringa senza le sequenze di titolo
export function senzaTitolo(dati) {
  const testo = typeof dati === 'string' ? dati : dati.toString('binary');
  return testo.includes(`${ESC}]`) ? testo.replace(RE_TITOLO, '') : testo;
}

// Costruisce la sequenza che imposta il titolo della finestra.
// testo: titolo desiderato
// ritorna: sequenza OSC da scrivere sul terminale
export function sequenzaTitolo(testo) {
  return `${ESC}]0;${testo}${BEL}`;
}
