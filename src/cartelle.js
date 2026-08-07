// Selettore della cartella di lavoro: l'albero delle cartelle sotto la home,
// navigabile con le frecce, da cui si sceglie dove far partire Claude.
//
// Prima stava nel profilo PowerShell (`Select-RepoFolder`), che apriva il
// navigatore e poi lanciava cb nella cartella scelta. Portarlo qui dentro toglie
// al profilo la parte interattiva e lascia a cb tutto quello che si vede a
// schermo: stessa tavolozza dell'albero dei rami, stessi tasti, una sola cosa da
// mantenere.
//
// La cartella non si puo' restituire al chiamante cambiando la propria: un
// processo figlio non tocca la cwd del padre. Chi vuole che la shell resti nella
// cartella scelta imposta CB_CARTELLA_SCELTA a un file e lo legge dopo l'uscita
// (vedi annotaCartellaScelta).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { azioniNavigazione } from './tasti.js';
import { arancione, arancioneForte, grigio, normale } from './stile.js';
import { impostazione } from './impostazioni.js';
import { leggiProfili, elencoProfili } from './profili.js';
import { T } from './lingua.js';

// Caratteri dell'albero: gli stessi giunti del disegno dei rami.
const GIUNZIONE = '├';
const ANGOLO = '└';
const ORIZZONTALE = '─';
const VERTICALE = '│';

const EM_CARTELLA = '📁';
const EM_FILE = '📄';

// Righe fisse della pagina: due di intestazione, una vuota, una di legenda.
const RIGHE_FISSE = 4;

// Legende in ordine di lunghezza: nessuna riga puo' eccedere la larghezza del
// terminale, o il capo automatico sfaserebbe il disegno sotto.
const LEGENDE = T.cartelle.legende;

// Cartella dei progetti, mostrata come unico figlio della home.
// Configurabile perche' il percorso e' una scelta personale: senza CB_RADICE si
// prova ~/Documents/REPOSITORY e, se non c'e', si mostra la home per intero.
// ritorna: percorso della radice
export function radicePredefinita() {
  const candidato = path.join(os.homedir(), 'Documents', 'REPOSITORY');
  const ripiego = fs.existsSync(candidato) ? candidato : os.homedir();
  // CB_RADICE prima, poi la cartella scelta nelle impostazioni, poi il ripiego.
  return impostazione('radice', ripiego);
}

// Figli di una cartella nell'albero.
// La home fa eccezione: mostra solo la radice dei progetti (piu' la cartella
// corrente, se sta fuori), altrimenti l'elenco sarebbe illeggibile.
// percorso: cartella di cui elencare il contenuto
// contesto: { home, radice, extra } — extra e' la cwd fuori dalla radice, o null
// ritorna: array di { percorso, cartella }, cartelle prima dei file, per nome
export function figli(percorso, { home, radice, extra = null }) {
  if (percorso === home && radice !== home) {
    const lista = [{ percorso: radice, cartella: true }];
    if (extra) lista.push({ percorso: extra, cartella: true });
    return lista;
  }

  let voci;
  try {
    voci = fs.readdirSync(percorso, { withFileTypes: true });
  } catch {
    return []; // cartella illeggibile: si comporta come vuota
  }

  return voci
    .filter((voce) => !voce.name.startsWith('.'))
    .map((voce) => ({ percorso: path.join(percorso, voce.name), cartella: voce.isDirectory() }))
    .sort((a, b) => {
      if (a.cartella !== b.cartella) return a.cartella ? -1 : 1;
      return path.basename(a.percorso).localeCompare(path.basename(b.percorso));
    });
}

