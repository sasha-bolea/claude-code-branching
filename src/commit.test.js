import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  radiceGit,
  commitDiCb,
  commitDelPunto,
  contenutoDaCommit,
  ripiegoDaiCommit,
} from './commit.js';

// Repo di prova con dentro i commit automatici, scritti come li scrive l'hook:
// index temporaneo, commit-tree, ref nascosto. Riprodurli qui invece di lanciare
// l'hook tiene le prove dentro node, senza dipendere da pwsh.
// ritorna: { repo, salva, pulisci }
function repoDiProva(nome) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), `cb-commit-${nome}-`));
  const git = (argomenti, opzioni = {}) =>
    execFileSync('git', ['-C', repo, ...argomenti], { encoding: 'utf8', ...opzioni }).trim();

  git(['init', '-q', '.']);
  git(['config', 'user.email', 'prova@cb']);
  git(['config', 'user.name', 'prova']);
  // Un commit vero sul branch: serve a verificare che i commit di cb restino
  // fuori da `git log`, che in un repo senza commit fallirebbe e basta.
  fs.writeFileSync(path.join(repo, 'letto.md'), 'repo di prova', 'utf8');
  git(['add', '-A']);
  git(['commit', '-qm', 'base']);

  // Salva lo stato corrente della cartella su refs/cb/<sessione>/auto, con il
  // messaggio nel formato dell'hook.
  // uuid: messaggio a cui il commit corrisponde (null per ometterlo)
  // quando: data del commit, in formato ISO
  // ritorna: hash del commit
  const salva = (sessione, uuid, quando) => {
    const ref = `refs/cb/${sessione}/auto`;
    const indice = path.join(repo, '.git', `cb-index-${sessione}`);
    const env = { ...process.env, GIT_INDEX_FILE: indice, GIT_AUTHOR_DATE: quando, GIT_COMMITTER_DATE: quando };

    let precedente = null;
    try {
      precedente = git(['rev-parse', '--verify', '--quiet', ref]);
    } catch {
      precedente = null; // primo commit della sessione
    }
    if (precedente) git(['read-tree', precedente], { env });
    git(['add', '-A'], { env });

    const albero = git(['write-tree'], { env });
    const testo = `cb: ${sessione.slice(0, 8)} ${quando}\n\nsessione: ${sessione}\n` +
      (uuid ? `messaggio: ${uuid}\n` : '');
    const argomenti = ['commit-tree', albero, ...(precedente ? ['-p', precedente] : [])];
    const commit = git(argomenti, { env, input: testo });

    git(['update-ref', ref, commit], { env });
    fs.rmSync(indice, { force: true });
    return commit;
  };

  return { repo, salva, pulisci: () => fs.rmSync(repo, { recursive: true, force: true }) };
}

function testLeggeICommitDellHook() {
  const b = repoDiProva('legge');
  fs.writeFileSync(path.join(b.repo, 'app.js'), 'versione uno', 'utf8');
  const primo = b.salva('sess-1111', 'uuid-uno', '2026-07-30T10:00:00Z');
  fs.writeFileSync(path.join(b.repo, 'app.js'), 'versione due', 'utf8');
  const secondo = b.salva('sess-1111', 'uuid-due', '2026-07-30T12:00:00Z');

  const commit = commitDiCb(b.repo);
  assert.equal(commit.length, 2, 'legge tutti i commit del ref');
  assert.equal(commit[0].hash, secondo, 'dal piu recente');
  assert.equal(commit[0].messaggio, 'uuid-due', 'con l uuid del messaggio');
  assert.equal(commit[1].hash, primo);
  assert.equal(commit[1].istante, Date.parse('2026-07-30T10:00:00Z'), 'e l istante del commit');

  // Il ref e' nascosto: il repo si comporta come se non ci fosse.
  const log = execFileSync('git', ['-C', b.repo, 'log', '--oneline'], { encoding: 'utf8' }).trim();
  assert.equal(log.split('\n').length, 1, 'in git log resta solo il commit vero');
  assert.match(log, /base$/, 'e i commit di cb non ci sono');

  b.pulisci();
}

function testUuidTrovaIlCommitEsatto() {
  const b = repoDiProva('uuid');
  fs.writeFileSync(path.join(b.repo, 'app.js'), 'versione uno', 'utf8');
  const primo = b.salva('sess-2222', 'uuid-uno', '2026-07-30T10:00:00Z');
  fs.writeFileSync(path.join(b.repo, 'app.js'), 'versione due', 'utf8');
  b.salva('sess-2222', 'uuid-due', '2026-07-30T12:00:00Z');

  const commit = commitDiCb(b.repo);
  const scelto = commitDelPunto(commit, 'uuid-uno', Date.parse('2026-07-30T23:00:00Z'));

  assert.equal(scelto, primo, "l'uuid vince sull'istante");
  assert.equal(
    contenutoDaCommit(b.repo, scelto, path.join(b.repo, 'app.js')).toString(),
    'versione uno',
    'e il contenuto e quello di quel turno',
  );

  b.pulisci();
}

