import { alberoPrompt, testoLeggibile, uuidRamoAttivo } from './albero.js';
import { arancione, arancioneForte, grigio, normale, rosso, verde } from './stile.js';
import { T } from './lingua.js';

// Vista orizzontale dell'albero dei rami: i prompt scorrono da sinistra a
// destra come nodi di una linea, e ogni biforcazione fa scendere un ramo sotto.
//
// Perche' orizzontale e non un elenco: la conversazione e' una linea, e i rami
// sono deviazioni da quella linea. In verticale un ramo lungo e uno corto
// occupano lo stesso spazio e la forma della conversazione si perde; in
// orizzontale la lunghezza di un ramo si vede.
//
// Il disegno e' separato dal layout: componiVista calcola la griglia una volta
// sola, disegnaRighe la colora in base al nodo selezionato. Cosi' muovere la
// selezione con le frecce non ricalcola nulla.

// Glifi dell'albero. Stanno in cima e non sparsi nel codice perche' sono la cosa
// piu' probabile da cambiare: sono tutti "East Asian Ambiguous", e un terminale
// che li rendesse a doppia larghezza sfaserebbe il rientro dei rami (fatto di
// spazi, che restano larghi uno). Sono tutti della stessa classe, quindi si
// spostano insieme: se serve, si ripiega su ● ○ ─ ┳ ┃ ┣ └ cambiando qui.
const PIENO = '⬤'; // U+2B24, prompt non selezionato
const VUOTO = '◯'; // U+25EF, prompt selezionato: e' il punto da cui si riparte
const TRATTO = '━'; // U+2501, pesante come le giunzioni
const FORCA = '┳'; // da qui nasce almeno un ramo alternativo
const VERTICALE = '┃'; // discesa dalla forca verso la riga del ramo
const INNESTO = '┣'; // ramo con altri rami sotto
const ULTIMO = '┗'; // ultimo ramo della forca

// Distanza fra due nodi consecutivi: il marcatore piu' tre caratteri di raccordo.
const PASSO = 4;

// Legenda dei glifi, dalla piu' ricca alla piu' scarna: su un terminale stretto
// si sceglie la prima che entra. Il testo sta in lingua.js, i glifi qui: sono
// due cose che cambiano per motivi diversi.
export const LEGENDA = T.albero.legenda;

// Cosa si puo' riportare indietro dal punto scelto. Sono le stesse tre voci del
// menu nativo di Claude (Esc Esc), perche' la scelta e' la stessa: la
// conversazione e il codice tornano indietro insieme o separatamente.
//
// L'ordine mette per primo il caso normale, cosi' invio senza pensarci fa la
// cosa che l'utente si aspetta. Il `modo` non e' testo: e' il valore che il
// wrapper legge per decidere cosa fare, e non va tradotto.
export const VOCI_RIPRISTINO = [
  { modo: 'entrambi', etichetta: T.albero.vociRipristino[0] },
  { modo: 'conversazione', etichetta: T.albero.vociRipristino[1] },
  { modo: 'codice', etichetta: T.albero.vociRipristino[2] },
];

// Mappa figlio -> padre nell'albero collassato dei prompt.
// alberoPrompt tiene solo i figli: per muoversi con le frecce serve anche la
// direzione opposta.
// radici: radici dell'albero dei prompt
// ritorna: Map<uuid, nodoPrompt>
function mappaPadri(radici) {
  const padri = new Map();
  const scendi = (voce) => {
    for (const figlio of voce.figli) {
      padri.set(figlio.uuid, voce);
      scendi(figlio);
    }
  };
  radici.forEach(scendi);
  return padri;
}

