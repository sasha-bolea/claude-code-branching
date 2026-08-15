// La coda dei prompt: quello che vuoi chiedere dopo, scritto mentre Claude sta
// ancora rispondendo.
//
// Il problema che risolve: un prompt mandato a turno in corso si accoda da solo,
// ma **quando** entri nel contesto lo decide Claude, non tu — te ne accorgi
// perche' l'indicatore di caricamento resta sopra quello che hai appena scritto,
// e l'unico modo di forzarlo e' Esc. Qui i prompt li tieni tu, in un elenco che
// vedi, e partono uno per turno.
//
// Consegna: l'hook `Stop` (hooks/cb-coda.ps1) prende il primo della coda e
// risponde `{"decision":"block","reason":<prompt>}`. Quel `decision` impedisce a
// Claude di fermarsi e gli passa il testo, che riprende a lavorare. E' l'unico
// aggancio che gli hook offrono, e ha una conseguenza dichiarata: il prompt
// arriva come motivo del blocco, **non** come un record `user` del transcript.
// Nell'albero dei rami non diventa quindi un nodo, e da li' non si riparte.
//
// Due interruttori decidono cosa parte, e sono diversi apposta: **stop** e' una
// barriera — quel prompt e tutti quelli dopo restano fermi finche' e' acceso —
// mentre **salta** riguarda un prompt solo, che viene scavalcato. Il primo serve
// per «da qui in poi fermati», il secondo per «questo non ancora».
//
// La coda e' legata alla singola sessione — due finestre sulla stessa cartella
// non si rubano i prompt — e per questo va spostata a mano quando l'id cambia:
// lo fa `trasferisci`, chiamata dal wrapper a ogni cambio di sessione (/clear e
// cambio ramo).
//
// Ogni operazione rilegge il file prima di scriverlo, e non tiene un elenco in
// memoria: mentre la schermata e' aperta l'hook puo' scattare e togliere il
// primo prompt, e una scrittura basata su quello che c'era all'apertura lo
// rimetterebbe in coda gia' consegnato.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { azioniCoda } from './tasti.js';
import { inserisci, cancella, muovi, conCursore, dentro } from './campo.js';
import { sovrapposizioneIstruzioni } from './istruzioni.js';
// Il riquadro e' quello delle note: stessa schermata, stesso disegno.
import {
  coloraTasti,
  legendaSuRighe,
  primaCheEntra,
  aCapo,
  tagliaVisibile,
  riquadro as disegnaRiquadro,
} from './vista.js';
import { T } from './lingua.js';
import { leggiLimiti, limiteEsaurito, oraReset } from './limiti.js';
import { arancioneForte, bianco, grigio, normale } from './stile.js';

// Cartella delle code, accanto alle altre cose di cb. La variabile CB_CODA ha la
// precedenza: serve alle prove, che non devono scrivere sulle code vere.
// ritorna: percorso della cartella
export function cartellaCode() {
  return process.env.CB_CODA || path.join(os.homedir(), '.claude', 'cb', 'coda');
}

// File della coda di una sessione.
// sessione: id della sessione
// ritorna: percorso del .json
export function percorsoCoda(sessione) {
  return path.join(cartellaCode(), `${sessione}.json`);
}

// Normalizza una voce della coda.
// Sul disco puo' esserci una stringa — e' il formato delle code scritte prima
// che stop e salta esistessero — oppure l'oggetto con i due interruttori. Si
// accettano tutt'e due invece di migrare il file: una coda in attesa e' roba
// dell'utente, e una migrazione che sbaglia la perde.
// voce: stringa o { testo, stop, salta }
// ritorna: { testo, stop, salta } | null se non e' una voce valida
function normalizza(voce) {
  if (typeof voce === 'string') return { testo: voce, stop: false, salta: false };
  if (voce && typeof voce.testo === 'string') {
    return { testo: voce.testo, stop: voce.stop === true, salta: voce.salta === true };
  }
  return null;
}

