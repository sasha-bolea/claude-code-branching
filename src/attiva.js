import fs from 'node:fs';
import { catenaFinoA } from './transcript.js';
import { T } from './lingua.js';

// Ultimo record del turno che comincia con un dato prompt: si scende tra i
// discendenti fermandosi prima del prompt utente successivo.
//
// E' questo il punto in cui la conversazione va troncata per "ripartire da qui":
// il prompt scelto con la sua risposta, e nulla di quello che e' venuto dopo.
// Il taglio deve farlo cb scrivendo il transcript, perche' --resume-session-at
// tronca solo in modalita' print: in interattivo la conversazione viene caricata
// per intero (verificato catturando lo schermo di una sessione vera).
//
// nodo: prompt di partenza
// ritorna: nodo con cui deve finire la catena
export function fineDelTurno(nodo) {
  let migliore = nodo;
  let profonditaMigliore = 0;

  const scendi = (corrente, profondita) => {
    if (profondita > profonditaMigliore) {
      migliore = corrente;
      profonditaMigliore = profondita;
    }
    for (const figlio of corrente.figli) {
      if (figlio.isPromptUtente) continue; // il turno finisce qui
      scendi(figlio, profondita + 1);
    }
  };

  scendi(nodo, 0);
  return migliore;
}

// Verifica se un file termina con un a capo, leggendone solo l'ultimo byte.
// percorso: path del file
// ritorna: true se l'ultimo byte e' \n (o se il file e' vuoto)
function terminaConACapo(percorso) {
  const dimensione = fs.statSync(percorso).size;
  if (dimensione === 0) return true;

  const buffer = Buffer.alloc(1);
  const descrittore = fs.openSync(percorso, 'r');
  try {
    fs.readSync(descrittore, buffer, 0, 1, dimensione - 1);
  } finally {
    fs.closeSync(descrittore);
  }
  return buffer[0] === 0x0a;
}

// Verifica se un nodo appartiene alla catena attualmente caricata dal CLI.
// albero: risultato di leggiTranscript
// uuid: nodo da cercare
// ritorna: true se il nodo e' nel ramo attivo
export function nelRamoAttivo(albero, uuid) {
  if (!albero.leafAttivo || !albero.nodi.has(albero.leafAttivo)) return false;
  return catenaFinoA(albero, albero.leafAttivo).some((n) => n.uuid === uuid);
}

// Fa in modo che la conversazione riparta esattamente da un dato prompt,
// appendendo un record last-prompt che punta alla fine del suo turno.
//
// Assolve due compiti in uno:
//  - rende raggiungibile un ramo abbandonato: il CLI ricostruisce la catena
//    dall'ultimo last-prompt.leafUuid, e un nodo fuori da quella catena per lui
//    non esiste ("No message found with message.uuid of: ...");
//  - tronca la conversazione al turno scelto. E' il vero motivo per cui il taglio
//    va scritto nel transcript: --resume-session-at tronca solo in modalita'
//    print, in interattivo la conversazione viene caricata per intero.
//
// L'operazione e' additiva: nessun record viene modificato o rimosso, coerente
// col fatto che i transcript sono append-only.
//
// percorso: path del .jsonl di sessione
// albero: risultato di leggiTranscript sullo stesso file
// uuid: prompt da cui ripartire
// ritorna: uuid della foglia attivata, o null se la catena finiva gia' li'
export function attivaRamoDi(percorso, albero, uuid) {
  const nodo = albero.nodi.get(uuid);
  if (!nodo) throw new Error(T.wrapper.nodoNonTrovato(uuid));

  const foglia = fineDelTurno(nodo);
  // Non basta che il nodo sia raggiungibile: la catena deve finire esattamente
  // al suo turno, altrimenti la conversazione ripartirebbe con tutto quello che
  // e' venuto dopo.
  if (albero.leafAttivo === foglia.uuid) return null;

  const record = {
    type: 'last-prompt',
    lastPrompt: (nodo.testo ?? '').replace(/\s+/g, ' ').slice(0, 200),
    leafUuid: foglia.uuid,
    sessionId: albero.sessionId,
  };

  // Se il file non termina con un a capo, appendere direttamente incollerebbe il
  // nuovo record in coda all'ultima riga, corrompendo entrambi.
  fs.appendFileSync(percorso, `${terminaConACapo(percorso) ? '' : '\n'}${JSON.stringify(record)}\n`, 'utf8');
  return foglia.uuid;
}
