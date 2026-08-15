// I limiti d'uso dell'abbonamento: quanto ne resta, e quando la finestra riparte.
//
// Claude Code non li scrive nel transcript — verificato su una sessione da 10 MB,
// dove non compaiono affatto — e cb non legge mai lo schermo. L'unica fonte
// ufficiale e' il JSON che il CLI passa sullo stdin del comando della statusline:
// `rate_limits.five_hour` porta `used_percentage` (0-100) e `resets_at`, che e'
// l'istante del reset in secondi epoch. La documentazione del CLI lo dice
// esplicitamente: «Only present for subscribers after first API response».
//
// Quel comando pero' lo esegue Claude, non cb. Chi scrive la statusline salva i
// numeri in un file, e cb li legge di li': e' un accordo fra i due, non un modo di
// spiare. Senza il file la funzione resta spenta, e cb si comporta come prima.
//
// Che sia un file e non una variabile: la statusline gira in un altro processo, e
// il wrapper deve poterlo leggere anche minuti dopo — soprattutto minuti dopo,
// visto che a limite esaurito Claude smette di aggiornare la barra e l'ultimo
// valore scritto e' l'unico che resta.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { impostazione } from './impostazioni.js';

// Oltre questa percentuale la finestra si considera finita. Non 100: fra l'ultimo
// aggiornamento della barra e il prompt che parte c'e' sempre un margine, e un
// turno che comincia al 99% muore a meta'. Si cambia con `sogliaLimite`.
const SOGLIA_PREDEFINITA = 95;

// Percorso del file dei limiti. CB_LIMITI lo sposta, che serve alle prove.
// ritorna: percorso del file
export function percorsoLimiti() {
  return process.env.CB_LIMITI || path.join(os.homedir(), '.claude', 'cb', 'limiti.json');
}

// Legge i limiti salvati dalla statusline.
// Un file assente, vuoto o illeggibile non e' un errore: significa solo che la
// statusline non e' stata agganciata, e la funzione resta spenta.
// ritorna: { cinqueOre: {usato, resetIl}, setteGiorni: {...}, scrittoIl } | null
export function leggiLimiti() {
  try {
    const testo = fs.readFileSync(percorsoLimiti(), 'utf8');
    const dati = JSON.parse(testo);
    return dati && typeof dati === 'object' ? dati : null;
  } catch {
    return null;
  }
}

// Vero se la finestra delle 5 ore e' esaurita (o quasi).
//
// Si guarda solo quella: e' la finestra che si esaurisce davvero in una sessione
// di lavoro, mentre quella dei 7 giorni, quando finisce, non riparte in un'attesa
// che abbia senso aspettare col processo aperto.
// limiti: quelli di leggiLimiti(), o null
// ritorna: true se conviene fermarsi
export function limiteEsaurito(limiti) {
  const usato = limiti?.cinqueOre?.usato;
  if (typeof usato !== 'number') return false;
  const soglia = Number(impostazione('sogliaLimite', SOGLIA_PREDEFINITA));
  return usato >= soglia;
}

// L'istante in cui la finestra delle 5 ore riparte, in millisecondi.
//
// Il CLI lo da' in secondi; qualche campo affine gira in millisecondi, quindi si
// riconosce dalla grandezza invece di fidarsi. Un reset gia' passato vale null:
// vuol dire che il file e' vecchio e non c'e' niente da aspettare.
// limiti: quelli di leggiLimiti(), o null
// adesso: millisecondi correnti, per le prove
// ritorna: millisecondi epoch, o null
export function istanteReset(limiti, adesso = Date.now()) {
  const grezzo = limiti?.cinqueOre?.resetIl;
  if (typeof grezzo !== 'number' || !Number.isFinite(grezzo)) return null;
  const ms = grezzo > 1e12 ? grezzo : grezzo * 1000;
  return ms > adesso ? ms : null;
}

// L'ora del reset come si legge a schermo, nel fuso di chi guarda.
//
// Solo l'ora e i minuti: la finestra e' di cinque ore, quindi il giorno non serve
// mai, e una data intera in una riga di stato ruba spazio a quello che cambia.
// ritorna: 'HH:MM', o null se non c'e' un reset da aspettare
export function oraReset(limiti, adesso = Date.now()) {
  const quando = istanteReset(limiti, adesso);
  if (quando === null) return null;
  const data = new Date(quando);
  return `${String(data.getHours()).padStart(2, '0')}:${String(data.getMinutes()).padStart(2, '0')}`;
}

// Quanto manca al reset, in millisecondi, con un tetto.
//
// Il tetto serve perche' `setTimeout` sopra i 2^31-1 ms scatta subito (il numero
// va in overflow e diventa negativo): un valore assurdo nel file — un epoch
// sbagliato di anni — trasformerebbe l'attesa in una sveglia immediata, cioe'
// esattamente il contrario. Oltre il tetto si riprova piu' tardi.
// ritorna: millisecondi da aspettare, o null se non c'e' niente da aspettare
export function attesaFinoAlReset(limiti, adesso = Date.now()) {
  const quando = istanteReset(limiti, adesso);
  if (quando === null) return null;
  const MASSIMO = 6 * 60 * 60 * 1000; // sei ore: piu' della finestra stessa
  return Math.min(quando - adesso, MASSIMO);
}
