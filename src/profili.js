// Profili: insiemi di variabili d'ambiente con un nome, per lanciare Claude
// contro qualcosa di diverso senza uscire dalla conversazione.
//
// cb non sa cosa siano un modello, un gateway o una chiave: sa solo che prima di
// creare il processo mette certe variabili al posto di altre. E' quello che
// tiene la funzione generica — vale per un proxy locale, per una chiave di
// lavoro invece di quella personale, per un endpoint aziendale — e che le
// impedisce di invecchiare insieme al provider di turno.
//
// Stanno in ~/.claude/cb/impostazioni.json, sotto `profili`:
//
//   "profili": {
//     "gateway": { "ANTHROPIC_BASE_URL": "http://localhost:20128" },
//     "lavoro":  { "ANTHROPIC_API_KEY": "…", "ANTHROPIC_BASE_URL": null }
//   }
//
// Il valore `null` toglie la variabile: serve quando un profilo deve **rimuovere**
// qualcosa che c'era invece di sovrascriverlo.

import { impostazione } from './impostazioni.js';

// Nome del profilo implicito, quello che non cambia niente. Non e' una chiave
// del file: e' l'ambiente con cui cb e' stato lanciato, ed e' sempre il primo
// della lista perche' e' anche la via del ritorno.
export const PROFILO_BASE = null;

// Profili configurati, come oggetto nome -> variabili.
// Un valore che non sia un oggetto viene scartato invece di far saltare tutto:
// le impostazioni sono una comodita', e un file scritto male non deve poter
// impedire di lavorare.
// ritorna: Map<nome, { chiave: valore|null }>
export function leggiProfili() {
  const grezzi = impostazione('profili', null);
  const profili = new Map();
  if (!grezzi || typeof grezzi !== 'object' || Array.isArray(grezzi)) return profili;

  for (const [nome, variabili] of Object.entries(grezzi)) {
    if (!nome || !variabili || typeof variabili !== 'object' || Array.isArray(variabili)) continue;
    profili.set(nome, variabili);
  }
  return profili;
}

// Ambiente con cui lanciare Claude sotto un dato profilo.
//
// Si ricostruisce **sempre** dalla fotografia dell'ambiente di partenza, mai
// dall'ambiente corrente: e' cio' che fa sparire da sole le variabili aggiunte
// dal profilo precedente. Mutando l'ambiente di cb, tornare indietro avrebbe
// richiesto di ricordarsi cosa si era aggiunto — cioe' lo stesso `finally` che
// serve facendolo dalla shell.
//
// partenza: fotografia di process.env fatta all'avvio di cb
// variabili: valori del profilo scelto, o null per il profilo base
// ritorna: nuovo oggetto ambiente
export function ambienteConProfilo(partenza, variabili) {
  const ambiente = { ...partenza };
  for (const [chiave, valore] of Object.entries(variabili ?? {})) {
    // null (o stringa vuota) vuol dire "togli": una variabile presente ma vuota
    // non e' la stessa cosa di una assente, e certe librerie ci cascano.
    if (valore === null || valore === '') delete ambiente[chiave];
    else ambiente[chiave] = String(valore);
  }
  return ambiente;
}

// Nomi da mostrare nell'elenco: il profilo base per primo, poi quelli del file
// nell'ordine in cui sono scritti.
// profili: risultato di leggiProfili
// ritorna: array di nomi, con PROFILO_BASE in testa
export function elencoProfili(profili) {
  return [PROFILO_BASE, ...profili.keys()];
}