// Calcola la griglia di caratteri dell'albero orizzontale.
//
// Le catene si disegnano una per riga, in ampiezza: prima la linea principale
// con i suoi ritorni a capo, poi i rami che si sono diramati, ognuno appeso
// sotto a tutto quello che c'era. Cosi' la linea principale resta in alto e la
// discesa di un ramo attraversa spazio vuoto invece di righe gia' disegnate.
//
// La griglia non e' limitata dalla larghezza del terminale: una conversazione
// lunga produce un albero largo, e a mostrarne una finestra ci pensa `schermata`
// facendola scorrere dietro al cursore. Mandare a capo le catene, come si faceva
// prima, faceva sembrare un ramo lungo tanti rami corti.
//
// albero: risultato di leggiTranscript (anche unito, vedi unisciAlberi)
// ritorna: { griglia, nodi, posizioni, perUuid, padri, radici, attivi, larghezza }
//   griglia: righe di celle, con buchi (null) dove non si disegna. Ogni cella e'
//     { ch, uuid, rami }: uuid se la cella e' un nodo, rami se e' un raccordo —
//     gli uuid dei figli verso cui quel raccordo porta. Serve a colorare i
//     collegamenti: senza, un raccordo non saprebbe di che percorso fa parte.
//   nodi: uuid dei prompt nell'ordine di disegno
//   posizioni: Map<uuid, { riga, colonna }>
export function componiVista(albero) {
  const { radici, perUuid } = alberoPrompt(albero);
  const attivi = uuidRamoAttivo(albero);
  const padri = mappaPadri(radici);

  const griglia = [];
  const nodi = [];
  const posizioni = new Map();

  const nuovaRiga = () => griglia.push([]) - 1;
  // uuid: la cella E' quel nodo. rami: la cella e' un raccordo che PORTA a quei
  // nodi — e' cosi' che un collegamento sa di che percorso fa parte, e puo'
  // essere colorato quando il cursore sta a valle.
  const poni = (riga, colonna, ch, { uuid = null, rami = null } = {}) => {
    const celle = griglia[riga];
    while (celle.length < colonna) celle.push(null);
    celle[colonna] = { ch, uuid, rami };
  };
  const libera = (riga, colonna) => !griglia[riga]?.[colonna];

  // Aggiunge rami a una cella gia' disegnata.
  // Per una stessa cella possono passare piu' rami: la discesa di un ramo
  // attraversa le righe dei rami disegnati prima, e la cella deve conoscerli
  // tutti o si illumina solo per il primo che l'ha occupata.
  // L'array va rifatto e non modificato sul posto: `poni` lo condivide fra tutte
  // le celle di una stessa discesa.
  const aggiungiRami = (riga, colonna, rami) => {
    const cella = griglia[riga]?.[colonna];
    if (!cella) return;
    cella.rami = [...new Set([...(cella.rami ?? []), ...rami])];
  };

  // Ogni voce in coda e' una catena da disegnare, con il punto da cui pende.
  //
  // La coda si consuma in profondita': i rami nati da una catena si disegnano
  // subito sotto di lei, prima di tutto quello che restava da fare. In ampiezza —
  // com'era prima — un ramo nato presto ma scoperto tardi finiva in fondo, e la
  // sua discesa attraversava le righe di tutti i rami nati dopo: a schermo
  // sembrava passare "sotto" gli altri. Andando in profondita' ogni ramo occupa
  // una fascia di righe contigua, e sono i rami successivi a scendere per fargli
  // posto.
  //
  // Le radici sono piu' d'una quando la biforcazione e' sul primo prompt: li' non
  // c'e' un nodo padre da cui far pendere i rami, e le catene verrebbero disegnate
  // come conversazioni separate, senza niente che le colleghi. La forca si mette
  // allora prima della prima colonna, come se le radici pendessero da un punto
  // che non e' un prompt — perche' quel punto e' l'inizio della conversazione.
  const uuidRadici = radici.map((voce) => voce.uuid);
  const coda = radici.map((voce, i) => ({
    voce,
    rigaForca: i === 0 ? null : 0, // la prima radice sta sulla riga 0: e' la prima disegnata
    colonnaForca: i === 0 ? null : 0,
    giunzione: i === radici.length - 1 ? ULTIMO : INNESTO,
    forcaDiRadice: i === 0 && radici.length > 1,
  }));

  while (coda.length > 0) {
    const lavoro = coda.shift();
    const riga0 = nuovaRiga();
    let riga = riga0;
    let colonna = lavoro.colonnaForca === null ? 0 : lavoro.colonnaForca + 2;
    // Rami che nascono lungo questa catena, in ordine di comparsa da sinistra a
    // destra: alla fine passano in testa alla coda, cosi' li si disegna prima di
    // quello che c'era gia' in attesa.
    const pendenti = [];

    // Prima radice di una conversazione biforcata in partenza: la forca la
    // precede, e la catena comincia due colonne piu' in la' per farle posto.
    if (lavoro.forcaDiRadice) {
      const versoTutteLeRadici = { rami: uuidRadici };
      poni(riga0, 0, FORCA, versoTutteLeRadici);
      poni(riga0, 1, TRATTO, versoTutteLeRadici);
      colonna = 2;
    }

    if (lavoro.colonnaForca !== null) {
      // Discesa dalla forca fino a questa riga: porta solo a questo ramo. Il
      // verticale si posa solo dove la cella e' libera, per non sovrascrivere un
      // ramo disegnato prima — che pero' e' gia' passato di qui con i suoi rami,
      // quindi la discesa condivisa resta marcata dal primo che l'ha occupata.
      const versoQuestoRamo = { rami: [lavoro.voce.uuid] };
      for (let r = lavoro.rigaForca + 1; r < riga0; r += 1) {
        if (libera(r, lavoro.colonnaForca)) {
          poni(r, lavoro.colonnaForca, VERTICALE, versoQuestoRamo);
        } else {
          // Cella gia' occupata dalla giunzione di un ramo disegnato prima (┣ o
          // ┗) o da una discesa condivisa: la nostra discesa ci passa attraverso,
          // quindi quella cella fa parte anche del nostro percorso.
          aggiungiRami(r, lavoro.colonnaForca, [lavoro.voce.uuid]);
        }
      }
      poni(riga0, lavoro.colonnaForca, lavoro.giunzione, versoQuestoRamo);
      poni(riga0, lavoro.colonnaForca + 1, TRATTO, versoQuestoRamo);
    }

    let voce = lavoro.voce;
    while (voce) {
      poni(riga, colonna, PIENO, { uuid: voce.uuid });
      posizioni.set(voce.uuid, { riga, colonna });
      nodi.push(voce.uuid);

      const figli = voce.figli;
      if (figli.length === 0) break;

      // Raccordo verso il primo figlio, con la forca in mezzo se ce ne sono altri.
      // I primi due caratteri stanno prima della forca, quindi portano a TUTTI i
      // figli; gli ultimi due sono gia' oltre, e portano solo al primo.
      const versoTutti = { rami: figli.map((f) => f.uuid) };
      const versoIlPrimo = { rami: [figli[0].uuid] };
      poni(riga, colonna + 1, TRATTO, versoTutti);
      poni(riga, colonna + 2, figli.length > 1 ? FORCA : TRATTO, versoTutti);
      poni(riga, colonna + 3, TRATTO, versoIlPrimo);

      // La giunzione si decide qui, e con la coda in profondita' e' anche giusta:
      // i rami di una stessa forca occupano fasce contigue nell'ordine in cui li
      // si accoda, quindi l'ultimo e' davvero quello piu' in basso.
      figli.slice(1).forEach((figlio, i, extra) => {
        pendenti.push({
          voce: figlio,
          rigaForca: riga,
          colonnaForca: colonna + 2,
          giunzione: i === extra.length - 1 ? ULTIMO : INNESTO,
        });
      });

      colonna += PASSO;
      voce = figli[0];
    }

    // Dal ramo con la forca piu' a destra a quello con la forca piu' a sinistra.
    //
    // Non e' un dettaglio estetico: la discesa di un ramo scende dritta lungo la
    // colonna della sua forca, attraversando tutte le righe che trova. Se si
    // disegna prima il ramo nato piu' a sinistra, quelli nati a destra devono
    // scendere attraverso le sue righe — che a quel punto sono occupate, perche'
    // partono da una colonna minore e si estendono a destra. Disegnando prima
    // quelli piu' a destra, ogni discesa successiva passa a sinistra di tutto
    // cio' che e' gia' sullo schermo, dove non c'e' niente da attraversare.
    //
    // L'ordinamento e' stabile, quindi i rami di una stessa forca (stessa
    // colonna) restano nell'ordine in cui sono stati accodati: e' quello che
    // rende giusta la scelta fra ┣ e ┗.
    pendenti.sort((a, b) => b.colonnaForca - a.colonnaForca);

    // In testa, non in coda: e' questo che tiene ogni ramo attaccato alla catena
    // da cui nasce invece di spedirlo in fondo all'albero.
    coda.unshift(...pendenti);
  }

  // Larghezza dell'albero intero: serve a `schermata` per sapere quanto resta
  // fuori dalla finestra e dirlo invece di troncare in silenzio.
  const larghezza = griglia.reduce((massimo, celle) => Math.max(massimo, celle.length), 0);

  // Nodi di ogni riga, in ordine di colonna: e' l'indice che serve a `muovi` per
  // saltare al ramo di sopra o di sotto senza riesaminare tutta la griglia.
  const nodiPerRiga = griglia.map(() => []);
  for (const [uuid, dove] of posizioni) nodiPerRiga[dove.riga].push({ uuid, colonna: dove.colonna });
  for (const riga of nodiPerRiga) riga.sort((a, b) => a.colonna - b.colonna);

  return { griglia, nodi, posizioni, perUuid, padri, radici, attivi, larghezza, nodiPerRiga };
}

