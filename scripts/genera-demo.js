// Genera assets/demo.svg: le schermate di cb che si susseguono da sole, per la cima del README.
// Un SVG animato invece di una GIF: pesa pochi kB, resta nitido a ogni zoom, e si scrive senza
// registrare nulla — le schermate sono quelle già documentate nel README, quindi non c'è il
// rischio di pubblicare per sbaglio i prompt di una sessione vera.
// Uso: node scripts/genera-demo.js

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const QUI = dirname(fileURLToPath(import.meta.url));
const USCITA = join(QUI, '..', 'assets', 'demo.svg');

// Geometria: cella monospace, margini, e la durata di un giro completo.
const CELLA_X = 8.05;      // larghezza di un carattere
const CELLA_Y = 19;        // altezza di una riga
const MARGINE = 22;
const SECONDI_PER_FRAME = 3.5;

// La tavolozza: sfondo di terminale scuro, e l'arancione che in cb marca ciò che parte per primo.
const COLORI = {
  sfondo: '#0d1117',
  bordo: '#30363d',
  testo: '#c9d1d9',
  tenue: '#8b949e',
  accento: '#e8913a',
};

// Le schermate, nell'ordine in cui si vedono. La prima riga di ognuna va in arancione,
// l'ultima (la legenda dei tasti) in grigio: sono le due che si leggono senza leggerle.
//
// I primi tre frame sono lo stesso albero col cursore in tre punti diversi: fermo, cb
// sembra un disegno: si capisce che ci si naviga dentro solo vedendo il `◯` spostarsi e
// il riquadro sotto seguirlo. Prima `←→` lungo la conversazione, poi `↑↓` fra i rami di
// una stessa biforcazione — che sono i due movimenti da capire, e nessuna didascalia li
// spiega quanto il vederli.
const FRAMES = [
  [
    '  cb  branches of the conversation',
    '  ──────────────────────────────────────────────────────────────────────',
    '  ◯ restart here   ┳ fork   © compacted',
    '  ──────────────────────────────────────────────────────────────────────',
    '',
    '  ⬤━━━⬤━━━⬤━━━◯━┳━⬤━━━⬤━━━⬤━━━⬤',
    '                ┗━⬤━┳━⬤━━━⬤',
    '                    ┗━⬤━━━⬤━━━⬤',
    '',
    '  ╭────────────────────────────────────────────────────────────────────╮',
    '  │ 24-07 15:10  +18 -0  restart here                                  │',
    "  │ let's do the customer list                                         │",
    '  ╰────────────────────────────────────────────────────────────────────╯',
    '',
    '  earlier: 0',
    '',
    '',
    '',
    '',
    '  ──────────────────────────────────────────────────────────────────────',
    '  ←→↑↓ wasd pick the point   enter restart   p queue   n notes   esc exit',
  ],
  [
    '  cb  branches of the conversation',
    '  ──────────────────────────────────────────────────────────────────────',
    '  ◯ restart here   ┳ fork   © compacted',
    '  ──────────────────────────────────────────────────────────────────────',
    '',
    '  ⬤━━━⬤━━━⬤━━━⬤━┳━⬤━━━◯━━━⬤━━━⬤',
    '                ┗━⬤━┳━⬤━━━⬤',
    '                    ┗━⬤━━━⬤━━━⬤',
    '',
    '  ╭────────────────────────────────────────────────────────────────────╮',
    '  │ 24-07 15:57  +7 -3  restart here                                   │',
    '  │ much smoother, but still choppy                                    │',
    '  ╰────────────────────────────────────────────────────────────────────╯',
    '',
    '  earlier: 2',
    '    24-07 15:51  the app got very slow, rendering the list freezes',
    "    24-07 15:10  let's do the customer list",
    '',
    '',
    '  ──────────────────────────────────────────────────────────────────────',
    '  ←→↑↓ wasd pick the point   enter restart   p queue   n notes   esc exit',
  ],
  [
    '  cb  branches of the conversation',
    '  ──────────────────────────────────────────────────────────────────────',
    '  ◯ restart here   ┳ fork   © compacted',
    '  ──────────────────────────────────────────────────────────────────────',
    '',
    '  ⬤━━━⬤━━━⬤━━━⬤━┳━⬤━━━⬤━━━⬤━━━⬤',
    '                ┗━⬤━┳━⬤━━━◯',
    '                    ┗━⬤━━━⬤━━━⬤',
    '',
    '  ╭────────────────────────────────────────────────────────────────────╮',
    '  │ 24-07 17:26  +42 -7  restart here                                  │',
    '  │ the branch you abandoned an hour ago, still here                   │',
    '  ╰────────────────────────────────────────────────────────────────────╯',
    '',
    '  earlier: 3',
    '    24-07 16:04  try it without the memo',
    '    24-07 15:51  the app got very slow, rendering the list freezes',
    "    24-07 15:10  let's do the customer list",
    '',
    '  ──────────────────────────────────────────────────────────────────────',
    '  ←→↑↓ wasd pick the point   enter restart   p queue   n notes   esc exit',
  ],
  [
    '  cb  branches of the conversation',
    '  ──────────────────────────────────────────────────────────────────────',
    '',
    '  ⬤━━━⬤━━━⬤━━━⬤━┳━⬤━━━⬤━━━⬤━━━⬤',
    '                ┗━⬤━┳━⬤━━━◯',
    '                    ┗━⬤━━━⬤━━━⬤',
    '',
    '  what do I roll back?',
    '  ▸ 1. the conversation and the files',
    '    2. the conversation only (files stay as they are)',
    '    3. the files only (the conversation stays where it is)',
    '',
    '    ←→  the prompt you picked stays sent, with the answer it got',
    '     r  [ ] remember this for next time',
    '',
    '  The branch you leave is not lost: it stays in the tree, set aside.',
    '',
    '  ──────────────────────────────────────────────────────────────────────',
    '  ↑↓ 1-3 pick   enter confirm   esc back   canc exit',
  ],
  [
    '  cb  prompt queue',
    '  they go out one at a time, when Claude finishes a turn',
    '',
    '  4 prompts waiting',
    '',
    '  ──────────────────────────────────────────────────────────────────────',
    '     1. fix the failing test',
    '  ──────────────────────────────────────────────────────────────────────',
    '     2. update the README  ⤼ skip',
    '  ──────────────────────────────────────────────────────────────────────',
    '  ╭────────────────────────────────────────────────────────────────────╮',
    '  │  3. ‖ stop bump the version█                                       │',
    '  ╰────────────────────────────────────────────────────────────────────╯',
    '  ──────────────────────────────────────────────────────────────────────',
    '     4. make the commit',
    '  ──────────────────────────────────────────────────────────────────────',
    '    queue a prompt',
    '',
    '  ──────────────────────────────────────────────────────────────────────',
    '  enter queue   ↑↓ pick and edit   ctrl+↑↓ move   ctrl+canc remove   esc',
  ],
  [
    '  cb  notes',
    '  of C:\\Users\\me\\projects\\web — the same in every session here',
    '',
    '  2 notes',
    '',
    '  ──────────────────────────────────────────────────────────────────────',
    '    Ports',
    '    4310 and 4311 are already taken by omniroute',
    '  ──────────────────────────────────────────────────────────────────────',
    '    remember to publish before touching the profiles',
    '  ──────────────────────────────────────────────────────────────────────',
    '  ╭────────────────────────────────────────────────────────────────────╮',
    '  │ New note                                                           │',
    '  │                                                                    │',
    '  │ typing in here█                                                    │',
    '  ╰────────────────────────────────────────────────────────────────────╯',
    '',
    '  They belong to the folder, not to the conversation: they outlive /clear.',
    '',
    '  ──────────────────────────────────────────────────────────────────────',
    '  enter save   shift+enter new line   ctrl+enter send   ctrl+f search   esc',
  ],
];

