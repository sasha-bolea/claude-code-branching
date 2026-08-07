// La coda dei prompt: quello che vuoi chiedere dopo, scritto mentre Claude sta
// ancora rispondendo.
//
// Il problema che risolve: un prompt mandato a turno in corso si accoda da solo,
// ma **quando** entri nel contesto lo decide Claude, non tu — te ne accorgi
// perche' l'indicatore di caricamento resta sopra quello che hai appena scritto,
// e l'unico modo di forzarlo e' Esc. Qui i prompt li tieni tu, in un elenco che
// vedi, e partono uno per turno.
//
// Consegna: l'hook `Stop` (hooks/cb-coda.ps1) prende il primo della coda e
// risponde `{"decision":"block","reason":<prompt>}`. Quel `decision` impedisce a
// Claude di fermarsi e gli passa il testo, che riprende a lavorare. E' l'unico
// aggancio che gli hook offrono, e ha una conseguenza dichiarata: il prompt
// arriva come motivo del blocco, **non** come un record `user` del transcript.
// Nell'albero dei rami non diventa quindi un nodo, e da li' non si riparte.
//
// La coda e' legata alla singola sessione — due finestre sulla stessa cartella
// non si rubano i prompt — e per questo va spostata a mano quando l'id cambia:
// lo fa `trasferisci`, chiamata dal wrapper a ogni cambio di sessione (/clear e
// cambio ramo).
//
// Ogni operazione rilegge il file prima di scriverlo, e non tiene un elenco in
// memoria: mentre la schermata e' aperta l'hook puo' scattare e togliere il
// primo prompt, e una scrittura basata su quello che c'era all'apertura lo
// rimetterebbe in coda gia' consegnato.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { azioniCoda } from './tasti.js';
import { T } from './lingua.js';
import { arancione, arancioneForte, bianco, grigio, normale } from './stile.js';

// Cartella delle code, accanto alle altre cose di cb. La variabile CB_CODA ha la
// precedenza: serve alle prove, che non devono scrivere sulle code vere.
// ritorna: percorso della cartella
export function cartellaCode() {
  return process.env.CB_CODA || path.join(os.homedir(), '.claude', 'cb', 'coda');
}

// File della coda di una sessione.
// sessione: id della sessione
// ritorna: percorso del .json
export function percorsoCoda(sessione) {
  return path.join(cartellaCode(), `${sessione}.json`);
}

