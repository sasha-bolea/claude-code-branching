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

  // Un prompt da cui abbia senso ripartire, cioe' scritto da chi sta davanti al
  // terminale. Nel transcript sono record `user` anche le notifiche dei task in
  // background, i promemoria di sistema, le interruzioni, i comandi slash e il
  // loro output: occupavano un nodo a testa e coprivano i prompt veri.
  //
  // La compattazione resta, ed e' l'unica eccezione: non e' rumore di protocollo
  // ma un fatto della conversazione — dice dove la storia e' stata riassunta — e
  // ripartire da li' significa qualcosa.
  const daMostrare = (nodo) =>
    nodo.isPromptUtente &&
    (nodo.isCompattazione === true || etichettaSpeciale((nodo.testo ?? '').trim()) === null);

  // L'interruzione non e' un punto da cui ripartire — riprendendola si tornerebbe
  // a un turno che non e' mai finito — ma dice qualcosa del prompt che l'ha
  // subita: che la risposta e' monca. Va quindi segnata su quel prompt invece che
  // occupare un nodo suo.
  const eInterruzione = (nodo) =>
    nodo.isPromptUtente && /^\[Request interrupted/.test((nodo.testo ?? '').trim());

  // Antenato prompt piu' vicino, risalendo parentUuid. Salta anche i prompt che
  // non si mostrano, o i figli di una notifica si ritroverebbero senza padre.
  const antenatoPrompt = (nodo) => {
    let corrente = nodo.parentUuid ? albero.nodi.get(nodo.parentUuid) : null;
    const visti = new Set();
    while (corrente && !visti.has(corrente.uuid)) {
      visti.add(corrente.uuid);
      if (daMostrare(corrente)) return corrente;
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
        // Il turno finisce al prompt successivo, e i prompt che non si mostrano
        // non ne aprono uno: quello che Claude cambia dopo una notifica di task
        // e' ancora roba del turno di chi ha scritto.
        if (!daMostrare(figlio)) scendi(figlio);
      }
    };

    scendi(nodo);
    return { aggiunte, rimozioni };
  };

  for (const nodo of albero.nodi.values()) {
    if (!daMostrare(nodo)) continue;
    perUuid.set(nodo.uuid, {
      uuid: nodo.uuid,
      // Il riassunto di una compattazione e' un record 'user' lungo migliaia di
      // caratteri: mostrarlo darebbe a quel punto della conversazione l'aspetto
      // di un prompt digitato, per giunta che dichiara di venire da un'altra
      // conversazione. Il punto va segnalato per quello che e'.
      testo: nodo.isCompattazione ? T.albero.compattazione : nodo.testo,
      isCompattazione: nodo.isCompattazione === true,
      interrotto: false, // riempito sotto, dal prompt che l'interruzione ha subito
      timestamp: nodo.timestamp,
      ...cambiamentiDelTurno(nodo),
      figli: [],
    });
  }

  for (const nodo of albero.nodi.values()) {
    if (eInterruzione(nodo)) {
      const subito = antenatoPrompt(nodo);
      const voce = subito ? perUuid.get(subito.uuid) : null;
      if (voce) voce.interrotto = true;
      continue;
    }
    if (!daMostrare(nodo)) continue;
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
