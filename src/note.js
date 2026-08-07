// Le note della cartella di lavoro: quello che vuoi ricordarti su un progetto,
// non su una conversazione.
//
// Sono legate alla **cartella**, non alla sessione: e' la differenza con la coda
// dei prompt (src/coda.js), e non e' un dettaglio di implementazione. Una nota
// serve proprio quando la conversazione in cui l'hai scritta e' finita — un
// /clear, un cambio ramo, una finestra chiusa — e la ritrovi in ogni sessione
// aperta li' dentro. La chiave e' lo slug della cartella, lo stesso che usa
// Claude per i suoi transcript (`slugProgetto`), cosi' il file si riconosce a
// occhio guardando l'archivio.
//
// Una nota e' un titolo facoltativo e un corpo su piu' righe. Titolo facoltativo
// perche' la maggior parte delle note e' una riga sola e darle un titolo sarebbe
// scriverla due volte.
//
// I tre invii fanno tre cose (vedi `azioniNote` in src/tasti.js): invio salva e
// apre la prossima, shift+invio va a capo dentro il corpo, ctrl+invio manda la
// nota a Claude come prompt. Sono tutte azioni frequenti, ed e' il motivo per cui
// l'invio semplice tocca a quella che si fa piu' spesso: salvare.
//
// Come la coda, ogni operazione rilegge il file prima di scriverlo: due finestre
// aperte sulla stessa cartella vedono le stesse note, e tenerle in memoria
// significherebbe che l'ultima a scrivere cancella il lavoro dell'altra.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { azioniNote } from './tasti.js';
import { slugProgetto } from './percorsi.js';
import { T } from './lingua.js';
import { BOX, lunghezzaVisibile, primaCheEntra, aCapo, coloraTasti } from './vista.js';
import { arancione, arancioneForte, bianco, grigio, normale } from './stile.js';

// Cartella delle note, accanto alle altre cose di cb. La variabile CB_NOTE ha la
// precedenza: serve alle prove, che non devono scrivere sulle note vere.
// ritorna: percorso della cartella
export function cartellaNote() {
  return process.env.CB_NOTE || path.join(os.homedir(), '.claude', 'cb', 'note');
}

// File delle note di una cartella di lavoro.
// cartella: percorso assoluto della cartella di lavoro
// ritorna: percorso del .json
export function percorsoNote(cartella) {
  return path.join(cartellaNote(), `${slugProgetto(cartella)}.json`);
}

// Normalizza una nota letta dal disco.
//
// **Il corpo e' obbligatorio, il titolo no**: un titolo da solo e' un'etichetta
// senza niente sotto, e in elenco sarebbe una riga che non dice nulla. La regola
// sta qui e non nella schermata perche' valga su ogni strada — quello che si
// scrive, quello che si legge dal disco, quello che si manda a Claude.
// voce: quello che c'e' nel file, che potrebbe essere qualsiasi cosa
// ritorna: { titolo, corpo } | null se non e' una nota
function normalizza(voce) {
  if (typeof voce === 'string') return voce ? { titolo: '', corpo: voce } : null;
  if (!voce || typeof voce !== 'object') return null;
  const titolo = typeof voce.titolo === 'string' ? voce.titolo : '';
  const corpo = typeof voce.corpo === 'string' ? voce.corpo : '';
  return corpo ? { titolo, corpo } : null;
}

// Vero se la bozza ha un titolo ma non il corpo, cioe' non e' salvabile.
//
// Finche' e' cosi' l'invio e le frecce non fanno niente: salvarla non si puo', e
// lasciarla andare vorrebbe dire buttare il titolo appena scritto senza dirlo. Con
// tutt'e due i campi vuoti invece si passa: e' la bozza che non e' mai cominciata,
// e su una nota che esiste e' il modo di cancellarla.
// stato: stato della schermata
// ritorna: true se manca il corpo a fronte di un titolo
function senzaCorpo(stato) {
  return stato.bozza.titolo.trim() !== '' && stato.bozza.corpo.trim() === '';
}

