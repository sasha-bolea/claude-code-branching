// Colori dell'interfaccia. Stanno in un file a parte perche' scritte inline le
// sequenze ANSI sono invisibili in fase di lettura del sorgente, e perche' vanno
// spente tutte insieme quando il terminale non le regge.
//
// Regola della tavolozza: tutta l'interfaccia sta alla massima luminosita', e la
// legenda e' l'unica cosa che resta indietro. Ne segue che il ramo attivo NON si
// distingue dagli altri per luminosita' ma per TINTA — arancione contro il primo
// piano del terminale. Abbassare i rami in disparte era la scelta di prima, e
// faceva sembrare mezzo schermo a luminosita' ridotta.

// Arancione del marchio Claude portato al valore massimo: stessa tinta di
// #D97757, con il canale piu' alto a 255. Il truecolor e' necessario perche' nella
// tavolozza a 256 colori non c'e' un tono vicino, e i terminali che ci interessano
// (Windows Terminal, iTerm2, alacritty, VS Code) lo supportano tutti.
const ARANCIONE = '38;2;255;140;102';
// Unico tono abbassato dell'interfaccia: la legenda.
const GRIGIO = '38;2;140;140;140';

// Verde e rosso delle righe aggiunte e tolte. Non sono tinte scelte a occhio:
// hanno la stessa saturazione e la stessa luminosita' dell'arancione del marchio
// (in HSL: 100% e 70%), e cambiano solo la tonalita'. Cosi' restano coerenti con
// la regola della tavolozza — ci si distingue per TINTA, non per luminosita' — e
// nessuno dei tre colori sembra piu' acceso degli altri.
const VERDE = '38;2;102;255;166'; // hsl(140, 100%, 70%)
const ROSSO = '38;2;255;102;102'; // hsl(0, 100%, 70%)

// I colori si spengono se l'uscita non e' un terminale (redirezione, pipe, test)
// o se l'utente lo chiede con NO_COLOR, la convenzione di no-color.org.
// CB_COLORI=1 li riaccende a forza, per catturare l'aspetto vero in un file.
// ritorna: true se si possono emettere sequenze ANSI di colore
export function coloriAttivi() {
  if (process.env.NO_COLOR) return false;
  if (process.env.CB_COLORI === '1') return true;
  return Boolean(process.stdout.isTTY);
}

// Costruisce una funzione che veste un testo con un codice SGR.
// codice: parametri della sequenza (es. "1;38;2;255;140;102")
// ritorna: funzione testo -> testo colorato (o intatto, se i colori sono spenti)
const vesti = (codice) => (testo) =>
  coloriAttivi() ? `\x1b[${codice}m${testo}\x1b[0m` : testo;

export const arancione = vesti(ARANCIONE);
export const arancioneForte = vesti(`1;${ARANCIONE}`);
export const grigio = vesti(GRIGIO);
export const verde = vesti(VERDE);
export const rosso = vesti(ROSSO);

// Massima luminosita': nessun colore, cioe' il primo piano del terminale cosi'
// com'e'. E' piu' chiaro di qualsiasi bianco scelto da noi, perche' e' esattamente
// quello che l'utente ha impostato come testo normale.
export const normale = (testo) => testo;