// Prompt in attesa, dal primo che partira' all'ultimo.
// Un file assente, illeggibile o corrotto vale come coda vuota: la coda e' una
// comodita', e non deve poter impedire niente.
// sessione: id della sessione
// ritorna: array di stringhe
export function leggiCoda(sessione) {
  if (!sessione) return [];
  try {
    const dati = JSON.parse(fs.readFileSync(percorsoCoda(sessione), 'utf8'));
    return Array.isArray(dati?.prompt) ? dati.prompt.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

// Scrive la coda, creando la cartella se manca. Una coda vuota si cancella
// invece di restare come file: e' cosi' che la pulizia non trova avanzi, e che
// l'hook capisce a colpo d'occhio che non c'e' niente da mandare.
// sessione: id della sessione
// prompt: array di stringhe
export function scriviCoda(sessione, prompt) {
  if (!sessione) return;
  const percorso = percorsoCoda(sessione);
  if (prompt.length === 0) {
    try {
      fs.unlinkSync(percorso);
    } catch {
      // gia' assente: e' lo stato che volevamo
    }
    return;
  }
  fs.mkdirSync(path.dirname(percorso), { recursive: true });
  fs.writeFileSync(percorso, `${JSON.stringify({ prompt }, null, 2)}\n`, 'utf8');
}

// Aggiunge un prompt in fondo. Il testo vuoto non si accoda: sarebbe un turno
// speso per niente.
// sessione: id della sessione
// testo: prompt da accodare
// ritorna: la coda aggiornata
export function accoda(sessione, testo) {
  const pulito = testo.trim();
  if (!pulito) return leggiCoda(sessione);
  const prompt = [...leggiCoda(sessione), pulito];
  scriviCoda(sessione, prompt);
  return prompt;
}

// Toglie il prompt in una posizione. Un indice fuori dall'elenco non fa niente:
// puo' capitare se l'hook ha consegnato il primo mentre il cursore stava in
// fondo.
// sessione: id della sessione
// indice: posizione da togliere
// ritorna: la coda aggiornata
export function togli(sessione, indice) {
  const prompt = leggiCoda(sessione);
  if (indice < 0 || indice >= prompt.length) return prompt;
  prompt.splice(indice, 1);
  scriviCoda(sessione, prompt);
  return prompt;
}

// Sposta la coda da una sessione all'altra.
//
// Serve perche' la coda e' legata all'id di sessione, e in cb quell'id cambia
// spesso: un /clear fa nascere un file nuovo, e ogni cambio ramo crea una
// sessione troncata. Senza lo spostamento i prompt scritti resterebbero appesi a
// una sessione che non riceve piu' hook, cioe' sparirebbero senza dirlo.
//
// Se la sessione di arrivo ha gia' una coda, le due si uniscono: prima quelli
// che c'erano di la', perche' erano gia' in attesa.
// da: id di partenza
// a: id di arrivo
export function trasferisci(da, a) {
  if (!da || !a || da === a) return;
  const partenza = leggiCoda(da);
  if (partenza.length === 0) return;
  scriviCoda(a, [...leggiCoda(a), ...partenza]);
  scriviCoda(da, []);
}

// Accorcia un prompt a una riga sola, per l'elenco.
// testo: prompt intero
// larghezza: colonne disponibili
// ritorna: testo su una riga
function suUnaRiga(testo, larghezza) {
  const pulito = testo.replace(/\s+/g, ' ').trim();
  return pulito.length > larghezza ? `${pulito.slice(0, Math.max(1, larghezza - 1))}…` : pulito;
}

// Compone la schermata intera.
// Funzione pura come `disegna` in cartelle.js: si guarda senza terminale e si
// prova senza premere tasti.
// stato: { prompt, indice, testo }
// ritorna: array di righe pronte da scrivere
export function disegnaCoda(stato, { colonne = 100, altezza = 30 } = {}) {
  const larghezza = Math.max(20, colonne - 4);
  const taglia = (testo) => (testo.length > larghezza ? testo.slice(0, larghezza) : testo);

  const righe = [
    `  ${arancioneForte('cb')}  ${normale(taglia(T.coda.titolo))}`,
    `  ${grigio(taglia(T.coda.sottotitolo))}`,
    '',
  ];

  if (stato.prompt.length === 0) {
    righe.push(`  ${grigio(taglia(T.coda.vuota))}`);
  } else {
    righe.push(`  ${normale(taglia(T.coda.quanti(stato.prompt.length)))}`, '');
    // Il numero dice l'ordine di partenza, e il primo porta scritto che e' il
    // prossimo: senza, l'ordine andrebbe dedotto dalla numerazione.
    stato.prompt.forEach((prompt, i) => {
      const scelto = i === stato.indice;
      const nota = i === 0 ? `  ${T.coda.prossimo}` : '';
      const spazio = Math.max(10, larghezza - 6 - nota.length);
      const riga = `  ${scelto ? '▸' : ' '} ${String(i + 1).padStart(2)}. ${suUnaRiga(prompt, spazio)}`;
      righe.push(scelto ? arancioneForte(taglia(riga + nota)) : normale(taglia(riga + nota)));
    });
  }

  // Il campo dove si scrive, con il cursore in coda: e' l'unico segnale che i
  // tasti stanno finendo li' dentro e non nell'elenco.
  righe.push('', `  ${arancione('>')} ${bianco(taglia(stato.testo))}${arancioneForte('█')}`);

  // La legenda in fondo allo schermo, come in ogni altra schermata: l'elenco
  // cresce a ogni prompt accodato, e una legenda che scende si legge peggio.
  const legenda =
    T.coda.legende.find((testo) => testo.length + 2 <= larghezza) ??
    T.coda.legende[T.coda.legende.length - 1];
  while (righe.length < altezza - 2) righe.push('');
  righe.push(`  ${grigio('─'.repeat(larghezza))}`, `  ${grigio(taglia(legenda))}`);

  return righe.slice(0, altezza);
}

// Mostra la coda e la lascia modificare, finche' non si esce con Esc.
//
// Come gli altri selettori si prende lo stdin e alla chiusura lo lascia com'era:
// e' il chiamante a rimetterlo come lo vuole (vedi wrapper.js).
//
// L'elenco si rilegge dal disco a ogni tasto e non si tiene in memoria: mentre
// la schermata e' aperta Claude sta lavorando, e a fine turno l'hook toglie il
// primo prompt. Tenendo l'elenco in memoria, il primo carattere digitato dopo
// quella consegna lo avrebbe rimesso in coda.
// sessione: id della sessione a cui la coda appartiene
// ritorna: Promise<'indietro' | 'esci'> — dove deve andare chi ci ha chiamato:
//          Esc risale di un passo, Canc esce dall'interfaccia e torna a Claude
export function apriCoda({ sessione, ingresso = process.stdin, uscita = process.stdout } = {}) {
  const stato = { prompt: leggiCoda(sessione), indice: 0, testo: '' };

  return new Promise((risolvi) => {
    const ridisegna = () => {
      stato.prompt = leggiCoda(sessione);
      stato.indice = Math.min(stato.indice, Math.max(0, stato.prompt.length - 1));
      const righe = disegnaCoda(stato, { colonne: uscita.columns || 100, altezza: uscita.rows || 30 });
      uscita.write(`\x1b[H\x1b[2J${righe.join('\r\n')}`);
    };

    const chiudi = (dove) => {
      ingresso.removeListener('data', suDati);
      uscita.removeListener('resize', ridisegna);
      if (ingresso.isTTY) ingresso.setRawMode(false);
      ingresso.pause();
      uscita.write('\x1b[?25h\x1b[?1049l'); // cursore visibile, schermo normale
      risolvi(dove);
    };

    const suDati = (dati) => {
      for (const azione of azioniCoda(dati)) {
        if (azione.tipo === 'annulla') return chiudi('indietro');
        if (azione.tipo === 'esci') return chiudi('esci');
        if (azione.tipo === 'invio') {
          stato.prompt = accoda(sessione, stato.testo);
          stato.testo = '';
        } else if (azione.tipo === 'cancella') {
          stato.testo = stato.testo.slice(0, -1);
        } else if (azione.tipo === 'togli') {
          stato.prompt = togli(sessione, stato.indice);
        } else if (azione.tipo === 'carattere') {
          stato.testo += azione.valore;
        } else if (azione.tipo === 'freccia') {
          if (azione.valore === 'su') stato.indice = Math.max(0, stato.indice - 1);
          else if (azione.valore === 'giu') {
            stato.indice = Math.min(Math.max(0, stato.prompt.length - 1), stato.indice + 1);
          }
        }
      }
      ridisegna();
    };

    uscita.write('\x1b[?1049h\x1b[?25l'); // schermo alternativo, cursore nascosto
    if (ingresso.isTTY) ingresso.setRawMode(true);
    ingresso.resume();
    ingresso.on('data', suDati);
    uscita.on('resize', ridisegna);
    ridisegna();
  });
}

// Prova della schermata senza avviare Claude: `node src/coda.js [sessione]`.
// Come anteprima.js: si guarda l'interfaccia vera, e i prompt finiscono in una
// coda di prova invece che in quella di una sessione reale.
if (process.argv[1] && process.argv[1].endsWith('coda.js')) {
  process.env.CB_CODA = process.env.CB_CODA || path.join(os.tmpdir(), 'cb-coda-prova');
  await apriCoda({ sessione: process.argv[2] ?? 'prova' });
}
