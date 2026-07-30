// Selettore delle conversazioni passate di una cartella: l'albero completo in
// cima, l'elenco delle conversazioni sotto. Con ↑↓ si cambia conversazione e
// l'albero sopra si aggiorna; con invio si entra nell'albero e si sceglie il
// punto da cui ripartire.
//
// Sostituisce il selettore nativo di Claude (`claude -r`), che elenca le
// sessioni una per una: un fork crea un file nuovo, quindi la' i rami della
// stessa conversazione compaiono come conversazioni diverse. Qui le sessioni si
// raggruppano per uuid di radice — che il fork copia — e una conversazione e'
// tutto il suo albero, rami abbandonati compresi.

import path from 'node:path';
import { leggiTranscript, unisciAlberi, foglie } from './transcript.js';
import { fineDelTurno } from './attiva.js';
import { scansiona } from './indice.js';
import { slugProgetto, sessioneDaPercorso } from './percorsi.js';
import { componiVista, disegnaRighe, muovi, puntaRamoAttivo, schermata } from './vista.js';
import { azioniNavigazione } from './tasti.js';
import { arancioneForte, grigio, normale } from './stile.js';
import { testoLeggibile } from './albero.js';

// Righe della pagina che non sono ne' albero ne' elenco: intestazione, righe
// vuote, separatore, stacco e barra dei tasti.
const RIGHE_FISSE = 7;

// Quota dello spazio libero che va all'albero: il resto e' dell'elenco.
const QUOTA_ALBERO = 0.6;

const LEGENDE = [
  ['↑↓ scegli la conversazione   invio entra nell\'albero   esc annulla', '↑↓ conversazione   invio albero   esc esci'],
  ['←→ avanti e indietro   ↑↓ cambia ramo   invio riparti da qui   esc torna all\'elenco', '←→↑↓ muovi   invio riparti   esc elenco'],
];

// Raggruppa le schede di sessione per conversazione.
// Due sessioni sono la stessa conversazione se condividono l'uuid di radice: e'
// quello che il fork copia insieme alla storia.
// schede: risultato di scansiona(), gia' filtrate sulla cartella
// ritorna: array di famiglie, dalla piu' recente alla piu' vecchia
export function raggruppaPerFamiglia(schede) {
  const perRadice = new Map();

  for (const scheda of schede) {
    // Senza radice (file illeggibile in testa) la sessione fa famiglia a se':
    // meglio una conversazione in piu' che perderla dall'elenco.
    const chiave = scheda.radice ?? `solo:${scheda.sessionId}`;
    if (!perRadice.has(chiave)) perRadice.set(chiave, []);
    perRadice.get(chiave).push(scheda);
  }

  const famiglie = [];
  for (const [radice, gruppo] of perRadice) {
    gruppo.sort((a, b) =>
      String(b.ultimoTimestamp ?? '').localeCompare(String(a.ultimoTimestamp ?? '')),
    );
    const recente = gruppo[0];
    const prima = gruppo[gruppo.length - 1];

    famiglie.push({
      radice,
      schede: gruppo,
      // La sessione piu' recente e' quella con il titolo aggiornato; il primo
      // prompt, se serve, e' quello della sessione che ha aperto la conversazione.
      titolo: gruppo.find((s) => s.titolo)?.titolo || prima.primoPrompt || '(senza titolo)',
      ultimoTimestamp: recente.ultimoTimestamp,
      ripristini: gruppo.reduce((somma, s) => somma + (s.ripristini ?? 0), 0),
      // Stima: i fork copiano la storia, quindi il file piu' lungo contiene quasi
      // tutta la conversazione. Il numero esatto si sa solo unendo gli alberi, e
      // compare in cima quando la conversazione e' selezionata.
      messaggi: Math.max(...gruppo.map((s) => s.messaggi ?? 0)),
    });
  }

  return famiglie.sort((a, b) =>
    String(b.ultimoTimestamp ?? '').localeCompare(String(a.ultimoTimestamp ?? '')),
  );
}

// Conversazioni di una cartella di lavoro.
// cartella: cwd di cui elencare le conversazioni
// opzioni.schede: schede gia' pronte (per le prove); altrimenti si scansiona
// ritorna: array di famiglie
export async function famiglieDellaCartella(cartella, { schede = null } = {}) {
  const tutte = schede ?? (await scansiona());
  const slug = slugProgetto(cartella);
  return raggruppaPerFamiglia(tutte.filter((s) => s.progetto === slug));
}

