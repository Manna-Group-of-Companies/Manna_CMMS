<#
.SYNOPSIS
  One-process watcher for the CMMS -> SAP engineering sync. Runs the sync in its own process.

.DESCRIPTION
  Replaces Invoke-FlagWatch.ps1 + Invoke-SapCategorySyncPoller.ps1 for the CMMS (27 Oct 2026). Started by
  Task Scheduler every minute, this watcher runs a short loop (default 55 s), checks the control Single's
  sync_requested flag every 2 s, and when it is up runs Sync-SapItemCategories.ps1 -Mode Job IN THIS SAME
  PROCESS (watcher -> poller -> sync was three processes per run). Writes watcher_seen_at as a heartbeat,
  so the CMMS can show "SAP sync offline since 10:42" instead of a spinner that never stops.

  Field names on the Single "SAP Item Category Sync Control" are the same as the old poller used, plus
  five added by setup-sync-jobs.js: watcher_seen_at, watcher_version, routine_last_at, routine_last_result,
  vendor_refresh_requested. A missing field is treated as empty: the watcher still runs, but a warning
  goes in the log once and the heartbeat is not written. Run setup-sync-jobs.js --apply to add them.

  LOOP (every 2 s, up to -WindowSeconds):
    1. Write watcher_seen_at + watcher_version at the start, and whenever 60 s have passed.
    2. GET the control Single.
    3. sync_requested = 1 -> wait 3 s (so several saves go in one run), claim the run, run the sync in
       this process (& $syncScript -Mode Job ...), write the result back, and check the flag again at
       once. A run still going at the end of the window simply finishes; after it the window ends.
    4. Safety net every 30 s: if any CMMS doctype has a record Queued for more than 60 s and no run is
       going, run a Job anyway. The watcher's own PUTs and the CMMS raising the flag can, rarely,
       overwrite each other.
    5. Stale run: status = Running and last_run_started_at older than -StaleMinutes (15) -> take it over.
    6. One run at a time: a named mutex `Global\MannaCmmsSapSync` guards every run (job or routine);
       the routine runner (-Routine) takes the same mutex, so a job never overlaps a routine.

  NO COOLDOWN: cooldown_until / cooldown_minutes are ignored. The watcher clears cooldown_until when it
  writes a result, so the app's status widget never shows a stale cooldown.

  LOGIN FAILURE: a 400/401 at SAP /Login writes logs\login-blocked.json and the sync skips that company
  in every later run. Done by Sync-SapItemCategories.ps1 - this watcher does not log in to SAP.

.PARAMETER ConfigPath      poller.config.json (ERPNext url, bot key/secret, control doctype, sync script
                           and config paths). Defaults to the file next to this script.
.PARAMETER WindowSeconds   How long this instance keeps checking before exiting. Default 55 s, so it is
                           gone before the next minute's task fires.
.PARAMETER IntervalSeconds Seconds between flag checks. Default 2.
.PARAMETER WaitSeconds     Seconds to wait after seeing the flag up, so several saves land in one run.
                           Default 3.
.PARAMETER StaleMinutes    status = Running older than this is taken over. Default 15.
.PARAMETER Routine         Run one routine run and exit. Takes the same mutex. Called by SAP-CMMS-Routine
                           three times a day.
.PARAMETER Once            Check once and exit (for testing by hand).
.PARAMETER ForceJob        Run one job regardless of the flag (for testing by hand).
#>
[CmdletBinding()]
param(
    [string] $ConfigPath,
    [ValidateRange(5, 58)] [int] $WindowSeconds = 55,
    [ValidateRange(1, 30)] [int] $IntervalSeconds = 2,
    [ValidateRange(0, 30)] [int] $WaitSeconds = 3,
    [ValidateRange(1, 60)] [int] $StaleMinutes = 15,
    [switch] $Routine,
    [switch] $Once,
    [switch] $ForceJob
)

Set-StrictMode -Version 1.0
$ErrorActionPreference = 'Stop'
$WatcherVersion = 'cmms-watch 2026-10-27'

$scriptDir = $PSScriptRoot; if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $ConfigPath) { $ConfigPath = Join-Path $scriptDir 'poller.config.json' }
if (-not (Test-Path -LiteralPath $ConfigPath)) { Write-Error "poller config not found: $ConfigPath"; exit 2 }
$cfg = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($k in 'erpnext_site', 'bot_api_key', 'bot_api_secret', 'control_doctype', 'sync_script', 'sync_config') {
    if (-not "$($cfg.$k)".Trim() -or "$($cfg.$k)" -match 'PUT_.*_HERE') { Write-Error "poller config '$k' is missing or still a placeholder."; exit 2 }
}
foreach ($p in @($cfg.sync_script, $cfg.sync_config)) { if (-not (Test-Path -LiteralPath $p)) { Write-Error "path not found: $p"; exit 2 } }