// Costruisce le righe visibili dell'albero, con i connettori dei rami.
// contesto: { home, radice, extra, espansi } — espansi e' un Set di percorsi
// ritorna: array di { percorso, etichetta, cartella, haFigli, livello }
export function componiRighe(contesto) {
  const righe = [];

  // Scende ricorsivamente in una voce dell'albero.
  // prefisso: colonne dei livelli superiori; ultimo: e' l'ultimo fratello
  const scendi = (percorso, cartella, prefisso, ultimo, livello) => {
    const connettore =
      livello === 0 ? '' : `${prefisso}${ultimo ? ANGOLO : GIUNZIONE}${ORIZZONTALE} `;
    const bambini = cartella ? figli(percorso, contesto) : [];
    const espansa = contesto.espansi.has(percorso);

    righe.push({
      percorso,
      etichetta: `${connettore}${cartella ? EM_CARTELLA : EM_FILE} ${path.basename(percorso)}`,
      cartella,
      haFigli: bambini.length > 0,
      livello,
    });

    if (!espansa || bambini.length === 0) return;
    // Colonna dei figli: la barra verticale se il ramo continua, spazi se e' finito.
    const prefissoFigli = livello === 0 ? '' : `${prefisso}${ultimo ? '   ' : `${VERTICALE}  `}`;
    bambini.forEach((figlio, i) =>
      scendi(figlio.percorso, figlio.cartella, prefissoFigli, i === bambini.length - 1, livello + 1),
    );
  };

  scendi(contesto.home, true, '', true, 0);
  return righe;
}

// Taglia un testo alla larghezza data, senza guardare a colori: qui le stringhe
// sono ancora nude, il colore si applica dopo.
const taglia = (testo, larghezza) =>
  testo.length > larghezza ? testo.slice(0, Math.max(0, larghezza - 1)) : testo;

// Compone la pagina del selettore.
// Funzione pura: prende lo stato e restituisce il testo da scrivere, cosi' le
// prove possono verificare finestra e selezione senza un terminale.
// stato: { righe, indice, ripresa, profili, profilo }
//   profili: nomi configurati, con null in testa per l'ambiente di partenza.
//     Vuoto (o assente) = nessuno: della riga del profilo non si parla, e `m`
//     non ha niente da alternare.
//   profilo: quello scelto, o null per l'ambiente di partenza
// altezza/larghezza: dimensioni del terminale
// ritorna: stringa con la schermata intera
export function disegna(
  { righe, indice, ripresa, profili = [], profilo = null },
  altezza,
  larghezza,
) {
  // La riga del profilo esiste solo se ci sono profili: una riga in piu' toglie
  // una cartella all'elenco, e non si paga per una funzione che non si usa.
  const conProfili = profili.length > 1;
  const visibili = Math.max(1, altezza - RIGHE_FISSE - (conProfili ? 1 : 0));
  // Finestra centrata sulla selezione, ferma ai bordi dell'elenco.
  let inizio = Math.max(0, indice - Math.floor(visibili / 2));
  inizio = Math.min(inizio, Math.max(0, righe.length - visibili));

  const modo = ripresa ? T.cartelle.modoRipresa : T.cartelle.modoNormale;
  // Varianti della legenda dalla piu' distesa alla piu' stretta: si prende la
  // prima che ci sta. Tagliarla e basta perderebbe proprio l'ultimo tasto.
  const varianti = conProfili ? T.cartelle.legendeConProfilo : LEGENDE;
  const legenda =
    varianti.find((testo) => testo.length + 2 <= larghezza) ?? varianti[varianti.length - 1];

  const pagina = [
    arancioneForte(taglia(T.cartelle.titolo, larghezza)),
    arancione(taglia(`  ${modo}`, larghezza)),
  ];

  if (conProfili) {
    pagina.push(
      arancione(taglia(`  ${T.cartelle.conProfilo(profilo ?? T.albero.profiloBase)}`, larghezza)),
    );
  }
  pagina.push('');

  for (let i = inizio; i < Math.min(righe.length, inizio + visibili); i += 1) {
    const riga = righe[i];
    const testo = taglia(`  ${i === indice ? '▸' : ' '} ${riga.etichetta}`, larghezza);
    pagina.push(i === indice ? arancioneForte(testo) : normale(testo));
  }

  // La legenda va in fondo allo schermo, non subito sotto l'elenco: l'elenco
  // cambia altezza a ogni apertura, e la legenda che salta e' fastidiosa.
  while (pagina.length < altezza - 1) pagina.push('');
  pagina.push(grigio(taglia(`  ${legenda}`, larghezza)));

  return `\x1b[H\x1b[2J${pagina.join('\r\n')}`;
}

