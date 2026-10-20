<#
.SYNOPSIS
  Turn on (or off) the HSN switches in config.json for Sync-SapItemCategories.ps1 (20 Oct 2026):
    create_hsn         PASS H - create new HSN codes typed on a CMMS goods receipt in SAP (IndiaHsn)
    mark_gst_relevant  PASS B - send GSTRelevnt = tYES with an HSN for an item SAP has as not GST-relevant
  Backs config.json up first (config.json.bak-<timestamp>-hsn). Prints switch names only, never secrets.

.EXAMPLE
  .\Enable-HsnSync.ps1                       # both on
  .\Enable-HsnSync.ps1 -MarkGstRelevant:$false
  .\Enable-HsnSync.ps1 -Off                  # both off
#>
[CmdletBinding()]
param(
    [string] $ConfigPath = (Join-Path $PSScriptRoot 'config.json'),
    [bool] $CreateHsn = $true,
    [bool] $MarkGstRelevant = $true,
    [switch] $Off
)
Set-StrictMode -Version 1.0
$ErrorActionPreference = 'Stop'
if ($Off) { $CreateHsn = $false; $MarkGstRelevant = $false }

$utf8 = New-Object System.Text.UTF8Encoding($false)
$text = [IO.File]::ReadAllText($ConfigPath).TrimStart([char]0xFEFF)
$cfg = $text | ConvertFrom-Json
$backup = '{0}.bak-{1}-hsn' -f $ConfigPath, (Get-Date -Format 'yyyyMMdd-HHmmss')
Copy-Item -LiteralPath $ConfigPath -Destination $backup

$cfg | Add-Member -NotePropertyName create_hsn -NotePropertyValue $CreateHsn -Force
$cfg | Add-Member -NotePropertyName mark_gst_relevant -NotePropertyValue $MarkGstRelevant -Force
[IO.File]::WriteAllText($ConfigPath, ($cfg | ConvertTo-Json -Depth 10), $utf8)

# Read back what the sync will see.
$check = [IO.File]::ReadAllText($ConfigPath) | ConvertFrom-Json
Write-Host ("create_hsn = {0}, mark_gst_relevant = {1}  (backup: {2})" -f $check.create_hsn, $check.mark_gst_relevant, (Split-Path -Leaf $backup))
