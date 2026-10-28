<#
.SYNOPSIS
  Switches the CMMS -> SAP sync to the fast watcher (27 Oct 2026). Run this yourself, elevated.

.DESCRIPTION
  Replaces the task SAP-Watch-Categories (and any task whose action runs Invoke-SapCategorySyncPoller.ps1,
  under whatever name) with two new tasks:

    SAP-CMMS-Watch   every 1 minute, as SYSTEM, MultipleInstances IgnoreNew. Runs
                     C:\Users\eldhose\sap-engineering-sync\Watch-CmmsSapSync.ps1 which checks the flag
                     every 2 s for ~55 s and runs the sync in the same process when the flag is up.
    SAP-CMMS-Routine three times a day at the user's chosen times (default 07:00, 13:00, 19:00), as
                     SYSTEM. Runs Invoke-CmmsSapRoutine.ps1 which calls Watch-CmmsSapSync.ps1 -Routine.

  TOUCHES ONLY the two new tasks and the old SAP-Watch-Categories + any task running the old poller.
  LEAVES ALONE: SAP-Watch-Orders, SAP-Watch-Stock, SAP-Watch-Credit, SAP-Watch-Pricing, and every task
  outside \Microsoft\ not listed above. Do NOT run Register-FlagWatchTasks.ps1 - that re-registers the
  sales-dashboard watchers the user disabled.

  Without -Apply this prints what it would do. -Disable disables both new tasks (for rollback).

.PARAMETER Apply          Change the scheduled tasks (register / unregister).
.PARAMETER Disable        Disable SAP-CMMS-Watch and SAP-CMMS-Routine. Used for rollback.
.PARAMETER DeployedDir    Where the three scripts live (the deployed folder). Default
                          C:\Users\eldhose\sap-engineering-sync.
.PARAMETER RoutineTimes   Times of day the routine runs, as HH:mm. Default 07:00, 13:00, 19:00.

.EXAMPLE
  .\Register-CmmsSyncTasks.ps1                   # preview
  .\Register-CmmsSyncTasks.ps1 -Apply            # register the new tasks, remove the old one
  .\Register-CmmsSyncTasks.ps1 -Disable          # rollback step 1
#>
[CmdletBinding()]
param(
    [switch] $Apply,
    [switch] $Disable,
    [string] $DeployedDir = 'C:\Users\eldhose\sap-engineering-sync',
    [string[]] $RoutineTimes = @('07:00', '13:00', '19:00')
)

$ErrorActionPreference = 'Stop'

# MUST RUN ELEVATED. SYSTEM-owned tasks are invisible to a non-elevated session - Get-ScheduledTask
# simply leaves them out, so an unelevated run would NOT remove the old watcher and would add the new
# ones alongside, with two sets running at once (same mistake Register-FlagWatchTasks.ps1 guards against).
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host 'Run this from an elevated PowerShell (Run as administrator).' -ForegroundColor Red
    Write-Host 'Unelevated, the SYSTEM-owned sync tasks are invisible here and would be left running.' -ForegroundColor Red
    exit 1
}

$watchScript   = Join-Path $DeployedDir 'Watch-CmmsSapSync.ps1'
$routineScript = Join-Path $DeployedDir 'Invoke-CmmsSapRoutine.ps1'

# ---- disable (rollback step 1) ----
if ($Disable) {
    foreach ($name in 'SAP-CMMS-Watch', 'SAP-CMMS-Routine') {
        $t = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        if (-not $t) { Write-Host ("not registered: {0}" -f $name) -ForegroundColor DarkGray; continue }
        if ($Apply) {
            Disable-ScheduledTask -TaskName $name -TaskPath $t.TaskPath | Out-Null
            Write-Host ("disabled {0}" -f $name) -ForegroundColor Yellow
        } else { Write-Host ("WOULD disable {0}" -f $name) -ForegroundColor Yellow }
    }
    if (-not $Apply) { Write-Host ''; Write-Host 'PREVIEW ONLY - re-run with -Disable -Apply to disable the tasks.' -ForegroundColor Yellow }
    exit 0
}

