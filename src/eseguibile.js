import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

// Trova l'eseguibile di Claude Code utilizzabile da node-pty.
// La variabile CB_CLAUDE_EXE ha la precedenza, per installazioni non standard.
// ritorna: percorso dell'eseguibile
// lancia: Error se nessun candidato esiste
export function trovaEseguibileClaude() {
  const forzato = process.env.CB_CLAUDE_EXE;
  if (forzato) {
    if (!fs.existsSync(forzato)) throw new Error(`CB_CLAUDE_EXE non esiste: ${forzato}`);
    return forzato;
  }

  for (const candidato of CANDIDATI) {
    if (fs.existsSync(candidato)) return candidato;
  }

  throw new Error(
    'eseguibile di Claude Code non trovato. Imposta CB_CLAUDE_EXE col percorso di claude.exe',
  );
}
