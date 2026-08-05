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
import { componiVista, schermata, muovi, puntaRamoAttivo, VOCI_RIPRISTINO } from './vista.js';
import { attivaRamoDi, fineDelTurno } from './attiva.js';
import { ripristinaA, riassumiRipristino } from './codice.js';
import { ripiegoDaiCommit } from './commit.js';
import { senzaTitolo, sequenzaTitolo } from './titolo.js';
import { impostazione } from './impostazioni.js';
import { T } from './lingua.js';
import { creaSessioneTroncata } from './ramo.js';
import {
  tokenizza,
  contaInTesta,
  analizzaScorciatoia,
  soloRilasci,
  azioniTastiera,
  azioniNavigazione,
} from './tasti.js';

// Sequenze ANSI usate dall'overlay. Nominate perche' scritte come caratteri di
// controllo nel sorgente sarebbero invisibili in fase di lettura.
const PULISCI_SCHERMO = '[2J[H';
const MOSTRA_CURSORE = '[?25h';

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

// Modi di tracciamento del mouse che una TUI puo' accendere. Finche' sono accesi
// il terminale manda movimenti e clic all'applicazione invece di selezionare il
// testo: con l'overlay a schermo non si riusciva a copiare niente, perche' cb
// quegli eventi li scarta e basta.
//
// Quali siano accesi non si indovina: si guarda cosa Claude ha chiesto
// (`osservaMouse`) e si rimette esattamente quello alla chiusura dell'overlay.
const MODI_MOUSE = [1000, 1002, 1003, 1005, 1006, 1015, 1016];
const RE_MODO_MOUSE = new RegExp(`\\x1b\\[\\?(${MODI_MOUSE.join('|')})([hl])`, 'g');

// La sequenza piu' lunga fra quelle cercate e' `ESC[?1016h`, nove caratteri:
// conservando la coda della lettura precedente, una sequenza spezzata fra due
// blocchi di output viene riconosciuta lo stesso.
const CODA_MOUSE = 9;

