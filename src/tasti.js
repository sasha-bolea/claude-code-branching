const ESC = 0x1b;

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

// Descrive un tasto in modo indipendente dalla codifica del terminale.
// vk: codice virtuale (VK_ESCAPE, 71 per G, …)
// carattere: carattere prodotto, minuscolo, se applicabile
// ctrl/alt/shift: modificatori attivi
// rilascio: true se e' l'evento di rilascio invece della pressione
function tastoWin32(campi) {
  const [, vk, , uc, kd, cs] = campi;
  const stato = Number(cs || 0);
  const codice = Number(uc || 0);

  return {
    vk: Number(vk || 0),
    carattere: codice > 0 ? String.fromCharCode(codice).toLowerCase() : null,
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
    scorciatoia.vk = 0x70 + Number(tasto.slice(1)) - 1; // VK_F1 = 0x70
  } else if (tasto.length === 1) {
    scorciatoia.carattere = tasto;
    scorciatoia.vk = tasto.toUpperCase().charCodeAt(0);
  } else {
    throw new Error(`scorciatoia non riconosciuta: ${testo}`);
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

// Traduce i byte ricevuti in azioni per un campo di input testuale.
// Necessario perche' in win32-input-mode ogni evento tastiera comincia con
// 0x1b: leggere i byte grezzi farebbe scambiare per Esc anche il rilascio di un
// tasto qualsiasi, e farebbe leggere come cifre le coordinate del mouse.
// dati: Buffer letto da stdin
// ritorna: array di { tipo: 'cifra'|'invio'|'cancella'|'annulla', valore? }
export function azioniTastiera(dati) {
  const azioni = [];

  for (const voce of tokenizza(dati)) {
    if (voce.tasto) {
      if (voce.tasto.rilascio) continue; // il rilascio non e' un input
      if (voce.tasto.vk === VK_INVIO) azioni.push({ tipo: 'invio' });
      else if (voce.tasto.vk === VK_BACKSPACE) azioni.push({ tipo: 'cancella' });
      else if (voce.tasto.vk === VK_ESCAPE) azioni.push({ tipo: 'annulla' });
      else if (voce.tasto.carattere && /^[0-9]$/.test(voce.tasto.carattere)) {
        azioni.push({ tipo: 'cifra', valore: voce.tasto.carattere });
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