// Carica l'albero completo di una conversazione, unendo tutte le sue sessioni.
// famiglia: voce prodotta da raggruppaPerFamiglia
// ritorna: { percorso, percorsi, alberi: Map<percorso, albero>, albero, vista }
export async function caricaFamiglia(famiglia) {
  const percorsi = famiglia.schede.map((s) => s.percorso);
  const alberi = [];
  for (const percorso of percorsi) alberi.push(await leggiTranscript(percorso));

  // Unisco sempre, anche con una sessione sola: e' l'unione a dare a ogni nodo
  // le sue `origini`, cioe' il file da cui ripartire quando lo si sceglie.
  const albero = unisciAlberi(alberi, percorsi);

  return {
    percorso: percorsi[0], // la sessione piu' recente della conversazione
    percorsi,
    alberi: new Map(percorsi.map((p, i) => [p, alberi[i]])),
    albero,
    vista: componiVista(albero),
  };
}

// Data e ora in forma corta, come nell'elenco: "30/07 19:04".
// timestamp: stringa ISO, o null
// ritorna: stringa lunga sempre 11 caratteri
function quando(timestamp) {
  if (!timestamp) return '           ';
  const data = new Date(timestamp);
  if (Number.isNaN(data.getTime())) return '           ';
  const due = (n) => String(n).padStart(2, '0');
  return `${due(data.getDate())}/${due(data.getMonth() + 1)} ${due(data.getHours())}:${due(data.getMinutes())}`;
}

// Taglia un testo alla larghezza data. Le stringhe qui sono ancora nude: il
// colore si applica dopo, o si spezzerebbe una sequenza ANSI a meta'.
const taglia = (testo, larghezza) =>
  testo.length > larghezza ? `${testo.slice(0, Math.max(0, larghezza - 1))}…` : testo;

// Prima stringa che entra nella larghezza data, o l'ultima (la piu' corta).
const primaCheEntra = (varianti, larghezza) =>
  varianti.find((v) => v.length <= larghezza) ?? varianti[varianti.length - 1];

// Finestra di `quante` unita' centrata su una posizione, ferma ai bordi.
// ritorna: indice della prima unita' da mostrare
function finestraAttorno(posizione, quante, totale) {
  if (quante >= totale) return 0;
  return Math.max(0, Math.min(posizione - Math.floor(quante / 2), totale - quante));
}

// Compone la riga di una conversazione nell'elenco.
// famiglia: voce da raggruppaPerFamiglia
// larghezza: colonne disponibili per la riga intera
// scelta: se e' la conversazione selezionata
function rigaConversazione(famiglia, larghezza, scelta) {
  const marchio = famiglia.ripristini > 0 ? `⑂${famiglia.ripristini}` : '  ';
  const coda = `  ${marchio.padEnd(4)} ${String(famiglia.messaggi).padStart(4)} msg`;
  const data = quando(famiglia.ultimoTimestamp);
  // Quel che resta dopo cursore, data e coda e' per il titolo.
  const perTitolo = Math.max(10, larghezza - 4 - data.length - coda.length);
  const titolo = testoLeggibile(famiglia.titolo).replace(/\s+/g, ' ');

  return `  ${scelta ? '▸' : ' '} ${data}  ${taglia(titolo, perTitolo).padEnd(perTitolo)}${coda}`;
}

