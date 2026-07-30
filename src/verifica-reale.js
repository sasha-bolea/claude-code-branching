import { leggiTranscript, biforcazioni, ripristini, foglie, catenaFinoA } from './transcript.js';

// Ispeziona una sessione reale: biforcazioni, ripristini, rami percorribili.
// Utile per capire com'e' fatta una conversazione senza aprirla.
// Uso: node src/verifica-reale.js <percorso.jsonl>
const percorso = process.argv[2];
if (!percorso) {
  console.error('uso: node src/verifica-reale.js <percorso.jsonl>');
  console.error('i transcript stanno in ~/.claude/projects/<progetto>/');
  process.exit(1);
}

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

const punte = foglie(albero);
console.log(`\nFOGLIE (rami percorribili): ${punte.length}`);
for (const nodo of punte) {
  console.log(
    `  ${nodo.uuid.slice(0, 8)} ${nodo.timestamp} profondita=${catenaFinoA(albero, nodo.uuid).length}`,
  );
}
