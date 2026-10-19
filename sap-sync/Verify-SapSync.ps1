<#
.SYNOPSIS
    Read-only check that purchase requests, the POs raised from them and goods receipts agree between the
    CMMS (ERPNext) and SAP. Writes nothing to either system.

.DESCRIPTION
    Uses the item master sync's own config.json for the two logins and only ever reads: GETs against ERPNext,
    and against the SAP Service Layer a Login, GETs and a Logout. Nothing is posted, patched or deleted, so it
    is safe to run against the live companies at any time, as often as you like.

    What it compares, per SAP company:
      Purchase requests  every CMMS Purchase Request that reached SAP, against PurchaseRequests(DocEntry):
                         DocNum, Reference2 stamp, required-by date, and each line's item, quantity and
                         warehouse. Then the POs SAP raised from it (PO lines with BaseType 1470000113) against
                         the request's po_numbers and status (In SAP / Ordered / Closed). Failed and Queued
                         requests are checked for a SAP document carrying their stamp anyway, and SAP purchase
                         requests stamped PR<yy>-<n> that no CMMS request points at are listed.
      Open PO lines      the open_po_lines snapshot the goods receipt form uses, against SAP's open POs now:
                         each line's open quantity and price, and engineering lines SAP has that the snapshot
                         lacks. A difference here is usually just a snapshot older than the last SAP change;
                         a Sync with SAP refreshes it.
      Goods receipts     every posted CMMS Goods Receipt against PurchaseDeliveryNotes(DocEntry): DocNum,
                         stamp, vendor, bill no. (NumAtCard), bill date (TaxDate), not cancelled, and each line's
                         PO link (BaseEntry/BaseLine), item, quantity and price; and its ERPNext Material Receipt:
                         submitted, same items, quantities and rates into the company's store.
                         Stock additions (no bill, InventoryGenEntries) only with -IncludeStockAdditions.

    Output: one row per check (OK / DIFF / MISSING / INFO) on screen, and the full list in
    logs\verify-sap-sync-<date>.csv and .json next to this script.

.PARAMETER ConfigPath              config.json of the item master sync. Defaults to the file next to this script.
.PARAMETER Since                   Oldest SAP document date scanned for POs and orphan requests (yyyy-MM-dd).
.PARAMETER Company                 Limit to one CMMS company abbreviation: MRPPL, MT, HRI or MTR.
.PARAMETER IncludeStockAdditions   Also check stock additions (nil-value Goods Receipts).

.EXAMPLE
    powershell -File Verify-SapSync.ps1
    powershell -File Verify-SapSync.ps1 -Company HRI
#>
param(
    [string] $ConfigPath,
    [string] $Since = '2026-10-01',
    [ValidateSet('', 'MRPPL', 'MT', 'HRI', 'MTR')] [string] $Company = '',
    [switch] $IncludeStockAdditions
)

Set-StrictMode -Version 1.0
$ErrorActionPreference = 'Stop'
$scriptDir = $PSScriptRoot; if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $ConfigPath) { $ConfigPath = Join-Path $scriptDir 'config.json' }
$utf8 = New-Object System.Text.UTF8Encoding($false)

# The company's CMMS store, as in Sync-SapItemCategories.ps1.
$storeByAbbr = @{ MRPPL = 'Manna Rubber Products Store - MRPPL'; MT = 'Stores - MT'; HRI = 'Stores - HRI'; MTR = 'Stores - MTR' }

$rows = New-Object System.Collections.ArrayList
function Add-Row {
    param([string] $Area, [string] $Doc, [string] $Check, $Erp, $Sap, [string] $Result = '')
    $e = "$Erp"; $s = "$Sap"
    if (-not $Result) { $Result = if ($e -eq $s) { 'OK' } else { 'DIFF' } }
    [void]$rows.Add([pscustomobject]@{ result = $Result; area = $Area; doc = $Doc; check = $Check; erpnext = $e; sap = $s })
}
function Num($v) { try { [math]::Round([double]"$v", 3) } catch { 0 } }
function Day($v) { if ("$v".Length -ge 10) { "$v".Substring(0, 10) } else { "$v" } }
function Norm([string] $s) { ("$s" -replace '\s+', ' ').Trim() }
function Stamp([string] $Name, [string] $Prefix) {
    $m = [regex]::Match($Name, '\d{2}(\d{2})-(\d+)$')
    if ($m.Success) { '{0}{1}-{2}' -f $Prefix, $m.Groups[1].Value, $m.Groups[2].Value } else { $Name }
}

