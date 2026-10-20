<#
.SYNOPSIS
  Creates Purchase Request numbering series for FY 26-27 in HITECH_RUBBER_LIVE and MANNA_TYRE_LIVE.

.DESCRIPTION
  The Eldhose user does not have Document Numbering permission. This script logs in with a
  manager/admin account that does have it, creates the series, then updates the ERPNext options
  so the CMMS sync uses the new series.

  Run from PowerShell:
    .\Create-PurchaseRequestSeries.ps1

  It will prompt for the SAP manager username and password.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version 1.0
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$curl = (Get-Command curl.exe).Source
$slBase = 'https://192.168.100.200:50000/b1s/v1'
$US = [string][char]0x1F

function Invoke-Sl {
    param([string] $Method, [string] $Url, [string] $Body, [string] $Jar, [switch] $SaveCookies)
    $tag = [guid]::NewGuid().ToString('N').Substring(0, 8)
    $resp = Join-Path $env:TEMP "prseries-$tag-resp.txt"; $bodyFile = $null
    $a = @('-k', '-s', '--globoff', '--connect-timeout', '15', '--max-time', '120',
           '-H', 'Expect:', '-o', $resp, '-w', "%{http_code}$US%{time_total}", '-X', $Method)
    if ($SaveCookies) { $a += @('-c', $Jar) } else { $a += @('-b', $Jar) }
    if ($null -ne $Body -and $Body -ne '') {
        $bodyFile = Join-Path $env:TEMP "prseries-$tag-body.json"
        [IO.File]::WriteAllText($bodyFile, $Body, $utf8)
        $a += @('-H', 'Content-Type: application/json', '--data-binary', "@$bodyFile")
    }
    $a += ($Url -replace ' ', '%20' -replace "'", '%27')
    try {
        $meta = & $curl @a
        $text = if (Test-Path -LiteralPath $resp) { [IO.File]::ReadAllText($resp) } else { '' }
    } finally {
        if (Test-Path -LiteralPath $resp) { [IO.File]::Delete($resp) }
        if ($bodyFile -and (Test-Path -LiteralPath $bodyFile)) { [IO.File]::Delete($bodyFile) }
    }
    $p = "$meta" -split [regex]::Escape($US)
    [pscustomobject]@{ Http = "$($p[0])"; Body = $text }
}

# -- Prompt for credentials ---
Write-Host ''
Write-Host '=== Create Purchase Request Numbering Series (FY 26-27) ===' -ForegroundColor Cyan
Write-Host ''
Write-Host 'This creates PR numbering series for:' -ForegroundColor White
Write-Host '  1. HITECH_RUBBER_LIVE   (Hi-Tech Rubber Industries)'
Write-Host '  2. MANNA_TYRE_LIVE      (Manna Tyre Retreads)'
Write-Host ''
Write-Host 'Enter the SAP manager username (same for both companies):' -ForegroundColor Yellow
$username = Read-Host 'SAP Manager Username'

# -- Companies that need series ---
$companies = @(
    @{
        db       = 'HITECH_RUBBER_LIVE'
        abbr     = 'HRI'
        label    = 'Hi-Tech Rubber Industries'
        name     = 'HRI-PR'
        period   = 'FY26-27'
    },
    @{
        db       = 'MANNA_TYRE_LIVE'
        abbr     = 'MTR'
        label    = 'Manna Tyre Retreads'
        name     = 'MTR-PR'
        period   = 'FY26-27'
    }
)

$newSeries = @{}   # abbr -> series number

