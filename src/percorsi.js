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

// Istante del primo messaggio di un transcript, cioe' quando quella
// conversazione e' cominciata.
//
// Si legge dal contenuto e non dal filesystem: su Windows la data di creazione
// **mente**. Cancellando e ricreando un file con lo stesso nome entro pochi
// secondi, il sistema gli rimette la data vecchia (file tunneling) — verificato,
// e basta a far sembrare vecchio un file appena nato. Il timestamp del primo
// record lo scrive Claude, e non dipende da come il disco tratta i nomi.
//
// Vale anche meglio nel merito: una sessione troncata da cb copia i record di
// quella di partenza, quindi e' un file nuovo con una conversazione **vecchia**.
// La data di nascita direbbe "appena creato", il primo record dice il vero.
//
// percorso: file .jsonl
// ritorna: millisecondi, o null se il file non ha record con un orario
function inizioConversazione(percorso) {
  let testa;
  try {
    // I primi record stanno all'inizio: non serve leggere tutto il file, che per
    // una conversazione lunga sono megabyte.
    const descrittore = fs.openSync(percorso, 'r');
    try {
      const buffer = Buffer.alloc(8192);
      const letti = fs.readSync(descrittore, buffer, 0, buffer.length, 0);
      testa = buffer.toString('utf8', 0, letti);
    } finally {
      fs.closeSync(descrittore);
    }
  } catch {
    return null;
  }

  for (const riga of testa.split('\n')) {
    if (!riga.trim()) continue;
    let record;
    try {
      record = JSON.parse(riga);
    } catch {
      continue; // ultima riga tagliata dalla lettura parziale, o scrittura in corso
    }
    const istante = Date.parse(record?.timestamp ?? '');
    if (!Number.isNaN(istante)) return istante;
  }
  return null;
}

// Transcript modificato piu' di recente in una cartella di lavoro.
// Serve quando l'id della sessione lo decide Claude (avvio con --resume o
// --continue) e non lo conosciamo in anticipo.
//
// `cominciataDopo` distingue due situazioni che sul disco si somigliano: dopo un
// /clear la conversazione nuova **comincia** mentre cb e' gia' in esecuzione,
// mentre quella di un'altra finestra aperta sulla stessa cartella era gia'
// cominciata da prima. Guardando solo l'ultima scrittura sono identiche —
// l'altro file e' piu' recente in entrambi i casi — e cb saltava sulla
// conversazione di un'altra finestra (misurato: due volte in una mattina, vedi
// diagnosi.log).
//
// cartella: cwd in cui gira Claude
// dopo: timestamp (ms) prima del quale ignorare i file, per ultima scrittura
// cominciataDopo: se dato, si tengono solo i transcript il cui **primo
//   messaggio** e' successivo a questo istante
// ritorna: { percorso, sessionId } oppure null
export function transcriptPiuRecente(cartella, dopo = 0, cominciataDopo = null) {
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
    if (cominciataDopo !== null) {
      // Un transcript senza orari non si puo' giudicare: si lascia passare
      // invece di scartarlo, cioe' ci si comporta come prima di questo filtro.
      const inizio = inizioConversazione(percorso);
      if (inizio !== null && inizio < cominciataDopo) continue;
    }
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
