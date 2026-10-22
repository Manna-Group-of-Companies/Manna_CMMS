<#
  Tests BillUnitLine.ps1 - the GRPO line for an item billed in another unit than it is stocked in (22 Oct 2026).

  1. Offline: Add-BillUnitFields and Get-BillUnitMismatch on made-up lines; no SAP.
  2. Demo company only (HITECH_RUBBER): a PO with three lines - flex stocked in MTR billed in KGS, bolts stocked in
     NOS billed in KGS, and an ordinary line - then a GRPO built the way PASS C builds it, read back and checked:
     stock quantity, ratio, price, discount, line total, PO open quantity.

  Refuses any company database but HITECH_RUBBER. Posts real documents there (vendor ZZ-TEST-V, warehouse 01);
  the test items are made if missing.

    .\Test-BillUnitLine.ps1 -ConfigPath C:\Users\eldhose\sap-engineering-sync\config.json
    .\Test-BillUnitLine.ps1 -OfflineOnly
#>
param([string] $ConfigPath, [string] $CompanyDb = 'HITECH_RUBBER', [switch] $OfflineOnly)
Set-StrictMode -Version 1.0
$ErrorActionPreference = 'Stop'
if ($CompanyDb -ne 'HITECH_RUBBER') { throw "Refusing to post to $CompanyDb - this test runs in the demo company HITECH_RUBBER only." }
. (Join-Path $PSScriptRoot '..\BillUnitLine.ps1')

