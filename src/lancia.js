import { spawn } from 'node:child_process';
import { trovaEseguibileClaude } from './eseguibile.js';

// Avvia Claude cedendogli stdin/stdout.
// Usa l'eseguibile nativo senza shell: passando per la shell gli argomenti
// verrebbero concatenati e rispezzati, troncando i prompt con spazi.
// argomenti: argomenti da passare a Claude
// cwd: cartella di lavoro
// ritorna: Promise col codice di uscita
function avvia(argomenti, cwd) {
  return new Promise((risolvi, rifiuta) => {
    const processo = spawn(trovaEseguibileClaude(), argomenti, { stdio: 'inherit', cwd });
    processo.on('error', rifiuta);
    processo.on('close', risolvi);
  });
}

// Costruisce gli argomenti per riprendere una sessione, eventualmente forkando
// da un messaggio preciso.
// I flag --resume-session-at e --fork-session non compaiono in `claude --help`
// ma sono implementati: l'unico vincolo nel binario e' che richiedono --resume.
// opzioni.sessionId: sessione da riprendere (obbligatorio)
// opzioni.daUuid: uuid del record da cui ripartire (opzionale)
// opzioni.fork: se creare un nuovo id sessione invece di riusare l'originale
// opzioni.nome: etichetta da dare alla nuova sessione
// ritorna: array di argomenti
export function argomentiRipresa({ sessionId, daUuid = null, fork = true, nome = null }) {
  const argomenti = ['--resume', sessionId];
  if (daUuid) argomenti.push('--resume-session-at', daUuid);
  if (fork) argomenti.push('--fork-session');
  if (nome) argomenti.push('--name', nome);
  return argomenti;
}

// Lancia Claude senza nessuna intermediazione, cedendogli stdin/stdout.
// Serve per gli usi non interattivi (--print, output in pipe): li' cb non ha
// nulla da aggiungere e lo pseudo-terminale sporcherebbe l'output con sequenze
// di controllo e ritorni a capo.
// argomenti: argomenti da passare a Claude
// cwd: cartella di lavoro
// ritorna: Promise col codice di uscita
export function lanciaClaudeDiretto(argomenti, cwd = process.cwd()) {
  return avvia(argomenti, cwd);
}

// Lancia Claude Code cedendogli il terminale.
// stdio 'inherit' significa che Claude ottiene il TTY vero: nessuno pseudo
// terminale, nessun parsing del suo output, nessuna fragilita'.
// opzioni: come argomentiRipresa, piu' cwd (cartella di lavoro della sessione)
// ritorna: Promise che si risolve col codice di uscita di Claude
export function lanciaClaude(opzioni) {
  return avvia(argomentiRipresa(opzioni), opzioni.cwd || process.cwd());
}