// Compone l'intera schermata: albero della conversazione selezionata in cima,
// elenco delle conversazioni sotto.
//
// Funzione pura, come `schermata` in vista.js: cosi' la si guarda senza lanciare
// Claude e si prova senza un terminale.
//
// stato: { cartella, famiglie, indice, caricata, selezione, modo }
//   caricata: risultato di caricaFamiglia della conversazione selezionata, o null
//   modo: 'lista' (↑↓ cambiano conversazione) o 'albero' (↑↓←→ muovono il cursore)
// opzioni.colonne, opzioni.altezza: dimensioni del terminale
// ritorna: array di righe pronte da scrivere
export function disegnaConversazioni(
  { cartella, famiglie, indice, caricata, selezione, modo = 'lista', ripristinaCodice = true },
  { colonne = 120, altezza = 30 } = {},
) {
  // Scelta la conversazione, l'elenco non serve piu': si guarda il punto da cui
  // ripartire, ed e' la stessa schermata dell'overlay dentro la sessione (F2),
  // con il prompt scelto per intero e la storia che porta con se'. Cambia solo
  // dove porta Esc, che qui riporta all'elenco.
  if (modo === 'albero' && caricata && selezione) {
    return schermata(caricata.vista, selezione, {
      colonne,
      altezza,
      ripristinaCodice,
      titolo: testoLeggibile(famiglie[indice]?.titolo ?? '').slice(0, 60) || 'conversazione',
      esc: { lunga: "torna all'elenco", corta: 'elenco' },
    });
  }

  const larghezza = Math.max(20, colonne - 4);
  const disponibili = Math.max(6, altezza - RIGHE_FISSE);
  // L'elenco non ha bisogno di piu' righe delle conversazioni che contiene: lo
  // spazio che avanza va all'albero, che ne ha sempre da usare.
  const spazioLista = Math.min(
    Math.max(3, disponibili - Math.ceil(disponibili * QUOTA_ALBERO)),
    Math.max(1, famiglie.length),
  );
  const spazioAlbero = Math.max(3, disponibili - spazioLista);

  // La legenda sta solo in fondo: ripeterla anche in cima toglierebbe una riga
  // all'albero per dire due volte la stessa cosa.
  const quante = famiglie.length === 1 ? '1 conversazione' : `${famiglie.length} conversazioni`;
  const righe = [
    `  ${arancioneForte('cb')}  ${normale(taglia(`${quante} in ${path.basename(cartella)}`, larghezza - 4))}`,
    '',
  ];

  righe.push(
    ...pannelloAlbero(
      famiglie.length === 0 ? false : caricata,
      selezione,
      modo,
      spazioAlbero,
      larghezza,
    ),
  );

  righe.push('', `  ${normale('─'.repeat(larghezza))}`);

  if (famiglie.length === 0) {
    righe.push(`  ${normale('Nessuna conversazione in questa cartella.')}`);
  } else {
    const da = finestraAttorno(indice, spazioLista, famiglie.length);
    for (let i = da; i < Math.min(famiglie.length, da + spazioLista); i += 1) {
      const riga = rigaConversazione(famiglie[i], larghezza, i === indice);
      righe.push(i === indice ? arancioneForte(riga) : normale(riga));
    }
    const restano = famiglie.length - (da + spazioLista);
    if (da > 0 || restano > 0) {
      const sopra = da > 0 ? `↑ ${da} sopra` : '';
      const sotto = restano > 0 ? `↓ ${restano} sotto` : '';
      righe.push(`  ${grigio(`${sopra}${sopra && sotto ? '   ' : ''}${sotto}`)}`);
    }
  }

  // Una riga di stacco fra l'elenco e la barra dei tasti: con l'elenco lungo
  // quanto lo schermo le due si toccherebbero, e l'ultima conversazione
  // sembrerebbe parte della legenda.
  righe.push('');

  // La barra dei tasti resta in fondo allo schermo: l'elenco cambia altezza da
  // una conversazione all'altra, e una barra che salta si legge male.
  while (righe.length < altezza - 1) righe.push('');
  righe.push(
    `  ${grigio(
      primaCheEntra(
        famiglie.length === 0
          ? ['invio o esc: parti da una conversazione nuova', 'invio/esc: nuova']
          : LEGENDE[modo === 'albero' ? 1 : 0],
        larghezza,
      ),
    )}`,
  );

  return righe.slice(0, altezza);
}

