// L'ora in cui la finestra dei token riparte.
//
// Claude Code non la scrive nel transcript — verificato su una sessione da 10 MB,
// dove non compare affatto — e cb non legge mai lo schermo. L'unica fonte
// ufficiale e' il JSON che il CLI passa sullo stdin del comando della statusline:
// `rate_limits.five_hour.resets_at`, l'istante del reset in secondi epoch. La
// documentazione del CLI lo dice: «Only present for subscribers after first API
// response».
//
// Quel comando pero' lo esegue Claude, non cb. Chi scrive la statusline salva il
// numero in un file, e cb lo legge di li': e' un accordo fra i due, non un modo di
// spiare. Senza il file non si sa niente e non parte nessun prompt.
//
// Che sia un file e non una variabile: la statusline gira in un altro processo, e
// il wrapper deve poterlo leggere anche ore dopo.
//
// Si guarda solo la finestra delle cinque ore: e' quella che si esaurisce in una
// giornata di lavoro, mentre quella dei sette giorni, quando finisce, non riparte
// in un'attesa che abbia senso aspettare col processo aperto.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { impostazione } from './impostazioni.js';

// Vero se il prompt automatico al reset e' acceso.
//
// **Spento se non lo si accende**, ed e' voluto: manda un prompt da solo e quel
// prompt costa token. Una cosa che spende per conto tuo la si chiede, non la si
// subisce perche' hai aggiornato un pacchetto — e chi non sa di averla accesa
// vedrebbe comparire un turno dal nulla e concluderebbe che cb e' impazzito.
//
// Dall'ambiente arrivano stringhe, e `'0'` e `'false'` sono stringhe vere quindi
// entrambe passerebbero per accese: vanno riconosciute a mano. Dal file invece
// arriva un booleano.
// ritorna: true se il prompt deve partire
export function promptAlResetAttivo() {
  const scelta = impostazione('promptAlReset', false);
  if (typeof scelta === 'string') return !['', '0', 'false', 'no'].includes(scelta.toLowerCase());
  return scelta === true;
}

// Percorso del file dei limiti. CB_LIMITI lo sposta, che serve alle prove.
// ritorna: percorso del file
export function percorsoLimiti() {
  return process.env.CB_LIMITI || path.join(os.homedir(), '.claude', 'cb', 'limiti.json');
}

// Legge i limiti salvati dalla statusline.
// Un file assente, vuoto o illeggibile non e' un errore: significa solo che la
// statusline non e' stata agganciata, e non c'e' nessuna sveglia da armare.
// ritorna: { cinqueOre: {usato, resetIl}, setteGiorni: {...}, scrittoIl } | null
export function leggiLimiti() {
  try {
    const dati = JSON.parse(fs.readFileSync(percorsoLimiti(), 'utf8'));
    return dati && typeof dati === 'object' ? dati : null;
  } catch {
    return null;
  }
}

// Vero se la finestra delle cinque ore e' finita.
//
// Cento e non «quasi cento»: la coda si ferma quando i token **sono** finiti, non
// quando stanno per finire. Fermarsi prima vorrebbe dire decidere al posto di chi
// lavora che l'ultimo turno non vale la pena — e magari quel turno era corto.
//
// Il prezzo, dichiarato: se il CLI non arriva mai a segnare 100 esatto la
// sospensione non scatta, e la coda spende l'ultimo prompt su un turno che potrebbe
// morire a meta'. La percentuale e' l'unico segnale che c'e': cb non legge lo
// schermo, e nel transcript i limiti non compaiono.
// limiti: quelli di leggiLimiti(), o null
// ritorna: true se non c'e' piu' finestra
export function limiteEsaurito(limiti) {
  const usato = limiti?.cinqueOre?.usato;
  // Una percentuale che non c'e' non e' uno zero: la statusline la omette finche'
  // non arriva la prima risposta dell'API, e li' non si sa niente.
  return typeof usato === 'number' && usato >= 100;
}

// L'istante in cui la finestra riparte, in millisecondi.
//
// Il CLI lo da' in secondi; qualche campo affine gira in millisecondi, quindi si
// riconosce dalla grandezza invece di fidarsi. Un reset gia' passato vale null:
// vuol dire che il file e' vecchio, e non c'e' niente da aspettare.
// limiti: quelli di leggiLimiti(), o null
// adesso: millisecondi correnti, per le prove
// ritorna: millisecondi epoch, o null
export function istanteReset(limiti, adesso = Date.now()) {
  const grezzo = limiti?.cinqueOre?.resetIl;
  if (typeof grezzo !== 'number' || !Number.isFinite(grezzo)) return null;
  const ms = grezzo > 1e12 ? grezzo : grezzo * 1000;
  return ms > adesso ? ms : null;
}

// L'ora del reset come si legge, nel fuso di chi guarda. Serve al diagnosi.log:
// «fra 4200s» non dice niente, «alle 17:50» si controlla con un'occhiata.
// ritorna: 'HH:MM', o null se non c'e' un reset da aspettare
export function oraReset(limiti, adesso = Date.now()) {
  const quando = istanteReset(limiti, adesso);
  if (quando === null) return null;
  const data = new Date(quando);
  return `${String(data.getHours()).padStart(2, '0')}:${String(data.getMinutes()).padStart(2, '0')}`;
}

// Quanto manca al reset, in millisecondi, con un tetto.
//
// Il tetto serve perche' `setTimeout` sopra i 2^31-1 ms scatta subito: il numero
// va in overflow e diventa negativo. Un valore assurdo nel file — un epoch
// sbagliato di anni — trasformerebbe l'attesa in una sveglia immediata, cioe'
// esattamente il contrario. Oltre il tetto si riguarda piu' tardi.
// ritorna: millisecondi da aspettare, o null se non c'e' niente da aspettare
export function attesaFinoAlReset(limiti, adesso = Date.now()) {
  const quando = istanteReset(limiti, adesso);
  if (quando === null) return null;
  const MASSIMO = 6 * 60 * 60 * 1000; // sei ore: piu' della finestra stessa
  return Math.min(quando - adesso, MASSIMO);
}
