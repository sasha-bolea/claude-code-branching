import fs from 'node:fs';
import readline from 'node:readline';
import { sessioneDaPercorso } from './percorsi.js';

// Tipi di record che rappresentano un nodo dell'albero (hanno uuid e parentUuid).
// Gli altri tipi (mode, ai-title, last-prompt, file-history-snapshot...) sono
// metadati di sessione senza posizione nell'albero.
const TIPI_NODO = new Set(['user', 'assistant', 'attachment', 'system']);

// Estrae il testo leggibile da un record di transcript.
// record: oggetto JSON di una riga del .jsonl
// ritorna: stringa (vuota se il record non contiene testo mostrabile)
function estraiTesto(record) {
  const contenuto = record.message?.content ?? record.content;
  if (typeof contenuto === 'string') return contenuto;
  if (!Array.isArray(contenuto)) return '';

  const pezzi = [];
  for (const blocco of contenuto) {
    if (typeof blocco === 'string') pezzi.push(blocco);
    else if (blocco?.type === 'text') pezzi.push(blocco.text ?? '');
    else if (blocco?.type === 'thinking') pezzi.push('[ragionamento]');
    else if (blocco?.type === 'tool_use') pezzi.push(`[tool: ${blocco.name}]`);
    else if (blocco?.type === 'tool_result') pezzi.push('[risultato tool]');
  }
  return pezzi.join(' ').trim();
}

// Legge un .jsonl di sessione e ricostruisce l'albero dei messaggi.
// I record di sidechain (subagent) sono esclusi: hanno parentUuid che punta al
// messaggio principale e produrrebbero biforcazioni inesistenti.
// percorso: path assoluto del file .jsonl
// ritorna: { nodi: Map<uuid, nodo>, radici: nodo[], leafAttivo: uuid|null,
//            ultimoNodo: uuid|null, sessionId, titolo, cwd, gitBranch,
//            primoPrompt, ultimoTimestamp, righe, sidechain }
export async function leggiTranscript(percorso) {
  const nodi = new Map();
  const orfani = [];
  let leafAttivo = null;
  // Ultimo record messaggio scritto nel file. E' da qui che il CLI ricostruisce
  // la conversazione quando riprende in interattivo, quindi e' questo — non
  // last-prompt — a dire dove si trova davvero la sessione.
  let ultimoNodo = null;
  let sessionId = null;
  let titolo = null;
  let cwd = null;
  let gitBranch = null;
  let primoPrompt = null;
  let ultimoTimestamp = null;
  let righe = 0;
  let sidechain = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(percorso, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const riga of rl) {
    if (!riga.trim()) continue;
    righe++;

    let record;
    try {
      record = JSON.parse(riga);
    } catch {
      continue; // riga troncata (scrittura in corso): la salto
    }

    if (record.sessionId && !sessionId) sessionId = record.sessionId;
    if (record.cwd && !cwd) cwd = record.cwd;
    if (record.gitBranch) gitBranch = record.gitBranch;
    if (record.timestamp) ultimoTimestamp = record.timestamp;
    // L'ultimo ai-title vince: è il titolo corrente della sessione.
    if (record.type === 'ai-title' && record.aiTitle) titolo = record.aiTitle;
    // L'ultimo last-prompt indica su quale foglia era posizionata la sessione.
    if (record.type === 'last-prompt' && record.leafUuid) leafAttivo = record.leafUuid;

    if (!TIPI_NODO.has(record.type) || !record.uuid) continue;
    if (record.isSidechain) {
      sidechain++;
      continue;
    }

    const testo = estraiTesto(record);
    const isPrompt =
      record.type === 'user' &&
      record.isMeta !== true &&
      testo.length > 0 &&
      testo !== '[risultato tool]';
    if (isPrompt && !primoPrompt) primoPrompt = testo;

    ultimoNodo = record.uuid;
    nodi.set(record.uuid, {
      uuid: record.uuid,
      parentUuid: record.parentUuid ?? null,
      tipo: record.type,
      testo,
      timestamp: record.timestamp ?? null,
      isMeta: record.isMeta === true,
      // Vero prompt digitato dall'utente: distingue un ripristino reale dai
      // record 'user' che trasportano solo il risultato di un tool.
      isPromptUtente: isPrompt,
      figli: [],
    });
  }

  // Secondo passaggio: collego i figli ai padri.
  // Un padre mancante significa che punta a un record filtrato (sidechain) o a
  // una sessione precedente: il nodo diventa una radice a sé.
  const radici = [];
  for (const nodo of nodi.values()) {
    if (nodo.parentUuid === null) {
      radici.push(nodo);
      continue;
    }
    const padre = nodi.get(nodo.parentUuid);
    if (padre) padre.figli.push(nodo);
    else orfani.push(nodo);
  }
  radici.push(...orfani);

  return {
    nodi,
    radici,
    leafAttivo,
    ultimoNodo,
    sessionId,
    titolo,
    cwd,
    gitBranch,
    primoPrompt,
    ultimoTimestamp,
    righe,
    sidechain,
  };
}

