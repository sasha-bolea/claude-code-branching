import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pty from 'node-pty';
import { trovaEseguibileClaude } from './eseguibile.js';
import {
  percorsoTranscript,
  transcriptPiuRecente,
  sessioniDellaFamiglia,
  sessioneDaPercorso,
} from './percorsi.js';
import { leggiTranscript, unisciAlberi } from './transcript.js';
import { testoLeggibile } from './albero.js';
import {
  componiVista,
  schermata,
  muovi,
  puntaRamoAttivo,
  primaCheEntra,
  coloraTasti,
  VOCI_RIPRISTINO,
} from './vista.js';
import { paginaIstruzioni, massimoScorrimento } from './istruzioni.js';
import { arancioneForte, grigio, normale } from './stile.js';
import { attivaRamoDi, fineDelTurno } from './attiva.js';
import { ripristinaA, riassumiRipristino } from './codice.js';
import { ripiegoDaiCommit } from './commit.js';
import { senzaTitolo, sequenzaTitolo } from './titolo.js';
import { impostazione, salvaImpostazione, percorsoImpostazioni } from './impostazioni.js';
import { T } from './lingua.js';
import { creaSessioneTroncata } from './ramo.js';
import { trasferisci, leggiCoda, togli, indiceProssimo, scriviCoda } from './coda.js';
import { leggiLimiti, limiteEsaurito, attesaFinoAlReset } from './limiti.js';
import { leggiProfili, elencoProfili, ambienteConProfilo } from './profili.js';
import {
  tokenizza,
  contaInTesta,
  analizzaScorciatoia,
  soloRilasci,
  azioniTastiera,
  azioniNavigazione,
  ATTESA_DOPPIO_ESC,
  FINESTRA_SCORCIATOIA,
  MODI_MOUSE,
  SPEGNI_MODI_INPUT,
} from './tasti.js';

// Sequenze ANSI usate dall'overlay. Nominate perche' scritte come caratteri di
// controllo nel sorgente sarebbero invisibili in fase di lettura.
const PULISCI_SCHERMO = '[2J[H';
const MOSTRA_CURSORE = '[?25h';

// Schermo alternativo: la pagina di cb va su un buffer suo, come fanno gia' i
// selettori (cartelle, conversazioni, coda, note). Senza, la rotella scorreva lo
// storico del terminale e sopra la schermata di cb ricompariva la chat di
// Claude, come se fossero due pezzi della stessa pagina. Il buffer alternativo
// non ha storico: non c'e' niente da scorrere, e all'uscita il terminale torna
// esattamente com'era.
const SCHERMO_ALTERNATIVO = '\x1b[?1049h';
const SCHERMO_NORMALE = '\x1b[?1049l';

// Vero se `candidato` e' stato scritto dopo `riferimento`.
// A parita' di istante vince il riferimento: due file scritti nello stesso
// millisecondo non dicono niente su quale sia il piu' nuovo, e in quel dubbio la
// sessione che cb sta gia' seguendo non va abbandonata.
// ritorna: true se candidato e' strettamente piu' recente
function scrittoDopo(candidato, riferimento) {
  try {
    return statSync(candidato).mtimeMs > statSync(riferimento).mtimeMs;
  } catch {
    return false; // un file illeggibile non puo' scalzare quello che abbiamo
  }
}

// Con l'overlay a schermo il tracciamento del mouse va spento: finche' e' acceso
// il terminale manda movimenti e clic all'applicazione invece di selezionare, e
// dall'albero non si riusciva a copiare niente, perche' cb quegli eventi li
// scarta e basta.
//
// Quali siano accesi non si indovina: si guarda cosa Claude ha chiesto
// (`osservaMouse`) e si rimette esattamente quello alla chiusura dell'overlay.
// L'elenco dei modi sta in `tasti.js`, insieme agli altri protocolli di input.
const RE_MODO_MOUSE = new RegExp(`\\x1b\\[\\?(${MODI_MOUSE.join('|')})([hl])`, 'g');

// La sequenza piu' lunga fra quelle cercate e' `ESC[?1016h`, nove caratteri:
// conservando la coda della lettura precedente, una sequenza spezzata fra due
// blocchi di output viene riconosciuta lo stesso.
const CODA_MOUSE = 9;

// Marcatori di "incolla" (bracketed paste): il testo che sta in mezzo arriva
// alla TUI come un blocco solo, e i suoi a capo non valgono come invio.
const INIZIO_INCOLLA = '\x1b[200~';
const FINE_INCOLLA = '\x1b[201~';

// Svuota la barra di input di Claude prima di scriverci: ctrl+u, che nelle
// interfacce a riga di comando cancella dal cursore all'inizio della riga.
//
// **Verificato su una sessione vera** (non dedotto): scritto del testo, mandato
// ctrl+u, il testo sparisce, quello nuovo si scrive pulito e il residuo non
// torna. Claude offre pure un ctrl+y per riprenderselo, quindi non e' nemmeno
// perso davvero.
//
// Non e' ctrl+c, che in Claude Code svuota anch'esso ma **la seconda volta esce**:
// mandato quando la barra e' gia' vuota comincerebbe la sequenza di uscita, e un
// secondo invio ravvicinato chiuderebbe la sessione. Ctrl+u su una barra vuota
// non fa niente, che e' esattamente quello che serve.
const SVUOTA_BARRA = '\x15';

// Millisecondi di silenzio dell'output dopo cui Claude e' considerato pronto a
// ricevere tasti, e limite oltre il quale si scrive comunque (vedi programmaBarra).
const QUIETE_AVVIO = 600;

// Silenzio dell'output dopo cui Claude e' considerato fermo, e la coda puo'
// partire. Piu' larga di QUIETE_AVVIO: qui non si sta aspettando che compaia una
// barra di input, si sta decidendo se una risposta e' finita — e un prompt
// mandato a meta' di un ragionamento lo interromperebbe.
const QUIETE_CODA = 1500;
const ATTESA_MASSIMA_AVVIO = 8000;

// Il prompt che si manda al reset dei token quando la coda e' vuota: fa
// proseguire il lavoro interrotto senza aggiungere richieste che non erano state
// fatte. In inglese anche a interfaccia italiana, che e' la lingua in cui il
// modello e' meno ambiguo.
const PROSEGUI = 'continue';

// Quanto si aspetta prima di riprovare, se al risveglio la statusline non ha
// ancora aggiornato i limiti. Il reset lo dichiara il CLI, ma la barra si
// ridisegna quando le pare: meglio ritentare che consegnare dentro una finestra
// ancora chiusa.
const RIPROVA_RISVEGLIO = 60 * 1000;

// Millisecondi di calma prima di ridisegnare l'overlay dopo un ridimensionamento.
// Trascinando il bordo della finestra gli eventi arrivano a decine al secondo:
// ridisegnare a ognuno farebbe sfarfallare lo schermo. Abbastanza corto da
// sembrare immediato quando si lascia il bordo.
const ATTESA_RIDIMENSIONA = 80;

// Flag con cui l'utente chiede a Claude di riprendere una conversazione.
// `-r`/`--resume` accettano un id di sessione facoltativo; `-c`/`--continue` no.
const FLAG_RIPRESA = new Set(['-r', '--resume', '-c', '--continue']);
const PRENDE_ID = new Set(['-r', '--resume']);

// Vero se fra gli argomenti c'e' una richiesta di ripresa dell'utente.
// argomenti: argomenti destinati a Claude
// ritorna: true se l'id di sessione lo decide Claude e non cb
export function chiedeRipresa(argomenti) {
  return argomenti.some((a) => FLAG_RIPRESA.has(a) || a.startsWith('--resume='));
}

// Toglie i flag di ripresa dagli argomenti dell'utente.
//
// Serve al rilancio dopo un cambio ramo: cb passa gia' `--resume <ramo>` con la
// sessione che ha appena creato, e lasciare in coda il `-r` con cui l'utente
// aveva avviato farebbe arrivare a Claude due richieste di ripresa. La seconda e'
// senza id, quindi Claude riapre il selettore delle conversazioni della cartella
// invece di riprendere il ramo — il bug per cui, dopo un ripristino, ricompariva
// l'elenco delle sessioni passate.
//
// argomenti: argomenti destinati a Claude
// ritorna: gli stessi argomenti senza i flag di ripresa e i loro id
export function senzaRipresa(argomenti) {
  const puliti = [];

  for (let i = 0; i < argomenti.length; i += 1) {
    const argomento = argomenti[i];
    if (argomento.startsWith('--resume=')) continue;
    if (!FLAG_RIPRESA.has(argomento)) {
      puliti.push(argomento);
      continue;
    }
    // L'id che segue il flag va tolto con lui, o resterebbe come argomento
    // sciolto e Claude lo prenderebbe per un prompt. Un altro flag, invece,
    // significa che l'id non c'era.
    const successivo = argomenti[i + 1];
    if (PRENDE_ID.has(argomento) && successivo && !successivo.startsWith('-')) i += 1;
  }

  return puliti;
}

// Traduce un comando di azioniNavigazione in un'azione dell'overlay.
// I tasti che qui non hanno senso ("r", spazio) diventano null e vengono
// scartati: l'overlay non deve reagire a un tasto che non gli appartiene.
// comando: stringa prodotta da azioniNavigazione
// ritorna: azione di navigazione, o null se quel tasto non naviga
function navigazioneDa(comando) {
  if (['su', 'giu', 'sinistra', 'destra'].includes(comando)) {
    return { tipo: 'freccia', valore: comando };
  }
  if (comando === 'conferma') return { tipo: 'conferma' };
  if (comando === 'annulla') return { tipo: 'annulla' };
  // Senza questa riga Canc veniva scartato da `.filter(Boolean)` e l'albero non
  // rispondeva affatto: il tasto arrivava fin qui e moriva in silenzio.
  if (comando === 'esci') return { tipo: 'esci' };
  if (comando === 'conversazione') return { tipo: 'conversazione' };
  if (comando === 'profilo') return { tipo: 'profilo' };
  if (comando === 'coda') return { tipo: 'coda' };
  if (comando === 'note') return { tipo: 'note' };
  if (comando === 'istruzioni') return { tipo: 'istruzioni' };
  return null;
}

// Avvolge Claude Code in uno pseudo-terminale, intercettando la scorciatoia di
// ripristino per mostrare l'albero dei rami invece del menu nativo.
//
// Il ciclo di vita e' una serie di processi Claude: ogni scelta di ramo chiude
// quello corrente e ne apre uno nuovo forkato dal punto scelto. Non e' possibile
// ricaricare una conversazione in un processo gia' avviato: il wrapper rende la
// cosa invisibile, non la evita.
export class Wrapper {
  // opzioni.cwd: cartella di lavoro in cui girera' Claude
  // opzioni.argomentiExtra: argomenti aggiuntivi da passare a Claude
  // opzioni.scorciatoia: tasto che apre l'albero ("esc esc", "ctrl+g", "f2", …)
  // opzioni.ripristinaCodice: se riportare anche i file allo stato del messaggio
  //   scelto (attivo per default: senza, il codice resta quello di adesso)
  // opzioni.diagnostica: stampa i byte ricevuti dalla tastiera, per capire come
  //   il terminale codifica i tasti quando la scorciatoia non risponde
  // opzioni.profilo: nome di un profilo di variabili d'ambiente con cui lanciare
  //   Claude (vedi src/profili.js). null = l'ambiente com'e'.
  constructor({
    cwd = process.cwd(),
    argomentiExtra = [],
    scorciatoia = 'esc esc',
    ripristinaCodice = true,
    titolo = null,
    diagnostica = false,
    profilo = null,
  } = {}) {
    this.cwd = cwd;
    // Titolo della tab: per difetto il nome della cartella di lavoro.
    this.titolo = titolo ?? path.basename(cwd);
    this.argomentiExtra = argomentiExtra;
    this.ripristinaCodice = ripristinaCodice;
    this.scorciatoia = analizzaScorciatoia(scorciatoia);
    this.descrizioneScorciatoia = scorciatoia;
    this.diagnostica = diagnostica;
    // Il log e' sempre attivo: le decisioni sul cambio ramo non sono ricostruibili
    // dallo schermo, che Claude ridisegna. Con --tasti si aggiunge il dump dei byte.
    this.percorsoLog = path.join(os.homedir(), '.claude', 'cb', 'diagnosi.log');
    try {
      mkdirSync(path.dirname(this.percorsoLog), { recursive: true });
    } catch {
      this.percorsoLog = null;
    }
    this.eseguibile = trovaEseguibileClaude();

    this.processo = null;
    this.sessionId = null;
    this.inOverlay = false; // true mentre mostriamo l'albero: lo stdin e' nostro
    this.schermoAlternativo = false; // true mentre la pagina di cb ha il buffer suo
    this.mouseAcceso = new Set(); // modi mouse che Claude ha chiesto, per rimetterli
    this.codaMouse = ''; // fine dell'ultimo blocco, per le sequenze spezzate
    this.timerEsc = null;
    this.pressioniInAttesa = 0; // pressioni della scorciatoia ancora trattenute
    // Pressioni viste nell'ultimo secondo, comprese quelle gia' inoltrate a
    // Claude: e' quello che permette di riconoscere una coppia battuta piano.
    this.pressioniRecenti = 0;
    this.ultimaPressione = null;
    this.byteTrattenuti = null; // byte da inoltrare se la sequenza non si completa
    this.uscitaVolontaria = false; // distingue il kill nostro dall'uscita utente
    this.azioniInAttesa = []; // tasti di navigazione arrivati in gruppo
    this.ridisegnaOverlay = null; // come ridisegnare l'overlay aperto, se c'e'
    this.timerRidimensiona = null;
    this.attesaBarra = null; // prompt da rimettere nella barra appena Claude e' pronto
    this.timerCoda = null; // conto della quiete dopo cui parte il prossimo prompt in coda
    this.ultimoTasto = 0; // quando l'utente ha battuto l'ultimo tasto (vedi consegnaCoda)
    this.promptInVolo = null; // consegnato ma ancora senza risposta: torna in coda se i token finiscono
    this.timerRisveglio = null; // sveglia per il reset della finestra dei token

    // Fotografia dell'ambiente di partenza. Ogni processo Claude nasce da questa,
    // non dall'ambiente corrente: e' cio' che fa sparire da sole le variabili di
    // un profilo quando si torna indietro, senza doversele ricordare.
    this.ambienteDiPartenza = { ...process.env };
    this.profilo = profilo;
  }