if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "config not found: $ConfigPath" }
$cfg = ([IO.File]::ReadAllText($ConfigPath).TrimStart([char]0xFEFF)) | ConvertFrom-Json
$control = if ("$($cfg.control_doctype)".Trim()) { "$($cfg.control_doctype)" } else { 'SAP Item Category Sync Control' }

# ------------------------------------------------------------------ ERPNext (GET only)
$erp = "$($cfg.erpnext.url)".TrimEnd('/')
$erpHdr = @{ Authorization = ('token {0}:{1}' -f $cfg.erpnext.api_key, $cfg.erpnext.api_secret) }
function Erp-Get([string] $Path) { Invoke-RestMethod -Method Get -Uri "$erp$Path" -Headers $erpHdr -TimeoutSec 60 }
function Res([string] $Doctype, [string] $Name) { "/api/resource/$([uri]::EscapeDataString($Doctype))" + $(if ($Name) { "/$([uri]::EscapeDataString($Name))" } else { '' }) }
function Erp-List([string] $Doctype, [string[]] $Fields, [string] $FiltersJson) {
    $f = [uri]::EscapeDataString((ConvertTo-Json -InputObject @($Fields) -Compress)); $q = [uri]::EscapeDataString($FiltersJson)
    @((Erp-Get ("{0}?fields={1}&filters={2}&limit_page_length=0" -f (Res $Doctype ''), $f, $q)).data)
}

Write-Host "Reading ERPNext ($erp) ..."
$ctl = (Erp-Get (Res $control $control)).data
$options = "$($ctl.item_master_options)" | ConvertFrom-Json
$snapshot = if ("$($ctl.open_po_lines)".Trim()) { "$($ctl.open_po_lines)" | ConvertFrom-Json } else { $null }
# Child tables only come with a single-document GET.
$prs = @(Erp-List 'CMMS Purchase Request' @('name') '[]' | ForEach-Object { (Erp-Get (Res 'CMMS Purchase Request' $_.name)).data })
$kinds = if ($IncludeStockAdditions) { '["Goods Receipt","Stock Addition"]' } else { '["Goods Receipt"]' }
$grs = @(Erp-List 'CMMS Goods Receipt' @('name') ('[["kind","in",{0}]]' -f $kinds) | ForEach-Object { (Erp-Get (Res 'CMMS Goods Receipt' $_.name)).data })
$mirror = @{}
foreach ($it in (Erp-List 'Item' @('name', 'custom_sap_item_code', 'disabled') '[["custom_sap_item_group","is","set"]]')) {
    $ab = ("$($it.name)" -split '-', 2)[0]; $sc = "$($it.custom_sap_item_code)".Trim()
    if (-not $sc -or [int]"0$($it.disabled)" -ne 0) { continue }
    if (-not $mirror.ContainsKey($ab)) { $mirror[$ab] = @{} }
    $mirror[$ab][$sc] = "$($it.name)"
}
Write-Host ("  {0} purchase request(s), {1} goods receipt(s)" -f $prs.Count, $grs.Count)

