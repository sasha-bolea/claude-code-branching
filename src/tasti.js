import { T } from './lingua.js';

const ESC = 0x1b;

// Millisecondi di attesa dopo il primo Esc per capire se ne arriva un secondo.
// Trattenere il primo Esc e' necessario: se lo inoltrassimo subito, Claude
// aprirebbe il proprio menu di ripristino prima che il secondo arrivi. Il costo
// e' questo ritardo su un Esc singolo (interruzione), e il fatto che due Esc
// battuti piu' lenti di cosi' non contino come scorciatoia.
//
// Sta qui e non nel wrapper perche' la schermata delle impostazioni lo nomina
// nell'avviso su «esc esc», e il numero deve essere uno solo: importare il
// wrapper da li' tirerebbe dentro node-pty per una costante.
export const ATTESA_DOPPIO_ESC = 300;

// Entro quanto una pressione vale ancora come parte della scorciatoia, **anche
// se la precedente e' gia' stata inoltrata**.
//
// Scaduta l'attesa qui sopra, cb manda il primo Esc a Claude e per non perdere
// l'interruzione deve farlo. Ma azzerando li' il conteggio, due Esc battuti piu'
// piano diventavano due Esc singoli inoltrati a distanza — e Claude, che ha una
// finestra sua piu' larga, li rimetteva insieme e apriva il **suo** menu. Cioe'
// esattamente quello che cb esiste per sostituire.
//
// Contando le pressioni per un secondo intero, la coppia lenta la prende cb: il
// secondo Esc non viene inoltrato, Claude ne ha visto uno solo e non apre
// niente. Il prezzo e' che due interruzioni battute a meno di un secondo l'una
// dall'altra aprono l'albero: chi le vuole davvero usa un tasto funzione.
export const FINESTRA_SCORCIATOIA = 1000;

