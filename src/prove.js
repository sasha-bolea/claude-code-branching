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
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cartella = path.dirname(fileURLToPath(import.meta.url));

// Una casa tutta per le prove. I transcript finti vanno dove Claude scrive i suoi,
// cioe' sotto la home, e con la home vera le prove scrivono in mezzo alle
// conversazioni di chi le esegue: overlay.test.js se ne accorgeva e ripuliva alla
// fine, ma bastava un'interruzione a lasciare una cartella finta nel catalogo.
//
// Su Windows quella scrittura arrivava perfino a fallire con EPERM: una cartella
// appena cancellata resta in «pending delete» finche' un handle e' aperto, e
// riaprirci dentro non e' permesso — motivo per cui la CI era rossa lì e verde
// altrove, e verde su node 22, che e' solo piu' veloce.
//
// `os.homedir()` legge USERPROFILE su Windows e HOME altrove: si impostano
// entrambe. Va fatto qui e non nei singoli file perche' CARTELLA_PROGETTI si
// calcola all'import di percorsi.js, e a quel punto sarebbe tardi.
const casa = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-prove-casa-'));
const pulisciCasa = () => fs.rmSync(casa, { recursive: true, force: true });
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
      USERPROFILE: casa,
      HOME: casa,
    },
  });
  if (esito.status !== 0) {
    console.error(`\n${nome}: prove fallite`);
    pulisciCasa();
    process.exit(esito.status ?? 1);
  }
}

pulisciCasa();
console.log(`\n${prove.length} file di prove, tutti superati`);
