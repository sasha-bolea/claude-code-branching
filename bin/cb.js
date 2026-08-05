#!/usr/bin/env node
import path from 'node:path';
import readline from 'node:readline/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { stdin, stdout } from 'node:process';
import { leggiTranscript } from '../src/transcript.js';
import { scansiona, risolviSessione } from '../src/indice.js';
import { disegnaAlbero } from '../src/albero.js';
import { lanciaClaude, lanciaClaudeDiretto, argomentiRipresa } from '../src/lancia.js';
import { attivaRamoDi } from '../src/attiva.js';
import { impostazione, impostazioniPresenti } from '../src/impostazioni.js';
import { LINGUA, T } from '../src/lingua.js';

// Scorciatoia che apre l'albero: CB_TASTO, poi quella scelta nelle impostazioni,
// poi il predefinito. --tasto sulla riga di comando vince su tutti.
const SCORCIATOIA_PREDEFINITA = impostazione('scorciatoia', 'esc esc');

// Codice di uscita usato quando cb non riesce ad avviarsi (pty non disponibile,
// eseguibile di Claude non trovato, scorciatoia non valida). Chi lancia cb lo
// riconosce e puo' ripiegare su Claude diretto.
const USCITA_AVVIO_FALLITO = 78;

const AIUTO = T.aiuto(SCORCIATOIA_PREDEFINITA);

// Versione dichiarata nel package.json. createRequire e non un import JSON:
// l'import di JSON in ESM vuole un'asserzione di tipo, che cambia sintassi fra
// le versioni di Node ed e' esattamente il genere di cosa che rompe l'avvio.
const VERSIONE = createRequire(import.meta.url)('../package.json').version;

// Accorcia un testo su una riga.
const breve = (testo, n) => {
  const pulito = (testo ?? '').replace(/\s+/g, ' ').trim();
  return pulito.length > n ? `${pulito.slice(0, n - 1)}…` : pulito;
};

// Nome leggibile del progetto di una sessione.
// Lo slug di cartella non e' affidabile (i nomi contengono trattini, non si puo'
// invertire): quando c'e' il cwd reale registrato nel transcript si usa quello.
// scheda: scheda di sessione
// ritorna: nome corto del progetto
const nomeProgetto = (scheda) =>
  scheda.cwd ? path.basename(scheda.cwd) : scheda.progetto.replace(/^[A-Za-z]--/, '');

// Stampa l'elenco delle sessioni, una riga ciascuna.
// schede: risultato di scansiona()
function stampaElenco(schede) {
  schede.forEach((scheda, i) => {
    const marchio = scheda.ripristini > 0 ? `⑂${scheda.ripristini}` : '  ';
    const data = (scheda.ultimoTimestamp ?? '').slice(0, 16).replace('T', ' ');
    console.log(
      `${String(i + 1).padStart(3)}  ${marchio}  ${data}  ${scheda.sessionId.slice(0, 8)}  ` +
        `${nomeProgetto(scheda).padEnd(20)}  ${breve(scheda.titolo || scheda.primoPrompt, 50)}`,
    );
  });
}

// Mostra l'albero di una sessione e restituisce le voci selezionabili.
// scheda: scheda di sessione
// ritorna: { albero, voci }
async function mostraAlbero(scheda) {
  const albero = await leggiTranscript(scheda.percorso);
  const { righe, voci } = disegnaAlbero(albero);

  console.log(`\n${scheda.titolo ?? scheda.sessionId}`);
  console.log(`${scheda.percorso}`);
  console.log(`cwd: ${albero.cwd ?? '?'}   ${T.comandi.legendaElenco}\n`);
  for (const riga of righe) console.log(riga);
  console.log('');

  return { albero, voci };
}

// Riprende una sessione da un punto scelto, forkando in un ramo nuovo.
// Il ramo di partenza non viene toccato: i .jsonl sono append-only.
// scheda: scheda di sessione
// albero: risultato di leggiTranscript della sessione
// voce: nodo prompt scelto (null = riprendi la punta del ramo attivo)
async function riprendi(scheda, albero, voce) {
  // Un nodo su un ramo abbandonato non e' raggiungibile finche' quel ramo non
  // torna attivo: vedi src/attiva.js.
  if (voce) {
    const attivata = attivaRamoDi(scheda.percorso, albero, voce.uuid);
    if (attivata) {
      console.log(T.comandi.ramoRiattivato(attivata.slice(0, 8)));
    }
  }

  const opzioni = {
    sessionId: scheda.sessionId,
    daUuid: voce?.uuid ?? null,
    fork: Boolean(voce),
    cwd: scheda.cwd,
  };
  console.log(`\n> claude ${argomentiRipresa(opzioni).join(' ')}`);
  console.log(`  (in ${opzioni.cwd})\n`);
  const codice = await lanciaClaude(opzioni);
  process.exit(codice ?? 0);
}