// Colora una riga di celle raggruppando i caratteri contigui dello stesso tono:
// una sequenza ANSI per carattere renderebbe la riga dieci volte piu' lunga.
//
// In arancione va il percorso dal cursore alla radice: sia i nodi sia le linee
// che li collegano. Tutto il resto — gli altri nodi, i raccordi che portano
// altrove — resta grigio. Un raccordo appartiene al percorso se porta a un nodo
// che ne fa parte: e' per questo che le celle di collegamento portano `rami`.
//
// celle: riga della griglia
// selezione: uuid del nodo selezionato
// percorso: Set degli uuid dal cursore fino alla radice
// ritorna: la riga come testo, senza spazi in coda
function coloraRiga(celle, selezione, percorso) {
  let testo = '';
  let gruppo = '';
  let tono = null;

  const chiudi = () => {
    if (gruppo) testo += tono ? tono(gruppo) : gruppo;
    gruppo = '';
  };

  for (const cella of celle) {
    let ch = ' ';
    let suo = null;

    if (cella) {
      ch = cella.ch;
      // La guardia su uuid non e' ridondante: i raccordi hanno uuid null, e senza
      // di essa con selezione null (nessun cursore) diventerebbero tutti cerchi.
      if (cella.uuid && cella.uuid === selezione) {
        ch = VUOTO;
        suo = arancioneForte;
      } else if (cella.uuid) {
        suo = percorso.has(cella.uuid) ? arancione : grigio;
      } else if (cella.rami?.some((u) => percorso.has(u))) {
        suo = arancione;
      } else {
        suo = grigio;
      }
    }

    if (suo !== tono) {
      chiudi();
      tono = suo;
    }
    gruppo += ch;
  }

  chiudi();
  return testo.replace(/\s+$/, '');
}