// Le posizioni delle note da mostrare, in ordine.
//
// Cercando si filtra su titolo **e** corpo: il titolo e' come chiami la nota e il
// corpo e' cosa dice, e non si sa in quale dei due sta la parola che ti e' venuta
// in mente. Gli indici restano quelli dell'elenco vero, non della lista filtrata:
// e' con quelli che si salva, e rinumerarli vorrebbe dire scrivere sulla nota
// sbagliata appena il filtro cambia.
// stato: stato della schermata
// ritorna: array di indici dentro stato.note
export function indiciVisibili(stato) {
  const cerca = (stato.ricerca ?? '').trim().toLowerCase();
  const tutti = stato.note.map((_, i) => i);
  if (!cerca) return tutti;
  return tutti.filter((i) =>
    `${stato.note[i].titolo}\n${stato.note[i].corpo}`.toLowerCase().includes(cerca),
  );
}

// Le note di una cartella, nell'ordine in cui sono state scritte.
// Un file assente o illeggibile vale come nessuna nota: le note sono una
// comodita', e non devono poter impedire niente.
// cartella: cartella di lavoro
// ritorna: array di { titolo, corpo }
export function leggiNote(cartella) {
  if (!cartella) return [];
  try {
    const dati = JSON.parse(fs.readFileSync(percorsoNote(cartella), 'utf8'));
    if (!Array.isArray(dati?.note)) return [];
    return dati.note.map(normalizza).filter(Boolean);
  } catch {
    return [];
  }
}

// Scrive le note, creando la cartella se manca. Nessuna nota = nessun file,
// invece di un file vuoto che resta li' come avanzo.
// cartella: cartella di lavoro
// note: array di { titolo, corpo }
export function scriviNote(cartella, note) {
  if (!cartella) return;
  const percorso = percorsoNote(cartella);
  const pulite = note.map(normalizza).filter(Boolean);
  if (pulite.length === 0) {
    try {
      fs.unlinkSync(percorso);
    } catch {
      // gia' assente: e' lo stato che volevamo
    }
    return;
  }
  fs.mkdirSync(path.dirname(percorso), { recursive: true });
  fs.writeFileSync(percorso, `${JSON.stringify({ note: pulite }, null, 2)}\n`, 'utf8');
}

// Salva una nota, alla posizione data o in fondo.
//
// Una nota svuotata **sparisce**: e' cosi' che si cancella, senza un tasto in
// piu' da imparare. Vale anche per quella nuova, dove invio a vuoto non deve
// lasciare una nota vuota in elenco.
// cartella: cartella di lavoro
// indice: posizione da sostituire, o un indice fuori elenco per aggiungere
// nota: { titolo, corpo }
// ritorna: le note aggiornate
export function salvaNota(cartella, indice, nota) {
  const note = leggiNote(cartella);
  const pulita = normalizza({ titolo: nota.titolo.trim(), corpo: nota.corpo.trim() });
  const dentro = indice >= 0 && indice < note.length;

  if (!pulita) {
    if (!dentro) return note; // nota nuova lasciata vuota: non se ne fa niente
    note.splice(indice, 1); // svuotata: e' il modo di cancellarla
  } else if (dentro) {
    note[indice] = pulita;
  } else {
    note.push(pulita);
  }

  scriviNote(cartella, note);
  return note;
}

// La nota come la si manda a Claude: `titolo: corpo`.
//
// I due punti e non una riga vuota: il titolo di una nota e' corto — «Porte»,
// «Deploy» — e messo cosi' fa da etichetta alla richiesta invece di sembrare una
// prima frase a se'. Senza titolo resta il corpo e basta, che e' il caso normale.
//
// Il testo finisce nella barra **non inviato**, quindi qualunque cosa esca da qui
// e' correggibile prima di partire.
// nota: { titolo, corpo }
// ritorna: testo del prompt, vuoto se la nota non ha un corpo
export function testoDaMandare(nota) {
  const titolo = nota.titolo.trim();
  const corpo = nota.corpo.trim();
  if (!corpo) return '';
  return titolo ? `${titolo}: ${corpo}` : corpo;
}