  // Scrive sul terminale reale.
  scrivi(testo) {
    process.stdout.write(testo);
  }

  // Annota un evento nel log diagnostico, se attivo. Serve a capire cosa e'
  // successo davvero senza dover leggere lo schermo mentre Claude lo ridisegna.
  registra(messaggio) {
    if (!this.percorsoLog) return;
    try {
      appendFileSync(this.percorsoLog, `${new Date().toISOString()}  ${messaggio}\n`, 'utf8');
    } catch {
      // il log non deve mai interrompere la sessione
    }
  }

  // Apre uno pseudo-terminale con Claude dentro.
  // E' un metodo a se' perche' e' l'unico punto che tocca il mondo esterno: le
  // prove lo sostituiscono per verificare cosa viene chiesto a Claude senza
  // lanciarlo davvero.
  // argomenti: riga di comando per Claude
  // ritorna: il processo pty
  creaProcesso(argomenti) {
    return pty.spawn(this.eseguibile, argomenti, {
      name: 'xterm-256color',
      cols: process.stdout.columns || 120,
      rows: process.stdout.rows || 30,
      cwd: this.cwd,
      env: this.ambiente(),
    });
  }

  // Ambiente con cui lanciare Claude: quello di partenza, con sopra le variabili
  // del profilo attivo. Senza profilo e' la fotografia e basta, cioe' l'ambiente
  // che cb ha ricevuto — il comportamento di sempre.
  // ritorna: oggetto da passare a pty.spawn
  ambiente() {
    // CB_CODA_PTY dice all'hook della coda di stare fermo: dentro cb i prompt li
    // consegna il pty, che li scrive come li scriveresti tu — quindi diventano
    // record `user` veri, e nodi dell'albero. Gli hook girano come figli di
    // Claude e questa variabile la ereditano. Fuori da cb non c'e', e l'hook
    // resta l'unica strada.
    const base = this.profilo
      ? ambienteConProfilo(this.ambienteDiPartenza, leggiProfili().get(this.profilo))
      : this.ambienteDiPartenza;
    return { ...base, CB_CODA_PTY: '1' };
  }

  // Lancia un processo Claude.
  // riprendi: id di una sessione da riprendere (creata da cb, gia' tagliata al
  //   punto scelto). Se assente, parte una sessione nuova.
  // prompt: testo da rimettere nella barra di input senza inviarlo (modo
  //   'prompt' del menu di ripristino). Assente negli altri modi.
  avviaClaude({ riprendi = null, prompt = null } = {}) {
    // Passa da cambiaSessione e non dall'assegnazione diretta: dopo un cambio
    // ramo la sessione e' un'altra, e i prompt in coda devono seguirla.
    this.cambiaSessione(riprendi ?? randomUUID());
    this.attesaBarra = null; // il processo e' nuovo: l'attesa di quello vecchio non vale piu'
    const argomenti = [];

    // `riprendi` e' una sessione che cb ha appena creato, gia' tagliata al punto
    // scelto: va solo ripresa, senza forkare ne' chiedere tagli al CLI.
    if (riprendi) argomenti.push('--resume', riprendi);

    // --session-id ci fa sapere in anticipo quale transcript leggere, ma non si
    // puo' imporre quando e' l'utente a chiedere di riprendere una sessione: in
    // quel caso l'id lo decide Claude e lo scopriamo dal disco.
    if (riprendi) {
      // la sessione esiste gia': imporre un id nuovo la scarterebbe
    } else if (chiedeRipresa(this.argomentiExtra)) {
      this.sessionId = null;
    } else {
      argomenti.push('--session-id', this.sessionId);
    }

    // Al cambio ramo la ripresa la chiede cb, con la sessione che ha creato: il
    // `-r` dell'utente e' gia' stato esaudito al primo avvio, e ripassarlo qui
    // farebbe riaprire il selettore delle conversazioni.
    argomenti.push(...(riprendi ? senzaRipresa(this.argomentiExtra) : this.argomentiExtra));

    this.avviatoIl = Date.now();
    this.eraCambioRamo = Boolean(riprendi);

    // La scorciatoia va registrata, non solo gli argomenti di Claude: quando
    // l'albero "non si apre" la prima cosa da sapere e' quale tasto cb stia
    // aspettando, e senza questa riga si finisce a dedurlo dalla riga di comando
    // del processo. Se un --tasto scavalca una scelta salvata diversa, si dice:
    // e' l'unico modo di accorgersene senza leggere due file.
    const salvata = impostazione('scorciatoia', null);
    const scavalcata =
      salvata && salvata !== this.descrizioneScorciatoia ? ` (impostazioni: ${salvata})` : '';
    this.registra(`scorciatoia attiva: ${this.descrizioneScorciatoia}${scavalcata}`);
    this.registra(`avvio claude ${argomenti.join(' ')}`);
    // Il titolo va riaffermato a ogni avvio: ConPTY lo sovrascrive col percorso
    // dell'eseguibile quando crea il processo, e a un cambio ramo il processo e' nuovo.
    this.scrivi(sequenzaTitolo(this.titolo));
    this.processo = this.creaProcesso(argomenti);

    this.processo.onData((dati) => {
      this.osservaMouse(dati);
      this.attesaBarra?.(); // finche' Claude disegna, il prompt da rimettere aspetta
      this.rimandaConsegna(); // e per lo stesso motivo la coda non parte
      if (!this.inOverlay) this.scrivi(senzaTitolo(dati));
    });

    // Il primo controllo parte anche senza output: se Claude e' gia' fermo — o se
    // non scrive nulla dopo l'avvio — la quiete non arriverebbe mai da sola, e i
    // prompt gia' in coda resterebbero li' ad aspettare un turno che non c'e'.
    this.rimandaConsegna();

    this.programmaBarra(prompt);

    this.processo.onExit(({ exitCode }) => {
      if (this.uscitaVolontaria) {
        this.uscitaVolontaria = false;
        // Sblocca chi sta aspettando la chiusura per poter scrivere sul
        // transcript senza essere sovrascritto.
        const risolvi = this.risolviUscita;
        this.risolviUscita = null;
        risolvi?.();
        return;
      }
      // Se il processo appena rilanciato per un cambio ramo muore subito, la
      // colpa e' del comando di ripresa: senza dirlo, cb sparirebbe lasciando
      // l'utente nella shell senza spiegazioni.
      const durata = Date.now() - (this.avviatoIl ?? 0);
      if (this.eraCambioRamo && exitCode !== 0 && durata < 8000) {
        this.registra(`ripresa fallita: exit=${exitCode} dopo ${durata}ms`);
        this.scrivi(
          `\r\n  cb: la ripresa del ramo e' fallita (vedi l'errore qui sopra).\r\n` +
            `  La conversazione originale e' intatta: rilancia e riprova.\r\n\r\n`,
        );
      }
      this.chiudi(exitCode ?? 0);
    });
  }

  // Rimette un prompt nella barra di input di Claude, senza inviarlo.
  //
  // E' quello che fa il ripristino nativo (Esc Esc): la conversazione e' gia'
  // stata tagliata PRIMA del prompt scelto, e il testo torna dove l'utente
  // l'aveva scritto, pronto da correggere e mandare di nuovo.
  //
  // Il momento in cui scrivere non si deduce da quello che c'e' a schermo — cb
  // non legge l'output di Claude, che cambia a ogni versione del CLI — ma da
  // quando l'output smette di arrivare: e' li' che la prima schermata e' finita
  // e l'ascoltatore dello stdin e' installato. I byte scritti prima si perdono.
  //
  // testo: prompt da rimettere nella barra; senza testo non fa niente
  programmaBarra(testo) {
    if (!testo) return;

    let quiete = null;
    let scritto = false;

    const scrivi = () => {
      if (scritto) return;
      scritto = true;
      clearTimeout(quiete);
      clearTimeout(limite);
      this.attesaBarra = null;
      // Su piu' righe va incollato: un a capo grezzo verrebbe letto come invio,
      // cioe' proprio la cosa che questo modo esiste per non fare.
      const daScrivere = testo.includes('\n') ? `${INIZIO_INCOLLA}${testo}${FINE_INCOLLA}` : testo;
      this.processo?.write(daScrivere);
      this.registra(`prompt rimesso nella barra (${testo.length} caratteri)`);
    };

    // Rete di sicurezza: se l'output non si fermasse mai (ridisegni periodici) il
    // prompt va scritto lo stesso, o la barra resterebbe vuota e il testo perso.
    const limite = setTimeout(scrivi, ATTESA_MASSIMA_AVVIO);
    this.attesaBarra = () => {
      clearTimeout(quiete);
      quiete = setTimeout(scrivi, QUIETE_AVVIO);
    };
    this.attesaBarra();
  }

  // Manda il prossimo prompt della coda, se Claude e' fermo.
  //
  // Il momento non si deduce da quello che c'e' a schermo — cb non legge l'output
  // di Claude, che cambia a ogni versione del CLI — ma da **quando l'output
  // smette di arrivare**: mentre Claude lavora l'indicatore si anima e i byte
  // continuano, quando ha finito l'interfaccia si ferma. E' lo stesso segnale su
  // cui si regge gia' `programmaBarra`.
  //
  // Copre tutt'e due i casi che servono, senza distinguerli: Claude che finisce
  // di rispondere arriva alla quiete adesso, Claude gia' fermo ci e' arrivato
  // prima e il prompt parte al primo controllo.
  //
  // Il prompt si scrive nel pty seguito da invio, cioe' esattamente come lo
  // scriveresti tu: nel transcript diventa un record `user` vero, e quindi un
  // nodo dell'albero da cui si puo' ripartire. E' il motivo per cui dentro cb
  // questa strada batte l'hook, che puo' solo consegnarlo come motivo di un
  // `decision: block`.
  consegnaCoda() {
    if (!this.processo || this.inOverlay) return; // schermo di cb: l'utente sta scrivendo qui
    // Mentre l'utente digita non si inietta niente: il testo si mescolerebbe a
    // quello che sta scrivendo, e l'invio manderebbe il miscuglio.
    if (Date.now() - (this.ultimoTasto ?? 0) < QUIETE_CODA) return;

    // Coi token quasi finiti la coda si ferma, invece di spendere quel che resta
    // su un turno che morira' a meta'. Il prompt in volo — consegnato ma rimasto
    // senza risposta — torna in cima, cosi' al risveglio riparte da li'.
    if (this.sospendiSeSenzaToken()) return;
    // Arrivati qui il limite c'e': il turno precedente e' finito per conto suo,
    // quindi il prompt che avevamo consegnato non e' piu' «in volo».
    this.promptInVolo = null;

    // Non e' per forza il primo: un prompt marcato «salta» si scavalca, e uno
    // «stop» ferma anche tutti quelli dopo di lui.
    const coda = leggiCoda(this.sessionId);
    const indice = indiceProssimo(coda);
    if (indice < 0) return;
    const prossimo = coda[indice].testo;

    // Si toglie PRIMA di scrivere: se la scrittura fallisce si perde un prompt,
    // mentre togliendolo dopo un errore lo rimanderebbe a ogni quiete, per sempre.
    togli(this.sessionId, indice);
    this.registra(`coda: mando un prompt (${prossimo.length} caratteri), ne restano ${leggiCoda(this.sessionId).length}`);
    // Su piu' righe va incollato: gli a capo grezzi verrebbero letti come invii,
    // e il prompt partirebbe a pezzi.
    const testo = prossimo.includes('\n')
      ? `${INIZIO_INCOLLA}${prossimo}${FINE_INCOLLA}`
      : prossimo;
    // La barra si svuota prima di scrivere: quello che c'era va **sostituito**,
    // non allungato. Un abbozzo lasciato li' da prima si incollerebbe in testa al
    // prompt che parte, e l'invio manderebbe il miscuglio — cioe' lo stesso
    // guaio che `ultimoTasto` evita mentre stai digitando, ma con un testo fermo
    // da minuti, che nessuna quiete puo' rivelare.
    this.processo.write(SVUOTA_BARRA);
    this.processo.write(`${testo}\r`);
    // Da qui e' «in volo»: consegnato, ma senza sapere ancora se avra' risposta.
    // Se i token finiscono prima che il turno chiuda, torna in coda.
    this.promptInVolo = prossimo;
  }