$logDir = "$($cfg.log_dir)".Trim(); if (-not $logDir) { $logDir = $scriptDir }
if (-not [System.IO.Path]::IsPathRooted($logDir)) { $logDir = Join-Path $scriptDir ($logDir -replace '^[.][\\/]', '') }
if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$watchLog = Join-Path $logDir ('cmms-watch-{0}.log' -f (Get-Date -Format 'yyyy-MM-dd'))
$resultJson = "$($cfg.result_json)".Trim(); if (-not $resultJson) { $resultJson = Join-Path $logDir 'category-last-result.json' }

function Log {
    param([ValidateSet('INFO', 'WARN', 'ERROR')] [string] $Level = 'INFO', [string] $Message)
    $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    switch ($Level) { 'ERROR' { Write-Host $line -ForegroundColor Red } 'WARN' { Write-Host $line -ForegroundColor Yellow } default { Write-Host $line } }
    try { Add-Content -LiteralPath $watchLog -Value $line -Encoding UTF8 } catch { }
}

if ($PSVersionTable.PSVersion.Major -lt 6) { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 }

$site = "$($cfg.erpnext_site)".TrimEnd('/')
$docName = "$($cfg.control_doctype)"
$docUrl = "$site/api/resource/$([uri]::EscapeDataString($docName))/$([uri]::EscapeDataString($docName))"
$authHdr = @{ Authorization = ('token {0}:{1}' -f $cfg.bot_api_key, $cfg.bot_api_secret) }