// Marchio delle note segnate per la cancellazione.
const SEGNO = '✗';

// Il corpo di una nota spezzato in righe da mostrare.
// Si divide **prima** sugli a capo che l'utente ha messo con shift+invio e solo
// dopo si manda a capo ogni pezzo: passando il corpo intero ad `aCapo` i suoi a
// capo si perderebbero, e due paragrafi diventerebbero un blocco solo.
// corpo: testo della nota
// larghezza: colonne disponibili
// ritorna: array di righe
function righeDelCorpo(corpo, larghezza) {
  return corpo.split('\n').flatMap((pezzo) => (pezzo ? aCapo(pezzo, larghezza) : ['']));
}

// Compone la schermata intera.
// Funzione pura come `disegna` in cartelle.js e `disegnaCoda`: si guarda senza
// terminale e si prova senza premere tasti.
// stato: { note, indice, bozza: { titolo, corpo }, campo: 'titolo'|'corpo', cartella }
// ritorna: array di righe pronte da scrivere
export function disegnaNote(stato, { colonne = 100, altezza = 30 } = {}) {
  const larghezza = Math.max(20, colonne - 4);
  const taglia = (testo) => (testo.length > larghezza ? testo.slice(0, larghezza) : testo);
  // Il riquadro sta dentro il rientro di due colonne, con un respiro per parte.
  const larghezzaBox = Math.max(10, larghezza);
  const dentroBox = Math.max(6, larghezzaBox - 4);

  // Una riga dentro il riquadro: il contenuto arriva gia' colorato, quindi il
  // riempimento fino al bordo si misura sulle colonne visibili.
  const rigaBox = (contenuto) => {
    const vuoto = ' '.repeat(Math.max(0, dentroBox - lunghezzaVisibile(contenuto)));
    return `  ${arancione(BOX.lato)} ${contenuto}${vuoto} ${arancione(BOX.lato)}`;
  };

  // L'indice oltre l'ultima nota e' la nota nuova: non e' un caso a parte da
  // gestire, e' la posizione in cui si sta sempre appena aperta la schermata.
  const nuova = stato.indice >= stato.note.length;
  // Cercando, i tasti vanno nella ricerca e non nella nota: la stringa vuota e'
  // «ricerca aperta senza niente scritto», che non e' come non cercare.
  const cercando = stato.ricerca !== null && stato.ricerca !== undefined;

  // Ogni nota e' separata dalla successiva da una riga: quella su cui si scrive
  // sta in un riquadro arancione, come il prompt scelto nell'albero e come la
  // barra di stato di Claude Code.
  const elenco = [];
  let fineBox = 0; // ultima riga del riquadro, per tenerlo dentro lo schermo
  const visibili = indiciVisibili(stato);
  // Il separatore sta **sopra ogni** nota, compresa la prima: e' quello che apre
  // l'elenco. Solo fra una nota e l'altra, la prima sembrerebbe attaccata al
  // conto qui sopra invece di essere il primo elemento di una serie.
  for (const i of visibili) {
    const nota = stato.note[i];
    elenco.push(`  ${grigio('─'.repeat(larghezzaBox))}`);
    if (i === stato.indice) {
      elenco.push(...riquadro(stato.bozza, stato.campo));
      fineBox = elenco.length - 1;
    } else {
      // Una nota segnata porta un marchio davanti alla prima riga: e' l'unica
      // cosa che dice quali sparirebbero premendo ctrl+canc, e va vista a colpo
      // d'occhio prima di premere.
      // Il marchio sta **dentro** il rientro di quattro colonne, non prima: cosi'
      // segnare non sposta il testo di lato e le note restano incolonnate.
      const marchio = stato.segnate.has(i) ? `  ${arancioneForte(SEGNO)} ` : '    ';
      const testa = nota.titolo ? normale(taglia(nota.titolo)) : null;
      const corpo = righeDelCorpo(nota.corpo, larghezza - 4);
      if (testa) elenco.push(`${marchio}${testa}`);
      corpo.forEach((riga, r) => {
        elenco.push(`${testa || r > 0 ? '    ' : marchio}${grigio(riga)}`);
      });
    }
  }

  if (cercando && visibili.length === 0) {
    elenco.push(`  ${grigio('─'.repeat(larghezzaBox))}`, `    ${grigio(T.note.nessunaCorrispondenza)}`);
  }

  // Cercando, la nota nuova non c'entra: si sta guardando quello che c'e' gia'.
  if (!cercando) {
    elenco.push(`  ${grigio('─'.repeat(larghezzaBox))}`);
    if (nuova) {
      elenco.push(...riquadro(stato.bozza, stato.campo));
      fineBox = elenco.length - 1;
    } else {
      // Con il cursore su una nota di prima, il posto della nota nuova resta
      // annunciato in fondo: e' cosi' che si sa che scendendo si torna a
      // scrivere, invece di credere che l'elenco finisca con l'ultima nota.
      elenco.push(`    ${grigio(T.note.nuova)}`);
    }
  }

  // Lo scorrimento si ancora al **riquadro**, non all'inizio dell'elenco: con
  // qualche nota in archivio quella su cui si scrive finirebbe sotto il bordo
  // dello schermo, e si scriverebbe alla cieca. La finestra tiene l'ultima riga
  // del riquadro come ultima riga visibile.
  //
  // Quante righe restano fuori si dice, ma **nell'intestazione**: un avviso messo
  // dentro la finestra si mangerebbe una riga del riquadro, cioe' proprio quella
  // che si voleva tenere.
  const TESTATA = 5; // le due righe di titolo, una vuota, il conto, una vuota
  const spazio = Math.max(1, altezza - 2 - TESTATA);
  const da = Math.max(0, fineBox - spazio + 1);
  const fuori = da + Math.max(0, elenco.length - (da + spazio));

  // Cercando, al posto del conto delle note c'e' il campo di ricerca con quante
  // ne ha trovate: e' la stessa riga perche' dice la stessa cosa — quante note
  // hai davanti — e spostarla farebbe saltare tutto il disegno sotto.
  // Quante ne sono segnate si dice accanto al conto: e' il numero che ctrl+canc
  // toglierebbe, e va saputo anche quando quelle segnate sono scorse via.
  const segnate = stato.segnate.size > 0 ? `  ${arancioneForte(T.note.quanteSegnate(stato.segnate.size))}` : '';
  const conto = cercando
    ? `${arancione(T.note.cerca)}${bianco(stato.ricerca)}${arancioneForte('█')}  ${grigio(T.note.quanteTrovate(visibili.length))}${segnate}`
    : `${normale(taglia(stato.note.length === 0 ? T.note.vuota : T.note.quante(stato.note.length)))}${segnate}${
        fuori > 0 ? `  ${grigio(T.note.fuoriSchermo(fuori))}` : ''
      }`;

  const righe = [
    `  ${arancioneForte('cb')}  ${normale(taglia(T.note.titolo))}`,
    `  ${grigio(taglia(T.note.sottotitolo(stato.cartella ?? '')))}`,
    '',
    `  ${conto}`,
    '',
    ...elenco.slice(da, da + spazio),
  ];

  // Il riquadro attorno alla nota che si sta scrivendo, con il cursore nel campo
  // attivo: e' l'unico segnale di dove stanno finendo i tasti.
  // bozza: { titolo, corpo }
  // campo: quale dei due ha il cursore
  // ritorna: array di righe
  function riquadro(bozza, campo) {
    const cursore = arancioneForte('█');

    // Un campo vuoto porta il proprio nome in grigio, **anche** quando ha il
    // cursore: e' li' che serve — appena aperta la schermata non c'e' nient'altro
    // a dire che si sta scrivendo un titolo e non il testo della nota.
    const vuoto = (attivo, nome) => `${attivo ? cursore : ''}${grigio(nome)}`;

    const titolo = bozza.titolo
      ? `${bianco(bozza.titolo)}${campo === 'titolo' ? cursore : ''}`
      : vuoto(campo === 'titolo', T.note.titoloNota);

    const righeCorpo = bozza.corpo
      ? righeDelCorpo(bozza.corpo, dentroBox).map((riga) => bianco(riga))
      : [vuoto(campo === 'corpo', T.note.corpo)];
    if (bozza.corpo && campo === 'corpo') righeCorpo[righeCorpo.length - 1] += cursore;

    const dentro = [titolo, '', ...righeCorpo];

    return [
      `  ${arancione(`${BOX.alto}${'─'.repeat(Math.max(0, larghezzaBox - 2))}${BOX.altoDestra}`)}`,
      ...dentro.map((riga) => rigaBox(riga)),
      `  ${arancione(`${BOX.basso}${'─'.repeat(Math.max(0, larghezzaBox - 2))}${BOX.bassoDestra}`)}`,
    ];
  }

  // La legenda in fondo allo schermo, come in ogni altra schermata: l'elenco
  // cresce a ogni nota, e una legenda che scende si legge peggio.
  const legenda = primaCheEntra(cercando ? T.note.legendeRicerca : T.note.legende, larghezza);
  const corpo = righe.slice(0, Math.max(0, altezza - 2));
  while (corpo.length < altezza - 2) corpo.push('');
  // I tasti in arancione, come in ogni altra schermata: e' quello che si cerca
  // con l'occhio quando si vuole solo sapere che cosa premere.
  corpo.push(`  ${grigio('─'.repeat(larghezza))}`, `  ${coloraTasti(taglia(legenda))}`);
  return corpo;
}

