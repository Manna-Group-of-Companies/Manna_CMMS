<#
  Goods receipt lines for an item billed in another unit than it is stocked in (22 Oct 2026): flex billed in KGS and
  stocked in MTR, bolts billed in KGS and stocked in NOS. Dot-sourced by Sync-SapItemCategories.ps1 (PASS C) and by
  tests\Test-BillUnitLine.ps1 (demo company only).

  The item stays on SAP's Manual UoM group - one unit, no conversion on the item. Each GRPO line carries the bill's
  quantity in the bill unit and the ratio to the stock unit (Items per Unit, NumPerMsr). Tested in the demo company
  HITECH_RUBBER on 22 Oct 2026:
    Quantity          = bill_qty                    50 KGS
    MeasureUnit       = bill_uom                    printed on the GRPO and the A/P invoice copied from it
    UnitsOfMeasurment = qty / bill_qty, 6 dp        0.75 (SAP's spelling) -> InventoryQuantity 37.5 MTR into stock
    UnitPrice         = PO price x ratio, 6 dp      90 per KGS
    DiscountPercent   = 0                           sent: otherwise SAP keeps the PO price and books the gap as a discount
    LineTotal         = qty x PO price, 2 dp        4500.00 = 37.5 m x 120, the bill's value to the paisa
  The PO's open quantity falls by the stock quantity (37.5), as for any line. What did not work: an item in a real
  UoM group (SAP resets the ratio to the group's 1:1) and ChangeInventoryQuantityIndependently (ignored).
#>

# How far SAP's InventoryQuantity may be from the quantity received: it is rounded to the Quantities setting (3 dp).
$BillUnitTolerance = 0.001

function Add-BillUnitFields {
    # Turns a GRPO line based on a PO line into one in the bill unit. $Line is the CMMS receipt line (qty in the stock
    # unit, bill_qty in bill_uom); $PoPrice is the PO line's Price per stock unit. A line with no bill unit is left as
    # it is and $false comes back.
    param([System.Collections.IDictionary] $DocLine, $Line, [double] $PoPrice)
    $unit = "$($Line.bill_uom)".Trim()
    if (-not $unit) { return $false }
    $qty = [double]$Line.qty
    $billQty = [double]("0$($Line.bill_qty)")
    if ($qty -le 0) { throw 'the quantity received must be more than zero' }
    if ($billQty -le 0) { throw "the quantity on the bill (in $unit) must be more than zero" }
    $ratio = [math]::Round($qty / $billQty, 6)
    if ($ratio -le 0) { throw "$qty received for $billQty $unit on the bill is too small a ratio for SAP (6 decimals)" }
    $DocLine.Quantity = $billQty
    $DocLine.MeasureUnit = $unit
    $DocLine.UnitsOfMeasurment = $ratio
    $DocLine.UnitPrice = [math]::Round($PoPrice * $ratio, 6)
    $DocLine.DiscountPercent = 0
    $DocLine.LineTotal = [math]::Round($qty * $PoPrice, 2)
    $true
}

function Get-BillUnitMismatch {
    # After a GRPO is posted or adopted: each bill-unit line's InventoryQuantity in SAP against the quantity received.
    # $GrpoLines = the GRPO's DocumentLines read back from SAP; $Lines = the CMMS receipt lines. Lines are matched on
    # the PO line (BaseLine), which a receipt holds once. Returns one sentence per problem; none when all is right.
    param($GrpoLines, $Lines)
    $out = @()
    foreach ($l in @($Lines)) {
        if (-not "$($l.bill_uom)".Trim()) { continue }
        $g = @(@($GrpoLines) | Where-Object { [int]$_.BaseLine -eq [int]$l.po_line })
        if (-not $g.Count) { $out += "PO line $($l.po_line) ($($l.sap_item_code)) is not on the GRPO"; continue }
        $inv = [double]$g[0].InventoryQuantity
        if ([math]::Abs($inv - [double]$l.qty) -gt $BillUnitTolerance) {
            $out += ("{0}: SAP took {1} into stock for {2} {3} on the bill, but {4} was received" -f $l.sap_item_code, $inv, $g[0].Quantity, $g[0].MeasureUnit, $l.qty)
        }
    }
    , $out
}