// I caratteri che non stanno in una cella monospazio, e con cosa si sostituiscono.
//
// Misurati nel browser con `getComputedTextLength`, in rapporto alla cella (7,698 px a
// font-size 14): il tondo pieno dei nodi sta a **1,567**, cioè il 57% più larga di una cella, e
// il tondo vuoto a 1,095. Sono loro a sfasare l'albero: i raccordi (`━ ┳ ┗ ┣ │`) e le cornici
// (`╭ ╮ ╰ ╯`) misurano tutti 1,000 esatto, quindi il disegno era giusto e i **nodi** lo
// spostavano. In un terminale non si nota perché è la griglia a imporre la cella; qui il testo
// scorre libero, e un carattere più largo sposta tutto quello che lo segue sulla riga.
//
// Le sostituzioni sono i tondi della stessa famiglia ma a larghezza di cella — a occhio nudo la
// differenza non c'è, e l'alternativa era un albero coi raccordi scollati dai nodi.
const IN_CELLA = { '⬤': '●', '◯': '○', '⤼': '»' };

// Caratteri non ASCII **misurati** a 1,000 celle nel browser, quindi sicuri.
// Chi ne aggiunge uno lo misuri prima, invece di fidarsi: sono tre righe di
// getComputedTextLength e l'alternativa è un disegno sfasato che nessuna prova vede.
const SICURI = new Set([...'●○━─┳┗┣│╭╮╰╯©‖█▸↑↓←→»…—']);

// Porta una riga a caratteri che stanno tutti in una cella.
//
// E si ferma se ne trova uno che non conosce. Serve perché i fotogrammi si
// incollano dal README, e il giorno che una schermata nuova porta un glifo largo il
// disegno si sfaserebbe **in silenzio**: nessuna prova guarda un'immagine. Meglio
// non generare niente che generare un albero coi raccordi scollati.
function perCella(testo) {
  const pulito = testo.replace(/[⬤◯⤼]/g, (ch) => IN_CELLA[ch]);
  const ignoti = [...pulito].filter((ch) => ch.codePointAt(0) > 126 && !SICURI.has(ch));
  if (ignoti.length > 0) {
    throw new Error(
      `carattere di larghezza non verificata: ${[...new Set(ignoti)].join(' ')}\n`
      + `Misuralo nel browser (getComputedTextLength su 10 ripetizioni / cella): se sta a\n`
      + `1,000 aggiungilo a SICURI, se no mettilo in IN_CELLA con un sostituto che ci sta.`,
    );
  }
  return pulito;
}

