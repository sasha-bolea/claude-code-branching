import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

export const CARTELLA_PROGETTI = path.join(os.homedir(), '.claude', 'projects');

// Converte una cartella di lavoro nello slug usato da Claude per i suoi
// transcript: ogni carattere non alfanumerico diventa un trattino.
// Es. C:\Users\tizio\progetti\web  ->  C--Users-tizio-progetti-web
// cartella: percorso assoluto
// ritorna: nome della cartella dei transcript
export function slugProgetto(cartella) {
  return cartella.replace(/[^a-zA-Z0-9]/g, '-');
}

// Id di sessione ricavato dal percorso del transcript.
// E' questo l'id che accetta `--resume`: i record dentro il file possono
// riferirsi alla sessione da cui un fork ha copiato la storia.
// percorso: path del .jsonl
// ritorna: id della sessione
export function sessioneDaPercorso(percorso) {
  return path.basename(percorso, '.jsonl');
}

// Uuid del primo nodo radice di un transcript, letto senza caricare il file.
// Le sessioni nate da un fork copiano i record dell'antenato mantenendo gli
// stessi uuid: la radice in comune identifica quindi la famiglia.
// percorso: path del .jsonl
// ritorna: uuid della radice, o null
async function radiceDi(percorso) {
  const rl = readline.createInterface({
    input: fs.createReadStream(percorso, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  try {
    let esaminate = 0;
    for await (const riga of rl) {
      if (esaminate > 400) break; // la radice sta in testa: oltre e' inutile leggere
      esaminate += 1;
      if (!riga.trim()) continue;
      try {
        const record = JSON.parse(riga);
        if (record.uuid && !record.parentUuid) return record.uuid;
      } catch {
        continue;
      }
    }
  } finally {
    rl.close();
  }
  return null;
}

// Transcript di tutte le sessioni che discendono dalla stessa radice, cioe' la
// sessione data piu' i suoi fork e i fork dei suoi antenati.
//
// Serve perche' `--fork-session` crea un file nuovo che copia la storia solo
// fino al punto di fork: i rami abbandonati restano nel file di partenza e
// sarebbero invisibili guardando solo la sessione corrente.
//
// percorso: transcript della sessione corrente
// ritorna: array di path, la sessione corrente per prima
export async function sessioniDellaFamiglia(percorso) {
  const radice = await radiceDi(percorso);
  if (!radice) return [percorso];

  const cartella = path.dirname(percorso);
  let file;
  try {
    file = fs.readdirSync(cartella).filter((n) => n.endsWith('.jsonl'));
  } catch {
    return [percorso];
  }

  const famiglia = [percorso];
  for (const nome of file) {
    const candidato = path.join(cartella, nome);
    if (path.resolve(candidato) === path.resolve(percorso)) continue;
    try {
      if (fs.statSync(candidato).size === 0) continue;
      if ((await radiceDi(candidato)) === radice) famiglia.push(candidato);
    } catch {
      continue;
    }
  }
  return famiglia;
}

// Transcript modificato piu' di recente in una cartella di lavoro.
// Serve quando l'id della sessione lo decide Claude (avvio con --resume o
// --continue) e non lo conosciamo in anticipo.
// cartella: cwd in cui gira Claude
// dopo: timestamp (ms) prima del quale ignorare i file
// ritorna: { percorso, sessionId } oppure null
export function transcriptPiuRecente(cartella, dopo = 0) {
  const cartellaProgetto = path.join(CARTELLA_PROGETTI, slugProgetto(cartella));

  let file;
  try {
    file = fs.readdirSync(cartellaProgetto).filter((n) => n.endsWith('.jsonl'));
  } catch {
    return null;
  }

  let migliore = null;
  for (const nome of file) {
    const percorso = path.join(cartellaProgetto, nome);
    let stat;
    try {
      stat = fs.statSync(percorso);
    } catch {
      continue;
    }
    if (stat.size === 0 || stat.mtimeMs < dopo) continue;
    if (!migliore || stat.mtimeMs > migliore.mtimeMs) {
      migliore = { percorso, sessionId: path.basename(nome, '.jsonl'), mtimeMs: stat.mtimeMs };
    }
  }

  return migliore ? { percorso: migliore.percorso, sessionId: migliore.sessionId } : null;
}

// Percorso del transcript di una sessione.
// Prima prova lo slug del cwd; se il file non c'e' ancora (Claude lo crea al
// primo messaggio) o il cwd e' stato normalizzato in modo diverso, cerca il file
// in tutte le cartelle progetto.
// sessionId: id della sessione
// cartella: cwd in cui gira Claude
// ritorna: percorso del .jsonl, o null se non esiste ancora
export function percorsoTranscript(sessionId, cartella) {
  const atteso = path.join(CARTELLA_PROGETTI, slugProgetto(cartella), `${sessionId}.jsonl`);
  if (fs.existsSync(atteso)) return atteso;

  let cartelle;
  try {
    cartelle = fs.readdirSync(CARTELLA_PROGETTI);
  } catch {
    return null;
  }

  for (const nome of cartelle) {
    const candidato = path.join(CARTELLA_PROGETTI, nome, `${sessionId}.jsonl`);
    if (fs.existsSync(candidato)) return candidato;
  }
  return null;
}
