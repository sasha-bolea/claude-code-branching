import { catenaFinoA } from './transcript.js';
import { T } from './lingua.js';

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

  // Figli per uuid, ricavati da parentUuid come fa tutto il resto di questa
  // funzione: `nodo.figli` e' popolato da leggiTranscript ma non da chi costruisce
  // un albero a mano, e dipenderne renderebbe il conteggio muto senza dirlo.
  const figliDi = new Map();
  for (const nodo of albero.nodi.values()) {
    if (!nodo.parentUuid) continue;
    if (!figliDi.has(nodo.parentUuid)) figliDi.set(nodo.parentUuid, []);
    figliDi.get(nodo.parentUuid).push(nodo);
  }

  // Righe di codice cambiate nel turno che comincia con un prompt: si sommano
  // scendendo fra i discendenti e fermandosi al prompt successivo, che apre il
  // turno dopo. E' lo stesso confine di fineDelTurno, cioe' quello con cui cb
  // taglia la conversazione: il numero mostrato descrive esattamente il pezzo di
  // conversazione da cui si riparte.
  const cambiamentiDelTurno = (nodo) => {
    let aggiunte = 0;
    let rimozioni = 0;

    const scendi = (corrente) => {
      aggiunte += corrente.aggiunte ?? 0;
      rimozioni += corrente.rimozioni ?? 0;
      for (const figlio of figliDi.get(corrente.uuid) ?? []) {
        if (!figlio.isPromptUtente) scendi(figlio);
      }
    };

    scendi(nodo);
    return { aggiunte, rimozioni };
  };

  for (const nodo of albero.nodi.values()) {
    if (!nodo.isPromptUtente) continue;
    perUuid.set(nodo.uuid, {
      uuid: nodo.uuid,
      // Il riassunto di una compattazione e' un record 'user' lungo migliaia di
      // caratteri: mostrarlo darebbe a quel punto della conversazione l'aspetto
      // di un prompt digitato, per giunta che dichiara di venire da un'altra
      // conversazione. Il punto va segnalato per quello che e'.
      testo: nodo.isCompattazione ? T.albero.compattazione : nodo.testo,
      isCompattazione: nodo.isCompattazione === true,
      timestamp: nodo.timestamp,
      ...cambiamentiDelTurno(nodo),
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
//
// La punta del ramo e' l'ULTIMO record messaggio del file, non
// `last-prompt.leafUuid`: e' da lì che il CLI ricostruisce la conversazione
// riprendendo in interattivo, e last-prompt resta spesso indietro (misurato su
// dodici sessioni vere: i due valori divergevano in sette). Prendere last-prompt
// faceva partire il cursore dell'albero su un prompt vecchio invece che su quello
// da cui si e' aperto l'albero. Resta come ripiego per i file senza record utili.
//
// L'ordine di inserimento e' quello della catena, dalla radice alla foglia:
// chi legge il Set puo' contarci per trovare la punta del ramo.
// albero: risultato di leggiTranscript
// ritorna: Set di uuid
export function uuidRamoAttivo(albero) {
  const punta = [albero.ultimoNodo, albero.leafAttivo].find((u) => u && albero.nodi.has(u));
  if (!punta) return new Set();
  return new Set(catenaFinoA(albero, punta).map((n) => n.uuid));
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

// Testo di un prompt in forma leggibile, su una riga: i prompt di protocollo
// diventano l'etichetta corta di etichettaSpeciale, gli altri restano come sono.
// testo: contenuto grezzo del prompt
// ritorna: testo normalizzato, senza spaziature multiple
export function testoLeggibile(testo) {
  const grezzo = (testo ?? '').trim();
  return (etichettaSpeciale(grezzo) ?? grezzo).replace(/\s+/g, ' ').trim();
}

// Accorcia un testo su una riga sola, comprimendo i prompt di protocollo.
function riassumi(testo, larghezza) {
  const pulito = testoLeggibile(testo);
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