// Righe dell'albero della conversazione selezionata, con la finestra che segue
// il cursore in tutte e due le direzioni.
//
// Il pannello occupa sempre esattamente le righe che gli spettano, anche quando
// l'albero e' corto: scorrendo l'elenco gli alberi hanno altezze diverse, e un
// pannello che si adatta a ognuno farebbe salire e scendere il separatore e
// tutto l'elenco sotto. Il riempimento e' invisibile, il salto no.
//
// caricata: risultato di caricaFamiglia, o null se ancora in caricamento
// selezione: uuid su cui sta il cursore
// modo: 'lista' o 'albero'
// spazio: righe a disposizione
// larghezza: colonne a disposizione
// ritorna: array di `spazio` righe
function pannelloAlbero(caricata, selezione, modo, spazio, larghezza) {
  // Riempie fino all'altezza del pannello: le righe in piu' sono vuote, ma
  // tengono ferme quelle che vengono dopo.
  const alta = (righe) => {
    while (righe.length < spazio) righe.push('');
    return righe.slice(0, spazio);
  };

  // `caricata: false` distingue "non c'e' niente da caricare" da "sto caricando":
  // in una cartella senza conversazioni l'attesa non finirebbe mai.
  if (caricata === false) return alta([]);
  if (!caricata) return alta([`  ${normale('carico la conversazione…')}`]);
  const { vista, albero } = caricata;
  if (vista.nodi.length === 0) {
    return alta([`  ${normale('nessun messaggio in questa conversazione')}`]);
  }

  const posizione = vista.posizioni.get(selezione) ?? { riga: 0, colonna: 0 };
  const tagliato = vista.griglia.length > spazio || vista.larghezza > larghezza;
  // Se qualcosa resta fuori, una riga se ne va nell'avviso che lo dice.
  const spazioGriglia = Math.max(1, spazio - (tagliato ? 1 : 0));

  const daRiga = finestraAttorno(posizione.riga, spazioGriglia, vista.griglia.length);
  const daColonna = finestraAttorno(posizione.colonna, larghezza, vista.larghezza);

  const righe = [
    `  ${normale(
      `rami: ${foglie(albero).length}   messaggi: ${albero.nodi.size}   ` +
        `${modo === 'albero' ? 'scegli il punto da cui ripartire' : 'invio per scegliere il punto'}`,
    )}`,
  ];

  const disegnate = disegnaRighe(vista, selezione, { da: daColonna, quante: larghezza });
  for (const riga of disegnate.slice(daRiga, daRiga + spazioGriglia - 1)) righe.push(`  ${riga}`);

  if (tagliato) {
    const sopra = daRiga > 0 ? `↑ ${daRiga}` : '';
    const sotto = Math.max(0, vista.griglia.length - (daRiga + spazioGriglia - 1));
    const destra = Math.max(0, vista.larghezza - (daColonna + larghezza));
    const pezzi = [
      sopra,
      sotto > 0 ? `↓ ${sotto}` : '',
      daColonna > 0 ? `← ${daColonna}` : '',
      destra > 0 ? `→ ${destra}` : '',
    ].filter(Boolean);
    righe.push(`  ${grigio(pezzi.join('   '))}`);
  }

  return alta(righe);
}

// Sessione da cui ripartire per un nodo dell'albero unito.
// I percorsi della famiglia sono ordinati dal piu' recente: `origini[0]` e'
// quindi la sessione piu' recente che contiene quel nodo.
// caricata: risultato di caricaFamiglia
// uuid: nodo scelto
// ritorna: { sessionId, percorso }
function origineDi(caricata, uuid) {
  const origini = caricata.albero.nodi.get(uuid)?.origini;
  if (!origini || origini.length === 0) {
    return { sessionId: sessioneDaPercorso(caricata.percorso), percorso: caricata.percorso };
  }
  return origini[0];
}

// Prepara il risultato della scelta: cosa deve fare cb per ripartire da li'.
//
// Se il punto scelto e' gia' la fine della conversazione in quel file, non c'e'
// niente da tagliare: si riprende quella sessione com'e'. Tagliare comunque
// creerebbe una copia dell'intera conversazione a ogni ripresa.
//
// caricata: risultato di caricaFamiglia
// uuid: nodo scelto
// ritorna: { percorso, albero, alberi, voce, riprendi } — riprendi valorizzato
//          solo quando basta riprendere la sessione senza tagliarla
export function esitoScelta(caricata, uuid) {
  const origine = origineDi(caricata, uuid);
  const alberoOrigine = caricata.alberi.get(origine.percorso) ?? caricata.albero;
  const nodo = alberoOrigine.nodi.get(uuid);
  const fine = nodo ? fineDelTurno(nodo).uuid : null;

  return {
    percorso: caricata.percorso,
    albero: caricata.albero,
    alberi: caricata.alberi,
    voce: caricata.albero.nodi.get(uuid),
    riprendi: fine && alberoOrigine.ultimoNodo === fine ? origine.sessionId : null,
  };
}

