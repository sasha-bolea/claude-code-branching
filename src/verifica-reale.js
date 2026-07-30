import { leggiTranscript, biforcazioni, ripristini, foglie, catenaFinoA } from './transcript.js';

// Verifica del parser su una sessione reale con biforcazioni note.
// Uso: node src/verifica-reale.js [percorso.jsonl]
const percorso =
  process.argv[2] ??
  'C:/Users/sasha/.claude/projects/C--Users-sasha-Documents-REPOSITORY-stage-capability-city/d19054ba-58d6-4208-b52e-36e4fd7d963f.jsonl';

const breve = (t) => (t || '').replace(/\s+/g, ' ').slice(0, 60);

const albero = await leggiTranscript(percorso);
console.log(
  `righe=${albero.righe} nodi=${albero.nodi.size} sidechain=${albero.sidechain} ` +
    `radici=${albero.radici.length} leafAttivo=${albero.leafAttivo}`,
);
console.log(`titolo=${albero.titolo}`);

const forche = biforcazioni(albero);
console.log(`\nBIFORCAZIONI: ${forche.length}`);
for (const nodo of forche) {
  console.log(
    `  ${nodo.uuid.slice(0, 8)} [${nodo.tipo}] figli=${nodo.figli.length} :: ${breve(nodo.testo)}`,
  );
}

const veri = ripristini(albero);
console.log(`\nRIPRISTINI VERI (rami di conversazione): ${veri.length}`);
for (const { nodo, rami } of veri) {
  console.log(`  ${nodo.uuid.slice(0, 8)} [${nodo.tipo}] -> ${rami.length} rami`);
  for (const { prompt } of rami) {
    console.log(`      ${prompt.timestamp} :: ${breve(prompt.testo)}`);
  }
}

const atteso = albero.nodi.get('2ef53446-93a5-40c6-8e6e-f494cdb22405');
console.log(`\nNODO ATTESO 2ef53446: ${atteso ? `figli=${atteso.figli.length}` : 'NON TROVATO'}`);
if (atteso) {
  for (const figlio of atteso.figli) {
    console.log(`   -> ${figlio.uuid.slice(0, 8)} ${figlio.timestamp} :: ${breve(figlio.testo)}`);
  }
}

const punte = foglie(albero);
console.log(`\nFOGLIE (rami percorribili): ${punte.length}`);
for (const nodo of punte) {
  console.log(
    `  ${nodo.uuid.slice(0, 8)} ${nodo.timestamp} profondita=${catenaFinoA(albero, nodo.uuid).length}`,
  );
}