// Applica un'azione allo stato delle note.
//
// Separata dal ciclo dei tasti perche' e' tutta la logica della schermata, e
// cosi' si prova senza terminale: quale campo ha il cursore, quando una nota si
// salva, cosa succede a un invio a vuoto.
// stato: { note, indice, bozza, campo, ricerca, cartella }
// azione: quella prodotta da azioniNote
// ritorna: 'indietro' | 'esci' | { manda } quando la schermata deve chiudersi,
//          altrimenti null
export function applicaAzione(stato, azione) {
  if (azione.tipo === 'esci') return 'esci';

  // Cercando la schermata e' un'altra: i tasti scrivono la ricerca, le frecce
  // passano fra le note trovate, e Esc chiude la ricerca invece di uscire — e'
  // il solito passo indietro, ma il passo qui e' questo.
  if (stato.ricerca !== null && stato.ricerca !== undefined) {
    if (azione.tipo === 'annulla' || azione.tipo === 'invio') return chiudiRicerca(stato);
    if (azione.tipo === 'cerca') return chiudiRicerca(stato);
    if (azione.tipo === 'carattere') {
      stato.ricerca += azione.valore;
      return vaiAllaPrimaTrovata(stato);
    }
    if (azione.tipo === 'cancella') {
      stato.ricerca = stato.ricerca.slice(0, -1);
      return vaiAllaPrimaTrovata(stato);
    }
    if (azione.tipo === 'freccia') {
      scorriTrovate(stato, azione.valore);
      return null;
    }
    // Mandare una nota trovata e' proprio il motivo per cui la si e' cercata.
    if (azione.tipo === 'manda') return mandaLaBozza(stato);
    // Segnare e cancellare valgono anche cercando: e' spesso il modo piu' rapido
    // di trovare quelle da buttare.
    if (azione.tipo === 'segna') return segna(stato);
    if (azione.tipo === 'togli') return togliSegnate(stato);
    return null;
  }

  if (azione.tipo === 'annulla') return 'indietro';

  // La ricerca si apre solo su una bozza salvabile, come le frecce: aprirla
  // sopra un titolo senza corpo lo butterebbe via.
  if (azione.tipo === 'cerca') {
    if (senzaCorpo(stato)) return null;
    stato.note = salvaEAllinea(stato);
    stato.ricerca = '';
    return vaiAllaPrimaTrovata(stato);
  }

  if (azione.tipo === 'manda') return mandaLaBozza(stato);
  if (azione.tipo === 'segna') return segna(stato);
  if (azione.tipo === 'togli') return togliSegnate(stato);

  if (azione.tipo === 'carattere') {
    stato.bozza[stato.campo] += azione.valore;
    return null;
  }

  if (azione.tipo === 'cancella') {
    stato.bozza[stato.campo] = stato.bozza[stato.campo].slice(0, -1);
    return null;
  }

  if (azione.tipo === 'acapo') {
    // A capo solo nel corpo: il titolo e' una riga per definizione, e shift+invio
    // li' vale come l'invio che porta al corpo.
    if (stato.campo === 'titolo') stato.campo = 'corpo';
    else stato.bozza.corpo += '\n';
    return null;
  }

  if (azione.tipo === 'invio') {
    if (stato.campo === 'titolo') {
      stato.campo = 'corpo';
      return null;
    }
    // Senza corpo non si salva: il titolo scritto resta li' ad aspettarlo, invece
    // di sparire per un invio battuto un momento troppo presto.
    if (senzaCorpo(stato)) return null;
    // Dal corpo l'invio salva e apre la nota nuova, cosi' si scrive di seguito
    // senza toccare altro.
    stato.note = salvaEAllinea(stato);
    apriNuova(stato);
    return null;
  }

  if (azione.tipo === 'freccia') {
    if (azione.valore !== 'su' && azione.valore !== 'giu') return null;
    if (senzaCorpo(stato)) return null; // non salvabile: non la si lascia indietro
    // Spostandosi si salva quello che si stava scrivendo: perderlo per una
    // freccia sarebbe la cosa piu' sgradevole che questa schermata puo' fare.
    const note = salvaEAllinea(stato);
    // La nota puo' essere sparita (svuotata) o essere nata adesso: l'indice si
    // ricalcola sull'elenco vero, non su quello di prima.
    const spostato = stato.indice + (azione.valore === 'su' ? -1 : 1);
    stato.note = note;
    vaiA(stato, Math.max(0, Math.min(note.length, spostato)));
    return null;
  }

  return null;
}

