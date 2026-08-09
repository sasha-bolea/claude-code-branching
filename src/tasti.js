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

// Invio nella stessa codifica: ESC[13u, ESC[13;2u (shift), ESC[13;5u (ctrl).
const RE_INVIO_KITTY = /^\x1b\[13(?:;([0-9]+))?u/;

// Sequenza win32-input-mode: ESC[Vk;Sc;Uc;Kd;Cs;Rc_
// Claude la abilita all'avvio (invia ESC[?9001h) e su Windows e' questa la
// codifica che il terminale usa davvero: ogni tasto arriva come sequenza che
// termina con "_", e arrivano anche gli eventi di rilascio.
//   Vk = codice tasto virtuale   Uc = carattere unicode
//   Kd = 1 pressione, 0 rilascio  Cs = stato dei modificatori
const RE_WIN32 = /^\x1b\[(\d*);(\d*);(\d*);(\d*);(\d*);(\d*)_/;

// Modi di tracciamento del mouse che una TUI puo' accendere. Finche' sono accesi
// il terminale manda movimenti e clic all'applicazione invece di selezionare il
// testo. Stanno qui e non nel wrapper perche' sono la stessa cosa di RE_WIN32:
// protocolli di input, e SPEGNI_MODI_INPUT li deve conoscere tutti.
export const MODI_MOUSE = [1000, 1002, 1003, 1005, 1006, 1015, 1016];

// Spegne ogni modo di input che una TUI puo' aver acceso: win32-input-mode
// (ESC[?9001h) e il protocollo kitty (ESC[>1u), che li chiede Claude, i modi
// mouse, il riporto del focus (?1004) e i marcatori di incolla (?2004). In coda
// il cursore, che Claude nasconde.
//
// Serve perche' il terminale non li spegne da solo: dopo un'uscita anomala —
// Claude ucciso con l'overlay a schermo, un'eccezione, un exit che salta la
// chiusura ordinata — restano accesi e il terminale continua a mandare le
// proprie sequenze alla shell, che non le interpreta e le stampa come testo.
// A quel punto ogni tasto e ogni scatto di rotella scrivono caratteri a caso, e
// nemmeno il comando che li spegnerebbe si riesce a digitare: l'unica via
// rimasta e' chiudere la finestra (successo il 2026-08-07).
export const SPEGNI_MODI_INPUT = [
  '\x1b[?9001l', // win32-input-mode
  '\x1b[>u', // protocollo kitty
  '\x1b[?1004l', // riporto del focus
  '\x1b[?2004l', // bracketed paste
  ...MODI_MOUSE.map((modo) => `\x1b[?${modo}l`),
  '\x1b[?25h', // cursore visibile
].join('');

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
// avviato). I modificatori stanno nell'ultimo parametro (ESC[1;5C = ctrl+destra)
// e vanno letti: nella coda ctrl+↑↓ sposta un prompt invece di scegliere, e
// scartandoli quel tasto la' sarebbe una freccia qualunque.
const RE_FRECCIA = /^\x1b(?:\[([0-9;]*)|O)([ABCD])/;
const VK_DELLA_FRECCIA = { A: VK_SU, B: VK_GIU, C: VK_DESTRA, D: VK_SINISTRA };

// Bit dei modificatori nelle sequenze CSI: il parametro vale 1 + la somma.
const SHIFT_CSI = 1;
const ALT_CSI = 2;
const CTRL_CSI = 4;

// Modificatori dell'ultimo parametro di una sequenza CSI.
// parametri: la parte numerica della sequenza ("1;5"), eventualmente vuota
// ritorna: { ctrl, alt, shift }
function modificatoriCsi(parametri) {
  const somma = Number((parametri || '').split(';').pop() || 1) - 1;
  return {
    ctrl: (somma & CTRL_CSI) !== 0,
    alt: (somma & ALT_CSI) !== 0,
    shift: (somma & SHIFT_CSI) !== 0,
  };
}

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

// Testo incollato (bracketed paste): il terminale lo avvolge fra ESC[200~ e
// ESC[201~ quando il modo `?2004h` e' acceso — e dentro cb lo e', perche' lo
// accende Claude.
//
// Va riconosciuto per due ragioni opposte, ed e' la stessa sequenza a risolverle
// tutt'e due. Senza riconoscerlo il blocco comincia con ESC e finisce fra i byte
// non riconosciuti, che le schermate scartano come sequenza di controllo: si
// incollava e non compariva niente. E dove invece i marcatori non arrivano — un
// terminale che il modo non ce l'ha acceso — i byte passano uno per uno, e gli a
// capo del testo incollato diventano invii: un prompt incollato si spezzava in
// tanti prompt quante erano le righe.
//
// Il terminatore puo' mancare: un incolla lungo arriva spezzato in piu' letture
// di stdin. In quel caso si prende tutto quello che c'e', e la coda del testo
// arrivera' come caratteri normali — meglio un incolla che finisce digitato che
// un incolla che sparisce.
// Gli a capo di un testo incollato in una forma sola. I terminali mandano \r,
// \n o \r\n a seconda di dove il testo e' stato copiato, e un \r che sopravvive
// fino allo schermo riporta il cursore a inizio riga: il disegno si scrive sopra
// se stesso. Vale per tutt'e due le strade — coi marcatori e senza.
const aCapoNormali = (testo) => testo.replace(/\r\n?/g, '\n');

// Il testo vero dentro un blocco incollato.
//
// Non basta leggere i byte come stringa: con win32-input-mode acceso — e dentro
// cb lo e' sempre, lo accende Claude — il terminale codifica **anche il
// contenuto dell'incolla** come eventi di tastiera, uno per carattere. Gli a
// capo del testo che incolli arrivano quindi come `ESC[13;28;13;1;0;1_`, e
// copiati alla lettera finivano nella nota come una fila di numeri (visto
// davvero: «…righe restano fuori. ESC[13;28;13;1;0;1_ ESC[13;28;13;0;0;1_…»).
//
// Si ri-tokenizza il contenuto e si tiene solo quello che e' testo: i caratteri
// dei tasti premuti, l'invio come a capo, e i byte che nessuno ha riconosciuto.
// Le sequenze di controllo che restano non sono testo e si buttano.
// bytes: contenuto fra i due marcatori
// ritorna: il testo da consegnare alla schermata
function testoDelBlocco(bytes) {
  let testo = '';
  for (const voce of tokenizza(bytes)) {
    if (voce.tasto) {
      if (voce.tasto.rilascio) continue; // il rilascio non e' un carattere
      if (voce.tasto.vk === VK_INVIO) testo += '\n';
      else if (voce.tasto.grezzo) testo += voce.tasto.grezzo;
      continue;
    }
    if (voce.bytes[0] === 0x1b) continue; // una sequenza di controllo non e' testo
    testo += Buffer.from(voce.bytes).toString('utf8');
  }
  return testo;
}

const RE_INCOLLA = /^\x1b\[200~([\s\S]*?)(?:\x1b\[201~|$)/;
// Fine incolla arrivata da sola, dopo un blocco spezzato: si consuma e basta, o
// finirebbe fra i byte non riconosciuti.
const RE_FINE_INCOLLA = /^\x1b\[201~/;

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

  // Registra un blocco di testo incollato. Non e' un tasto — non ha un codice
  // ne' modificatori — quindi viaggia in un campo suo, che chi non lo gestisce
  // ignora come ogni altro token che non gli riguarda.
  const aggiungiIncolla = (testo, lunghezza) => {
    chiudiAltro(posizione);
    token.push({
      tasto: null,
      // Gli a capo si normalizzano **qui**, non a valle: un \r che arriva fino
      // allo schermo riporta il cursore a inizio riga, e il testo ricomincia a
      // scriversi sopra quello che c'era. E' cosi' che un titolo incollato
      // usciva dal riquadro delle note — non era troppo lungo, erano i suoi \r a
      // rimandarlo a capo da soli, sotto al riquadro.
      incolla: aCapoNormali(testo),
      bytes: dati.subarray(posizione, posizione + lunghezza),
    });
    posizione += lunghezza;
  };

  while (posizione < dati.length) {
    const resto = dati.subarray(posizione).toString('latin1');

    // Prima di tutto il resto: dentro un incolla non si cercano tasti, o un
    // testo che contenga "ESC[" verrebbe letto come una sequenza di controllo.
    const incollato = RE_INCOLLA.exec(resto);
    if (incollato) {
      // Il contenuto si rilegge dai byte: `resto` e' latin1 — la codifica giusta
      // per riconoscere le sequenze di controllo, sbagliata per un testo che
      // puo' contenere accenti.
      const inizio = posizione + '\x1b[200~'.length;
      const dentro = dati.subarray(inizio, inizio + Buffer.byteLength(incollato[1], 'latin1'));
      aggiungiIncolla(testoDelBlocco(dentro), incollato[0].length);
      continue;
    }
    const fine = RE_FINE_INCOLLA.exec(resto);
    if (fine) {
      chiudiAltro(posizione);
      posizione += fine[0].length;
      continue;
    }

    const win32 = RE_WIN32.exec(resto);
    if (win32) {
      aggiungi(tastoWin32(win32), win32[0].length);
      continue;
    }

    const freccia = RE_FRECCIA.exec(resto);
    if (freccia) {
      aggiungi(
        {
          vk: VK_DELLA_FRECCIA[freccia[2]],
          carattere: null,
          grezzo: null,
          ...modificatoriCsi(freccia[1]),
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

    // Invio con i modificatori, in codifica CSI-u: ESC[13;2u = shift+invio,
    // ESC[13;5u = ctrl+invio. Serve alle note, dove i due fanno cose diverse
    // (andare a capo e mandare la nota a Claude). Nei byte grezzi non esiste
    // modo di distinguerli: sono tutti e tre `\r`.
    const invio = RE_INVIO_KITTY.exec(resto);
    if (invio) {
      aggiungi(
        {
          vk: VK_INVIO,
          carattere: null,
          grezzo: null,
          ...modificatoriCsi(invio[1]),
          rilascio: false,
        },
        invio[0].length,
      );
      continue;
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

// Un blocco di byte che ha tutta l'aria di essere testo incollato.
//
// Serve dove i marcatori del bracketed paste non arrivano: li' l'unico indizio
// e' che in **una sola lettura** di stdin siano arrivati piu' caratteri e almeno
// un a capo. Nessuno digita due parole e un invio dentro lo stesso tick: quando
// succede, e' roba che il terminale ha versato tutta insieme.
//
// Il prezzo, dichiarato: battendo l'ultima lettera e l'invio nello stesso
// istante, quel testo finisce nel campo senza essere inviato. Si preme invio e
// parte — mentre l'errore opposto, un prompt spezzato in dieci, non si rimedia.
// bytes: blocco non riconosciuto da tokenizza
// ritorna: true se va trattato come un incolla
function sembraIncollato(bytes) {
  let stampabili = 0;
  let aCapo = false;
  for (const byte of bytes) {
    if (byte === 0x0d || byte === 0x0a) aCapo = true;
    else if (byte >= 0x20) stampabili += 1;
    else return false; // altri caratteri di controllo: non e' un testo incollato
  }
  return aCapo && stampabili >= 2;
}

// Il testo di un blocco incollato, con gli a capo in una forma sola (vedi
// `aCapoNormali`).
// bytes: blocco di byte
// ritorna: stringa
const testoIncollato = (bytes) => aCapoNormali(Buffer.from(bytes).toString('utf8'));

// Traduce i byte ricevuti in azioni per un campo dove si scrive testo libero.
//
// Separata da azioniTastiera perche' quella mappa w/a/s/d sulle direzioni: in un
// campo di testo servono come lettere, non come frecce. Qui passa qualsiasi
// carattere stampabile, e si usa `grezzo` invece di `carattere` perche' le
// maiuscole contano — in un percorso "C:" non e' "c:".
// dati: Buffer letto da stdin
// ritorna: array di { tipo: 'carattere'|'invio'|'cancella'|'annulla'|'istruzioni', valore? }
export function azioniTesto(dati) {
  const azioni = [];

  for (const voce of tokenizza(dati)) {
    if (voce.incolla !== undefined) {
      azioni.push({ tipo: 'incolla', valore: voce.incolla });
      continue;
    }
    if (voce.tasto) {
      if (voce.tasto.rilascio) continue;
      if (voce.tasto.vk === VK_INVIO) azioni.push({ tipo: 'invio' });
      else if (voce.tasto.vk === VK_BACKSPACE) azioni.push({ tipo: 'cancella' });
      else if (voce.tasto.vk === VK_ESCAPE) azioni.push({ tipo: 'annulla' });
      // Anche in un campo di testo le istruzioni restano raggiungibili: F1 non
      // e' un carattere, quindi non c'e' niente da contendere.
      else if (voce.tasto.vk === VK_F1) azioni.push({ tipo: 'istruzioni' });
      else if (voce.tasto.grezzo && !voce.tasto.ctrl && !voce.tasto.alt) {
        azioni.push({ tipo: 'carattere', valore: voce.tasto.grezzo });
      }
      continue;
    }

    // Blocco non riconosciuto: se comincia con ESC e' una sequenza di controllo
    // (frecce, mouse) e non e' testo.
    if (voce.bytes[0] === 0x1b) continue;
    // Testo versato tutto insieme dal terminale, senza i marcatori dell'incolla.
    if (sembraIncollato(voce.bytes)) {
      azioni.push({ tipo: 'incolla', valore: testoIncollato(voce.bytes) });
      continue;
    }
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

// Rotella del mouse. Due codifiche: SGR (`ESC[<Cb;Cx;Cy` e M o m, accesa dal
// modo ?1006) e quella storica (`ESC[M` piu' tre byte, con 32 sommato a
// ciascuno). Si riconoscono tutt'e due perche' il modo SGR lo si chiede, ma un
// terminale che non lo capisce risponde comunque nella vecchia.
//
// Nel codice del pulsante i bit 4, 8 e 16 sono shift, alt e ctrl: vanno tolti,
// o la rotella con un modificatore premuto non verrebbe riconosciuta.
const RE_ROTELLA_SGR = /\x1b\[<(\d+);\d+;\d+[Mm]/g;
const RE_ROTELLA_X10 = /\x1b\[M([\s\S])[\s\S][\s\S]/g;
const SENZA_MODIFICATORI = ~(4 | 8 | 16);

// Direzione dell'albero per ogni verso della rotella. Su e giu' scorrono la
// conversazione avanti e indietro come le frecce sinistra e destra: l'albero e'
// orizzontale, e sono i rami — non i turni — a stare uno sotto l'altro.
// Le rotelle orizzontali (66 e 67, trackpad e mouse con la rotella inclinabile)
// vanno dalla stessa parte del gesto.
const DIREZIONE_ROTELLA = { 64: 'sinistra', 65: 'destra', 66: 'sinistra', 67: 'destra' };

// Traduce un blocco di byte non riconosciuti negli scorrimenti della rotella che
// contiene. I clic e i movimenti non producono niente: l'albero non ha un
// bersaglio da cliccare, e reagire a un movimento qualsiasi sposterebbe il
// cursore mentre si passa sopra lo schermo.
// bytes: Buffer del blocco
// ritorna: array di { tipo: 'freccia', valore: 'sinistra'|'destra' }
export function azioniRotella(bytes) {
  const azioni = [];
  const testo = Buffer.from(bytes).toString('latin1');

  for (const [espressione, scarto] of [
    [RE_ROTELLA_SGR, 0],
    [RE_ROTELLA_X10, 32],
  ]) {
    espressione.lastIndex = 0;
    for (const trovato of testo.matchAll(espressione)) {
      const codice = (Number(scarto ? trovato[1].charCodeAt(0) - scarto : trovato[1]) &
        SENZA_MODIFICATORI);
      const direzione = DIREZIONE_ROTELLA[codice];
      if (direzione) azioni.push({ tipo: 'freccia', valore: direzione });
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
// ritorna: array di { tipo: 'cifra'|'invio'|'cancella'|'annulla'|'freccia'|'lettera'|
//          'istruzioni', valore? }
export function azioniTastiera(dati) {
  const azioni = [];

  for (const voce of tokenizza(dati)) {
    // Qui non si scrive testo: un incolla capitato per sbaglio si butta invece
    // di leggerlo lettera per lettera, o le sue lettere diventerebbero una
    // raffica di comandi — nel menu del ripristino, una scelta a caso.
    if (voce.incolla !== undefined) continue;
    if (voce.tasto) {
      if (voce.tasto.rilascio) continue; // il rilascio non e' un input
      if (voce.tasto.vk === VK_INVIO) azioni.push({ tipo: 'invio' });
      else if (voce.tasto.vk === VK_BACKSPACE) azioni.push({ tipo: 'cancella' });
      else if (voce.tasto.vk === VK_CANC) azioni.push({ tipo: 'esci' });
      else if (voce.tasto.vk === VK_ESCAPE) azioni.push({ tipo: 'annulla' });
      else if (voce.tasto.vk === VK_F1) azioni.push({ tipo: 'istruzioni' });
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
        // "i" apre le istruzioni in ogni schermata che non raccoglie testo: esce
        // gia' come azione sua, invece che come lettera qualsiasi, perche' la
        // schermata che la gestisse come lettera dovrebbe conoscerne il nome.
        if (voce.tasto.carattere === 'i') azioni.push({ tipo: 'istruzioni' });
        else azioni.push({ tipo: 'lettera', valore: voce.tasto.carattere });
      }
      continue;
    }

    // Blocco non riconosciuto: se comincia con ESC e' una sequenza di controllo.
    // Della rotella si tiene lo scorrimento — muove l'albero come le frecce —
    // e il resto (clic, movimenti, frecce gia' gestite sopra) si scarta: le sue
    // coordinate, lette a byte, diventerebbero cifre digitate.
    if (voce.bytes[0] === 0x1b) {
      if (cancNeiByte(voce.bytes).canc) azioni.push({ tipo: 'esci' });
      azioni.push(...azioniRotella(voce.bytes));
      continue;
    }
    if (sembraIncollato(voce.bytes)) continue; // vedi sopra: qui non si scrive
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
        else if (lettera === 'i') azioni.push({ tipo: 'istruzioni' });
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
  c: 'conversazione', // apre il navigatore delle cartelle: cartella e conversazione
  m: 'profilo', // rilancia la stessa conversazione con altre variabili d'ambiente
  p: 'coda', // la coda dei prompt che partono da soli a fine turno
  n: 'note', // le note della cartella di lavoro, non della singola conversazione
  i: 'istruzioni', // la pagina che spiega la schermata da cui la si apre
};

const VK_CANC = 46;
// Canc nelle codifiche ANSI. tokenizza lo lascia fra i byte non riconosciuti:
// la sua forma e' quella dei tasti funzione (ESC[<n>~) ma il 3 non e' un F.
// I modificatori arrivano come parametro in mezzo: ESC[3;5~ e' ctrl+canc.
const RE_CANC_ANSI = /\x1b\[3(?:;(\d+))?~/;

// Vero se il blocco contiene Canc, e se era premuto con ctrl.
// bytes: blocco non riconosciuto da tokenizza
// ritorna: { canc, ctrl }
function cancNeiByte(bytes) {
  const trovato = RE_CANC_ANSI.exec(Buffer.from(bytes).toString('latin1'));
  if (!trovato) return { canc: false, ctrl: false };
  return { canc: true, ctrl: modificatoriCsi(trovato[1]).ctrl };
}

// Interruttori della coda, sui tasti che restano liberi accanto a un campo di
// testo: le lettere finiscono nel prompt, quindi servono con ctrl. Si guarda il
// codice virtuale e non il carattere perche' con ctrl premuto il terminale
// consegna il carattere di controllo (0x13), non "s".
const VK_S = 0x53;
const VK_X = 0x58;
const COMMUTA_VK = { [VK_S]: 'stop', [VK_X]: 'salta' };
const COMMUTA_BYTE = { 0x13: 'stop', 0x18: 'salta' }; // ctrl+s, ctrl+x grezzi

// Ricerca fra le note: ctrl+f. Stessa ragione degli interruttori della coda —
// accanto a un campo di testo le lettere sono testo, quindi serve un modificatore.
const VK_F = 0x46;
const CTRL_F_BYTE = 0x06;

// Segna una nota per la cancellazione: ctrl+spazio. Lo spazio da solo e' un
// carattere del testo, quindi serve il modificatore anche qui. Nei byte grezzi
// ctrl+spazio arriva come NUL (0x00), che non e' prodotto da nessun altro tasto.
const VK_SPAZIO = 0x20;
const CTRL_SPAZIO_BYTE = 0x00;

// Traduce i byte ricevuti in azioni per la coda dei prompt, dove si scrive testo
// libero **e** si naviga un elenco.
//
// Non basta ne' azioniTesto — che le frecce le scarta, e qui scelgono la riga da
// togliere — ne' azioniTastiera, che mappa w/a/s/d sulle direzioni e in un campo
// di testo servono come lettere. Si tiene `grezzo` e non `carattere` perche' un
// prompt e' testo: le maiuscole contano.
//
// Canc esce dall'interfaccia e torna a Claude, come in ogni altra schermata: e'
// l'unico tasto che vale lo stesso ovunque, ed e' quello che lo rende utile.
// Per togliere un prompt dalla coda si usa **ctrl+canc**: e' l'azione frequente,
// ma cedere il tasto semplice all'uscita e' il prezzo della coerenza.
// Backspace resta per correggere il testo che stai scrivendo: un tasto solo non
// puo' fare due cose a seconda di quanto hai scritto.
// Ctrl e' quello che distingue le azioni sull'elenco da quelle sul testo:
// ctrl+↑↓ sposta il prompt scelto, ctrl+s e ctrl+x accendono stop e salta.
// Shift+invio va a capo dentro al prompt, come nelle note: nei byte grezzi i due
// invii non si distinguono (sono lo stesso \r), e li' resta un invio semplice.
// dati: Buffer letto da stdin
// ritorna: array di { tipo: 'carattere'|'invio'|'acapo'|'cancella'|'togli'|'freccia'|'sposta'|
//          'commuta'|'istruzioni'|'annulla'|'esci', valore? }
export function azioniCoda(dati) {
  const azioni = [];

  for (const voce of tokenizza(dati)) {
    // Un testo incollato e' un prompt solo, anche quando ha degli a capo dentro:
    // e' l'unica differenza fra incollare e digitare, e senza di essa un prompt
    // di dieci righe si accodava come dieci prompt.
    if (voce.incolla !== undefined) {
      azioni.push({ tipo: 'incolla', valore: voce.incolla });
      continue;
    }
    if (voce.tasto) {
      if (voce.tasto.rilascio) continue;
      // Shift+invio va a capo dentro al prompt, come nelle note: un prompt lungo
      // ha le sue righe, e senza questo l'unico modo di averle era incollarlo da
      // fuori. Invio semplice accoda, che e' l'azione frequente.
      if (voce.tasto.vk === VK_INVIO) {
        azioni.push({ tipo: voce.tasto.shift ? 'acapo' : 'invio' });
      } else if (voce.tasto.vk === VK_BACKSPACE) azioni.push({ tipo: 'cancella' });
      else if (voce.tasto.vk === VK_CANC) {
        azioni.push({ tipo: voce.tasto.ctrl ? 'togli' : 'esci' });
      } else if (voce.tasto.vk === VK_ESCAPE) azioni.push({ tipo: 'annulla' });
      else if (DIREZIONE[voce.tasto.vk]) {
        const direzione = DIREZIONE[voce.tasto.vk];
        // Ctrl sposta, senza ctrl si scorre soltanto. Destra e sinistra qui non
        // hanno un posto dove andare: l'elenco e' verticale.
        if (voce.tasto.ctrl) {
          if (direzione === 'su' || direzione === 'giu') {
            azioni.push({ tipo: 'sposta', valore: direzione });
          }
        } else azioni.push({ tipo: 'freccia', valore: direzione });
      } else if (voce.tasto.ctrl && COMMUTA_VK[voce.tasto.vk]) {
        azioni.push({ tipo: 'commuta', valore: COMMUTA_VK[voce.tasto.vk] });
      } else if (voce.tasto.vk === VK_F1) {
        // Le istruzioni qui stanno su F1 e non su "i": accanto a un campo di
        // testo la i e' una lettera del prompt che stai scrivendo.
        azioni.push({ tipo: 'istruzioni' });
      } else if (voce.tasto.grezzo && !voce.tasto.ctrl && !voce.tasto.alt) {
        azioni.push({ tipo: 'carattere', valore: voce.tasto.grezzo });
      }
      continue;
    }

    // Blocco non riconosciuto: se comincia con ESC e' una sequenza di controllo.
    // Ne interessa Canc, e la rotella — che qui scorre l'elenco come le frecce.
    if (voce.bytes[0] === 0x1b) {
      const canc = cancNeiByte(voce.bytes);
      if (canc.canc) azioni.push({ tipo: canc.ctrl ? 'togli' : 'esci' });
      for (const azione of azioniRotella(voce.bytes)) {
        // La rotella dell'albero scorre in orizzontale, qui l'elenco e' verticale.
        azioni.push({ tipo: 'freccia', valore: azione.valore === 'sinistra' ? 'su' : 'giu' });
      }
      continue;
    }

    if (sembraIncollato(voce.bytes)) {
      azioni.push({ tipo: 'incolla', valore: testoIncollato(voce.bytes) });
      continue;
    }

    for (const byte of voce.bytes) {
      if (byte === 0x0d || byte === 0x0a) azioni.push({ tipo: 'invio' });
      else if (byte === 0x7f || byte === 0x08) azioni.push({ tipo: 'cancella' });
      else if (byte === 0x03) azioni.push({ tipo: 'annulla' });
      else if (COMMUTA_BYTE[byte]) azioni.push({ tipo: 'commuta', valore: COMMUTA_BYTE[byte] });
      else if (byte >= 0x20 && byte < 0x7f) {
        azioni.push({ tipo: 'carattere', valore: String.fromCharCode(byte) });
      }
    }
  }

  return azioni;
}

// Traduce l'invio nell'azione che gli spetta nelle note.
// shift: a capo dentro il corpo — una nota e' un testo, non una riga
// ctrl: manda la nota a Claude come prompt
// niente: salva la nota e passa a quella nuova
// ritorna: il tipo di azione
function invioDelleNote({ ctrl, shift }) {
  if (ctrl) return 'manda';
  if (shift) return 'acapo';
  return 'invio';
}

// Traduce i byte ricevuti in azioni per le note.
//
// Come la coda si scrive testo libero e si naviga un elenco, ma l'invio qui fa
// tre cose a seconda dei modificatori (vedi `invioDelleNote`), e sono tutte
// azioni frequenti: e' il motivo per cui non basta `azioniCoda`.
//
// **Su un terminale che manda i byte grezzi i tre invii sono lo stesso byte**
// (`\r`), e shift+invio e ctrl+invio non si distinguono. Dentro cb su Windows non
// succede — Claude accende win32-input-mode, che porta i modificatori — e la
// codifica kitty li porta a sua volta (ESC[13;2u, riconosciuto da `tokenizza`);
// altrove restano un invio semplice.
// dati: Buffer letto da stdin
// ritorna: array di { tipo: 'carattere'|'invio'|'acapo'|'manda'|'cancella'|'freccia'|
//          'cerca'|'segna'|'togli'|'istruzioni'|'annulla'|'esci', valore? }
export function azioniNote(dati) {
  const azioni = [];

  for (const voce of tokenizza(dati)) {
    // Come nella coda: quello che incolli e' una nota sola, a capo compresi.
    if (voce.incolla !== undefined) {
      azioni.push({ tipo: 'incolla', valore: voce.incolla });
      continue;
    }
    if (voce.tasto) {
      if (voce.tasto.rilascio) continue;
      if (voce.tasto.vk === VK_INVIO) azioni.push({ tipo: invioDelleNote(voce.tasto) });
      else if (voce.tasto.vk === VK_BACKSPACE) azioni.push({ tipo: 'cancella' });
      else if (voce.tasto.vk === VK_CANC) {
        // Come nella coda: canc esce, ctrl+canc toglie. L'azione distruttiva
        // paga il modificatore, l'uscita resta uguale in ogni schermata.
        azioni.push({ tipo: voce.tasto.ctrl ? 'togli' : 'esci' });
      } else if (voce.tasto.vk === VK_ESCAPE) azioni.push({ tipo: 'annulla' });
      else if (DIREZIONE[voce.tasto.vk]) {
        azioni.push({ tipo: 'freccia', valore: DIREZIONE[voce.tasto.vk] });
      } else if (voce.tasto.ctrl && voce.tasto.vk === VK_F) azioni.push({ tipo: 'cerca' });
      else if (voce.tasto.ctrl && voce.tasto.vk === VK_SPAZIO) azioni.push({ tipo: 'segna' });
      // Come nella coda: qui la i e' una lettera, quindi le istruzioni sono su F1.
      else if (voce.tasto.vk === VK_F1) azioni.push({ tipo: 'istruzioni' });
      else if (voce.tasto.grezzo && !voce.tasto.ctrl && !voce.tasto.alt) {
        azioni.push({ tipo: 'carattere', valore: voce.tasto.grezzo });
      }
      continue;
    }

    if (voce.bytes[0] === 0x1b) {
      const canc = cancNeiByte(voce.bytes);
      if (canc.canc) azioni.push({ tipo: canc.ctrl ? 'togli' : 'esci' });
      for (const azione of azioniRotella(voce.bytes)) {
        // L'elenco delle note e' verticale, come quello della coda.
        azioni.push({ tipo: 'freccia', valore: azione.valore === 'sinistra' ? 'su' : 'giu' });
      }
      continue;
    }

    if (sembraIncollato(voce.bytes)) {
      azioni.push({ tipo: 'incolla', valore: testoIncollato(voce.bytes) });
      continue;
    }

    for (const byte of voce.bytes) {
      if (byte === 0x0d || byte === 0x0a) azioni.push({ tipo: 'invio' });
      else if (byte === 0x7f || byte === 0x08) azioni.push({ tipo: 'cancella' });
      else if (byte === 0x03) azioni.push({ tipo: 'annulla' });
      else if (byte === CTRL_F_BYTE) azioni.push({ tipo: 'cerca' });
      else if (byte === CTRL_SPAZIO_BYTE) azioni.push({ tipo: 'segna' });
      else if (byte >= 0x20 && byte < 0x7f) {
        azioni.push({ tipo: 'carattere', valore: String.fromCharCode(byte) });
      }
    }
  }

  return azioni;
}

// Traduce i byte ricevuti in comandi per le schermate che si navigano: il
// selettore delle cartelle e quello delle conversazioni.
// Rispetto ad azioniTastiera non ci sono cifre da digitare, e in piu' ci sono
// spazio (apre e chiude) e "r" (cambia modo).
// dati: Buffer letto da stdin
// ritorna: array di stringhe: 'su'|'giu'|'sinistra'|'destra'|'apri'|'conferma'|'modo'|
//          'istruzioni'|'annulla'|'esci'
export function azioniNavigazione(dati) {
  const azioni = [];

  for (const voce of tokenizza(dati)) {
    // Come in azioniTastiera: qui non si scrive, e un incolla letto lettera per
    // lettera aprirebbe schermate a caso — "c" e "p" sono comandi.
    if (voce.incolla !== undefined) continue;
    if (voce.tasto) {
      if (voce.tasto.rilascio) continue; // il rilascio non e' un comando
      const direzione = DIREZIONE[voce.tasto.vk];
      if (direzione) azioni.push(direzione);
      else if (voce.tasto.vk === VK_F1) azioni.push('istruzioni');
      else if (voce.tasto.vk === VK_INVIO) azioni.push('conferma');
      else if (voce.tasto.vk === VK_CANC) azioni.push('esci');
      else if (voce.tasto.vk === VK_ESCAPE) azioni.push('annulla');
      else if (!voce.tasto.ctrl && !voce.tasto.alt && voce.tasto.carattere) {
        const comando =
          DIREZIONE_WASD[voce.tasto.carattere] ?? COMANDI_LETTERA[voce.tasto.carattere];
        if (comando) azioni.push(comando);
      }
      continue;
    }

    // Byte non riconosciuti: se cominciano con ESC sono sequenze di controllo.
    // Della rotella si tiene lo scorrimento — che muove come le frecce — e il
    // resto (clic, movimenti) si scarta.
    if (voce.bytes[0] === 0x1b) {
      if (cancNeiByte(voce.bytes).canc) azioni.push('esci');
      for (const azione of azioniRotella(voce.bytes)) azioni.push(azione.valore);
      continue;
    }
    if (sembraIncollato(voce.bytes)) continue; // vedi sopra: qui non si scrive
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
