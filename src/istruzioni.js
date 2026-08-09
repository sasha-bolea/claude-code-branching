import { T } from './lingua.js';
import { aCapo, chiudiPagina, coloraTasti } from './vista.js';
import { grigio } from './stile.js';

// La pagina delle istruzioni: cosa fa la schermata da cui si arriva, tutti i
// suoi tasti, e le cose non ovvie che una legenda non puo' dire.
//
// Perche' una pagina e non una legenda piu' ricca: la barra in fondo dice **che
// cosa premere**, e per farlo deve stare su una riga. Non c'e' spazio per dire
// perche' nella coda si toglie con ctrl+canc e non con canc, o che le note
// stanno alla cartella e non alla conversazione — cioe' proprio le cose che
// altrimenti si scoprono sbagliando.
//
// Il testo sta tutto in `T.istruzioni`, una voce per schermata: qui c'e' solo il
// modo di disegnarlo. Le righe rientrate di quattro spazi sono le voci dei
// tasti, e si colorano da se' — `coloraTasti` riconosce la testa di ogni voce e
// si ferma alla prima parola che non e' un tasto, quindi la prosa resta prosa.

// Colonne del testo. Fisse e non "tutto lo schermo": una riga larga 200 colonne
// si legge male, e le istruzioni sono l'unica schermata fatta di sole frasi.
const LARGHEZZA_TESTO = 76;

// Righe della pagina, senza intestazione ne' legenda: e' il conto che serve a
// sapere quanto si puo' scorrere.
// pagina: { titolo, righe } da T.istruzioni
// colonne: colonne del terminale
// ritorna: array di righe di testo, gia' mandate a capo
function corpo(pagina, colonne) {
  const larghezza = Math.min(LARGHEZZA_TESTO, Math.max(20, colonne - 6));
  const righe = [];
  for (const riga of pagina.righe) {
    // Una riga vuota resta vuota: aCapo su stringa vuota ne restituirebbe una,
    // ma passandoci il rientro si porterebbe dietro spazi in coda.
    if (riga.trim() === '') {
      righe.push('');
      continue;
    }
    // Una riga che ci sta gia' si prende com'e': `aCapo` normalizza gli spazi
    // (passa da `testoLeggibile`), e i due spazi fra il tasto e la sua
    // descrizione sono proprio quelli che tengono la colonna e che dicono a
    // `coloraTasti` dove finisce il tasto.
    if ([...riga].length <= larghezza) {
      righe.push(riga);
      continue;
    }
    // Solo le righe troppo lunghe per il terminale si mandano a capo: succede
    // sulle finestre strette, dove l'allineamento e' comunque perso.
    const rientro = riga.match(/^ */)[0];
    for (const pezzo of aCapo(riga.trim(), larghezza - rientro.length)) {
      righe.push(`${rientro}${pezzo}`);
    }
  }
  return righe;
}

// Quanto si puo' scorrere in una pagina: zero se il testo ci sta tutto.
// Serve al chiamante per non far scendere lo scorrimento nel vuoto — il
// contenuto e' fisso, quindi il limite dipende solo dall'altezza del terminale.
// pagina: { titolo, righe } da T.istruzioni
// colonne, altezza: dimensioni del terminale
// ritorna: numero massimo di righe di scorrimento
export function massimoScorrimento(pagina, { colonne = 100, altezza = 30 } = {}) {
  // Tre righe se ne vanno in intestazione e riga vuota, due in fondo fra
  // separatore e legenda (vedi chiudiPagina).
  const visibili = Math.max(1, altezza - 5);
  return Math.max(0, corpo(pagina, colonne).length - visibili);
}

