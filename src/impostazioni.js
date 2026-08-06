// Impostazioni scelte una volta e ricordate: lingua, cartella di lavoro,
// scorciatoia che apre l'albero.
//
// Stanno in ~/.claude/cb/impostazioni.json, accanto a diagnosi.log e indice.json:
// e' roba di cb, non del progetto su cui si sta lavorando, e seguire l'utente da
// una cartella all'altra e' proprio il punto.
//
// Questo modulo non importa lingua.js ed e' voluto: e' lingua.js a leggere di qui
// quale lingua e' stata scelta, e importarsi a vicenda sarebbe un ciclo.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Scorciatoie proposte dalla schermata.
//
// Niente ctrl+g, che pure sarebbe comodo: era la scorciatoia delle prime versioni
// e l'abbiamo abbandonata perche' Claude Code la usa gia'. I tasti funzione sono
// l'unica fascia davvero libera — escluso f10 e f11, che il terminale intercetta
// per barra dei menu e schermo intero.
export const SCORCIATOIE = ['f2', 'esc esc', 'f3', 'f4'];

export const LINGUE = ['it', 'en'];

// Percorso del file. La variabile CB_IMPOSTAZIONI ha la precedenza: serve alle
// prove, che non devono scrivere sulle impostazioni vere di chi le esegue.
// ritorna: percorso del .json
export function percorsoImpostazioni() {
  return (
    process.env.CB_IMPOSTAZIONI || path.join(os.homedir(), '.claude', 'cb', 'impostazioni.json')
  );
}

// Impostazioni salvate, o oggetto vuoto se non ce ne sono.
// Un file illeggibile o corrotto vale come assente: le impostazioni sono una
// comodita', e non devono poter impedire l'avvio.
// ritorna: { lingua?, radice?, scorciatoia? }
export function leggiImpostazioni() {
  try {
    const testo = fs.readFileSync(percorsoImpostazioni(), 'utf8');
    const dati = JSON.parse(testo);
    return dati && typeof dati === 'object' ? dati : {};
  } catch {
    return {};
  }
}

// Vero se l'utente ha gia' visto la schermata: e' quello che distingue il primo
// avvio da tutti gli altri. Si guarda l'esistenza del file, non il suo contenuto,
// cosi' anche chi chiude subito con Esc non se la ritrova addosso ogni volta.
// ritorna: true se il file esiste
export function impostazioniPresenti() {
  return fs.existsSync(percorsoImpostazioni());
}

// Scrive le impostazioni, creando la cartella se manca.
// impostazioni: { lingua, radice, scorciatoia }
export function scriviImpostazioni(impostazioni) {
  const percorso = percorsoImpostazioni();
  fs.mkdirSync(path.dirname(percorso), { recursive: true });
  fs.writeFileSync(percorso, `${JSON.stringify(impostazioni, null, 2)}\n`, 'utf8');
}

// Cambia alcune impostazioni lasciando le altre come stanno.
//
// E' l'unico modo corretto di salvare da una schermata che non conosce tutte le
// chiavi. `scriviImpostazioni` sostituisce il file intero: passandogli i soli
// valori di una schermata, tutto il resto sparisce. E' successo davvero — la
// schermata del primo avvio scriveva le sue tre voci e cancellava `profili`,
// `promptDaRimandare` e `giorniPulizia`, cioe' tutto quello che si configura
// solo a mano.
//
// parziali: le chiavi da cambiare
export function aggiornaImpostazioni(parziali) {
  scriviImpostazioni({ ...leggiImpostazioni(), ...parziali });
}

// Cambia una sola impostazione, lasciando le altre come stanno.
// Serve alle caselle «ricordati questa scelta», che salvano una preferenza sola
// senza sapere cosa altro c'e' nel file.
// nome: chiave da scrivere
// valore: valore da salvare
export function salvaImpostazione(nome, valore) {
  aggiornaImpostazioni({ [nome]: valore });
}

// Valore di un'impostazione, con la precedenza che conta:
// variabile d'ambiente → file → predefinito.
//
// L'ambiente per primo perche' e' la scelta piu' esplicita: chi scrive
// `CB_TASTO=f5 cb` per una volta sola non vuole che il file glielo ignori, e
// tutto quello che il README documenta continua a funzionare com'e' scritto.
// nome: 'lingua' | 'radice' | 'scorciatoia'
// predefinito: valore da usare se non c'e' ne' ambiente ne' file
// ritorna: il valore scelto
export function impostazione(nome, predefinito) {
  const ambiente = {
    lingua: 'CB_LINGUA',
    radice: 'CB_RADICE',
    scorciatoia: 'CB_TASTO',
    giorniPulizia: 'CB_GIORNI_PULIZIA',
  }[nome];
  const daAmbiente = ambiente ? process.env[ambiente] : null;
  if (daAmbiente) return daAmbiente;

  // Lo zero e' un valore vero: `giorniPulizia: 0` spegne la pulizia automatica, e
  // con un `||` sarebbe caduto sul predefinito, cioe' non l'avrebbe spenta.
  // La stringa vuota resta trattata come "non scelto".
  const salvato = leggiImpostazioni()[nome];
  return salvato === undefined || salvato === '' ? predefinito : salvato;
}
