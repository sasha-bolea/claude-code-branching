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

// I cinque caratteri che in XML non possono stare nudi dentro un nodo di testo.
function scappa(testo) {
  return testo
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Una riga di schermata come nodo <text>. `textLength` la costringe alla larghezza esatta di
// tante celle quanti sono i caratteri: senza, un font che rende i glifi dell'albero più larghi
// del resto sfaserebbe le colonne, che è l'unica cosa che questo disegno non può permettersi.
function riga(testo, indice, colore) {
  const y = MARGINE + (indice + 1) * CELLA_Y;
  const larghezza = (testo.length * CELLA_X).toFixed(2);
  return `<text x="${MARGINE}" y="${y}" textLength="${larghezza}" `
    + `lengthAdjust="spacingAndGlyphs" fill="${colore}">${scappa(testo)}</text>`;
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
  return `  <g class="f" style="animation-delay:${i * SECONDI_PER_FRAME}s">\n    ${corpo}\n  </g>`;
}).join('\n');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${larghezza}" height="${altezza}" viewBox="0 0 ${larghezza} ${altezza}" font-family="SFMono-Regular, Consolas, Menlo, 'DejaVu Sans Mono', monospace" font-size="14">
  <style>
    .f { opacity: 0; animation: ciclo ${durata}s infinite; }
    @keyframes ciclo {
      0%   { opacity: 0 }
      1%   { opacity: 1 }
      ${(quota - 1).toFixed(2)}%  { opacity: 1 }
      ${quota.toFixed(2)}%  { opacity: 0 }
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