// Manda la bozza a Claude come prompt, e la toglie dalle note.
//
// Mandata, la nota ha fatto il suo lavoro: era un promemoria di qualcosa da
// chiedere, e adesso lo stai chiedendo. Lasciarla in elenco vorrebbe dire
// ritrovarsela domani senza sapere se e' ancora da fare, e cancellarla a mano
// sarebbe un secondo gesto per una cosa gia' decisa.
//
// Non e' una perdita: il testo diventa un prompt vero e quindi un nodo
// dell'albero, cioe' resta nella conversazione — che e' il posto dove serve
// ritrovarlo, insieme alla risposta.
// stato: stato della schermata
// ritorna: { manda } se c'e' qualcosa da mandare, altrimenti null
function mandaLaBozza(stato) {
  const testo = testoDaMandare(stato.bozza);
  if (!testo) return null; // niente da mandare: il tasto non e' un errore
  // Svuotare una nota e' il modo di cancellarla, e vale anche qui: su una nota
  // nuova (indice fuori elenco) non toglie niente, che e' giusto.
  const prima = stato.note.length;
  stato.note = salvaNota(stato.cartella, stato.indice, { titolo: '', corpo: '' });
  if (stato.note.length !== prima) stato.segnate.clear(); // gli indici sono scalati
  return { manda: testo };
}