  // Ferma la coda quando la finestra delle 5 ore e' agli sgoccioli, e programma
  // il risveglio per quando riparte.
  //
  // Perche' prima di consegnare e non dopo: un turno che comincia col serbatoio
  // vuoto muore a meta', e quel prompt e' speso — mentre fermarsi un attimo prima
  // costa solo l'attesa, che ci sarebbe comunque. E' l'unica cosa che cb puo'
  // davvero fermare: a te che scrivi nella barra non mette becco.
  //
  // Il prompt in volo torna in **cima** alla coda, non in fondo: era il prossimo,
  // e l'ordine e' l'unica cosa che la coda promette. Se fosse invece andato a
  // buon fine proprio mentre i token finivano, si rimanda una volta di troppo —
  // un prompt ripetuto si vede e si cancella, uno perso no.
  // ritorna: true se ha sospeso, e il chiamante deve fermarsi
  sospendiSeSenzaToken() {
    const limiti = leggiLimiti();
    if (!limiteEsaurito(limiti)) return false;

    const attesa = attesaFinoAlReset(limiti);
    if (attesa === null) return false; // reset gia' passato: il file e' vecchio

    if (this.promptInVolo) {
      scriviCoda(this.sessionId, [this.promptInVolo, ...leggiCoda(this.sessionId)]);
      this.registra(`limiti: rimetto in coda il prompt rimasto senza risposta (${this.promptInVolo.length} caratteri)`);
      this.promptInVolo = null;
    }

    this.programmaRisveglio(attesa);
    return true;
  }

  // Arma la sveglia per il reset dei token. Una sola: riarmarla a ogni quiete
  // sposterebbe il risveglio in avanti per sempre.
  // attesa: millisecondi da aspettare
  programmaRisveglio(attesa) {
    if (this.timerRisveglio) return;
    this.registra(`limiti: coda sospesa, riprendo fra ${Math.round(attesa / 1000)}s`);
    this.timerRisveglio = setTimeout(() => {
      this.timerRisveglio = null;
      this.risvegliaDopoIlReset();
    }, attesa);
    // Non tiene sveglio il processo: se Claude e' chiuso non c'e' piu' niente a
    // cui consegnare, e restare vivi per una sveglia sarebbe solo un processo
    // che non muore.
    this.timerRisveglio.unref?.();
  }

  // Riparte quando la finestra si e' resettata: se c'e' una coda riprende da
  // quella, se e' vuota manda `continue`.
  //
  // «continue» e non un prompt vero: il lavoro interrotto e' li' nel contesto, e
  // questa e' la parola con cui lo si fa proseguire senza aggiungere richieste
  // che non avevi fatto. In inglese perche' e' la lingua in cui il modello e'
  // meno ambiguo, indipendentemente da quella dell'interfaccia.
  risvegliaDopoIlReset() {
    if (!this.processo || this.inOverlay) return;
    if (limiteEsaurito(leggiLimiti())) {
      // La statusline non si e' ancora aggiornata: si riprova piu' tardi invece
      // di consegnare dentro un limite che magari e' ancora chiuso.
      this.programmaRisveglio(RIPROVA_RISVEGLIO);
      return;
    }

    if (indiceProssimo(leggiCoda(this.sessionId)) >= 0) {
      this.registra('limiti: finestra resettata, riprendo la coda');
      this.consegnaCoda();
      return;
    }

    this.registra('limiti: finestra resettata, coda vuota, mando continue');
    this.processo.write(SVUOTA_BARRA);
    this.processo.write(`${PROSEGUI}\r`);
  }

  // Fa ripartire il conto della quiete a ogni blocco di output.
  // Finche' Claude disegna il timer si riarma, e la coda non parte: e' l'attesa
  // stessa a dire che sta ancora lavorando.
  rimandaConsegna() {
    clearTimeout(this.timerCoda);
    this.timerCoda = setTimeout(() => this.consegnaCoda(), QUIETE_CODA);
  }

  // Forza Claude a ridisegnare l'interfaccia dopo che l'overlay l'ha coperta.
  // Una variazione di dimensione fa ripartire il layout di Ink: e' l'unico modo
  // affidabile, Claude non risponde a una richiesta di refresh.
  forzaRidisegno() {
    const colonne = process.stdout.columns || 120;
    const righe = process.stdout.rows || 30;
    this.processo?.resize(Math.max(20, colonne - 1), righe);
    setTimeout(() => this.processo?.resize(colonne, righe), 40);
  }

  // Porta la pagina di cb sul buffer alternativo del terminale.
  //
  // Si riafferma a ogni schermata invece di fidarsi del flag: i selettori
  // (cartelle, coda, note) aprono e chiudono il buffer alternativo per conto
  // loro, e al ritorno da uno di quelli il terminale e' gia' tornato su quello
  // normale. Chiederlo di nuovo quando ci si e' gia' dentro non costa niente.
  apriSchermo() {
    this.schermoAlternativo = true;
    this.scrivi(SCHERMO_ALTERNATIVO);
  }

  // Restituisce il terminale com'era: fuori dal buffer alternativo, con lo
  // schermo di Claude dove l'aveva lasciato.
  chiudiSchermo() {
    if (!this.schermoAlternativo) return;
    this.schermoAlternativo = false;
    this.scrivi(SCHERMO_NORMALE);
  }

  // Chiude l'overlay e restituisce il terminale a Claude.
  chiudiOverlay() {
    this.inOverlay = false;
    this.ridisegnaOverlay = null; // da qui in poi lo schermo e' di Claude
    clearTimeout(this.timerRidimensiona);
    this.mouse(true); // lo schermo torna a Claude, e il mouse e' suo
    this.chiudiSchermo();
    this.scrivi(PULISCI_SCHERMO);
    this.forzaRidisegno();
  }

  // Cambia la sessione seguita, portandosi dietro la coda dei prompt.
  //
  // Va usata **ovunque** `sessionId` venga riassegnato, e non e' un dettaglio:
  // la coda e' legata all'id, e in cb quell'id cambia spesso — un /clear fa
  // nascere un file nuovo, ogni cambio ramo crea una sessione troncata. Senza lo
  // spostamento i prompt gia' scritti resterebbero appesi a una sessione che non
  // riceve piu' hook, cioe' sparirebbero in silenzio.
  // nuovo: id della sessione da seguire da qui in avanti
  cambiaSessione(nuovo) {
    if (this.sessionId && nuovo && this.sessionId !== nuovo) {
      try {
        trasferisci(this.sessionId, nuovo);
      } catch {
        // una coda che non si sposta non e' un motivo per non cambiare sessione
      }
    }
    this.sessionId = nuovo;
  }

  // Prende nota dei modi mouse che Claude accende o spegne, leggendo il suo
  // output di passaggio.
  //
  // Si osserva invece di indovinare perche' alla chiusura dell'overlay va
  // rimesso **esattamente** quello che c'era: riaccendere un modo che Claude non
  // aveva chiesto gli farebbe arrivare eventi che non si aspetta.
  // dati: blocco di output del pty
  osservaMouse(dati) {
    const testo = (this.codaMouse ?? '') + dati;
    RE_MODO_MOUSE.lastIndex = 0;
    for (const trovato of testo.matchAll(RE_MODO_MOUSE)) {
      if (trovato[2] === 'h') this.mouseAcceso.add(trovato[1]);
      else this.mouseAcceso.delete(trovato[1]);
    }
    // Coda per la lettura successiva: una sequenza puo' arrivare spezzata a
    // meta' fra due blocchi, e senza questo pezzo andrebbe persa.
    this.codaMouse = testo.slice(-CODA_MOUSE);
  }

  // Accende o spegne i modi mouse che Claude aveva chiesto.
  // Spenti, il terminale torna a fare la selezione del testo con il mouse: e'
  // quello che serve mentre l'overlay e' a schermo.
  // acceso: true per rimetterli come li voleva Claude
  mouse(acceso) {
    if (this.mouseAcceso.size === 0) return;
    const finale = acceso ? 'h' : 'l';
    this.scrivi([...this.mouseAcceso].map((modo) => `\x1b[?${modo}${finale}`).join(''));
  }

  // Spegne ogni tracciamento del mouse, anche quello che cb stesso poteva aver
  // acceso in una versione precedente.
  //
  // Nelle schermate di cb non si accende **nessun** modo. Prima si accendeva il
  // minimo che fa arrivare la rotella (?1000+?1006), e la selezione del testo
  // restava a portata solo tenendo premuto shift: un aggiramento standard, ma
  // pur sempre un aggiramento, e su alcuni terminali nemmeno quello. Fra la
  // rotella e il poter copiare quello che c'e' a schermo vince il copiare —
  // l'albero si scorre gia' con le frecce e con w/a/s/d, mentre un testo che
  // non si riesce a prendere non ha alternative.
  //
  // Si spegne comunque, invece di non scrivere niente: chi aggiorna cb puo'
  // avere un terminale con quei modi ancora accesi da una sessione precedente.
  spegniMouse() {
    this.scrivi(MODI_MOUSE.map((modo) => `\x1b[?${modo}l`).join(''));
  }

  // Reagisce al ridimensionamento della finestra del terminale.
  //
  // Claude va avvisato sempre, anche mentre l'overlay lo copre: al ritorno deve
  // gia' conoscere le dimensioni nuove. L'overlay invece si ridisegna solo se e'
  // aperto — senza, resterebbe a schermo com'era, tagliato o con lo scorrimento
  // calcolato su una larghezza che non esiste piu', finche' non si preme un tasto.
  //
  // Il ridisegno e' ritardato perche' trascinando il bordo della finestra gli
  // eventi arrivano a decine al secondo, e ripulire lo schermo a ogni evento
  // produrrebbe uno sfarfallio.
  ridimensiona() {
    const colonne = process.stdout.columns || 120;
    const righe = process.stdout.rows || 30;
    this.processo?.resize(colonne, righe);

    if (!this.inOverlay) return;
    clearTimeout(this.timerRidimensiona);
    this.timerRidimensiona = setTimeout(() => {
      if (this.inOverlay) this.ridisegnaOverlay?.();
    }, ATTESA_RIDIMENSIONA);
  }

  // Mostra una schermata di sola informazione e attende un invio.
  // Serve quando non c'e' ancora un albero: senza questo il messaggio verrebbe
  // coperto dal ridisegno di Claude e la scorciatoia sembrerebbe non funzionare.
  // Non e' piu' un avviso di sola lettura: da qui si arriva ai selettori con gli
  // stessi tasti dell'albero. Prima era un vicolo cieco — proprio quando non c'e'
  // un albero da mostrare, cioe' prima del primo prompt, l'unica cosa che si
  // poteva fare era tornare indietro.
  // righe: testo da mostrare
  // conExtra: se `m`, `p` e `n` devono valere anche qui. Serve sulle schermate
  //   che sostituiscono l'albero — senza, proprio quando l'albero non c'e' i
  //   tasti annunciati nella barra smetterebbero di funzionare. Non sulla
  //   schermata dei profili stessa, che altrimenti si riaprirebbe da sola.
  // ritorna: Promise<'selettori'|'profilo'|'coda'|'note'|'istruzioni'|null> — null
  //          se si torna a Claude
  mostraAvviso(righe, { conExtra = false } = {}) {
    this.inOverlay = true;
    this.apriSchermo(); // pagina nostra, su un buffer suo: niente da scorrere
    this.mouse(false); // schermo nostro: il mouse torni a selezionare il testo
    this.spegniMouse(); // anche quello che poteva aver acceso cb stesso
    // Registrato come ridisegno cosi' anche questa schermata segue il
    // ridimensionamento della finestra (vedi ridisegnaOverlay).
    this.ridisegnaOverlay = () => {
      // Intestazione, riga vuota, il testo. Poi il riempimento, poi la legenda.
      const pagina = ['  cb', '', ...righe.map((riga) => `  ${riga}`)];

      // La legenda in fondo allo schermo, come negli altri selettori: gli avvisi
      // hanno lunghezze diverse, e una legenda che sale e scende a seconda del
      // testo si legge peggio di una che sta sempre nello stesso posto.
      //
      // Si riempie lo schermo esatto e si unisce con \r\n senza andare a capo in
      // fondo: una riga in piu' farebbe scorrere via l'intestazione.
      const altezza = process.stdout.rows || 30;
      const spazio = Math.max(1, altezza - 1);
      // Il testo si taglia prima di aggiungere la legenda, non dopo: tagliando
      // la pagina finita sarebbe proprio la legenda a sparire, cioe' l'unica
      // riga che dice come si esce.
      const pronta = pagina.slice(0, spazio);
      while (pronta.length < spazio) pronta.push('');
      // I tasti in arancione, come in ogni altra schermata.
      pronta.push(
        `  ${coloraTasti(conExtra ? T.wrapper.tastiAvvisoCompleta : T.wrapper.tastiAvviso)}`,
      );

      this.scrivi(MOSTRA_CURSORE + PULISCI_SCHERMO);
      this.scrivi(pronta.join('\r\n'));
    };

    this.ridisegnaOverlay();

    return new Promise((risolvi) => {
      const ascoltatore = (dati) => {
        for (const comando of azioniNavigazione(dati)) {
          if (comando === 'conversazione') {
            process.stdin.off('data', ascoltatore);
            return risolvi('selettori');
          }
          // Profilo, coda e note: gli stessi tasti dell'albero, perche' questa
          // schermata sta al suo posto. La coda e le note non hanno bisogno che
          // la conversazione sia gia' cominciata — anzi, e' proprio prima del
          // primo prompt che si scrive quello che si vuole far fare dopo.
          if (conExtra && (comando === 'profilo' || comando === 'coda' || comando === 'note')) {
            process.stdin.off('data', ascoltatore);
            return risolvi(comando);
          }
          // Le istruzioni valgono anche sugli avvisi che non hanno gli extra: la
          // pagina spiega la schermata, e una schermata senza spiegazione e'
          // proprio quella su cui si resta piantati.
          if (comando === 'istruzioni') {
            process.stdin.off('data', ascoltatore);
            return risolvi('istruzioni');
          }
          // Da un avviso non si risale da nessuna parte: dietro c'e' Claude, e
          // Canc ci porta come Esc. Restano tutt'e due perche' Canc deve
          // funzionare in ogni schermata, comprese quelle dove non aggiunge nulla.
          if (comando === 'conferma' || comando === 'annulla' || comando === 'esci') {
            process.stdin.off('data', ascoltatore);
            return risolvi(null);
          }
        }
      };
      process.stdin.on('data', ascoltatore);
    });
  }

