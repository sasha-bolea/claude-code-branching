# Procedure

Runbook delle procedure multi-passo o rare. Una sezione per procedura.

---

## Installare cb come comando globale

**Quando serve.** Prima volta, o dopo aver spostato la cartella del progetto.

```powershell
cd C:\Users\sasha\Documents\REPOSITORY\personale\cb
npm install
npm link
```

`npm link` crea lo shim in `%APPDATA%\npm\cb.ps1`, che punta alla cartella del progetto.
Verifica:

```powershell
(Get-Command cb).Source
(Get-Item "$env:APPDATA\npm\node_modules\cb").Target   # deve puntare al progetto
```

⚠️ Il link registra il **percorso assoluto**: spostando la cartella va rifatto `npm link`.
Per rimuoverlo: `npm unlink -g cb`.

---

## Agganciare cb al comando `claude`

**Quando serve.** Per non dover ricordarsi di scrivere `cb`.

La funzione `claude` sta nel profilo PowerShell (`$PROFILE`, qui
`C:\Users\sasha\Documents\PowerShell\Microsoft.PowerShell_profile.ps1`) e continua a occuparsi
di quello che cb non fa: blocco della sospensione e ripiego su Claude diretto.

```powershell
# Selettore di cartella: solo quando l'utente non ha gia' detto dove lavorare.
# "claude ." salta il selettore, "claude -r" lo apre in modo ripresa.
$scegli = @()
if ($args.Count -eq 1 -and $args[0] -eq '.') { $args = @() }
elseif ($args.Count -eq 0 -or $args[0] -in @('-r', '--resume')) { $scegli = @('--scegli') }

# La cartella scelta la sa solo cb: un figlio non cambia la cwd del padre.
$fileCartella = Join-Path ([IO.Path]::GetTempPath()) "cb-cartella-$PID.txt"
Remove-Item $fileCartella -ErrorAction SilentlyContinue
$env:CB_CARTELLA_SCELTA = $fileCartella

$cbEntry = "C:\Users\sasha\Documents\REPOSITORY\personale\cb\bin\cb.js"
$claudeShim = "C:\Users\sasha\AppData\Roaming\npm\claude.ps1"
$cbUsabile = (Test-Path $cbEntry) -and (Get-Command node -ErrorAction SilentlyContinue)

try {
    $ripiega = $true
    if ($cbUsabile) {
        & node $cbEntry @scegli --tasto f2 -- --dangerously-skip-permissions @args
        $ripiega = ($LASTEXITCODE -eq 78)     # 78 = cb non è partito
    }
    if ($ripiega) { & $claudeShim --dangerously-skip-permissions @args }
} finally {
    # La shell segue la cartella scelta, come faceva prima Set-Location.
    if (Test-Path $fileCartella) {
        $cartellaScelta = (Get-Content $fileCartella -Raw).Trim()
        Remove-Item $fileCartella -ErrorAction SilentlyContinue
        if ($cartellaScelta -and (Test-Path -LiteralPath $cartellaScelta)) {
            Set-Location -LiteralPath $cartellaScelta
        }
    }
    $env:CB_CARTELLA_SCELTA = $null
}
```

**Il titolo della tab lo mette cb**, non il profilo: la cartella la sceglie lui, quindi al
momento del lancio il profilo non la conosce ancora. Serve comunque
`CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` in `~/.claude/settings.json`.

⚠️ Se il profilo ha una funzione `vai` (naviga senza avviare Claude) che usa
`Select-RepoFolder`, quella funzione va lasciata dov'è: cb non la sostituisce.

**Scelta della scorciatoia.** I tasti funzione sono la fascia libera: Claude Code non li usa,
né li usa l'editing da riga di comando. Evitare `f10` e `f11`, intercettati dal terminale per
la barra dei menu e lo schermo intero. Le combinazioni con Ctrl sono quasi tutte prese —
editing (`ctrl+a/e/k/u/w`), cronologia (`ctrl+r`), comandi di Claude Code fra cui `ctrl+g` — e
`ctrl+s`/`ctrl+q` sono il controllo di flusso del terminale: con quelli lo schermo si blocca.

**Prima di modificare**: copia di sicurezza del profilo.

```powershell
Copy-Item $PROFILE "$PROFILE.backup-$(Get-Date -f yyyy-MM-dd)"
```