// Prompt in attesa, dal primo che partira' all'ultimo.
// Un file assente, illeggibile o corrotto vale come coda vuota: la coda e' una
// comodita', e non deve poter impedire niente.
// sessione: id della sessione
// ritorna: array di { testo, stop, salta }
export function leggiCoda(sessione) {
  if (!sessione) return [];
  try {
    const dati = JSON.parse(fs.readFileSync(percorsoCoda(sessione), 'utf8'));
    if (!Array.isArray(dati?.prompt)) return [];
    return dati.prompt.map(normalizza).filter(Boolean);
  } catch {
    return [];
  }
}

// Il prompt che partirebbe adesso.
//
// Le due regole sono diverse apposta: **salta** riguarda un prompt solo e lo si
// scavalca, **stop** e' una barriera e ferma anche tutti quelli dopo. Serve
// perche' le due cose che si vogliono sono diverse: «questo non ancora» e «da
// qui in poi non partire piu' finche' non lo dico io».
// prompt: la coda gia' letta
// ritorna: indice del prossimo, oppure -1 se non deve partire niente
export function indiceProssimo(prompt) {
  for (let i = 0; i < prompt.length; i += 1) {
    if (prompt[i].stop) return -1;
    if (!prompt[i].salta) return i;
  }
  return -1;
}

// Scrive la coda, creando la cartella se manca. Una coda vuota si cancella
// invece di restare come file: e' cosi' che la pulizia non trova avanzi, e che
// l'hook capisce a colpo d'occhio che non c'e' niente da mandare.
// sessione: id della sessione
// prompt: array di { testo, stop, salta }, o di stringhe
export function scriviCoda(sessione, prompt) {
  if (!sessione) return;
  const percorso = percorsoCoda(sessione);
  prompt = prompt.map(normalizza).filter(Boolean);
  if (prompt.length === 0) {
    try {
      fs.unlinkSync(percorso);
    } catch {
      // gia' assente: e' lo stato che volevamo
    }
    return;
  }
  fs.mkdirSync(path.dirname(percorso), { recursive: true });
  fs.writeFileSync(percorso, `${JSON.stringify({ prompt }, null, 2)}\n`, 'utf8');
}

// Aggiunge un prompt in fondo. Il testo vuoto non si accoda: sarebbe un turno
// speso per niente.
// sessione: id della sessione
// testo: prompt da accodare
// ritorna: la coda aggiornata
export function accoda(sessione, testo) {
  const pulito = testo.trim();
  if (!pulito) return leggiCoda(sessione);
  const prompt = [...leggiCoda(sessione), { testo: pulito, stop: false, salta: false }];
  scriviCoda(sessione, prompt);
  return prompt;
}

// Riscrive il testo di un prompt gia' in coda, tenendogli i suoi interruttori.
//
// Serve perche' un prompt accodato si modifica dentro il riquadro, come una
// nota: accodarlo non e' piu' l'ultimo momento per correggerlo. Svuotarlo lo
// toglie — e' la stessa regola delle note, e risparmia un tasto da imparare.
// sessione: id della sessione
// indice: posizione del prompt
// testo: il nuovo testo
// ritorna: la coda aggiornata
export function sostituisci(sessione, indice, testo) {
  const prompt = leggiCoda(sessione);
  if (indice < 0 || indice >= prompt.length) return prompt;
  const pulito = testo.trim();
  if (!pulito) prompt.splice(indice, 1);
  else prompt[indice] = { ...prompt[indice], testo: pulito };
  scriviCoda(sessione, prompt);
  return prompt;
}

// Accende o spegne uno dei due interruttori di un prompt.
// sessione: id della sessione
// indice: posizione del prompt
// campo: 'stop' | 'salta'
// ritorna: la coda aggiornata
export function commuta(sessione, indice, campo) {
  const prompt = leggiCoda(sessione);
  if (indice < 0 || indice >= prompt.length) return prompt;
  prompt[indice] = { ...prompt[indice], [campo]: !prompt[indice][campo] };
  scriviCoda(sessione, prompt);
  return prompt;
}

