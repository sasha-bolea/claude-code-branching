import { catenaFinoA } from './transcript.js';

// Costruisce l'albero collassato dei soli prompt utente.
// L'albero grezzo ha centinaia di nodi (risultati tool, attachment, system):
// illeggibile. Qui ogni nodo e' un prompt digitato, e il padre e' il prompt
// digitato piu' vicino risalendo la catena. La struttura dei rami si conserva.
// albero: risultato di leggiTranscript
// ritorna: { radici: nodoPrompt[], perUuid: Map<uuid, nodoPrompt> }
export function alberoPrompt(albero) {
  const perUuid = new Map();
  const radici = [];

  // Antenato prompt piu' vicino, risalendo parentUuid.
  const antenatoPrompt = (nodo) => {
    let corrente = nodo.parentUuid ? albero.nodi.get(nodo.parentUuid) : null;
    const visti = new Set();
    while (corrente && !visti.has(corrente.uuid)) {
      visti.add(corrente.uuid);
      if (corrente.isPromptUtente) return corrente;
      corrente = corrente.parentUuid ? albero.nodi.get(corrente.parentUuid) : null;
    }
    return null;
  };

  for (const nodo of albero.nodi.values()) {
    if (!nodo.isPromptUtente) continue;
    perUuid.set(nodo.uuid, {
      uuid: nodo.uuid,
      testo: nodo.testo,
      timestamp: nodo.timestamp,
      figli: [],
    });
  }

  for (const nodo of albero.nodi.values()) {
    if (!nodo.isPromptUtente) continue;
    const voce = perUuid.get(nodo.uuid);
    const padre = antenatoPrompt(nodo);
    const vocePadre = padre ? perUuid.get(padre.uuid) : null;
    if (vocePadre) vocePadre.figli.push(voce);
    else radici.push(voce);
  }

  const perTempo = (a, b) => String(a.timestamp).localeCompare(String(b.timestamp));
  radici.sort(perTempo);
  for (const voce of perUuid.values()) voce.figli.sort(perTempo);

  return { radici, perUuid };
}

// Insieme degli uuid che compongono il ramo attualmente attivo.
// albero: risultato di leggiTranscript
// ritorna: Set di uuid
function uuidRamoAttivo(albero) {
  if (!albero.leafAttivo || !albero.nodi.has(albero.leafAttivo)) return new Set();
  return new Set(catenaFinoA(albero, albero.leafAttivo).map((n) => n.uuid));
}

// Riconosce i prompt che non sono testo digitato ma rumore di protocollo
// (comandi slash, output di comandi locali, interruzioni, notifiche) e li
// sostituisce con un'etichetta corta. Senza questo l'albero e' illeggibile.
// testo: contenuto grezzo del prompt
// ritorna: etichetta compatta, o null se il testo e' un prompt normale
function etichettaSpeciale(testo) {
  const comando = testo.match(/<command-name>\s*\/?([^<]+?)\s*<\/command-name>/);
  if (comando) return `/${comando[1].trim()}`;

  const stdout = testo.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
  if (stdout) {
    const contenuto = stdout[1].replace(/\s+/g, ' ').trim();
    return contenuto ? `⌁ ${contenuto}` : '⌁ (nessun output)';
  }

  if (/^\[Request interrupted/.test(testo)) return '⎋ interrotto';
  if (/^<task-notification>/.test(testo)) return '⚑ notifica task';
  if (/^<system-reminder>/.test(testo)) return '⚙ promemoria di sistema';
  return null;
}

// Accorcia un testo su una riga sola, comprimendo i prompt di protocollo.
function riassumi(testo, larghezza) {
  const grezzo = (testo ?? '').trim();
  const pulito = (etichettaSpeciale(grezzo) ?? grezzo).replace(/\s+/g, ' ').trim();
  return pulito.length > larghezza ? `${pulito.slice(0, larghezza - 1)}…` : pulito;
}

// Disegna l'albero dei prompt in ASCII, marcando il ramo attivo e le
// biforcazioni. Ogni riga e' numerata: il numero e' il riferimento che l'utente
// usa per scegliere il punto da cui ripartire.
// albero: risultato di leggiTranscript
// opzioni.larghezza: colonne disponibili per il testo del prompt
// ritorna: { righe: string[], voci: nodoPrompt[] } — voci[i] corrisponde a righe[i]
export function disegnaAlbero(albero, { larghezza = 70 } = {}) {
  const { radici } = alberoPrompt(albero);
  const attivi = uuidRamoAttivo(albero);
  const righe = [];
  const voci = [];

  const scendi = (voce, prefisso, ultimo, radice) => {
    const numero = String(voci.length + 1).padStart(3, ' ');
    const giunzione = radice ? '' : ultimo ? '└─ ' : '├─ ';
    const marchio = attivi.has(voce.uuid) ? '●' : '○';
    const forca = voce.figli.length > 1 ? ` ⑂${voce.figli.length}` : '';
    const ora = (voce.timestamp ?? '').slice(5, 16).replace('T', ' ');

    righe.push(
      `${numero}  ${prefisso}${giunzione}${marchio} ${ora}  ${riassumi(voce.testo, larghezza)}${forca}`,
    );
    voci.push(voce);

    const prefissoFigli = radice ? '' : prefisso + (ultimo ? '   ' : '│  ');
    voce.figli.forEach((figlio, i) => {
      scendi(figlio, prefissoFigli, i === voce.figli.length - 1, false);
    });
  };

  radici.forEach((voce, i) => scendi(voce, '', i === radici.length - 1, radici.length === 1));

  return { righe, voci };
}