  // La pagina delle istruzioni della schermata da cui la si apre.
  //
  // Non porta da nessuna parte: si legge e si torna dov'eri. E' il motivo per
  // cui non chiude l'overlay ne' tocca il processo — la schermata di partenza
  // resta esattamente com'era, e chi la riapre ritrova il suo cursore.
  //
  // Lo stdin se lo prende come ogni altra schermata di cb; l'ascoltatore del
  // chiamante va staccato prima di chiamarla, o i tasti arriverebbero a tutt'e
  // due.
  // pagina: { titolo, righe } da T.istruzioni
  // ritorna: Promise<'indietro' | 'esci'> — Esc torna alla schermata, Canc esce
  //          da tutto, come in ogni altra schermata
  mostraIstruzioni(pagina) {
    this.inOverlay = true;
    this.apriSchermo();
    this.mouse(false);
    this.spegniMouse();
    let scorrimento = 0;

    this.ridisegnaOverlay = () => {
      const opzioni = {
        colonne: process.stdout.columns || 120,
        altezza: process.stdout.rows || 30,
        scorrimento,
      };
      this.scrivi(MOSTRA_CURSORE + PULISCI_SCHERMO);
      this.scrivi(paginaIstruzioni(pagina, opzioni).join('\r\n'));
    };
    this.ridisegnaOverlay();

    return new Promise((risolvi) => {
      const ascoltatore = (dati) => {
        const azioni = azioniNavigazione(dati);
        // Un tasto che non produce niente non ridisegna: il ridisegno pulisce lo
        // schermo, e con lui se ne andrebbe la selezione fatta col mouse.
        if (azioni.length === 0) return;
        for (const comando of azioni) {
          if (comando === 'annulla' || comando === 'esci') {
            process.stdin.off('data', ascoltatore);
            return risolvi(comando === 'esci' ? 'esci' : 'indietro');
          }
          const massimo = massimoScorrimento(pagina, {
            colonne: process.stdout.columns || 120,
            altezza: process.stdout.rows || 30,
          });
          if (comando === 'giu') scorrimento = Math.min(massimo, scorrimento + 1);
          else if (comando === 'su') scorrimento = Math.max(0, scorrimento - 1);
        }
        this.ridisegnaOverlay();
      };

      process.stdin.on('data', ascoltatore);
    });
  }

  // Le due schermate che compaiono al posto dell'albero quando un albero non
  // c'e': prima del primo scambio, e quando il transcript non ha messaggi.
  //
  // Accettano gli stessi tasti dell'albero — c, m, p, n — perche' ne prendono il
  // posto: un tasto annunciato nella barra che non risponde e' un tasto rotto, e
  // proprio qui coda e note servono di piu', dato che non hanno bisogno di una
  // conversazione gia' cominciata.
  //
  // Si riapre `mostraOverlay` e non questa schermata: nel frattempo Claude puo'
  // aver scritto il transcript, e allora al ritorno c'e' l'albero vero.
  // righe: testo dell'avviso
  // ritorna: Promise<void> — chiude l'overlay o apre un selettore da se'
  async avvisoAlPostoDellAlbero(righe) {
    const scelta = await this.mostraAvviso(righe, { conExtra: true });
    if (scelta === 'istruzioni') {
      if ((await this.mostraIstruzioni(T.istruzioni.avviso)) === 'esci') {
        this.chiudiOverlay();
        return;
      }
      return this.mostraOverlay();
    }
    if (scelta === 'profilo') {
      if (await this.scegliProfilo(null, null)) return; // ha rilanciato Claude
      return this.mostraOverlay();
    }
    // Ne' la coda ne' le note toccano conversazione o processo: si torna qui.
    // Con Canc invece si esce da tutto, senza ripassare da questa schermata.
    if (scelta === 'coda' || scelta === 'note') {
      const esito = scelta === 'coda' ? await this.mostraCoda() : await this.mostraNote();
      if (esito === 'esci') {
        this.chiudiOverlay();
        return;
      }
      return this.mostraOverlay();
    }
    if (scelta !== 'selettori') {
      this.chiudiOverlay();
      return;
    }
    // Esc sul primo selettore riporta a questo avviso, non fuori.
    if ((await this.cambiaConversazione()) === 'indietro') return this.mostraOverlay();
  }

  // Percorso del transcript della sessione in corso.
  //
  // Si guarda il disco **a ogni chiamata**, senza fidarsi dell'id che avevamo:
  // `/clear` non taglia dentro al file, fa nascere un file di sessione nuovo, e
  // l'id in mano a cb resta quello di prima. Agganciandosi una volta sola
  // l'albero continuava a mostrare la conversazione precedente il clear — e,
  // peggio del disegno, invio ci forkava sopra, ripristinando i file all'istante
  // di un turno di un'altra conversazione.
  //
  // Il criterio non e' "il piu' recente della cartella" e basta: nella cartella
  // convivono i file della stessa famiglia — dopo un fork il file di partenza sta
  // li' accanto — e prendere il piu' recente in assoluto faceva saltare cb sulla
  // sessione sbagliata quando due file venivano scritti nello stesso istante.
  //
  // La regola e': si tiene il **nostro** file, a meno che non ne esista uno di
  // un'altra sessione **strettamente piu' recente**. Dopo un clear e' proprio
  // cosi' — il nostro smette di crescere e il nuovo continua — mentre i parenti
  // di una famiglia restano fermi e non ce lo rubano.
  //
  // Ma "piu' recente" da solo non basta: due finestre aperte sulla stessa
  // cartella danno lo stesso quadro di un clear — il nostro file fermo perche'
  // non stiamo scrivendo, l'altro che cresce — e cb saltava sulla conversazione
  // dell'altra finestra (successo due volte in una mattina, vedi diagnosi.log:
  // "sessione cambiata: c343c768… -> 7c8ca487…" dopo 41 minuti di inattivita').
  // Le due situazioni si distinguono da **quando la conversazione e' cominciata**:
  // dopo un clear il primo messaggio e' successivo all'avvio di cb, quello di
  // un'altra finestra e' di prima.
  //
  // Il filtro vale solo quando sappiamo chi siamo: con `--resume`/`--continue`
  // l'id lo sceglie Claude e la conversazione da trovare e' per forza vecchia.
  // ritorna: percorso del .jsonl, o null se non esiste ancora
  trovaTranscript() {
    const nostro = this.sessionId ? percorsoTranscript(this.sessionId, this.cwd) : null;
    const cominciataDopo = this.sessionId ? (this.avviatoIl ?? 0) : null;
    const recente = transcriptPiuRecente(this.cwd, this.avviatoIl ?? 0, cominciataDopo);

    if (nostro && recente && recente.sessionId !== this.sessionId) {
      if (scrittoDopo(recente.percorso, nostro)) {
        this.registra(`sessione cambiata: ${this.sessionId} -> ${recente.sessionId}`);
        this.cambiaSessione(recente.sessionId); // e' il caso del /clear: la coda segue
        return recente.percorso;
      }
    }

    // Il nostro file, quando c'e', e' quello giusto: appena avviati, e subito
    // dopo un cambio ramo — li' il file della sessione troncata lo ha scritto cb
    // prima di rilanciare, quindi e' piu' vecchio di `avviatoIl` e non comparirebbe
    // fra i recenti.
    if (nostro) return nostro;

    // Nessun file nostro: la sessione l'ha scelta Claude (--resume, --continue) e
    // si scopre dal disco. Con un id nostro `recente` e' gia' filtrato per
    // inizio conversazione, quindi qui non puo' arrivare quella di un'altra
    // finestra —
    // era il secondo modo in cui cb mostrava l'albero della conversazione
    // sbagliata, prima che Claude scrivesse il nostro file.
    if (recente) {
      if (recente.sessionId !== this.sessionId) {
        this.registra(`sessione scoperta dal disco: ${recente.sessionId}`);
        this.cambiaSessione(recente.sessionId);
      }
      return recente.percorso;
    }

    // Appena forkato con --fork-session, Claude non ha ancora scritto il file: lo
    // crea al primo messaggio. Ci si aggancia al transcript da cui siamo
    // ripartiti, che fa parte della stessa famiglia e contiene tutti i rami.
    if (this.percorsoOrigine) {
      this.registra(`transcript non ancora scritto, uso l origine ${this.percorsoOrigine}`);
      return this.percorsoOrigine;
    }
    return null;
  }

