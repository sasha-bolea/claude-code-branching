import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { CARTELLA_PROGETTI } from './percorsi.js';
import { ARCHIVIO_CB, INDICE_CB } from './codice.js';
import { radiceGit } from './commit.js';
import { impostazione } from './impostazioni.js';

// Pulizia dei tre accumuli che cb lascia dietro di se':
//
//   1. le sessioni troncate scritte a ogni cambio ramo (src/ramo.js)
//   2. le copie di file fatte prima di ogni ripristino (src/codice.js)
//   3. i commit automatici su `refs/cb/*` scritti dall'hook (hooks/cb-commit.ps1)
//
// Nessuno dei tre scade da solo. Il criterio e' uno solo, l'eta': si tocca solo
// cio' che e' piu' vecchio di N giorni. Serve anche come rete di sicurezza —
// quello che una sessione viva sta usando in questo momento e' recente, quindi
// non e' candidato.

const GIORNO = 24 * 60 * 60 * 1000;

// Giorni oltre i quali una cosa e' considerata vecchia, quando la pulizia la
// chiede l'utente. Una settimana perche' e' il tempo entro cui capita di voler
// tornare indietro su un ramo di ieri.
export const GIORNI_PREDEFINITI = 7;

// Soglia della pulizia automatica, molto piu' larga: due mesi. Quella la decide
// cb, non l'utente, quindi deve toccare solo cio' che nessuno rimpiangera'.
// Anche l'archivio nativo di Claude si ripulisce da solo, con un ordine di
// grandezza simile.
export const GIORNI_AUTOMATICI = 60;

// Quanto spesso la pulizia automatica torna a guardare. Ogni avvio sarebbe uno
// spreco: legge tutti i transcript di tutti i progetti, e in un giorno non
// scade quasi niente.
const FRA_UNA_PULIZIA_E_L_ALTRA = GIORNO;

// File che ricorda quando e' stata fatta l'ultima pulizia automatica.
const SEGNALE = path.join(os.homedir(), '.claude', 'cb', 'ultima-pulizia');

// Uuid dei record di un transcript, letti senza costruire l'albero.
// percorso: path del .jsonl
// ritorna: Promise<Set<string>>
async function uuidDi(percorso) {
  const uuid = new Set();
  // Lo stream si tiene da parte per chiuderlo: `rl.close()` chiude l'interfaccia,
  // non il file sotto. Letto il file fino in fondo lo chiude l'iteratore, ma se il
  // ciclo salta per un errore il descrittore resterebbe aperto — e su Windows un
  // file con un handle aperto non si puo' piu' riscrivere.
  const flusso = fs.createReadStream(percorso, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: flusso, crlfDelay: Infinity });

  try {
    for await (const riga of rl) {
      if (!riga.trim()) continue;
      try {
        const record = JSON.parse(riga);
        if (record.uuid) uuid.add(record.uuid);
      } catch {
        continue; // riga troncata: la salto
      }
    }
  } finally {
    rl.close();
    flusso.destroy();
  }
  return uuid;
}

// Vero se tutti gli uuid di `piccolo` stanno in `grande`, e ce n'e' almeno uno in meno.
// Il "almeno uno in meno" serve a non dichiarare ridondanti due file identici, che
// sarebbero l'uno il sottoinsieme dell'altro: si finirebbe per cancellarli entrambi.
function contenutoIn(piccolo, grande) {
  if (piccolo.size === 0 || piccolo.size >= grande.size) return false;
  for (const u of piccolo) if (!grande.has(u)) return false;
  return true;
}

// I transcript che non aggiungono niente: ogni loro record esiste gia', con lo
// stesso uuid, dentro un altro transcript della stessa cartella.
//
// E' la firma di una sessione troncata mai proseguita. cb ne scrive una a ogni
// cambio ramo (`creaSessioneTroncata`), copiando la catena fino al punto scelto;
// se poi l'utente ha scritto anche solo un messaggio, quei record nuovi hanno
// uuid che nell'originale non ci sono e il file non e' piu' un sottoinsieme.
// Vale anche per i fork fatti da Claude, con lo stesso ragionamento.
//
// Non si marcano i file alla creazione apposta: cosi' il criterio funziona anche
// sulle sessioni troncate gia' accumulate, che nessun marchio avrebbe.
//
// cartellaProgetti: radice di ~/.claude/projects (sostituibile nelle prove)
// prima: si guardano solo i file modificati prima di questo istante (ms)
// ritorna: Promise<[{ percorso, byte }]>
export async function sessioniRidondanti({ cartellaProgetti = CARTELLA_PROGETTI, prima } = {}) {
  let cartelle;
  try {
    cartelle = fs.readdirSync(cartellaProgetti);
  } catch {
    return [];
  }

  const ridondanti = [];
  for (const nome of cartelle) {
    const cartella = path.join(cartellaProgetti, nome);
    let file;
    try {
      file = fs.readdirSync(cartella).filter((n) => n.endsWith('.jsonl'));
    } catch {
      continue;
    }

    const schede = [];
    for (const n of file) {
      const percorso = path.join(cartella, n);
      try {
        const stat = fs.statSync(percorso);
        schede.push({ percorso, byte: stat.size, mtime: stat.mtimeMs, uuid: await uuidDi(percorso) });
      } catch {
        continue;
      }
    }

    // ponytail: confronto a coppie, O(n²) sui file di una cartella. Sono decine,
    // e prune si lancia a mano: se un giorno fossero migliaia, si indicizza per
    // uuid di radice come fa src/indice.js.
    for (const scheda of schede) {
      if (prima && scheda.mtime >= prima) continue;
      const dentro = schede.some((altra) => altra !== scheda && contenutoIn(scheda.uuid, altra.uuid));
      if (dentro) ridondanti.push({ percorso: scheda.percorso, byte: scheda.byte });
    }
  }

  return ridondanti;
}

