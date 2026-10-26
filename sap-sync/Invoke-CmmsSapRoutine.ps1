<#
.SYNOPSIS
  Fires the CMMS -> SAP routine run from Task Scheduler. 3 times a day (07:00, 13:00, 19:00).

.DESCRIPTION
  Delegates to Watch-CmmsSapSync.ps1 -Routine, which takes the same `Global\MannaCmmsSapSync` mutex so a
  routine never overlaps a job run. Routine mode runs every pass with queued work PLUS the SAP -> CMMS
  reads skipped by Job mode: PASS E (items and stock), open PO lines, cancelled-in-SAP checks, HSN list,
  units, next codes, suppliers and tax codes for every company. Writes routine_last_at and
  routine_last_result on the control Single.

  Kept as its own thin script so Task Scheduler has one stable action per task: SAP-CMMS-Watch runs
  Watch-CmmsSapSync.ps1 (no -Routine), SAP-CMMS-Routine runs this.

.PARAMETER ConfigPath  poller.config.json. Passed through to the watcher.
#>
[CmdletBinding()]
param([string] $ConfigPath)

$ErrorActionPreference = 'Stop'
$scriptDir = $PSScriptRoot; if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
$watcher = Join-Path $scriptDir 'Watch-CmmsSapSync.ps1'
if (-not (Test-Path -LiteralPath $watcher)) { Write-Error "watcher not found: $watcher"; exit 2 }

$pass = @('-Routine')
if ($ConfigPath) { $pass += @('-ConfigPath', $ConfigPath) }
& $watcher @pass
exit $LASTEXITCODE