  // Mostra l'albero dei rami della sessione corrente e attende una scelta.
  async mostraOverlay() {
    this.azioniInAttesa = []; // tasti rimasti da un overlay precedente
    const percorso = this.trovaTranscript();
    this.registra(`overlay sessione=${this.sessionId} transcript=${percorso ?? 'ASSENTE'}`);
    if (!percorso) {
      return this.avvisoAlPostoDellAlbero(
        T.wrapper.senzaTranscript(this.descrizioneScorciatoia, this.sessionId),
      );
    }

    this.inOverlay = true;
    this.apriSchermo(); // pagina nostra, su un buffer suo: niente da scorrere
    this.mouse(false); // schermo nostro: via il tracciamento di Claude
    // E nessuno al suo posto: finche' una schermata di cb e' a video il mouse
    // deve poter selezionare e copiare, senza shift e senza scorciatoie.
    this.spegniMouse();
    this.scrivi(MOSTRA_CURSORE + PULISCI_SCHERMO); // cursore visibile, schermo pulito

    // I rami abbandonati prima di un fork vivono nel file della sessione di
    // partenza: senza unire la famiglia sarebbero invisibili da qui.
    const famiglia = await sessioniDellaFamiglia(percorso);
    const alberi = [];
    for (const file of famiglia) alberi.push(await leggiTranscript(file));
    // Unisco sempre, anche con un solo file: cosi' ogni nodo porta le proprie
    // `origini` e il cambio ramo sa da quale sessione ripartire.
    const albero = unisciAlberi(alberi, famiglia);
    // Serve al cambio ramo: ogni file va riattivato usando il proprio albero,
    // non quello unito, altrimenti si punterebbe a nodi che quel file non ha.
    this.alberiFamiglia = new Map(famiglia.map((file, i) => [file, alberi[i]]));

    // Se siamo agganciati al transcript di provenienza, il ramo attivo scritto
    // la' non e' il nostro: e' quello da cui siamo ripartiti. Vale per entrambi i
    // modi di indicare la punta, o il cursore partirebbe sul ramo dell'altra
    // sessione (l'ultimo record di quel file sta su un ramo che abbiamo lasciato).
    if (this.uuidRipreso && percorso === this.percorsoOrigine) {
      albero.leafAttivo = this.uuidRipreso;
      albero.ultimoNodo = this.uuidRipreso;
    }
    this.registra(`famiglia=${famiglia.length} sessioni, nodi uniti=${albero.nodi.size}`);
    // La griglia si calcola una volta sola, alla larghezza naturale dell'albero:
    // muovere il cursore cambia il colore dei nodi e la finestra mostrata, non il
    // disegno. Non dipende dalle dimensioni del terminale, quindi non va rifatta
    // se la finestra viene ridimensionata mentre l'overlay e' aperto.
    const vista = componiVista(albero);
    this.registra(
      `vista nodi=${vista.nodi.length} righe=${vista.griglia.length} ` +
        `larghezza=${vista.larghezza} uniti=${albero.nodi.size}`,
    );

    if (vista.nodi.length === 0) {
      this.inOverlay = false;
      return this.avvisoAlPostoDellAlbero(T.wrapper.senzaMessaggi(this.sessionId, percorso));
    }

    let selezione = puntaRamoAttivo(vista);
    let voce = null;
    let scelta = null;

    // Ciclo di navigazione: disegna, aspetta un tasto, ridisegna.
    for (;;) {
      // Il ridisegno si registra a ogni giro perche' la selezione cambia: cosi'
      // un ridimensionamento della finestra ridisegna con il cursore giusto.
      this.ridisegnaOverlay = () => this.disegnaSchermata(vista, selezione);
      this.ridisegnaOverlay();
      const azione = await this.leggiNavigazione();

      // Nell'albero i due tasti finiscono nello stesso posto — indietro da qui
      // vuol dire Claude — ma restano tutt'e due: Canc deve funzionare in ogni
      // schermata, e una in cui non funzionasse basterebbe a non fidarsene piu'.
      if (azione.tipo === 'annulla' || azione.tipo === 'esci') {
        this.registra('overlay chiuso senza scegliere');
        this.chiudiOverlay();
        return;
      }
      if (azione.tipo === 'conferma') {
        // Invio non riparte piu' subito: prima si sceglie cosa riportare
        // indietro. Esc nel menu torna all'albero, non chiude l'overlay.
        scelta = await this.scegliModoRipristino(vista, selezione);
        // Canc dal menu esce da tutto: l'albero non si riapre.
        if (scelta === 'esci') {
          this.chiudiOverlay();
          return;
        }
        if (!scelta) continue;
        voce = vista.perUuid.get(selezione);
        break;
      }
      // Rilancia la stessa conversazione con altre variabili d'ambiente. Non
      // apre niente se non ci sono profili configurati: e' una funzione che chi
      // non la usa non deve nemmeno vedere.
      if (azione.tipo === 'profilo') {
        const cambiato = await this.scegliProfilo(vista, selezione);
        if (cambiato) return;
        continue;
      }
      // La coda non cambia ne' conversazione ne' processo: si torna all'albero
      // dove lo si era lasciato, con la stessa vista e lo stesso cursore. Con
      // Canc invece si esce da tutto, senza ripassare dall'albero.
      if (azione.tipo === 'coda') {
        if ((await this.mostraCoda()) === 'esci') {
          this.chiudiOverlay();
          return;
        }
        continue;
      }
      // Le note stanno alla cartella come la coda sta alla sessione: non
      // toccano ne' conversazione ne' processo, quindi si torna all'albero dove
      // lo si era lasciato.
      if (azione.tipo === 'note') {
        if ((await this.mostraNote()) === 'esci') {
          this.chiudiOverlay();
          return;
        }
        continue;
      }
      // Le istruzioni si leggono e si torna qui, con la stessa vista e lo stesso
      // cursore: `ridisegnaOverlay` viene riassegnato in cima al ciclo.
      if (azione.tipo === 'istruzioni') {
        if ((await this.mostraIstruzioni(T.istruzioni.albero)) === 'esci') {
          this.chiudiOverlay();
          return;
        }
        continue;
      }
      // Da qui si esce dalla conversazione corrente: si sceglie un'altra
      // conversazione della stessa cartella, o prima un'altra cartella.
      if (azione.tipo === 'conversazione') {
        // Esc sul primo selettore riporta all'albero, da dove si era partiti.
        // Si ricomincia da capo invece di riusare la vista: nel frattempo la
        // conversazione puo' essere cresciuta, e ridisegnare quella vecchia
        // mostrerebbe un albero gia' scaduto.
        if ((await this.cambiaConversazione()) === 'indietro') return this.mostraOverlay();
        return;
      }
      selezione = muovi(vista, selezione, azione.valore);
    }

    this.registra(
      `scelta uuid=${voce.uuid} modo=${scelta.modo} daRimandare=${scelta.daRimandare} ` +
        `testo="${testoLeggibile(voce.testo).slice(0, 40)}"`,
    );
    await this.cambiaRamo(percorso, albero, voce, scelta.modo, scelta.daRimandare);
  }

  // Chiede cosa riportare indietro dal punto scelto: la conversazione, i file
  // o tutti e due. Sono le stesse tre voci del menu nativo di Claude.
  //
  // Insieme si sceglie dove finisce il prompt: resta inviato con la risposta che
  // ha avuto (↑↓ scelgono la voce, ←→ questo), oppure torna nella barra di input
  // ancora da mandare. E' una scelta a parte e non una quarta voce perche' vale
  // insieme a tutt'e tre. Con `r` la si fa ricordare per le prossime volte.
  //
  // Si legge con azioniTastiera e non con leggiNavigazione perche' qui servono
  // anche le cifre e le lettere, che la navigazione dell'albero scarta.
  //
  // vista: risultato di componiVista
  // selezione: uuid del nodo su cui sta il cursore
  // ritorna: Promise<{ modo, daRimandare } | null | 'esci'> — null se si torna
  //          all'albero con Esc, 'esci' se con Canc si esce dall'interfaccia
  scegliModoRipristino(vista, selezione) {
    // Preselezione: il caso normale, o "solo la conversazione" se l'utente ha
    // chiesto di non toccare i file (--senza-file).
    let indice = this.ripristinaCodice ? 0 : 1;
    // Il prompt parte da com'era stato lasciato l'ultima volta, se lo si era
    // fatto ricordare; altrimenti da "resta inviato", che e' il modo di sempre.
    const salvato = Boolean(impostazione('promptDaRimandare', false));
    let daRimandare = salvato;
    let ricorda = false;

    const esito = () => {
      if (ricorda) {
        try {
          salvaImpostazione('promptDaRimandare', daRimandare);
        } catch (errore) {
          // Un'impostazione non salvata non e' un motivo per non ripartire.
          this.registra(`scelta non ricordata: ${errore.message}`);
        }
      }
      return { modo: VOCI_RIPRISTINO[indice].modo, daRimandare };
    };

    // Tasti rimasti in coda dalla navigazione dell'albero: due invii battuti in
    // fretta arrivano in una lettura sola, e il secondo finisce li'. Senza
    // consumarlo il menu resterebbe aperto ad aspettare un tasto gia' premuto.
    const inCoda = this.azioniInAttesa.splice(0);
    if (inCoda.some((azione) => azione.tipo === 'conferma')) {
      return Promise.resolve(esito());
    }

    return new Promise((risolvi) => {
      // Anche il menu va ridisegnato su ridimensionamento: il ridisegno passa
      // sempre dallo stesso appiglio, che qui punta alla schermata col menu.
      // La casella compare solo quando lo stato mostrato non e' gia' quello
      // salvato: se coincidono non c'e' niente da ricordare.
      const ridisegna = () =>
        this.disegnaSchermata(vista, selezione, {
          menu: indice,
          daRimandare,
          ricorda,
          ricordabile: daRimandare !== salvato,
        });
      this.ridisegnaOverlay = ridisegna;
      ridisegna();

      const concludi = (scelta) => {
        process.stdin.off('data', ascoltatore);
        this.ridisegnaOverlay = () => this.disegnaSchermata(vista, selezione);
        risolvi(scelta);
      };

      const ascoltatore = (dati) => {
        for (const azione of azioniTastiera(dati)) {
          if (azione.tipo === 'annulla') return concludi(null);
          // Canc esce da tutto senza ripristinare niente: si torna a Claude come
          // se il menu non fosse mai stato aperto.
          if (azione.tipo === 'esci') return concludi('esci');
          if (azione.tipo === 'invio') return concludi(esito());
          if (azione.tipo === 'cifra') {
            const scelto = Number.parseInt(azione.valore, 10) - 1;
            if (scelto >= 0 && scelto < VOCI_RIPRISTINO.length) {
              indice = scelto;
              return concludi(esito());
            }
            continue;
          }
          // Le istruzioni del menu si leggono senza perdere la scelta fatta: al
          // ritorno il menu si ridisegna con la stessa voce e lo stesso stato.
          // L'ascoltatore va staccato prima, o i tasti della pagina arriverebbero
          // anche qui.
          if (azione.tipo === 'istruzioni') {
            process.stdin.off('data', ascoltatore);
            this.mostraIstruzioni(T.istruzioni.menu).then((dove) => {
              if (dove === 'esci') return concludi('esci');
              process.stdin.on('data', ascoltatore);
              ridisegna();
            });
            return;
          }
          if (azione.tipo === 'lettera') {
            // `r` vale solo mentre la casella si vede: altrove e' un tasto che
            // non c'e', e accenderlo di nascosto salverebbe a sorpresa.
            if (azione.valore !== 'r' || daRimandare === salvato) continue;
            ricorda = !ricorda;
            ridisegna();
            continue;
          }
          if (azione.tipo === 'freccia') {
            if (azione.valore === 'su') indice = (indice + VOCI_RIPRISTINO.length - 1) % VOCI_RIPRISTINO.length;
            else if (azione.valore === 'giu') indice = (indice + 1) % VOCI_RIPRISTINO.length;
            // Due soli stati: destra e sinistra fanno la stessa cosa, cioe'
            // passare all'altro. Chiedere quale sia "avanti" sarebbe una domanda
            // senza risposta.
            else {
              daRimandare = !daRimandare;
              // Tornati sullo stato salvato la casella sparisce: deve sparire
              // anche la spunta, o resterebbe accesa in una casella invisibile.
              if (daRimandare === salvato) ricorda = false;
            }
            ridisegna();
          }
        }
      };

      process.stdin.on('data', ascoltatore);
    });
  }

  // Chiede con quale profilo rilanciare Claude, e lo rilancia.
  //
  // La conversazione non si muove: si riprende la sessione corrente com'e', con
  // un ambiente diverso. E' l'unica cosa che dalla shell non si puo' fare, perche'
  // le variabili le legge il processo all'avvio e il processo lo possiede cb.
  //
  // Senza profili configurati spiega come si scrivono, invece di non fare niente:
  // il tasto e' annunciato nella barra, e un tasto annunciato che tace e' un tasto
  // rotto per chi lo preme.
  //
  // vista: risultato di componiVista, o null quando l'albero non c'e' — prima
  //   del primo scambio si arriva qui dall'avviso, e l'elenco si disegna da solo
  // selezione: uuid del nodo su cui sta il cursore, o null insieme a `vista`
  // ritorna: Promise<boolean> — true se Claude e' stato rilanciato (o se si e'
  //          usciti verso i selettori, cioe' l'albero non va piu' ridisegnato)
  async scegliProfilo(vista, selezione) {
    const profili = leggiProfili();
    if (profili.size === 0) {
      this.registra('nessun profilo configurato: mostro come si scrivono');
      const scelta = await this.mostraAvviso(T.wrapper.senzaProfili(percorsoImpostazioni()));
      // Anche qui le istruzioni si leggono e si torna all'avviso: e' la
      // schermata di chi i profili non li ha ancora, cioe' chi ha piu' bisogno
      // di leggere a cosa servono.
      if (scelta === 'istruzioni') {
        if ((await this.mostraIstruzioni(T.istruzioni.profili)) === 'esci') {
          this.chiudiOverlay();
          return true; // l'albero non va piu' ridisegnato
        }
        return this.scegliProfilo(vista, selezione);
      }
      if (scelta !== 'selettori') return false; // si torna all'albero
      if ((await this.cambiaConversazione()) === 'indietro') await this.mostraOverlay();
      return true;
    }

    const elenco = elencoProfili(profili);
    // Si parte da quello attivo, cosi' invio senza pensarci non cambia niente.
    let indice = Math.max(0, elenco.indexOf(this.profilo ?? null));

    // Con l'albero a schermo l'elenco ne prende il posto in fondo; senza — prima
    // del primo scambio — si disegna da solo, o non ci sarebbe niente su cui
    // appoggiarlo.
    this.inOverlay = true;
    this.apriSchermo(); // pagina nostra, su un buffer suo: niente da scorrere
    const scelto = await new Promise((risolvi) => {
      const ridisegna = () =>
        vista
          ? this.disegnaSchermata(vista, selezione, { profili: { elenco, indice } })
          : this.disegnaProfili(elenco, indice);
      this.ridisegnaOverlay = ridisegna;
      ridisegna();

      const concludi = (valore) => {
        process.stdin.off('data', ascoltatore);
        this.ridisegnaOverlay = vista ? () => this.disegnaSchermata(vista, selezione) : null;
        risolvi(valore);
      };

      const ascoltatore = (dati) => {
        for (const azione of azioniTastiera(dati)) {
          if (azione.tipo === 'annulla') return concludi(undefined);
          // Canc esce da tutto senza cambiare profilo: il processo non si tocca.
          if (azione.tipo === 'esci') return concludi('esci');
          if (azione.tipo === 'invio') return concludi(elenco[indice]);
          // Le istruzioni si leggono e si torna qui, sul profilo che era scelto.
          if (azione.tipo === 'istruzioni') {
            process.stdin.off('data', ascoltatore);
            this.mostraIstruzioni(T.istruzioni.profili).then((dove) => {
              if (dove === 'esci') return concludi('esci');
              process.stdin.on('data', ascoltatore);
              ridisegna();
            });
            return;
          }
          if (azione.tipo === 'freccia') {
            if (azione.valore === 'su') indice = (indice + elenco.length - 1) % elenco.length;
            else if (azione.valore === 'giu') indice = (indice + 1) % elenco.length;
            else continue; // destra e sinistra qui non muovono niente
            ridisegna();
          }
        }
      };

      process.stdin.on('data', ascoltatore);
    });

    if (scelto === undefined) return false; // Esc: si torna all'albero
    // Canc: fuori da tutto. Vale come "gestito", cosi' chi ci ha chiamato non
    // riapre l'albero — ma senza rilanciare niente.
    if (scelto === 'esci') {
      this.chiudiOverlay();
      return true;
    }
    if (scelto === this.profilo) {
      this.chiudiOverlay();
      return true; // gia' quello: niente da rilanciare, ma l'overlay si chiude
    }

    return this.cambiaProfilo(scelto);
  }

