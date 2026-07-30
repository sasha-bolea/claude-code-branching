import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
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
import { disegnaAlbero } from './albero.js';
import { attivaRamoDi, fineDelTurno } from './attiva.js';
import { senzaTitolo, sequenzaTitolo } from './titolo.js';
import { creaSessioneTroncata } from './ramo.js';
import {
  tokenizza,
  contaInTesta,
  analizzaScorciatoia,
  soloRilasci,
  azioniTastiera,
} from './tasti.js';

// Sequenze ANSI usate dall'overlay. Nominate perche' scritte come caratteri di
// controllo nel sorgente sarebbero invisibili in fase di lettura.
const PULISCI_SCHERMO = '[2J[H';
const MOSTRA_CURSORE = '[?25h';

// Millisecondi di attesa dopo il primo Esc per capire se ne arriva un secondo.
// Trattenere il primo Esc e' necessario: se lo inoltrassimo subito, Claude
// aprirebbe il proprio menu di ripristino prima che il secondo arrivi.
// Il costo e' questo ritardo su un Esc singolo (interruzione).
const ATTESA_DOPPIO_ESC = 300;

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
    this.timerEsc = null;
    this.pressioniInAttesa = 0; // pressioni della scorciatoia gia' viste
    this.byteTrattenuti = null; // byte da inoltrare se la sequenza non si completa
    this.uscitaVolontaria = false; // distingue il kill nostro dall'uscita utente
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
    const riprendeGiaLui = this.argomentiExtra.some((a) =>
      ['-r', '--resume', '-c', '--continue'].includes(a),
    );
    if (riprendi) {
      // la sessione esiste gia': imporre un id nuovo la scarterebbe
    } else if (riprendeGiaLui) {
      this.sessionId = null;
    } else {
      argomenti.push('--session-id', this.sessionId);
    }
    argomenti.push(...this.argomentiExtra);

    this.avviatoIl = Date.now();
    this.eraCambioRamo = Boolean(riprendi);

    this.registra(`avvio claude ${argomenti.join(' ')}`);
    // Il titolo va riaffermato a ogni avvio: ConPTY lo sovrascrive col percorso
    // dell'eseguibile quando crea il processo, e a un cambio ramo il processo e' nuovo.
    this.scrivi(sequenzaTitolo(this.titolo));
    this.processo = pty.spawn(this.eseguibile, argomenti, {
      name: 'xterm-256color',
      cols: process.stdout.columns || 120,
      rows: process.stdout.rows || 30,
      cwd: this.cwd,
      env: process.env,
    });

    this.processo.onData((dati) => {
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
    this.scrivi(PULISCI_SCHERMO);
    this.forzaRidisegno();
  }

  // Mostra una schermata di sola informazione e attende un invio.
  // Serve quando non c'e' ancora un albero: senza questo il messaggio verrebbe
  // coperto dal ridisegno di Claude e la scorciatoia sembrerebbe non funzionare.
  async mostraAvviso(righe) {
    this.inOverlay = true;
    this.scrivi(MOSTRA_CURSORE + PULISCI_SCHERMO);
    this.scrivi(`  cb\r\n\r\n`);
    for (const riga of righe) this.scrivi(`  ${riga}\r\n`);
    this.scrivi(`\r\n  invio per tornare a Claude\r\n  > `);
    await this.leggiNumero(0);
    this.chiudiOverlay();
  }

  // Percorso del transcript della sessione in corso.
  // Se l'id lo conosciamo (--session-id nostro) e' una ricerca diretta; se e'
  // Claude ad averlo scelto (--resume, --continue) si ripiega sul transcript
  // piu' recente della cartella, scritto dopo l'avvio.
  // ritorna: percorso del .jsonl, o null se non esiste ancora
  trovaTranscript() {
    if (this.sessionId) {
      const suo = percorsoTranscript(this.sessionId, this.cwd);
      if (suo) return suo;

      // Appena forkato, Claude non ha ancora scritto il file: lo crea al primo
      // messaggio. Ci si aggancia al transcript da cui siamo ripartiti, che fa
      // parte della stessa famiglia e contiene tutti i rami.
      if (this.percorsoOrigine) {
        this.registra(`transcript non ancora scritto, uso l origine ${this.percorsoOrigine}`);
        return this.percorsoOrigine;
      }
      return null;
    }

    const trovato = transcriptPiuRecente(this.cwd, this.avviatoIl ?? 0);
    if (!trovato) return this.percorsoOrigine ?? null;

    // Da qui in poi la sessione ha un id noto: i fork ripartiranno da questo.
    this.sessionId = trovato.sessionId;
    this.registra(`sessione scoperta dal disco: ${trovato.sessionId}`);
    return trovato.percorso;
  }

  // Mostra l'albero dei rami della sessione corrente e attende una scelta.
  async mostraOverlay() {
    const percorso = this.trovaTranscript();
    this.registra(`overlay sessione=${this.sessionId} transcript=${percorso ?? 'ASSENTE'}`);
    if (!percorso) {
      await this.mostraAvviso([
        'Questa conversazione non ha ancora un transcript su disco.',
        '',
        'Claude lo scrive al primo scambio: manda un prompt, attendi la',
        `risposta, poi ripremi ${this.descrizioneScorciatoia}.`,
        '',
        `sessione: ${this.sessionId}`,
      ]);
      return;
    }

    this.inOverlay = true;
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
    // la' non e' il nostro: e' quello da cui siamo ripartiti.
    if (this.uuidRipreso && percorso === this.percorsoOrigine) {
      albero.leafAttivo = this.uuidRipreso;
    }
    this.registra(`famiglia=${famiglia.length} sessioni, nodi uniti=${albero.nodi.size}`);
    const { righe, voci } = disegnaAlbero(albero, {
      larghezza: Math.max(30, (process.stdout.columns || 120) - 40),
    });

    this.registra(`albero righe=${righe.length} voci=${voci.length} nodi=${albero.nodi.size}`);

    if (voci.length === 0) {
      this.inOverlay = false;
      await this.mostraAvviso([
        'La conversazione non contiene ancora messaggi da cui ripartire.',
        '',
        `sessione: ${this.sessionId}`,
        `transcript: ${percorso}`,
      ]);
      return;
    }

    this.scrivi(`  cb — rami di questa conversazione\r\n`);
    this.scrivi(`  ● ramo attivo   ○ ramo in disparte   ⑂ biforcazione\r\n\r\n`);

    // Con molti messaggi mostro solo la coda: e' dove si sceglie quasi sempre.
    const massimo = Math.max(8, (process.stdout.rows || 30) - 8);
    const inizio = Math.max(0, righe.length - massimo);
    if (inizio > 0) this.scrivi(`  … ${inizio} righe precedenti omesse\r\n`);
    for (const riga of righe.slice(inizio)) this.scrivi(`${riga}\r\n`);

    this.scrivi(
      this.ripristinaCodice
        ? '\r\n  numero + invio = riparti da lì (ripristina anche i file)   ·   invio = torna a Claude\r\n  > '
        : '\r\n  numero + invio = riparti da lì (i file restano come sono)   ·   invio = torna a Claude\r\n  > ',
    );

    const scelta = await this.leggiNumero(voci.length);
    this.registra(
      `scelta=${scelta === null ? 'annullata' : scelta + 1} su ${voci.length} voci` +
        (scelta === null
          ? ''
          : ` -> uuid=${voci[scelta].uuid} testo="${voci[scelta].testo.replace(/\s+/g, ' ').slice(0, 40)}"`),
    );
    // Elenco completo delle voci: serve a verificare l'allineamento tra il numero
    // mostrato a schermo e il nodo effettivamente selezionato.
    voci.forEach((v, i) =>
      this.registra(
        `  voce ${i + 1}: ${v.uuid} "${v.testo.replace(/\s+/g, ' ').slice(0, 30)}"`,
      ),
    );

    if (scelta === null) {
      this.chiudiOverlay();
      return;
    }

    await this.cambiaRamo(percorso, albero, voci[scelta]);
  }

  // Chiude il processo corrente e ne apre uno nuovo forkato dal punto scelto.
  // percorso: transcript della sessione corrente
  // albero: risultato di leggiTranscript
  // voce: nodo prompt scelto
  async cambiaRamo(percorso, albero, voce) {
    // Il nodo scelto puo' vivere solo nel file di una sessione antenata: in quel
    // caso si riparte da quella, non da quella corrente.
    const origine = this.scegliOrigine(albero, voce, percorso);
    const sessionePartenza = origine.sessionId;
    const alberoOrigine = this.alberiFamiglia?.get(origine.percorso) ?? albero;

    this.scrivi(`\r\n  riparto da: ${voce.testo.replace(/\s+/g, ' ').slice(0, 60)}\r\n`);
    if (origine.sessionId !== this.sessionId) {
      this.scrivi(`  (ramo della sessione ${String(sessionePartenza).slice(0, 8)})\r\n`);
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
      this.lampeggia(`cb: il messaggio non e' in questa sessione`);
      return;
    }
    this.fineTurno = fineDelTurno(nodoOrigine).uuid;

    // Il rewind dei file cerca il messaggio nella catena attiva della sessione di
    // partenza: se il ramo era in disparte va prima riattivato.
    try {
      await this.riattivaConVerifica(origine.percorso, alberoOrigine, voce.uuid);
    } catch (errore) {
      this.inOverlay = false;
      this.lampeggia(`cb: ${errore.message}`);
      return;
    }

    // Riporta anche i file allo stato di quel messaggio. Senza questo la
    // conversazione torna indietro ma il codice resta quello di adesso, e Claude
    // si limita a suggerire il comando da lanciare a mano.
    if (this.ripristinaCodice) {
      this.scrivi('  ripristino i file a quel punto…\r\n');
      const esito = await this.ripristinaFile(sessionePartenza, voce.uuid);
      this.registra(`rewind-files ok=${esito.ok} uscita=${esito.uscita.slice(0, 300)}`);

      const riassunto = esito.uscita.replace(/\s+/g, ' ').trim().slice(0, 200);
      let messaggio;
      if (esito.senzaSnapshot) messaggio = 'nessuna modifica ai file da ripristinare';
      else if (esito.ok) messaggio = riassunto || 'file ripristinati';
      else messaggio = `file NON ripristinati: ${riassunto}`;

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
      this.lampeggia(`cb: non riesco a creare il ramo (${errore.message})`);
      return;
    }

    this.inOverlay = false;
    this.scrivi(PULISCI_SCHERMO);

    // La nuova sessione ha gia' il suo file, e condivide la radice con l'origine:
    // l'albero della famiglia continuera' a mostrare tutti i rami.
    this.percorsoOrigine = origine.percorso;
    this.uuidRipreso = voce.uuid;

    this.avviaClaude({ riprendi: ramo.sessionId });
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
    throw new Error('non riesco a fissare il ramo scelto: riprova');
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

  // Riporta i file di lavoro allo stato che avevano a un dato messaggio utente,
  // usando il ripristino nativo di Claude (--rewind-files, che esegue e termina).
  //
  // La variabile d'ambiente e' indispensabile: --rewind-files gira in modalita'
  // non interattiva, e su quel percorso Claude abilita lo storico dei file solo
  // se la trova (altrimenti risponde "File rewinding is not enabled").
  //
  // sessione: id della sessione a cui appartiene il messaggio
  // uuid: uuid di un messaggio utente
  // ritorna: Promise<{ ok, uscita, senzaSnapshot }>
  ripristinaFile(sessione, uuid) {
    return new Promise((risolvi) => {
      // spawn e non execFile: serve stdin chiuso in modo garantito, altrimenti
      // Claude resta ad aspettare dati ("no stdin data received in 3s").
      const processo = spawn(this.eseguibile, ['--resume', sessione, '--rewind-files', uuid], {
        cwd: this.cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: '1' },
      });

      let uscita = '';
      processo.stdout.on('data', (d) => (uscita += d));
      processo.stderr.on('data', (d) => (uscita += d));

      const scadenza = setTimeout(() => processo.kill(), 90000);

      const concludi = (codice) => {
        clearTimeout(scadenza);
        // Nessuno snapshot per quel messaggio non e' un guasto: significa che da
        // quel punto i file non sono stati toccati, o che il checkpoint e'
        // scaduto. Va distinto da un errore vero.
        const senzaSnapshot = /No file checkpoint found/i.test(uscita);
        risolvi({ ok: codice === 0 || senzaSnapshot, uscita, senzaSnapshot });
      };

      processo.on('error', (errore) => {
        uscita += errore.message;
        concludi(1);
      });
      processo.on('close', concludi);
    });
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
  avvia() {
    if (!process.stdin.isTTY) {
      throw new Error('cb wrap richiede un terminale interattivo');
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (dati) => this.gestisciInput(dati));

    process.stdout.on('resize', () => {
      this.processo?.resize(process.stdout.columns || 120, process.stdout.rows || 30);
    });

    this.avviaClaude();
  }
}
