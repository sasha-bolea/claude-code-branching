# Hook Stop di Claude Code: salva lo stato del codice a fine turno.
#
# I commit finiscono su un ref nascosto (refs/cb/<sessione>/auto): non compaiono
# in `git log`, `git branch`, `git tag` o `git status`, e il branch su cui stai
# lavorando non viene mai toccato. Restano visibili con `git log --all`, che per
# definizione percorre tutti i ref: e' voluto, serve a poterli ispezionare.
#
# L'area di staging reale non viene alterata: tutte le operazioni usano un index
# temporaneo tramite GIT_INDEX_FILE.
#
# Installazione: vedi docs/procedure.md

$ErrorActionPreference = 'Stop'

try {
    $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
} catch {
    exit 0  # payload illeggibile: l'hook non deve mai bloccare la sessione
}

$sessione = $payload.session_id
$cartella = if ($payload.cwd) { $payload.cwd } else { (Get-Location).Path }
if (-not $sessione) { exit 0 }

# Fuori da un repo git non c'e' niente da versionare.
$radice = & git -C $cartella rev-parse --show-toplevel 2>$null
if ($LASTEXITCODE -ne 0 -or -not $radice) { exit 0 }

# Niente modifiche: nessun commit, cosi' l'albero dei commit resta allineato ai
# turni che hanno davvero cambiato il codice.
$modifiche = & git -C $radice status --porcelain 2>$null
if (-not $modifiche) { exit 0 }

$ref = "refs/cb/$sessione/auto"
$indexTemporaneo = Join-Path ([System.IO.Path]::GetTempPath()) "cb-index-$sessione"

try {
    $env:GIT_INDEX_FILE = $indexTemporaneo

    # Parto dall'ultimo stato salvato per questa sessione, o da HEAD al primo giro.
    $precedente = & git -C $radice rev-parse --verify --quiet $ref
    $base = if ($precedente) { $precedente } else { & git -C $radice rev-parse --verify --quiet HEAD }

    if ($base) { & git -C $radice read-tree $base 2>$null | Out-Null }
    & git -C $radice add -A 2>$null | Out-Null

    $albero = & git -C $radice write-tree
    if ($LASTEXITCODE -ne 0 -or -not $albero) { exit 0 }

    # Se l'albero non e' cambiato rispetto al commit precedente, salto: evita una
    # catena di commit identici quando le modifiche erano su file ignorati.
    if ($precedente) {
        $alberoPrecedente = & git -C $radice rev-parse "$precedente^{tree}" 2>$null
        if ($alberoPrecedente -eq $albero) { exit 0 }
    }

    $messaggio = "cb: $($sessione.Substring(0, 8)) $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    $commit = if ($base) {
        $messaggio | & git -C $radice commit-tree $albero -p $base
    } else {
        $messaggio | & git -C $radice commit-tree $albero
    }

    if ($LASTEXITCODE -eq 0 -and $commit) {
        & git -C $radice update-ref $ref $commit | Out-Null
    }
} catch {
    exit 0  # un fallimento del salvataggio non deve mai interrompere il lavoro
} finally {
    Remove-Item Env:\GIT_INDEX_FILE -ErrorAction SilentlyContinue
    Remove-Item $indexTemporaneo -ErrorAction SilentlyContinue
}

exit 0