# ---- preflight: everything the tasks need must be deployed ----
$missing = @()
foreach ($p in $watchScript, $routineScript) { if (-not (Test-Path -LiteralPath $p)) { $missing += $p } }
foreach ($t in $RoutineTimes) { if ($t -notmatch '^\d{2}:\d{2}$') { Write-Host "bad routine time '$t' - expected HH:mm" -ForegroundColor Red; exit 1 } }
if ($missing.Count) {
    Write-Host 'Stopping - these files are missing:' -ForegroundColor Red
    $missing | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    Write-Host "Copy them from the repo (sap-sync\) into $DeployedDir first." -ForegroundColor Yellow
    exit 1
}

# ---- what will be removed: SAP-Watch-Categories, and any task running Invoke-SapCategorySyncPoller.ps1
# whatever its name. Match on the action, not the task name - the Watch task name is listed as "to do" in
# the sales dashboard's README, so it may not exist on this server at all.
$retire = @('Invoke-SapCategorySyncPoller.ps1')
function Get-Action { param($Task) (@($Task.Actions) | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join ' ; ' }
$all = @(Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\Microsoft\*' })
$toRemove = @()
foreach ($t in $all) {
    if ($t.TaskName -eq 'SAP-Watch-Categories') { $toRemove += $t; continue }
    $act = Get-Action $t
    if (@($retire | Where-Object { $act -like "*$_*" }).Count) { $toRemove += $t }
}

Write-Host ''
Write-Host "Scheduled tasks outside \Microsoft\ right now: $($all.Count)" -ForegroundColor Cyan
foreach ($t in $all) {
    $mark = if ($toRemove -contains $t) { 'REMOVE' } else { 'keep  ' }
    Write-Host ("  {0}  {1}{2}  [{3}]" -f $mark, $t.TaskPath, $t.TaskName, $t.State)
    Write-Host ("          {0}" -f (Get-Action $t)) -ForegroundColor DarkGray
}

Write-Host ''
Write-Host 'Will register:' -ForegroundColor Cyan
Write-Host ("  SAP-CMMS-Watch     every 1 minute, SYSTEM, IgnoreNew, 30-min cap - {0}" -f $watchScript)
Write-Host ("  SAP-CMMS-Routine   daily at {0}, SYSTEM, IgnoreNew, 30-min cap - {1}" -f ($RoutineTimes -join ', '), $routineScript)

if (-not $Apply) {
    Write-Host ''
    Write-Host 'PREVIEW ONLY - nothing changed. Re-run with -Apply to do it.' -ForegroundColor Yellow
    exit 0
}

# ---- apply ----
foreach ($t in $toRemove) {
    Unregister-ScheduledTask -TaskName $t.TaskName -TaskPath $t.TaskPath -Confirm:$false
    Write-Host ("removed  {0}{1}" -f $t.TaskPath, $t.TaskName) -ForegroundColor Green
}

$dur = New-TimeSpan -Days 3650  # Task Scheduler rejects [TimeSpan]::MaxValue.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Limited

# SAP-CMMS-Watch: every 1 minute, runs the one-process watcher.
$watchTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration $dur
$watchArg = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f $watchScript
$watchAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $watchArg
Register-ScheduledTask -TaskName 'SAP-CMMS-Watch' -Action $watchAction -Trigger $watchTrigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host 'registered SAP-CMMS-Watch' -ForegroundColor Green

# SAP-CMMS-Routine: daily at each -RoutineTimes.
$routineTriggers = @($RoutineTimes | ForEach-Object { New-ScheduledTaskTrigger -Daily -At $_ })
$routineArg = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f $routineScript
$routineAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $routineArg
Register-ScheduledTask -TaskName 'SAP-CMMS-Routine' -Action $routineAction -Trigger $routineTriggers -Settings $settings -Principal $principal -Force | Out-Null
Write-Host ("registered SAP-CMMS-Routine ({0})" -f ($RoutineTimes -join ', ')) -ForegroundColor Green

Write-Host ''
Get-ScheduledTask -TaskName 'SAP-CMMS-*' | Select-Object TaskName, State | Format-Table -AutoSize
Write-Host 'Done. The watcher writes cmms-watch-<date>.log next to the sync''s own logs.' -ForegroundColor Cyan
Write-Host 'The CMMS sees "SAP sync offline since <time>" from watcher_seen_at on the control Single.' -ForegroundColor DarkGray
