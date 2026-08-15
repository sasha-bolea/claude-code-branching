# Collega un canale di sostegno a cb, in tutti i posti che lo devono nominare.
#
# Perché uno script e non farlo a mano: i posti sono quattro (.github/FUNDING.yml,
# i due README, e i testi di lancio) e dimenticarne uno è peggio che non averlo
# fatto — un bottone che compare in cima al repo e un README che non ne parla
# sembrano due progetti diversi. Qui si passa un link e si toccano tutti insieme.
#
# Uso:
#   pwsh scripts/collega-sostegno.ps1 -Url https://paypal.me/tuonome
#   pwsh scripts/collega-sostegno.ps1 -Url https://ko-fi.com/tuonome
#
# Non committa e non pubblica niente: scrive i file e basta. Il commit lo fa chi
# lo lancia, dopo aver riletto il diff.

param(
    # Il link dove arriva il denaro. Accetta qualsiasi https://.
    [Parameter(Mandatory = $true)]
    [string]$Url
)

$ErrorActionPreference = 'Stop'
$radice = Split-Path $PSScriptRoot -Parent

if ($Url -notmatch '^https://') {
    Write-Error "L'indirizzo deve cominciare con https:// — ricevuto: $Url"
}

# Ko-fi e GitHub Sponsors hanno una riga loro in FUNDING.yml, che GitHub riconosce
# e trasforma nel bottone in cima al repo. Tutto il resto passa da `custom`, che
# funziona lo stesso ma senza icona dedicata.
$fundingRiga = switch -Regex ($Url) {
    'ko-fi\.com/(.+)$'          { "ko_fi: $($Matches[1].TrimEnd('/'))" ; break }
    'github\.com/sponsors/(.+)$' { "github: $($Matches[1].TrimEnd('/'))" ; break }
    'buymeacoffee\.com/(.+)$'   { "buy_me_a_coffee: $($Matches[1].TrimEnd('/'))" ; break }
    'liberapay\.com/(.+)$'      { "liberapay: $($Matches[1].TrimEnd('/'))" ; break }
    default                     { "custom: [`"$Url`"]" }
}

# --- 1. FUNDING.yml: è il file che disegna il bottone «Sponsor» ---
$cartellaGithub = Join-Path $radice '.github'
if (-not (Test-Path $cartellaGithub)) { New-Item -ItemType Directory -Force $cartellaGithub | Out-Null }
Set-Content (Join-Path $cartellaGithub 'FUNDING.yml') "$fundingRiga`n" -Encoding UTF8 -NoNewline
Write-Output "scritto  .github/FUNDING.yml  ->  $fundingRiga"

# Sostituisce la sezione di sostegno di un README, che oggi parla solo di stelle.
# percorso: il file da riscrivere
# vecchio:  il testo esatto da cercare
# nuovo:    quello che prende il suo posto
# ritorna:  niente; avvisa se non ha trovato il punto in cui scrivere
function Aggiorna-Readme($percorso, $vecchio, $nuovo) {
    if (-not (Test-Path $percorso)) { Write-Warning "manca $percorso"; return }
    $testo = Get-Content $percorso -Raw
    if ($testo -notlike "*$vecchio*") {
        Write-Warning "in $(Split-Path $percorso -Leaf) non trovo la frase da sostituire: fallo a mano"
        return
    }
    Set-Content $percorso ($testo.Replace($vecchio, $nuovo)) -Encoding UTF8 -NoNewline
    Write-Output "scritto  $(Split-Path $percorso -Leaf)"
}

# --- 2 e 3. I due README ---
Aggiorna-Readme (Join-Path $radice 'README.md') `
    'cb is free, MIT, and built in the evenings. If it saved you a conversation you thought you
had lost, a star on the repo costs nothing and is what makes other people find it.' `
    "cb is free, MIT, and built in the evenings. If it saved you a conversation you thought you
had lost, [chipping in]($Url) keeps it maintained against a CLI that changes every week.

A star on the repo costs nothing either, and is what makes other people find it."

Aggiorna-Readme (Join-Path $radice 'README.it.md') `
    'cb è gratuito, MIT, e scritto la sera. Se ti ha restituito una conversazione che davi per
persa, una stella sul repo non costa niente ed è ciò che permette agli altri di trovarlo.' `
    "cb è gratuito, MIT, e scritto la sera. Se ti ha restituito una conversazione che davi per
persa, [offrirgli qualcosa]($Url) è ciò che lo tiene al passo con un CLI che cambia ogni
settimana.

Anche una stella non costa niente, ed è ciò che permette agli altri di trovarlo."

Write-Output ""
Write-Output "Fatto. Restano tre cose, e le fa una persona:"
Write-Output "  1. git diff            — rileggere cosa è cambiato"
Write-Output "  2. git commit && push  — renderlo pubblico"
Write-Output "  3. npm publish         — perché lo veda anche chi arriva da npm"