// Disegna la vista come righe di testo colorate.
//
// Il ritaglio orizzontale si fa QUI, sulle celle, e non sul testo prodotto: le
// righe finite contengono sequenze ANSI, e tagliarle per numero di caratteri
// spezzerebbe una sequenza a meta' lasciando il terminale colorato per sempre.
//
// vista: risultato di componiVista
// selezione: uuid del nodo su cui sta il cursore
// finestra.da: prima colonna da mostrare
// finestra.quante: quante colonne (per difetto fino in fondo)
// ritorna: array di righe
export function disegnaRighe(vista, selezione, { da = 0, quante = Infinity } = {}) {
  // Il percorso da illuminare: il cursore e tutti i suoi antenati. Si ricalcola
  // a ogni disegno perche' cambia a ogni movimento, ed e' una risalita di padri,
  // non una visita dell'albero.
  const percorso = new Set(selezione ? [selezione] : []);
  let risalita = selezione ? vista.padri.get(selezione) : null;
  while (risalita) {
    percorso.add(risalita.uuid);
    risalita = vista.padri.get(risalita.uuid) ?? null;
  }

  const fine = quante === Infinity ? undefined : da + quante;
  return vista.griglia.map((celle) => coloraRiga(celle.slice(da, fine), selezione, percorso));
}

// Cerca dove proseguire quando si preme destra sull'ultimo prompt di un ramo.
//
// Si guardano i due rami affiancati, quello di sopra e quello di quello di sotto,
// e si tengono solo quelli che vanno piu' avanti del punto in cui siamo: gli
// altri non offrono niente da raggiungere. Fra i rimasti vince il piu' corto —
// che e' il piu' vicino per lunghezza a quello che stiamo lasciando — e a parita'
// di lunghezza quello di sopra.
//
// Si atterra sul primo prompt oltre la colonna attuale, cosi' il movimento
// continua verso destra invece di saltare indietro.
//
// Verso il basso conta anche il ramo che arriva esattamente dove siamo e li'
// finisce: guardando l'albero e' il ramo che termina sotto al cursore, e la
// destra deve poterci scendere invece di scavalcarlo. Verso l'alto no, e non e'
// un'asimmetria gratuita: accettando la parita' anche di sopra, due rami che
// finiscono alla stessa colonna si rimanderebbero il cursore l'un l'altro a ogni
// pressione, invece di lasciarlo scendere fino all'ultimo.
//
// vista: risultato di componiVista
// uuid: foglia da cui si riparte
// ritorna: uuid su cui spostarsi, o null se nessun ramo affiancato arriva fin qui
function proseguiSuUnRamoAffiancato(vista, uuid) {
  const posizione = vista.posizioni.get(uuid);
  if (!posizione) return null;

  const candidati = [];
  for (const passo of [-1, 1]) {
    const vicina = vista.nodiPerRiga[posizione.riga + passo];
    if (!vicina || vicina.length === 0) continue;

    // Prima si cerca un approdo piu' avanti, cosi' la destra continua ad andare
    // avanti quando puo'. Solo se il ramo di sotto non va oltre si accetta il
    // nodo che sta esattamente dove siamo: e' il ramo che finisce sotto al
    // cursore, e da li' si scende.
    const approdo =
      vicina.find((nodo) => nodo.colonna > posizione.colonna) ??
      (passo === 1 ? vicina.find((nodo) => nodo.colonna === posizione.colonna) : undefined);
    if (!approdo) continue; // quel ramo finisce prima di dove siamo

    candidati.push({ passo, uuid: approdo.uuid, fine: vicina[vicina.length - 1].colonna });
  }

  // Il piu' corto per primo; a parita' il passo -1, cioe' il ramo di sopra.
  candidati.sort((a, b) => a.fine - b.fine || a.passo - b.passo);
  return candidati[0]?.uuid ?? null;
}

