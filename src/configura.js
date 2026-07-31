// Schermata delle impostazioni, quella che compare al primo avvio: lingua,
// cartella di lavoro, scorciatoia che apre l'albero.
//
// Compare una volta sola perche' e' l'unico momento in cui queste tre domande
// hanno senso tutte insieme. Dopo si torna con `cb --impostazioni`, e chi
// preferisce le variabili d'ambiente continua a usarle: hanno la precedenza sul
// file (vedi `impostazione` in impostazioni.js).
//
// Come i due selettori, il disegno e' una funzione pura e i tasti sono
// un'applicazione di azioni sullo stato: cosi' la schermata si prova senza un
// terminale vero.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { azioniNavigazione, azioniTesto } from './tasti.js';
import { arancioneForte, grigio, normale, rosso } from './stile.js';
import { radicePredefinita } from './cartelle.js';
import { LINGUE, SCORCIATOIE, impostazione, scriviImpostazioni } from './impostazioni.js';
import { T } from './lingua.js';

// Righe della schermata, nell'ordine in cui si presentano. 'fatto' non e'
// un'impostazione: e' la riga che chiude, e sta in fondo perche' invio faccia
// cose diverse a seconda di dove sei senza che il significato cambi — invio
// agisce sempre "su questa riga".
const VOCI = ['lingua', 'radice', 'scorciatoia', 'fatto'];

// Larghezza della colonna delle etichette, per incolonnare i valori.
const COLONNA = 20;

// Stato di partenza: i valori in vigore adesso, cosi' la schermata non propone
// mai qualcosa di diverso da quello che cb sta gia' facendo.
// ritorna: { indice, valori }
// Espande la tilde iniziale: la schermata mostra i percorsi con `~`, quindi deve
// anche accettarli riscritti cosi'. Solo in testa — una tilde in mezzo e' un nome
// di cartella come un altro.
// testo: percorso digitato
// ritorna: percorso assoluto
export function espandiTilde(testo) {
  const pulito = testo.trim();
  if (pulito === '~') return os.homedir();
  if (pulito.startsWith('~/') || pulito.startsWith('~\\')) {
    return path.join(os.homedir(), pulito.slice(2));
  }
  return pulito;
}

export function statoIniziale() {
  return {
    indice: 0,
    // Non null quando si sta scrivendo il percorso: e' il testo digitato finora.
    modifica: null,
    valori: {
      lingua: LINGUE.includes(impostazione('lingua', '')) ? impostazione('lingua', '') : LINGUE[0],
      radice: impostazione('radice', radicePredefinita()),
      scorciatoia: impostazione('scorciatoia', SCORCIATOIE[0]),
    },
  };
}

// Passa al valore successivo (o precedente) di una voce che ha una rosa di
// scelte. La cartella non ne ha una: si sceglie con l'albero delle cartelle.
// valori: valori correnti
// voce: 'lingua' | 'scorciatoia'
// passo: +1 o -1
function ruota(valori, voce, passo) {
  const rosa = voce === 'lingua' ? LINGUE : SCORCIATOIE;
  const attuale = rosa.indexOf(valori[voce]);
  const prossimo = (attuale + passo + rosa.length) % rosa.length;
  return { ...valori, [voce]: rosa[prossimo] };
}

// Applica un'azione della tastiera allo stato. Muta `stato`, come negli altri
// selettori.
// azione: una delle stringhe prodotte da azioniNavigazione
// ritorna: { esito } — 'continua' | 'fatto'
export function applicaAzione(stato, azione) {
  const voce = VOCI[stato.indice];

  switch (azione) {
    case 'su':
      stato.indice = (stato.indice - 1 + VOCI.length) % VOCI.length;
      break;
    case 'giu':
      stato.indice = (stato.indice + 1) % VOCI.length;
      break;
    case 'destra':
      if (voce === 'lingua' || voce === 'scorciatoia') stato.valori = ruota(stato.valori, voce, 1);
      break;
    case 'sinistra':
      if (voce === 'lingua' || voce === 'scorciatoia') stato.valori = ruota(stato.valori, voce, -1);
      break;
    case 'conferma':
      // Invio agisce sulla riga: sulla cartella apre il campo dove scriverla,
      // sulle voci a rosa fa avanzare come la freccia, su "fatto" chiude.
      if (voce === 'fatto') return { esito: 'fatto' };
      if (voce === 'radice') {
        // Si parte dal percorso in vigore: chi vuole cambiarlo di poco corregge
        // invece di riscriverlo tutto.
        stato.modifica = stato.valori.radice;
        break;
      }
      stato.valori = ruota(stato.valori, voce, 1);
      break;
    case 'annulla':
      // Esc non annulla: tiene quello che si vede. Le impostazioni hanno sempre
      // un valore valido, e richiedere la schermata a ogni avvio finche' non la
      // si completa sarebbe una molestia, non un aiuto.
      return { esito: 'fatto' };
    default:
      break;
  }

  return { esito: 'continua' };
}