// Unisce gli alberi di piu' sessioni della stessa famiglia in un albero solo.
//
// Un fork produce un file nuovo che copia la storia fino al punto di fork,
// mantenendo gli stessi uuid: i rami abbandonati restano nel file di partenza.
// Unendo per uuid riemerge l'albero completo, con tutti i rami di tutte le
// sessioni discendenti dalla stessa radice.
//
// alberi: array di risultati di leggiTranscript, il primo e' la sessione attiva
// percorsi: path corrispondenti, nello stesso ordine
// ritorna: la stessa forma di leggiTranscript, con nodo.origini = [{sessionId,
//          percorso}] per sapere da quale sessione ripartire
export function unisciAlberi(alberi, percorsi) {
  const attivo = alberi[0];
  const nodi = new Map();

  alberi.forEach((albero, indice) => {
    // L'id da passare a --resume e' quello del file: i record copiati da un fork
    // possono portarsi dietro riferimenti alla sessione di provenienza.
    const percorso = percorsi[indice];
    const origine = { sessionId: sessioneDaPercorso(percorso), percorso };
    for (const nodo of albero.nodi.values()) {
      const esistente = nodi.get(nodo.uuid);
      if (esistente) {
        esistente.origini.push(origine);
        continue;
      }
      nodi.set(nodo.uuid, { ...nodo, figli: [], origini: [origine] });
    }
  });

  // Ricostruisco la parentela sull'unione: un nodo puo' avere figli che nel
  // singolo file non gli erano attaccati.
  const radici = [];
  for (const nodo of nodi.values()) {
    const padre = nodo.parentUuid ? nodi.get(nodo.parentUuid) : null;
    if (padre) padre.figli.push(nodo);
    else radici.push(nodo);
  }

  return {
    ...attivo,
    nodi,
    radici,
    famiglia: percorsi.length,
  };
}

// Trova i punti di biforcazione: nodi con più di un figlio.
// Ogni figlio oltre il primo è un ramo alternativo nato da un ripristino.
// albero: risultato di leggiTranscript
// ritorna: array di nodi, ordinati per timestamp
export function biforcazioni(albero) {
  const trovate = [];
  for (const nodo of albero.nodi.values()) {
    if (nodo.figli.length > 1) trovate.push(nodo);
  }
  return trovate.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
}

// Scende lungo un ramo fino al primo vero prompt utente.
// Serve perché tra il punto di biforcazione e il prompt possono esserci record
// intermedi (attachment, system) che non sono la conversazione.
// nodo: nodo di partenza
// ritorna: il nodo del prompt, oppure null se il ramo non ne contiene
function primoPromptUtente(nodo) {
  const coda = [nodo];
  while (coda.length > 0) {
    const corrente = coda.shift();
    if (corrente.isPromptUtente) return corrente;
    coda.push(...corrente.figli);
  }
  return null;
}

// Biforcazioni che corrispondono a un ripristino reale della conversazione:
// almeno due rami che portano a prompt utente distinti.
// Filtra le forche tecniche (retry di tool) che non interessano l'utente.
// albero: risultato di leggiTranscript
// ritorna: array di { nodo, rami: [{ figlio, prompt }] }
export function ripristini(albero) {
  const trovati = [];
  for (const nodo of biforcazioni(albero)) {
    const rami = [];
    for (const figlio of nodo.figli) {
      const prompt = primoPromptUtente(figlio);
      if (prompt) rami.push({ figlio, prompt });
    }
    if (rami.length > 1) trovati.push({ nodo, rami });
  }
  return trovati;
}

// Elenca le foglie dell'albero: ogni foglia è la punta di un ramo percorribile.
// albero: risultato di leggiTranscript
// ritorna: array di nodi senza figli
export function foglie(albero) {
  const punte = [];
  for (const nodo of albero.nodi.values()) {
    if (nodo.figli.length === 0) punte.push(nodo);
  }
  return punte.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
}

// Risale la catena parentUuid da un nodo fino alla radice.
// È il modo in cui il CLI ricostruisce una conversazione: i rami abbandonati
// restano nel file ma non vengono mai attraversati.
// albero: risultato di leggiTranscript
// uuid: nodo di partenza
// ritorna: array di nodi dalla radice al nodo indicato
export function catenaFinoA(albero, uuid) {
  const catena = [];
  const visti = new Set();
  let corrente = albero.nodi.get(uuid);

  while (corrente && !visti.has(corrente.uuid)) {
    visti.add(corrente.uuid); // guardia contro cicli in file corrotti
    catena.push(corrente);
    corrente = corrente.parentUuid ? albero.nodi.get(corrente.parentUuid) : null;
  }
  return catena.reverse();
}