  // Rilancia Claude sulla conversazione corrente con un altro profilo.
  //
  // Niente taglio e niente ripristino dei file: la conversazione resta esattamente
  // dov'e'. Cambia solo l'ambiente del processo, e per farlo il processo va
  // rifatto — le variabili si leggono all'avvio.
  //
  // nome: nome del profilo, o null per l'ambiente di partenza
  // ritorna: Promise<boolean> — true se Claude e' ripartito
  async cambiaProfilo(nome) {
    const percorso = this.trovaTranscript();
    // Senza transcript la sessione non ha ancora niente da riprendere: si riparte
    // da zero, che e' comunque quello che l'utente vedrebbe.
    const riprendi = percorso ? sessioneDaPercorso(percorso) : null;

    this.registra(`cambio profilo: ${this.profilo ?? '(base)'} -> ${nome ?? '(base)'}`);
    this.scrivi(`\r\n  ${T.wrapper.profiloAttivo(nome ?? T.albero.profiloBase)}\r\n`);

    await this.chiudiProcesso();
    this.profilo = nome;
    this.inOverlay = false;
    this.chiudiSchermo();
    this.scrivi(PULISCI_SCHERMO);

    this.avviaClaude({ riprendi });
    return true;
  }

  // Disegna l'elenco dei profili da solo, senza albero sopra.
  //
  // Serve prima del primo scambio, quando l'albero non c'e': la stessa scelta
  // deve restare raggiungibile, ed e' anzi il momento in cui conviene di piu' —
  // non c'e' ancora una conversazione da portarsi dietro. Come le altre
  // schermate, la legenda sta in fondo allo schermo e non sotto l'elenco.
  // elenco: nomi dei profili, con null in testa per l'ambiente di partenza
  // indice: voce selezionata
  disegnaProfili(elenco, indice) {
    const altezza = process.stdout.rows || 30;
    const colonne = process.stdout.columns || 120;
    const pagina = ['  cb', '', `  ${T.albero.qualeProfilo}`];

    elenco.forEach((nome, i) => {
      const etichetta = nome ?? T.albero.profiloBase;
      const riga = `  ${i === indice ? '▸' : ' '} ${etichetta}`;
      pagina.push(i === indice ? arancioneForte(riga) : normale(riga));
    });

    const spazio = Math.max(1, altezza - 1);
    const pronta = pagina.slice(0, spazio);
    while (pronta.length < spazio) pronta.push('');
    // I tasti in arancione, come in ogni altra schermata.
    pronta.push(`  ${coloraTasti(primaCheEntra(T.albero.legendaProfili, colonne - 4))}`);

    this.scrivi(MOSTRA_CURSORE + PULISCI_SCHERMO);
    this.scrivi(pronta.join('\r\n'));
  }

  // Disegna l'overlay. La composizione sta in vista.js: qui si scrive soltanto,
  // con i ritorni a capo che vuole il terminale in raw mode.
  // vista: risultato di componiVista
  // selezione: uuid del nodo su cui sta il cursore
  // stato: { menu, daRimandare, ricorda } del menu di ripristino, oppure
  //   { profili } per la scelta del profilo; senza nessuno dei due si sta
  //   navigando l'albero
  disegnaSchermata(
    vista,
    selezione,
    { menu = null, daRimandare = false, ricorda = false, ricordabile = false, profili = null } = {},
  ) {
    const righe = schermata(vista, selezione, {
      colonne: process.stdout.columns || 120,
      altezza: process.stdout.rows || 30,
      ripristinaCodice: this.ripristinaCodice,
      extra: { lunga: T.albero.extraLunga, corta: T.albero.extraCorta },
      menu,
      daRimandare,
      ricorda,
      ricordabile,
      profili,
    });

    this.scrivi(PULISCI_SCHERMO);
    // Senza a capo finale: la pagina e' alta esattamente quanto lo schermo, e un
    // \r\n dopo l'ultima riga la farebbe scorrere di uno portando via
    // l'intestazione.
    this.scrivi(righe.join('\r\n'));
  }

  // Legge un tasto di navigazione dallo stdin grezzo.
  // Non uso readline perche' lo stdin e' in raw mode e condiviso col pty; i tasti
  // vanno tokenizzati e non letti a byte, o il rilascio di un tasto qualsiasi
  // verrebbe scambiato per Esc (vedi azioniTastiera).
  // ritorna: Promise<{ tipo: 'freccia', valore } | { tipo: 'conferma' } | { tipo: 'annulla' }>
  leggiNavigazione() {
    // Una sola lettura di stdin puo' contenere piu' tasti: tenendo premuta una
    // freccia arrivano in gruppo. Quelli in eccesso vanno in coda, altrimenti la
    // navigazione salta dei passi e il cursore sembra incantarsi.
    if (this.azioniInAttesa.length > 0) return Promise.resolve(this.azioniInAttesa.shift());

    return new Promise((risolvi) => {
      const ascoltatore = (dati) => {
        const azioni = azioniNavigazione(dati).map(navigazioneDa).filter(Boolean);
        if (azioni.length === 0) return; // cifre, cancella, rilasci: non navigano
        process.stdin.off('data', ascoltatore);
        this.azioniInAttesa.push(...azioni.slice(1));
        risolvi(azioni[0]);
      };

      process.stdin.on('data', ascoltatore);
    });
  }

  // Apre i selettori di cb — cartella e conversazioni — senza uscire da Claude,
  // e riparte da quello che l'utente sceglie.
  //
  // I selettori si prendono lo stdin per conto loro e alla chiusura lo lasciano
  // com'era prima (raw mode spento, flusso in pausa): qui va rimesso come lo
  // vuole il wrapper, o i tasti non arriverebbero piu' a Claude. L'ascoltatore
  // registrato in avvia() resta attaccato, e `inOverlay` gli fa ignorare tutto
  // quello che digitiamo nei selettori.
  //
  // Si comincia sempre dal navigatore delle cartelle, anche restando in questa:
  // e' la stessa schermata di `cb --scegli`, e li' dentro il tasto "r" alterna
  // gia' "avvio normale" e "ripresa". Quell'alternanza e' anche il modo di
  // cominciare una conversazione nuova senza uscire da Claude — prima non c'era,
  // perche' il selettore offre "parti da zero" solo in una cartella vuota.
  //
  // Esc risale di un passo, non esce: dall'elenco delle conversazioni si torna
  // alle cartelle, e dalle cartelle si torna alla schermata che ha aperto i
  // selettori. Una schermata aperta da un'altra deve poter tornare da dove e'
  // venuta, altrimenti sbagliare tasto costa l'uscita dall'overlay.
  // ritorna: 'indietro' se si e' usciti dal primo passo senza scegliere niente
  // I due selettori passano da qui e non sono chiamati direttamente, per lo
  // stesso motivo di `creaProcesso`: cosi' le prove possono verificare **in che
  // ordine** vengono aperti senza un terminale e senza leggere il disco. E'
  // l'ordine, non il singolo selettore, a dire se il "torna indietro" esiste.
  async apriCartelle(opzioni) {
    const { selezionaCartella } = await import('./cartelle.js');
    return selezionaCartella(opzioni);
  }

  async apriConversazioni(opzioni) {
    const { selezionaConversazione } = await import('./conversazioni.js');
    return selezionaConversazione(opzioni);
  }

  // La coda dei prompt che partono da soli a fine turno (vedi src/coda.js).
  //
  // A differenza degli altri due non porta da nessuna parte: si scrive, si
  // guarda, si torna all'albero. Il processo Claude non si tocca — i prompt li
  // consegna il pty a fine turno — quindi non c'e' niente da rilanciare.
  //
  // Lo stdin va rimesso come lo vuole il wrapper in un `finally`: la schermata,
  // come tutti i selettori, alla chiusura lo lascia com'era prima (raw mode
  // spento, flusso in pausa), e senza rimetterlo i tasti non arriverebbero piu'
  // a Claude.
  // ritorna: 'indietro' (Esc, si torna all'albero) o 'esci' (Canc, dritti a Claude)
  async mostraCoda() {
    const { apriCoda } = await import('./coda.js');
    try {
      return await apriCoda({ sessione: this.sessionId });
    } finally {
      // La coda chiude il buffer alternativo uscendo, e dietro c'e' di nuovo lo
      // schermo normale: senza riaffermarlo, l'albero che torna a video si
      // ritroverebbe in mezzo allo storico del terminale.
      this.apriSchermo();
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      process.stdin.resume();
      // Chiudendo la coda i tasti battuti qui dentro non contano come "l'utente
      // sta scrivendo a Claude": erano per cb. Senza azzerarli, il primo prompt
      // aspetterebbe un tempo che non ha motivo di aspettare.
      this.ultimoTasto = 0;
      this.rimandaConsegna();
    }
  }

  // Le note della cartella di lavoro (vedi src/note.js).
  //
  // Legate alla cartella e non alla sessione: la schermata non ha niente da
  // sapere sulla conversazione in corso, e le stesse note si vedono da ogni
  // sessione aperta li' dentro.
  //
  // Con ctrl+invio il corpo della nota finisce **nella barra di input, non
  // inviato**: si torna a Claude e il testo e' li', pronto da correggere,
  // completare o mandare con un invio. E' la stessa cosa che fa il ripristino
  // quando rimette indietro un prompt (`programmaBarra`), e la differenza con la
  // coda e' tutta qui — la coda manda, questo consegna.
  //
  // La barra si svuota prima: quello che c'era va sostituito, non allungato.
  //
  // Lo stdin va rimesso come lo vuole il wrapper in un `finally`, come per tutti
  // i selettori.
  // ritorna: 'indietro' (Esc, si torna all'albero) o 'esci' (Canc, o una nota
  //          consegnata: si torna a Claude, dove il testo aspetta nella barra)
  // Apre la schermata delle note. Metodo a parte, come `apriCartelle`: i moduli
  // ESM sono in sola lettura e non si possono sostituire da fuori, quindi senza
  // questo le prove non potrebbero verificare **cosa arriva al pty** senza aprire
  // davvero una schermata che si prende lo stdin.
  // ritorna: quello che restituisce apriNote
  async apriNote() {
    const { apriNote } = await import('./note.js');
    return apriNote({ cartella: this.cwd });
  }

  async mostraNote() {
    try {
      const esito = await this.apriNote();
      if (typeof esito === 'string') return esito;
      // Su piu' righe va incollato: gli a capo grezzi verrebbero letti come
      // invii, cioe' proprio la cosa che questo modo esiste per non fare.
      const testo = esito.manda.includes('\n')
        ? `${INIZIO_INCOLLA}${esito.manda}${FINE_INCOLLA}`
        : esito.manda;
      this.processo?.write(SVUOTA_BARRA);
      this.processo?.write(testo);
      this.registra(`note: nota messa nella barra (${esito.manda.length} caratteri), non inviata`);
      return 'esci';
    } finally {
      // Come per la coda: uscendo, le note rimettono il buffer normale.
      this.apriSchermo();
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      process.stdin.resume();
      // Come per la coda: i tasti battuti dentro cb non sono "l'utente sta
      // scrivendo a Claude", e la nota appena mandata non deve aspettare per
      // colpa loro.
      this.ultimoTasto = 0;
      this.rimandaConsegna();
    }
  }