// Prepara lo stato iniziale: cosa e' gia' aperto e su cosa cade la selezione.
// Dentro la radice si pre-espande la catena fino alla cwd e la si seleziona;
// fuori, la cwd compare come voce in piu' sotto la home, per non perderla.
// opzioni: { home, radice, cwd }
// ritorna: { home, radice, extra, espansi, selezione }
export function statoIniziale({ home, radice, cwd }) {
  const espansi = new Set([home, radice]);
  let extra = null;
  let selezione = radice;

  if (cwd !== radice && cwd.startsWith(radice + path.sep)) {
    selezione = cwd;
    espansi.add(cwd);
    let genitore = path.dirname(cwd);
    while (genitore.length >= radice.length) {
      espansi.add(genitore);
      if (genitore === radice) break;
      const sopra = path.dirname(genitore);
      if (sopra === genitore) break; // radice del disco: non si sale oltre
      genitore = sopra;
    }
  } else if (cwd !== home && cwd !== radice) {
    extra = cwd;
    selezione = cwd;
    espansi.add(cwd);
  }

  return { home, radice, extra, espansi, selezione };
}

// Applica un'azione allo stato del selettore.
// Estratta dal ciclo interattivo perche' e' la parte con la logica: le prove la
// verificano senza terminale.
// stato: { contesto, righe, indice, ripresa }
// azione: una delle stringhe prodotte da azioniNavigazione
// ritorna: { esito } — 'continua' | 'conferma' | 'annulla'
export function applicaAzione(stato, azione) {
  const riga = stato.righe[stato.indice];
  const { espansi } = stato.contesto;

  // Ricalcola le righe e riporta la selezione sullo stesso percorso, che dopo
  // un'apertura o una chiusura si trova a un altro indice.
  const ricomponi = (percorso) => {
    stato.righe = componiRighe(stato.contesto);
    const nuovo = stato.righe.findIndex((r) => r.percorso === percorso);
    if (nuovo >= 0) stato.indice = nuovo;
    if (stato.indice >= stato.righe.length) stato.indice = stato.righe.length - 1;
  };

  switch (azione) {
    case 'su':
      stato.indice = (stato.indice - 1 + stato.righe.length) % stato.righe.length;
      break;
    case 'giu':
      stato.indice = (stato.indice + 1) % stato.righe.length;
      break;
    case 'apri':
      if (riga.haFigli) {
        if (espansi.has(riga.percorso)) espansi.delete(riga.percorso);
        else espansi.add(riga.percorso);
        ricomponi(riga.percorso);
      }
      break;
    case 'destra':
      if (riga.haFigli) {
        // Gia' aperta: la freccia destra entra, cioe' va al primo figlio.
        if (espansi.has(riga.percorso)) stato.indice = (stato.indice + 1) % stato.righe.length;
        else {
          espansi.add(riga.percorso);
          ricomponi(riga.percorso);
        }
      }
      break;
    case 'sinistra':
      if (espansi.has(riga.percorso) && riga.haFigli) {
        espansi.delete(riga.percorso);
        ricomponi(riga.percorso);
      } else if (riga.livello > 0) {
        // Risale al genitore: la prima riga sopra con livello minore.
        for (let i = stato.indice - 1; i >= 0; i -= 1) {
          if (stato.righe[i].livello < riga.livello) {
            stato.indice = i;
            break;
          }
        }
      }
      break;
    case 'modo':
      stato.ripresa = !stato.ripresa;
      break;
    case 'profilo': {
      // Come `r` per il modo: si scorrono i profili in intestazione invece di
      // aprire una schermata sopra questa. Sono pochi e la riga si legge da
      // sola, quindi un elenco a parte sarebbe un passo in piu' per niente.
      const profili = stato.profili ?? [];
      if (profili.length < 2) break; // nessun profilo configurato: niente da alternare
      const attuale = profili.indexOf(stato.profilo ?? null);
      stato.profilo = profili[(attuale + 1) % profili.length];
      break;
    }
    case 'conferma':
      return { esito: 'conferma' };
    case 'annulla':
      return { esito: 'annulla' };
    // Canc esce dall'interfaccia intera e torna a Claude, senza risalire le
    // schermate una per una: e' lo stesso tasto in tutte, ed e' quello che lo
    // rende utile quando ti sei perso di due passi.
    case 'esci':
      return { esito: 'esci' };
    default:
      break;
  }

  return { esito: 'continua' };
}