function testSenzaUuidSiRipiegaSullIstante() {
  // Un turno che non ha toccato file non ha un commit: l'hook non ne scrive.
  // Il codice di quel momento e' quello dell'ultimo commit precedente.
  const b = repoDiProva('istante');
  fs.writeFileSync(path.join(b.repo, 'app.js'), 'versione uno', 'utf8');
  const primo = b.salva('sess-3333', 'uuid-uno', '2026-07-30T10:00:00Z');
  fs.writeFileSync(path.join(b.repo, 'app.js'), 'versione due', 'utf8');
  b.salva('sess-3333', 'uuid-due', '2026-07-30T12:00:00Z');

  const commit = commitDiCb(b.repo);
  const scelto = commitDelPunto(commit, 'uuid-mai-visto', Date.parse('2026-07-30T11:00:00Z'));

  assert.equal(scelto, primo, 'si prende l ultimo commit prima di quell istante');
  assert.equal(
    commitDelPunto(commit, 'uuid-mai-visto', Date.parse('2026-07-30T09:00:00Z')),
    null,
    'e prima del primo commit non c e niente da dare',
  );

  b.pulisci();
}

function testRipiegoPerIlRipristino() {
  const b = repoDiProva('ripiego');
  const file = path.join(b.repo, 'src', 'app.js');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'versione del turno', 'utf8');
  b.salva('sess-4444', 'uuid-uno', '2026-07-30T10:00:00Z');
  fs.writeFileSync(file, 'versione di adesso', 'utf8');

  const ripiego = ripiegoDaiCommit(b.repo, 'uuid-uno', Date.parse('2026-07-30T10:00:00Z'));
  assert.equal(typeof ripiego, 'function', 'in un repo con i commit il ripiego c e');
  assert.equal(ripiego(file).toString(), 'versione del turno', 'e restituisce il file di quel turno');
  assert.equal(ripiego(path.join(b.repo, 'mai-esistito.js')), null, 'un file che non c era da null');
  // Il percorso di fuori si costruisce, non si scrive a mano: `C:\altrove\...`
  // su Linux non e' un percorso assoluto ma un nome di file con dentro delle
  // barre rovesce, quindi li' la prova passava per il motivo sbagliato.
  assert.equal(ripiego(path.join(os.tmpdir(), 'altrove', 'fuori.js')), null, 'e fuori dal repo non si azzarda');

  b.pulisci();
}

// La radice del repo la dice git, che risponde sempre col percorso reale; il
// percorso del file arriva invece da chi chiama, cosi' com'e'. Se uno dei due
// passa per un collegamento i due non combaciano, `path.relative` esce con `..`,
// e il ripiego si spegne da solo senza dire niente. E' come falliva su macOS, dove
// la cartella temporanea sta sotto `/var`, che e' un link a `/private/var`.
//
// Il collegamento e' una junction: su Windows un symlink di cartella vuole i
// privilegi di amministratore, una junction no, e altrove il tipo viene ignorato.
function testUnCollegamentoNonSpegneIlRipiego() {
  const b = repoDiProva('link');
  const file = path.join(b.repo, 'app.js');
  fs.writeFileSync(file, 'versione del turno', 'utf8');
  b.salva('sess-5555', 'uuid-uno', '2026-07-30T10:00:00Z');
  fs.writeFileSync(file, 'versione di adesso', 'utf8');

  const nido = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-commit-link-'));
  const collegamento = path.join(nido, 'verso-il-repo');
  fs.symlinkSync(b.repo, collegamento, 'junction');

  const ripiego = ripiegoDaiCommit(collegamento, 'uuid-uno', Date.parse('2026-07-30T10:00:00Z'));
  assert.equal(typeof ripiego, 'function', 'il repo si trova anche attraverso il collegamento');
  assert.equal(
    ripiego(path.join(collegamento, 'app.js')).toString(),
    'versione del turno',
    'e il file si legge col percorso che passa per il collegamento',
  );

  // Si toglie il collegamento, non cio' a cui punta: unlink basta ovunque tranne
  // su Windows, dove una junction si leva con rmdir.
  try {
    fs.unlinkSync(collegamento);
  } catch {
    fs.rmdirSync(collegamento);
  }
  fs.rmSync(nido, { recursive: true, force: true });
  b.pulisci();
}

function testFuoriDaGitONonInstallato() {
  const fuori = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-commit-fuori-'));
  assert.equal(radiceGit(fuori), null, 'fuori da un repo non c e radice');
  assert.equal(ripiegoDaiCommit(fuori, 'uuid', Date.now()), null, 'e nessun ripiego');
  fs.rmSync(fuori, { recursive: true, force: true });

  // Repo vero ma hook non installato: nessun ref, quindi nessun ripiego.
  const b = repoDiProva('vuoto');
  assert.deepEqual(commitDiCb(b.repo), [], 'senza hook non ci sono commit di cb');
  assert.equal(ripiegoDaiCommit(b.repo, 'uuid', Date.now()), null, 'e il ripristino resta comè');
  b.pulisci();
}

const prove = [
  testLeggeICommitDellHook,
  testUuidTrovaIlCommitEsatto,
  testSenzaUuidSiRipiegaSullIstante,
  testRipiegoPerIlRipristino,
  testUnCollegamentoNonSpegneIlRipiego,
  testFuoriDaGitONonInstallato,
];

for (const prova of prove) {
  prova();
  console.log(`ok  ${prova.name}`);
}
console.log(`\n${prove.length} prove superate`);