  async cambiaConversazione() {
    const { annotaCartellaScelta } = await import('./cartelle.js');

    // Lo stdin torna al wrapper comunque vada: anche annullando, anche in errore.
    const restituisciTastiera = () => {
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      process.stdin.resume();
    };

    let cartella = this.cwd;
    try {
      let conversazione = null;

      // Il ciclo e' il "torna indietro": uscendo dall'elenco delle conversazioni
      // si ricomincia dalle cartelle invece di chiudere tutto.
      while (!conversazione) {
        const scelta = await this.apriCartelle({
          cwd: cartella,
          ripresa: true,
          profilo: this.profilo,
        });
        // Canc: si torna dritti a Claude, saltando le schermate da cui si era
        // passati. Lo schermo va restituito qui — chi ci ha chiamato, vedendo
        // 'esci', non riapre niente e non chiuderebbe l'overlay per noi.
        if (scelta === 'esci') {
          this.chiudiOverlay();
          return 'esci';
        }
        if (!scelta) return 'indietro'; // esc sul primo passo: decide chi ci ha chiamato
        cartella = scelta.percorso;
        // Il profilo scelto nel navigatore vale per il processo che nascera' da
        // qui: si applica prima di lanciarlo, non dopo.
        if (scelta.profilo !== this.profilo) {
          this.registra(`profilo dal navigatore: ${this.profilo ?? '(base)'} -> ${scelta.profilo ?? '(base)'}`);
          this.profilo = scelta.profilo;
        }

        // "Avvio normale" nel navigatore vuol dire non riprendere niente: si
        // comincia una conversazione nuova in quella cartella, senza passare
        // dall'elenco di quelle passate.
        if (!scelta.ripresa) {
          conversazione = { nuova: true };
          break;
        }

        conversazione = await this.apriConversazioni({
          cartella,
          ripristinaCodice: this.ripristinaCodice,
        });
        // Canc dall'elenco non risale alle cartelle come farebbe Esc: esce da
        // tutto. Va intercettato qui dentro il ciclo, o il `while` lo tratterebbe
        // come "non hai ancora scelto" e riaprirebbe il navigatore.
        if (conversazione === 'esci') {
          this.chiudiOverlay();
          return 'esci';
        }
      }

      this.registra(
        `cambio conversazione cartella=${cartella} modo=${conversazione.modo ?? '-'} ` +
          `scelta=${conversazione.nuova ? 'nuova' : (conversazione.riprendi ?? 'taglio')}`,
      );

      // Serve al ripristino dei file e al cambio ramo: le copie di un ramo vecchio
      // stanno nell'archivio della sessione che lo ha scritto.
      if (conversazione.alberi) this.alberiFamiglia = conversazione.alberi;

      // La cartella nuova vale per lo spawn di Claude, per la ricerca dei
      // transcript e per il titolo della tab: sono tutti derivati da this.cwd.
      // Va segnata anche per la shell, che a fine sessione ci si sposta.
      this.cwd = cartella;
      this.titolo = path.basename(cartella);
      annotaCartellaScelta(cartella);

      // Il processo si chiude prima di scoprire lo schermo: finche' e' vivo
      // continua a disegnare, e lo si vedrebbe lampeggiare sotto.
      await this.chiudiProcesso();
      this.inOverlay = false;
      this.chiudiSchermo();
      this.scrivi(PULISCI_SCHERMO);

      if (conversazione.nuova) {
        // Nessuna conversazione da riprendere in quella cartella: si comincia.
        this.percorsoOrigine = null;
        this.uuidRipreso = null;
        this.avviaClaude();
        return;
      }

      if (conversazione.riprendi) {
        this.percorsoOrigine = conversazione.percorso;
        this.uuidRipreso = conversazione.voce?.uuid ?? null;

        // "Solo il codice": la conversazione riparte dov'era, i file tornano al
        // punto scelto nell'albero.
        if (conversazione.modo === 'codice' && conversazione.voce) {
          const esito = await this.ripristinaFile(
            conversazione.albero,
            conversazione.voce.uuid,
            conversazione.percorso,
            conversazione.daRimandare,
          );
          this.registra(`ripristino solo codice da selettore: ${esito.riassunto}`);
          this.scrivi(`  ${esito.riassunto}\r\n`);
        }

        this.avviaClaude({ riprendi: conversazione.riprendi });
        return;
      }

      const ripartito = await this.cambiaRamo(
        conversazione.percorso,
        conversazione.albero,
        conversazione.voce,
        conversazione.modo ?? 'entrambi',
        conversazione.daRimandare,
      );
      // Il messaggio d'errore l'ha gia' scritto cambiaRamo: qui resta da non
      // lasciare l'utente senza Claude.
      if (!ripartito) this.avviaClaude();
    } finally {
      restituisciTastiera();
    }
  }

  // Chiude il processo corrente e ne apre uno nuovo forkato dal punto scelto.
  // Vale anche all'avvio, quando un processo ancora non c'e': e' il modo in cui
  // cb riprende una conversazione scelta dal selettore (vedi src/conversazioni.js).
  // percorso: transcript della sessione corrente
  // albero: risultato di leggiTranscript
  // voce: nodo prompt scelto
  // modo: 'entrambi' | 'conversazione' | 'codice' — cosa riportare indietro
  // daRimandare: se il prompt scelto esce dalla conversazione e torna nella barra
  //   di input ancora da mandare. Sposta il taglio prima del prompt e riporta i
  //   file a com'erano prima di quel turno; con 'codice' vale solo la seconda
  //   meta', cioe' se le modifiche di quel turno restano o se ne vanno.
  // ritorna: true se Claude e' ripartito, false se qualcosa e' andato storto
  async cambiaRamo(percorso, albero, voce, modo = 'entrambi', daRimandare = false) {
    // Il nodo scelto puo' vivere solo nel file di una sessione antenata: in quel
    // caso si riparte da quella, non da quella corrente.
    const origine = this.scegliOrigine(albero, voce, percorso);
    const sessionePartenza = origine.sessionId;
    const alberoOrigine = this.alberiFamiglia?.get(origine.percorso) ?? albero;

    // Solo il codice: la conversazione resta dov'e', quindi non c'e' niente da
    // chiudere e niente da tagliare. Claude resta vivo e si limita a rileggere i
    // file la prossima volta che li apre.
    if (modo === 'codice') {
      const esito = await this.ripristinaFile(
        alberoOrigine,
        voce.uuid,
        origine.percorso,
        daRimandare,
      );
      this.registra(`ripristino solo codice uuid=${voce.uuid} esito=${esito.riassunto}`);
      this.chiudiOverlay();
      this.lampeggia(`cb: ${esito.riassunto}`);
      return true;
    }

    this.scrivi(`\r\n  ${T.wrapper.ripartoDa(voce.testo.replace(/\s+/g, ' ').slice(0, 60))}\r\n`);
    if (origine.sessionId !== this.sessionId) {
      this.scrivi(`  ${T.wrapper.ramoDiSessione(String(sessionePartenza).slice(0, 8))}\r\n`);
    }
    this.registra(`cambioRamo uuid=${voce.uuid} da sessione=${sessionePartenza}`);

    // Chiudo Claude e ASPETTO che sia uscito: uscendo scrive un ultimo
    // last-prompt, che sovrascriverebbe la riattivazione del ramo e la
    // renderebbe inefficace (--resume-session-at e --rewind-files non
    // troverebbero piu' il messaggio).
    await this.chiudiProcesso();

    // Punto di taglio: il prompt scelto con la sua risposta, senza i turni
    // successivi. Serve sia per il file della nuova sessione sia per il rewind.
    const nodoOrigine = alberoOrigine.nodi.get(voce.uuid);
    if (!nodoOrigine) {
      this.inOverlay = false;
      this.lampeggia(`cb: ${T.wrapper.messaggioAltrove}`);
      return false;
    }
    // Col prompt da rimandare il taglio cade PRIMA del prompt scelto: quel turno
    // esce dalla conversazione e il suo testo torna nella barra di input, non
    // inviato. Senza padre il prompt era il primo della conversazione, e prima
    // di lui non c'e' niente da riprendere.
    this.fineTurno = daRimandare ? nodoOrigine.parentUuid : fineDelTurno(nodoOrigine).uuid;

    // Il rewind dei file cerca il messaggio nella catena attiva della sessione di
    // partenza: se il ramo era in disparte va prima riattivato.
    try {
      await this.riattivaConVerifica(origine.percorso, alberoOrigine, voce.uuid);
    } catch (errore) {
      this.inOverlay = false;
      this.lampeggia(`cb: ${errore.message}`);
      return false;
    }

    // Riporta anche i file allo stato di quel messaggio. Senza questo la
    // conversazione torna indietro ma il codice resta quello di adesso, e Claude
    // si limita a suggerire il comando da lanciare a mano.
    if (modo !== 'conversazione') {
      this.scrivi(`  ${T.wrapper.ripristinoFile}\r\n`);
      const esito = await this.ripristinaFile(
        alberoOrigine,
        voce.uuid,
        origine.percorso,
        daRimandare,
      );
      this.registra(`ripristino file ok=${esito.ok} esito=${esito.riassunto}`);

      const messaggio = esito.ok
        ? esito.riassunto
        : T.wrapper.fileNonRipristinati(esito.riassunto);
      this.scrivi(`  ${messaggio}\r\n`);
      await new Promise((r) => setTimeout(r, esito.ok ? 800 : 3000));
    }

    // Il taglio della conversazione lo fa cb, creando una sessione che finisce
    // al turno scelto: in interattivo il CLI ignora i flag di troncamento.
    // Niente da tagliare quando il taglio cade prima del primo prompt: la
    // conversazione ricomincia da zero, col solo prompt nella barra.
    let ramo = null;
    if (this.fineTurno && alberoOrigine.nodi.has(this.fineTurno)) {
      try {
        ramo = await creaSessioneTroncata(origine.percorso, this.fineTurno);
        this.registra(`sessione troncata creata: ${ramo.sessionId} fino a ${this.fineTurno}`);
      } catch (errore) {
        this.inOverlay = false;
        this.lampeggia(`cb: ${T.wrapper.ramoNonCreato(errore.message)}`);
        return false;
      }
    } else {
      this.registra(`nessun turno prima di ${voce.uuid}: si riparte da una sessione nuova`);
    }

    this.inOverlay = false;
    this.chiudiSchermo();
    this.scrivi(PULISCI_SCHERMO);

    // La nuova sessione ha gia' il suo file, e condivide la radice con l'origine:
    // l'albero della famiglia continuera' a mostrare tutti i rami.
    this.percorsoOrigine = origine.percorso;
    this.uuidRipreso = voce.uuid;

    this.avviaClaude({
      riprendi: ramo?.sessionId ?? null,
      prompt: daRimandare ? nodoOrigine.testo : null,
    });
    return true;
  }

  // Termina il processo Claude e attende che sia davvero uscito.
  // kill() e' asincrono: senza attendere, le scritture di Claude in chiusura
  // arriverebbero dopo le nostre e le annullerebbero.
  // ritorna: Promise che si risolve a processo chiuso (o dopo un'attesa massima)
  chiudiProcesso() {
    if (!this.processo) return Promise.resolve();

    // Nessun tracciamento deve sopravvivere al processo: quello che parte dopo
    // accende i suoi modi, e uno in piu' gli farebbe arrivare eventi che non si
    // aspetta. Qui si passa da ogni uscita dell'albero che non sia
    // chiudiOverlay — cambio ramo, profilo, conversazione.
    this.spegniMouse();
    // Stessa ragione per il conto della coda: scattando dopo il kill scriverebbe
    // in un pty morto, o peggio nel processo che nasce subito dopo, che sta
    // ancora avviandosi. Vale identico per la sveglia del reset dei token, che
    // dorme per ore ed e' quindi quella con piu' probabilita' di svegliarsi in un
    // mondo cambiato.
    clearTimeout(this.timerCoda);
    clearTimeout(this.timerRisveglio);
    this.timerRisveglio = null;

    const attesa = new Promise((risolvi) => {
      this.risolviUscita = risolvi;
      // Rete di sicurezza: se l'uscita non venisse notificata non restiamo bloccati.
      setTimeout(() => {
        if (this.risolviUscita === risolvi) {
          this.risolviUscita = null;
          risolvi();
        }
      }, 5000);
    });

    this.uscitaVolontaria = true;
    this.processo.kill();
    this.processo = null;
    return attesa;
  }

  // Riattiva il ramo e verifica che la riattivazione sia rimasta in piedi.
  // Anche dopo l'uscita del processo qualche scrittura puo' arrivare in ritardo:
  // se il ramo attivo non e' quello atteso si riprova.
  // percorso: transcript su cui scrivere
  // albero: albero di QUEL file
  // uuid: nodo da rendere raggiungibile
  async riattivaConVerifica(percorso, albero, uuid) {
    for (let tentativo = 0; tentativo < 3; tentativo += 1) {
      const alberoCorrente = tentativo === 0 ? albero : await leggiTranscript(percorso);
      const foglia = attivaRamoDi(percorso, alberoCorrente, uuid);
      if (!foglia) return; // era gia' nel ramo attivo: niente da verificare

      await new Promise((r) => setTimeout(r, 250));
      const dopo = await leggiTranscript(percorso);
      if (dopo.leafAttivo === foglia) {
        this.registra(`riattivazione confermata al tentativo ${tentativo + 1}: ${foglia}`);
        return;
      }
      this.registra(`riattivazione sovrascritta (atteso ${foglia}, trovato ${dopo.leafAttivo})`);
    }
    throw new Error(T.wrapper.ramoNonFissato);
  }