// Salva la bozza e tiene allineate le note segnate.
//
// Le segnate sono indici, e un salvataggio puo' spostarli: svuotando una nota
// questa sparisce e tutte quelle dopo scalano di uno, quindi i segni resterebbero
// su note diverse da quelle scelte — e ctrl+canc ne cancellerebbe di sbagliate.
// Quando il numero di note cambia i segni si azzerano: e' l'unica cosa
// sicuramente giusta, e chi stava segnando se ne accorge subito.
// stato: stato della schermata
// ritorna: le note aggiornate
function salvaEAllinea(stato) {
  const prima = stato.note.length;
  const note = salvaNota(stato.cartella, stato.indice, stato.bozza);
  if (note.length !== prima) stato.segnate.clear();
  return note;
}

// Segna o desegna la nota su cui sta il cursore.
// La nota nuova non si segna: non esiste ancora, e cancellarla vorrebbe dire
// niente.
// stato: stato della schermata
// ritorna: null
function segna(stato) {
  if (stato.indice >= stato.note.length) return null;
  if (stato.segnate.has(stato.indice)) stato.segnate.delete(stato.indice);
  else stato.segnate.add(stato.indice);
  return null;
}

// Cancella le note segnate, o quella su cui sta il cursore se non ce n'e' nessuna.
//
// Il ripiego sulla nota corrente serve a non rendere obbligatorio segnare per
// cancellarne una sola. Segnare resta il modo di cancellarne piu' d'una, e nel
// farlo e' anche la conferma: le vedi marcate prima di premere.
//
// Si toglie **dall'indice piu' alto al piu' basso**, o togliendo la prima tutte
// le altre scalerebbero di uno e si cancellerebbe la nota sbagliata.
// stato: stato della schermata
// ritorna: null
function togliSegnate(stato) {
  const daTogliere = stato.segnate.size > 0 ? [...stato.segnate] : [stato.indice];
  const validi = daTogliere.filter((i) => i >= 0 && i < stato.note.length).sort((a, b) => b - a);
  if (validi.length === 0) return null;

  const note = leggiNote(stato.cartella);
  for (const i of validi) note.splice(i, 1);
  scriviNote(stato.cartella, note);

  stato.note = leggiNote(stato.cartella);
  stato.segnate.clear();
  // Il cursore va dove stava, o in fondo se quello che c'era non c'e' piu'.
  vaiA(stato, Math.min(validi[validi.length - 1], stato.note.length));
  return null;
}