// Millisecondi di attesa dopo il primo Esc per capire se ne arriva un secondo.
// Trattenere il primo Esc e' necessario: se lo inoltrassimo subito, Claude
// aprirebbe il proprio menu di ripristino prima che il secondo arrivi.
// Il costo e' questo ritardo su un Esc singolo (interruzione).
const ATTESA_DOPPIO_ESC = 300;

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
  if (comando === 'conversazione') return { tipo: 'conversazione' };
  if (comando === 'progetto') return { tipo: 'progetto' };
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
  constructor({
    cwd = process.cwd(),
    argomentiExtra = [],
    scorciatoia = 'esc esc',
    ripristinaCodice = true,
    titolo = null,
    diagnostica = false,
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
    this.mouseAcceso = new Set(); // modi mouse che Claude ha chiesto, per rimetterli
    this.codaMouse = ''; // fine dell'ultimo blocco, per le sequenze spezzate
    this.timerEsc = null;
    this.pressioniInAttesa = 0; // pressioni della scorciatoia gia' viste
    this.byteTrattenuti = null; // byte da inoltrare se la sequenza non si completa
    this.uscitaVolontaria = false; // distingue il kill nostro dall'uscita utente
    this.azioniInAttesa = []; // tasti di navigazione arrivati in gruppo
    this.ridisegnaOverlay = null; // come ridisegnare l'overlay aperto, se c'e'
    this.timerRidimensiona = null;
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
      env: process.env,
    });
  }

  // Lancia un processo Claude.
  // riprendi: id di una sessione da riprendere (creata da cb, gia' tagliata al
  //   punto scelto). Se assente, parte una sessione nuova.
  avviaClaude({ riprendi = null } = {}) {
    this.sessionId = riprendi ?? randomUUID();
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
      if (!this.inOverlay) this.scrivi(senzaTitolo(dati));
    });

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

  // Forza Claude a ridisegnare l'interfaccia dopo che l'overlay l'ha coperta.
  // Una variazione di dimensione fa ripartire il layout di Ink: e' l'unico modo
  // affidabile, Claude non risponde a una richiesta di refresh.
  forzaRidisegno() {
    const colonne = process.stdout.columns || 120;
    const righe = process.stdout.rows || 30;
    this.processo?.resize(Math.max(20, colonne - 1), righe);
    setTimeout(() => this.processo?.resize(colonne, righe), 40);
  }

  // Chiude l'overlay e restituisce il terminale a Claude.
  chiudiOverlay() {
    this.inOverlay = false;
    this.ridisegnaOverlay = null; // da qui in poi lo schermo e' di Claude
    clearTimeout(this.timerRidimensiona);
    this.mouse(true); // lo schermo torna a Claude, e il mouse e' suo
    this.scrivi(PULISCI_SCHERMO);
    this.forzaRidisegno();
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
  // ritorna: Promise<'selettori' | null> — null se si torna a Claude
  mostraAvviso(righe) {
    this.inOverlay = true;
    this.mouse(false); // schermo nostro: il mouse torni a selezionare il testo
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
      pronta.push(`  ${T.wrapper.tastiAvviso}`);

      this.scrivi(MOSTRA_CURSORE + PULISCI_SCHERMO);
      this.scrivi(pronta.join('\r\n'));
    };

    this.ridisegnaOverlay();

    return new Promise((risolvi) => {
      const ascoltatore = (dati) => {
        for (const comando of azioniNavigazione(dati)) {
          if (comando === 'conversazione' || comando === 'progetto') {
            process.stdin.off('data', ascoltatore);
            return risolvi('selettori');
          }
          if (comando === 'conferma' || comando === 'annulla') {
            process.stdin.off('data', ascoltatore);
            return risolvi(null);
          }
        }
      };
      process.stdin.on('data', ascoltatore);
    });
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
  // ritorna: percorso del .jsonl, o null se non esiste ancora
  trovaTranscript() {
    const nostro = this.sessionId ? percorsoTranscript(this.sessionId, this.cwd) : null;
    const recente = transcriptPiuRecente(this.cwd, this.avviatoIl ?? 0);

    if (nostro && recente && recente.sessionId !== this.sessionId) {
      if (scrittoDopo(recente.percorso, nostro)) {
        this.registra(`sessione cambiata: ${this.sessionId} -> ${recente.sessionId}`);
        this.sessionId = recente.sessionId;
        return recente.percorso;
      }
    }

    // Il nostro file, quando c'e', e' quello giusto: appena avviati, e subito
    // dopo un cambio ramo — li' il file della sessione troncata lo ha scritto cb
    // prima di rilanciare, quindi e' piu' vecchio di `avviatoIl` e non comparirebbe
    // fra i recenti.
    if (nostro) return nostro;

    // Nessun file nostro: la sessione l'ha scelta Claude (--resume, --continue) e
    // si scopre dal disco.
    if (recente) {
      if (recente.sessionId !== this.sessionId) {
        this.registra(`sessione scoperta dal disco: ${recente.sessionId}`);
        this.sessionId = recente.sessionId;
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
      const scelta = await this.mostraAvviso(
        T.wrapper.senzaTranscript(this.descrizioneScorciatoia, this.sessionId),
      );
      if (scelta === 'selettori') await this.cambiaConversazione();
      else this.chiudiOverlay();
      return;
    }

    this.inOverlay = true;
    this.mouse(false); // schermo nostro: il mouse torni a selezionare il testo
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
      const scelta = await this.mostraAvviso(T.wrapper.senzaMessaggi(this.sessionId, percorso));
      if (scelta === 'selettori') await this.cambiaConversazione();
      else this.chiudiOverlay();
      return;
    }

    let selezione = puntaRamoAttivo(vista);
    let voce = null;
    let modo = null;

    // Ciclo di navigazione: disegna, aspetta un tasto, ridisegna.
    for (;;) {
      // Il ridisegno si registra a ogni giro perche' la selezione cambia: cosi'
      // un ridimensionamento della finestra ridisegna con il cursore giusto.
      this.ridisegnaOverlay = () => this.disegnaSchermata(vista, selezione);
      this.ridisegnaOverlay();
      const azione = await this.leggiNavigazione();

      if (azione.tipo === 'annulla') {
        this.registra('overlay chiuso senza scegliere');
        this.chiudiOverlay();
        return;
      }
      if (azione.tipo === 'conferma') {
        // Invio non riparte piu' subito: prima si sceglie cosa riportare
        // indietro. Esc nel menu torna all'albero, non chiude l'overlay.
        modo = await this.scegliModoRipristino(vista, selezione);
        if (!modo) continue;
        voce = vista.perUuid.get(selezione);
        break;
      }
      // Da qui si esce dalla conversazione corrente: si sceglie un'altra
      // conversazione della stessa cartella, o prima un'altra cartella.
      if (azione.tipo === 'conversazione' || azione.tipo === 'progetto') {
        await this.cambiaConversazione();
        return;
      }
      selezione = muovi(vista, selezione, azione.valore);
    }

    this.registra(
      `scelta uuid=${voce.uuid} modo=${modo} testo="${testoLeggibile(voce.testo).slice(0, 40)}"`,
    );
    await this.cambiaRamo(percorso, albero, voce, modo);
  }

  // Chiede cosa riportare indietro dal punto scelto: la conversazione, il codice
  // o tutti e due. Sono le stesse tre voci del menu nativo di Claude.
  //
  // Si legge con azioniTastiera e non con leggiNavigazione perche' qui servono
  // anche le cifre, che la navigazione dell'albero scarta.
  //
  // vista: risultato di componiVista
  // selezione: uuid del nodo su cui sta il cursore
  // ritorna: Promise<'entrambi'|'conversazione'|'codice'|null> — null se si torna
  //          all'albero con Esc
  scegliModoRipristino(vista, selezione) {
    // Preselezione: il caso normale, o "solo la conversazione" se l'utente ha
    // chiesto di non toccare i file (--senza-file).
    let indice = this.ripristinaCodice ? 0 : 1;

    // Tasti rimasti in coda dalla navigazione dell'albero: due invii battuti in
    // fretta arrivano in una lettura sola, e il secondo finisce li'. Senza
    // consumarlo il menu resterebbe aperto ad aspettare un tasto gia' premuto.
    const inCoda = this.azioniInAttesa.splice(0);
    if (inCoda.some((azione) => azione.tipo === 'conferma')) {
      return Promise.resolve(VOCI_RIPRISTINO[indice].modo);
    }

    return new Promise((risolvi) => {
      // Anche il menu va ridisegnato su ridimensionamento: il ridisegno passa
      // sempre dallo stesso appiglio, che qui punta alla schermata col menu.
      const ridisegna = () => this.disegnaSchermata(vista, selezione, indice);
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
          if (azione.tipo === 'invio') return concludi(VOCI_RIPRISTINO[indice].modo);
          if (azione.tipo === 'cifra') {
            const scelto = Number.parseInt(azione.valore, 10) - 1;
            if (scelto >= 0 && scelto < VOCI_RIPRISTINO.length) return concludi(VOCI_RIPRISTINO[scelto].modo);
            continue;
          }
          if (azione.tipo === 'freccia') {
            if (azione.valore === 'su') indice = (indice + VOCI_RIPRISTINO.length - 1) % VOCI_RIPRISTINO.length;
            else if (azione.valore === 'giu') indice = (indice + 1) % VOCI_RIPRISTINO.length;
            else continue; // destra e sinistra qui non muovono niente
            ridisegna();
          }
        }
      };

      process.stdin.on('data', ascoltatore);
    });
  }

  // Disegna l'overlay. La composizione sta in vista.js: qui si scrive soltanto,
  // con i ritorni a capo che vuole il terminale in raw mode.
  // vista: risultato di componiVista
  // selezione: uuid del nodo su cui sta il cursore
  // menu: indice della voce del menu di ripristino, o null se si naviga l'albero
  disegnaSchermata(vista, selezione, menu = null) {
    const righe = schermata(vista, selezione, {
      colonne: process.stdout.columns || 120,
      altezza: process.stdout.rows || 30,
      ripristinaCodice: this.ripristinaCodice,
      extra: { lunga: T.albero.extraLunga, corta: T.albero.extraCorta },
      menu,
    });

    this.scrivi(PULISCI_SCHERMO);
    for (const riga of righe) this.scrivi(`${riga}\r\n`);
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
  async cambiaConversazione() {
    const { selezionaCartella, annotaCartellaScelta } = await import('./cartelle.js');
    const { selezionaConversazione } = await import('./conversazioni.js');

    // Lo stdin torna al wrapper comunque vada: anche annullando, anche in errore.
    const restituisciTastiera = () => {
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      process.stdin.resume();
    };

    let cartella = this.cwd;
    try {
      const scelta = await selezionaCartella({ cwd: cartella, ripresa: true });
      if (!scelta) return this.chiudiOverlay(); // annullato: si torna a Claude
      cartella = scelta.percorso;

      // "Avvio normale" nel navigatore vuol dire non riprendere niente: si
      // comincia una conversazione nuova in quella cartella, senza passare
      // dall'elenco di quelle passate.
      const conversazione = scelta.ripresa
        ? await selezionaConversazione({ cartella, ripristinaCodice: this.ripristinaCodice })
        : { nuova: true };
      if (!conversazione) return this.chiudiOverlay();

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
  // ritorna: true se Claude e' ripartito, false se qualcosa e' andato storto
  async cambiaRamo(percorso, albero, voce, modo = 'entrambi') {
    // Il nodo scelto puo' vivere solo nel file di una sessione antenata: in quel
    // caso si riparte da quella, non da quella corrente.
    const origine = this.scegliOrigine(albero, voce, percorso);
    const sessionePartenza = origine.sessionId;
    const alberoOrigine = this.alberiFamiglia?.get(origine.percorso) ?? albero;

    // Solo il codice: la conversazione resta dov'e', quindi non c'e' niente da
    // chiudere e niente da tagliare. Claude resta vivo e si limita a rileggere i
    // file la prossima volta che li apre.
    if (modo === 'codice') {
      const esito = await this.ripristinaFile(alberoOrigine, voce.uuid, origine.percorso);
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
    this.fineTurno = fineDelTurno(nodoOrigine).uuid;

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
      const esito = await this.ripristinaFile(alberoOrigine, voce.uuid, origine.percorso);
      this.registra(`ripristino file ok=${esito.ok} esito=${esito.riassunto}`);

      const messaggio = esito.ok
        ? esito.riassunto
        : T.wrapper.fileNonRipristinati(esito.riassunto);
      this.scrivi(`  ${messaggio}\r\n`);
      await new Promise((r) => setTimeout(r, esito.ok ? 800 : 3000));
    }

    // Il taglio della conversazione lo fa cb, creando una sessione che finisce
    // al turno scelto: in interattivo il CLI ignora i flag di troncamento.
    let ramo;
    try {
      ramo = await creaSessioneTroncata(origine.percorso, this.fineTurno);
      this.registra(`sessione troncata creata: ${ramo.sessionId} fino a ${this.fineTurno}`);
    } catch (errore) {
      this.inOverlay = false;
      this.lampeggia(`cb: ${T.wrapper.ramoNonCreato(errore.message)}`);
      return false;
    }

    this.inOverlay = false;
    this.scrivi(PULISCI_SCHERMO);

    // La nuova sessione ha gia' il suo file, e condivide la radice con l'origine:
    // l'albero della famiglia continuera' a mostrare tutti i rami.
    this.percorsoOrigine = origine.percorso;
    this.uuidRipreso = voce.uuid;

    this.avviaClaude({ riprendi: ramo.sessionId });
    return true;
  }

  // Termina il processo Claude e attende che sia davvero uscito.
  // kill() e' asincrono: senza attendere, le scritture di Claude in chiusura
  // arriverebbero dopo le nostre e le annullerebbero.
  // ritorna: Promise che si risolve a processo chiuso (o dopo un'attesa massima)
  chiudiProcesso() {
    if (!this.processo) return Promise.resolve();

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
  // ritorna: Promise<{ ok, riassunto, esito }>
  async ripristinaFile(albero, uuid, percorsoOrigine = null) {
    const nodo = albero.nodi.get(uuid);
    const fine = nodo ? fineDelTurno(nodo) : null;
    const istante = Date.parse(fine?.timestamp ?? nodo?.timestamp ?? '');
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
  lampeggia(messaggio) {
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
    // nella stessa lettura oppure in letture separate, quindi conto anche quelle
    // gia' trattenute.
    const inAttesa = this.pressioniInAttesa ?? 0;
    if (pressioni > 0 && inAttesa + pressioni >= richieste) {
      clearTimeout(this.timerEsc);
      this.timerEsc = null;
      this.pressioniInAttesa = 0;
      this.byteTrattenuti = null; // scartati: erano parte della scorciatoia

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
  chiudi(codice) {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    this.scrivi(MOSTRA_CURSORE); // il cursore potrebbe essere nascosto da Claude
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
      const ripartito = await this.cambiaRamo(
        ripartenza.percorso,
        ripartenza.albero,
        ripartenza.voce,
      );
      // Se il ripristino non e' riuscito il messaggio l'ha gia' scritto
      // cambiaRamo: qui resta da non lasciare l'utente senza Claude.
      if (!ripartito) this.avviaClaude();
      return;
    }

    this.avviaClaude();
  }
}