// Scambia un prompt con quello sopra o sotto.
//
// Lo scambio e non l'inserimento altrove: cosi' l'unica cosa che cambia sono due
// righe, e il cursore la segue muovendosi di uno. Ai bordi non fa niente, il che
// e' anche il modo in cui il chiamante non deve controllarli.
// sessione: id della sessione
// indice: posizione del prompt
// direzione: 'su' | 'giu'
// ritorna: la coda aggiornata
export function sposta(sessione, indice, direzione) {
  const prompt = leggiCoda(sessione);
  const verso = indice + (direzione === 'su' ? -1 : 1);
  if (indice < 0 || indice >= prompt.length || verso < 0 || verso >= prompt.length) return prompt;
  [prompt[indice], prompt[verso]] = [prompt[verso], prompt[indice]];
  scriviCoda(sessione, prompt);
  return prompt;
}

// Toglie il prompt in una posizione. Un indice fuori dall'elenco non fa niente:
// puo' capitare se l'hook ha consegnato il primo mentre il cursore stava in
// fondo.
// sessione: id della sessione
// indice: posizione da togliere
// ritorna: la coda aggiornata
export function togli(sessione, indice) {
  const prompt = leggiCoda(sessione);
  if (indice < 0 || indice >= prompt.length) return prompt;
  prompt.splice(indice, 1);
  scriviCoda(sessione, prompt);
  return prompt;
}

// Sposta la coda da una sessione all'altra.
//
// Serve perche' la coda e' legata all'id di sessione, e in cb quell'id cambia
// spesso: un /clear fa nascere un file nuovo, e ogni cambio ramo crea una
// sessione troncata. Senza lo spostamento i prompt scritti resterebbero appesi a
// una sessione che non riceve piu' hook, cioe' sparirebbero senza dirlo.
//
// Se la sessione di arrivo ha gia' una coda, le due si uniscono: prima quelli
// che c'erano di la', perche' erano gia' in attesa.
// da: id di partenza
// a: id di arrivo
export function trasferisci(da, a) {
  if (!da || !a || da === a) return;
  const partenza = leggiCoda(da);
  if (partenza.length === 0) return;
  scriviCoda(a, [...leggiCoda(a), ...partenza]);
  scriviCoda(da, []);
}

// Accorcia un prompt a una riga sola, per l'elenco.
// testo: prompt intero
// larghezza: colonne disponibili
// ritorna: testo su una riga
function suUnaRiga(testo, larghezza) {
  const pulito = testo.replace(/\s+/g, ' ').trim();
  return pulito.length > larghezza ? `${pulito.slice(0, Math.max(1, larghezza - 1))}…` : pulito;
}