// Applica un tasto mentre si sta scrivendo il percorso.
// Invio conferma quello che si e' scritto, Esc lascia il percorso di prima: sono
// le due uscite che ci si aspetta da un campo di testo, e non chiudono la
// schermata — si torna all'elenco delle impostazioni.
// azione: uno degli oggetti prodotti da azioniTesto
// ritorna: { esito } — sempre 'continua', il campo non chiude la schermata
export function applicaTesto(stato, azione) {
  switch (azione.tipo) {
    case 'carattere':
      stato.modifica += azione.valore;
      break;
    case 'cancella':
      stato.modifica = stato.modifica.slice(0, -1);
      break;
    case 'invio': {
      // Un campo lasciato vuoto non e' una scelta: si tiene quello di prima.
      const scritto = espandiTilde(stato.modifica);
      if (scritto) stato.valori = { ...stato.valori, radice: scritto };
      stato.modifica = null;
      break;
    }
    case 'annulla':
      stato.modifica = null;
      break;
    default:
      break;
  }

  return { esito: 'continua' };
}

// Valore mostrato accanto a un'etichetta.
// valori: valori correnti; voce: riga da descrivere
// ritorna: testo del valore, o stringa vuota per "fatto"
function valoreMostrato(valori, voce) {
  if (voce === 'lingua') return T.configura.nomiLingua[valori.lingua] ?? valori.lingua;
  if (voce === 'scorciatoia') return valori.scorciatoia;
  if (voce === 'radice') return valori.radice.replace(os.homedir(), '~');
  return '';
}

// Compone la schermata intera.
// Funzione pura come `disegna` in cartelle.js: si guarda senza terminale e si
// prova senza premere tasti.
// stato: { indice, valori }
// ritorna: array di righe pronte da scrivere
export function disegnaImpostazioni(stato, altezza = 30, larghezza = 100) {
  // Si taglia il testo **prima** di colorarlo: tagliare una riga gia' colorata
  // spezzerebbe una sequenza ANSI a meta' e il terminale resterebbe tinto.
  const taglia = (testo) => (testo.length > larghezza ? testo.slice(0, larghezza) : testo);

  const righe = [
    `  ${arancioneForte('cb')}  ${normale(taglia(T.configura.titolo))}`,
    grigio(taglia(`  ${T.configura.sottotitolo}`)),
    '',
  ];

  const scrivendo = stato.modifica !== null;

  VOCI.forEach((voce, i) => {
    const scelta = i === stato.indice;
    const etichetta = T.configura.voci[voce];
    // "fatto" e' un'azione, non una coppia etichetta/valore: sta da sola, e una
    // riga vuota sopra la stacca dalle impostazioni.
    if (voce === 'fatto') righe.push('');

    // Mentre si scrive, la riga della cartella mostra il testo digitato con un
    // cursore in coda: e' l'unico segnale che i tasti stanno finendo li'.
    if (voce === 'radice' && scrivendo) {
      const campo = `  ▸ ${etichetta.padEnd(COLONNA)}${stato.modifica}█`;
      righe.push(arancioneForte(taglia(campo)));
      return;
    }

    const valore = valoreMostrato(stato.valori, voce);

    // Il suggerimento sta solo sulla riga selezionata: e' un aiuto per chi ci sta
    // sopra adesso, e su tutte le righe sarebbe rumore.
    const suggerimento =
      !scelta || scrivendo
        ? ''
        : voce === 'radice'
          ? `   ${T.configura.scegliCartella}`
          : voce === 'scorciatoia' && stato.valori.scorciatoia === SCORCIATOIE[0]
            ? `   (${T.configura.consigliata})`
            : '';

    const testo = valore
      ? `  ${scelta && !scrivendo ? '▸' : ' '} ${etichetta.padEnd(COLONNA)}${valore}${suggerimento}`
      : `  ${scelta && !scrivendo ? '▸' : ' '} ${etichetta}`;
    righe.push(scelta && !scrivendo ? arancioneForte(taglia(testo)) : normale(taglia(testo)));
  });

  // Una cartella che non c'e' non e' un errore da bloccare — puo' nascere dopo —
  // ma tacerla lascerebbe l'utente con un selettore vuoto e nessuna spiegazione.
  if (!scrivendo && !fs.existsSync(stato.valori.radice)) {
    righe.push('', rosso(taglia(`  ${T.configura.nonEsiste}`)));
  }

  // La legenda in fondo allo schermo, come negli altri selettori: l'elenco e'
  // corto e fisso, ma il posto della legenda dev'essere sempre lo stesso.
  const varianti = scrivendo ? T.configura.legendeTesto : T.configura.legende;
  const legenda =
    varianti.find((testo) => testo.length + 2 <= larghezza) ?? varianti[varianti.length - 1];
  while (righe.length < altezza - 1) righe.push('');
  righe.push(`  ${grigio(taglia(legenda))}`);

  return righe.slice(0, altezza);
}

