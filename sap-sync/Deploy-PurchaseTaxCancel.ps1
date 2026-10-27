<#
.SYNOPSIS
  Puts the purchase-tax-cancel version (PR #19) live: live ERPNext schema, the SAP server's sync scripts,
  the scheduled tasks and the posting switches for every live company. Run it ON THE SAP SERVER, elevated.

.DESCRIPTION
  Without -Apply it changes nothing: it checks the paths, shows what it would copy, runs every setup script as a
  dry run and previews the scheduled tasks. With -Apply it does it, in this order, and stops at the first error:

    1. Backs up C:\Users\eldhose\sap-engineering-sync (logs\ left out) to sap-engineering-sync-backup-<yyyyMMdd-HHmm>.
    2. Copies the sync scripts and setup-*.js from this checkout's sap-sync\ into it.
       config.json, poller.config.json and logs\ are never overwritten.
    3. Live ERPNext (key from C:\Users\eldhose\Manna_CMMS\server\.env, read by erp.js; never printed):
       setup-purchase-quotation.js, setup-sync-jobs.js, setup-tax-on-receipt.js, setup-cancel.js,
       then server\scripts\syncPurchasing.js. All only add, and are safe to run again.
    4. config.json: turns on the purchase posting switches (below). A copy is kept in the backup folder.
       skip_companies is shown, not changed: a company listed there gets nothing posted.
    5. Register-CmmsSyncTasks.ps1 -Apply (the fast watcher + the 3-a-day routine).
    6. One Sync-SapItemCategories.ps1 -DryRun, so the log can be read before the first real push.

  Before running: in C:\Users\eldhose\Manna_CMMS run
      git fetch origin
      git checkout purchase-tax-cancel
      git pull
      cd server; npm ci     (only if package-lock.json changed)

  After it: merge PR #19 (deploys the client and the API), then test one small real purchase.

.PARAMETER Apply   Do it. Without it, nothing is changed.
.PARAMETER Repo    The Manna_CMMS checkout on this server.
.PARAMETER Live    The live sync folder.

.EXAMPLE
  .\Deploy-PurchaseTaxCancel.ps1           # preview
  .\Deploy-PurchaseTaxCancel.ps1 -Apply    # do it

.NOTES
  Rollback: sap-sync\README.md, "Deploy and rollback" (Register-CmmsSyncTasks.ps1 -Disable -Apply, then restore the
  backup folder this script made). The ERPNext fields it adds are harmless to the old app and need no rollback.
#>
param(
    [switch] $Apply,
    [string] $Repo = 'C:\Users\eldhose\Manna_CMMS',
    [string] $Live = 'C:\Users\eldhose\sap-engineering-sync'
)
$ErrorActionPreference = 'Stop'

$Files = @(
    'Sync-SapItemCategories.ps1', 'Watch-CmmsSapSync.ps1', 'Invoke-CmmsSapRoutine.ps1', 'Register-CmmsSyncTasks.ps1',
    'erp.js', 'setup-purchase-quotation.js', 'setup-goods-receipt.js', 'setup-sync-jobs.js',
    'setup-tax-on-receipt.js', 'setup-cancel.js'
)
$Setups = @('setup-purchase-quotation.js', 'setup-sync-jobs.js', 'setup-tax-on-receipt.js', 'setup-cancel.js')
$Switches = @(
    'post_purchase_requests', 'post_purchase_orders',
    'post_purchase_quotations', 'post_quotation_purchase_orders', 'post_quotation_receipts'
)

function Step($text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "STOPPED: $text" -ForegroundColor Red; exit 1 }
function Run-Node($dir, [string[]] $nodeArgs) {
    Push-Location $dir
    try { & node @nodeArgs; if ($LASTEXITCODE -ne 0) { Fail "node $($nodeArgs -join ' ') exited $LASTEXITCODE" } }
    finally { Pop-Location }
}

# ---- checks
Step 'Checks'
$src = Join-Path $Repo 'sap-sync'
foreach ($p in @($src, $Live, (Join-Path $Repo 'server\.env'), (Join-Path $Live 'config.json'))) {
    if (-not (Test-Path $p)) { Fail "$p is missing" }
}
$branch = (& git -C $Repo rev-parse --abbrev-ref HEAD).Trim()
$commit = (& git -C $Repo rev-parse --short HEAD).Trim()
Write-Host "Checkout: $Repo on $branch @ $commit"
if ($branch -ne 'purchase-tax-cancel' -and $branch -ne 'main') { Fail "check out purchase-tax-cancel (or main after the merge) first" }
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Fail 'run this from an elevated PowerShell (Run as administrator) - the scheduled tasks need it' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'node is not on PATH' }
foreach ($f in $Files) { if (-not (Test-Path (Join-Path $src $f))) { Fail "$f is not in $src" } }
Write-Host 'OK'

