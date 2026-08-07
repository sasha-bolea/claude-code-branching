// Mostra l'overlay dell'albero come lo vedrebbe l'utente, senza lanciare Claude.
// Serve a guardare una modifica all'interfaccia su una conversazione vera: le
// prove verificano la struttura del disegno, non se e' leggibile.
//
// Uso: node src/anteprima.js [percorso.jsonl] [--menu[=indice]]
// Senza argomenti prende la sessione con piu' ripristini, che e' quella con
// l'albero piu' ramificato. Con --menu si guarda la schermata come si presenta
// dopo aver premuto invio, quando si sceglie cosa riportare indietro.

// I colori si accendono a forza: cosi' l'anteprima si puo' anche redirigere su
// file conservando le sequenze ANSI.
process.env.CB_COLORI = process.env.CB_COLORI ?? '1';

import { scansiona } from './indice.js';
import { leggiTranscript, unisciAlberi } from './transcript.js';
import { sessioniDellaFamiglia } from './percorsi.js';
import { componiVista, schermata, puntaRamoAttivo } from './vista.js';
import { grigio } from './stile.js';
import { T } from './lingua.js';

const argomenti = process.argv.slice(2);
const richiestaMenu = argomenti.find((a) => a.startsWith('--menu'));
const menu = richiestaMenu ? Number.parseInt(richiestaMenu.split('=')[1] ?? '0', 10) : null;
let percorso = argomenti.find((a) => !a.startsWith('--'));

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

// Gli stessi tasti in piu' che annuncia l'overlay dentro la sessione: senza,
// l'anteprima mostrerebbe una barra che nella realta' non si vede mai.
// La schermata riempie l'altezza che le si dichiara: qui se ne tolgono due
// righe per il riepilogo qui sotto, che altrimenti farebbe scorrere via
// l'intestazione.
const righe = schermata(vista, selezione, {
  colonne,
  altezza: Math.max(10, altezza - 2),
  extra: { lunga: T.albero.extraLunga, corta: T.albero.extraCorta },
  menu,
});
for (const riga of righe) console.log(riga);
console.log(
  `\n  ${grigio(
    `${vista.nodi.length} prompt · ${vista.griglia.length} righe di albero · ` +
      `${famiglia.length} sessioni in famiglia · ${percorso}`,
  )}`,
);