# ------------------------------------------------------------------ SAP (curl.exe, as the sync does)
$curl = (Get-Command curl.exe).Source
$slBase = "$($cfg.sap.url)".TrimEnd('/')
$slRoot = ([Uri]$slBase).GetLeftPart([UriPartial]::Authority)
$US = [string][char]0x1F
function Invoke-Sl {
    param([string] $Method, [string] $Url, [string] $Body, [string] $Jar, [switch] $SaveCookies)
    if ($Method -ne 'GET' -and $Url -notmatch '/(Login|Logout)$') { throw "refusing $Method $Url - this script only reads" }
    $tag = [guid]::NewGuid().ToString('N').Substring(0, 8)
    $resp = Join-Path $env:TEMP "verify-$tag-resp.txt"; $bodyFile = $null
    $a = @('-k', '-s', '--globoff', '--connect-timeout', '15', '--max-time', '120', '-H', 'Expect:', '-H', 'Prefer: odata.maxpagesize=200',
           '-o', $resp, '-w', "%{http_code}", '-X', $Method)
    if ($SaveCookies) { $a += @('-c', $Jar) } else { $a += @('-b', $Jar) }
    if ($null -ne $Body -and $Body -ne '') {
        $bodyFile = Join-Path $env:TEMP "verify-$tag-body.json"
        [IO.File]::WriteAllText($bodyFile, $Body, $utf8)
        $a += @('-H', 'Content-Type: application/json', '--data-binary', "@$bodyFile")
    }
    $a += ($Url -replace ' ', '%20' -replace "'", '%27')
    try { $code = & $curl @a; $text = if (Test-Path -LiteralPath $resp) { [IO.File]::ReadAllText($resp) } else { '' } }
    finally { if (Test-Path -LiteralPath $resp) { [IO.File]::Delete($resp) }; if ($bodyFile -and (Test-Path -LiteralPath $bodyFile)) { [IO.File]::Delete($bodyFile) } }
    [pscustomobject]@{ Http = "$code".Trim(); Body = $text }
}
function Sl-One([string] $Path, [string] $Jar) {
    $r = Invoke-Sl -Method GET -Url "$slBase/$Path" -Jar $Jar
    if ($r.Http -eq '404') { return $null }
    if ($r.Http -ne '200') { throw ("SAP read {0} HTTP {1}: {2}" -f $Path, $r.Http, ("$($r.Body)" -replace '\s+', ' ').Trim()) }
    $r.Body | ConvertFrom-Json
}
function Sl-All([string] $Path, [string] $Jar) {
    $list = New-Object System.Collections.ArrayList; $next = "$slBase/$Path"; $pages = 0
    while ($next -and $pages -lt 60) {
        $pages++; $r = Invoke-Sl -Method GET -Url $next -Jar $Jar
        if ($r.Http -ne '200') { throw ("SAP read {0} HTTP {1}: {2}" -f $Path, $r.Http, ("$($r.Body)" -replace '\s+', ' ').Trim()) }
        $j = $r.Body | ConvertFrom-Json
        foreach ($v in $j.value) { [void]$list.Add($v) }
        $lnk = $null; foreach ($n in 'odata.nextLink', '@odata.nextLink') { if ($j.PSObject.Properties[$n] -and $j.$n) { $lnk = [string]$j.$n } }
        $next = if (-not $lnk) { $null } elseif ($lnk -match '^https?://') { $lnk } elseif ($lnk.StartsWith('/')) { "$slRoot$lnk" } else { "$slBase/$lnk" }
    }
    , $list
}