// Esc in codifica kitty, con eventuali modificatori: ESC[27u, ESC[27;1u, …
const RE_ESC_KITTY = /^\x1b\[27(;[0-9:]+)?u/;

// Sequenza win32-input-mode: ESC[Vk;Sc;Uc;Kd;Cs;Rc_
// Claude la abilita all'avvio (invia ESC[?9001h) e su Windows e' questa la
// codifica che il terminale usa davvero: ogni tasto arriva come sequenza che
// termina con "_", e arrivano anche gli eventi di rilascio.
//   Vk = codice tasto virtuale   Uc = carattere unicode
//   Kd = 1 pressione, 0 rilascio  Cs = stato dei modificatori
const RE_WIN32 = /^\x1b\[(\d*);(\d*);(\d*);(\d*);(\d*);(\d*)_/;

// Bit dello stato modificatori di Windows (ControlKeyState).
const ALT_PREMUTO = 0x0003; // destro | sinistro
const CTRL_PREMUTO = 0x000c; // destro | sinistro
const SHIFT_PREMUTO = 0x0010;

export const VK_ESCAPE = 27;
// Codici virtuali delle frecce: sono quelli che manda win32-input-mode, e li
// riusiamo anche per le frecce in codifica ANSI, cosi' a valle la codifica non
// si vede piu'.
export const VK_SINISTRA = 37;
export const VK_SU = 38;
export const VK_DESTRA = 39;
export const VK_GIU = 40;

// Frecce nelle codifiche ANSI: CSI (ESC[A) e SS3 (ESCOA). Sono quelle che arrivano
// quando win32-input-mode non e' attivo (terminali Unix, o Claude non ancora
// avviato). Il gruppo di cifre accetta i modificatori (ESC[1;5C = ctrl+destra) e
// li ignora: per navigare l'albero non servono.
const RE_FRECCIA = /^\x1b(?:\[[0-9;]*|O)([ABCD])/;
const VK_DELLA_FRECCIA = { A: VK_SU, B: VK_GIU, C: VK_DESTRA, D: VK_SINISTRA };

// Codice virtuale del primo tasto funzione: VK_F2 = VK_F1 + 1, e cosi' via.
const VK_F1 = 0x70;

// Tasti funzione in codifica ANSI, nelle due forme che manda un terminale:
// SS3 per i primi quattro (ESC OP..ESC OS) e CSI numerico per tutti
// (ESC[11~ = F1). La numerazione CSI ha due buchi storici, 16 e 22, quindi la
// corrispondenza si scrive per esteso invece di calcolarla.
const RE_TASTO_FUNZIONE = /^\x1b(?:O([PQRS])|\[(\d{1,2})(?:;[0-9:]+)?~)/;
const F_DA_SS3 = { P: 1, Q: 2, R: 3, S: 4 };
const F_DA_CSI = {
  11: 1, 12: 2, 13: 3, 14: 4, 15: 5, 17: 6, 18: 7, 19: 8,
  20: 9, 21: 10, 23: 11, 24: 12,
};

// Descrive un tasto in modo indipendente dalla codifica del terminale.
// vk: codice virtuale (VK_ESCAPE, 71 per G, …)
// carattere: carattere prodotto, minuscolo, se applicabile
// grezzo: lo stesso carattere come e' stato digitato, maiuscole comprese —
//   serve a chi raccoglie testo (un percorso), dove "C:" e "c:" non sono la
//   stessa cosa; le scorciatoie continuano a confrontarsi su `carattere`
// ctrl/alt/shift: modificatori attivi
// rilascio: true se e' l'evento di rilascio invece della pressione
function tastoWin32(campi) {
  const [, vk, , uc, kd, cs] = campi;
  const stato = Number(cs || 0);
  const codice = Number(uc || 0);

  return {
    vk: Number(vk || 0),
    carattere: codice > 0 ? String.fromCharCode(codice).toLowerCase() : null,
    grezzo: codice > 0 ? String.fromCharCode(codice) : null,
    ctrl: (stato & CTRL_PREMUTO) !== 0,
    alt: (stato & ALT_PREMUTO) !== 0,
    shift: (stato & SHIFT_PREMUTO) !== 0,
    rilascio: kd === '0',
  };
}

// Divide i byte ricevuti dalla tastiera in token, riconoscendo i tasti nelle tre
// codifiche possibili: byte grezzi, kitty (ESC[27u) e win32-input-mode
// (ESC[…_). Necessario perche' i tasti premuti in rapida successione arrivano
// raggruppati in un'unica lettura: trattare il buffer come un tasto solo
// perderebbe il secondo.
// dati: Buffer letto da stdin
// ritorna: array di { tasto: descrittore|null, bytes: Buffer }
export function tokenizza(dati) {
  const token = [];
  let posizione = 0;
  let inizioAltro = -1;

  // Chiude l'eventuale blocco di byte non riconosciuti accumulato finora.
  const chiudiAltro = (fine) => {
    if (inizioAltro >= 0) {
      token.push({ tasto: null, bytes: dati.subarray(inizioAltro, fine) });
      inizioAltro = -1;
    }
  };

  // Registra un tasto riconosciuto e avanza.
  const aggiungi = (tasto, lunghezza) => {
    chiudiAltro(posizione);
    token.push({ tasto, bytes: dati.subarray(posizione, posizione + lunghezza) });
    posizione += lunghezza;
  };

  while (posizione < dati.length) {
    const resto = dati.subarray(posizione).toString('latin1');

    const win32 = RE_WIN32.exec(resto);
    if (win32) {
      aggiungi(tastoWin32(win32), win32[0].length);
      continue;
    }

    const freccia = RE_FRECCIA.exec(resto);
    if (freccia) {
      aggiungi(
        {
          vk: VK_DELLA_FRECCIA[freccia[1]],
          carattere: null,
          ctrl: false,
          alt: false,
          shift: false,
          rilascio: false,
        },
        freccia[0].length,
      );
      continue;
    }

    const funzione = RE_TASTO_FUNZIONE.exec(resto);
    if (funzione) {
      const numero = funzione[1] ? F_DA_SS3[funzione[1]] : F_DA_CSI[Number(funzione[2])];
      if (numero) {
        aggiungi(
          {
            vk: VK_F1 + numero - 1,
            carattere: null,
            ctrl: false,
            alt: false,
            shift: false,
            rilascio: false,
          },
          funzione[0].length,
        );
        continue;
      }
      // Numero CSI che non e' un tasto funzione (Ins, Canc, PagSu…): lo lascio
      // ai byte non riconosciuti, che vengono inoltrati a Claude intatti.
    }

    const kitty = RE_ESC_KITTY.exec(resto);
    if (kitty) {
      aggiungi(
        { vk: VK_ESCAPE, carattere: null, ctrl: false, alt: false, shift: false, rilascio: false },
        kitty[0].length,
      );
      continue;
    }

    // Un Esc grezzo e' il tasto Esc solo se non introduce una sequenza di
    // controllo (frecce = ESC[…, tasti funzione = ESCO…).
    if (dati[posizione] === ESC) {
      const successivo = dati[posizione + 1];
      const introduceSequenza = successivo === 0x5b || successivo === 0x4f; // '[' 'O'
      if (!introduceSequenza) {
        aggiungi(
          {
            vk: VK_ESCAPE,
            carattere: null,
            ctrl: false,
            alt: false,
            shift: false,
            rilascio: false,
          },
          1,
        );
        continue;
      }
    }

    if (inizioAltro < 0) inizioAltro = posizione;
    posizione += 1;
  }

  chiudiAltro(dati.length);
  return token;
}

// Interpreta la descrizione testuale di una scorciatoia.
// testo: es. "esc esc", "ctrl+g", "f2", "ctrl+shift+b"
// ritorna: { vk?, carattere?, ctrl, alt, shift, ripetizioni }
export function analizzaScorciatoia(testo) {
  const pezzi = testo.trim().toLowerCase().split(/\s+/);
  const ripetizioni = pezzi.length > 1 && pezzi.every((p) => p === pezzi[0]) ? pezzi.length : 1;
  const parti = pezzi[0].split('+');
  const tasto = parti.pop();

  const scorciatoia = {
    ctrl: parti.includes('ctrl'),
    alt: parti.includes('alt'),
    shift: parti.includes('shift'),
    ripetizioni,
  };

  if (tasto === 'esc') {
    scorciatoia.vk = VK_ESCAPE;
  } else if (/^f\d{1,2}$/.test(tasto)) {
    scorciatoia.vk = VK_F1 + Number(tasto.slice(1)) - 1;
  } else if (tasto.length === 1) {
    scorciatoia.carattere = tasto;
    scorciatoia.vk = tasto.toUpperCase().charCodeAt(0);
  } else {
    throw new Error(T.wrapper.scorciatoiaIgnota(testo));
  }

  return scorciatoia;
}

// Verifica se un tasto premuto corrisponde alla scorciatoia.
// Gli eventi di rilascio non contano come pressione.
// tasto: descrittore prodotto da tokenizza
// scorciatoia: risultato di analizzaScorciatoia
// ritorna: true se corrisponde
export function corrisponde(tasto, scorciatoia) {
  if (!tasto || tasto.rilascio) return false;
  if (tasto.ctrl !== scorciatoia.ctrl) return false;
  if (tasto.alt !== scorciatoia.alt) return false;
  // Shift viene ignorato per i tasti che lo richiedono per essere digitati.
  if (scorciatoia.shift && !tasto.shift) return false;

  if (tasto.vk === scorciatoia.vk) return true;
  // In alcune codifiche il vk non arriva: ripiego sul carattere prodotto.
  // Con Ctrl premuto il terminale invia il carattere di controllo (Ctrl+G = 7).
  if (scorciatoia.carattere && tasto.carattere) {
    if (tasto.carattere === scorciatoia.carattere) return true;
    const controllo = String.fromCharCode(
      scorciatoia.carattere.toUpperCase().charCodeAt(0) - 64,
    );
    if (scorciatoia.ctrl && tasto.carattere === controllo) return true;
  }
  return false;
}

const VK_INVIO = 13;
const VK_BACKSPACE = 8;

// Direzione associata a ogni freccia, per non far girare i codici virtuali
// fino a chi disegna l'albero.
const DIREZIONE = {
  [VK_SU]: 'su',
  [VK_GIU]: 'giu',
  [VK_SINISTRA]: 'sinistra',
  [VK_DESTRA]: 'destra',
};

// Le stesse direzioni sulle lettere: la mano resta dove sta a digitare, e su
// alcune tastiere le frecce sono scomode da raggiungere. Con Ctrl o Alt premuti
// non contano: sono scorciatoie, non movimenti.
const DIREZIONE_WASD = { w: 'su', s: 'giu', a: 'sinistra', d: 'destra' };

// Traduce i byte ricevuti in azioni per un campo dove si scrive testo libero.
//
// Separata da azioniTastiera perche' quella mappa w/a/s/d sulle direzioni: in un
// campo di testo servono come lettere, non come frecce. Qui passa qualsiasi
// carattere stampabile, e si usa `grezzo` invece di `carattere` perche' le
// maiuscole contano — in un percorso "C:" non e' "c:".
// dati: Buffer letto da stdin
// ritorna: array di { tipo: 'carattere'|'invio'|'cancella'|'annulla', valore? }
export function azioniTesto(dati) {
  const azioni = [];

  for (const voce of tokenizza(dati)) {
    if (voce.tasto) {
      if (voce.tasto.rilascio) continue;
      if (voce.tasto.vk === VK_INVIO) azioni.push({ tipo: 'invio' });
      else if (voce.tasto.vk === VK_BACKSPACE) azioni.push({ tipo: 'cancella' });
      else if (voce.tasto.vk === VK_ESCAPE) azioni.push({ tipo: 'annulla' });
      else if (voce.tasto.grezzo && !voce.tasto.ctrl && !voce.tasto.alt) {
        azioni.push({ tipo: 'carattere', valore: voce.tasto.grezzo });
      }
      continue;
    }

    // Blocco non riconosciuto: se comincia con ESC e' una sequenza di controllo
    // (frecce, mouse) e non e' testo.
    if (voce.bytes[0] === 0x1b) continue;
    for (const byte of voce.bytes) {
      if (byte === 0x0d || byte === 0x0a) azioni.push({ tipo: 'invio' });
      else if (byte === 0x7f || byte === 0x08) azioni.push({ tipo: 'cancella' });
      else if (byte === 0x03) azioni.push({ tipo: 'annulla' });
      else if (byte >= 0x20 && byte < 0x7f) {
        azioni.push({ tipo: 'carattere', valore: String.fromCharCode(byte) });
      }
    }
  }

  return azioni;
}

// Traduce i byte ricevuti in azioni per un campo di input testuale.
// Necessario perche' in win32-input-mode ogni evento tastiera comincia con
// 0x1b: leggere i byte grezzi farebbe scambiare per Esc anche il rilascio di un
// tasto qualsiasi, e farebbe leggere come cifre le coordinate del mouse.
// dati: Buffer letto da stdin
// Le lettere che non sono direzioni escono come 'lettera': servono alle caselle
// che si accendono con un tasto loro (la scelta ricordata, nel menu del
// ripristino). Chi non le usa le ignora, come ogni altro tipo che non gli
// riguarda.
// ritorna: array di { tipo: 'cifra'|'invio'|'cancella'|'annulla'|'freccia'|'lettera', valore? }
export function azioniTastiera(dati) {
  const azioni = [];

  for (const voce of tokenizza(dati)) {
    if (voce.tasto) {
      if (voce.tasto.rilascio) continue; // il rilascio non e' un input
      if (voce.tasto.vk === VK_INVIO) azioni.push({ tipo: 'invio' });
      else if (voce.tasto.vk === VK_BACKSPACE) azioni.push({ tipo: 'cancella' });
      else if (voce.tasto.vk === VK_ESCAPE) azioni.push({ tipo: 'annulla' });
      else if (DIREZIONE[voce.tasto.vk]) {
        azioni.push({ tipo: 'freccia', valore: DIREZIONE[voce.tasto.vk] });
      } else if (
        !voce.tasto.ctrl &&
        !voce.tasto.alt &&
        DIREZIONE_WASD[voce.tasto.carattere]
      ) {
        azioni.push({ tipo: 'freccia', valore: DIREZIONE_WASD[voce.tasto.carattere] });
      } else if (voce.tasto.carattere && /^[0-9]$/.test(voce.tasto.carattere)) {
        azioni.push({ tipo: 'cifra', valore: voce.tasto.carattere });
      } else if (
        // Stessa guardia delle direzioni: ctrl+d e alt+d sono scorciatoie di
        // qualcun altro, non la lettera d.
        !voce.tasto.ctrl &&
        !voce.tasto.alt &&
        voce.tasto.carattere &&
        /^[a-z]$/.test(voce.tasto.carattere)
      ) {
        azioni.push({ tipo: 'lettera', valore: voce.tasto.carattere });
      }
      continue;
    }

    // Blocco non riconosciuto: se comincia con ESC e' una sequenza di controllo
    // (mouse, frecce) e va ignorata, altrimenti sono caratteri digitati.
    if (voce.bytes[0] === 0x1b) continue;
    for (const byte of voce.bytes) {
      if (byte === 0x0d || byte === 0x0a) azioni.push({ tipo: 'invio' });
      else if (byte === 0x7f || byte === 0x08) azioni.push({ tipo: 'cancella' });
      else if (byte === 0x03) azioni.push({ tipo: 'annulla' });
      else if (byte >= 0x30 && byte <= 0x39) {
        azioni.push({ tipo: 'cifra', valore: String.fromCharCode(byte) });
      } else {
        // Le lettere di movimento valgono anche maiuscole (shift premuto). Le
        // versioni con Ctrl sono caratteri di controllo (0x01-0x1a), quindi qui
        // non arrivano mai e non c'e' da distinguerle.
        const lettera = String.fromCharCode(byte).toLowerCase();
        const direzione = DIREZIONE_WASD[lettera];
        if (direzione) azioni.push({ tipo: 'freccia', valore: direzione });
        else if (/^[a-z]$/.test(lettera)) azioni.push({ tipo: 'lettera', valore: lettera });
      }
    }
  }

  return azioni;
}

// Tasti che non muovono il cursore ma comandano la schermata. Chi non li
// gestisce li ignora: il selettore delle cartelle non sa che farsene di
// "conversazione", e l'albero dentro la sessione non sa che farsene di "modo".
const COMANDI_LETTERA = {
  r: 'modo',
  ' ': 'apri',
  c: 'conversazione', // cambia conversazione senza uscire da Claude
  p: 'progetto', // cambia cartella di lavoro
  m: 'profilo', // rilancia la stessa conversazione con altre variabili d'ambiente
};

// Traduce i byte ricevuti in comandi per le schermate che si navigano: il
// selettore delle cartelle e quello delle conversazioni.
// Rispetto ad azioniTastiera non ci sono cifre da digitare, e in piu' ci sono
// spazio (apre e chiude) e "r" (cambia modo).
// dati: Buffer letto da stdin
// ritorna: array di stringhe: 'su'|'giu'|'sinistra'|'destra'|'apri'|'conferma'|'modo'|'annulla'
export function azioniNavigazione(dati) {
  const azioni = [];

  for (const voce of tokenizza(dati)) {
    if (voce.tasto) {
      if (voce.tasto.rilascio) continue; // il rilascio non e' un comando
      const direzione = DIREZIONE[voce.tasto.vk];
      if (direzione) azioni.push(direzione);
      else if (voce.tasto.vk === VK_INVIO) azioni.push('conferma');
      else if (voce.tasto.vk === VK_ESCAPE) azioni.push('annulla');
      else if (!voce.tasto.ctrl && !voce.tasto.alt && voce.tasto.carattere) {
        const comando =
          DIREZIONE_WASD[voce.tasto.carattere] ?? COMANDI_LETTERA[voce.tasto.carattere];
        if (comando) azioni.push(comando);
      }
      continue;
    }

    // Byte non riconosciuti: se cominciano con ESC sono sequenze di controllo
    // (mouse, tasti che non ci interessano) e vanno ignorate.
    if (voce.bytes[0] === 0x1b) continue;
    for (const byte of voce.bytes) {
      if (byte === 0x0d || byte === 0x0a) azioni.push('conferma');
      else if (byte === 0x03) azioni.push('annulla');
      else {
        const carattere = String.fromCharCode(byte).toLowerCase();
        const comando = DIREZIONE_WASD[carattere] ?? COMANDI_LETTERA[carattere];
        if (comando) azioni.push(comando);
      }
    }
  }

  return azioni;
}

// Verifica se una lettura contiene solo eventi di rilascio del tasto della
// scorciatoia. In win32-input-mode il rilascio arriva come lettura separata tra
// due pressioni: senza riconoscerlo, spezzerebbe la sequenza.
// token: risultato di tokenizza
// scorciatoia: risultato di analizzaScorciatoia
// ritorna: true se sono tutti rilasci di quel tasto
export function soloRilasci(token, scorciatoia) {
  if (token.length === 0) return false;
  return token.every((voce) => voce.tasto?.rilascio && voce.tasto.vk === scorciatoia.vk);
}

// Conta quante volte la scorciatoia compare consecutivamente in testa ai token,
// ignorando gli eventi di rilascio che si intervallano alle pressioni.
// token: risultato di tokenizza
// scorciatoia: risultato di analizzaScorciatoia
// ritorna: { pressioni, consumati } — quanti token vanno scartati se si
//          intercetta la scorciatoia
export function contaInTesta(token, scorciatoia) {
  let pressioni = 0;
  let consumati = 0;

  for (const voce of token) {
    if (corrisponde(voce.tasto, scorciatoia)) {
      pressioni += 1;
      consumati += 1;
      continue;
    }
    // Il rilascio dello stesso tasto accompagna la pressione: va scartato con lei.
    const eRilascioDelloStesso =
      voce.tasto?.rilascio && (voce.tasto.vk === scorciatoia.vk || pressioni > 0);
    if (eRilascioDelloStesso && pressioni > 0) {
      consumati += 1;
      continue;
    }
    break;
  }

  return { pressioni, consumati };
}
