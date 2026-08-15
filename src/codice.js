import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { T } from './lingua.js';

// Ripristino del codice leggendo l'archivio di copie di Claude Code.
//
// Claude non usa git: prima di modificare un file ne salva il contenuto INTERO in
// `~/.claude/file-history/<sessione>/<hash del percorso>@v<N>`, e annota la copia
// nel transcript con due tipi di record:
//
//   file-history-snapshot  uno per ogni prompt utente: `snapshot.trackedFileBackups`
//                          e' la mappa percorso -> copia valida in quel punto
//   file-history-delta     copia fatta a meta' turno, con `trackingPath` e `backup`
//
// Poiche' ogni copia e' il contenuto PRECEDENTE alla modifica che l'ha generata,
// lo stato di un file all'istante T e' la prima copia con `backupTime >= T`.
// Nessuna copia dopo T significa che il file non e' piu' stato toccato, quindi e'
// gia' in quello stato; una copia `null` significa che a T il file non esisteva.
//
// cb legge questo archivio invece di chiamare `claude --rewind-files`: niente
// processo da lanciare, e soprattutto si puo' leggere l'archivio di TUTTE le
// sessioni della famiglia, mentre il ripristino nativo ne guarda una sola.
const ARCHIVIO = path.join(os.homedir(), '.claude', 'file-history');

// Archivio di cb, con le stesse regole di quello di Claude.
//
// Serve perche' nell'archivio di Claude non esiste MAI lo stato finale di un
// file: ogni copia e' il contenuto precedente a una modifica, quindi di un file
// creato e mai piu' toccato resta solo la voce `null` ("non esisteva"). Finche'
// il working tree e' la punta della storia va bene — quel contenuto e' sul disco
// — ma un ripristino sposta il disco indietro, e senza una copia nostra il
// contenuto piu' recente sarebbe perso: tornando avanti il file non ricomparirebbe.
//
// Quindi cb copia quello che sta per sovrascrivere, esattamente come fa Claude,
// e le sue copie entrano nella stessa regola del "primo backup successivo".
//
// Le copie si accumulano a ogni ripristino: le toglie `cb prune` (src/pulizia.js),
// che le legge da qui — percorso e nome dell'indice sono esportati apposta.
export const ARCHIVIO_CB = path.join(os.homedir(), '.claude', 'cb', 'file-history');
export const INDICE_CB = 'indice.jsonl';

// Percorso assoluto del file a cui si riferisce una copia.
// `trackingPath` e' relativo e con i separatori di Windows; `realParentDir` e' la
// cartella vera, e permette di ritrovare anche i file fuori dal progetto (nei
// transcript compare per esempio il profilo PowerShell).
// tracciato: valore di trackingPath
// cartellaReale: valore di realParentDir (puo' mancare nei record piu' vecchi)
// ritorna: percorso assoluto
function percorsoDelFile(tracciato, cartellaReale) {
  const normalizzato = String(tracciato).replace(/\\/g, '/');
  if (cartellaReale) return path.join(cartellaReale, path.basename(normalizzato));
  return path.resolve(normalizzato);
}

// Trasforma un record di backup nella voce usata qui.
// tracciato: trackingPath del record
// backup: oggetto backup ({ backupFileName, backupTime, realParentDir })
// cartellaBlob: dove stanno le copie di quella sessione
// ritorna: voce, o null se il record e' incompleto
function voceDaBackup(tracciato, backup, cartellaBlob) {
  if (!tracciato || !backup?.backupTime) return null;
  const tempo = Date.parse(backup.backupTime);
  if (Number.isNaN(tempo)) return null;

  return {
    percorso: percorsoDelFile(tracciato, backup.realParentDir),
    nomeBlob: backup.backupFileName ?? null,
    blob: backup.backupFileName ? path.join(cartellaBlob, backup.backupFileName) : null,
    tempo,
  };
}