function Get-Control { (Invoke-RestMethod -Method Get -Uri $docUrl -Headers $authHdr -TimeoutSec 20).data }
function Set-Control {
    param([hashtable] $Fields)
    try { $null = Invoke-RestMethod -Method Put -Uri $docUrl -Headers $authHdr -ContentType 'application/json' -Body ($Fields | ConvertTo-Json -Compress) -TimeoutSec 20 }
    catch {
        # One of the new fields may be missing: Frappe answers 417 (ValidationError) with the field name.
        # Drop the fields that caused it and try again, so the heartbeat and the base fields still land.
        $msg = $_.Exception.Message
        $dropped = @(); foreach ($k in @($Fields.Keys)) { if ("$msg" -match [regex]::Escape($k)) { $dropped += $k } }
        if (-not $dropped.Count) { throw }
        $retry = @{}; foreach ($k in @($Fields.Keys)) { if ($dropped -notcontains $k) { $retry[$k] = $Fields[$k] } }
        if (-not $retry.Count) { Log WARN ("PUT dropped - all fields unknown on {0}: {1}" -f $docName, ($dropped -join ', ')); return }
        $null = Invoke-RestMethod -Method Put -Uri $docUrl -Headers $authHdr -ContentType 'application/json' -Body ($retry | ConvertTo-Json -Compress) -TimeoutSec 20
        Log WARN ("PUT retried without {0} (fields missing - run setup-sync-jobs.js --apply)" -f ($dropped -join ', '))
    }
}
function Parse-Dt { param($Value) if (-not "$Value".Trim()) { return $null } try { return [datetime]::Parse("$Value", [Globalization.CultureInfo]::InvariantCulture) } catch { return $null } }
function Now-Str { (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') }

# A doctype -> filters pair the safety net uses, 60 s after a Queued record is modified. Only cheap list reads
# (count: 1), no full-record reads. A doctype that is not present (setup not applied yet) is skipped.
$queueProbes = @(
    @{ dt = 'CMMS Item Naming Request'; filter = '[["sap_create_status","=","Queued"],["modified","<",{0}]]' },
    @{ dt = 'Item'; filter = '[["custom_sap_category_pending","=",1],["modified","<",{0}]]' },
    @{ dt = 'CMMS Goods Receipt'; filter = '[["status","=","Queued"],["modified","<",{0}]]' },
    @{ dt = 'CMMS Goods Issue'; filter = '[["status","=","Queued"],["modified","<",{0}]]' },
    @{ dt = 'CMMS Purchase Request'; filter = '[["status","=","Queued"],["modified","<",{0}]]' },
    @{ dt = 'CMMS Purchase Request'; filter = '[["po_status","=","Queued"],["modified","<",{0}]]' },
    @{ dt = 'CMMS Purchase Quotation'; filter = '[["status","=","Queued"],["modified","<",{0}]]' },
    @{ dt = 'CMMS Purchase Order'; filter = '[["sync_status","=","Queued"],["modified","<",{0}]]' },
    @{ dt = 'CMMS SAP HSN Request'; filter = '[["status","=","Queued"],["modified","<",{0}]]' },
    @{ dt = 'CMMS SAP Item Group Request'; filter = '[["status","=","Queued"],["modified","<",{0}]]' }
)
function Test-Stuck {
    $cutoff = (Get-Date).AddSeconds(-60).ToString('yyyy-MM-dd HH:mm:ss')
    foreach ($p in $queueProbes) {
        try {
            $u = '{0}/api/resource/{1}?filters={2}&limit_page_length=1&fields=["name"]' -f $site, [uri]::EscapeDataString($p.dt), [uri]::EscapeDataString(($p.filter -f (ConvertTo-Json -InputObject $cutoff -Compress)))
            $r = Invoke-RestMethod -Method Get -Uri $u -Headers $authHdr -TimeoutSec 10
            if ($r.data -and @($r.data).Count -gt 0) { return $true }
        } catch {
            # A doctype that is not there yet: HTTP 404 or 417. Skipped silently; nothing stuck there.
            if ("$($_.Exception.Message)" -notmatch '404|417|DoesNotExist|does not exist|OSError|not found') {
                Log WARN ("safety-net probe on {0} failed: {1}" -f $p.dt, $_.Exception.Message)
            }
        }
    }
    $false
}

function Invoke-SyncOnce {
    param([string] $Mode, [string] $Trigger)
    $started = Get-Date
    $msg = $null; $rows = 0; $exit = 0; $failures = 0; $success = $false
    if (Test-Path -LiteralPath $resultJson) { try { Remove-Item -LiteralPath $resultJson -Force -ErrorAction SilentlyContinue } catch { } }
    try {
        Log INFO ("claiming the run ({0}, trigger: {1})" -f $Mode, $Trigger)
        Set-Control @{ status = 'Running'; last_run_started_at = (Now-Str); sync_requested = 0 }
        # In this same process: & returns, exit in the sync ends the sync only, $LASTEXITCODE is set.
        # Working directory stays wherever the task runs it from; the sync uses $PSScriptRoot for its own files.
        & $cfg.sync_script -Mode $Mode -ConfigPath $cfg.sync_config -ResultJsonPath $resultJson
        $exit = [int]$LASTEXITCODE
        $elapsed = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
        $res = $null
        if (Test-Path -LiteralPath $resultJson) {
            try { $res = Get-Content -LiteralPath $resultJson -Raw -Encoding UTF8 | ConvertFrom-Json }
            catch { Log WARN "could not parse result json: $($_.Exception.Message)" }
        }
        if ($res) {
            if ($res.PSObject.Properties['changed']) { $rows = [int]$res.changed }
            if ($res.PSObject.Properties['failures']) { $failures = [int]$res.failures }
            if ($res.PSObject.Properties['summary'] -and "$($res.summary)".Trim()) { $msg = "$($res.summary)" }
            elseif ($res.PSObject.Properties['error'] -and "$($res.error)".Trim()) { $msg = "FATAL: $($res.error)" }
        }
        if (-not $msg) { $msg = "sync exited $exit after ${elapsed}s (no result file)" }
        if ($msg.Length -gt 500) { $msg = $msg.Substring(0, 500) + ' ...' }
        $success = ($exit -eq 0 -and $failures -eq 0 -and -not ($res -and $res.PSObject.Properties['error'] -and "$($res.error)".Trim()))
        $final = @{
            status = $(if ($success) { 'Success' } else { 'Failed' })
            last_result_message = $msg
            last_rows_changed = $rows
            cooldown_until = ''  # 27 Oct 2026: no cooldown. Cleared so the app's status widget never shows a stale one.
        }
        if ($success) { $final.last_sync_at = (Now-Str) }
        Set-Control $final
        Log INFO ("sync exit {0} after {1}s: {2}" -f $exit, $elapsed, $msg)
    } catch {
        $msg = "watcher error: $($_.Exception.Message)"
        Log ERROR $msg
        try { Set-Control @{ status = 'Failed'; last_result_message = $msg; cooldown_until = '' } }
        catch { Log ERROR "could not write Failed status back: $($_.Exception.Message)" }
    }
    [pscustomobject]@{ exit = $exit; success = $success; elapsed = ((Get-Date) - $started).TotalSeconds; message = $msg }
}

# ---- heartbeat ----
$script:lastBeat = [datetime]::MinValue
function Write-Heartbeat {
    param([switch] $Force)
    if (-not $Force -and ((Get-Date) - $script:lastBeat).TotalSeconds -lt 60) { return }
    try { Set-Control @{ watcher_seen_at = (Now-Str); watcher_version = $WatcherVersion } } catch { Log WARN "heartbeat not written: $($_.Exception.Message)" }
    $script:lastBeat = Get-Date
}

# ---- one mutex guards every run (job or routine) ----
$mutexName = 'Global\MannaCmmsSapSync'
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($false, $mutexName, [ref]$createdNew)

try {
    # Routine mode: wait up to 10 min for a job run to finish, then run and exit.
    if ($Routine) {
        Log INFO 'routine run requested - waiting for the mutex (up to 10 min)'
        if (-not $mutex.WaitOne([TimeSpan]::FromMinutes(10))) { Log WARN 'mutex not acquired in 10 min - skipping this routine'; exit 0 }
        try { Write-Heartbeat -Force; $r = Invoke-SyncOnce -Mode 'Routine' -Trigger 'schedule'; exit $(if ($r.success) { 0 } else { 1 }) }
        finally { try { $mutex.ReleaseMutex() } catch { } }
    }

    $started = Get-Date; $deadline = $started.AddSeconds($WindowSeconds); $lastStuckAt = $started.AddSeconds(-30); $lastError = $null
    Write-Heartbeat -Force
    if ($ForceJob) {
        if ($mutex.WaitOne(0)) { try { $null = Invoke-SyncOnce -Mode 'Job' -Trigger 'force' } finally { try { $mutex.ReleaseMutex() } catch { } } }
        else { Log WARN 'mutex is held by another process - force run skipped' }
        exit 0
    }

    while ($true) {
        $tick = Get-Date
        $decision = 'idle'; $trigger = ''
        try {
            $doc = Get-Control
            $flag = 0; try { $flag = [int]("$($doc.sync_requested)" -as [int]) } catch { }
            $status = "$($doc.status)"
            $startedAt = Parse-Dt $doc.last_run_started_at
            if ($flag -eq 1) { $decision = 'run'; $trigger = "$($doc.sync_requested_by)" }
            elseif ($status -eq 'Running' -and $startedAt -and ((Get-Date) - $startedAt).TotalMinutes -ge $StaleMinutes) {
                $decision = 'run'; $trigger = ("stale run - last_run_started_at {0:n1} min ago" -f ((Get-Date) - $startedAt).TotalMinutes)
            }
            $lastError = $null
        } catch {
            $m = $_.Exception.Message
            if ($m -ne $lastError) { Log WARN ("cannot read {0}: {1}" -f $docName, $m) }
            $lastError = $m
        }

        # Safety net every 30 s: if nothing else has run yet and a record has been Queued for > 60 s, run a Job anyway.
        if ($decision -ne 'run' -and ((Get-Date) - $lastStuckAt).TotalSeconds -ge 30) {
            $lastStuckAt = Get-Date
            try { if (Test-Stuck) { $decision = 'run'; $trigger = 'safety net - a record has been Queued for more than 60 s' } }
            catch { Log WARN ("safety-net check failed: {0}" -f $_.Exception.Message) }
        }

        if ($decision -eq 'run') {
            if ($mutex.WaitOne(0)) {
                try {
                    # 3 s wait so several saves land in one run; the flag is already up, this does not slow a single save
                    # beyond the 2 s check + the 3 s wait.
                    if ($WaitSeconds -gt 0) { Start-Sleep -Seconds $WaitSeconds }
                    Write-Heartbeat -Force
                    $null = Invoke-SyncOnce -Mode 'Job' -Trigger $trigger
                } finally { try { $mutex.ReleaseMutex() } catch { } }
                # Check the flag again at once, without the interval wait: work saved during the run should go straight away.
                if ((Get-Date) -lt $deadline) { continue }
                break
            } else { Log INFO 'mutex held by another process - will try again next tick' }
        }

        Write-Heartbeat
        if ($Once) { break }
        $sleep = $IntervalSeconds - ((Get-Date) - $tick).TotalSeconds
        if ($sleep -gt 0 -and (Get-Date).AddSeconds($sleep) -lt $deadline) { Start-Sleep -Milliseconds ([int]($sleep * 1000)) }
        else { break }
    }
    exit 0
} finally {
    try { $mutex.Dispose() } catch { }
}