// Chiede un numero all'utente entro un intervallo.
// domanda: testo del prompt
// massimo: valore massimo accettato
// ritorna: indice 0-based, oppure null se l'utente annulla
async function chiediNumero(domanda, massimo) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const risposta = (await rl.question(domanda)).trim();
    if (!risposta) return null;
    const n = Number.parseInt(risposta, 10);
    if (!Number.isInteger(n) || n < 1 || n > massimo) {
      console.log(T.comandi.sceltaNonValida);
      return null;
    }
    return n - 1;
  } finally {
    rl.close();
  }
}

async function main() {
  // Tutto quello che segue "--" e' destinato a Claude, non a cb. Serve per
  // inoltrare argomenti che collidono con i comandi di cb (o che sono prompt).
  const tutti = process.argv.slice(2);
  const separatore = tutti.indexOf('--');
  const argomentiClaude = separatore >= 0 ? tutti.slice(separatore + 1) : [];
  const [comando, ...resto] = separatore >= 0 ? tutti.slice(0, separatore) : tutti;

  if (comando === '--aiuto' || comando === '-h' || comando === '--help') {
    console.log(AIUTO);
    return;
  }

  if (comando === '--version' || comando === '-v') {
    console.log(VERSIONE);
    return;
  }

  // La schermata delle impostazioni, richiesta a mano. Serve un terminale: senza,
  // non c'e' niente da mostrare e niente da premere.
  if (comando === '--impostazioni') {
    if (!process.stdin.isTTY) {
      console.error(`cb: ${T.wrapper.serveTerminale}`);
      process.exitCode = 1;
      return;
    }
    const { configura } = await import('../src/configura.js');
    await configura();
    return;
  }

  // Modalita' predefinita: Claude avvolto, con l'albero a portata di tasto.
  // --tasto e --tasti sono opzioni combinabili, non comandi alternativi.
  const argomenti = [comando, ...resto].filter(Boolean);
  const modiWrapper = ['--tasti', '--tasto', '--senza-file', '--scegli'];
  if (argomenti.length === 0 || modiWrapper.includes(argomenti[0])) {
    // Uso non interattivo: niente pseudo-terminale, cb si fa da parte.
    const stampa = argomentiClaude.some((a) => a === '-p' || a === '--print');
    if (stampa || !process.stdin.isTTY) {
      const codice = await lanciaClaudeDiretto(argomentiClaude);
      process.exit(codice ?? 0);
    }

    // Primo avvio: le tre domande che hanno senso solo all'inizio. Sta dopo il
    // ramo non interattivo apposta — con -p o senza terminale non c'e' niente da
    // mostrare, e chiedere bloccherebbe uno script.
    let predefinita = SCORCIATOIA_PREDEFINITA;
    if (!impostazioniPresenti()) {
      const { configura } = await import('../src/configura.js');
      const scelte = await configura();
      predefinita = scelte.scorciatoia;

      // La lingua era gia' stata risolta all'import, e vista.js ne ha catturato
      // legenda e voci del menu: cambiarla adesso lascerebbe la prima sessione
      // mezza in una lingua e mezza nell'altra. Rilanciarsi e' l'unico modo di
      // essere coerenti da subito, e succede una volta sola nella vita.
      if (scelte.lingua !== LINGUA) {
        const esito = spawnSync(process.execPath, [process.argv[1], ...process.argv.slice(2)], {
          stdio: 'inherit',
        });
        process.exit(esito.status ?? 0);
      }
    }

    // Dentro il try ci stanno anche gli import dinamici, non solo l'avvio: il
    // wrapper importa node-pty in cima, e su una macchina dove il modulo nativo
    // non e' compilato e' proprio l'import a lanciare. Fuori di qui quell'errore
    // usciva con 1, e chi ci ha lanciato non ripiegava su Claude — cioe' il
    // ripiego mancava esattamente nel caso per cui esiste.
    try {
      const { Wrapper, chiedeRipresa, senzaRipresa } = await import('../src/wrapper.js');

      // Selettore della cartella: prima si sceglie dove lavorare, poi parte Claude.
      // Il modo (avvio normale o ripresa) si decide li' dentro col tasto "r", e il
      // -r della riga di comando e' solo il modo di partenza.
      let cartella = process.cwd();
      let perClaude = argomentiClaude;
      let ripartenza = null;
      if (argomenti.includes('--scegli')) {
        const { selezionaCartella, annotaCartellaScelta } = await import('../src/cartelle.js');
        const iniziale = chiedeRipresa(argomentiClaude);
        let scelta = null;
        let conversazione = null;

        // Il ciclo e' il "torna indietro": Esc nell'elenco delle conversazioni
        // riporta al navigatore delle cartelle invece di uscire da cb. Esc nel
        // navigatore, che e' il primo passo, esce davvero: non c'e' un passo
        // precedente a cui tornare.
        while (!conversazione) {
          scelta = await selezionaCartella({ cwd: cartella, ripresa: iniziale });
          if (!scelta) return;
          cartella = scelta.percorso;

          if (!scelta.ripresa) break;

          // La ripresa la gestisce cb con il suo selettore, che raggruppa i rami
          // di una conversazione in un albero solo: il -r dell'utente aprirebbe
          // quello nativo, dove ogni fork e' una conversazione a se'.
          const { selezionaConversazione } = await import('../src/conversazioni.js');
          conversazione = await selezionaConversazione({
            cartella,
            ripristinaCodice: !argomenti.includes('--senza-file'),
          });
        }

        annotaCartellaScelta(cartella);

        if (conversazione) {
          // Cartella senza conversazioni: si parte da zero, non si riprende nulla.
          ripartenza = conversazione.nuova ? null : conversazione;
          perClaude = senzaRipresa(argomentiClaude);
        } else if (iniziale) {
          perClaude = senzaRipresa(argomentiClaude);
        }
      }

      const diagnostica = argomenti.includes('--tasti');
      const posizioneTasto = argomenti.indexOf('--tasto');
      const scorciatoia =
        posizioneTasto >= 0
          ? argomenti
              .slice(posizioneTasto + 1)
              .filter((a) => !a.startsWith('--'))
              .join(' ')
          : predefinita;

      // Va atteso: avvia() e' asincrona (puo' passare dal ripristino di un ramo),
      // e senza await il suo errore non arriverebbe a questo catch.
      await new Wrapper({
        cwd: cartella,
        argomentiExtra: perClaude,
        scorciatoia: scorciatoia || predefinita,
        ripristinaCodice: !argomenti.includes('--senza-file'),
        diagnostica,
      }).avvia({ ripartenza });
    } catch (errore) {
      // Codice dedicato: dice a chi ci ha lanciato che cb non e' partito, e che
      // puo' ripiegare su Claude diretto. Un'uscita normale di Claude non lo usa.
      console.error(`cb: ${errore?.message ?? errore}`);
      process.exit(USCITA_AVVIO_FALLITO);
    }
    return;
  }

  // Il comando si valida prima di scansionare: una scansione a vuoto rispondeva
  // "nessuna sessione" a un comando scritto male, e usciva 0.
  if (!['ls', 'tree', 'open', 'pick'].includes(comando)) {
    console.log(T.comandi.comandoSconosciuto(comando));
    console.log(AIUTO);
    process.exitCode = 1;
    return;
  }

  const schede = await scansiona();
  if (schede.length === 0) {
    console.log(T.comandi.nessunaSessione);
    return;
  }

  if (comando === 'ls') {
    const filtro = resto.join(' ').toLowerCase();
    const filtrate = filtro
      ? schede.filter((s) =>
          `${s.progetto} ${s.titolo ?? ''} ${s.primoPrompt}`.toLowerCase().includes(filtro),
        )
      : schede;
    stampaElenco(filtrate);
    console.log(`\n${T.comandi.quanteSessioni(filtrate.length)}`);
    return;
  }

  if (comando === 'tree' || comando === 'open') {
    const scheda = risolviSessione(resto[0] ?? '', schede);
    if (!scheda) {
      console.log(T.comandi.sessioneNonTrovata(resto[0]));
      process.exitCode = 1;
      return;
    }
    const { albero, voci } = await mostraAlbero(scheda);

    if (comando === 'tree') return;

    const indicato = resto[1] ? Number.parseInt(resto[1], 10) - 1 : null;
    const scelto =
      indicato !== null && indicato >= 0 && indicato < voci.length ? voci[indicato] : null;
    if (indicato !== null && !scelto) {
      console.log(T.comandi.ramoNonValido(resto[1], voci.length));
      process.exitCode = 1;
      return;
    }
    await riprendi(scheda, albero, scelto);
    return;
  }

  // Catalogo interattivo da fuori: sessione, poi ramo.
  stampaElenco(schede.slice(0, 30));
  const iSessione = await chiediNumero(
    T.comandi.chiediSessione(Math.min(30, schede.length)),
    30,
  );
  if (iSessione === null) return;

  const scheda = schede[iSessione];
  const { albero, voci } = await mostraAlbero(scheda);

  const iVoce = await chiediNumero(T.comandi.chiediPunto(voci.length), voci.length);
  await riprendi(scheda, albero, iVoce === null ? null : voci[iVoce]);
}

main().catch((errore) => {
  console.error(`cb: ${errore?.message ?? errore}`);
  process.exit(1);
});