// Le copie di cb piu' vecchie del limite, con l'indice ripulito delle loro righe.
//
// Si guarda l'indice e non le date dei file: la data che conta e' l'istante a cui
// la copia si riferisce, che e' quello scritto nel record. I file dell'archivio
// che nessuna riga superstite nomina vengono presi comunque, purche' vecchi:
// sono gli avanzi di un ripristino interrotto a meta'.
//
// archivioCb: cartella dell'archivio di cb (sostituibile nelle prove)
// prima: istante (ms) prima del quale una copia e' vecchia
// ritorna: { blob: [percorsi], indice, righeTenute, byte }
export function copieScadute({ archivioCb = ARCHIVIO_CB, prima } = {}) {
  const indice = path.join(archivioCb, INDICE_CB);
  let file;
  try {
    file = fs.readdirSync(archivioCb).filter((n) => n !== INDICE_CB);
  } catch {
    return { blob: [], indice, righeTenute: null, byte: 0 };
  }

  // Righe da tenere, e i nomi delle copie che restano nominate da qualcuno.
  const tenute = [];
  const nominati = new Set();
  let indiceCambiato = false;
  if (fs.existsSync(indice)) {
    for (const riga of fs.readFileSync(indice, 'utf8').split('\n')) {
      if (!riga.trim()) continue;
      let record;
      try {
        record = JSON.parse(riga);
      } catch {
        continue; // riga troncata: sparisce con la riscrittura
      }
      if (record.tempo && record.tempo < prima) {
        indiceCambiato = true;
        continue;
      }
      tenute.push(riga);
      if (record.nomeBlob) nominati.add(record.nomeBlob);
    }
  }

  const blob = [];
  let byte = 0;
  for (const nome of file) {
    if (nominati.has(nome)) continue;
    const percorso = path.join(archivioCb, nome);
    try {
      const stat = fs.statSync(percorso);
      if (stat.mtimeMs >= prima) continue;
      blob.push(percorso);
      byte += stat.size;
    } catch {
      continue;
    }
  }

  return { blob, indice, righeTenute: indiceCambiato ? tenute : null, byte };
}

