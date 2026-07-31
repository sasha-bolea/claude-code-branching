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

import os from 'node:os';
import { azioniNavigazione } from './tasti.js';
import { arancione, arancioneForte, grigio, normale } from './stile.js';
import { radicePredefinita, selezionaCartella } from './cartelle.js';
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
export function statoIniziale() {
  return {
    indice: 0,
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
// ritorna: { esito } — 'continua' | 'fatto' | 'cartella'
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
      // Invio agisce sulla riga: sulla cartella apre l'albero, sulle voci a rosa
      // fa avanzare come la freccia, su "fatto" chiude.
      if (voce === 'fatto') return { esito: 'fatto' };
      if (voce === 'radice') return { esito: 'cartella' };
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

  VOCI.forEach((voce, i) => {
    const scelta = i === stato.indice;
    const etichetta = T.configura.voci[voce];
    const valore = valoreMostrato(stato.valori, voce);
    // "fatto" e' un'azione, non una coppia etichetta/valore: sta da sola, e una
    // riga vuota sopra la stacca dalle impostazioni.
    if (voce === 'fatto') righe.push('');

    // Il suggerimento sta solo sulla riga selezionata: e' un aiuto per chi ci sta
    // sopra adesso, e su tutte le righe sarebbe rumore.
    const suggerimento = !scelta
      ? ''
      : voce === 'radice'
        ? `   ${T.configura.scegliCartella}`
        : voce === 'scorciatoia' && stato.valori.scorciatoia === SCORCIATOIE[0]
          ? `   (${T.configura.consigliata})`
          : '';

    const testo = valore
      ? `  ${scelta ? '▸' : ' '} ${etichetta.padEnd(COLONNA)}${valore}${suggerimento}`
      : `  ${scelta ? '▸' : ' '} ${etichetta}`;
    righe.push(scelta ? arancioneForte(taglia(testo)) : normale(taglia(testo)));
  });

  // La legenda in fondo allo schermo, come negli altri selettori: l'elenco e'
  // corto e fisso, ma il posto della legenda dev'essere sempre lo stesso.
  const legenda =
    T.configura.legende.find((testo) => testo.length + 2 <= larghezza) ??
    T.configura.legende[T.configura.legende.length - 1];
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

    // L'albero delle cartelle si prende lo stdin e alla chiusura lo lascia com'era
    // (raw mode spento, flusso in pausa): va rimesso come lo vuole questa
    // schermata, o i tasti non arrivano piu'.
    const apriCartelle = async () => {
      ingresso.removeListener('data', suDati);
      const scelta = await selezionaCartella({ radice: stato.valori.radice, ingresso, uscita });
      if (scelta) stato.valori = { ...stato.valori, radice: scelta.percorso };
      uscita.write('\x1b[?1049h\x1b[?25l');
      if (ingresso.isTTY) ingresso.setRawMode(true);
      ingresso.resume();
      ingresso.on('data', suDati);
      ridisegna();
    };

    const suDati = (dati) => {
      for (const azione of azioniNavigazione(dati)) {
        const { esito } = applicaAzione(stato, azione);
        if (esito === 'fatto') return chiudi();
        if (esito === 'cartella') return void apriCartelle();
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