foreach ($co in $companies) {
    Write-Host ''
    Write-Host ("-- {0} ({1}) --" -f $co.label, $co.db) -ForegroundColor Cyan

    # Prompt for this company's password
    Write-Host ("  Enter password for {0} in {1}:" -f $username, $co.db) -ForegroundColor Yellow
    $secPw = Read-Host '  Password' -AsSecureString
    $bstr  = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secPw)
    $pw    = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

    $jar = Join-Path $env:TEMP ("prseries-{0}.jar" -f $co.abbr)
    try {
        # Login
        $loginBody = @{ CompanyDB = $co.db; UserName = $username; Password = $pw } | ConvertTo-Json -Compress
        $lg = Invoke-Sl -Method POST -Url "$slBase/Login" -Body $loginBody -Jar $jar -SaveCookies
        $loginBody = $null; $pw = $null
        if ($lg.Http -ne '200') {
            Write-Host ("  LOGIN FAILED (HTTP {0}): {1}" -f $lg.Http, $lg.Body) -ForegroundColor Red
            continue
        }
        Write-Host "  Login OK" -ForegroundColor Green

        # Check existing PR series first
        $existing = Invoke-Sl -Method POST -Url "$slBase/SeriesService_GetDocumentSeries" `
                     -Body '{"DocumentTypeParams":{"Document":"1470000113"}}' -Jar $jar
        if ($existing.Http -eq '200') {
            $allSeries = ($existing.Body | ConvertFrom-Json).value
            $match = @($allSeries | Where-Object { $_.PeriodIndicator -eq $co.period })
            if ($match.Count -gt 0) {
                Write-Host ("  26-27 series ALREADY EXISTS: Series {0} ({1})" -f $match[0].Series, $match[0].Name) -ForegroundColor Yellow
                $newSeries[$co.abbr] = [int]$match[0].Series
                continue
            }
            Write-Host ("  Found {0} existing PR series, none for {1}" -f $allSeries.Count, $co.period)
        }

        # Create the series
        $seriesPayload = @{
            Series = @{
                Document         = '1470000113'
                DocumentSubType  = '--'
                InitialNumber    = 1
                NextNumber       = 1
                Name             = $co.name
                Prefix           = ''
                Suffix           = ''
                Remarks          = 'CMMS Purchase Requests 26-27'
                GroupCode        = 'sg_Group1'
                Locked           = 'tNO'
                PeriodIndicator  = $co.period
                SeriesType       = 'stDocument'
                IsDigitalSeries  = 'tNO'
                IsManual         = 'tNO'
            }
        } | ConvertTo-Json -Compress -Depth 3

        $sr = Invoke-Sl -Method POST -Url "$slBase/SeriesService_AddSeries" -Body $seriesPayload -Jar $jar
        if ($sr.Http -eq '200' -or $sr.Http -eq '201') {
            $doc = $sr.Body | ConvertFrom-Json
            $sn = [int]$doc.Series
            $newSeries[$co.abbr] = $sn
            Write-Host ("  CREATED series {0} (name={1})" -f $sn, $co.name) -ForegroundColor Green
        } else {
            Write-Host ("  FAILED to create series (HTTP {0}):" -f $sr.Http) -ForegroundColor Red
            Write-Host ("  {0}" -f $sr.Body)
        }
    } finally {
        try {
            $lo = Invoke-Sl -Method POST -Url "$slBase/Logout" -Jar $jar
            Write-Host ("  Logout: HTTP {0}" -f $lo.Http)
        } catch { }
        if (Test-Path -LiteralPath $jar) { Remove-Item -LiteralPath $jar -Force -ErrorAction SilentlyContinue }
    }
}

# -- Update ERPNext options ---
if ($newSeries.Count -gt 0) {
    Write-Host ''
    Write-Host '-- Updating ERPNext item_master_options --' -ForegroundColor Cyan

    $envFile = Join-Path $PSScriptRoot '..\server\.env'
    if (-not (Test-Path $envFile)) { throw "server/.env not found — cannot read ERPNext credentials" }
    $envLines = Get-Content $envFile
    $erpUrl    = ($envLines | Where-Object { $_ -match '^ERPNEXT_URL=' })    -replace '^ERPNEXT_URL=',''
    $erpKey    = ($envLines | Where-Object { $_ -match '^ERPNEXT_API_KEY=' }) -replace '^ERPNEXT_API_KEY=',''
    $erpSecret = ($envLines | Where-Object { $_ -match '^ERPNEXT_API_SECRET=' }) -replace '^ERPNEXT_API_SECRET=',''
    if (-not $erpUrl -or -not $erpKey -or -not $erpSecret) { throw "Missing ERPNEXT_URL/API_KEY/API_SECRET in server/.env" }
    $erpBase = $erpUrl.TrimEnd('/')
    $erpHdr  = @{ Authorization = "token ${erpKey}:${erpSecret}" }
    $ctlUrl  = "$erpBase/api/resource/SAP%20Item%20Category%20Sync%20Control/SAP%20Item%20Category%20Sync%20Control"

    $ctl  = Invoke-RestMethod -Method Get -Uri "$ctlUrl`?fields=[`"item_master_options`"]" -Headers $erpHdr -TimeoutSec 30
    $opts = $ctl.data.item_master_options | ConvertFrom-Json

    foreach ($abbr in $newSeries.Keys) {
        $sn = $newSeries[$abbr]
        $opts.$abbr | Add-Member -NotePropertyName 'pr_series' -NotePropertyValue $sn -Force
        Write-Host ("  {0}: pr_series = {1}" -f $abbr, $sn)
    }

    $body = @{ item_master_options = ($opts | ConvertTo-Json -Compress -Depth 10) } | ConvertTo-Json -Compress -Depth 2
    Invoke-RestMethod -Method Put -Uri $ctlUrl -Headers $erpHdr `
        -ContentType 'application/json; charset=utf-8' `
        -Body $utf8.GetBytes($body) -TimeoutSec 30 | Out-Null
    Write-Host '  ERPNext options updated' -ForegroundColor Green

    # Also reset PR-2026-00258 from Failed to Queued so the next sync retries it
    try {
        $prUrl = "$erpBase/api/resource/CMMS%20Purchase%20Request/PR-2026-00258"
        $pr = Invoke-RestMethod -Method Get -Uri "$prUrl`?fields=[`"name`",`"status`"]" -Headers $erpHdr -TimeoutSec 15
        if ("$($pr.data.status)" -eq 'Failed') {
            Invoke-RestMethod -Method Put -Uri $prUrl -Headers $erpHdr `
                -ContentType 'application/json; charset=utf-8' `
                -Body $utf8.GetBytes((@{ status = 'Queued'; error = '' } | ConvertTo-Json -Compress)) -TimeoutSec 15 | Out-Null
            Write-Host '  PR-2026-00258 reset to Queued (will be retried on next sync)' -ForegroundColor Green
        }
    } catch { Write-Host "  Could not reset PR-2026-00258: $($_.Exception.Message)" -ForegroundColor Yellow }

    # Trigger a sync
    try {
        Invoke-RestMethod -Method Put -Uri $ctlUrl -Headers $erpHdr `
            -ContentType 'application/json; charset=utf-8' `
            -Body $utf8.GetBytes((@{ sync_requested = 1 } | ConvertTo-Json -Compress)) -TimeoutSec 15 | Out-Null
        Write-Host '  Sync triggered (sync_requested = 1)' -ForegroundColor Green
    } catch { Write-Host "  Could not trigger sync: $($_.Exception.Message)" -ForegroundColor Yellow }
}

# -- Summary ---
Write-Host ''
Write-Host '=== Summary ===' -ForegroundColor Cyan
if ($newSeries.Count -eq 0) {
    Write-Host '  No series were created.' -ForegroundColor Yellow
} else {
    foreach ($abbr in $newSeries.Keys) {
        Write-Host ("  {0}: PR series = {1}" -f $abbr, $newSeries[$abbr]) -ForegroundColor Green
    }
    Write-Host ''
    Write-Host '  The sync has been triggered. It will:' -ForegroundColor White
    Write-Host '    - Retry PR-2026-00258 for HRI with the new series'
    Write-Host '    - Pick up the dummy POs for all companies'
    Write-Host '    - Refresh the open PO lines in the CMMS app'
    Write-Host ''
    Write-Host '  After the sync completes (~30 seconds), the CMMS app will show:' -ForegroundColor White
    Write-Host '    - Open POs ready for goods receipt in all 4 companies'
    Write-Host '    - PR-2026-00258 posted to SAP for HRI'
}
Write-Host ''