Verifica della sintassi senza riavviare:

```powershell
$err=$null
[System.Management.Automation.Language.Parser]::ParseFile($PROFILE,[ref]$null,[ref]$err) | Out-Null
if ($err) { $err | ForEach-Object { $_.Message } } else { "OK" }
```

Il profilo si ricarica solo in un **terminale nuovo**.

---

## Installare i commit automatici del codice (opzionale)

**Quando serve.** Per avere uno storico del codice che non scade (i checkpoint nativi di
Claude sono legati al session-id e hanno una retention).

Aggiungi in `~/.claude/settings.json`, sotto `hooks.Stop`, **in coda** agli hook esistenti
senza sostituirli:

```json
{ "type": "command", "command": "pwsh -NoProfile -File C:/Users/sasha/Documents/REPOSITORY/personale/cb/hooks/cb-commit.ps1" }
```

⚠️ L'hook gira su **ogni** sessione Claude in **ogni** repo git, non solo su questo progetto.

Verifica su un repo di prova: tocca un file, fai finire un turno, poi

```powershell
git log --oneline refs/cb/<sessione>/auto   # deve mostrare il commit
git log --oneline                            # NON deve mostrarlo
git status                                   # identico a prima
```

Recupero di un file: `git show refs/cb/<sessione>/auto~2:percorso/file.js`

---

## Spostare la cartella del progetto

**Quando serve.** Riorganizzazione delle cartelle.

`Move-Item` fallisce se una sessione cb è in esecuzione: `conpty.node` è mappato in memoria.
Senza terminare il processo dell'utente:

1. Copia tutto **tranne `node_modules`** nella nuova posizione.
2. Verifica che i file attesi ci siano tutti e che `.git` sia integro.
3. `npm install` + `npm link` dalla nuova posizione.
4. Aggiorna `$cbEntry` nel profilo PowerShell.
5. Rimuovi la vecchia cartella. Se `node_modules` resta bloccato, cancella tutto il resto e
   completa dopo aver chiuso la sessione: una cartella vuota è inerte.

---

## Pubblicare / aggiornare la repo su GitHub

**Quando serve.** Prima pubblicazione, o cambio di visibilità.

```powershell
gh auth status                       # deve essere autenticato
gh repo create claude-code-branching --public --source=. --remote=origin --push
```

⚠️ `gh` qui è configurato con protocollo **SSH** ma non c'è una chiave caricata: il push
fallisce con `Permission denied (publickey)`. La repo però viene creata. Rimedio:

```powershell
git remote set-url origin "https://github.com/sasha-bolea/claude-code-branching.git"
gh auth setup-git
git push -u origin master
```

**Prima di pubblicare** (repo pubblica): togliere percorsi e uuid della macchina di sviluppo.

```powershell
git ls-files | ForEach-Object { Select-String -Path $_ -Pattern "Users\\sasha|sashabol3a" } |
  ForEach-Object { "$($_.Filename):$($_.LineNumber)" }
```

Controllare anche che `node_modules` e le immagini non finiscano online:

```powershell
git ls-tree -r --name-only origin/master | Select-String "node_modules|\.png"
```

---

## Diagnosticare un comportamento inatteso di cb

**Quando serve.** La scorciatoia non risponde, un ramo non si recupera, il ripristino fallisce.

Il log è **sempre attivo**: `~/.claude/cb/diagnosi.log`. Registra la famiglia di sessioni,
l'elenco voci→uuid dell'albero, la scelta fatta, la riga di comando passata a Claude, l'esito
della riattivazione e del rewind.

```powershell
Get-Content "$env:USERPROFILE\.claude\cb\diagnosi.log" | Where-Object { $_ -notmatch "  tasti  " }
```

Per aggiungere il dump dei byte della tastiera: `cb --tasti` (combinabile con `--tasto`).

Non dedurre dallo schermo: Claude lo ridisegna e i messaggi di cb vengono coperti.

---

## Ispezionare una conversazione senza aprirla

```powershell
node src/verifica-reale.js "$env:USERPROFILE\.claude\projects\<progetto>\<sessione>.jsonl"
```

Stampa nodi, ramo attivo, biforcazioni, ripristini veri e rami percorribili con la loro
profondità.
