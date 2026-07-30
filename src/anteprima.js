// Mostra l'overlay dell'albero come lo vedrebbe l'utente, senza lanciare Claude.
// Serve a guardare una modifica all'interfaccia su una conversazione vera: le
// prove verificano la struttura del disegno, non se e' leggibile.
//
// Uso: node src/anteprima.js [percorso.jsonl]
// Senza argomenti prende la sessione con piu' ripristini, che e' quella con
// l'albero piu' ramificato.

// I colori si accendono a forza: cosi' l'anteprima si puo' anche redirigere su
// file conservando le sequenze ANSI.
process.env.CB_COLORI = process.env.CB_COLORI ?? '1';

import { scansiona } from './indice.js';
import { leggiTranscript, unisciAlberi } from './transcript.js';
import { sessioniDellaFamiglia } from './percorsi.js';
import { componiVista, schermata, puntaRamoAttivo } from './vista.js';
import { grigio } from './stile.js';

const indicato = process.argv[2];
let percorso = indicato;

if (!percorso) {
  const schede = await scansiona();
  if (schede.length === 0) {
    console.error('nessuna sessione in ~/.claude/projects');
    process.exit(1);
  }
  percorso = [...schede].sort((a, b) => b.ripristini - a.ripristini)[0].percorso;
}

// I rami abbandonati prima di un fork vivono nel file di partenza: senza unire
// la famiglia l'anteprima mostrerebbe meno rami di quelli veri.
const famiglia = await sessioniDellaFamiglia(percorso);
const alberi = [];
for (const file of famiglia) alberi.push(await leggiTranscript(file));
const albero = unisciAlberi(alberi, famiglia);

const colonne = process.stdout.columns || 118;
const altezza = process.stdout.rows || 34;
const vista = componiVista(albero);
const selezione = puntaRamoAttivo(vista);

for (const riga of schermata(vista, selezione, { colonne, altezza })) console.log(riga);
console.log(
  `\n  ${grigio(
    `${vista.nodi.length} prompt · ${vista.griglia.length} righe di albero · ` +
      `${famiglia.length} sessioni in famiglia · ${percorso}`,
  )}`,
);