// Legge da un transcript tutte le copie di file che vi sono annotate.
//
// La cartella delle copie prende il nome dal FILE di sessione, non da
// `record.sessionId`: nelle sessioni troncate da cb quel campo e' riscritto
// (src/ramo.js), ed e' la stessa ragione per cui `--resume` vuole il nome del file.
// Ne segue che una sessione troncata punta a copie che vivono sotto la sessione di
// provenienza: non e' un problema perche' il ripristino legge tutta la famiglia, e
// la sessione di provenienza e' fra quelle lette.
//
// percorso: path del .jsonl
// archivio: cartella radice delle copie (sostituibile nelle prove)
// ritorna: Promise<voce[]>
export async function leggiStoricoFile(percorso, { archivio = ARCHIVIO } = {}) {
  const sessione = path.basename(percorso, '.jsonl');
  const cartellaBlob = path.join(archivio, sessione);
  const voci = [];

  // Lo stream si tiene da parte per chiuderlo: `rl.close()` chiude l'interfaccia,
  // non il file sotto. Letto tutto lo chiude l'iteratore, ma se il ciclo salta per
  // un errore il descrittore resterebbe aperto fino al garbage collector — e su
  // Windows un file con un handle aperto non si puo' piu' riscrivere.
  const flusso = fs.createReadStream(percorso, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: flusso, crlfDelay: Infinity });

  try {
    for await (const riga of rl) {
      if (!riga.trim()) continue;
      let record;
      try {
        record = JSON.parse(riga);
      } catch {
        continue; // riga troncata (scrittura in corso): la salto
      }

      if (record.type === 'file-history-snapshot') {
        const tracciati = record.snapshot?.trackedFileBackups ?? {};
        for (const [tracciato, backup] of Object.entries(tracciati)) {
          const voce = voceDaBackup(tracciato, backup, cartellaBlob);
          if (voce) voci.push(voce);
        }
        continue;
      }

      if (record.type === 'file-history-delta') {
        const voce = voceDaBackup(record.trackingPath, record.backup, cartellaBlob);
        if (voce) voci.push(voce);
      }
    }
  } finally {
    rl.close();
    flusso.destroy();
  }

  return voci;
}

// Legge le copie fatte da cb prima dei propri ripristini.
// archivioCb: cartella dell'archivio di cb (sostituibile nelle prove)
// ritorna: voce[]
export function leggiStoricoCb({ archivioCb = ARCHIVIO_CB } = {}) {
  const indice = path.join(archivioCb, INDICE_CB);
  if (!fs.existsSync(indice)) return [];

  const voci = [];
  for (const riga of fs.readFileSync(indice, 'utf8').split('\n')) {
    if (!riga.trim()) continue;
    let record;
    try {
      record = JSON.parse(riga);
    } catch {
      continue; // riga troncata: la salto
    }
    if (!record.percorso || !record.tempo) continue;

    voci.push({
      percorso: record.percorso,
      nomeBlob: record.nomeBlob ?? null,
      blob: record.nomeBlob ? path.join(archivioCb, record.nomeBlob) : null,
      tempo: record.tempo,
    });
  }

  return voci;
}

// Copia un file prima che il ripristino lo sovrascriva, e annota la copia.
//
// L'annotazione dice "a questo istante il contenuto era questo", con la stessa
// semantica delle copie di Claude: e' quindi lo stato di tutti i punti della
// conversazione che stanno fra l'ultima copia e adesso.
//
// percorso: file che sta per essere toccato
// adesso: millisecondi da attribuire alla copia
// archivioCb: cartella dell'archivio di cb
// ritorna: niente
function annotaCopia(percorso, adesso, archivioCb) {
  fs.mkdirSync(archivioCb, { recursive: true });

  let nomeBlob = null;
  if (fs.existsSync(percorso)) {
    // Il nome tiene insieme percorso e istante: due ripristini dello stesso file
    // non si sovrascrivono a vicenda.
    const impronta = createHash('sha1').update(percorso).digest('hex').slice(0, 16);
    nomeBlob = `${impronta}@${adesso}`;
    fs.copyFileSync(percorso, path.join(archivioCb, nomeBlob));
  }

  fs.appendFileSync(
    path.join(archivioCb, INDICE_CB),
    `${JSON.stringify({ percorso, nomeBlob, tempo: adesso })}\n`,
    'utf8',
  );
}

