// Esecutore delle prove: lancia tutti i file *.test.js, uno per processo.
//
// Perche' non una catena di `&&` nel package.json: quella andava aggiornata a
// mano a ogni file nuovo, e soprattutto non poteva fissare la lingua.
//
// La lingua va fissata: le prove confrontano stringhe che si vedono a schermo, e
// senza CB_LINGUA quelle stringhe seguono il locale della macchina. Sulla
// macchina di chi scrive sono italiane, su una macchina inglese (la CI) sarebbero
// inglesi, e le stesse prove passerebbero o fallirebbero a seconda di dove
// girano. Che la tabella inglese sia completa lo verifica lingua.test.js, che
// confronta le due tabelle fra loro invece che con lo schermo.
//
// Un processo per file e non un import() dietro l'altro: overlay.test.js finisce
// con process.exit(0) — gli servono handle che restano aperti — e in un processo
// solo quella riga si porterebbe via anche le prove che vengono dopo, senza dirlo.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cartella = path.dirname(fileURLToPath(import.meta.url));
const prove = fs
  .readdirSync(cartella)
  .filter((nome) => nome.endsWith('.test.js'))
  .sort();

for (const nome of prove) {
  console.log(`\n── ${nome}`);
  const esito = spawnSync(process.execPath, [path.join(cartella, nome)], {
    stdio: 'inherit',
    env: {
      ...process.env,
      CB_LINGUA: 'it',
      // Stessa ragione della lingua: l'ambiente non deve decidere l'esito. Il
      // costruttore del Wrapper risolve l'eseguibile di Claude, quindi ogni prova
      // che ne crea uno pretendeva Claude Code installato — vero sulla macchina di
      // chi scrive, falso su una CI, dove le prove morivano con «eseguibile non
      // trovato». Le prove non lo lanciano mai (il pty e' finto): basta che il
      // percorso esista, e node c'e' sempre. Chi ne ha uno vero lo tiene.
      CB_CLAUDE_EXE: process.env.CB_CLAUDE_EXE ?? process.execPath,
    },
  });
  if (esito.status !== 0) {
    console.error(`\n${nome}: prove fallite`);
    process.exit(esito.status ?? 1);
  }
}

console.log(`\n${prove.length} file di prove, tutti superati`);