// Percorso scelto a partire dalla riga selezionata: se e' un file si prende la
// cartella che lo contiene, cosi' invio funziona sempre.
const cartellaDellaRiga = (riga) => (riga.cartella ? riga.percorso : path.dirname(riga.percorso));

// Mostra il selettore e attende la scelta.
// Usa lo schermo alternativo, cosi' quando finisce il terminale torna com'era e
// Claude parte su una schermata pulita.
// opzioni.radice: cartella dei progetti (default: radicePredefinita)
// opzioni.cwd: cartella corrente, da cui dipende la selezione iniziale
// opzioni.ripresa: modo iniziale (true = l'utente ha scritto "claude -r")
// opzioni.profilo: profilo attivo all'apertura, o null per l'ambiente di partenza
// ritorna: Promise<{ percorso, ripresa, profilo } | null | 'esci'> — null se
//          annullato con Esc, 'esci' se si e' chiesto di tornare dritti a Claude
export function selezionaCartella({
  radice = radicePredefinita(),
  cwd = process.cwd(),
  ripresa = false,
  profilo = null,
  ingresso = process.stdin,
  uscita = process.stdout,
} = {}) {
  const contesto = statoIniziale({ home: os.homedir(), radice, cwd });
  const righe = componiRighe(contesto);
  const indice = Math.max(
    0,
    righe.findIndex((r) => r.percorso === contesto.selezione),
  );
  // I profili si leggono all'apertura: qui si sceglie con cosa far girare Claude
  // prima ancora di sapere dove, ed e' il momento in cui la scelta costa meno.
  const stato = { contesto, righe, indice, ripresa, profili: elencoProfili(leggiProfili()), profilo };

  return new Promise((risolvi) => {
    const ridisegna = () =>
      uscita.write(disegna(stato, uscita.rows || 30, uscita.columns || 100));

    // Ripristina il terminale e restituisce la scelta.
    const chiudi = (risultato) => {
      ingresso.removeListener('data', suDati);
      uscita.removeListener('resize', ridisegna);
      if (ingresso.isTTY) ingresso.setRawMode(false);
      ingresso.pause();
      uscita.write('\x1b[?25h\x1b[?1049l'); // cursore visibile, schermo normale
      risolvi(risultato);
    };

    const suDati = (dati) => {
      for (const azione of azioniNavigazione(dati)) {
        const { esito } = applicaAzione(stato, azione);
        if (esito === 'annulla') return chiudi(null);
        if (esito === 'esci') return chiudi('esci');
        if (esito === 'conferma') {
          return chiudi({
            percorso: cartellaDellaRiga(stato.righe[stato.indice]),
            ripresa: stato.ripresa,
            profilo: stato.profilo,
          });
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

// Prova del selettore senza avviare Claude: `node src/cartelle.js`.
// Stessa idea di anteprima.js per l'albero dei rami: l'interfaccia si guarda
// davvero solo eseguendola, e farlo dietro una sessione di Claude e' scomodo.
if (import.meta.main) {
  const scelta = await selezionaCartella();
  console.log(
    scelta ? `${scelta.percorso}   (${scelta.ripresa ? 'ripresa' : 'avvio normale'})` : 'annullato',
  );
}

// Annota la cartella scelta nel file indicato da CB_CARTELLA_SCELTA.
// E' l'unico modo per far seguire la scelta alla shell che ha lanciato cb: la
// cwd del processo padre non e' modificabile da qui. Senza la variabile non fa
// nulla, quindi chi non ne ha bisogno non se ne accorge.
// percorso: cartella scelta
export function annotaCartellaScelta(percorso) {
  const file = process.env.CB_CARTELLA_SCELTA;
  if (!file) return;
  try {
    fs.writeFileSync(file, percorso, 'utf8');
  } catch {
    // l'hand-off e' un di piu': se fallisce, si parte lo stesso
  }
}