# ---- 1. backup
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$backup = "$Live-backup-$stamp"
Step "1. Backup to $backup"
if ($Apply) {
    robocopy $Live $backup /E /XD (Join-Path $Live 'logs') /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { Fail "backup failed (robocopy $LASTEXITCODE)" }
    Write-Host 'Backed up.'
} else { Write-Host '(preview) would back up, logs\ left out' }

# ---- 2. copy
Step '2. Copy the sync scripts'
foreach ($f in $Files) {
    $from = Join-Path $src $f; $to = Join-Path $Live $f
    $same = (Test-Path $to) -and ((Get-FileHash $from).Hash -eq (Get-FileHash $to).Hash)
    Write-Host ("{0,-34} {1}" -f $f, $(if ($same) { 'unchanged' } elseif (Test-Path $to) { 'updated' } else { 'new' }))
    if ($Apply -and -not $same) { Copy-Item $from $to -Force }
}

# ---- 3. live ERPNext
Step '3. Live ERPNext (dry run first)'
$env:CMMS_ENV = Join-Path $Repo 'server\.env'
foreach ($s in $Setups) {
    Write-Host "-- $s (dry run)" -ForegroundColor DarkCyan
    Run-Node $Live @($s)
}
Write-Host '-- syncPurchasing.js --dry-run' -ForegroundColor DarkCyan
Run-Node (Join-Path $Repo 'server') @('scripts/syncPurchasing.js', '--dry-run')
if ($Apply) {
    foreach ($s in $Setups) {
        Write-Host "-- $s --apply" -ForegroundColor DarkCyan
        Run-Node $Live @($s, '--apply')
    }
    Write-Host '-- syncPurchasing.js' -ForegroundColor DarkCyan
    Run-Node (Join-Path $Repo 'server') @('scripts/syncPurchasing.js')
}
Remove-Item Env:\CMMS_ENV

# ---- 4. switches
Step '4. Posting switches in config.json'
$cfgPath = Join-Path $Live 'config.json'
$cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
$changed = $false
foreach ($k in $Switches) {
    $now = if ($cfg.PSObject.Properties[$k]) { [bool]$cfg.$k } else { $false }
    Write-Host ("{0,-34} {1}" -f $k, $(if ($now) { 'on' } else { 'off -> on' }))
    if (-not $now) {
        if ($cfg.PSObject.Properties[$k]) { $cfg.$k = $true } else { $cfg | Add-Member -NotePropertyName $k -NotePropertyValue $true }
        $changed = $true
    }
}
$skips = @(if ($cfg.PSObject.Properties['skip_companies']) { @($cfg.skip_companies) })
if ($skips.Count) { Write-Host "skip_companies: $($skips -join ', ') - these get nothing posted. Edit config.json if that is no longer wanted." -ForegroundColor Yellow }
else { Write-Host 'skip_companies: none - every company in config.json is posted to.' }
if ($Apply -and $changed) {
    # The backup folder already holds the old config.json.
    [IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding $false))
    Write-Host 'config.json saved.'
}

# ---- 5. scheduled tasks
Step '5. Scheduled tasks'
Push-Location $Live
try { if ($Apply) { .\Register-CmmsSyncTasks.ps1 -Apply } else { .\Register-CmmsSyncTasks.ps1 } }
finally { Pop-Location }

# ---- 6. dry run of the sync
Step '6. One dry run of the sync'
if ($Apply) {
    Push-Location $Live
    try { .\Sync-SapItemCategories.ps1 -DryRun -Mode Routine } finally { Pop-Location }
    Write-Host "Read the newest log in $Live\logs before the first real push."
} else { Write-Host '(preview) would run Sync-SapItemCategories.ps1 -DryRun -Mode Routine' }

Write-Host ''
if ($Apply) {
    Write-Host "Done. Backup: $backup. Next: merge PR #19, then test one small real purchase." -ForegroundColor Green
} else {
    Write-Host 'PREVIEW ONLY - nothing changed. Re-run with -Apply to do it.' -ForegroundColor Yellow
}