  // Sceglie da quale sessione ripartire per un nodo dell'albero unito.
  // Preferisce la sessione corrente, cosi' il caso normale non cambia; se il
  // nodo appartiene solo a un antenato usa quello.
  // albero: albero (eventualmente unito)
  // voce: nodo prompt scelto
  // percorsoCorrente: transcript della sessione in corso
  // ritorna: { sessionId, percorso }
  scegliOrigine(albero, voce, percorsoCorrente) {
    const origini = albero.nodi.get(voce.uuid)?.origini;
    if (!origini || origini.length === 0) {
      // Ripiego sul file da cui abbiamo letto l'albero: e' quello che contiene
      // il nodo. Usare this.sessionId sarebbe sbagliato, perche' subito dopo un
      // fork quella sessione non ha ancora un transcript.
      return { sessionId: sessioneDaPercorso(percorsoCorrente), percorso: percorsoCorrente };
    }
    return origini.find((o) => o.sessionId === this.sessionId) ?? origini[0];
  }

  // Riporta i file di lavoro allo stato che avevano alla fine di un turno,
  // leggendo l'archivio di copie di Claude Code (vedi src/codice.js).
  //
  // Prima cb chiamava il ripristino nativo (`--resume <id> --rewind-files <uuid>`
  // con CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=1). Leggere l'archivio invece
  // di chiamarlo evita di lanciare un processo Claude a ogni cambio ramo, e
  // soprattutto permette di guardare le copie di TUTTA la famiglia di sessioni:
  // il flag nativo ne conosce una sola, mentre i rami di una conversazione stanno
  // in file diversi.
  //
  // Il punto a cui riportare i file e' la FINE del turno, non il prompt: cb tiene
  // il prompt scelto insieme alla sua risposta, quindi il codice deve contenere
  // anche le modifiche fatte in quel turno. Il menu nativo si ferma invece prima
  // del prompt, perche' lo fa rieseguire.
  //
  // albero: albero della sessione che contiene il nodo
  // uuid: uuid del prompt scelto
  // percorsoOrigine: transcript di quella sessione, se la famiglia non e' nota
  // prima: riporta i file a com'erano PRIMA del turno invece che alla sua fine.
  //   Serve al modo 'prompt', dove il turno esce dalla conversazione e il prompt
  //   torna nella barra: le modifiche di quel turno non devono esserci piu'.
  // ritorna: Promise<{ ok, riassunto, esito }>
  async ripristinaFile(albero, uuid, percorsoOrigine = null, prima = false) {
    const nodo = albero.nodi.get(uuid);
    const riferimento = prima ? nodo : nodo ? fineDelTurno(nodo) : null;
    const istante = Date.parse(riferimento?.timestamp ?? nodo?.timestamp ?? '');
    if (Number.isNaN(istante)) {
      return { ok: false, riassunto: T.wrapper.senzaOrario };
    }

    // Tutte le sessioni della famiglia: le copie di un ramo vecchio stanno
    // nell'archivio della sessione che lo ha scritto, non in quello della
    // sessione corrente.
    const famiglia = [...(this.alberiFamiglia?.keys() ?? [])];
    const percorsiSessione = famiglia.length > 0 ? famiglia : [percorsoOrigine].filter(Boolean);

    // Ripiego per le copie scadute: lo storico dei commit automatici, se l'hook
    // e' installato e siamo in un repo. Vale null quando non c'e' niente da
    // ripiegare, e il ripristino si comporta come prima.
    const ripiego = ripiegoDaiCommit(this.cwd, uuid, istante);

    try {
      const esito = await ripristinaA({ percorsiSessione, istante, radice: this.cwd, ripiego });
      return { ok: true, riassunto: riassumiRipristino(esito), esito };
    } catch (errore) {
      return { ok: false, riassunto: errore.message };
    }
  }

  // Legge un numero dallo stdin grezzo, con eco e cancellazione.
  // Non uso readline perche' lo stdin e' in raw mode e condiviso col pty.
  // massimo: valore massimo accettato
  // ritorna: indice 0-based, o null se l'utente annulla o sbaglia
  leggiNumero(massimo) {
    return new Promise((risolvi) => {
      let digitato = '';

      const ascoltatore = (dati) => {
        for (const azione of azioniTastiera(dati)) {
          if (azione.tipo === 'invio') {
            process.stdin.off('data', ascoltatore);
            const numero = Number.parseInt(digitato, 10);
            const valido = Number.isInteger(numero) && numero >= 1 && numero <= massimo;
            risolvi(valido ? numero - 1 : null);
            return;
          }
          if (azione.tipo === 'annulla') {
            process.stdin.off('data', ascoltatore);
            risolvi(null);
            return;
          }
          if (azione.tipo === 'cancella') {
            if (digitato.length > 0) {
              digitato = digitato.slice(0, -1);
              this.scrivi('\b \b');
            }
            continue;
          }
          if (azione.tipo === 'cifra') {
            digitato += azione.valore;
            this.scrivi(azione.valore);
          }
        }
      };

      process.stdin.on('data', ascoltatore);
    });
  }

  // Mostra un messaggio breve senza distruggere lo schermo di Claude.
  // Va scritto sul buffer normale, dove quello schermo sta: scritto su quello
  // alternativo sparirebbe insieme alla pagina di cb, e l'errore che ha fermato
  // il cambio ramo non lo leggerebbe nessuno.
  lampeggia(messaggio) {
    this.chiudiSchermo();
    this.scrivi(`\r\n${messaggio}\r\n`);
    this.forzaRidisegno();
  }

  // Gestisce i tasti premuti dall'utente, decidendo cosa inoltrare a Claude.
  //
  // I byte vanno tokenizzati e non confrontati come blocco: premendo Esc Esc in
  // rapida successione i due tasti arrivano in una sola lettura, e trattare il
  // buffer come un tasto unico li lascerebbe passare a Claude, che aprirebbe il
  // proprio menu di ripristino.
  gestisciInput(dati) {
    if (this.inOverlay) return; // in overlay legge leggiNumero

    // Quando hai battuto l'ultimo tasto: finche' stai scrivendo, la coda non
    // inietta niente. Senza, il prompt accodato si mescolerebbe a quello che stai
    // digitando e l'invio manderebbe il miscuglio.
    this.ultimoTasto = Date.now();
    this.rimandaConsegna();

    const token = tokenizza(dati);

    if (this.diagnostica) {
      const esadecimale = [...dati].map((b) => b.toString(16).padStart(2, '0')).join(' ');
      const letti = token
        .map((t) =>
          t.tasto
            ? `vk=${t.tasto.vk}${t.tasto.ctrl ? '+ctrl' : ''}${t.tasto.rilascio ? ' (su)' : ''}`
            : 'altro',
        )
        .join(', ');
      this.registra(`tasti  ${esadecimale}  ->  ${letti}`);
      this.scrivi(`\r\n[cb] ${esadecimale}  ->  ${letti}\r\n`);
    }
    const { pressioni, consumati } = contaInTesta(token, this.scorciatoia);
    const richieste = this.scorciatoia.ripetizioni;

    // Scorciatoia a tasto singolo: scatta subito, senza attese.
    if (richieste === 1) {
      if (pressioni >= 1) {
        const coda = token.slice(consumati);
        if (coda.length > 0) this.inoltra(Buffer.concat(coda.map((t) => t.bytes)));
        this.mostraOverlay();
        return;
      }
      this.inoltra(dati);
      return;
    }

    // Scorciatoia ripetuta (es. Esc Esc): le pressioni possono arrivare tutte
    // nella stessa lettura, in letture separate, o **a cavallo dell'attesa** —
    // cioe' quando la prima e' gia' stata inoltrata a Claude perche' il timer e'
    // scattato. Il conteggio dura un secondo intero e non si azzera all'inoltro:
    // e' cosi' che una coppia battuta piano resta di cb invece di arrivare a
    // Claude come due Esc separati, che lui rimetterebbe insieme.
    if (pressioni > 0) {
      const adesso = Date.now();
      const scaduta =
        this.ultimaPressione === null || adesso - this.ultimaPressione > FINESTRA_SCORCIATOIA;
      this.pressioniRecenti = (scaduta ? 0 : this.pressioniRecenti) + pressioni;
      this.ultimaPressione = adesso;
    }

    const inAttesa = this.pressioniInAttesa ?? 0;
    if (pressioni > 0 && Math.max(inAttesa + pressioni, this.pressioniRecenti) >= richieste) {
      clearTimeout(this.timerEsc);
      this.timerEsc = null;
      this.pressioniInAttesa = 0;
      this.byteTrattenuti = null; // scartati: erano parte della scorciatoia
      // Le pressioni sono state spese: senza azzerare, il prossimo Esc singolo
      // riaprirebbe l'albero da solo.
      this.pressioniRecenti = 0;
      this.ultimaPressione = null;

      const coda = token.slice(consumati);
      if (coda.length > 0) this.inoltra(Buffer.concat(coda.map((t) => t.bytes)));
      this.mostraOverlay();
      return;
    }

    // Solo il rilascio del tasto della scorciatoia, mentre stiamo aspettando la
    // pressione successiva: lo trattengo senza azzerare l'attesa.
    if (inAttesa > 0 && soloRilasci(token, this.scorciatoia)) {
      this.byteTrattenuti = Buffer.concat([this.byteTrattenuti ?? Buffer.alloc(0), dati]);
      return;
    }

    // Pressione parziale: la trattengo per capire se la sequenza si completa.
    if (pressioni > 0 && consumati === token.length) {
      clearTimeout(this.timerEsc);
      this.pressioniInAttesa = inAttesa + pressioni;
      this.byteTrattenuti = Buffer.concat([this.byteTrattenuti ?? Buffer.alloc(0), dati]);
      // Il timer legge i byte allo scatto, non alla creazione: nel frattempo
      // possono essersi aggiunti gli eventi di rilascio.
      this.timerEsc = setTimeout(() => this.svuotaTrattenuti(), ATTESA_DOPPIO_ESC);
      return;
    }

    // Non e' la scorciatoia. Se c'erano tasti trattenuti vanno inoltrati prima,
    // per non invertire l'ordine di battitura.
    this.svuotaTrattenuti();
    this.inoltra(dati);
  }

  // Inoltra a Claude i tasti trattenuti in attesa della scorciatoia e azzera
  // lo stato di attesa.
  svuotaTrattenuti() {
    clearTimeout(this.timerEsc);
    this.timerEsc = null;
    this.pressioniInAttesa = 0;
    if (this.byteTrattenuti) {
      const dati = this.byteTrattenuti;
      this.byteTrattenuti = null;
      this.inoltra(dati);
    }
  }

  // Inoltra byte al processo Claude.
  inoltra(dati) {
    this.processo?.write(dati.toString('binary'));
  }

  // Ripristina il terminale ed esce.
  //
  // I modi di input li ha accesi Claude e di norma li spegne lui uscendo: qui si
  // rifa' comunque, perche' quando l'uscita non e' la sua — processo ucciso con
  // l'overlay a schermo — resterebbero accesi e la shell diventerebbe
  // inutilizzabile (vedi SPEGNI_MODI_INPUT).
  chiudi(codice) {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    this.scrivi(SPEGNI_MODI_INPUT);
    process.exit(codice);
  }

  // Avvia il wrapper: collega il terminale e lancia il primo processo Claude.
  //
  // ripartenza: conversazione scelta nel selettore (src/conversazioni.js), nella
  //   forma prodotta da esitoScelta: { percorso, albero, alberi, voce, riprendi }.
  //   Con `riprendi` valorizzato il punto scelto e' gia' la fine della
  //   conversazione e basta riprenderla; altrimenti si passa dalla stessa strada
  //   del cambio ramo, che taglia al turno scelto e riporta indietro i file.
  async avvia({ ripartenza = null } = {}) {
    if (!process.stdin.isTTY) {
      throw new Error(T.wrapper.serveTerminale);
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (dati) => this.gestisciInput(dati));

    process.stdout.on('resize', () => this.ridimensiona());

    if (ripartenza?.riprendi) {
      this.percorsoOrigine = ripartenza.percorso;
      this.uuidRipreso = ripartenza.voce?.uuid ?? null;
      this.avviaClaude({ riprendi: ripartenza.riprendi });
      return;
    }

    if (ripartenza?.voce) {
      // Ogni file della famiglia va riattivato con il proprio albero, non con
      // quello unito: e' il vincolo di riattivaConVerifica.
      this.alberiFamiglia = ripartenza.alberi;
      // Il modo scelto nel selettore va passato: senza, ogni ripresa da fuori
      // ricadeva su 'entrambi' e ignorava la voce scelta nel menu.
      const ripartito = await this.cambiaRamo(
        ripartenza.percorso,
        ripartenza.albero,
        ripartenza.voce,
        ripartenza.modo,
        ripartenza.daRimandare,
      );
      // Se il ripristino non e' riuscito il messaggio l'ha gia' scritto
      // cambiaRamo: qui resta da non lasciare l'utente senza Claude.
      if (!ripartito) this.avviaClaude();
      return;
    }

    this.avviaClaude();
  }
}