// Compone la schermata intera.
// Funzione pura come `disegna` in cartelle.js: si guarda senza terminale e si
// prova senza premere tasti.
// stato: { prompt, indice, testo }
// ritorna: array di righe pronte da scrivere
export function disegnaCoda(stato, { colonne = 100, altezza = 30 } = {}) {
  const larghezza = Math.max(20, colonne - 4);
  const taglia = (testo) => (testo.length > larghezza ? testo.slice(0, larghezza) : testo);
  // Stessa impaginazione delle note, perche' le due schermate fanno la stessa
  // cosa: un elenco di testi tuoi, e quello che stai scrivendo dentro un
  // riquadro in fondo. Erano due disegni diversi per nessun motivo, e passare
  // dall'una all'altra costringeva a reimparare dove guardare.
  const larghezzaBox = Math.max(10, larghezza);
  const dentroBox = Math.max(6, larghezzaBox - 4);

  // Il riquadro sta sulla voce scelta, non sempre in fondo: e' il prompt che
  // stai modificando, esattamente come nelle note e' la nota che stai
  // scrivendo. L'ultima posizione — quella oltre l'ultimo prompt — e' il prompt
  // nuovo, che e' dove si sta appena aperta la schermata.
  //
  // Il testo va a capo dentro al riquadro invece di scorrere su una riga sola:
  // un prompt incollato si porta dietro i suoi a capo, ed e' giusto vederli —
  // finche' stavano su una riga, di un prompt lungo si leggeva solo la coda.
  //
  // Il numero apre la prima riga, col testo di seguito: e' un'etichetta corta e
  // fissa, e su una riga sua ne sprecherebbe una in un riquadro che di righe ne
  // ha poche. Le righe dopo la prima rientrano fin sotto al testo, cosi' il
  // prompt resta incolonnato.
  //
  // «Accoda prompt» invece sta su una riga sua: e' una frase, non un numero, e
  // il testo che le corresse accanto partirebbe da meta' riquadro — con un
  // rientro grande quanto la frase su tutte le righe sotto.
  // testa: quello che apre il campo (il numero, o la frase), gia' colorato
  // largaTesta: colonne che `testa` occupa a schermo, per il rientro
  // sopra: true se la testa va su una riga sua, col testo sotto
  const campo = (testa, largaTesta, sopra = false) => {
    const cursore = arancioneForte('█');
    const rientro = sopra ? '' : ' '.repeat(largaTesta);
    // A campo vuoto resta la testa col cursore: e' gia' lei a dire dove
    // finiscono i tasti — «accoda prompt» sul posto in fondo, il numero su un
    // prompt che hai appena svuotato. Un segnaposto in piu' direbbe la stessa
    // cosa due volte.
    if (!stato.testo) {
      return disegnaRiquadro(sopra ? [testa, cursore] : [`${testa}${cursore}`], larghezzaBox);
    }

    // Il cursore si infila come segnaposto e si colora **dopo** il capo: le
    // sequenze ANSI contano come caratteri, e il capo cadrebbe nel posto
    // sbagliato. La colonna che occupa va tolta alla larghezza, o la riga che
    // finisce esatta sul bordo sfora di uno.
    const SEGNAPOSTO = '\u0000';
    const conIlCursore = conCursore(stato.testo, dentro(stato.testo, stato.cursore), SEGNAPOSTO);
    const larghezzaTesto = Math.max(10, dentroBox - 1 - (sopra ? 0 : largaTesta));
    const righeCampo = conIlCursore
      .split('\n')
      .flatMap((pezzo) => (pezzo ? aCapo(pezzo, larghezzaTesto) : ['']))
      .map((riga, i) => {
        const dove = riga.indexOf(SEGNAPOSTO);
        const vestita =
          dove < 0
            ? bianco(riga)
            : `${bianco(riga.slice(0, dove))}${cursore}${bianco(riga.slice(dove + 1))}`;
        return `${i === 0 && !sopra ? testa : rientro}${vestita}`;
      });
    return disegnaRiquadro(sopra ? [testa, ...righeCampo] : righeCampo, larghezzaBox);
  };

  // L'elenco, con un separatore sopra ogni prompt: e' quello che apre l'elenco,
  // e mette ogni voce alla stessa distanza dalla precedente. Identico alle note.
  const elenco = [];
  let fineBox = 0; // ultima riga del riquadro, per tenerlo dentro lo schermo
  const prossimo = indiceProssimo(stato.prompt);
  // Uno stop ferma anche tutti quelli dopo: si spengono insieme a lui, o
  // l'elenco direbbe che partono.
  const primoStop = stato.prompt.findIndex((prompt) => prompt.stop);

  // Quello che apre la prima riga dentro al riquadro: il numero del prompt e il
  // suo stato. Sono le stesse cose che si leggono nelle righe dell'elenco —
  // modificandone uno non devono sparire, o non si saprebbe piu' quale si sta
  // toccando ne' se e' fermo.
  //
  // Torna anche quanto occupa a schermo: e' il rientro delle righe dopo la
  // prima, e va misurato **prima** di colorare — le sequenze ANSI non occupano
  // colonne, e contarle sfaserebbe l'incolonnamento.
  // i: posizione del prompt
  // ritorna: [testa colorata, colonne occupate]
  const intestazioneDi = (i) => {
    const prompt = stato.prompt[i];
    const marchi = [prompt.stop ? T.coda.marchioStop : '', prompt.salta ? T.coda.marchioSalta : '']
      .filter(Boolean)
      .join(' ');
    const testa = `${String(i + 1).padStart(2)}.${marchi ? ` ${marchi}` : ''} `;
    return [arancioneForte(testa), [...testa].length];
  };

  stato.prompt.forEach((prompt, i) => {
    elenco.push(`  ${grigio('─'.repeat(larghezzaBox))}`);
    if (i === stato.indice) {
      // Il prompt scelto sta nel riquadro ed e' li' che si modifica: accodarlo
      // non e' piu' l'ultimo momento per correggerlo.
      elenco.push(...campo(...intestazioneDi(i)));
      fineBox = elenco.length - 1;
      return;
    }
    const fermo = (primoStop >= 0 && i >= primoStop) || prompt.salta;
    const marchi = [prompt.stop ? T.coda.marchioStop : '', prompt.salta ? T.coda.marchioSalta : '']
      .filter(Boolean)
      .join(' ');
    const nota = marchi ? `  ${marchi}` : '';
    const spazio = Math.max(10, larghezza - 8 - nota.length);
    const riga = `    ${String(i + 1).padStart(2)}. ${suUnaRiga(prompt.testo, spazio)}`;
    // Quello che partira' per primo si riconosce dal colore, non da un'etichetta
    // scritta accanto: con stop e salta di mezzo non e' per forza il primo
    // dell'elenco, e una parola in piu' su ogni riga si legge peggio di un
    // colore che si vede senza leggere.
    const colore = i === prossimo ? arancioneForte : fermo ? grigio : normale;
    elenco.push(colore(taglia(riga + nota)));
  });

  // In fondo il prompt nuovo, come la nota nuova: c'e' sempre, ed e' dove si sta
  // appena aperta la schermata.
  elenco.push(`  ${grigio('─'.repeat(larghezzaBox))}`);
  if (stato.indice >= stato.prompt.length) {
    // Il posto in fondo non ha un numero: al suo posto c'e' la frase che dice
    // cosa ci si fa, e sta su una riga sua (vedi `campo`).
    elenco.push(...campo(grigio(T.coda.nuovo), 0, true));
    fineBox = elenco.length - 1;
  } else {
    elenco.push(`    ${grigio(T.coda.nuovo)}`);
  }

  // Lo scorrimento si ancora al riquadro, come nelle note: con la coda piena il
  // campo finirebbe sotto il bordo dello schermo, e si scriverebbe alla cieca.
  // Quante righe restano fuori si dice nell'intestazione, non dentro la
  // finestra: li' si mangerebbe una riga del riquadro, cioe' proprio quella che
  // si voleva tenere.
  //
  // La legenda si compone **prima**: puo' occupare piu' di una riga, e sono
  // righe che l'elenco non ha. Contandone sempre una, il riquadro scivolerebbe
  // sotto il bordo proprio sugli schermi stretti, dove la legenda si allunga.
  const legenda = legendaSuRighe(T.coda.legende, larghezza);
  const TESTATA = 5; // titolo, sottotitolo, riga vuota, conto, riga vuota
  const spazio = Math.max(1, altezza - 1 - legenda.length - TESTATA);
  const da = Math.max(0, fineBox - spazio + 1);
  const fuori = da + Math.max(0, elenco.length - (da + spazio));

  // La pausa per i token si dice accanto al conto, in arancione: e' l'unica
  // spiegazione del perche' una coda piena non stia partendo, e senza si legge
  // come un guasto. Sta qui e non nel sottotitolo perche' e' informazione che
  // cambia, e il sottotitolo dice sempre la stessa cosa.
  // Lo spazio per l'avviso e' quello che avanza dopo il conto dei prompt, e la
  // variante si sceglie di conseguenza: su un terminale stretto resta almeno
  // `‖ 14:30`, che e' l'ora — la sola cosa che l'avviso deve dire.
  const testoConto = stato.prompt.length === 0 ? T.coda.vuota : T.coda.quanti(stato.prompt.length);
  const pausa = stato.pausaFino
    ? `  ${arancioneForte(primaCheEntra(T.coda.inPausa(stato.pausaFino), larghezza - testoConto.length - 2))}`
    : '';
  // In pausa, «altre N righe» cede il posto. Le due insieme non ci stanno su un
  // terminale normale, e a essere tagliata era la coda della riga — cioe' l'ora
  // del reset, che e' il motivo per cui l'avviso esiste: «in pausa» senza un
  // «fino a quando» dice meno di niente. Che ci siano righe fuori schermo si
  // scopre premendo una freccia; perche' la coda non parta, no.
  const righeFuori = fuori > 0 && !pausa ? `  ${grigio(T.coda.fuoriSchermo(fuori))}` : '';
  const conto =
    stato.prompt.length === 0
      ? `${grigio(taglia(T.coda.vuota))}${pausa}`
      : `${normale(taglia(T.coda.quanti(stato.prompt.length)))}${righeFuori}${pausa}`;

  const righe = [
    `  ${arancioneForte('cb')}  ${normale(taglia(T.coda.titolo))}`,
    `  ${grigio(taglia(T.coda.sottotitolo))}`,
    '',
    // Il conto si taglia sulle colonne visibili: ci sono i colori dentro, e
    // sommandogli le righe fuori schermo puo' superare il terminale — dove una
    // riga troppo lunga va a capo e sfasa tutto il disegno sotto.
    `  ${tagliaVisibile(conto, larghezza)}`,
    '',
    ...elenco.slice(da, da + spazio),
  ];

  // La legenda in fondo allo schermo, come in ogni altra schermata: l'elenco
  // cresce a ogni prompt accodato, e una legenda che scende si legge peggio.
  //
  // Su piu' righe se serve: qui i tasti sono tanti, e accorciare fino a farceli
  // stare su una sola voleva dire buttarne via — cioe' tasti che non sai di
  // avere. Una riga in piu' costa meno. (Composta piu' sopra: serve gia' al
  // calcolo della finestra.)
  while (righe.length < altezza - 1 - legenda.length) righe.push('');
  // I tasti in arancione, come in ogni altra schermata.
  righe.push(`  ${grigio('─'.repeat(larghezza))}`);
  for (const riga of legenda) righe.push(`  ${coloraTasti(taglia(riga))}`);

  return righe.slice(0, altezza);
}