// Fra voci identiche tiene quella la cui copia esiste davvero sul disco.
//
// Serve perche' le sessioni troncate che cb crea a ogni cambio ramo copiano i
// record di file-history dell'origine ma NON le copie, che restano nell'archivio
// della sessione di provenienza. La stessa voce compare quindi piu' volte,
// identica in tutto tranne la cartella, e quella della sessione troncata punta a
// una cartella che non esiste: sceglierla significa dichiarare la copia scaduta e
// non ripristinare niente.
//
// La chiave e' percorso + istante + nome della copia: due copie omonime di
// sessioni diverse hanno istanti diversi (le versioni ripartono da v1 in ogni
// sessione), quindi non vengono confuse.
//
// voci: risultato di leggiStoricoFile, anche di piu' sessioni
// ritorna: voce[] senza i doppioni
export function preferisciCopiePresenti(voci) {
  const presente = (voce) => !voce.blob || fs.existsSync(voce.blob);
  const perChiave = new Map();

  for (const voce of voci) {
    const chiave = `${voce.percorso}|${voce.tempo}|${voce.nomeBlob ?? ''}`;
    const attuale = perChiave.get(chiave);
    if (!attuale || (!presente(attuale) && presente(voce))) perChiave.set(chiave, voce);
  }

  return [...perChiave.values()];
}

// Lo stato dei file a un dato istante: per ogni percorso la prima copia successiva.
//
// Una copia scattata dopo T contiene il file com'era PRIMA della modifica che l'ha
// generata, cioe' com'era a T. Le copie precedenti a T descrivono il passato e non
// servono; se per un percorso non ce n'e' nessuna dopo T, il file non e' piu' stato
// toccato e va lasciato dov'e'.
//
// voci: risultato di leggiStoricoFile (anche di piu' sessioni, concatenato)
// istante: millisecondi (Date.parse del timestamp del messaggio)
// ritorna: voce[] — una per percorso
export function statoAllIstante(voci, istante) {
  const perPercorso = new Map();

  for (const voce of voci) {
    if (voce.tempo < istante) continue;
    const attuale = perPercorso.get(voce.percorso);
    if (!attuale || voce.tempo < attuale.tempo) perPercorso.set(voce.percorso, voce);
  }

  return [...perPercorso.values()];
}

