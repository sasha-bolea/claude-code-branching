import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { leggiTranscript, catenaFinoA } from './transcript.js';

// Crea un nuovo file di sessione contenente solo la conversazione fino a un dato
// punto, e restituisce l'id della sessione creata.
//
// Perche' non basta un flag: in modalita' interattiva Claude ignora sia
// `--resume-session-at` sia `last-prompt.leafUuid`, e ricostruisce la catena
// dall'ultimo record messaggio presente nel file. Verificato catturando lo
// schermo di sessioni vere: con la conversazione intera il turno successivo
// ricompariva sempre. Scrivendo un file che finisce dove vogliamo, il taglio
// diventa un dato di fatto e non dipende da come il CLI interpreta i flag.
//
// Il file di partenza non viene toccato: e' una copia filtrata.
//
// percorsoOrigine: transcript da cui copiare
// uuidFine: ultimo record da includere (fine del turno scelto)
// ritorna: { sessionId, percorso }
export async function creaSessioneTroncata(percorsoOrigine, uuidFine) {
  const albero = await leggiTranscript(percorsoOrigine);
  if (!albero.nodi.has(uuidFine)) {
    throw new Error(`punto di taglio non trovato nel transcript: ${uuidFine}`);
  }

  const catena = new Set(catenaFinoA(albero, uuidFine).map((n) => n.uuid));
  const sessionId = randomUUID();
  const percorso = path.join(path.dirname(percorsoOrigine), `${sessionId}.jsonl`);

  const righe = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(percorsoOrigine, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const riga of rl) {
    if (!riga.trim()) continue;
    let record;
    try {
      record = JSON.parse(riga);
    } catch {
      continue; // riga troncata: la salto
    }

    // Messaggi fuori dalla catena scelta: esclusi. E' questo il taglio.
    if (record.uuid && !catena.has(record.uuid)) continue;
    // Snapshot dei file riferiti a messaggi esclusi: non servono piu'.
    if (record.messageId && !catena.has(record.messageId)) continue;
    // Il puntatore al ramo attivo lo riscrivo in coda.
    if (record.type === 'last-prompt') continue;

    if (record.sessionId) record.sessionId = sessionId;
    righe.push(JSON.stringify(record));
  }

  righe.push(JSON.stringify({ type: 'last-prompt', leafUuid: uuidFine, sessionId }));
  fs.writeFileSync(percorso, `${righe.join('\n')}\n`, 'utf8');

  return { sessionId, percorso };
}