// Esegue git raccogliendone l'uscita, null se fallisce (non e' un repo, o il
// comando non c'e'). Stessa forma di src/commit.js: qui pero' si scrive, quindi
// non conviene condividerne la funzione.
function git(argomenti) {
  try {
    return execFileSync('git', argomenti, {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

// I ref dei commit automatici il cui ultimo commit e' piu' vecchio del limite.
// radice: radice del repo git
// prima: istante (ms) prima del quale un ref e' vecchio
// ritorna: [{ ref, hash }]
export function refScaduti(radice, { prima } = {}) {
  const uscita = git([
    '-C',
    radice,
    'for-each-ref',
    '--format=%(refname) %(objectname) %(committerdate:unix)',
    'refs/cb/',
  ]);
  if (!uscita) return [];

  const scaduti = [];
  for (const riga of uscita.split('\n')) {
    const [ref, hash, secondi] = riga.trim().split(' ');
    if (!ref || !hash || !secondi) continue;
    if (Number(secondi) * 1000 >= prima) continue;
    scaduti.push({ ref, hash });
  }
  return scaduti;
}

// Cosa si potrebbe togliere, senza togliere niente.
// giorni: eta' oltre la quale una cosa e' vecchia
// radiceRepo: repo in cui cercare i ref (null = fuori da un repo)
// adesso: istante di riferimento (sostituibile nelle prove)
// ritorna: Promise<{ prima, sessioni, copie, ref }>
export async function pianoPulizia({
  giorni = GIORNI_PREDEFINITI,
  radiceRepo = null,
  adesso = Date.now(),
  cartellaProgetti = CARTELLA_PROGETTI,
  archivioCb = ARCHIVIO_CB,
} = {}) {
  const prima = adesso - giorni * GIORNO;
  return {
    prima,
    sessioni: await sessioniRidondanti({ cartellaProgetti, prima }),
    copie: copieScadute({ archivioCb, prima }),
    ref: radiceRepo ? refScaduti(radiceRepo, { prima }) : [],
  };
}

// Esegue il piano. L'indice si riscrive per ultimo: se qualcosa va storto prima,
// resta un indice che nomina copie sparite — e una copia sparita e' gia' un caso
// previsto (`ripristinaA` ripiega sui commit), mentre una copia orfana nominata
// da nessuno non tornerebbe piu' indietro.
// piano: risultato di pianoPulizia
// radiceRepo: repo dei ref da cancellare
// ritorna: { sessioni, copie, ref } — quanti elementi tolti davvero
export function applicaPiano(piano, { radiceRepo = null } = {}) {
  const fatto = { sessioni: 0, copie: 0, ref: 0 };

  for (const { percorso } of piano.sessioni) {
    try {
      fs.rmSync(percorso, { force: true });
      fatto.sessioni += 1;
    } catch {
      continue;
    }
  }

  for (const percorso of piano.copie.blob) {
    try {
      fs.rmSync(percorso, { force: true });
      fatto.copie += 1;
    } catch {
      continue;
    }
  }

  if (piano.copie.righeTenute) {
    const testo = piano.copie.righeTenute.length ? `${piano.copie.righeTenute.join('\n')}\n` : '';
    fs.writeFileSync(piano.copie.indice, testo, 'utf8');
  }

  for (const { ref, hash } of piano.ref) {
    // L'hash e' l'atteso: se nel frattempo una sessione viva ha scritto un commit
    // nuovo su quel ref, git rifiuta e il ref resta.
    if (radiceRepo && git(['-C', radiceRepo, 'update-ref', '-d', ref, hash]) !== null) {
      fatto.ref += 1;
    }
  }

  return fatto;
}

// La pulizia che cb fa da solo, in silenzio, al massimo una volta al giorno.
//
// Perche' automatica: i tre accumuli non scadono, e chi installa da npm non ha
// motivo di sapere che esistono. Perche' con una soglia larga (due mesi contro i
// sette giorni del comando a mano): quello che cb toglie senza chiedere deve
// essere roba che nessuno stava per riprendere.
//
// Il segnale si scrive PRIMA di lavorare, non dopo: se la pulizia lancia — un
// disco pieno, un permesso negato — si riprova domani invece che a ogni singolo
// avvio, e nel frattempo non c'e' niente che rallenta l'avvio di Claude.
//
// Si spegne mettendo `giorniPulizia: 0` nelle impostazioni (o CB_GIORNI_PULIZIA=0),
// che e' anche il modo di cambiare la soglia.
//
// cartella: cwd da cui cercare il repo dei ref
// adesso: istante di riferimento (sostituibile nelle prove)
// segnale: file che ricorda l'ultima volta (sostituibile nelle prove)
// ritorna: Promise<{ sessioni, copie, ref } | null> — null se non era il momento
export async function puliziaAutomatica({
  cartella = process.cwd(),
  adesso = Date.now(),
  segnale = SEGNALE,
  cartellaProgetti = CARTELLA_PROGETTI,
  archivioCb = ARCHIVIO_CB,
} = {}) {
  const giorni = Number(impostazione('giorniPulizia', GIORNI_AUTOMATICI));
  if (!Number.isFinite(giorni) || giorni <= 0) return null;

  try {
    const ultima = Number(fs.readFileSync(segnale, 'utf8'));
    if (Number.isFinite(ultima) && adesso - ultima < FRA_UNA_PULIZIA_E_L_ALTRA) return null;
  } catch {
    // Nessun segnale: e' la prima volta, si procede.
  }

  try {
    fs.mkdirSync(path.dirname(segnale), { recursive: true });
    fs.writeFileSync(segnale, String(adesso), 'utf8');

    const radiceRepo = radiceGit(cartella);
    const piano = await pianoPulizia({ giorni, radiceRepo, adesso, cartellaProgetti, archivioCb });
    return applicaPiano(piano, { radiceRepo });
  } catch {
    // Una pulizia che fallisce non e' un motivo per non far partire Claude.
    return null;
  }
}

// Dimensione leggibile.
// byte: numero di byte
// ritorna: stringa tipo "4.2 MB"
export function dimensione(byte) {
  if (byte < 1024) return `${byte} B`;
  if (byte < 1024 * 1024) return `${(byte / 1024).toFixed(1)} kB`;
  return `${(byte / 1024 / 1024).toFixed(1)} MB`;
}