// Il cursore dopo una freccia, dentro i bordi dell'elenco.
//
// L'ultima posizione e' **oltre** l'ultimo prompt: e' il prompt nuovo, che c'e'
// sempre — come la nota nuova in fondo alle note. Spostare un prompt invece si
// ferma all'ultimo che esiste, perche' oltre non c'e' dove metterlo.
// stato: { prompt, indice }
// direzione: 'su' | 'giu' | altro (che non muove niente)
// oltre: se la posizione del prompt nuovo e' raggiungibile
// ritorna: il nuovo indice
function muoviIndice(stato, direzione, oltre = true) {
  const ultimo = Math.max(0, stato.prompt.length - (oltre ? 0 : 1));
  if (direzione === 'su') return Math.max(0, stato.indice - 1);
  if (direzione === 'giu') return Math.min(ultimo, stato.indice + 1);
  return Math.min(ultimo, stato.indice);
}

// Mostra la coda e la lascia modificare, finche' non si esce con Esc.
//
// Come gli altri selettori si prende lo stdin e alla chiusura lo lascia com'era:
// e' il chiamante a rimetterlo come lo vuole (vedi wrapper.js).
//
// L'elenco si rilegge dal disco a ogni tasto e non si tiene in memoria: mentre
// la schermata e' aperta Claude sta lavorando, e a fine turno l'hook toglie il
// primo prompt. Tenendo l'elenco in memoria, il primo carattere digitato dopo
// quella consegna lo avrebbe rimesso in coda.
// sessione: id della sessione a cui la coda appartiene
// ritorna: Promise<'indietro' | 'esci'> — dove deve andare chi ci ha chiamato:
//          Esc risale di un passo, Canc esce dall'interfaccia e torna a Claude
export function apriCoda({ sessione, ingresso = process.stdin, uscita = process.stdout } = {}) {
  const prompt = leggiCoda(sessione);
  // Si parte dal prompt nuovo, in fondo: la schermata si apre per scrivere.
  // Per rileggere o correggere quello che c'e' gia' basta una freccia.
  const stato = { prompt, indice: prompt.length, testo: '', cursore: 0 };
  // La bozza del prompt nuovo vive qui mentre il cursore e' altrove: **non** si
  // accoda passando su un altro prompt. Accodare a meta' scrittura vorrebbe dire
  // vederla partire da sola al turno dopo, per una freccia premuta.
  let bozzaNuova = { testo: '', cursore: 0 };

  // Qui le istruzioni stanno su F1 e non su "i": accanto a un campo di testo la
  // i e' una lettera del prompt che stai scrivendo.
  const istruzioni = sovrapposizioneIstruzioni(T.istruzioni.coda);

  return new Promise((risolvi) => {
    const dimensioni = () => ({ colonne: uscita.columns || 100, altezza: uscita.rows || 30 });
    const ridisegna = () => {
      if (istruzioni.aperta) {
        uscita.write(`\x1b[H\x1b[2J${istruzioni.disegna(dimensioni()).join('\r\n')}`);
        return;
      }
      // La coda si rilegge dal disco, ma **non** il testo che stai scrivendo:
      // l'hook puo' aver consegnato il primo prompt mentre eri qui dentro, e in
      // quel caso il cursore scala di uno insieme all'elenco.
      const primaN = stato.prompt.length;
      stato.prompt = leggiCoda(sessione);
      if (stato.prompt.length !== primaN) {
        stato.indice = Math.max(0, Math.min(stato.indice, stato.prompt.length));
      }
      // Anche i limiti si rileggono a ogni disegno, come la coda: la finestra
      // puo' resettarsi mentre la schermata e' aperta, e l'avviso deve sparire da
      // solo — un «riprendo alle 14:30» ancora li' alle 14:35 e' peggio di niente.
      const limiti = leggiLimiti();
      stato.pausaFino = limiteEsaurito(limiti) ? oraReset(limiti) : null;
      const righe = disegnaCoda(stato, dimensioni());
      uscita.write(`\x1b[H\x1b[2J${righe.join('\r\n')}`);
    };

    // Porta il cursore su un'altra voce, salvando quella che si lascia.
    //
    // Un prompt gia' in coda si salva subito, come una nota: e' modificato, e
    // tenerlo in memoria vorrebbe dire perderlo alla prossima freccia. Il prompt
    // nuovo invece **non** si accoda: resta una bozza finche' non premi invio.
    // indice: dove andare
    const vaiA = (indice) => {
      if (stato.indice >= stato.prompt.length) bozzaNuova = { testo: stato.testo, cursore: stato.cursore };
      else stato.prompt = sostituisci(sessione, stato.indice, stato.testo);

      stato.indice = Math.max(0, Math.min(indice, stato.prompt.length));
      if (stato.indice >= stato.prompt.length) {
        stato.testo = bozzaNuova.testo;
        stato.cursore = bozzaNuova.cursore;
        return;
      }
      // Il cursore in fondo al testo: si apre un prompt per continuarlo o
      // correggerne la coda, e da li' una freccia basta per tornare dentro.
      stato.testo = stato.prompt[stato.indice].testo;
      stato.cursore = [...stato.testo].length;
    };

    const chiudi = (dove) => {
      ingresso.removeListener('data', suDati);
      uscita.removeListener('resize', ridisegna);
      if (ingresso.isTTY) ingresso.setRawMode(false);
      ingresso.pause();
      uscita.write('\x1b[?25h\x1b[?1049l'); // cursore visibile, schermo normale
      risolvi(dove);
    };

    const suDati = (dati) => {
      const azioni = azioniCoda(dati);
      // Niente da fare, niente da ridisegnare: vedi cartelle.js — un ctrl premuto
      // da solo cancellava la selezione del testo che si stava per copiare.
      if (azioni.length === 0) return;
      // Con le istruzioni aperte i tasti sono loro: quello che stavi scrivendo
      // resta nel campo, e alla chiusura lo ritrovi.
      if (istruzioni.aperta) {
        if (istruzioni.tasti(azioni, dimensioni()) === 'esci') return chiudi('esci');
        return ridisegna();
      }
      for (const azione of azioni) {
        if (azione.tipo === 'annulla') return chiudi('indietro');
        if (azione.tipo === 'esci') return chiudi('esci');
        if (azione.tipo === 'istruzioni') {
          istruzioni.apri();
          return ridisegna();
        }
        // Quello che si scrive entra nel punto del cursore, non per forza in
        // fondo: le frecce ← → lo muovono, e senza inserire li' correggere una
        // lettera in mezzo a un prompt lungo vorrebbe dire cancellare tutto
        // quello che viene dopo.
        const scrivi = (aggiunta) => {
          const dopo = inserisci(stato.testo, stato.cursore, aggiunta);
          stato.testo = dopo.testo;
          stato.cursore = dopo.cursore;
        };

        if (azione.tipo === 'invio') {
          // Sul prompt nuovo invio accoda; su uno gia' in coda salva la modifica
          // e riporta in fondo, pronto a scriverne un altro — come l'invio delle
          // note, che salva la nota e apre la successiva.
          if (stato.indice >= stato.prompt.length) {
            stato.prompt = accoda(sessione, stato.testo);
            bozzaNuova = { testo: '', cursore: 0 };
            stato.indice = stato.prompt.length;
            stato.testo = '';
            stato.cursore = 0;
          } else {
            vaiA(stato.prompt.length);
          }
        } else if (azione.tipo === 'acapo') {
          // Shift+invio: il prompt continua sotto invece di partire.
          scrivi('\n');
        } else if (azione.tipo === 'cancella') {
          const dopo = cancella(stato.testo, stato.cursore);
          stato.testo = dopo.testo;
          stato.cursore = dopo.cursore;
        } else if (azione.tipo === 'togli') {
          // Sul prompt nuovo non c'e' niente da togliere dalla coda: si svuota
          // quello che stavi scrivendo, che e' la stessa cosa vista da qui.
          if (stato.indice >= stato.prompt.length) {
            stato.testo = '';
            stato.cursore = 0;
          } else {
            stato.prompt = togli(sessione, stato.indice);
            vaiA(Math.min(stato.indice, stato.prompt.length));
          }
        } else if (azione.tipo === 'commuta') {
          // Stop e salta valgono sul prompt nel riquadro. Sul nuovo non c'e'
          // niente da fermare: non e' ancora in coda.
          if (stato.indice < stato.prompt.length) {
            stato.prompt = commuta(sessione, stato.indice, azione.valore);
          }
        } else if (azione.tipo === 'carattere') {
          scrivi(azione.valore);
        } else if (azione.tipo === 'incolla') {
          // Un incolla e' testo, tutto insieme: gli a capo restano dentro al
          // prompt invece di accodarne uno per riga. Il pty lo consegna a Claude
          // a sua volta come incolla (vedi consegnaCoda), quindi arriva intero
          // anche dall'altra parte.
          scrivi(azione.valore);
        } else if (azione.tipo === 'sposta') {
          // Il cursore segue il prompt spostato, o dopo il primo scambio
          // starebbe su un altro e il secondo ctrl+↑ sposterebbe quello. Il
          // prompt nuovo non si sposta: non e' ancora in coda.
          if (stato.indice < stato.prompt.length) {
            // Le modifiche si salvano prima dello scambio, o si riscriverebbero
            // sulla posizione dove il prompt non e' piu'.
            stato.prompt = sostituisci(sessione, stato.indice, stato.testo);
            stato.prompt = sposta(sessione, stato.indice, azione.valore);
            stato.indice = muoviIndice(stato, azione.valore, false);
          }
        } else if (azione.tipo === 'freccia') {
          // Su e giu' scelgono la voce, destra e sinistra muovono il cursore
          // dentro al testo: sono due cose diverse e stanno su tasti diversi,
          // senza modificatori da ricordare.
          if (azione.valore === 'sinistra' || azione.valore === 'destra') {
            stato.cursore = muovi(stato.testo, stato.cursore, azione.valore);
          } else vaiA(muoviIndice(stato, azione.valore));
        }
      }
      ridisegna();
    };

    uscita.write('\x1b[?1049h\x1b[?25l'); // schermo alternativo, cursore nascosto
    if (ingresso.isTTY) ingresso.setRawMode(true);
    ingresso.resume();
    ingresso.on('data', suDati);
    uscita.on('resize', ridisegna);
    ridisegna();
  });
}

// Prova della schermata senza avviare Claude: `node src/coda.js [sessione]`.
// Come anteprima.js: si guarda l'interfaccia vera, e i prompt finiscono in una
// coda di prova invece che in quella di una sessione reale.
if (process.argv[1] && process.argv[1].endsWith('coda.js')) {
  process.env.CB_CODA = process.env.CB_CODA || path.join(os.tmpdir(), 'cb-coda-prova');
  await apriCoda({ sessione: process.argv[2] ?? 'prova' });
}