// Riporta i file allo stato che avevano a un dato istante.
//
// I file che risultano gia' identici alla copia non vengono riscritti: cosi' il
// conteggio a schermo dice quanti file sono cambiati davvero, e non quanti erano
// sotto osservazione.
//
// Fuori dalla cartella di lavoro non si tocca niente: nell'archivio finisce ogni
// file che Claude ha modificato, compresi il profilo PowerShell e i file di
// memoria sotto ~/.claude. Riportarli indietro insieme al codice del progetto
// sarebbe un danno silenzioso, quindi si contano e si dicono, e basta.
//
// Prima di toccare un file cb ne salva il contenuto nel proprio archivio: e' cio'
// che permette di tornare AVANTI, verso uno stato che nell'archivio di Claude non
// c'e' perche' non e' mai stato il "prima" di una modifica.
//
// percorsiSessione: transcript di tutta la famiglia (path dei .jsonl)
// istante: millisecondi a cui riportare i file
// radice: cartella oltre la quale non si scrive (di norma il cwd della sessione)
// archivio: cartella radice delle copie di Claude (sostituibile nelle prove)
// archivioCb: cartella delle copie di cb (sostituibile nelle prove)
// adesso: istante da attribuire alle copie di cb
// ripiego: (percorso) => Buffer|null a cui chiedere il contenuto quando la copia
//   e' scaduta. Di norma e' lo storico dei commit automatici (src/commit.js), che
//   non scade: e' l'unica cosa che permette di ripristinare un ramo vecchio.
// ritorna: Promise<{ ripristinati, cancellati, invariati, mancanti, fuori }> — array di percorsi
export async function ripristinaA({
  percorsiSessione,
  istante,
  radice = null,
  archivio = ARCHIVIO,
  archivioCb = ARCHIVIO_CB,
  adesso = Date.now(),
  ripiego = null,
}) {
  const voci = [];
  for (const percorso of percorsiSessione) {
    if (!fs.existsSync(percorso)) continue;
    voci.push(...(await leggiStoricoFile(percorso, { archivio })));
  }

  // Le copie di cb valgono quanto quelle di Claude e stanno sulla stessa linea
  // del tempo: si limitano ai file che la conversazione conosce, perche'
  // l'archivio di cb e' unico per tutta la macchina.
  const conosciuti = new Set(voci.map((voce) => voce.percorso));
  voci.push(...leggiStoricoCb({ archivioCb }).filter((voce) => conosciuti.has(voce.percorso)));

  const esito = { ripristinati: [], cancellati: [], invariati: [], mancanti: [], fuori: [] };

  for (const voce of statoAllIstante(preferisciCopiePresenti(voci), istante)) {
    if (radice && path.relative(radice, voce.percorso).startsWith('..')) {
      esito.fuori.push(voce.percorso);
      continue;
    }

    // Copia assente: a quell'istante il file non esisteva ancora.
    if (!voce.blob) {
      if (fs.existsSync(voce.percorso)) {
        annotaCopia(voce.percorso, adesso, archivioCb);
        fs.rmSync(voce.percorso, { force: true });
        esito.cancellati.push(voce.percorso);
      }
      continue;
    }

    // La copia puo' essere scaduta: l'archivio di Claude viene ripulito dopo
    // qualche settimana. Li' interviene il ripiego — i commit automatici, che non
    // scadono — e solo se non ha niente nemmeno lui il file resta indietro.
    const contenuto = fs.existsSync(voce.blob)
      ? fs.readFileSync(voce.blob)
      : (ripiego?.(voce.percorso) ?? null);
    if (!contenuto) {
      esito.mancanti.push(voce.percorso);
      continue;
    }

    if (fs.existsSync(voce.percorso) && fs.readFileSync(voce.percorso).equals(contenuto)) {
      esito.invariati.push(voce.percorso);
      continue;
    }

    // Anche l'assenza va annotata: se il file non c'e' e lo stiamo ricreando,
    // tornare indietro dovra' poterlo cancellare di nuovo.
    annotaCopia(voce.percorso, adesso, archivioCb);
    fs.mkdirSync(path.dirname(voce.percorso), { recursive: true });
    fs.writeFileSync(voce.percorso, contenuto);
    esito.ripristinati.push(voce.percorso);
  }

  return esito;
}

// Riassunto dell'esito in una riga, da scrivere a schermo.
// esito: risultato di ripristinaA
// ritorna: stringa
export function riassumiRipristino(esito) {
  const pezzi = [];
  if (esito.ripristinati.length) pezzi.push(T.codice.ripristinati(esito.ripristinati.length));
  if (esito.cancellati.length) pezzi.push(T.codice.cancellati(esito.cancellati.length));
  if (esito.mancanti.length) pezzi.push(T.codice.mancanti(esito.mancanti.length));
  if (esito.fuori.length) pezzi.push(T.codice.fuori(esito.fuori.length));
  if (pezzi.length === 0) return T.codice.giaCosi;
  return pezzi.join(', ');
}
