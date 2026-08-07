# Hook Stop di Claude Code: consegna il primo prompt della coda di cb.
#
# La coda la scrive l'utente dall'interfaccia di cb (tasto "p" nell'albero, vedi
# src/coda.js) mentre Claude sta ancora rispondendo. Qui, a fine turno, se ne
# prende uno solo e lo si passa a Claude.
#
# Come si passa: `{"decision":"block","reason":<prompt>}`. Quel `decision`
# impedisce a Claude di fermarsi e gli consegna il testo come motivo, e Claude
# riprende a lavorare. E' l'unico aggancio che gli hook offrono per far
# proseguire una conversazione, e ha una conseguenza dichiarata: il prompt NON
# diventa un record `user` del transcript, quindi non compare come nodo
# nell'albero dei rami.
#
# Un prompt per turno e non tutti insieme: e' il senso della coda: ogni prompt
# vede il lavoro fatto da quello prima. La coda si svuota da sola, quindi la
# catena di blocchi finisce — non serve guardare stop_hook_active, che dice
# soltanto che stiamo gia' proseguendo per via di un hook.
#
# Installazione: vedi docs/procedure.md

$ErrorActionPreference = 'Stop'

# Dentro cb la coda la consegna il pty, che scrive il prompt come lo scriveresti
# tu: diventa un record `user` vero, e quindi un nodo dell'albero. Questa
# variabile la mette cb sull'ambiente di Claude, e gli hook la ereditano.
# Consegnando anche noi, ogni prompt partirebbe due volte.
if ($env:CB_CODA_PTY) { exit 0 }

try {
    $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
} catch {
    exit 0  # payload illeggibile: l'hook non deve mai bloccare la sessione
}

$sessione = $payload.session_id
if (-not $sessione) { exit 0 }

$cartella = if ($env:CB_CODA) { $env:CB_CODA } else { Join-Path $HOME '.claude\cb\coda' }
$file = Join-Path $cartella "$sessione.json"
if (-not (Test-Path -LiteralPath $file)) { exit 0 }

try {
    $coda = Get-Content -LiteralPath $file -Raw -ErrorAction Stop | ConvertFrom-Json
} catch {
    exit 0  # coda illeggibile: si lascia stare, e la sessione finisce il turno
}

# Il @() va attorno alla PIPELINE, non attorno al suo ingresso: un Where-Object
# che lascia passare un elemento solo restituisce quell'elemento, non un array da
# uno, e `$prompt[0]` su una stringa da' il primo CARATTERE. E' successo davvero:
# con un solo prompt in coda, l'hook consegnava "s" invece di "secondo prompt".
$prompt = @($coda.prompt | Where-Object { $_ -is [string] -and $_.Trim() })
if ($prompt.Count -eq 0) {
    Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue
    exit 0
}

$primo = $prompt[0]
$resto = @($prompt | Select-Object -Skip 1)

# Si riscrive PRIMA di consegnare: se la scrittura fallisce — disco pieno,
# permesso negato — il prompt non parte, invece di partire a ogni turno per
# sempre. Un prompt in meno si riscrive, un ciclo infinito no.
try {
    if ($resto.Count -eq 0) {
        Remove-Item -LiteralPath $file -ErrorAction Stop
    } else {
        $json = [ordered]@{ prompt = $resto } | ConvertTo-Json -Depth 3
        Set-Content -LiteralPath $file -Value $json -Encoding utf8 -ErrorAction Stop
    }
} catch {
    exit 0
}

# L'intestazione dice a Claude da dove viene il testo: senza, un prompt breve
# arriva come una frase caduta dal nulla in mezzo al lavoro appena finito.
$intestazione = if ($env:CB_LINGUA -eq 'it') {
    "Accodato dall'utente mentre lavoravi. Fai questo adesso:"
} else {
    'Queued by the user while you were working. Do this now:'
}

@{ decision = 'block'; reason = "$intestazione`n`n$primo" } | ConvertTo-Json -Compress
exit 0