// Mostra la schermata e salva quello che si sceglie.
// Usa lo schermo alternativo come gli altri selettori, cosi' alla chiusura il
// terminale torna com'era.
// ritorna: Promise<{ lingua, radice, scorciatoia }> — sempre un valore, mai null
export function configura({ ingresso = process.stdin, uscita = process.stdout } = {}) {
  const stato = statoIniziale();

  return new Promise((risolvi) => {
    const ridisegna = () => {
      const righe = disegnaImpostazioni(stato, uscita.rows || 30, uscita.columns || 100);
      uscita.write(`\x1b[H\x1b[2J${righe.join('\r\n')}`);
    };

    // Rimette il terminale come lo aveva trovato e restituisce le impostazioni.
    const chiudi = () => {
      ingresso.removeListener('data', suDati);
      uscita.removeListener('resize', ridisegna);
      if (ingresso.isTTY) ingresso.setRawMode(false);
      ingresso.pause();
      uscita.write('\x1b[?25h\x1b[?1049l');
      scriviImpostazioni(stato.valori);
      risolvi(stato.valori);
    };

    // Quale tokenizzatore usare dipende da dove siamo: mentre si scrive un
    // percorso le lettere sono lettere, fuori di li' w/a/s/d sono le frecce.
    // Va deciso a ogni lettura, non una volta sola: si entra e si esce dal campo
    // senza che il ciclo cambi.
    const suDati = (dati) => {
      if (stato.modifica !== null) {
        for (const azione of azioniTesto(dati)) applicaTesto(stato, azione);
        return ridisegna();
      }

      for (const azione of azioniNavigazione(dati)) {
        const { esito } = applicaAzione(stato, azione);
        if (esito === 'fatto') return chiudi();
        // Invio sulla cartella apre il campo: da qui in poi i tasti sono testo,
        // e quelli rimasti in questa stessa lettura non vanno interpretati come
        // navigazione.
        if (stato.modifica !== null) break;
      }
      ridisegna();
    };

    uscita.write('\x1b[?1049h\x1b[?25l');
    if (ingresso.isTTY) ingresso.setRawMode(true);
    ingresso.resume();
    ingresso.on('data', suDati);
    uscita.on('resize', ridisegna);
    ridisegna();
  });
}

// Prova della schermata senza avviare Claude: `node src/configura.js`.
// Scrive su un file di prova, non sulle impostazioni vere.
if (import.meta.main) {
  process.env.CB_IMPOSTAZIONI ??= `${os.tmpdir()}/cb-impostazioni-prova.json`;
  console.log(await configura());
  console.log(`salvate in ${process.env.CB_IMPOSTAZIONI}`);
}
