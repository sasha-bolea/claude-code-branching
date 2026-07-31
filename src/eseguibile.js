import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { T } from './lingua.js';

// Percorsi in cui cercare il binario vero di Claude Code.
// node-pty non puo' lanciare gli shim .cmd/.ps1 creati da npm (error code 2):
// serve l'eseguibile nativo.
const CANDIDATI = [
  path.join(
    os.homedir(),
    'AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe',
  ),
  path.join(
    os.homedir(),
    'AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/node_modules/@anthropic-ai/claude-code-win32-x64/claude.exe',
  ),
  path.join(os.homedir(), '.local/bin/claude'),
];

// Nomi da cercare nel PATH. Su Windows solo l'eseguibile: gli shim .cmd/.ps1
// hanno lo stesso nome base "claude" ma node-pty non li lancia, quindi cercare
// "claude" senza estensione troverebbe proprio quello che non funziona.
const NOMI_NEL_PATH = process.platform === 'win32' ? ['claude.exe'] : ['claude'];

// Cerca l'eseguibile nelle cartelle del PATH.
// Copre le installazioni che i candidati fissi non conoscono: homebrew, nvm,
// /usr/local/bin, e in generale ogni sistema che non sia Windows.
// ritorna: percorso trovato, o null
function cercaNelPath() {
  for (const cartella of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!cartella) continue;
    for (const nome of NOMI_NEL_PATH) {
      const candidato = path.join(cartella, nome);
      if (fs.existsSync(candidato)) return candidato;
    }
  }
  return null;
}

// Trova l'eseguibile di Claude Code utilizzabile da node-pty.
// La variabile CB_CLAUDE_EXE ha la precedenza, per installazioni non standard.
// ritorna: percorso dell'eseguibile
// lancia: Error se nessun candidato esiste
export function trovaEseguibileClaude() {
  const forzato = process.env.CB_CLAUDE_EXE;
  if (forzato) {
    if (!fs.existsSync(forzato)) throw new Error(T.eseguibile.forzatoAssente(forzato));
    return forzato;
  }

  for (const candidato of CANDIDATI) {
    if (fs.existsSync(candidato)) return candidato;
  }

  const nelPath = cercaNelPath();
  if (nelPath) return nelPath;

  throw new Error(T.eseguibile.nonTrovato);
}
