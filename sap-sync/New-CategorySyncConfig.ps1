<#
.SYNOPSIS
  Creates config.json and poller.config.json for the CMMS -> SAP item category sync. Run it yourself.

.DESCRIPTION
  The agent session cannot write config.json files (and should not hold these secrets), so this script
  asks for the secrets here, in your console, and writes the two files next to itself.

    config.json         used by Sync-SapItemCategories.ps1
                          - SAP url + username + password: copied from sap-treads-stock-sync\config.json
                          - MANNA_TYRE_LIVE password: asked for (it differs from the others)
                          - ERPNext api key + secret: asked for (the key that may write Items, e.g. the
                            regenerated System Manager integration key)
    poller.config.json  used by Invoke-SapCategorySyncPoller.ps1 and Invoke-FlagWatch.ps1
                          - bot key + secret (sapsync@): copied from sap-treads-stock-sync\poller.config.json

  Nothing is printed. Existing files are kept as *.bak-<timestamp> before being replaced.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Read-Secret([string] $Prompt) {
    $s = Read-Host -Prompt $Prompt -AsSecureString
    $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
function Read-Json([string] $Path) { ([IO.File]::ReadAllText($Path).TrimStart([char]0xFEFF)) | ConvertFrom-Json }
function Save([string] $Name, $Object) {
    $p = Join-Path $here $Name
    if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p ("$p.bak-{0}" -f (Get-Date -Format 'yyyyMMdd-HHmmss')) }
    [IO.File]::WriteAllText($p, ($Object | ConvertTo-Json -Depth 6), $utf8)
    Write-Host "written: $p" -ForegroundColor Green
}

$stock = Read-Json 'C:\Users\eldhose\sap-treads-stock-sync\config.json'
$stockPoller = Read-Json 'C:\Users\eldhose\sap-treads-stock-sync\poller.config.json'

$cfg = Read-Json (Join-Path $here 'config.example.json')
$cfg.sap.url = "$($stock.sap.url)"
$cfg.sap.username = "$($stock.sap.username)"
$cfg.sap.password = "$($stock.sap.password)"
$cfg.sap.password_overrides.MANNA_TYRE_LIVE = Read-Secret 'SAP password for MANNA_TYRE_LIVE'
$cfg.erpnext.api_key = (Read-Host -Prompt 'ERPNext API key (may write Items)').Trim()
$cfg.erpnext.api_secret = (Read-Secret 'ERPNext API secret').Trim()
Save 'config.json' $cfg

$pc = Read-Json (Join-Path $here 'poller.config.example.json')
$pc.bot_api_key = "$($stockPoller.bot_api_key)"
$pc.bot_api_secret = "$($stockPoller.bot_api_secret)"
Save 'poller.config.json' $pc

Write-Host ''
Write-Host 'Test it (reads only, the control record starts in dry-run mode):' -ForegroundColor Cyan
Write-Host "  powershell -File `"$here\Sync-SapItemCategories.ps1`" -DryRun"