// Chiude la ricerca lasciando il cursore dove e' arrivato.
// Il filtro sparisce ma la nota trovata resta selezionata e modificabile: e' il
// senso di aver cercato, e tornare in cima vanificherebbe la ricerca.
// stato: stato della schermata
// ritorna: null, che vuol dire «la schermata resta aperta»
function chiudiRicerca(stato) {
  stato.ricerca = null;
  return null;
}

// Porta il cursore sulla prima nota che corrisponde alla ricerca.
// Serve a ogni carattere digitato: il filtro cambia, e il cursore potrebbe essere
// rimasto su una nota che non compare piu'.
// stato: stato della schermata
// ritorna: null
function vaiAllaPrimaTrovata(stato) {
  const visibili = indiciVisibili(stato);
  if (visibili.length === 0) return null; // niente da selezionare: il filtro non trova
  if (!visibili.includes(stato.indice)) vaiA(stato, visibili[0]);
  return null;
}

// Passa alla nota trovata precedente o successiva.
// Si scorre fra le trovate e non fra tutte: cercando, le altre non ci sono.
// stato: stato della schermata
// direzione: 'su' | 'giu'
function scorriTrovate(stato, direzione) {
  if (direzione !== 'su' && direzione !== 'giu') return;
  const visibili = indiciVisibili(stato);
  if (visibili.length === 0) return;
  const dove = visibili.indexOf(stato.indice);
  const passo = direzione === 'su' ? -1 : 1;
  const prossimo = Math.max(0, Math.min(visibili.length - 1, (dove < 0 ? 0 : dove) + passo));
  vaiA(stato, visibili[prossimo]);
}