$abbrs = @($options.PSObject.Properties.Name | Where-Object { -not $Company -or $_ -eq $Company })
foreach ($abbr in $abbrs) {
    $db = "$($options.$abbr.sap_db)"
    $myPrs = @($prs | Where-Object { "$($_.company)" -eq $abbr })
    $myGrs = @($grs | Where-Object { "$($_.company)" -eq $abbr })
    Write-Host ''
    Write-Host ("== {0} ({1}): {2} purchase request(s), {3} receipt(s)" -f $abbr, $db, $myPrs.Count, $myGrs.Count)

    $password = "$($cfg.sap.password)"
    if ($cfg.sap.PSObject.Properties['password_overrides'] -and $cfg.sap.password_overrides.PSObject.Properties[$db]) { $password = "$($cfg.sap.password_overrides.$db)" }
    $jar = Join-Path $env:TEMP ("verify-{0}.jar" -f [guid]::NewGuid().ToString('N').Substring(0, 8))
    try {
        $lg = Invoke-Sl -Method POST -Url "$slBase/Login" -Body (@{ CompanyDB = $db; UserName = "$($cfg.sap.username)"; Password = $password } | ConvertTo-Json -Compress) -Jar $jar -SaveCookies
        $password = $null
        if ($lg.Http -ne '200') { Add-Row 'login' $db 'SAP login' 'ok' "HTTP $($lg.Http)" 'MISSING'; continue }

        # Every PO since -Since with its lines: the PR -> PO links, and the open lines.
        $pos = Sl-All ("PurchaseOrders?`$select=DocEntry,DocNum,DocDate,DocumentStatus,CardCode,DocumentLines&`$filter=DocDate ge '{0}'" -f $Since) $jar
        $openPos = Sl-All "PurchaseOrders?`$select=DocEntry,DocNum,CardCode,DocumentLines&`$filter=DocumentStatus eq 'bost_Open'" $jar
        $prToPo = @{}
        foreach ($po in $pos) {
            foreach ($l in @($po.DocumentLines)) {
                if ("$($l.BaseType)" -eq '1470000113' -and $l.BaseEntry) {
                    $k = [int]$l.BaseEntry
                    if (-not $prToPo.ContainsKey($k)) { $prToPo[$k] = New-Object System.Collections.ArrayList }
                    if (-not $prToPo[$k].Contains("$($po.DocNum)")) { [void]$prToPo[$k].Add("$($po.DocNum)") }
                }
            }
        }

        # ---------------- purchase requests
        $stampsSeen = @{}
        foreach ($pq in $myPrs) {
            $doc = "$($pq.name)"; $stamp = Stamp $doc 'PR'; $stampsSeen[$stamp] = $true
            $entry = [int]"0$($pq.sap_doc_entry)"
            if (-not $entry) {
                # Never reached SAP: make sure nothing carrying its stamp did either.
                $found = Sl-All ("PurchaseRequests?`$select=DocEntry,DocNum&`$filter=Reference2 eq '{0}'" -f $stamp) $jar
                $sapSide = if ($found.Count) { "DocNum $($found[0].DocNum) exists" } else { 'none' }
                Add-Row 'purchase request' $doc "not in SAP per CMMS ($($pq.status))" 'none' $sapSide
                continue
            }
            $sp = Sl-One ("PurchaseRequests({0})?`$select=DocEntry,DocNum,Reference2,RequriedDate,DocumentStatus,DocumentLines" -f $entry) $jar
            if (-not $sp) { Add-Row 'purchase request' $doc "SAP document $entry" 'exists' 'not found' 'MISSING'; continue }
            Add-Row 'purchase request' $doc 'DocNum' "$($pq.sap_doc_number)" "$($sp.DocNum)"
            Add-Row 'purchase request' $doc 'Reference2 stamp' $stamp "$($sp.Reference2)"
            Add-Row 'purchase request' $doc 'required by' (Day $pq.required_by) (Day $sp.RequriedDate)
            $cl = @($pq.lines | Sort-Object { [int]$_.idx }); $sl = @($sp.DocumentLines | Sort-Object { [int]$_.LineNum })
            Add-Row 'purchase request' $doc 'line count' $cl.Count $sl.Count
            for ($i = 0; $i -lt [Math]::Min($cl.Count, $sl.Count); $i++) {
                Add-Row 'purchase request' $doc "line $($i + 1) item" (Norm $cl[$i].sap_item_code) (Norm $sl[$i].ItemCode)
                Add-Row 'purchase request' $doc "line $($i + 1) qty" (Num $cl[$i].qty) (Num $sl[$i].Quantity)
                Add-Row 'purchase request' $doc "line $($i + 1) warehouse" '(sync default)' "$($sl[$i].WarehouseCode)" 'INFO'
            }
            $poNums = if ($prToPo.ContainsKey($entry)) { @($prToPo[$entry] | Sort-Object) } else { @() }
            $known = @("$($pq.po_numbers)" -split '\s*,\s*' | Where-Object { $_ } | Sort-Object)
            Add-Row 'purchase request' $doc 'PO numbers' ($known -join ', ') ($poNums -join ', ')
            $expect = if ($poNums.Count -or $known.Count) { 'Ordered' } elseif ("$($sp.DocumentStatus)" -eq 'bost_Close') { 'Closed' } else { 'In SAP' }
            Add-Row 'purchase request' $doc "status (SAP request $("$($sp.DocumentStatus)" -replace 'bost_', ''))" "$($pq.status)" $expect
        }
        # SAP requests stamped by the CMMS that no CMMS request points at.
        foreach ($sp in (Sl-All ("PurchaseRequests?`$select=DocEntry,DocNum,Reference2&`$filter=startswith(Reference2,'PR') and DocDate ge '{0}'" -f $Since) $jar)) {
            if ("$($sp.Reference2)" -match '^PR\d{2}-\d+$' -and -not $stampsSeen.ContainsKey("$($sp.Reference2)")) {
                Add-Row 'purchase request' "$($sp.Reference2)" 'SAP request with no CMMS request' 'none' "DocNum $($sp.DocNum)" 'MISSING'
            }
        }

        # ---------------- open PO lines: the goods receipt form's snapshot against SAP now
        $snap = if ($snapshot -and $snapshot.PSObject.Properties[$abbr]) { $snapshot.$abbr } else { $null }
        $snapLines = @{}
        if ($snap) {
            foreach ($p in @($snap.pos)) { foreach ($l in @($p.lines)) { $snapLines["$($p.entry)/$($l.line)"] = @{ po = "$($p.number)"; l = $l } } }
            Add-Row 'open PO lines' $abbr 'snapshot taken' '' "$($snap.refreshed_at)" 'INFO'
        }
        $codes = if ($mirror.ContainsKey($abbr)) { $mirror[$abbr] } else { @{} }
        $sapOpen = @{}
        foreach ($po in $openPos) {
            foreach ($l in @($po.DocumentLines)) {
                $code = "$($l.ItemCode)".Trim()
                if (-not $codes.ContainsKey($code) -or "$($l.LineStatus)" -ne 'bost_Open' -or [double]$l.RemainingOpenQuantity -le 0) { continue }
                $sapOpen["$($po.DocEntry)/$($l.LineNum)"] = @{ po = "$($po.DocNum)"; l = $l }
            }
        }
        foreach ($k in $snapLines.Keys) {
            $s = $snapLines[$k]; $doc = "PO $($s.po) line $($s.l.line) $($s.l.sap_code)"
            if (-not $sapOpen.ContainsKey($k)) { Add-Row 'open PO lines' $doc 'still open in SAP' 'offered in CMMS' 'not open' 'DIFF'; continue }
            $o = $sapOpen[$k].l
            Add-Row 'open PO lines' $doc 'open qty' (Num $s.l.open_qty) (Num $o.RemainingOpenQuantity)
            Add-Row 'open PO lines' $doc 'price' (Num $s.l.price) (Num $o.Price)
        }
        foreach ($k in $sapOpen.Keys) {
            if (-not $snapLines.ContainsKey($k)) {
                $o = $sapOpen[$k]
                Add-Row 'open PO lines' "PO $($o.po) line $($o.l.LineNum) $($o.l.ItemCode)" 'offered in CMMS' 'not offered' "open $(Num $o.l.RemainingOpenQuantity)" 'DIFF'
            }
        }

        # ---------------- goods receipts
        foreach ($rc in $myGrs) {
            $doc = "$($rc.name)"; $isGr = "$($rc.kind)" -eq 'Goods Receipt'
            if ("$($rc.status)" -ne 'Posted') { Add-Row 'goods receipt' $doc 'status' "$($rc.status)" '' 'INFO'; continue }
            $entity = if ($isGr) { 'PurchaseDeliveryNotes' } else { 'InventoryGenEntries' }
            $sel = if ($isGr) { 'DocEntry,DocNum,Reference2,NumAtCard,TaxDate,CardCode,Cancelled,DocumentLines' } else { 'DocEntry,DocNum,Reference2,Cancelled,DocumentLines' }
            $sd = Sl-One ("{0}({1})?`$select={2}" -f $entity, [int]"0$($rc.sap_doc_entry)", $sel) $jar
            if (-not $sd) { Add-Row 'goods receipt' $doc "SAP $entity $($rc.sap_doc_entry)" 'exists' 'not found' 'MISSING'; continue }
            Add-Row 'goods receipt' $doc 'DocNum' "$($rc.sap_doc_number)" "$($sd.DocNum)"
            Add-Row 'goods receipt' $doc 'Reference2 stamp' (Stamp $doc 'GR') "$($sd.Reference2)"
            Add-Row 'goods receipt' $doc 'not cancelled in SAP' 'tNO' "$($sd.Cancelled)"
            if ($isGr) {
                Add-Row 'goods receipt' $doc 'vendor' "$($rc.vendor_code)" "$($sd.CardCode)"
                Add-Row 'goods receipt' $doc 'bill no.' (Norm $rc.bill_no) (Norm $sd.NumAtCard)
                Add-Row 'goods receipt' $doc 'bill date' (Day $rc.bill_date) (Day $sd.TaxDate)
            }
            $cl = @($rc.lines | Sort-Object { [int]$_.idx }); $sl = @($sd.DocumentLines | Sort-Object { [int]$_.LineNum })
            Add-Row 'goods receipt' $doc 'line count' $cl.Count $sl.Count
            for ($i = 0; $i -lt [Math]::Min($cl.Count, $sl.Count); $i++) {
                $n = $i + 1
                Add-Row 'goods receipt' $doc "line $n item" (Norm $cl[$i].sap_item_code) (Norm $sl[$i].ItemCode)
                Add-Row 'goods receipt' $doc "line $n qty" (Num $cl[$i].qty) (Num $sl[$i].Quantity)
                if ($isGr) {
                    Add-Row 'goods receipt' $doc "line $n PO" ('{0}/{1}' -f [int]"0$($rc.sap_po_entry)", [int]"0$($cl[$i].po_line)") ('{0}/{1}' -f [int]"0$($sl[$i].BaseEntry)", [int]"0$($sl[$i].BaseLine)")
                    Add-Row 'goods receipt' $doc "line $n price" (Num $cl[$i].rate) (Num $sl[$i].Price)
                }
            }
            # The ERPNext side of the same receipt.
            $seName = "$($rc.erp_stock_entry)".Trim()
            if (-not $seName) { Add-Row 'goods receipt' $doc 'ERPNext Material Receipt' 'exists' '' 'MISSING'; continue }
            $se = (Erp-Get (Res 'Stock Entry' $seName)).data
            Add-Row 'goods receipt' $doc "ERPNext $seName submitted" '1' "$($se.docstatus)"
            foreach ($l in $cl) {
                $match = @($se.items | Where-Object { "$($_.item_code)" -eq "$($l.item)" })
                $qty = 0; foreach ($m in $match) { $qty += [double]$m.qty }
                Add-Row 'goods receipt' $doc "ERPNext qty $($l.item)" (Num $l.qty) (Num $qty)
                if ($match.Count) {
                    Add-Row 'goods receipt' $doc "ERPNext rate $($l.item)" (Num $l.rate) (Num $match[0].basic_rate)
                    Add-Row 'goods receipt' $doc "ERPNext warehouse $($l.item)" $storeByAbbr[$abbr] "$($match[0].t_warehouse)"
                }
            }
        }
    } catch {
        Add-Row 'error' $db 'run' '' $_.Exception.Message 'MISSING'
    } finally {
        if (Test-Path -LiteralPath $jar) { try { $null = Invoke-Sl -Method POST -Url "$slBase/Logout" -Jar $jar } catch { }; [IO.File]::Delete($jar) }
    }
}

# ------------------------------------------------------------------ report
$logDir = Join-Path $scriptDir 'logs'
if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$base = Join-Path $logDir ('verify-sap-sync-{0}' -f (Get-Date -Format 'yyyy-MM-dd-HHmm'))
$rows | Export-Csv -LiteralPath "$base.csv" -NoTypeInformation -Encoding UTF8
[IO.File]::WriteAllText("$base.json", ($rows | ConvertTo-Json -Depth 4), $utf8)

Write-Host ''
$rows | Where-Object { $_.result -ne 'OK' } | Format-Table result, area, doc, check, erpnext, sap -AutoSize -Wrap | Out-String -Width 220 | Write-Host
$sum = $rows | Group-Object result | ForEach-Object { '{0} {1}' -f $_.Count, $_.Name }
Write-Host ("Checks: {0}. Full list: {1}.csv" -f ($sum -join ', '), $base)
if (@($rows | Where-Object { $_.result -in 'DIFF', 'MISSING' }).Count) { exit 1 } else { exit 0 }
