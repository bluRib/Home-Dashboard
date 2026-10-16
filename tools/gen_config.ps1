# Read app/.env and write app/js/config.js, the module the browser loads.
#
# PowerShell twin of tools/gen_config.py, for machines without Python.
# Both produce the same file. Use whichever you have.
#
# usage (from the project root):
#   powershell -ExecutionPolicy Bypass -File tools/gen_config.ps1
#
# A browser cannot read a .env file, so the token has to be handed to the page
# as JavaScript. This script is the only thing that moves it across. Run it
# again after any edit to .env.

[CmdletBinding()]
param(
    [string]$EnvPath,
    [string]$OutPath
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
if (-not $EnvPath) { $EnvPath = Join-Path $root 'app\.env' }
if (-not $OutPath) { $OutPath = Join-Path $root 'app\js\config.js' }

if (-not (Test-Path $EnvPath)) {
    Write-Error "no .env found at $EnvPath`ncopy app/.env.example to app/.env first"
}

# Defaults, overwritten by anything present in .env
$env_ = @{
    HA_HOST      = 'homeassistant.local'
    HA_PORT      = '8123'
    HA_SSL       = 'false'
    HA_TOKEN     = ''
    HA_RECONNECT = '2'
}

$lineno = 0
foreach ($raw in Get-Content -LiteralPath $EnvPath -Encoding UTF8) {
    $lineno++
    $line = $raw.Trim()
    if ($line.Length -eq 0) { continue }
    if ($line.StartsWith('#')) { continue }
    $split = $line.IndexOf('=')
    if ($split -lt 1) {
        Write-Error "$EnvPath line ${lineno}: expected KEY=value, got '$line'"
    }
    $key = $line.Substring(0, $split).Trim()
    $value = $line.Substring($split + 1).Trim()
    # Strip one layer of matching quotes if present.
    if ($value.Length -gt 1) {
        $first = $value[0]
        $last = $value[$value.Length - 1]
        if ($first -eq $last -and ($first -eq '"' -or $first -eq "'")) {
            $value = $value.Substring(1, $value.Length - 2)
        }
    }
    $env_[$key] = $value
}

$haHost = $env_['HA_HOST'].Trim()
$port = $env_['HA_PORT'].Trim()
$token = $env_['HA_TOKEN'].Trim()

if ($haHost.Length -eq 0) { Write-Error 'HA_HOST is empty in .env' }
if ($haHost -match '://') { Write-Error "HA_HOST should be a bare host or IP, not a URL: '$haHost'" }
if ($port -notmatch '^\d+$') { Write-Error "HA_PORT should be a number, got '$port'" }

$secure = @('1', 'true', 'yes', 'on') -contains $env_['HA_SSL'].Trim().ToLower()
if ($secure) { $wsScheme = 'wss'; $httpScheme = 'https' }
else { $wsScheme = 'ws'; $httpScheme = 'http' }

$reconnect = 2
$parsed = 0.0
if ([double]::TryParse($env_['HA_RECONNECT'], [ref]$parsed)) {
    $reconnect = [Math]::Max(1, [int]$parsed)
}

$cfg = [ordered]@{
    wsUrl            = "${wsScheme}://${haHost}:${port}/api/websocket"
    httpUrl          = "${httpScheme}://${haHost}:${port}"
    token            = $token
    reconnectSeconds = $reconnect
}

$body = $cfg | ConvertTo-Json
$text = @"
// GENERATED FILE. Do not edit and do not commit.
// Written by tools/gen_config.ps1 from app/.env
// Re-run that script after changing .env.

export const HA_CONFIG = $body;
"@

$outDir = Split-Path -Parent $OutPath
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
Set-Content -LiteralPath $OutPath -Value $text -Encoding utf8

Write-Output "wrote $OutPath"
Write-Output "  endpoint $($cfg.wsUrl)"
if ($token.Length -gt 0) {
    $tail = $token.Substring([Math]::Max(0, $token.Length - 6))
    Write-Output "  token    $($token.Length) chars ending $tail"
} else {
    Write-Output "  token    EMPTY. Set HA_TOKEN in $EnvPath and run this again."
}