// Porta il cursore su una nota, caricandola nella bozza.
// L'indice pari al numero di note e' la nota nuova, che e' una posizione valida.
// stato: stato della schermata
// indice: dove andare
function vaiA(stato, indice) {
  stato.indice = indice;
  if (indice >= stato.note.length) return apriNuova(stato);
  const nota = stato.note[indice];
  stato.bozza = { titolo: nota.titolo, corpo: nota.corpo };
  // Il cursore parte **sempre** dal titolo, anche su una nota che ha gia' tutto.
  // Non perche' sia il campo che si modifica piu' spesso, ma perche' e' l'unico
  // dei due da cui si puo' raggiungere l'altro: dal titolo si scende al corpo con
  // un invio, dal corpo non si risale — invio li' salva. Partendo dal corpo, il
  // titolo di una nota vecchia diventerebbe impossibile da correggere.
  stato.campo = 'titolo';
}

// Prepara la nota nuova in fondo all'elenco.
// stato: stato della schermata
function apriNuova(stato) {
  stato.indice = stato.note.length;
  stato.bozza = { titolo: '', corpo: '' };
  stato.campo = 'titolo';
}

// Lo stato iniziale: le note della cartella, e il cursore sulla nota nuova.
// Si parte dalla nota nuova e non dalla prima perche' la schermata si apre per
// scrivere; per rileggere basta una freccia.
// cartella: cartella di lavoro
// ritorna: lo stato
export function statoIniziale(cartella) {
  const stato = {
    note: leggiNote(cartella),
    indice: 0,
    bozza: null,
    campo: 'titolo',
    // `null` = non si sta cercando. La stringa vuota vuol dire «ricerca aperta,
    // ancora senza niente scritto», che e' un altro stato: li' i tasti vanno
    // nella ricerca, non nella nota.
    ricerca: null,
    // Indici delle note segnate per la cancellazione. Un Set e non un campo sulla
    // nota: e' una scelta della schermata aperta adesso, non qualcosa da salvare.
    segnate: new Set(),
    cartella,
  };
  apriNuova(stato);
  return stato;
}

// Mostra le note e le lascia modificare, finche' non si esce.
//
// Come gli altri selettori si prende lo stdin e alla chiusura lo lascia com'era:
// e' il chiamante a rimetterlo come lo vuole (vedi wrapper.js).
// cartella: cartella di lavoro di cui mostrare le note
// ritorna: Promise<'indietro' | 'esci' | { manda }> — Esc risale di un passo,
//          Canc esce dall'interfaccia, ctrl+invio consegna una nota da mandare
export function apriNote({
  cartella,
  ingresso = process.stdin,
  uscita = process.stdout,
} = {}) {
  const stato = statoIniziale(cartella);

  return new Promise((risolvi) => {
    const ridisegna = () => {
      const righe = disegnaNote(stato, {
        colonne: uscita.columns || 100,
        altezza: uscita.rows || 30,
      });
      uscita.write(`\x1b[H\x1b[2J${righe.join('\r\n')}`);
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
      const azioni = azioniNote(dati);
      // Niente da fare, niente da ridisegnare: ogni ridisegno cancella la
      // selezione del testo fatta col mouse (vedi cartelle.js).
      if (azioni.length === 0) return;
      for (const azione of azioni) {
        const esito = applicaAzione(stato, azione);
        if (esito !== null) return chiudi(esito);
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

// Prova della schermata senza avviare Claude: `node src/note.js [cartella]`.
// Come anteprima.js: si guarda l'interfaccia vera, e le note finiscono in un
// archivio di prova invece che in quello della cartella.
if (process.argv[1] && process.argv[1].endsWith('note.js')) {
  process.env.CB_NOTE = process.env.CB_NOTE || path.join(os.tmpdir(), 'cb-note-prova');
  const esito = await apriNote({ cartella: process.argv[2] ?? process.cwd() });
  console.log(typeof esito === 'string' ? esito : `da mandare: ${esito.manda}`);
}