// Compone la pagina delle istruzioni, pronta da scrivere sul terminale.
// pagina: { titolo, righe } da T.istruzioni
// colonne, altezza: dimensioni del terminale
// scorrimento: quante righe di testo saltare in cima
// ritorna: array alto esattamente `altezza`
export function paginaIstruzioni(pagina, { colonne = 100, altezza = 30, scorrimento = 0 } = {}) {
  const testo = corpo(pagina, colonne);
  const massimo = massimoScorrimento(pagina, { colonne, altezza });
  const da = Math.min(Math.max(0, scorrimento), massimo);

  const intestazione = `  ${T.istruzioni.intestazione(pagina.titolo)}`;
  // Il segno che c'e' altro sotto sta accanto al titolo e non in fondo: in fondo
  // ci sono gia' separatore e legenda, e una terza riga fissa mangerebbe testo.
  const quanto = massimo > 0 ? `  ${grigio(T.istruzioni.altre(massimo - da))}` : '';
  const righe = [`${intestazione}${da < massimo ? quanto : ''}`, ''];
  // Le righe vuote restano vuote: aggiungendo il margine anche a loro la pagina
  // si riempirebbe di spazi in coda, che a schermo non si vedono ma nelle prove
  // fanno differenza.
  for (const riga of testo.slice(da)) righe.push(riga === '' ? '' : `  ${coloraTasti(riga)}`);

  const legenda = massimo > 0 ? T.istruzioni.legendaScorri : T.istruzioni.legenda;
  return chiudiPagina(righe, `  ${coloraTasti(legenda)}`, altezza, colonne);
}

// Il tipo di un'azione, qualunque forma abbia chi l'ha prodotta.
// `azioniNavigazione` restituisce stringhe, le altre oggetti { tipo, valore }: la
// pagina delle istruzioni si apre da tutt'e due i tipi di schermata, e non deve
// sapere quale delle due l'ha chiamata.
// azione: stringa oppure { tipo, valore }
// ritorna: { tipo, valore }
function normalizza(azione) {
  if (typeof azione === 'string') return { tipo: azione, valore: azione };
  if (azione.tipo === 'freccia') return { tipo: azione.valore, valore: azione.valore };
  return azione;
}

// Le istruzioni sovrapposte a una schermata che resta viva sotto.
//
// Serve ai selettori che hanno un ciclo di tasti loro (cartelle, conversazioni,
// coda, note, impostazioni): invece di aprire una schermata nuova — che
// vorrebbe dire staccare e riattaccare lo stdin — si accende un modo, e finche'
// e' acceso la schermata disegna la pagina e i tasti vanno a lei. La schermata
// sotto non perde niente: al ritorno il cursore e' dove l'avevi lasciato.
//
// pagina: { titolo, righe } da T.istruzioni
// ritorna: { aperta, apri, disegna, tasti }
export function sovrapposizioneIstruzioni(pagina) {
  const stato = { aperta: false, scorrimento: 0 };

  return {
    get aperta() {
      return stato.aperta;
    },

    // Apre la pagina dall'inizio: riaprirla a meta' di dove l'avevi lasciata
    // mostrerebbe un testo che comincia a caso.
    apri() {
      stato.aperta = true;
      stato.scorrimento = 0;
    },

    // Righe da scrivere al posto della schermata.
    // dimensioni: { colonne, altezza } del terminale
    disegna(dimensioni) {
      return paginaIstruzioni(pagina, { ...dimensioni, scorrimento: stato.scorrimento });
    },

    // Consuma i tasti mentre la pagina e' aperta.
    // azioni: quello che ha prodotto il decodificatore della schermata
    // dimensioni: { colonne, altezza } del terminale, per il limite dello scorrimento
    // ritorna: 'aperta' (resta), 'chiusa' (si torna alla schermata) o 'esci'
    tasti(azioni, dimensioni) {
      const massimo = massimoScorrimento(pagina, dimensioni);
      for (const azione of azioni) {
        const { tipo } = normalizza(azione);
        // Canc esce da tutto anche da qui: e' l'unico tasto che vale lo stesso
        // in ogni schermata, e una in cui non funzionasse basterebbe a non
        // fidarsene piu'.
        if (tipo === 'esci') {
          stato.aperta = false;
          return 'esci';
        }
        if (tipo === 'annulla' || tipo === 'invio' || tipo === 'conferma') {
          stato.aperta = false;
          return 'chiusa';
        }
        if (tipo === 'giu') stato.scorrimento = Math.min(massimo, stato.scorrimento + 1);
        else if (tipo === 'su') stato.scorrimento = Math.max(0, stato.scorrimento - 1);
      }
      return 'aperta';
    },
  };
}