// I cinque caratteri che in XML non possono stare nudi dentro un nodo di testo.
function scappa(testo) {
  return testo
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Una riga di schermata come nodo <text>.
//
// **Niente `textLength`.** L'idea era costringere ogni riga alla larghezza esatta di tante
// celle quanti sono i caratteri, per tenere le colonne in squadra. Fa il contrario:
// `lengthAdjust="spacingAndGlyphs"` **stira i glifi** per arrivare alla misura, e i caratteri
// che il font monospazio non ha — il tondo dei nodi, i raccordi dell'albero — arrivano da un
// fallback di larghezza diversa, quindi venivano deformati per compensare. Visto a schermo: i
// nodi dell'albero diventavano ellissi e il testo dentro il riquadro si spaziava da solo.
// Senza, ogni riga esce alla sua larghezza naturale — che col monospazio è già in squadra, ed
// è il motivo per cui si usa un monospazio.
//
// `xml:space="preserve"` non è un dettaglio: SVG collassa gli spazi multipli come fa HTML,
// quindi `  cb  branches` diventava `cb branches` e ogni rientro del disegno spariva — cioè
// tutto l'allineamento, che è l'unica cosa che questo disegno non può permettersi.
function riga(testo, indice, colore) {
  const y = MARGINE + (indice + 1) * CELLA_Y;
  return `<text xml:space="preserve" x="${MARGINE}" y="${y}" fill="${colore}">${scappa(perCella(testo))}</text>`;
}

// Il colore di una riga: la prima è l'intestazione, l'ultima la legenda dei tasti.
function coloreDi(indice, totale) {
  if (indice === 0) return COLORI.accento;
  if (indice === totale - 1) return COLORI.tenue;
  return COLORI.testo;
}

const colonne = Math.max(...FRAMES.flat().map((r) => r.length));
const righe = Math.max(...FRAMES.map((f) => f.length));
const larghezza = Math.round(colonne * CELLA_X + MARGINE * 2);
const altezza = Math.round((righe + 1) * CELLA_Y + MARGINE * 2);
const durata = FRAMES.length * SECONDI_PER_FRAME;

// La quota di giro che spetta a un frame, in percentuale: serve a scrivere i keyframes una volta
// sola indipendentemente da quanti frame ci sono.
const quota = 100 / FRAMES.length;

const gruppi = FRAMES.map((frame, i) => {
  const corpo = frame
    .map((testo, j) => riga(testo, j, coloreDi(j, frame.length)))
    .join('\n    ');
  // Il primo porta anche `primo`: e' quello che si vede quando l'animazione non
  // parte (vedi lo stile).
  const classi = i === 0 ? 'f primo' : 'f';
  return `  <g class="${classi}" style="animation-delay:${i * SECONDI_PER_FRAME}s">\n    ${corpo}\n  </g>`;
}).join('\n');

// Il taglio fra un fotogramma e il successivo e' netto, non in dissolvenza.
//
// Con la dissolvenza c'erano **buchi**: il fotogramma che esce arrivava a zero
// prima che il successivo cominciasse a salire, e per ~0,3 secondi a ogni
// passaggio non si vedeva niente — misurato, 19 istanti vuoti su 211, cioe' il 9%
// del giro passato a guardare un rettangolo nero. Una dissolvenza vera vorrebbe
// dire far sovrapporre due fotogrammi, e con del testo sopra del testo si legge
// peggio di uno stacco.
//
// Quindi ogni fotogramma resta pieno per **esattamente** la sua quota e sparisce
// al centesimo dopo: le quote si affiancano senza lasciare scoperto niente.
const ultimoPieno = (quota - quota / 100).toFixed(3);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${larghezza}" height="${altezza}" viewBox="0 0 ${larghezza} ${altezza}" font-family="SFMono-Regular, Consolas, Menlo, 'DejaVu Sans Mono', monospace" font-size="14">
  <style>
    .f { opacity: 0; animation: ciclo ${durata}s infinite; }
    /* Se l'animazione non parte — una scheda in background, un lettore che le
       ignora — questa e' l'unica cosa che si vede, e deve essere una schermata
       vera invece del rettangolo vuoto. Durante l'animazione i keyframe vincono
       su questa regola, quindi non cambia niente. */
    .primo { opacity: 1 }
    @keyframes ciclo {
      0%   { opacity: 1 }
      ${ultimoPieno}%  { opacity: 1 }
      ${quota.toFixed(3)}%  { opacity: 0 }
      100% { opacity: 0 }
    }
  </style>
  <rect width="${larghezza}" height="${altezza}" rx="8" fill="${COLORI.sfondo}" stroke="${COLORI.bordo}"/>
${gruppi}
</svg>
`;

mkdirSync(dirname(USCITA), { recursive: true });
writeFileSync(USCITA, svg, 'utf8');
console.log(`${USCITA}  ${colonne}x${righe} celle, ${FRAMES.length} schermate, giro di ${durata}s`);
