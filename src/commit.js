import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Lettura dei commit automatici scritti dall'hook `Stop` (hooks/cb-commit.ps1).
//
// L'hook salva tutto il working tree a fine turno su un ref nascosto
// (refs/cb/<sessione>/auto) e scrive nel messaggio l'uuid dell'ultimo messaggio
// del turno. Quell'uuid e' l'aggancio fra l'albero della conversazione e lo
// storico del codice: dal punto scelto si risale al commit corrispondente.
//
// A cosa serve: le copie di Claude scadono dopo qualche settimana, e coprono
// solo i file che Claude ha toccato. I commit non scadono e contengono tutto il
// working tree, quindi sono il ripiego naturale quando una copia non c'e' piu'.
//
// Perche' leggerli e non usarli sempre: un commit e' un albero intero, e
// riportarlo indietro tutto sovrascriverebbe anche i file che il ripristino non
// aveva motivo di toccare. Qui si prende un file per volta, su richiesta.

// Separatori improbabili in un messaggio di commit: servono a leggere piu'
// commit con una sola chiamata a git, senza doverne indovinare i confini.
const FRA_CAMPI = '\x1f'; // separatore di unita'
const FRA_COMMIT = '\x1e'; // separatore di record

// Esegue git raccogliendone l'uscita, e ritorna null se fallisce.
// Un repo senza i ref di cb, o una cartella che non e' un repo, non sono errori:
// significano solo che questo ripiego non e' disponibile.
// argomenti: array di argomenti per git
// opzioni.grezzo: true per avere un Buffer invece di una stringa
// ritorna: stringa | Buffer | null
function git(argomenti, { grezzo = false } = {}) {
  try {
    return execFileSync('git', argomenti, {
      encoding: grezzo ? 'buffer' : 'utf8',
      maxBuffer: 100 * 1024 * 1024,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

// Radice del repo git che contiene una cartella.
// cartella: percorso di lavoro
// ritorna: percorso della radice, o null se non siamo in un repo
export function radiceGit(cartella) {
  const uscita = git(['-C', cartella, 'rev-parse', '--show-toplevel']);
  return uscita ? uscita.trim() : null;
}

// Tutti i commit automatici di cb presenti nel repo, dal piu' recente.
//
// Si leggono i ref di TUTTE le sessioni, non solo quelle della conversazione
// corrente: il working tree e' uno solo, quindi un commit vale come fotografia
// del codice a quell'istante da qualunque sessione sia stato scritto.
//
// radice: radice del repo
// ritorna: [{ hash, istante, messaggio }] — istante in millisecondi
export function commitDiCb(radice) {
  const uscita = git([
    '-C',
    radice,
    'log',
    '--glob=refs/cb/*/auto',
    `--format=%H${FRA_CAMPI}%ct${FRA_CAMPI}%B${FRA_COMMIT}`,
  ]);
  if (!uscita) return [];

  const commit = [];
  for (const blocco of uscita.split(FRA_COMMIT)) {
    const [hash, secondi, corpo] = blocco.split(FRA_CAMPI);
    if (!hash?.trim() || !secondi) continue;

    const messaggio = /^messaggio:\s*(\S+)/m.exec(corpo ?? '')?.[1] ?? null;
    commit.push({ hash: hash.trim(), istante: Number(secondi) * 1000, messaggio });
  }

  return commit;
}

// Il commit che fotografa il codice a un dato punto della conversazione.
//
// Prima si cerca l'uuid: l'hook lo scrive, ed e' l'aggancio esatto. Se quel
// turno non ha un commit — perche' non aveva toccato nessun file, e l'hook in
// quel caso non ne scrive — si ripiega sull'ultimo commit precedente
// all'istante: e' quello che descrive il codice com'era allora, visto che dopo
// di lui nessuno l'ha piu' cambiato fino al turno successivo.
//
// commit: risultato di commitDiCb
// uuid: uuid del messaggio scelto
// istante: millisecondi di fine turno
// ritorna: hash | null
export function commitDelPunto(commit, uuid, istante) {
  const esatto = commit.find((c) => c.messaggio && c.messaggio === uuid);
  if (esatto) return esatto.hash;

  // commitDiCb li da' dal piu' recente: il primo che non e' nel futuro e' quello.
  const precedente = commit.find((c) => c.istante <= istante);
  return precedente?.hash ?? null;
}

// Il percorso con i collegamenti risolti, per poterne confrontare due.
//
// La radice del repo la dice git (`rev-parse --show-toplevel`), che risponde
// sempre col percorso reale; il percorso del file arriva invece da chi chiama,
// cosi' com'e'. Se uno dei due passa per un collegamento, `path.relative` fra i
// due esce con `..` e il file sembra stare fuori dal repo: il ripiego dai commit
// si spegne da solo, senza dire niente. Non e' un caso di laboratorio — su macOS
// la cartella temporanea sta sotto `/var`, che e' un link a `/private/var`, e su
// Windows un percorso in formato 8.3 (`RUNNER~1`) non combacia col nome lungo.
//
// Il file puo' non esistere piu' (un ripristino serve proprio a riportarlo
// indietro): allora si risolve la cartella, che c'e', e le si riattacca il nome.
// Se non si risolve niente si restituisce il percorso di partenza, che e' quanto
// si faceva prima.
//
// Si usa la variante **nativa**: `realpathSync` risolve i collegamenti ma lascia
// i nomi in formato 8.3 (`RUNNER~1`) come li trova, e quelli non combaciano col
// nome lungo che restituisce git. `realpathSync.native` chiede il percorso
// canonico al sistema, nome lungo compreso. E' il caso che teneva rossa la CI su
// Windows anche dopo aver sistemato macOS.
// ritorna: percorso risolto
function reale(percorso) {
  const risolvi = fs.realpathSync.native ?? fs.realpathSync;
  try {
    return risolvi(percorso);
  } catch {
    try {
      return path.join(risolvi(path.dirname(percorso)), path.basename(percorso));
    } catch {
      return percorso;
    }
  }
}

// Contenuto di un file come stava in un commit.
// radice: radice del repo
// hash: commit da cui leggere
// percorso: percorso assoluto del file
// ritorna: Buffer, o null se il file non era nel commit o sta fuori dal repo
export function contenutoDaCommit(radice, hash, percorso) {
  const relativo = path.relative(reale(radice), reale(percorso)).replace(/\\/g, '/');
  if (!relativo || relativo.startsWith('..')) return null;
  return git(['-C', radice, 'show', `${hash}:${relativo}`], { grezzo: true });
}

// Prepara il ripiego da passare a ripristinaA: una funzione che, dato un file,
// ne restituisce il contenuto al punto scelto.
//
// Ritorna null quando il ripiego non e' disponibile — fuori da un repo, o senza
// commit automatici — cosi' chi chiama non deve sapere niente di git.
//
// cartella: cwd della sessione
// uuid: messaggio scelto nell'albero
// istante: millisecondi di fine turno
// ritorna: (percorso) => Buffer|null, oppure null
export function ripiegoDaiCommit(cartella, uuid, istante) {
  const radice = radiceGit(cartella);
  if (!radice) return null;

  const commit = commitDiCb(radice);
  if (commit.length === 0) return null;

  const hash = commitDelPunto(commit, uuid, istante);
  if (!hash) return null;

  return (percorso) => contenutoDaCommit(radice, hash, percorso);
}