// Dove porta la freccia sinistra.
// Di norma al prompt precedente, cioe' al padre. Sul primo prompt di un ramo il
// padre sta sulla riga della forca: li' si sale di una riga restando incolonnati,
// e solo se sopra non c'e' niente a quella colonna si ripiega sul padre.
// vista: risultato di componiVista
// uuid: nodo selezionato adesso
// ritorna: uuid su cui spostarsi, invariato se non si puo'
function aSinistra(vista, uuid) {
  const padre = vista.padri.get(uuid);
  const posizione = vista.posizioni.get(uuid);
  const rigaPadre = padre ? vista.posizioni.get(padre.uuid)?.riga : null;

  // Una radice non ha padre: se sta sotto la prima riga e' una conversazione
  // biforcata in partenza, e la sinistra sale come su qualsiasi altro ramo.
  const inTestaAUnRamo = padre ? rigaPadre !== posizione?.riga : posizione?.riga > 0;

  if (posizione && inTestaAUnRamo) {
    const sopra = vista.nodiPerRiga[posizione.riga - 1]?.find(
      (nodo) => nodo.colonna === posizione.colonna,
    );
    if (sopra) return sopra.uuid;
  }

  return padre?.uuid ?? uuid;
}

// Sposta la selezione di un passo nell'albero.
//
// Sinistra e destra seguono la conversazione, indietro e avanti nel tempo. In
// fondo a un ramo la destra non si blocca: passa a un ramo affiancato che vada
// piu' avanti (vedi proseguiSuUnRamoAffiancato).
//
// Sul primo prompt di un ramo il padre e' il punto di biforcazione, che sta su
// un'altra riga: andarci significherebbe salire e tornare indietro con un tasto
// solo. La sinistra sale e basta, se sopra c'e' un prompt alla stessa colonna —
// e' quello che si vede guardando il disegno, dove i rami nati dalla stessa
// forca sono incolonnati. Salendo cosi' si arriva prima o poi sulla riga dove il
// padre e' in linea, e da li' la sinistra torna a essere un passo indietro.
//
// Su e giu' passano al ramo disegnato sopra o sotto, sul nodo piu' vicino in
// orizzontale. Non si limitano ai fratelli del nodo corrente: cosi' il cambio
// ramo funziona da qualsiasi punto, e non solo stando esattamente su una
// biforcazione — dove capitava di trovarsi di rado, visto che il cursore si
// muove soprattutto avanti e indietro lungo una catena. Ogni riga del disegno e'
// un ramo, quindi cambiare riga E' cambiare ramo, ed e' anche quello che l'occhio
// si aspetta guardando l'albero.
//
// vista: risultato di componiVista
// uuid: nodo selezionato adesso
// direzione: 'sinistra' | 'destra' | 'su' | 'giu'
// ritorna: uuid selezionato dopo lo spostamento, invariato se non si puo' muovere
export function muovi(vista, uuid, direzione) {
  const voce = vista.perUuid.get(uuid);
  if (!voce) return uuid;

  if (direzione === 'sinistra') return aSinistra(vista, uuid);
  if (direzione === 'destra') {
    // In fondo a un ramo si prosegue su uno affiancato, invece di fermarsi.
    return voce.figli[0]?.uuid ?? proseguiSuUnRamoAffiancato(vista, uuid) ?? uuid;
  }

  const posizione = vista.posizioni.get(uuid);
  if (!posizione) return uuid;

  const vicina = vista.nodiPerRiga[posizione.riga + (direzione === 'su' ? -1 : 1)];
  if (!vicina || vicina.length === 0) return uuid; // siamo alla prima o all'ultima riga

  // A parita' di distanza vince il nodo piu' a sinistra, cioe' il piu' indietro
  // nella conversazione: fra due candidati e' quello che fa perdere meno storia.
  let migliore = vicina[0];
  for (const candidato of vicina) {
    const distanza = Math.abs(candidato.colonna - posizione.colonna);
    if (distanza < Math.abs(migliore.colonna - posizione.colonna)) migliore = candidato;
  }
  return migliore.uuid;
}

// Punta del ramo attivo: il prompt piu' profondo della catena attiva, cioe' il
// punto in cui la conversazione si trova adesso. E' la selezione naturale
// all'apertura dell'albero: quasi sempre si riparte da poco indietro, non dalla
// radice.
// vista: risultato di componiVista
// ritorna: uuid, o null se non ci sono prompt
export function puntaRamoAttivo(vista) {
  let punta = null;
  // attivi conserva l'ordine della catena: l'ultimo prompt che compare e' la punta.
  for (const uuid of vista.attivi) if (vista.perUuid.has(uuid)) punta = uuid;
  return punta ?? vista.nodi[vista.nodi.length - 1] ?? null;
}

// Prompt che precedono quello selezionato, dal piu' recente fino alla radice:
// e' la storia che quel punto porta con se' se lo si riprende.
// vista: risultato di componiVista
// uuid: nodo selezionato
// ritorna: array di nodiPrompt
export function antenati(vista, uuid) {
  const catena = [];
  let corrente = vista.padri.get(uuid) ?? null;
  while (corrente) {
    catena.push(corrente);
    corrente = vista.padri.get(corrente.uuid) ?? null;
  }
  return catena;
}

// Data e ora di un prompt, corte: giorno-mese e ora:minuti.
// voce: nodo prompt
// ritorna: stringa come "30-07 14:02", o spazi se il timestamp manca
function quando(voce) {
  const grezzo = voce?.timestamp ?? '';
  const data = grezzo.slice(5, 10).split('-').reverse().join('-');
  const ora = grezzo.slice(11, 16);
  return data && ora ? `${data} ${ora}` : ' '.repeat(11);
}