$script:fails = 0
function Check([string] $what, [bool] $ok, [string] $detail = '') {
    if (-not $ok) { $script:fails++ }
    Write-Host ("  [{0}] {1}{2}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $what, $(if ($detail) { " - $detail" } else { '' }))
}
function Near([double] $a, [double] $b, [double] $tol = 0.0005) { [math]::Abs($a - $b) -le $tol }

# ------------------------------------------------------------------ 1. offline
Write-Host 'Offline'
$d = [ordered]@{ BaseType = 22; BaseEntry = 1; BaseLine = 0; Quantity = 37.5; WarehouseCode = '01' }
$r = Add-BillUnitFields $d ([pscustomobject]@{ qty = 37.5; bill_qty = 50; bill_uom = 'KGS' }) 120
Check 'flex 50 KGS -> 37.5 MTR at 120/m' ($r -and $d.Quantity -eq 50 -and $d.MeasureUnit -eq 'KGS' -and $d.UnitsOfMeasurment -eq 0.75 -and $d.UnitPrice -eq 90 -and $d.DiscountPercent -eq 0 -and $d.LineTotal -eq 4500) ($d | ConvertTo-Json -Compress)
$d = [ordered]@{ Quantity = 41.17 }
$null = Add-BillUnitFields $d ([pscustomobject]@{ qty = 41.17; bill_qty = 47.3; bill_uom = 'KGS' }) 120
Check 'uneven ratio rounded to 6 dp, total exact' ($d.UnitsOfMeasurment -eq 0.870402 -and $d.UnitPrice -eq 104.44824 -and $d.LineTotal -eq 4940.4) ($d | ConvertTo-Json -Compress)
$d = [ordered]@{ Quantity = 4 }
$r = Add-BillUnitFields $d ([pscustomobject]@{ qty = 4; bill_qty = $null; bill_uom = '' }) 450
Check 'no bill unit: line untouched' ((-not $r) -and $d.Count -eq 1 -and $d.Quantity -eq 4)
$threw = $false; try { $null = Add-BillUnitFields ([ordered]@{}) ([pscustomobject]@{ qty = 5; bill_qty = 0; bill_uom = 'KGS' }) 10 } catch { $threw = $true }
Check 'bill unit with no bill quantity is refused' $threw
$grpo = @([pscustomobject]@{ BaseLine = 0; InventoryQuantity = 37.5; Quantity = 50; MeasureUnit = 'KGS' }, [pscustomobject]@{ BaseLine = 1; InventoryQuantity = 50; Quantity = 50; MeasureUnit = 'KGS' })
$cmms = @([pscustomobject]@{ po_line = 0; qty = 37.5; bill_uom = 'KGS'; sap_item_code = 'A' }, [pscustomobject]@{ po_line = 1; qty = 37.5; bill_uom = 'KGS'; sap_item_code = 'B' }, [pscustomobject]@{ po_line = 2; qty = 4; bill_uom = ''; sap_item_code = 'C' })
$bad = Get-BillUnitMismatch $grpo $cmms
Check 'mismatch found on the wrong line only' ($bad.Count -eq 1 -and $bad[0] -like 'B:*') ($bad -join ' | ')
$bad = Get-BillUnitMismatch @([pscustomobject]@{ BaseLine = 0; InventoryQuantity = 9.99999 }) @([pscustomobject]@{ po_line = 0; qty = 10; bill_uom = 'KGS' })
Check 'within tolerance is not a mismatch' ($bad.Count -eq 0)
if ($OfflineOnly) { Write-Host ("{0} failure(s)" -f $script:fails); exit [int]($script:fails -gt 0) }

# ------------------------------------------------------------------ 2. demo company
if (-not $ConfigPath) { $ConfigPath = Join-Path $PSScriptRoot '..\config.json' }
$cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$slBase = "$($cfg.sap.url)".TrimEnd('/')
$curl = (Get-Command curl.exe).Source
$utf8 = New-Object System.Text.UTF8Encoding($false)
$jar = Join-Path $env:TEMP ("billunit-{0}.jar" -f [guid]::NewGuid().ToString('N').Substring(0, 8))
# The same curl.exe call as Invoke-Sl in Sync-SapItemCategories.ps1 ("-H Expect:" - BRIEFING §2).
function Invoke-DemoSl([string] $Method, [string] $Path, $Body, [switch] $Login) {
    $resp = Join-Path $env:TEMP ("billunit-{0}.txt" -f [guid]::NewGuid().ToString('N').Substring(0, 8)); $bf = $null
    $a = @('-k', '-s', '--globoff', '--connect-timeout', '15', '--max-time', '120', '-H', 'Expect:', '-o', $resp, '-w', '%{http_code}', '-X', $Method)
    $a += $(if ($Login) { @('-c', $jar) } else { @('-b', $jar) })
    if ($null -ne $Body) { $bf = "$resp.json"; [IO.File]::WriteAllText($bf, ($Body | ConvertTo-Json -Depth 6 -Compress), $utf8); $a += @('-H', 'Content-Type: application/json', '--data-binary', "@$bf") }
    $a += ("$slBase/$Path" -replace ' ', '%20' -replace "'", '%27')
    try { $code = & $curl @a; $text = if (Test-Path $resp) { [IO.File]::ReadAllText($resp) } else { '' } }
    finally { foreach ($f in @($resp, $bf)) { if ($f -and (Test-Path $f)) { Remove-Item $f } } }
    [pscustomobject]@{ Http = "$code"; Body = $text; Json = $(if ($text) { try { $text | ConvertFrom-Json } catch { $null } }) }
}
function Must($r, [string] $what) { if ($r.Http -notin '200', '201', '204') { throw "$what HTTP $($r.Http): $($r.Body -replace '\s+', ' ')" }; $r.Json }
function OnHand([string] $item) { [double](@((Must (Invoke-DemoSl GET "Items('$item')?`$select=ItemWarehouseInfoCollection") "read $item").ItemWarehouseInfoCollection | Where-Object WarehouseCode -eq '01')[0].InStock) }

$pw = "$($cfg.sap.password)"; if ($cfg.sap.password_overrides -and $cfg.sap.password_overrides.PSObject.Properties[$CompanyDb]) { $pw = "$($cfg.sap.password_overrides.$CompanyDb)" }
$null = Must (Invoke-DemoSl POST 'Login' @{ CompanyDB = $CompanyDb; UserName = "$($cfg.sap.username)"; Password = $pw } -Login) "login $CompanyDb"
Write-Host "Demo company $CompanyDb"
try {
    $base = [ordered]@{ ItemsGroupCode = 105; PurchaseItem = 'tYES'; SalesItem = 'tNO'; InventoryItem = 'tYES'; DefaultWarehouse = '01'; ManageStockByWarehouse = 'tYES'; CostAccountingMethod = 'bis_MovingAverage'; ItemClass = 'itcMaterial'; MaterialType = 'mt_RawMaterial'; ChapterID = 13; GSTRelevnt = 'tYES'; GSTTaxCategory = 'gtc_Regular' }
    foreach ($it in @(@{ code = 'ZZ_UOM_TEST_M'; unit = 'MTR' }, @{ code = 'ZZ_UOM_NOS'; unit = 'NOS' })) {
        if ((Invoke-DemoSl GET "Items('$($it.code)')?`$select=ItemCode").Http -ne '200') {
            $b = [ordered]@{ ItemCode = $it.code; ItemName = "ZZ bill unit test - stocked in $($it.unit)"; InventoryUOM = $it.unit; PurchaseUnit = $it.unit; SalesUnit = $it.unit }; foreach ($k in $base.Keys) { $b[$k] = $base[$k] }
            $null = Must (Invoke-DemoSl POST 'Items' $b) "create $($it.code)"
        }
    }
    # The PO as purchase raises it: in the stock unit at a price per stock unit.
    $today = (Get-Date -Format 'yyyy-MM-dd')
    $poLines = @(
        [ordered]@{ ItemCode = 'ZZ_UOM_TEST_M'; Quantity = 100; Price = 120; MeasureUnit = 'MTR'; WarehouseCode = '01'; TaxCode = 'CG+SG@18'; LocationCode = 2 },
        [ordered]@{ ItemCode = 'ZZ_UOM_NOS'; Quantity = 1000; Price = 2.5; MeasureUnit = 'NOS'; WarehouseCode = '01'; TaxCode = 'CG+SG@18'; LocationCode = 2 },
        [ordered]@{ ItemCode = 'TEST-OIL-01'; Quantity = 50; Price = 80; WarehouseCode = '01'; TaxCode = 'CG+SG@18'; LocationCode = 2 }
    )
    $po = Must (Invoke-DemoSl POST 'PurchaseOrders' @{ CardCode = 'ZZ-TEST-V'; DocDate = $today; DocDueDate = $today; Comments = 'ZZ bill unit test PO'; DocumentLines = $poLines }) 'post PO'
    $poEntry = [int]$po.DocEntry
    Write-Host "  PO $($po.DocNum) (DocEntry $poEntry): 100 MTR flex @120, 1000 NOS bolts @2.5, 50 KGS oil @80"
    $poRead = Must (Invoke-DemoSl GET "PurchaseOrders($poEntry)?`$select=DocumentLines") 'read PO'

    # The CMMS receipt lines: qty in the stock unit; bill_qty / bill_uom only on items with a bill unit.
    $lines = @(
        [pscustomobject]@{ po_line = 0; sap_item_code = 'ZZ_UOM_TEST_M'; qty = 41.17; bill_qty = 47.3; bill_uom = 'KGS'; warehouse = '01' },
        [pscustomobject]@{ po_line = 1; sap_item_code = 'ZZ_UOM_NOS'; qty = 480; bill_qty = 10; bill_uom = 'KGS'; warehouse = '01' },
        [pscustomobject]@{ po_line = 2; sap_item_code = 'TEST-OIL-01'; qty = 20; warehouse = '01' }
    )
    $before = @{}; foreach ($l in $lines) { $before[$l.sap_item_code] = OnHand $l.sap_item_code }
    # Built as PASS C builds it.
    $docLines = @()
    foreach ($l in $lines) {
        $pl = @($poRead.DocumentLines | Where-Object { [int]$_.LineNum -eq [int]$l.po_line })[0]
        $docLine = [ordered]@{ BaseType = 22; BaseEntry = $poEntry; BaseLine = [int]$l.po_line; Quantity = [double]$l.qty; WarehouseCode = "$($l.warehouse)" }
        $null = Add-BillUnitFields $docLine $l ([double]$pl.Price)
        $docLines += $docLine
    }
    $stamp = 'BUT{0}' -f (Get-Date -Format 'MMddHHmmss')
    $g = Must (Invoke-DemoSl POST 'PurchaseDeliveryNotes' @{ CardCode = 'ZZ-TEST-V'; DocDate = $today; NumAtCard = 'TEST-BILL'; Reference2 = $stamp; Comments = 'ZZ bill unit test GRPO'; DocumentLines = $docLines }) 'post GRPO'
    Write-Host "  GRPO $($g.DocNum) (Reference2 $stamp)"
    $gl = (Must (Invoke-DemoSl GET "PurchaseDeliveryNotes($([int]$g.DocEntry))?`$select=DocumentLines") 'read GRPO').DocumentLines
    $bad = Get-BillUnitMismatch $gl $lines
    Check 'read-back check finds nothing wrong' ($bad.Count -eq 0) ($bad -join ' | ')

    $poAfter = (Must (Invoke-DemoSl GET "PurchaseOrders($poEntry)?`$select=DocumentLines") 'read PO').DocumentLines
    $expect = @(
        @{ l = 0; qty = 47.3; unit = 'KGS'; inv = 41.17; total = 4940.40; open = 58.83 },
        @{ l = 1; qty = 10; unit = 'KGS'; inv = 480; total = 1200.00; open = 520 },
        @{ l = 2; qty = 20; unit = $null; inv = 20; total = 1600.00; open = 30 }
    )
    foreach ($e in $expect) {
        $x = @($gl | Where-Object { [int]$_.BaseLine -eq $e.l })[0]
        $src = $lines[$e.l]
        $delta = (OnHand $src.sap_item_code) - $before[$src.sap_item_code]
        $p = @($poAfter | Where-Object { [int]$_.LineNum -eq $e.l })[0]
        $what = "{0}: {1} {2} on the GRPO -> {3} into stock" -f $src.sap_item_code, $x.Quantity, $(if ($e.unit) { $e.unit } else { $x.MeasureUnit }), $x.InventoryQuantity
        Check $what ((Near $x.Quantity $e.qty) -and (Near $x.InventoryQuantity $e.inv) -and (Near $delta $e.inv)) ("stock +{0}" -f $delta)
        Check "  line total $($x.LineTotal), discount $($x.DiscountPercent)%" ((Near $x.LineTotal $e.total 0.005) -and [double]$x.DiscountPercent -eq 0)
        Check "  PO line open $($p.RemainingOpenQuantity)" (Near $p.RemainingOpenQuantity $e.open)
        if ($e.unit) { Check "  printed unit '$($x.MeasureUnit)'" ($x.MeasureUnit -eq $e.unit) }
    }
} finally {
    $null = Invoke-DemoSl POST 'Logout'
    Remove-Item $jar -ErrorAction SilentlyContinue
}
Write-Host ("{0} failure(s)" -f $script:fails)
exit [int]($script:fails -gt 0)