// Mostra il selettore e attende la scelta.
// cartella: cwd di cui elencare le conversazioni
// famiglie: elenco gia' pronto (per le prove); altrimenti si legge dal disco
// ritorna: Promise di
//   - risultato di esitoScelta, se una conversazione e' stata scelta
//   - { nuova: true } se non ci sono conversazioni da riprendere
//   - null se annullato con Esc: cb non deve avviare niente
export async function selezionaConversazione({
  cartella,
  famiglie = null,
  ripristinaCodice = true,
  ingresso = process.stdin,
  uscita = process.stdout,
} = {}) {
  const elenco = famiglie ?? (await famiglieDellaCartella(cartella));
  const stato = {
    cartella,
    famiglie: elenco,
    indice: 0,
    caricata: null,
    selezione: null,
    modo: 'lista',
    ripristinaCodice,
  };

  return new Promise((risolvi) => {
    const ridisegna = () => {
      const righe = disegnaConversazioni(stato, {
        colonne: uscita.columns || 120,
        altezza: uscita.rows || 30,
      });
      uscita.write(`\x1b[H\x1b[2J${righe.join('\r\n')}`);
    };

    const chiudi = (risultato) => {
      ingresso.removeListener('data', suDati);
      uscita.removeListener('resize', ridisegna);
      if (ingresso.isTTY) ingresso.setRawMode(false);
      ingresso.pause();
      uscita.write('\x1b[?25h\x1b[?1049l'); // cursore visibile, schermo normale
      risolvi(risultato);
    };

    // Carica l'albero della conversazione selezionata, saltando i caricamenti
    // scavalcati: tenendo premuta una freccia le richieste si accavallano, e
    // senza il contatore l'albero mostrato sarebbe quello arrivato per ultimo.
    const cache = new Map();
    let generazione = 0;
    const mostraSelezionata = async () => {
      const famiglia = stato.famiglie[stato.indice];
      if (!famiglia) return ridisegna();

      const mia = (generazione += 1);
      if (!cache.has(famiglia.radice)) {
        stato.caricata = null;
        ridisegna();
        try {
          cache.set(famiglia.radice, await caricaFamiglia(famiglia));
        } catch {
          cache.set(famiglia.radice, null); // conversazione illeggibile: resta vuota
        }
        if (mia !== generazione) return; // l'utente e' gia' andato oltre
      }

      stato.caricata = cache.get(famiglia.radice);
      stato.selezione = stato.caricata ? puntaRamoAttivo(stato.caricata.vista) : null;
      ridisegna();
    };

    const suDati = (dati) => {
      let daRicaricare = false;

      for (const azione of azioniNavigazione(dati)) {
        if (stato.famiglie.length === 0) {
          // Niente da riprendere: qualunque conferma vale come "parti da zero",
          // Esc invece annulla come ovunque.
          if (azione === 'conferma') return chiudi({ nuova: true });
          if (azione === 'annulla') return chiudi(null);
          continue;
        }

        if (stato.modo === 'albero') {
          if (azione === 'annulla') {
            stato.modo = 'lista';
            continue;
          }
          if (azione === 'conferma') {
            return chiudi(esitoScelta(stato.caricata, stato.selezione));
          }
          if (stato.caricata && ['su', 'giu', 'sinistra', 'destra'].includes(azione)) {
            stato.selezione = muovi(stato.caricata.vista, stato.selezione, azione);
          }
          continue;
        }

        if (azione === 'annulla') return chiudi(null);
        if (azione === 'conferma') {
          // Senza albero non c'e' niente da scegliere: si resta nell'elenco.
          if (stato.caricata && stato.selezione) stato.modo = 'albero';
          continue;
        }
        if (azione === 'su' || azione === 'giu') {
          const passo = azione === 'su' ? -1 : 1;
          stato.indice =
            (stato.indice + passo + stato.famiglie.length) % stato.famiglie.length;
          daRicaricare = true;
        }
      }

      if (daRicaricare) mostraSelezionata();
      else ridisegna();
    };

    uscita.write('\x1b[?1049h\x1b[?25l'); // schermo alternativo, cursore nascosto
    if (ingresso.isTTY) ingresso.setRawMode(true);
    ingresso.resume();
    ingresso.on('data', suDati);
    uscita.on('resize', ridisegna);
    mostraSelezionata();
  });
}

// Prova del selettore senza avviare Claude: `node src/conversazioni.js [cartella]`.
if (import.meta.main) {
  const cartella = process.argv[2] ?? process.cwd();
  const scelta = await selezionaConversazione({ cartella });
  console.log(
    scelta
      ? `${scelta.riprendi ? 'riprendi' : 'taglia'} ${scelta.percorso}\n  punto: ${testoLeggibile(scelta.voce?.testo ?? '').slice(0, 80)}`
      : 'annullato',
  );
}