// Righe di codice cambiate in un turno, in forma compatta: "+42 -7".
//
// Un turno che non ha toccato codice non mostra niente invece di "+0 -0": e' il
// caso piu' frequente (domande, spiegazioni) e un contatore a zero ripetuto su
// ogni prompt sarebbe solo rumore.
//
// Il testo torna gia' colorato — verde le aggiunte, rosso le rimozioni — quindi
// chi lo inserisce nella riga non deve rivestirlo.
//
// voce: nodo prompt della vista
// ritorna: stringa (vuota se non e' cambiato niente)
function cambiamenti(voce) {
  const aggiunte = voce?.aggiunte ?? 0;
  const rimozioni = voce?.rimozioni ?? 0;
  if (aggiunte === 0 && rimozioni === 0) return '';
  return [aggiunte > 0 ? verde(`+${aggiunte}`) : '', rimozioni > 0 ? rosso(`-${rimozioni}`) : '']
    .filter(Boolean)
    .join(' ');
}

// Taglia una riga a un numero massimo di colonne VISIBILI: le sequenze ANSI non
// occupano spazio a schermo e non vanno contate, ne' spezzate a meta'. Se il
// taglio cade dentro un tratto colorato il colore viene richiuso, o resterebbe
// acceso sul resto del terminale.
//
// E' la rete di sicurezza del disegno, applicata a tutte le righe alla fine:
// una riga piu' larga del terminale verrebbe mandata a capo, e quel capo sfasa
// tutte le righe sotto. Meglio una riga mozza che un disegno sfasato.
//
// riga: testo gia' colorato
// massimo: colonne visibili consentite
// ritorna: la riga, tagliata se serve
function tagliaVisibile(riga, massimo) {
  let visibili = 0;
  let risultato = '';
  let colorato = false;
  let tagliata = false;

  for (const pezzo of riga.split(/(\x1b\[[0-9;]*m)/)) {
    if (pezzo === '') continue;
    if (pezzo.charCodeAt(0) === 0x1b) {
      risultato += pezzo;
      colorato = pezzo !== '\x1b[0m';
      continue;
    }

    // Per punti di codice e non per unita' UTF-16: un carattere fuori dal piano
    // base (un'emoji in un prompt) verrebbe spezzato a meta'.
    const caratteri = [...pezzo];
    if (visibili + caratteri.length <= massimo) {
      risultato += pezzo;
      visibili += caratteri.length;
      continue;
    }
    risultato += caratteri.slice(0, Math.max(0, massimo - visibili)).join('');
    tagliata = true;
    break;
  }

  return tagliata && colorato ? `${risultato}\x1b[0m` : risultato;
}

// Sceglie la prima delle varianti che sta nello spazio disponibile, dalla piu'
// ricca alla piu' scarna. Se non entra nemmeno l'ultima la si taglia: meglio una
// riga mozza che una che va a capo, perche' il capo sfasa tutto il disegno sotto.
// varianti: testi in ordine di preferenza
// spazio: colonne disponibili
// ritorna: il testo scelto
function primaCheEntra(varianti, spazio) {
  const scelta = varianti.find((testo) => testo.length <= spazio);
  return scelta ?? varianti[varianti.length - 1].slice(0, Math.max(0, spazio));
}

// Calcola una finestra di `quante` unita' su un totale di `totale`, tenendo
// `posizione` al centro e senza uscire dai bordi. Serve in tutte e due le
// direzioni: le righe dell'albero e le sue colonne.
// ritorna: indice della prima unita' da mostrare
function finestraAttorno(posizione, quante, totale) {
  if (quante >= totale) return 0;
  return Math.max(0, Math.min(posizione - Math.floor(quante / 2), totale - quante));
}

// Compone l'intera schermata dell'overlay: l'albero in cima, sotto il prompt
// selezionato per intero, sotto ancora la storia che quel punto porta con se'
// fino alla radice.
//
// L'albero e' una finestra che scorre in tutte e due le direzioni tenendo il
// cursore al centro: una conversazione lunga e' piu' larga del terminale, una
// molto ramificata e' piu' alta. Lo spazio verticale si divide partendo da quello
// che serve al prompt selezionato, cosi' su un terminale basso si stringe
// l'albero invece di spingere fuori schermo il resto.
//
// E' una funzione pura e non un metodo del wrapper: cosi' la si puo' guardare
// senza lanciare Claude (vedi src/anteprima.js) e provare senza un terminale.
//
// vista: risultato di componiVista
// selezione: uuid del nodo su cui sta il cursore
// opzioni.colonne, opzioni.altezza: dimensioni del terminale
// opzioni.ripristinaCodice: se il cambio ramo riporta indietro anche i file
// opzioni.titolo: cosa si sta guardando (in cima, accanto a "cb")
// opzioni.esc: dove porta Esc, nella forma { lunga, corta }. Dentro la sessione
//   si torna a Claude; aprendo l'albero dal selettore delle conversazioni si
//   torna al loro elenco.
// opzioni.extra: altri tasti da annunciare nella barra, se c'e' spazio. Dentro
//   la sessione sono quelli che portano a un'altra conversazione o cartella;
//   aprendo l'albero dal selettore non servono, perche' si e' gia' li'.
// opzioni.menu: indice della voce di VOCI_RIPRISTINO selezionata, quando invio e'
//   gia' stato premuto e si sta scegliendo cosa riportare indietro. L'albero
//   resta a schermo: la scelta riguarda il punto che si vede.
// ritorna: array di righe pronte da scrivere
export function schermata(
  vista,
  selezione,
  {
    colonne = 120,
    altezza = 30,
    ripristinaCodice = true,
    titolo = T.albero.titolo,
    esc = { lunga: T.albero.escLunga, corta: T.albero.escCorta },
    extra = { lunga: '', corta: '' },
    menu = null,
  } = {},
) {
  const scelto = vista.perUuid.get(selezione);
  const testoScelto = aCapo(scelto?.testo, colonne - 6, 3);
  const posizione = vista.posizioni.get(selezione) ?? { riga: 0, colonna: 0 };

  // Righe che non sono ne' albero ne' storico: intestazione, legenda, separatori,
  // il prompt selezionato, l'intestazione dello storico, la barra dei tasti e gli
  // avvisi di albero tagliato sopra, sotto e ai lati. Il menu prende il posto
  // della barra dei tasti ma occupa piu' righe: vanno tolte all'albero, o la
  // schermata sfonderebbe in basso.
  const fisse = 13 + testoScelto.length + (menu === null ? 0 : VOCI_RIPRISTINO.length + 2);
  const disponibili = Math.max(4, altezza - fisse);
  const spazioAlbero = Math.min(vista.griglia.length, Math.max(3, Math.ceil(disponibili * 0.6)));
  const spazioStoria = Math.max(0, disponibili - spazioAlbero);

  // Finestra verticale: quali righe dell'albero entrano nello schermo.
  const inizio = finestraAttorno(posizione.riga, spazioAlbero, vista.griglia.length);
  const sotto = Math.max(0, vista.griglia.length - (inizio + spazioAlbero));

  // Finestra orizzontale: due colonne di margine per i due spazi di rientro con
  // cui ogni riga viene scritta, cosi' l'ultimo carattere non tocca il bordo.
  const spazioColonne = Math.max(10, colonne - 4);
  const daColonna = finestraAttorno(posizione.colonna, spazioColonne, vista.larghezza);
  const aDestra = Math.max(0, vista.larghezza - (daColonna + spazioColonne));

  const righeAlbero = disegnaRighe(vista, selezione, { da: daColonna, quante: spazioColonne });

  // La legenda e' l'unica riga in grigio: tutto il resto sta al primo piano del
  // terminale, cioe' alla massima luminosita' disponibile.
  const righe = [
    `  ${arancioneForte('cb')}  ${normale(primaCheEntra([titolo, T.albero.titoloCorto], spazioColonne - 4))}`,
    `  ${grigio(primaCheEntra(LEGENDA, spazioColonne))}`,
    '',
  ];

  if (inizio > 0) righe.push(`  ${normale(T.albero.righeSopra(inizio))}`);
  for (const riga of righeAlbero.slice(inizio, inizio + spazioAlbero)) righe.push(`  ${riga}`);
  if (sotto > 0) righe.push(`  ${normale(T.albero.righeSotto(sotto))}`);

  // Quanto albero resta fuori ai lati. Va detto: senza, una conversazione lunga
  // sembrerebbe cominciare a meta'. Ogni avviso sta dalla parte dell'albero che
  // annuncia — quello di destra in fondo alla riga — cosi' il verso si legge
  // dalla posizione, non solo dalla freccia.
  if (daColonna > 0 || aDestra > 0) {
    const prima = daColonna > 0 ? T.albero.promptPrima(Math.ceil(daColonna / PASSO)) : '';
    const dopo = aDestra > 0 ? T.albero.promptDopo(Math.ceil(aDestra / PASSO)) : '';
    const stacco = Math.max(1, spazioColonne - prima.length - dopo.length);
    righe.push(`  ${normale(`${prima}${' '.repeat(stacco)}${dopo}`.replace(/\s+$/, ''))}`);
  }

  righe.push('', `  ${normale('─'.repeat(Math.max(10, colonne - 4)))}`);
  // Fra l'ora e "riparti da qui" stanno le righe di codice cambiate in quel
  // turno: dice quanto pesa il punto su cui sta il cursore prima di sceglierlo.
  const cambiate = cambiamenti(scelto);
  righe.push(
    `  ${arancione(quando(scelto))}  ${cambiate ? `${cambiate}  ` : ''}${normale(T.albero.ripartiDaQui)}`,
  );
  for (const riga of testoScelto) righe.push(`  ${arancioneForte(riga)}`);

  if (spazioStoria > 0) {
    const storia = antenati(vista, selezione);
    righe.push('', `  ${normale(T.albero.precedenti(storia.length))}`);
    // 4 di rientro, l'orario, 2 di stacco: quel che resta e' per il testo.
    const larghezzaTesto = spazioColonne - 4 - quando(null).length;
    for (const voce of storia.slice(0, spazioStoria)) {
      const testo = testoLeggibile(voce.testo).slice(0, Math.max(10, larghezzaTesto));
      righe.push(`    ${normale(quando(voce))}  ${normale(testo)}`);
    }
  }

  // Scelta di cosa riportare indietro: prende il posto della barra dei tasti, con
  // l'albero ancora a schermo perche' la scelta riguarda il punto selezionato.
  if (menu !== null) {
    righe.push('', `  ${normale(T.albero.riportaIndietro)}`);
    VOCI_RIPRISTINO.forEach((voce, indice) => {
      const riga = `  ${indice === menu ? '▸' : ' '} ${indice + 1}. ${voce.etichetta}`;
      righe.push(indice === menu ? arancioneForte(riga) : normale(riga));
    });
    righe.push(`  ${grigio(primaCheEntra(T.albero.legendaMenu, spazioColonne))}`);
    return righe.map((riga) => tagliaVisibile(riga, colonne));
  }

  // Barra dei tasti, in tre lunghezze: su un terminale stretto si accorcia invece
  // di andare a capo, che sfaserebbe il disegno.
  const cosaFaInvio = ripristinaCodice ? T.albero.invioConFile : T.albero.invioSenzaFile;
  // Le varianti stanno in ordine di preferenza, non solo di lunghezza: i tasti
  // in piu' valgono piu' della forma distesa delle spiegazioni, quindi la
  // variante che li nomina viene prima di quella piu' lunga che li tace.
  const pezzi = (...voci) => voci.filter(Boolean).join('   ');
  const conExtra = extra.corta
    ? [
        pezzi(T.albero.avantiIndietro, T.albero.cambiaRamo, cosaFaInvio, extra.lunga, `esc = ${esc.lunga}`),
        pezzi(T.albero.avantiIndietro, T.albero.ramo, cosaFaInvio, extra.corta, `esc = ${esc.corta}`),
        pezzi(T.albero.frecce, T.albero.ramo, cosaFaInvio, extra.corta, `esc = ${esc.corta}`),
        pezzi(T.albero.frecce, T.albero.ramo, T.albero.invioRiparti, extra.corta, `esc = ${esc.corta}`),
      ]
    : [];

  righe.push(
    '',
    `  ${normale(
      primaCheEntra(
        [
          ...conExtra,
          pezzi(T.albero.avantiIndietro, T.albero.cambiaRamo, cosaFaInvio, `esc = ${esc.lunga}`),
          pezzi(T.albero.avantiIndietroCorto, T.albero.ramo, cosaFaInvio, `esc = ${esc.corta}`),
          pezzi(T.albero.frecce, T.albero.frecceCorte, T.albero.invioRiparti, `esc = ${esc.corta}`),
          T.albero.barraMinima(esc.corta),
        ],
        spazioColonne,
      ),
    )}`,
  );

  // Rete di sicurezza: nessuna riga puo' eccedere la larghezza del terminale,
  // qualunque cosa la componga. Una riga piu' lunga verrebbe mandata a capo, e il
  // capo sfasa tutto il disegno da lì in giu'.
  return righe.map((riga) => tagliaVisibile(riga, colonne));
}

// Manda a capo un testo su una larghezza data, spezzando fra le parole.
// testo: contenuto da mostrare
// larghezza: colonne disponibili
// massimo: righe oltre le quali il resto viene dichiarato tagliato
// ritorna: array di righe
export function aCapo(testo, larghezza, massimo = Infinity) {
  const righe = [];
  let resto = testoLeggibile(testo);

  while (resto.length > larghezza && righe.length < massimo) {
    // Taglio all'ultimo spazio utile; se non c'e' (una parola piu' lunga della
    // riga: un percorso, un url) si taglia secco alla larghezza.
    const spazio = resto.lastIndexOf(' ', larghezza);
    const taglio = spazio > 0 ? spazio : larghezza;
    righe.push(resto.slice(0, taglio));
    resto = resto.slice(spazio > 0 ? taglio + 1 : taglio);
  }

  if (righe.length < massimo) {
    if (resto.length > 0 || righe.length === 0) righe.push(resto);
  } else if (resto.length > 0) {
    // Resto fuori dallo spazio concesso: lo dichiaro invece di troncare zitto.
    const ultima = righe[righe.length - 1];
    righe[righe.length - 1] = `${ultima.slice(0, Math.max(0, larghezza - 1))}…`;
  }

  return righe;
}
