import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { leggiTranscript, ripristini, foglie } from './transcript.js';
import { testoLeggibile } from './albero.js';

const CARTELLA_CLAUDE = path.join(os.homedir(), '.claude');
export const CARTELLA_PROGETTI = path.join(CARTELLA_CLAUDE, 'projects');
const CARTELLA_CB = path.join(CARTELLA_CLAUDE, 'cb');
const FILE_CACHE = path.join(CARTELLA_CB, 'indice.json');

// Etichette con cui testoLeggibile marca i prompt di protocollo: comandi slash,
// output locali, interruzioni, notifiche, promemoria di sistema.
const RUMORE = /^[/⌁⎋⚑⚙]/;

// Primo prompt scritto davvero dall'utente.
// Una sessione che comincia con `/clear` o con un promemoria di sistema avrebbe
// come primo prompt quel rumore, e nell'elenco delle conversazioni non direbbe
// niente di cosa contiene.
// albero: risultato di leggiTranscript
// ritorna: testo del prompt, o null
function primoPromptVero(albero) {
  for (const nodo of albero.nodi.values()) {
    if (!nodo.isPromptUtente) continue;
    const testo = testoLeggibile(nodo.testo);
    if (testo && !RUMORE.test(testo)) return testo;
  }
  return null;
}

// Estrae i metadati leggeri di una singola sessione.
// Il parsing completo serve per contare rami e ripristini: e' il motivo per cui
// il risultato viene messo in cache.
// percorso: path del .jsonl
// ritorna: oggetto scheda della sessione
async function schedaSessione(percorso) {
  const albero = await leggiTranscript(percorso);
  const punte = foglie(albero);
  const veri = ripristini(albero);

  return {
    percorso,
    sessionId: albero.sessionId ?? path.basename(percorso, '.jsonl'),
    // Uuid della radice: identifica la famiglia. Le sessioni nate da un fork
    // copiano i record dell'antenato con gli stessi uuid, quindi condividono la
    // radice — ed e' cosi' che si riconoscono i rami di una stessa conversazione.
    radice: albero.radici[0]?.uuid ?? null,
    titolo: albero.titolo,
    cwd: albero.cwd,
    gitBranch: albero.gitBranch,
    primoPrompt: (primoPromptVero(albero) ?? albero.primoPrompt ?? '')
      .replace(/\s+/g, ' ')
      .slice(0, 120),
    ultimoTimestamp: albero.ultimoTimestamp,
    messaggi: albero.nodi.size,
    rami: punte.length,
    ripristini: veri.length,
    leafAttivo: albero.leafAttivo,
  };
}

// Carica la cache dell'indice, tollerando file assente o corrotto.
// ritorna: oggetto { chiave -> scheda } (vuoto se non disponibile)
function caricaCache() {
  try {
    return JSON.parse(fs.readFileSync(FILE_CACHE, 'utf8'));
  } catch {
    return {};
  }
}

// Salva la cache dell'indice su disco.
// cache: oggetto { chiave -> scheda }
function salvaCache(cache) {
  fs.mkdirSync(CARTELLA_CB, { recursive: true });
  fs.writeFileSync(FILE_CACHE, JSON.stringify(cache), 'utf8');
}

// Scansiona tutte le sessioni in ~/.claude/projects, usando la cache per i file
// non modificati. La chiave di validita' e' mtime+size: se il file cresce o
// cambia, viene riletto.
// opzioni.forza: ignora la cache e rilegge tutto
// ritorna: array di schede, dalla piu' recente alla piu' vecchia
export async function scansiona({ forza = false } = {}) {
  const cache = forza ? {} : caricaCache();
  const nuovaCache = {};
  const schede = [];

  let cartelle;
  try {
    cartelle = await fsp.readdir(CARTELLA_PROGETTI, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const cartella of cartelle) {
    if (!cartella.isDirectory()) continue;
    const dir = path.join(CARTELLA_PROGETTI, cartella.name);

    let file;
    try {
      file = await fsp.readdir(dir);
    } catch {
      continue;
    }

    for (const nome of file) {
      if (!nome.endsWith('.jsonl')) continue;
      const percorso = path.join(dir, nome);

      let stat;
      try {
        stat = await fsp.stat(percorso);
      } catch {
        continue;
      }
      if (stat.size === 0) continue;

      const chiave = `${percorso}|${stat.mtimeMs}|${stat.size}`;
      let scheda = cache[chiave];
      // Una scheda in cache senza `radice` viene da una versione precedente:
      // vale come assente, o le conversazioni non si potrebbero raggruppare.
      if (!scheda || !('radice' in scheda)) {
        try {
          scheda = await schedaSessione(percorso);
        } catch {
          continue; // file illeggibile: lo salto senza far cadere la scansione
        }
      }
      scheda.progetto = cartella.name;
      nuovaCache[chiave] = scheda;
      schede.push(scheda);
    }
  }

  salvaCache(nuovaCache);
  return schede.sort((a, b) =>
    String(b.ultimoTimestamp ?? '').localeCompare(String(a.ultimoTimestamp ?? '')),
  );
}

// Risolve un riferimento a sessione: id completo, prefisso di id, o path di file.
// riferimento: stringa fornita dall'utente
// schede: risultato di scansiona()
// ritorna: scheda corrispondente, o null
export function risolviSessione(riferimento, schede) {
  if (fs.existsSync(riferimento)) {
    return schede.find((s) => path.resolve(s.percorso) === path.resolve(riferimento)) ?? null;
  }
  const candidate = schede.filter((s) => s.sessionId.startsWith(riferimento));
  return candidate.length === 1 ? candidate[0] : (candidate[0] ?? null);
}
