<#
.SYNOPSIS
  CMMS -> SAP Business One engineering item master and engineering store receipts.

.DESCRIPTION
  One run, one SAP login per company, logout in a finally. Every kind of SAP document is switched on in
  config.json by the user and is off until then (create_items, post_receipts, create_groups,
  revalue_nil_stock, post_purchase_requests, post_issues, pull_from_sap); a kind that is off is left Queued.

  PASS 0 - NEW ITEM GROUPS (create_groups). Every "CMMS SAP Item Group Request" Queued: POST /ItemGroups
  with every account and setting of the company's engineering group the CMMS chose as template (a group
  of that name already in SAP is adopted), then publish it in engineering_groups / item_master_options.

  PASS A - CREATE (create_items). Every "CMMS Item Naming Request" with workflow_state = Approved and
  sap_create_status = Queued. Since 9 Oct 2026 there is no approval step: adding an item in the CMMS
  approves it at once.
    * item code: the company's next manual code for the group's prefix (ENG-<n> / EL-<n>, counted from
      SAP's own Items, every spelling "ENG-12" / "ENG 12" / "ENG - 12"), or - where the group has no
      prefix (Manna Treads) - SAP's automatic series assigns it;
    * POST /Items with ItemName (the SOP name), ForeignName, ItemsGroupCode, U_SubTypeA/B, one unit as
      inventory/purchasing/sales UoM, ChapterID (the HSN code looked up in that company's IndiaHsn; none
      for an item with no bill yet), U_TaxRate, MinInventory, GSTRelevnt = tYES and GSTTaxCategory = Regular
      (fixed, user 19 Oct 2026), and SWW = "IR<year>-<n>" (the request
      number: an idempotency stamp - a request whose stamp is already in SAP is adopted, never twice);
    * creates the ERPNext copy "<abbr>-<SAP code>" on the Maintenance Store root with the mirrored fields
      and the company's store as default warehouse;
    * writes erp_item / sap_item_code / sap_create_status = Created back and applies "Mark In SAP";
    * an opening quantity becomes a nil-value Stock Addition, posted in PASS C of the same run.
    A failure sets sap_create_status = Failed + sap_create_error; the Maintenance Manager can re-send it.

  PASS B - EDIT. Every mirrored Item with custom_sap_category_pending = 1: PATCH Items('<code>') with only
  the fields that differ among the enabled ones (default ItemName, ItemsGroupCode, U_SubTypeA/B,
  ChapterID, U_TaxRate - user, 9 Oct 2026); read back to verify; clear pending only if ERPNext still holds
  what was pushed. Runs before PASS C, so the HSN / tax rate a goods receipt took from the bill is on the
  SAP item before its GRPO is posted.

  PASS C - RECEIPTS (post_receipts). Every "CMMS Goods Receipt" Queued:
    * Goods Receipt  -> GRPO (PurchaseDeliveryNotes) against the open PO lines (BaseType 22), checked
      against the PO in SAP first; NumAtCard = bill no., TaxDate = bill date, DocDate = today; vendor,
      price and tax code come from the PO, so accounts make the A/P invoice from it as before;
    * Stock Addition -> Goods Receipt (InventoryGenEntries) at price 0 - stock with no bill;
    * Reference2 = "GR<yy>-<n>" (the CMMS receipt number) - a receipt already in SAP is adopted;
    * revalue_nil_stock: stock of the item already on the shelf at zero cost is revalued to the GR price
      first (MaterialRevaluation, price change; in ERPNext a Stock Reconciliation), so the receipt
      replaces the nil value instead of averaging into it;
    * then the same quantity into the company's ERPNext store (Material Receipt at the line rate), the
      Item's valuation rate set if it was 0, and the receipt marked Posted (or Failed with the reason).

  PASS F - SPARES ISSUED TO BREAKDOWNS (post_issues). Every "CMMS Goods Issue" Queued - the spares picked
  from the plant's store when a breakdown was marked "Machine running again" (10 Oct 2026; the CMMS checked
  each quantity against what the store had available): a SAP Goods Issue (InventoryGenExits) from the line's
  warehouse (the company's engineering warehouse), Reference2 = "GI<yy>-<n>" so a re-run adopts it, the
  breakdown in Comments; then the same quantity out of the company's ERPNext store (Material Issue) and the
  issue marked Posted (or Failed with the reason). Runs right after PASS C. SAP refuses an issue that would
  take the warehouse below zero.

  PASS E - FETCH FROM SAP (pull_from_sap). The items of this company's engineering item groups only: new
  ones are added to ERPNext, SAP-side changes (name, groups, HSN, tax, minimum, active) copied unless the
  CMMS has its own edit waiting, items moved out of the engineering groups disabled, and SAP's on-hand
  quantity (QuantityOnStock, as the 24 Sep opening stock) posted to the company's ERPNext store as a Stock
  Reconciliation where it differs. Reads SAP; writes ERPNext only. Runs before the open PO read.

  PASS D - PURCHASE REQUESTS (post_purchase_requests). Every "CMMS Purchase Request" Queued: a SAP
  Purchase Request (PurchaseRequests) with its lines, RequriedDate = required by, raised under pr_requester
  (ReqType 171 = employee), the CMMS raiser and reason in Comments, Reference2 = "PR<yy>-<n>".
  The purchase manager converts it to a PO in SAP; the open PO read below finds that PO (its lines carry
  BaseType 1470000113) and the CMMS request goes Ordered with the PO number - or Closed if SAP closed the
  request with no PO.

  PASS G - PURCHASE ORDERS (post_purchase_orders, 20 Oct 2026). Every "CMMS Purchase Request" whose
  po_status is Queued - a PO the purchase manager made in the CMMS: a SAP Purchase Order (PurchaseOrders)
  for the vendor, PO date and delivery date given, each ordered line copied from the SAP purchase request
  (BaseType 1470000113 / BaseEntry / BaseLine) with its quantity, unit price and tax code (SAP's default
  when none), Reference2 = "PO<yy>-<n>" so a re-run adopts it. po_status goes Posted with the PO number,
  or Failed with SAP's reason; the open PO read below then turns the request Ordered as for a PO made in
  SAP. With it on, each company's suppliers (BusinessPartners, cSupplier, active) and purchase tax codes
  are published in item_master_options (vendors, tax_codes) for the PO form, refreshed hourly.
  A PO cancelled in SAP (Cancelled = tYES) comes off its request on the open PO read; once every PO of a
  request is cancelled the request ends - Closed, po_status Cancelled for one made in the CMMS, the reason
  in error - and its SAP purchase request is closed (PurchaseRequests(n)/Close, with post_purchase_requests).

  Then each company's open PO lines for engineering items are read and published (open_po_lines - in a
  dry run too: they only describe SAP), and the per-company options (next codes, HSN list) refreshed.

  REVIEWED EXCEPTIONS TO BRIEFING §1 RULE 2, approved by the user: category edits (24 Sep 2026), creating
  + editing engineering items (25 Sep 2026), and on 9 Oct 2026 engineering goods receipts (GRPO against
  the PO), nil-value stock additions, revaluing nil-valued engineering stock, new engineering item
  groups, and purchase requests for engineering items; on 10 Oct 2026 goods issues of engineering spares
  used on breakdowns; on 20 Oct 2026 purchase orders for engineering purchase requests, made by the purchase
  manager in the CMMS, and closing the SAP purchase request of a CMMS request whose every PO was cancelled
  in SAP (asked for by the user, 20 Oct 2026). Every engineering goods receipt is made from the CMMS from then on; raw materials and
  consumables stay in SAP. It only creates items in a company's engineering item groups, only PATCHes the
  fields above, only posts receipts for engineering items mirrored in the CMMS, never renames item groups.
  On 20 Oct 2026 (approved by melvinmathew@mannarubber.com, an exception to rule 3 as well): new HSN codes
  typed on a CMMS goods receipt (PASS H), and - mark_gst_relevant - GST relevance on an item whose HSN is
  being set. Apart from PASS H it never creates HSN codes (SAP configuration, rule 3).

  PASS H - NEW HSN CODES (create_hsn). Every "CMMS SAP HSN Request" Queued for this company (raised by the
  CMMS when a goods receipt line gives an item with no HSN a code that is not in the company's SAP HSN list):
  POST /IndiaHsn with Chapter / Heading / SubHeading split 2 / 2 / rest, as every existing row is, and a
  Description ("Added from CMMS goods receipt <receipt>" when the request has none); SAP derives ChapterID
  ("73.18.1500") itself. A code already in SAP is adopted, never added twice. Read back to verify, added to
  this run's HSN list so PASS A / B can use it, request marked Created (or Failed with SAP's message).
  Runs right after login, before PASS 0. A goods receipt with a line whose HSN request is not Created, or
  whose item's HSN edit failed in this run, is held (left Queued with the reason) rather than posted
  without the HSN.
  Verified 20 Oct 2026 in the demo company (HITECH_PRETREADS_DB): POST /IndiaHsn 73/18/1500 -> AbsEntry 19,
  ChapterID "73.18.1500". And: SAP silently drops ChapterID on an item with GSTRelevnt = tNO (ENG-932,
  created before 19 Oct) - it sticks only when GSTRelevnt = tYES is sent with it (mark_gst_relevant).

  Built per BRIEFING §2: curl.exe with "-H Expect:" (PowerShell 5.1 sends Expect: 100-continue and this
  Service Layer answers it with an empty 500); MANNA_TYRE_LIVE's own password from sap.password_overrides.
  Dry run when -DryRun is passed OR the control Single has dry_run = 1 (its starting state): reads SAP and
  ERPNext, logs exactly what it would send, writes nothing but the open PO lines.

.PARAMETER ConfigPath      config.json (see config.example.json). Defaults to the file next to this script.
.PARAMETER DryRun          Read only; report what would be created / changed / posted.
.PARAMETER ResultJsonPath  Where to write {exitCode, changed, failures, summary, error} for the poller.
.PARAMETER Limit           At most this many creates, edits and receipts (testing).
#>
[CmdletBinding()]
param(
    [string] $ConfigPath,
    [switch] $DryRun,
    [string] $ResultJsonPath,
    [int] $Limit = 0,
    # Company databases to leave out of this run (added to config.json "skip_companies").
    [string[]] $SkipCompany = @()
)

Set-StrictMode -Version 1.0
$ErrorActionPreference = 'Stop'
$scriptDir = $PSScriptRoot; if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $ConfigPath) { $ConfigPath = Join-Path $scriptDir 'config.json' }
$utf8 = New-Object System.Text.UTF8Encoding($false)
$result = [ordered]@{ exitCode = 0; changed = 0; created = 0; failures = 0; summary = ''; error = ''; dryRun = $false; items = @() }
function Save-Result { if ($ResultJsonPath) { [IO.File]::WriteAllText($ResultJsonPath, ($result | ConvertTo-Json -Depth 8), $utf8) } }

$logDir = Join-Path $scriptDir 'logs'
if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$logFile = Join-Path $logDir ('item-master-sync-{0}.log' -f (Get-Date -Format 'yyyy-MM-dd'))
function Log {
    param([string] $Level, [string] $Message)
    $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Write-Host $line
    try { Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8 } catch { }
}

# The company's CMMS store = the ERPNext copy's default warehouse (see Manna_CMMS server stores.js).
$storeByAbbr = @{ MRPPL = 'Manna Rubber Products Store - MRPPL'; MT = 'Stores - MT'; HRI = 'Stores - HRI'; MTR = 'Stores - MTR' }
$companyByAbbr = @{ MRPPL = 'Manna Rubber Products Private Limited'; MT = 'Manna Treads'; HRI = 'Hi-Tech Rubber Industries'; MTR = 'Manna Tyre Retreads' }

try {
    if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "config not found: $ConfigPath" }
    $cfg = ([IO.File]::ReadAllText($ConfigPath).TrimStart([char]0xFEFF)) | ConvertFrom-Json
    foreach ($k in 'url', 'api_key', 'api_secret') { if (-not "$($cfg.erpnext.$k)".Trim() -or "$($cfg.erpnext.$k)" -match 'PUT_.*_HERE') { throw "config erpnext.$k is missing or a placeholder" } }
    foreach ($k in 'url', 'username', 'password') { if (-not "$($cfg.sap.$k)".Trim() -or "$($cfg.sap.$k)" -match 'PUT_.*_HERE') { throw "config sap.$k is missing or a placeholder" } }
    $control = if ("$($cfg.control_doctype)".Trim()) { "$($cfg.control_doctype)" } else { 'SAP Item Category Sync Control' }

    # What this sync may write. Edits send the item name, the three category levels, HSN and tax rate (user,
    # 9 Oct 2026). Each kind of SAP document is switched on in config.json by the user, and off until then:
    #   "create_items": true       create items added in the CMMS (no approval step since 9 Oct 2026)
    #   "post_receipts": true      goods receipts (GRPO against the PO) and nil-value stock additions (Goods Receipt)
    #   "create_groups": true      new engineering item groups
    #   "revalue_nil_stock": true  revalue nil-valued stock to a goods receipt's price before receiving it
    #   "post_issues": true        spares used on breakdowns (SAP Goods Issue + ERPNext Material Issue)
    #   "create_hsn": true         new HSN codes typed on a goods receipt (PASS H, IndiaHsn)
    #   "mark_gst_relevant": true  when an edit sets an HSN on an item with GSTRelevnt = tNO, send GSTRelevnt = tYES
    #                              and GSTTaxCategory = Regular with it (as PASS A creates items); off: such an edit
    #                              fails with that reason, because SAP would drop the HSN
    #   "edit_fields": [...]       any of $allEditFields, to narrow or widen what edits send
    $allEditFields = @('ItemName', 'ForeignName', 'ChapterID', 'U_TaxRate', 'MinInventory', 'ItemsGroupCode', 'U_SubTypeA', 'U_SubTypeB')
    $editFields = @('ItemName', 'ItemsGroupCode', 'U_SubTypeA', 'U_SubTypeB', 'ChapterID', 'U_TaxRate')
    if ($cfg.PSObject.Properties['edit_fields'] -and @($cfg.edit_fields).Count) { $editFields = @($cfg.edit_fields | ForEach-Object { "$_" }) }
    $bad = @($editFields | Where-Object { $allEditFields -notcontains $_ }); if ($bad.Count) { throw "config edit_fields has unknown field(s): $($bad -join ', ')" }
    function Cfg-On([string] $Name) { $cfg.PSObject.Properties[$Name] -and [bool]$cfg.$Name }
    $createItems = Cfg-On 'create_items'
    $postReceipts = Cfg-On 'post_receipts'
    $createGroups = Cfg-On 'create_groups'
    $revalueNil = Cfg-On 'revalue_nil_stock'
    $postPrs = Cfg-On 'post_purchase_requests'
    $postIssues = Cfg-On 'post_issues'
    $createHsn = Cfg-On 'create_hsn'
    $markGst = Cfg-On 'mark_gst_relevant'
    # The purchase manager's POs from purchase requests (20 Oct 2026), and the supplier / tax code lists for them.
    $postPos = Cfg-On 'post_purchase_orders'
    # Fetch from SAP: the engineering item groups' items (new ones, SAP-side changes) and their on-hand
    # quantity into the CMMS. Writes ERPNext only - SAP is read.
    $pullFromSap = Cfg-On 'pull_from_sap'
    # The SAP employee a purchase request is raised under (ReqType 171 = employee); the CMMS raiser goes in its remarks.
    $prRequester = if ($cfg.PSObject.Properties['pr_requester'] -and "$($cfg.pr_requester)".Trim()) { "$($cfg.pr_requester)".Trim() } else { "$($cfg.sap.username)" }
    # Companies left out entirely - no SAP login, their CMMS work stays Queued (13 Oct 2026: MANNA_TYRE_LIVE refused
    # its password twice, and SAP locks a user after 3 wrong passwords, so the watcher must not keep trying it).
    $skipDbs = @(@($SkipCompany) + @(if ($cfg.PSObject.Properties['skip_companies']) { @($cfg.skip_companies) }) | ForEach-Object { "$_".Trim().ToUpper() } | Where-Object { $_ })

    # ------------------------------------------------------------------ curl + TLS
    $curl = (Get-Command curl.exe).Source
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $erp = "$($cfg.erpnext.url)".TrimEnd('/')
    $erpAuth = 'token {0}:{1}' -f $cfg.erpnext.api_key, $cfg.erpnext.api_secret
    function Erp-Get([string] $Path) {
        $tag = [guid]::NewGuid().ToString('N').Substring(0, 8)
        $resp = Join-Path $env:TEMP "erp-$tag.txt"
        try {
            $url = "$erp$Path" -replace ' ', '%20'
            $code = & $curl -k -s --globoff --connect-timeout 15 --max-time 60 -H "Expect:" -H "Authorization: $erpAuth" -o $resp -w "%{http_code}" -X GET $url
            if ($code -ne '200') { throw "ERPNext GET $Path HTTP $code" }
            [IO.File]::ReadAllText($resp) | ConvertFrom-Json
        } finally { if (Test-Path -LiteralPath $resp) { [IO.File]::Delete($resp) } }
    }
    function Erp-Send([string] $Method, [string] $Path, $Body) {
        $tag = [guid]::NewGuid().ToString('N').Substring(0, 8)
        $resp = Join-Path $env:TEMP "erp-$tag.txt"
        $bodyFile = Join-Path $env:TEMP "erp-$tag-body.json"
        $json = $Body | ConvertTo-Json -Compress -Depth 10
        [IO.File]::WriteAllText($bodyFile, $json, $utf8)
        try {
            $url = "$erp$Path" -replace ' ', '%20'
            $code = & $curl -k -s --globoff --connect-timeout 15 --max-time 60 -H "Expect:" -H "Authorization: $erpAuth" -H "Content-Type: application/json; charset=utf-8" -o $resp -w "%{http_code}" -X $Method --data-binary "@$bodyFile" $url
            if ($code -lt '200' -or $code -ge '300') {
                $errText = if (Test-Path -LiteralPath $resp) { [IO.File]::ReadAllText($resp) } else { '' }
                throw "ERPNext $Method $Path HTTP $code`: $errText"
            }
            [IO.File]::ReadAllText($resp) | ConvertFrom-Json
        } finally {
            if (Test-Path -LiteralPath $resp) { [IO.File]::Delete($resp) }
            if (Test-Path -LiteralPath $bodyFile) { [IO.File]::Delete($bodyFile) }
        }
    }
    function Res([string] $Doctype, [string] $Name) { "/api/resource/$([uri]::EscapeDataString($Doctype))" + $(if ($Name) { "/$([uri]::EscapeDataString($Name))" } else { '' }) }
    # Filters are passed as Frappe JSON text: nested arrays built in PowerShell collapse or double-wrap.
    function Erp-List([string] $Doctype, [string[]] $Fields, [string] $FiltersJson) {
        $f = [uri]::EscapeDataString((ConvertTo-Json -InputObject @($Fields) -Compress)); $q = [uri]::EscapeDataString($FiltersJson)
        @((Erp-Get ("{0}?fields={1}&filters={2}&limit_page_length=0" -f (Res $Doctype ''), $f, $q)).data)
    }
    function Now-Ist { (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') }
    function Norm([string] $s) { ("$s" -replace '\s+', ' ').Trim() }
    function Digits([string] $s) { ("$s" -replace '[^0-9]', '') }

    $ctl = (Erp-Get (Res $control $control)).data
    if ("$($ctl.dry_run)" -eq '1') { $DryRun = $true }
    $result.dryRun = [bool]$DryRun
    $groupsByAbbr = "$($ctl.engineering_groups)" | ConvertFrom-Json
    $options = if ("$($ctl.item_master_options)".Trim()) { "$($ctl.item_master_options)" | ConvertFrom-Json } else { $null }
    if (-not $groupsByAbbr -or -not $options) { throw "$control has no engineering_groups / item_master_options - run backfill-categories.js and backfill-item-master.js" }

    # @() because a PowerShell function hands back a lone row as a scalar, not a one-row list.
    $creates = @(Erp-List 'CMMS Item Naming Request' @('name', 'proposed_name', 'sap_company', 'sap_item_group', 'sap_sub_type_a', 'sap_sub_type_b', 'foreign_name', 'sap_uom', 'hsn_code', 'tax_rate', 'min_stock', 'brand', 'uom', 'opening_qty', 'raised_by') '[["workflow_state","=","Approved"],["sap_create_status","=","Queued"]]')
    $edits = @(Erp-List 'Item' @('name', 'item_name', 'safety_stock', 'custom_sap_item_code', 'custom_sap_item_group', 'custom_sap_sub_type_a', 'custom_sap_sub_type_b', 'custom_sap_foreign_name', 'custom_sap_hsn_code', 'custom_sap_tax_rate') '[["custom_sap_category_pending","=",1]]')
    # Receipts with their lines (one GET each: the list endpoint does not return child tables).
    $receipts = @(Erp-List 'CMMS Goods Receipt' @('name') '[["status","=","Queued"]]' | ForEach-Object { (Erp-Get (Res 'CMMS Goods Receipt' $_.name)).data })
    $groupReqs = @(Erp-List 'CMMS SAP Item Group Request' @('name', 'company', 'group_name', 'code_prefix', 'template_group_code') '[["status","=","Queued"]]')
    $prs = @(Erp-List 'CMMS Purchase Request' @('name') '[["status","=","Queued"]]' | ForEach-Object { (Erp-Get (Res 'CMMS Purchase Request' $_.name)).data })
    # Requests already in SAP: watched for the PO the purchase manager raises from them.
    $openPrs = @(Erp-List 'CMMS Purchase Request' @('name', 'company', 'status', 'sap_doc_entry', 'sap_doc_number', 'po_numbers', 'po_status', 'po_doc_entry', 'po_doc_number') '[["status","in",["In SAP","Ordered"]]]')
    # POs the purchase manager made from a request in the CMMS, with the request's lines. Read in a try: the
    # po_* fields exist only once server/scripts/syncPurchasing.js has been run.
    $orders = @()
    try { $orders = @(Erp-List 'CMMS Purchase Request' @('name') '[["po_status","=","Queued"]]' | ForEach-Object { (Erp-Get (Res 'CMMS Purchase Request' $_.name)).data }) }
    catch { if ($postPos) { Log WARN ("purchase orders not read (run server/scripts/syncPurchasing.js?): {0}" -f $_.Exception.Message) } }
    if (-not $postPos -and $orders.Count) { Log INFO ("{0} purchase order(s) left Queued - posting them is off (post_purchase_orders)." -f $orders.Count); $orders = @() }
    if (-not $postPrs -and $prs.Count) { Log INFO ("{0} purchase request(s) left Queued - posting them is off (post_purchase_requests)." -f $prs.Count); $prs = @() }
    # Spares issued to breakdowns, with their lines. Read in a try: the doctype exists only once
    # setup-goods-issue.js has been applied, and its absence must not stop the rest of the run.
    $issues = @()
    try { $issues = @(Erp-List 'CMMS Goods Issue' @('name') '[["status","=","Queued"]]' | ForEach-Object { (Erp-Get (Res 'CMMS Goods Issue' $_.name)).data }) }
    catch { if ($postIssues) { Log WARN ("goods issues not read (run setup-goods-issue.js --apply?): {0}" -f $_.Exception.Message) } }
    if (-not $postIssues -and $issues.Count) { Log INFO ("{0} spares issue(s) left Queued - posting them is off (post_issues)." -f $issues.Count); $issues = @() }
    # New HSN codes from goods receipts (PASS H). Failed ones are read too: their receipts stay held until the
    # CMMS sends the request again. Read in a try: the doctype exists only once setup-hsn-request.js is applied.
    $hsnReqs = @()
    try { $hsnReqs = @(Erp-List 'CMMS SAP HSN Request' @('name', 'company', 'hsn_code', 'description', 'goods_receipt', 'item', 'status', 'error') '[["status","in",["Queued","Failed"]]]') }
    catch { if ($createHsn) { Log WARN ("HSN requests not read (run setup-hsn-request.js --apply?): {0}" -f $_.Exception.Message) } }
    $hsnState = @{}; foreach ($hq in $hsnReqs) { $hsnState["$($hq.name)"] = "$($hq.status)" }
    $hsnQueued = @($hsnReqs | Where-Object { "$($_.status)" -eq 'Queued' })
    if (-not $createHsn -and $hsnQueued.Count) { Log INFO ("{0} HSN request(s) left Queued - creating HSN codes is off (create_hsn); their goods receipts are held." -f $hsnQueued.Count); $hsnQueued = @() }
    # Items whose HSN edit (PASS B) failed in this run: their goods receipts are held as well.
    $hsnEditFailed = @{}
    if (-not $createItems -and $creates.Count) { Log INFO ("{0} approved request(s) left Queued - creating items in SAP is off (create_items)." -f $creates.Count); $creates = @() }
    if (-not $postReceipts -and $receipts.Count) { Log INFO ("{0} receipt(s) left Queued - posting receipts is off (post_receipts)." -f $receipts.Count); $receipts = @() }
    if (-not $createGroups -and $groupReqs.Count) { Log INFO ("{0} item group request(s) left Queued - creating groups is off (create_groups)." -f $groupReqs.Count); $groupReqs = @() }
    if ($Limit -gt 0) { $creates = @($creates | Select-Object -First $Limit); $edits = @($edits | Select-Object -First $Limit); $receipts = @($receipts | Select-Object -First $Limit); $issues = @($issues | Select-Object -First $Limit) }
    Log INFO ("{0} item(s) to create, {1} with pending edits, {2} receipt(s), {3} spares issue(s), {4} new item group(s), {5} new HSN code(s); edits send {6}{7}." -f $creates.Count, $edits.Count, $receipts.Count, $issues.Count, $groupReqs.Count, $hsnQueued.Count, ($editFields -join ', '), $(if ($DryRun) { ' - DRY RUN, nothing will be written' } else { '' }))
    # No early exit: every run also re-reads each company's open PO lines for the goods receipt form.

    # The engineering items ERPNext mirrors, per company: SAP code -> ERPNext item (for the open PO lines).
    # $mirrorAll includes disabled items, for PASS E (fetch from SAP) to re-enable or update them.
    $mirror = @{}; $mirrorAll = @{}
    foreach ($it in (Erp-List 'Item' @('name', 'item_name', 'custom_sap_item_code', 'valuation_rate', 'disabled', 'stock_uom', 'custom_sap_item_group', 'custom_sap_sub_type_a', 'custom_sap_sub_type_b', 'custom_sap_foreign_name', 'custom_sap_hsn_code', 'custom_sap_tax_rate', 'safety_stock', 'custom_sap_category_pending') '[["custom_sap_item_group","is","set"]]')) {
        $ab = ("$($it.name)" -split '-', 2)[0]
        $sc = "$($it.custom_sap_item_code)".Trim()
        if (-not $sc) { continue }
        if (-not $mirrorAll.ContainsKey($ab)) { $mirrorAll[$ab] = @{} }
        $mirrorAll[$ab][$sc] = $it
        if ([int]"0$($it.disabled)" -eq 0) {
            if (-not $mirror.ContainsKey($ab)) { $mirror[$ab] = @{} }
            $mirror[$ab][$sc] = $it
        }
    }
    $poSnapshot = [ordered]@{}
    $groupsChanged = $false
    $today = (Get-Date).ToString('yyyy-MM-dd')
    $result['receipts'] = 0; $result['groups'] = 0; $result['prs'] = 0; $result['fetched'] = 0; $result['issues'] = 0; $result['pos'] = 0

    # ------------------------------------------------------------------ SAP (curl.exe, BRIEFING §2)
    $slBase = "$($cfg.sap.url)".TrimEnd('/')
    $slRoot = ([Uri]$slBase).GetLeftPart([UriPartial]::Authority)
    $US = [string][char]0x1F
    function Invoke-Sl {
        param([string] $Method, [string] $Url, [string] $Body, [string] $Jar, [switch] $SaveCookies, [string] $IfMatch)
        $tag = [guid]::NewGuid().ToString('N').Substring(0, 8)
        $resp = Join-Path $env:TEMP "imsync-$tag-resp.txt"; $bodyFile = $null
        $a = @('-k', '-s', '--globoff', '--connect-timeout', '15', '--max-time', '120', '-H', 'Expect:', '-H', 'Prefer: odata.maxpagesize=200',
               '-o', $resp, '-w', "%{http_code}$US%{time_total}", '-X', $Method)
        if ($SaveCookies) { $a += @('-c', $Jar) } else { $a += @('-b', $Jar) }
        if ($IfMatch) { $a += @('-H', "If-Match: $IfMatch") }
        if ($null -ne $Body -and $Body -ne '') {
            $bodyFile = Join-Path $env:TEMP "imsync-$tag-body.json"
            [IO.File]::WriteAllText($bodyFile, $Body, $utf8)
            $a += @('-H', 'Content-Type: application/json', '--data-binary', "@$bodyFile")
        }
        $a += ($Url -replace ' ', '%20' -replace "'", '%27')
        try { $meta = & $curl @a; $text = if (Test-Path -LiteralPath $resp) { [IO.File]::ReadAllText($resp) } else { '' } }
        finally { if (Test-Path -LiteralPath $resp) { [IO.File]::Delete($resp) }; if ($bodyFile -and (Test-Path -LiteralPath $bodyFile)) { [IO.File]::Delete($bodyFile) } }
        $p = "$meta" -split [regex]::Escape($US)
        [pscustomobject]@{ Http = "$($p[0])"; Body = $text }
    }
    function Sl-Fail($r, [string] $what) { throw ("SAP {0} HTTP {1}: {2}" -f $what, $r.Http, ("$($r.Body)" -replace '\s+', ' ').Trim()) }
    function Sl-All([string] $Path, [string] $Jar) {
        $rows = New-Object System.Collections.ArrayList; $next = "$slBase/$Path"; $pages = 0
        while ($next -and $pages -lt 60) {
            $pages++; $r = Invoke-Sl -Method GET -Url $next -Jar $Jar
            if ($r.Http -ne '200') { Sl-Fail $r "read $Path" }
            $j = $r.Body | ConvertFrom-Json
            foreach ($v in $j.value) { [void]$rows.Add($v) }
            $lnk = $null; foreach ($n in 'odata.nextLink', '@odata.nextLink') { if ($j.PSObject.Properties[$n] -and $j.$n) { $lnk = [string]$j.$n } }
            $next = if (-not $lnk) { $null } elseif ($lnk -match '^https?://') { $lnk } elseif ($lnk.StartsWith('/')) { "$slRoot$lnk" } else { "$slBase/$lnk" }
        }
        , $rows
    }
    function Key-Url([string] $Code) { "$slBase/Items('$([uri]::EscapeDataString($Code.Replace("'", "''")))')" }
    function Prefix-Max($codes, [string] $Prefix) {
        $stem = [regex]::Escape($Prefix.TrimEnd('-')); $max = 0
        foreach ($c in $codes) { $m = [regex]::Match((Norm $c), "^$stem[\s-]*(\d+)$", 'IgnoreCase'); if ($m.Success) { $n = [int]$m.Groups[1].Value; if ($n -gt $max) { $max = $n } } }
        $max
    }

    # Work per SAP company.
    $work = @{}
    function Work-For([string] $Abbr) {
        $o = $options.$Abbr
        if (-not $o) { return $null }
        if (-not $work.ContainsKey($o.sap_db)) { $work[$o.sap_db] = @{ abbr = $Abbr; opt = $o; creates = New-Object System.Collections.ArrayList; edits = New-Object System.Collections.ArrayList; receipts = New-Object System.Collections.ArrayList; groups = New-Object System.Collections.ArrayList; prs = New-Object System.Collections.ArrayList; openPrs = New-Object System.Collections.ArrayList; issues = New-Object System.Collections.ArrayList; orders = New-Object System.Collections.ArrayList } }
        $work[$o.sap_db]
    }
    # Every company, for its open PO lines.
    foreach ($ab in @($options.PSObject.Properties.Name)) { $null = Work-For $ab }
    foreach ($g in $groupReqs) {
        $w = Work-For "$($g.company)"
        if (-not $w) { $result.failures++; Log ERROR ("{0}: unknown SAP company '{1}'" -f $g.name, $g.company); continue }
        [void]$w.groups.Add($g)
    }
    foreach ($pq in $prs) {
        $w = Work-For "$($pq.company)"
        if (-not $w) { $result.failures++; Log ERROR ("{0}: unknown SAP company '{1}'" -f $pq.name, $pq.company); continue }
        [void]$w.prs.Add($pq)
    }
    foreach ($pq in $openPrs) { $w = Work-For "$($pq.company)"; if ($w) { [void]$w.openPrs.Add($pq) } }
    foreach ($po in $orders) {
        $w = Work-For "$($po.company)"
        if (-not $w) { $result.failures++; Log ERROR ("{0}: unknown SAP company '{1}'" -f $po.name, $po.company); continue }
        [void]$w.orders.Add($po)
    }
    foreach ($rc in $receipts) {
        $w = Work-For "$($rc.company)"
        if (-not $w) { $result.failures++; Log ERROR ("{0}: unknown SAP company '{1}'" -f $rc.name, $rc.company); continue }
        [void]$w.receipts.Add($rc)
    }
    foreach ($gi in $issues) {
        $w = Work-For "$($gi.company)"
        if (-not $w) { $result.failures++; Log ERROR ("{0}: unknown SAP company '{1}'" -f $gi.name, $gi.company); continue }
        [void]$w.issues.Add($gi)
    }
    foreach ($c in $creates) {
        $w = Work-For "$($c.sap_company)"
        if (-not $w) { $result.failures++; Log ERROR ("{0}: unknown SAP company '{1}'" -f $c.name, $c.sap_company); continue }
        [void]$w.creates.Add($c)
    }
    foreach ($e in $edits) {
        $w = Work-For (("$($e.name)" -split '-', 2)[0])
        if (-not $w) { $result.failures++; Log ERROR ("{0}: no company for this code prefix" -f $e.name); continue }
        [void]$w.edits.Add($e)
    }

    $optionsChanged = $false
    foreach ($db in $work.Keys) {
        $w = $work[$db]; $abbr = $w.abbr; $opt = $w.opt
        if ($skipDbs -contains "$db".ToUpper()) { Log WARN ("{0}: skipped (skip_companies) - not logged in; its CMMS work stays Queued" -f $db); continue }
        $password = "$($cfg.sap.password)"
        if ($cfg.sap.PSObject.Properties['password_overrides'] -and $cfg.sap.password_overrides.PSObject.Properties[$db]) { $password = "$($cfg.sap.password_overrides.$db)" }
        $jar = Join-Path $env:TEMP ("imsync-{0}.jar" -f [guid]::NewGuid().ToString('N').Substring(0, 8))
        try {
            $login = @{ CompanyDB = $db; UserName = "$($cfg.sap.username)"; Password = $password } | ConvertTo-Json -Compress
            $lg = Invoke-Sl -Method POST -Url "$slBase/Login" -Body $login -Jar $jar -SaveCookies
            $login = $null
            if ($lg.Http -ne '200') { Sl-Fail $lg "login to $db" }
            Log INFO ("SAP login OK: {0} ({1} to create, {2} to edit, {3} receipt(s), {4} spares issue(s), {5} new group(s), {6} purchase request(s), {7} purchase order(s))" -f $db, $w.creates.Count, $w.edits.Count, $w.receipts.Count, $w.issues.Count, $w.groups.Count, $w.prs.Count, $w.orders.Count)

            # This company's HSN list: digits -> AbsEntry (ChapterID). Only read when HSN is written.
            $hsn = @{}; $hsnList = New-Object System.Collections.ArrayList
            $needHsn = $w.creates.Count -gt 0 -or $editFields -contains 'ChapterID' -or $pullFromSap -or $w.hsnReqs.Count -gt 0
            if ($needHsn) {
                foreach ($h in (Sl-All 'IndiaHsn?$select=AbsEntry,Chapter,Heading,SubHeading' $jar)) {
                    $d = Digits ("{0}{1}{2}" -f $h.Chapter, $h.Heading, $h.SubHeading)
                    if ($d -and -not $hsn.ContainsKey($d)) { $hsn[$d] = [int]$h.AbsEntry; [void]$hsnList.Add($d) }
                }
            }
            function Chapter-Of([string] $code) {
                $d = Digits $code
                if (-not $d) { return -1 }
                if (-not $hsn.ContainsKey($d)) { throw "HSN $d is not in $db's HSN list in SAP" }
                $hsn[$d]
            }

            # ---------------- PASS H: new HSN codes typed on a goods receipt (create_hsn)
            # Split 2 / 2 / rest, as every IndiaHsn row is (25 / 03 / 0010, 32 / 09 / -); SAP derives ChapterID
            # ("73.18.1500") itself. A code SAP already has is adopted. Before PASS 0, so PASS A / B can use it.
            # In a dry run the new code gets the placeholder entry -2, so PASS B shows the edit it would make.
            foreach ($hq in $w.hsnReqs) {
                $d = Digits $hq.hsn_code
                $entry = [ordered]@{ kind = 'hsn'; request = "$($hq.name)"; sap_db = $db; hsn = $d; action = ''; sap_hsn = $null; error = '' }
                $payload = $null
                try {
                    if (@(4, 6, 8) -notcontains $d.Length) { throw "HSN '$($hq.hsn_code)' must be 4, 6 or 8 digits" }
                    $chap = [int]$d.Substring(0, 2)
                    if ($chap -lt 1 -or $chap -gt 98 -or $chap -eq 77) { throw "HSN $d has no valid chapter ($($d.Substring(0, 2)))" }
                    if ($hsn.ContainsKey($d)) { $abs = $hsn[$d]; $entry.action = 'adopted (already in SAP)' }
                    else {
                        $desc = Norm $hq.description
                        if (-not $desc) { $desc = ('Added from CMMS goods receipt {0}' -f "$($hq.goods_receipt)").Trim() }
                        if ($desc.Length -gt 100) { $desc = $desc.Substring(0, 100) }
                        $payload = [ordered]@{ Chapter = $d.Substring(0, 2); Heading = $d.Substring(2, 2); SubHeading = $d.Substring(4); Description = $desc }
                        if ($DryRun) { $abs = -2; $entry.action = 'would create' }
                        else {
                            $pr = Invoke-Sl -Method POST -Url "$slBase/IndiaHsn" -Body ($payload | ConvertTo-Json -Compress) -Jar $jar
                            if ($pr.Http -ne '201' -and $pr.Http -ne '200') { Sl-Fail $pr 'create HSN code' }
                            $abs = [int](($pr.Body | ConvertFrom-Json).AbsEntry)
                            $entry.action = 'created in SAP'; $result['hsn']++
                        }
                        $hsn[$d] = $abs; [void]$hsnList.Add($d)
                    }
                    $entry.sap_hsn = $abs
                    if (-not $DryRun) {
                        # Read back: the row SAP holds under that entry must carry the same digits.
                        $v = Invoke-Sl -Method GET -Url ("$slBase/IndiaHsn({0})?`$select=AbsEntry,Chapter,Heading,SubHeading,ChapterID" -f $abs) -Jar $jar
                        if ($v.Http -ne '200') { Sl-Fail $v "read back HSN entry $abs" }
                        $vb = $v.Body | ConvertFrom-Json
                        $back = Digits ("{0}{1}{2}" -f $vb.Chapter, $vb.Heading, $vb.SubHeading)
                        if ($back -ne $d) { throw "SAP HSN entry $abs reads back $back, not $d" }
                        $null = Erp-Send PUT (Res 'CMMS SAP HSN Request' $hq.name) @{ status = 'Created'; sap_abs_entry = $abs; sap_chapter_id = "$($vb.ChapterID)"; created_at = (Now-Ist); error = '' }
                        $hsnState["$($hq.name)"] = 'Created'
                    }
                    Log INFO ("{0} [{1}]: HSN {2} {3} {4}" -f $hq.name, $db, $d, $entry.action, $(if ($DryRun -and $payload) { ($payload | ConvertTo-Json -Compress) } else { "(entry $abs)" }))
                } catch {
                    $entry.action = 'failed'; $entry.error = $_.Exception.Message; $result.failures++
                    $hsnState["$($hq.name)"] = 'Failed'; $hq.error = $entry.error
                    Log ERROR ("{0} [{1}]: {2}" -f $hq.name, $db, $entry.error)
                    if (-not $DryRun) { try { $null = Erp-Send PUT (Res 'CMMS SAP HSN Request' $hq.name) @{ status = 'Failed'; error = $entry.error.Substring(0, [Math]::Min(500, $entry.error.Length)) } } catch { Log WARN "could not record the failure on $($hq.name): $($_.Exception.Message)" } }
                }
                $result.items += [pscustomobject]$entry
            }

            # ---------------- PASS 0: new engineering item groups (create_groups)
            # Every account and setting is copied from the company's existing engineering group the CMMS chose,
            # so the new group posts exactly as that one does. The warehouse default-bin rows are not copied.
            foreach ($gr in $w.groups) {
                $entry = [ordered]@{ kind = 'group'; request = "$($gr.name)"; sap_db = $db; group = "$($gr.group_name)"; action = ''; sap_group = $null; error = '' }
                $payload = $null
                try {
                    $gname = Norm $gr.group_name
                    if (-not $gname -or $gname.Length -gt 20) { throw 'the group name is empty or longer than SAP allows (20)' }
                    $found = Sl-All ("ItemGroups?`$select=Number,GroupName&`$filter=GroupName eq '{0}'" -f $gname.Replace("'", "''")) $jar
                    $code = $null
                    if ($found.Count -gt 0) { $code = [int]$found[0].Number; $entry.action = 'adopted (already in SAP)' }
                    else {
                        $tr = Invoke-Sl -Method GET -Url ("$slBase/ItemGroups({0})" -f [int]$gr.template_group_code) -Jar $jar
                        if ($tr.Http -ne '200') { Sl-Fail $tr ("read template item group {0}" -f $gr.template_group_code) }
                        $tpl = $tr.Body | ConvertFrom-Json
                        $payload = [ordered]@{ GroupName = $gname }
                        foreach ($pp in $tpl.PSObject.Properties) {
                            if ($pp.Name -like 'odata.*' -or $pp.Name -in @('Number', 'GroupName', 'ItemGroupsWarehouseInfos') -or $null -eq $pp.Value) { continue }
                            $payload[$pp.Name] = $pp.Value
                        }
                        if ($DryRun) { $entry.action = 'would create' }
                        else {
                            $pr = Invoke-Sl -Method POST -Url "$slBase/ItemGroups" -Body ($payload | ConvertTo-Json -Compress -Depth 5) -Jar $jar
                            if ($pr.Http -ne '201' -and $pr.Http -ne '200') { Sl-Fail $pr 'create item group' }
                            $code = [int](($pr.Body | ConvertFrom-Json).Number)
                            $entry.action = 'created in SAP'; $result.changed++; $result['groups']++
                        }
                    }
                    $entry.sap_group = $code
                    if (-not $DryRun) {
                        $prefix = "$($gr.code_prefix)".Trim().ToUpper()
                        if (-not @($opt.groups | Where-Object { [int]$_.code -eq $code }).Count) {
                            $opt.groups = @($opt.groups) + @([pscustomobject]@{ code = $code; name = $gname; prefix = $prefix })
                            if ($prefix -and -not $opt.next_codes.PSObject.Properties[$prefix]) { $opt.next_codes | Add-Member -NotePropertyName $prefix -NotePropertyValue 1 -Force }
                            $optionsChanged = $true
                        }
                        $eg = $groupsByAbbr.$abbr
                        if ($eg -and -not @($eg.groups | Where-Object { [int]$_.code -eq $code }).Count) { $eg.groups = @($eg.groups) + @([pscustomobject]@{ code = $code; name = $gname }); $groupsChanged = $true }
                        $null = Erp-Send PUT (Res 'CMMS SAP Item Group Request' $gr.name) @{ status = 'Created'; sap_group_code = $code; error = '' }
                    }
                    Log INFO ("{0} [{1}]: item group '{2}' {3} {4}" -f $gr.name, $db, $gname, $entry.action, $(if ($DryRun -and $payload) { ($payload | ConvertTo-Json -Compress) } else { "$code" }))
                } catch {
                    $entry.action = 'failed'; $entry.error = $_.Exception.Message; $result.failures++
                    Log ERROR ("{0} [{1}]: {2}" -f $gr.name, $db, $entry.error)
                    if (-not $DryRun) { try { $null = Erp-Send PUT (Res 'CMMS SAP Item Group Request' $gr.name) @{ status = 'Failed'; error = $entry.error.Substring(0, [Math]::Min(500, $entry.error.Length)) } } catch { Log WARN "could not record the failure on $($gr.name): $($_.Exception.Message)" } }
                }
                $result.items += [pscustomobject]$entry
            }

            $groupOf = @{}; foreach ($g in $opt.groups) { $groupOf[(Norm $g.name).ToLower()] = $g }
            $nextFor = @{}   # prefix -> next number, counted from SAP once per run
            # Where a stock addition lands in SAP: the company's engineering store (every receipt so far used 01).
            $whOf = if ($opt.PSObject.Properties['warehouse'] -and "$($opt.warehouse)".Trim()) { "$($opt.warehouse)".Trim() } else { '01' }

            # ---------------- PASS A: create
            foreach ($c in $w.creates) {
                $entry = [ordered]@{ kind = 'create'; request = "$($c.name)"; sap_db = $db; sap_code = ''; erp_item = ''; action = ''; payload = $null; error = '' }
                try {
                    $g = $groupOf[(Norm $c.sap_item_group).ToLower()]
                    if (-not $g) { throw "'$($c.sap_item_group)' is not an engineering item group of $db" }
                    $name = Norm $c.proposed_name
                    if (-not $name -or $name.Length -gt 100) { throw 'the description is empty or longer than SAP allows (100)' }
                    $unit = (Norm $c.sap_uom).ToUpper(); if (-not $unit) { throw 'no unit' }
                    $m = [regex]::Match("$($c.name)", '(\d{4})-(\d+)$')
                    $stamp = if ($m.Success) { 'IR{0}-{1}' -f $m.Groups[1].Value, $m.Groups[2].Value } else { "$($c.name)" }
                    if ($stamp.Length -gt 16) { $stamp = $stamp.Substring($stamp.Length - 16) }

                    # Already created by an earlier run that lost the answer? Adopt it.
                    $found = Sl-All ("Items?`$select=ItemCode&`$filter=SWW eq '{0}'" -f $stamp) $jar
                    $sapCode = ''
                    if ($found.Count -gt 0) { $sapCode = "$($found[0].ItemCode)"; $entry.action = 'adopted (already in SAP)' }
                    else {
                        $payload = [ordered]@{
                            ItemName = $name; ItemsGroupCode = [int]$g.code; ItemType = 'itItems'
                            InventoryItem = 'tYES'; SalesItem = 'tYES'; PurchaseItem = 'tYES'; ProcurementMethod = 'bom_Buy'
                            UoMGroupEntry = -1; InventoryUOM = $unit; PurchaseUnit = $unit; SalesUnit = $unit
                            SWW = $stamp; Series = [int]$opt.series
                            # India GST (user, 19 Oct 2026): every engineering item the CMMS creates is GST relevant with
                            # tax category Regular - fixed values, no CMMS input. GSTTaxCategoryEnum: gtc_Regular / gtc_NilRated / gtc_Exempt.
                            GSTRelevnt = 'tYES'; GSTTaxCategory = 'gtc_Regular'
                        }
                        if ((Norm $c.foreign_name)) { $payload.ForeignName = Norm $c.foreign_name }
                        if ((Norm $c.sap_sub_type_a)) { $payload.U_SubTypeA = Norm $c.sap_sub_type_a }
                        if ((Norm $c.sap_sub_type_b)) { $payload.U_SubTypeB = Norm $c.sap_sub_type_b }
                        if ((Norm $c.tax_rate)) { $payload.U_TaxRate = Norm $c.tax_rate }
                        if ((Digits $c.hsn_code)) { $payload.ChapterID = [int](Chapter-Of $c.hsn_code) }
                        # The minimum on the warehouse row too: an item that manages stock by warehouse (every MRPPL
                        # engineering item does, and new ones by default) ignores the item-level MinInventory
                        # (found 10 Oct 2026, physical-count clean-up).
                        if ([double]("0$($c.min_stock)") -gt 0) {
                            $payload.MinInventory = [double]$c.min_stock
                            $payload.ItemWarehouseInfoCollection = @(@{ WarehouseCode = $whOf; MinimalStock = [double]$c.min_stock })
                        }
                        if ("$($g.prefix)") {
                            $p = "$($g.prefix)"
                            if (-not $nextFor.ContainsKey($p)) {
                                $stem = $p.TrimEnd('-')
                                $codes = (Sl-All ("Items?`$select=ItemCode&`$filter=startswith(ItemCode,'{0}')" -f $stem) $jar) | ForEach-Object { $_.ItemCode }
                                $nextFor[$p] = (Prefix-Max $codes $p) + 1
                            }
                            # Never reuse a code someone typed in by hand meanwhile.
                            while ($true) {
                                $candidate = '{0}{1}' -f $p, $nextFor[$p]
                                $chk = Invoke-Sl -Method GET -Url ((Key-Url $candidate) + '?$select=ItemCode') -Jar $jar
                                if ($chk.Http -eq '404') { break }
                                if ($chk.Http -ne '200') { Sl-Fail $chk "check $candidate" }
                                $nextFor[$p]++
                            }
                            $payload.ItemCode = $candidate
                        }
                        $entry.payload = $payload
                        if ($DryRun) { $entry.action = 'would create'; $sapCode = $(if ($payload.Contains('ItemCode')) { $payload.ItemCode } else { '(assigned by SAP series ' + $opt.series + ')' }) }
                        else {
                            $pr = Invoke-Sl -Method POST -Url "$slBase/Items" -Body ($payload | ConvertTo-Json -Compress -Depth 5) -Jar $jar
                            if ($pr.Http -ne '201' -and $pr.Http -ne '200') { Sl-Fail $pr 'create item' }
                            $sapCode = "$(($pr.Body | ConvertFrom-Json).ItemCode)"
                            if (-not $sapCode) { throw 'SAP created the item but returned no ItemCode' }
                            $entry.action = 'created in SAP'
                            $result.created++; $result.changed++
                        }
                        if ($payload.Contains('ItemCode') -and "$($g.prefix)") { $nextFor["$($g.prefix)"]++ }
                    }
                    $entry.sap_code = $sapCode

                    if (-not $DryRun) {
                        $erpCode = '{0}-{1}' -f $abbr, (Norm $sapCode)
                        $entry.erp_item = $erpCode
                        $exists = @((Erp-List 'Item' @('name') ('[["name","=",' + (ConvertTo-Json -InputObject $erpCode -Compress) + ']]'))).Count -gt 0
                        if (-not $exists) {
                            $doc = [ordered]@{
                                item_code = $erpCode; item_name = $name; description = $name; item_group = 'Maintenance Store'
                                stock_uom = "$($c.uom)"; is_stock_item = 1; include_item_in_manufacturing = 0; is_purchase_item = 1; is_sales_item = 0
                                custom_sap_item_code = (Norm $sapCode); custom_sap_item_group = "$($g.name)"
                                custom_sap_sub_type_a = (Norm $c.sap_sub_type_a); custom_sap_sub_type_b = (Norm $c.sap_sub_type_b)
                                custom_sap_foreign_name = (Norm $c.foreign_name); custom_sap_hsn_code = (Digits $c.hsn_code); custom_sap_tax_rate = (Norm $c.tax_rate)
                                custom_sap_category_pending = 0; custom_sap_category_synced_at = (Now-Ist)
                                safety_stock = [double]("0$($c.min_stock)")
                                item_defaults = @(@{ doctype = 'Item Default'; company = $companyByAbbr[$abbr]; default_warehouse = $storeByAbbr[$abbr] })
                            }
                            if ((Norm $c.brand)) { $doc.brand = Norm $c.brand }
                            $null = Erp-Send POST (Res 'Item' '') $doc
                        }
                        $null = Erp-Send PUT (Res 'CMMS Item Naming Request' $c.name) @{ erp_item = $erpCode; sap_item_code = (Norm $sapCode); sap_create_status = 'Created'; sap_create_error = ''; pushed_at = (Now-Ist); sap_response = ("{0} in {1} by the item master sync" -f $entry.action, $db) }
                        $fresh = (Erp-Get (Res 'CMMS Item Naming Request' $c.name)).data
                        $null = Erp-Send POST '/api/method/frappe.model.workflow.apply_workflow' @{ doc = $fresh; action = 'Mark In SAP' }

                        # Stock already on the shelf: a nil-value stock addition, posted in PASS C of this same run.
                        $oq = [double]("0$($c.opening_qty)")
                        if ($oq -gt 0) {
                            $sa = (Erp-Send POST (Res 'CMMS Goods Receipt' '') @{
                                kind = 'Stock Addition'; company = $abbr; status = 'Queued'; raised_by = "$($c.raised_by)"; raised_at = (Now-Ist)
                                naming_request = "$($c.name)"; remarks = 'Opening stock of a new item: no bill, nil value.'
                                lines = @(@{ doctype = 'CMMS Goods Receipt Line'; item = $erpCode; item_name = $name; sap_item_code = (Norm $sapCode); qty = $oq; rate = 0; uom = "$($c.uom)"; warehouse = $whOf })
                            }).data
                            Log INFO ("{0}: opening stock {1} queued as {2}" -f $c.name, $oq, $sa.name)
                            if ($postReceipts) { [void]$w.receipts.Add($sa) }
                        }
                    }
                    Log INFO ("{0} [{1}]: {2} {3} {4}" -f $c.name, $db, $entry.action, $entry.sap_code, $(if ($DryRun -and $entry.payload) { ($entry.payload | ConvertTo-Json -Compress -Depth 5) } else { '' }))
                } catch {
                    $entry.action = 'failed'; $entry.error = $_.Exception.Message; $result.failures++
                    Log ERROR ("{0} [{1}]: {2}" -f $c.name, $db, $entry.error)
                    if (-not $DryRun) { try { $null = Erp-Send PUT (Res 'CMMS Item Naming Request' $c.name) @{ sap_create_status = 'Failed'; sap_create_error = $entry.error.Substring(0, [Math]::Min(500, $entry.error.Length)) } } catch { Log WARN "could not record the failure on $($c.name): $($_.Exception.Message)" } }
                }
                $result.items += [pscustomobject]$entry
            }

            # ---------------- PASS B: edit
            foreach ($it in $w.edits) {
                $code = "$($it.custom_sap_item_code)"
                $entry = [ordered]@{ kind = 'edit'; item = "$($it.name)"; sap_db = $db; sap_code = $code; action = ''; changes = @{}; error = '' }
                try {
                    if (-not $code.Trim()) { throw 'no custom_sap_item_code' }
                    $g = $groupOf[(Norm $it.custom_sap_item_group).ToLower()]
                    if (-not $g) { throw ("'{0}' is not an engineering item group of {1}" -f $it.custom_sap_item_group, $db) }
                    # Each field: what SAP should hold, and how to read it off the ERPNext Item (for the
                    # "edited again meanwhile?" check). Only $editFields are compared or sent.
                    $spec = [ordered]@{
                        ItemName       = @{ want = { Norm $args[0].item_name } }
                        ForeignName    = @{ want = { Norm $args[0].custom_sap_foreign_name } }
                        ChapterID      = @{ want = { [int](Chapter-Of $args[0].custom_sap_hsn_code) } }
                        U_TaxRate      = @{ want = { Norm $args[0].custom_sap_tax_rate } }
                        MinInventory   = @{ want = { [double]("0$($args[0].safety_stock)") } }
                        ItemsGroupCode = @{ want = { $gg = $groupOf[(Norm $args[0].custom_sap_item_group).ToLower()]; if ($gg) { [int]$gg.code } else { -1 } } }
                        U_SubTypeA     = @{ want = { Norm $args[0].custom_sap_sub_type_a } }
                        U_SubTypeB     = @{ want = { Norm $args[0].custom_sap_sub_type_b } }
                    }
                    $want = [ordered]@{}; foreach ($k in $editFields) { $want[$k] = & $spec[$k].want $it }
                    if ($want.Contains('ItemName') -and (-not $want.ItemName -or $want.ItemName.Length -gt 100)) { throw 'the description is empty or longer than SAP allows (100)' }
                    if (($want.Contains('U_SubTypeA') -and $want.U_SubTypeA.Length -gt 50) -or ($want.Contains('U_SubTypeB') -and $want.U_SubTypeB.Length -gt 50)) { throw 'SubType A/B is longer than SAP allows (50)' }
                    $r = Invoke-Sl -Method GET -Url ((Key-Url $code) + '?$select=ItemCode,' + ($editFields -join ',') + $(if ($editFields -contains 'MinInventory') { ',ManageStockByWarehouse' } else { '' }) + $(if ($editFields -contains 'ChapterID') { ',GSTRelevnt' } else { '' })) -Jar $jar
                    if ($r.Http -ne '200') { Sl-Fail $r 'read item' }
                    $cur = $r.Body | ConvertFrom-Json
                    $patch = [ordered]@{}
                    foreach ($k in $want.Keys) {
                        $a = $cur.$k; $b = $want[$k]
                        $same = if ($b -is [int] -or $b -is [double]) { $da = if ("$a" -match '^\s*$') { 0 } else { [double]$a }; $da -eq [double]$b -or ("$a" -eq "$b") } else { (Norm $a) -ceq $b }
                        if ($k -eq 'ChapterID' -and [int]$b -eq -1 -and ($(if ("$a" -match '^\s*$') { 0 } else { [int]$a }) -le 0)) { $same = $true }
                        if (-not $same) { $patch[$k] = $b; $entry.changes[$k] = @{ from = "$a"; to = "$b" } }
                    }
                    # SAP keeps an HSN only on a GST-relevant item: with GSTRelevnt = tNO it accepts the PATCH and drops
                    # ChapterID (ENG-932, 19-20 Oct 2026; reproduced in the demo company). mark_gst_relevant sends the
                    # values PASS A creates items with; otherwise say why, instead of the read-back mismatch.
                    if ($patch.Contains('ChapterID') -and [int]$patch.ChapterID -ne -1 -and "$($cur.GSTRelevnt)" -ne 'tYES') {
                        if (-not $markGst) { throw ("SAP item {0} is not GST-relevant (GSTRelevnt = {1}), so SAP would drop its HSN - turn on mark_gst_relevant, or tick GST on the item in SAP" -f $code, $cur.GSTRelevnt) }
                        $patch['GSTRelevnt'] = 'tYES'; $patch['GSTTaxCategory'] = 'gtc_Regular'
                        $entry.changes['GSTRelevnt'] = @{ from = "$($cur.GSTRelevnt)"; to = 'tYES' }
                    }
                    if ($patch.Count -eq 0) { $entry.action = 'already in SAP' }
                    elseif ($DryRun) { $entry.action = 'would patch' }
                    else {
                        # No If-Match: SAP answers 412 (-2039) to the etag its own GET returns, and every row carries
                        # the same constant etag, so it guards nothing (found 10 Oct 2026). The read just above is the
                        # guard, and the "edited again meanwhile" check below.
                        $body = [ordered]@{}; foreach ($k in $patch.Keys) { $body[$k] = $patch[$k] }
                        # Minimum stock of an item managed by warehouse lives on its warehouse row; SAP mirrors it
                        # back to the item-level MinInventory, which the read-back below checks.
                        if ($body.Contains('MinInventory') -and "$($cur.ManageStockByWarehouse)" -eq 'tYES') {
                            $body.Remove('MinInventory')
                            $body.ItemWarehouseInfoCollection = @(@{ WarehouseCode = $whOf; MinimalStock = [double]$patch.MinInventory })
                        }
                        $pr = Invoke-Sl -Method PATCH -Url (Key-Url $code) -Body ($body | ConvertTo-Json -Compress -Depth 5) -Jar $jar
                        if ($pr.Http -ne '204' -and $pr.Http -ne '200') { Sl-Fail $pr 'PATCH' }
                        $v = (Invoke-Sl -Method GET -Url ((Key-Url $code) + '?$select=' + (($patch.Keys) -join ',')) -Jar $jar).Body | ConvertFrom-Json
                        foreach ($k in $patch.Keys) { $vk = "$($v.$k)"; $pk = "$($patch[$k])"; if ($vk -ne $pk -and ([double]$(if ($vk.Trim()) { $vk } else { '0' })) -ne ([double]$(if ("$pk".Trim()) { "$pk" } else { '0' }))) { throw "SAP accepted the PATCH but reads back $k = '$vk'" } }
                        $entry.action = 'patched'; $result.changed++
                    }
                    if (-not $DryRun) {
                        $now = (Erp-Get (Res 'Item' $it.name)).data
                        $still = $true
                        foreach ($k in $editFields) { $x = & $spec[$k].want $now; if ("$x" -cne "$($want[$k])") { $still = $false } }
                        if ($still) { $null = Erp-Send PUT (Res 'Item' $it.name) @{ custom_sap_category_pending = 0; custom_sap_category_synced_at = (Now-Ist); custom_sap_category_error = '' } }
                        else { $entry.action += ' (edited again meanwhile - left pending)' }
                    }
                    Log INFO ("{0} [{1}]: {2} {3}" -f $it.name, $db, $entry.action, (($entry.changes.Keys | ForEach-Object { "$_ '$($entry.changes[$_].from)' -> '$($entry.changes[$_].to)'" }) -join '; '))
                } catch {
                    $entry.action = 'failed'; $entry.error = $_.Exception.Message; $result.failures++
                    Log ERROR ("{0} [{1}]: {2}" -f $it.name, $db, $entry.error)
                    # The item carries an HSN that may not have reached SAP: hold its goods receipts (PASS C).
                    if ($editFields -contains 'ChapterID' -and (Digits $it.custom_sap_hsn_code)) { $hsnEditFailed["$($it.name)"] = $entry.error }
                    if (-not $DryRun) { try { $null = Erp-Send PUT (Res 'Item' $it.name) @{ custom_sap_category_error = $entry.error.Substring(0, [Math]::Min(500, $entry.error.Length)) } } catch { Log WARN "could not record the error on $($it.name): $($_.Exception.Message)" } }
                }
                $result.items += [pscustomobject]$entry
            }

            # ---------------- PASS C: receipts (post_receipts)
            #   Goods Receipt  -> GRPO (PurchaseDeliveryNotes) against the PO lines, as the store did in SAP:
            #                     NumAtCard = bill no., TaxDate = bill date, DocDate = today; price and tax from the PO.
            #   Stock Addition -> Goods Receipt (InventoryGenEntries) at price 0.
            # Reference2 = "GR<yy>-<n>" (the CMMS receipt number) makes a re-run adopt instead of posting twice.
            # Then the same quantity goes into the company's ERPNext store (Material Receipt at the line rate).
            # Nil-valued stock (revalue_nil_stock) is revalued to the GR price first, in SAP and in ERPNext, so the
            # receipt replaces the nil value rather than averaging into it.
            foreach ($rc in $w.receipts) {
                $entry = [ordered]@{ kind = 'receipt'; receipt = "$($rc.name)"; type = "$($rc.kind)"; sap_db = $db; action = ''; sap_doc = ''; revaluation = ''; erp = ''; error = '' }
                $sapDone = $false; $docEntry = $null; $docNum = ''
                # Held, not posted, while an HSN its lines brought is not in SAP yet (PASS H request not Created, or
                # the item's HSN edit failed in this run): left Queued with the reason, posted on a later run.
                if ("$($rc.kind)" -eq 'Goods Receipt') {
                    $waits = @()
                    foreach ($hq in @($hsnReqs | Where-Object { "$($_.goods_receipt)" -eq "$($rc.name)" })) {
                        $st = $hsnState["$($hq.name)"]
                        if ($st -ne 'Created') { $waits += ("HSN {0} ({1}) is {2}{3}" -f (Digits $hq.hsn_code), $hq.name, $st, $(if ($st -eq 'Failed' -and "$($hq.error)".Trim()) { ': ' + "$($hq.error)".Trim() } else { '' })) }
                    }
                    foreach ($l in @($rc.lines)) { if ($hsnEditFailed.ContainsKey("$($l.item)")) { $waits += ("HSN of {0} not set in SAP: {1}" -f $l.item, $hsnEditFailed["$($l.item)"]) } }
                    if ($waits.Count) {
                        $why = 'waiting for HSN in SAP - ' + ($waits -join ' | ')
                        $entry.action = 'held'; $entry.error = $why
                        Log WARN ("{0} [{1}]: held, not posted - {2}" -f $rc.name, $db, $why)
                        if (-not $DryRun) { try { $null = Erp-Send PUT (Res 'CMMS Goods Receipt' $rc.name) @{ error = $why.Substring(0, [Math]::Min(500, $why.Length)) } } catch { Log WARN "could not record the hold on $($rc.name): $($_.Exception.Message)" } }
                        $result.items += [pscustomobject]$entry
                        continue
                    }
                }
                try {
                    $lines = @($rc.lines)
                    if (-not $lines.Count) { throw 'the receipt has no lines' }
                    $isGr = "$($rc.kind)" -eq 'Goods Receipt'
                    $m = [regex]::Match("$($rc.name)", '\d{2}(\d{2})-(\d+)$')
                    $stamp = if ($m.Success) { 'GR{0}-{1}' -f $m.Groups[1].Value, $m.Groups[2].Value } else { "$($rc.name)" }
                    $entity = if ($isGr) { 'PurchaseDeliveryNotes' } else { 'InventoryGenEntries' }
                    $lineWh = { param($l, $fallback) if ("$($l.warehouse)".Trim()) { "$($l.warehouse)".Trim() } else { $fallback } }

                    $found = Sl-All ("{0}?`$select=DocEntry,DocNum&`$filter=Reference2 eq '{1}'" -f $entity, $stamp) $jar
                    if ($found.Count -gt 0) { $docEntry = [int]$found[0].DocEntry; $docNum = "$($found[0].DocNum)"; $entry.action = 'adopted (already in SAP)'; $sapDone = $true }
                    else {
                        if ($isGr) {
                            $poEntry = [int]$rc.sap_po_entry
                            $pr = Invoke-Sl -Method GET -Url ("$slBase/PurchaseOrders({0})?`$select=DocEntry,DocNum,CardCode,DocumentStatus,DocumentLines" -f $poEntry) -Jar $jar
                            if ($pr.Http -ne '200') { Sl-Fail $pr "read PO $poEntry" }
                            $po = $pr.Body | ConvertFrom-Json
                            if ("$($po.DocumentStatus)" -ne 'bost_Open') { throw "PO $($po.DocNum) is closed in SAP" }
                            if ("$($po.CardCode)" -ne "$($rc.vendor_code)") { throw "PO $($po.DocNum) is for vendor $($po.CardCode) in SAP, not $($rc.vendor_code)" }
                            $docLines = @()
                            foreach ($l in $lines) {
                                $pl = @($po.DocumentLines | Where-Object { [int]$_.LineNum -eq [int]$l.po_line })
                                if (-not $pl.Count) { throw "PO $($po.DocNum) has no line $($l.po_line)" }
                                $pl = $pl[0]
                                if ((Norm $pl.ItemCode) -ne (Norm $l.sap_item_code)) { throw "PO $($po.DocNum) line $($l.po_line) is $($pl.ItemCode), not $($l.sap_item_code)" }
                                if ("$($pl.LineStatus)" -ne 'bost_Open' -or [double]$pl.RemainingOpenQuantity -lt [double]$l.qty) {
                                    throw ("PO {0} line {1} ({2}) has {3} open in SAP; the receipt is for {4}" -f $po.DocNum, $l.po_line, $pl.ItemCode, $pl.RemainingOpenQuantity, $l.qty)
                                }
                                $docLines += [ordered]@{ BaseType = 22; BaseEntry = $poEntry; BaseLine = [int]$l.po_line; Quantity = [double]$l.qty; WarehouseCode = (& $lineWh $l "$($pl.WarehouseCode)") }
                            }

                            if ($revalueNil) {
                                $reval = @()
                                foreach ($l in $lines) {
                                    if ([double]$l.rate -le 0) { continue }
                                    $wh = & $lineWh $l $whOf
                                    $ir = Invoke-Sl -Method GET -Url ((Key-Url "$($l.sap_item_code)") + '?$select=ItemCode,ItemWarehouseInfoCollection') -Jar $jar
                                    if ($ir.Http -ne '200') { Sl-Fail $ir "read item $($l.sap_item_code)" }
                                    $wi = @(($ir.Body | ConvertFrom-Json).ItemWarehouseInfoCollection | Where-Object { "$($_.WarehouseCode)" -eq $wh })
                                    if ($wi.Count -and [double]$wi[0].InStock -gt 0 -and [double]$wi[0].StandardAveragePrice -eq 0 -and -not @($reval | Where-Object { $_.ItemCode -eq "$($l.sap_item_code)" -and $_.WarehouseCode -eq $wh }).Count) {
                                        $reval += [ordered]@{ ItemCode = "$($l.sap_item_code)"; WarehouseCode = $wh; Price = [double]$l.rate }
                                    }
                                }
                                if ($reval.Count) {
                                    $rv = [ordered]@{ DocDate = $today; RevalType = 'P'; Comments = ("CMMS {0}: nil-valued stock revalued to the goods receipt price before receiving." -f $rc.name); MaterialRevaluationLines = $reval }
                                    if ($DryRun) { $entry.revaluation = 'would revalue ' + (($reval | ForEach-Object { "$($_.ItemCode)@$($_.WarehouseCode)=$($_.Price)" }) -join ', ') }
                                    else {
                                        $vr = Invoke-Sl -Method POST -Url "$slBase/MaterialRevaluation" -Body ($rv | ConvertTo-Json -Compress -Depth 5) -Jar $jar
                                        if ($vr.Http -ne '201' -and $vr.Http -ne '200') { Sl-Fail $vr 'revalue nil-valued stock' }
                                        $entry.revaluation = "$(($vr.Body | ConvertFrom-Json).DocNum)"
                                        $null = Erp-Send PUT (Res 'CMMS Goods Receipt' $rc.name) @{ sap_revaluation = $entry.revaluation }
                                    }
                                }
                            }
                            $payload = [ordered]@{
                                CardCode = "$($rc.vendor_code)"; DocDate = $today; TaxDate = "$($rc.bill_date)"; NumAtCard = "$($rc.bill_no)"; Reference2 = $stamp
                                Comments = ("Based On Purchase Orders {0}. CMMS {1}." -f $po.DocNum, $rc.name); DocumentLines = $docLines
                            }
                        } else {
                            $docLines = @(foreach ($l in $lines) { [ordered]@{ ItemCode = "$($l.sap_item_code)"; Quantity = [double]$l.qty; WarehouseCode = (& $lineWh $l $whOf); UnitPrice = 0 } })
                            $payload = [ordered]@{ DocDate = $today; Reference2 = $stamp; Comments = ("CMMS {0}: stock added with no bill, at nil value." -f $rc.name); DocumentLines = $docLines }
                        }
                        if ($DryRun) { $entry.action = "would post $entity"; $entry.payload = $payload }
                        else {
                            $pr = Invoke-Sl -Method POST -Url "$slBase/$entity" -Body ($payload | ConvertTo-Json -Compress -Depth 6) -Jar $jar
                            if ($pr.Http -ne '201' -and $pr.Http -ne '200') { Sl-Fail $pr "post $entity" }
                            $doc = $pr.Body | ConvertFrom-Json
                            $docEntry = [int]$doc.DocEntry; $docNum = "$($doc.DocNum)"
                            $entry.action = "posted $entity"; $sapDone = $true; $result.changed++
                        }
                    }

                    if ($sapDone) {
                        $entry.sap_doc = $docNum
                        $null = Erp-Send PUT (Res 'CMMS Goods Receipt' $rc.name) @{ sap_doc_entry = $docEntry; sap_doc_number = $docNum }
                        if (-not "$($rc.erp_stock_entry)".Trim()) {
                            $store = $storeByAbbr[$abbr]; $company = $companyByAbbr[$abbr]
                            $recoItems = @()
                            if ($revalueNil) {
                                foreach ($l in $lines) {
                                    if ([double]$l.rate -le 0 -or @($recoItems | Where-Object { $_.item_code -eq "$($l.item)" }).Count) { continue }
                                    $bins = @(Erp-List 'Bin' @('actual_qty', 'valuation_rate') ('[["item_code","=",' + (ConvertTo-Json -InputObject "$($l.item)" -Compress) + '],["warehouse","=",' + (ConvertTo-Json -InputObject $store -Compress) + ']]'))
                                    if ($bins.Count -and [double]$bins[0].actual_qty -gt 0 -and [double]$bins[0].valuation_rate -eq 0) {
                                        $recoItems += @{ item_code = "$($l.item)"; warehouse = $store; qty = [double]$bins[0].actual_qty; valuation_rate = [double]$l.rate }
                                    }
                                }
                            }
                            $recoName = ''
                            if ($recoItems.Count) {
                                $reco = (Erp-Send POST (Res 'Stock Reconciliation' '') @{ company = $company; purpose = 'Stock Reconciliation'; posting_date = $today; set_posting_time = 1; docstatus = 1; items = $recoItems; remarks = "CMMS $($rc.name): nil-valued stock revalued to the goods receipt price" }).data
                                $recoName = "$($reco.name)"
                            }
                            $seItems = @(foreach ($l in $lines) { @{ item_code = "$($l.item)"; qty = [double]$l.qty; t_warehouse = $store; basic_rate = [double]$l.rate; conversion_factor = 1; allow_zero_valuation_rate = $(if ([double]$l.rate -le 0) { 1 } else { 0 }) } })
                            $se = (Erp-Send POST (Res 'Stock Entry' '') @{
                                stock_entry_type = 'Material Receipt'; purpose = 'Material Receipt'; company = $company; posting_date = $today; set_posting_time = 1; docstatus = 1
                                remarks = $(if ($isGr) { "CMMS $($rc.name): GRPO $docNum against PO $($rc.sap_po_number), bill $($rc.bill_no)" } else { "CMMS $($rc.name): SAP Goods Receipt $docNum, no bill, nil value" })
                                items = $seItems
                            }).data
                            foreach ($l in $lines) {
                                if ([double]$l.rate -le 0) { continue }
                                $cur = (Erp-Get ((Res 'Item' "$($l.item)") + '?fields=["valuation_rate"]')).data
                                if ([double]("0$($cur.valuation_rate)") -eq 0) { $null = Erp-Send PUT (Res 'Item' "$($l.item)") @{ valuation_rate = [double]$l.rate } }
                            }
                            $entry.erp = "$($se.name)"
                            $null = Erp-Send PUT (Res 'CMMS Goods Receipt' $rc.name) @{ erp_stock_entry = "$($se.name)"; erp_reconciliation = $recoName }
                        }
                        $null = Erp-Send PUT (Res 'CMMS Goods Receipt' $rc.name) @{ status = 'Posted'; posted_at = (Now-Ist); error = '' }
                        $result['receipts']++
                    }
                    Log INFO ("{0} [{1}] {2}: {3} {4}{5}{6}" -f $rc.name, $db, $rc.kind, $entry.action, $entry.sap_doc, $(if ($entry.revaluation) { " revaluation $($entry.revaluation)" } else { '' }), $(if ($DryRun -and $entry.Contains('payload')) { ' ' + ($entry.payload | ConvertTo-Json -Compress -Depth 6) } elseif ($entry.erp) { " ERPNext $($entry.erp)" } else { '' }))
                } catch {
                    $msg = $_.Exception.Message
                    if ($sapDone) { $msg = "Posted in SAP as $docNum, but ERPNext refused: $msg" }
                    $entry.action = 'failed'; $entry.error = $msg; $result.failures++
                    Log ERROR ("{0} [{1}]: {2}" -f $rc.name, $db, $msg)
                    if (-not $DryRun) { try { $null = Erp-Send PUT (Res 'CMMS Goods Receipt' $rc.name) @{ status = 'Failed'; error = $msg.Substring(0, [Math]::Min(500, $msg.Length)) } } catch { Log WARN "could not record the failure on $($rc.name): $($_.Exception.Message)" } }
                }
                $result.items += [pscustomobject]$entry
            }

            # ---------------- PASS F: spares issued to breakdowns (post_issues)
            # A SAP Goods Issue (InventoryGenExits) per CMMS issue, from the line's warehouse (the company's
            # engineering warehouse); Reference2 = "GI<yy>-<n>" (the CMMS issue number) makes a re-run adopt it.
            # Then the same quantity out of the company's ERPNext store (Material Issue). After PASS C, so stock
            # received this run is on the shelf first.
            foreach ($gi in $w.issues) {
                $entry = [ordered]@{ kind = 'issue'; issue = "$($gi.name)"; breakdown = "$($gi.breakdown)"; sap_db = $db; action = ''; sap_doc = ''; erp = ''; error = '' }
                $sapDone = $false; $docEntry = $null; $docNum = ''
                try {
                    $lines = @($gi.lines)
                    if (-not $lines.Count) { throw 'the issue has no lines' }
                    $m = [regex]::Match("$($gi.name)", '\d{2}(\d{2})-(\d+)$')
                    $stamp = if ($m.Success) { 'GI{0}-{1}' -f $m.Groups[1].Value, $m.Groups[2].Value } else { "$($gi.name)" }
                    $found = Sl-All ("InventoryGenExits?`$select=DocEntry,DocNum&`$filter=Reference2 eq '{0}'" -f $stamp) $jar
                    if ($found.Count -gt 0) { $docEntry = [int]$found[0].DocEntry; $docNum = "$($found[0].DocNum)"; $entry.action = 'adopted (already in SAP)'; $sapDone = $true }
                    else {
                        $comments = ("CMMS {0}: spares for breakdown {1} ({2}), by {3}." -f $gi.name, $gi.breakdown, $gi.machine, $gi.raised_by)
                        if ($comments.Length -gt 254) { $comments = $comments.Substring(0, 254) }
                        $docLines = @(foreach ($l in $lines) { [ordered]@{ ItemCode = "$($l.sap_item_code)"; Quantity = [double]$l.qty; WarehouseCode = $(if ("$($l.warehouse)".Trim()) { "$($l.warehouse)".Trim() } else { $whOf }) } })
                        $payload = [ordered]@{ DocDate = $today; Reference2 = $stamp; Comments = $comments; DocumentLines = $docLines }
                        if ($DryRun) { $entry.action = 'would post InventoryGenExits'; $entry.payload = $payload }
                        else {
                            $pr = Invoke-Sl -Method POST -Url "$slBase/InventoryGenExits" -Body ($payload | ConvertTo-Json -Compress -Depth 6) -Jar $jar
                            if ($pr.Http -ne '201' -and $pr.Http -ne '200') { Sl-Fail $pr 'post InventoryGenExits' }
                            $doc = $pr.Body | ConvertFrom-Json
                            $docEntry = [int]$doc.DocEntry; $docNum = "$($doc.DocNum)"
                            $entry.action = 'posted InventoryGenExits'; $sapDone = $true; $result.changed++
                        }
                    }

                    if ($sapDone) {
                        $entry.sap_doc = $docNum
                        $null = Erp-Send PUT (Res 'CMMS Goods Issue' $gi.name) @{ sap_doc_entry = $docEntry; sap_doc_number = $docNum }
                        if (-not "$($gi.erp_stock_entry)".Trim()) {
                            $store = $storeByAbbr[$abbr]; $company = $companyByAbbr[$abbr]
                            # allow_zero_valuation_rate: stock added with no bill is on the shelf at nil value.
                            $seItems = @(foreach ($l in $lines) { @{ item_code = "$($l.item)"; qty = [double]$l.qty; s_warehouse = $store; conversion_factor = 1; allow_zero_valuation_rate = 1 } })
                            $se = (Erp-Send POST (Res 'Stock Entry' '') @{
                                stock_entry_type = 'Material Issue'; purpose = 'Material Issue'; company = $company; posting_date = $today; set_posting_time = 1; docstatus = 1
                                remarks = "CMMS $($gi.name): SAP Goods Issue $docNum, spares for breakdown $($gi.breakdown)"
                                items = $seItems
                            }).data
                            $entry.erp = "$($se.name)"
                            $null = Erp-Send PUT (Res 'CMMS Goods Issue' $gi.name) @{ erp_stock_entry = "$($se.name)" }
                        }
                        $null = Erp-Send PUT (Res 'CMMS Goods Issue' $gi.name) @{ status = 'Posted'; posted_at = (Now-Ist); error = '' }
                        $result['issues']++
                    }
                    Log INFO ("{0} [{1}] breakdown {2}: {3} {4}{5}" -f $gi.name, $db, $gi.breakdown, $entry.action, $entry.sap_doc, $(if ($DryRun -and $entry.Contains('payload')) { ' ' + ($entry.payload | ConvertTo-Json -Compress -Depth 6) } elseif ($entry.erp) { " ERPNext $($entry.erp)" } else { '' }))
                } catch {
                    $msg = $_.Exception.Message
                    if ($sapDone) { $msg = "Posted in SAP as $docNum, but ERPNext refused: $msg" }
                    $entry.action = 'failed'; $entry.error = $msg; $result.failures++
                    Log ERROR ("{0} [{1}]: {2}" -f $gi.name, $db, $msg)
                    if (-not $DryRun) { try { $null = Erp-Send PUT (Res 'CMMS Goods Issue' $gi.name) @{ status = 'Failed'; error = $msg.Substring(0, [Math]::Min(500, $msg.Length)) } } catch { Log WARN "could not record the failure on $($gi.name): $($_.Exception.Message)" } }
                }
                $result.items += [pscustomobject]$entry
            }

            # ---------------- PASS D: purchase requests (post_purchase_requests)
            # A SAP Purchase Request (PurchaseRequests) per CMMS request, raised under $prRequester (ReqType 171 = employee),
            # the CMMS raiser and reason in Comments; Reference2 = "PR<yy>-<n>" makes a re-run adopt it.
            foreach ($pq in $w.prs) {
                $entry = [ordered]@{ kind = 'purchase request'; request = "$($pq.name)"; sap_db = $db; action = ''; sap_doc = ''; error = '' }
                try {
                    $lines = @($pq.lines)
                    if (-not $lines.Count) { throw 'the request has no lines' }
                    $m = [regex]::Match("$($pq.name)", '\d{2}(\d{2})-(\d+)$')
                    $stamp = if ($m.Success) { 'PR{0}-{1}' -f $m.Groups[1].Value, $m.Groups[2].Value } else { "$($pq.name)" }
                    $found = Sl-All ("PurchaseRequests?`$select=DocEntry,DocNum&`$filter=Reference2 eq '{0}'" -f $stamp) $jar
                    $prEntry = $null; $prNum = ''
                    if ($found.Count -gt 0) { $prEntry = [int]$found[0].DocEntry; $prNum = "$($found[0].DocNum)"; $entry.action = 'adopted (already in SAP)' }
                    else {
                        $comments = ("CMMS {0} by {1}: {2}" -f $pq.name, $pq.raised_by, (Norm $pq.reason))
                        if ($comments.Length -gt 254) { $comments = $comments.Substring(0, 254) }
                        $payload = [ordered]@{
                            DocDate = $today; RequriedDate = "$($pq.required_by)"; ReqType = 171; ReqCode = $prRequester
                            RequesterEmail = "$($pq.raised_by)"; Reference2 = $stamp; Comments = $comments
                            DocumentLines = @(foreach ($l in $lines) {
                                $ln = [ordered]@{ ItemCode = "$($l.sap_item_code)"; Quantity = [double]$l.qty; RequiredDate = "$($pq.required_by)"; WarehouseCode = $whOf }
                                if ((Norm $l.remarks)) { $ln.FreeText = (Norm $l.remarks) }
                                $ln
                            })
                        }
                        if ($opt.PSObject.Properties['pr_series'] -and [int]$opt.pr_series) { $payload['Series'] = [int]$opt.pr_series }
                        if ($DryRun) { $entry.action = 'would post PurchaseRequests'; $entry.payload = $payload }
                        else {
                            $pr = Invoke-Sl -Method POST -Url "$slBase/PurchaseRequests" -Body ($payload | ConvertTo-Json -Compress -Depth 6) -Jar $jar
                            if ($pr.Http -ne '201' -and $pr.Http -ne '200') { Sl-Fail $pr 'post PurchaseRequests' }
                            $doc = $pr.Body | ConvertFrom-Json
                            $prEntry = [int]$doc.DocEntry; $prNum = "$($doc.DocNum)"
                            $entry.action = 'posted PurchaseRequests'; $result.changed++
                        }
                    }
                    if ($prEntry) {
                        $entry.sap_doc = $prNum
                        $null = Erp-Send PUT (Res 'CMMS Purchase Request' $pq.name) @{ status = 'In SAP'; sap_doc_entry = $prEntry; sap_doc_number = $prNum; posted_at = (Now-Ist); error = '' }
                        [void]$w.openPrs.Add([pscustomobject]@{ name = "$($pq.name)"; company = $abbr; status = 'In SAP'; sap_doc_entry = $prEntry; po_numbers = '' })
                        $result['prs']++
                    }
                    Log INFO ("{0} [{1}]: {2} {3}{4}" -f $pq.name, $db, $entry.action, $entry.sap_doc, $(if ($DryRun -and $entry.Contains('payload')) { ' ' + ($entry.payload | ConvertTo-Json -Compress -Depth 6) } else { '' }))
                } catch {
                    $entry.action = 'failed'; $entry.error = $_.Exception.Message; $result.failures++
                    Log ERROR ("{0} [{1}]: {2}" -f $pq.name, $db, $entry.error)
                    if (-not $DryRun) { try { $null = Erp-Send PUT (Res 'CMMS Purchase Request' $pq.name) @{ status = 'Failed'; error = $entry.error.Substring(0, [Math]::Min(500, $entry.error.Length)) } } catch { Log WARN "could not record the failure on $($pq.name): $($_.Exception.Message)" } }
                }
                $result.items += [pscustomobject]$entry
            }

            # ---------------- PASS G: purchase orders made in the CMMS (post_purchase_orders)
            # One SAP Purchase Order per request, every line based on the SAP purchase request's line for the same
            # item, so SAP links the two and closes the request's lines as they are ordered. Reference2 =
            # "PO<yy>-<n>" makes a re-run adopt a PO posted before a failure to record it.
            foreach ($po in $w.orders) {
                $entry = [ordered]@{ kind = 'purchase order'; request = "$($po.name)"; sap_db = $db; action = ''; sap_doc = ''; error = '' }
                try {
                    if (-not $po.sap_doc_entry) { throw 'the request is not in SAP yet' }
                    if (-not "$($po.po_vendor_code)".Trim()) { throw 'no vendor' }
                    $ordered = @(@($po.lines) | Where-Object { [double]$_.po_qty -gt 0 })
                    if (-not $ordered.Count) { throw 'no line is ordered' }
                    $m = [regex]::Match("$($po.name)", '\d{2}(\d{2})-(\d+)$')
                    $stamp = if ($m.Success) { 'PO{0}-{1}' -f $m.Groups[1].Value, $m.Groups[2].Value } else { "PO-$($po.name)" }
                    $found = Sl-All ("PurchaseOrders?`$select=DocEntry,DocNum&`$filter=Reference2 eq '{0}'" -f $stamp) $jar
                    $poEntry = $null; $poNum = ''
                    if ($found.Count -gt 0) { $poEntry = [int]$found[0].DocEntry; $poNum = "$($found[0].DocNum)"; $entry.action = 'adopted (already in SAP)' }
                    else {
                        # The request's own lines, for BaseLine: matched by item, which is unique on a request.
                        $rq = Invoke-Sl -Method GET -Url ("$slBase/PurchaseRequests({0})?`$select=DocEntry,DocumentStatus,DocumentLines" -f [int]$po.sap_doc_entry) -Jar $jar
                        if ($rq.Http -ne '200') { Sl-Fail $rq 'read the purchase request' }
                        $rqDoc = $rq.Body | ConvertFrom-Json
                        if ("$($rqDoc.DocumentStatus)" -eq 'bost_Close') { throw 'SAP has closed the purchase request' }
                        $baseOf = @{}; foreach ($bl in @($rqDoc.DocumentLines)) { $baseOf["$($bl.ItemCode)".Trim()] = $bl }
                        $comments = ("CMMS {0} PO by {1}{2}" -f $po.name, $po.po_raised_by, $(if ((Norm $po.po_remarks)) { ': ' + (Norm $po.po_remarks) } else { '' }))
                        if ($comments.Length -gt 254) { $comments = $comments.Substring(0, 254) }
                        $payload = [ordered]@{
                            CardCode = "$($po.po_vendor_code)".Trim(); DocDate = "$($po.po_date)"; TaxDate = "$($po.po_date)"; DocDueDate = "$($po.po_due_date)"
                            Reference2 = $stamp; Comments = $comments
                            DocumentLines = @(foreach ($l in $ordered) {
                                $bl = $baseOf["$($l.sap_item_code)".Trim()]
                                if (-not $bl) { throw ("{0} is not on SAP purchase request {1}" -f $l.sap_item_code, $po.sap_doc_number) }
                                if ("$($bl.LineStatus)" -eq 'bost_Close') { throw ("{0}'s line on SAP purchase request {1} is already closed" -f $l.sap_item_code, $po.sap_doc_number) }
                                $ln = [ordered]@{ BaseType = 1470000113; BaseEntry = [int]$po.sap_doc_entry; BaseLine = [int]$bl.LineNum; Quantity = [double]$l.po_qty; UnitPrice = [double]$l.po_price }
                                if ((Norm $l.po_tax_code)) { $ln.TaxCode = (Norm $l.po_tax_code) }
                                $ln
                            })
                        }
                        if ($DryRun) { $entry.action = 'would post PurchaseOrders'; $entry.payload = $payload }
                        else {
                            $pr = Invoke-Sl -Method POST -Url "$slBase/PurchaseOrders" -Body ($payload | ConvertTo-Json -Compress -Depth 6) -Jar $jar
                            if ($pr.Http -ne '201' -and $pr.Http -ne '200') { Sl-Fail $pr 'post PurchaseOrders' }
                            $doc = $pr.Body | ConvertFrom-Json
                            $poEntry = [int]$doc.DocEntry; $poNum = "$($doc.DocNum)"
                            $entry.action = 'posted PurchaseOrders'; $result.changed++
                        }
                    }
                    if ($poEntry) {
                        $entry.sap_doc = $poNum
                        $null = Erp-Send PUT (Res 'CMMS Purchase Request' $po.name) @{ po_status = 'Posted'; po_doc_entry = $poEntry; po_doc_number = $poNum; po_error = '' }
                        $result['pos']++
                    }
                    Log INFO ("{0} [{1}]: {2} {3}{4}" -f $po.name, $db, $entry.action, $entry.sap_doc, $(if ($DryRun -and $entry.Contains('payload')) { ' ' + ($entry.payload | ConvertTo-Json -Compress -Depth 6) } else { '' }))
                } catch {
                    $entry.action = 'failed'; $entry.error = $_.Exception.Message; $result.failures++
                    Log ERROR ("{0} [{1}] PO: {2}" -f $po.name, $db, $entry.error)
                    if (-not $DryRun) { try { $null = Erp-Send PUT (Res 'CMMS Purchase Request' $po.name) @{ po_status = 'Failed'; po_error = $entry.error.Substring(0, [Math]::Min(500, $entry.error.Length)) } } catch { Log WARN "could not record the failure on $($po.name): $($_.Exception.Message)" } }
                }
                $result.items += [pscustomobject]$entry
            }

            # ---------------- PASS E: fetch from SAP (pull_from_sap) - the engineering item groups only
            # Items in this company's engineering groups: one SAP has that the CMMS lacks is created in ERPNext
            # (e.g. ENG-437..439, made in SAP on 30 Sep); a SAP-side change to name, groups, HSN, tax, minimum or
            # active state is copied - unless the CMMS has an edit of its own waiting (PASS B sends that one).
            # An item moved out of the engineering groups in SAP is disabled here. Then the on-hand quantity:
            # SAP's QuantityOnStock against the company's ERPNext store, and the differences posted as one Stock
            # Reconciliation (absolute quantities, current valuation kept) - the same measure the 24 Sep opening
            # stock used. Runs after PASS C, so a receipt posted this run is already on both sides.
            if ($pullFromSap) {
                try {
                    function To-Int($v) { try { [int]"$v" } catch { 0 } }
                    $gcodes = @($opt.groups | ForEach-Object { [int]$_.code })
                    $groupName = @{}; foreach ($g in $opt.groups) { $groupName[[int]$g.code] = "$($g.name)" }
                    $chapterDigits = @{}; foreach ($k in $hsn.Keys) { $chapterDigits[[int]$hsn[$k]] = $k }
                    $wholeUoms = @('Nos', 'Set', 'Pair', 'Box', 'Packet', 'Unit', 'Roll')
                    $uomOf = @{ NOS = 'Nos'; NO = 'Nos'; PCS = 'Nos'; PC = 'Nos'; EACH = 'Nos'; EA = 'Nos'; KG = 'Kg'; KGS = 'Kg'; MTR = 'Meter'; M = 'Meter'; MTRS = 'Meter'; LTR = 'Litre'; L = 'Litre'; LTRS = 'Litre'; SET = 'Set'; SETS = 'Set'; PAIR = 'Pair'; ROLL = 'Roll'; BOX = 'Box'; PKT = 'Packet'; PACKET = 'Packet'; UNIT = 'Unit'; UNITS = 'Unit' }
                    if (-not $mirrorAll.ContainsKey($abbr)) { $mirrorAll[$abbr] = @{} }
                    if (-not $mirror.ContainsKey($abbr)) { $mirror[$abbr] = @{} }
                    $mine = $mirrorAll[$abbr]
                    $filter = (($gcodes | ForEach-Object { "ItemsGroupCode eq $_" }) -join ' or ')
                    # Not @(...): Sl-All returns its rows as ONE object (", $rows"), so @() made a one-element list holding the whole page and the loop below saw a single "item" (found 13 Oct 2026, the first run with pull_from_sap on).
                    $sapItems = (Sl-All ("Items?`$select=ItemCode,ItemName,ForeignName,ItemsGroupCode,U_SubTypeA,U_SubTypeB,ChapterID,U_TaxRate,MinInventory,InventoryUOM,Valid,Frozen,InventoryItem,QuantityOnStock&`$filter={0}" -f $filter) $jar)
                    $nNew = 0; $nUpd = 0; $nOff = 0; $seen = @{}
                    foreach ($si in $sapItems) {
                        $code = "$($si.ItemCode)".Trim(); $seen[$code] = $true
                        $active = "$($si.Valid)" -eq 'tYES' -and "$($si.Frozen)" -ne 'tYES'
                        $ch = To-Int $si.ChapterID
                        # ERPNext's item_name holds 140 characters, SAP's ItemName 200 (MRPPL-ENG-141 has ~170): cut it,
                        # and keep the full name in the description, as the 24 Sep import did.
                        $fullName = Norm $si.ItemName
                        $sapUom = $uomOf["$($si.InventoryUOM)".Trim().ToUpper()]; if (-not $sapUom) { $sapUom = 'Nos' }
                        $want = [ordered]@{
                            item_name = (Norm $(if ($fullName.Length -gt 140) { $fullName.Substring(0, 140) } else { $fullName })); custom_sap_item_group = $groupName[[int]$si.ItemsGroupCode]
                            custom_sap_sub_type_a = (Norm $si.U_SubTypeA); custom_sap_sub_type_b = (Norm $si.U_SubTypeB)
                            custom_sap_foreign_name = (Norm $si.ForeignName)
                            custom_sap_hsn_code = $(if ($ch -gt 0 -and $chapterDigits.ContainsKey($ch)) { $chapterDigits[$ch] } else { '' })
                            custom_sap_tax_rate = (Norm $si.U_TaxRate); safety_stock = [double]("0$($si.MinInventory)")
                            stock_uom = $sapUom
                            disabled = $(if ($active) { 0 } else { 1 })
                        }
                        $it = $mine[$code]
                        if (-not $it) {
                            if (-not $active) { continue }
                            $erpCode = '{0}-{1}' -f $abbr, $code
                            $uom = $uomOf["$($si.InventoryUOM)".Trim().ToUpper()]; if (-not $uom) { $uom = 'Nos' }
                            $doc = [ordered]@{
                                item_code = $erpCode; description = $fullName; item_group = 'Maintenance Store'; stock_uom = $uom
                                is_stock_item = $(if ("$($si.InventoryItem)" -eq 'tYES') { 1 } else { 0 }); include_item_in_manufacturing = 0; is_purchase_item = 1; is_sales_item = 0
                                custom_sap_item_code = $code; custom_sap_category_pending = 0; custom_sap_category_synced_at = (Now-Ist)
                                item_defaults = @(@{ doctype = 'Item Default'; company = $companyByAbbr[$abbr]; default_warehouse = $storeByAbbr[$abbr] })
                            }
                            foreach ($k in $want.Keys) { $doc[$k] = $want[$k] }
                            if (-not $DryRun) { $null = Erp-Send POST (Res 'Item' '') $doc }
                            $obj = [pscustomobject]@{ name = $erpCode; item_name = $want.item_name; custom_sap_item_code = $code; disabled = 0; stock_uom = $uom; custom_sap_category_pending = 0 }
                            $mine[$code] = $obj; $mirror[$abbr][$code] = $obj
                            $nNew++
                            Log INFO ("{0} [{1}]: {2} new from SAP - {3}" -f $erpCode, $db, $(if ($DryRun) { 'would add' } else { 'added' }), $want.item_name)
                            continue
                        }
                        if ((To-Int $it.custom_sap_category_pending) -eq 1) { continue }
                        $diff = [ordered]@{}
                        foreach ($k in $want.Keys) {
                            $a = $it.$k; $b = $want[$k]
                            $same = if ($k -in 'safety_stock', 'disabled') { [double]("0$a") -eq [double]$b } else { (Norm $a) -ceq "$b" }
                            if (-not $same) { $diff[$k] = $b }
                        }
                        if ($diff.Count) {
                            if ($diff.Contains('item_name')) { $diff.description = $fullName }
                            if ($diff.Contains('stock_uom')) {
                                $newUom = $diff['stock_uom']
                                $diff['uoms'] = @(@{ doctype = 'UOM Conversion Detail'; uom = $newUom; conversion_factor = 1 })
                            }
                            if (-not $DryRun) {
                                try { $null = Erp-Send PUT (Res 'Item' "$($it.name)") $diff }
                                catch {
                                    if ($diff.Contains('stock_uom')) {
                                        Log WARN ("{0}: UOM change to {1} failed ({2}), retrying without UOM" -f $it.name, $diff['stock_uom'], $_.Exception.Message)
                                        $diff.Remove('stock_uom'); $diff.Remove('uoms')
                                        if ($diff.Count) { $null = Erp-Send PUT (Res 'Item' "$($it.name)") $diff }
                                    } else { throw }
                                }
                            }
                            if ($diff.Contains('disabled')) { if ($diff.disabled -eq 0) { $mirror[$abbr][$code] = $it } else { $mirror[$abbr].Remove($code) } }
                            $nUpd++
                            Log INFO ("{0} [{1}]: {2} from SAP - {3}" -f $it.name, $db, $(if ($DryRun) { 'would update' } else { 'updated' }), (($diff.Keys | Where-Object { $_ -ne 'description' }) -join ', '))
                        }
                    }
                    # Mirrored items SAP no longer files under an engineering group: disabled, on SAP's word only.
                    foreach ($code in @($mine.Keys)) {
                        $it = $mine[$code]
                        if ($seen.ContainsKey($code) -or (To-Int $it.disabled) -eq 1 -or (To-Int $it.custom_sap_category_pending) -eq 1) { continue }
                        $r = Invoke-Sl -Method GET -Url ((Key-Url $code) + '?$select=ItemCode,ItemsGroupCode') -Jar $jar
                        if ($r.Http -ne '200') { Log WARN ("{0} [{1}]: not in SAP any more (HTTP {2}) - left as it is" -f $it.name, $db, $r.Http); continue }
                        $grp = [int](($r.Body | ConvertFrom-Json).ItemsGroupCode)
                        if ($gcodes -contains $grp) { continue }
                        if (-not $DryRun) { $null = Erp-Send PUT (Res 'Item' "$($it.name)") @{ disabled = 1 } }
                        $mirror[$abbr].Remove($code); $nOff++
                        Log INFO ("{0} [{1}]: {2} - moved to SAP item group {3}, not an engineering group" -f $it.name, $db, $(if ($DryRun) { 'would disable' } else { 'disabled' }), $grp)
                    }

                    # On-hand quantity, SAP -> the company's ERPNext store.
                    $store = $storeByAbbr[$abbr]
                    $bins = @{}
                    foreach ($b in (Erp-List 'Bin' @('item_code', 'actual_qty') ('[["warehouse","=",' + (ConvertTo-Json -InputObject $store -Compress) + ']]'))) { $bins["$($b.item_code)"] = [double]$b.actual_qty }
                    $reco = New-Object System.Collections.ArrayList
                    foreach ($si in $sapItems) {
                        if ("$($si.InventoryItem)" -ne 'tYES' -or "$($si.Valid)" -ne 'tYES' -or "$($si.Frozen)" -eq 'tYES') { continue }
                        $it = $mine["$($si.ItemCode)".Trim()]
                        if (-not $it) { continue }
                        $sapQty = [double]$si.QuantityOnStock
                        $erpQty = if ($bins.ContainsKey("$($it.name)")) { $bins["$($it.name)"] } else { 0 }
                        if ([Math]::Abs($sapQty - $erpQty) -lt 1e-6) { continue }
                        if ($wholeUoms -contains "$($it.stock_uom)" -and $sapQty -ne [Math]::Floor($sapQty)) { Log WARN ("{0}: SAP holds {1} {2} - a fraction of a whole unit, quantity not fetched" -f $it.name, $sapQty, $it.stock_uom); continue }
                        [void]$reco.Add(@{ item_code = "$($it.name)"; warehouse = $store; qty = $sapQty; allow_zero_valuation_rate = 1 })
                    }
                    $recoNames = @()
                    if ($reco.Count -and -not $DryRun) {
                        for ($i = 0; $i -lt $reco.Count; $i += 100) {
                            $part = @($reco.GetRange($i, [Math]::Min(100, $reco.Count - $i)))
                            $rd = (Erp-Send POST (Res 'Stock Reconciliation' '') @{ company = $companyByAbbr[$abbr]; purpose = 'Stock Reconciliation'; posting_date = $today; set_posting_time = 1; docstatus = 1; items = $part }).data
                            $recoNames += "$($rd.name)"
                        }
                    }
                    $result['fetched'] += $nNew + $nUpd + $nOff + $reco.Count
                    Log INFO ("{0}: fetched from SAP - {1} engineering item(s): {2} new, {3} updated, {4} disabled; stock {5} for {6} item(s){7}" -f $db, $sapItems.Count, $nNew, $nUpd, $nOff, $(if ($DryRun) { 'would change' } else { 'changed' }), $reco.Count, $(if ($recoNames.Count) { ' (' + ($recoNames -join ', ') + ')' } else { '' }))
                } catch {
                    $result.failures++
                    Log ERROR ("{0}: fetch from SAP failed (line {2}): {1}" -f $db, $_.Exception.Message, $_.InvocationInfo.ScriptLineNumber)
                }
            }

            # ---------------- open PO lines for engineering items, for the CMMS goods receipt form
            # Read after PASS C, so a GRPO just posted is already off the open quantity. The same read finds the
            # POs raised from CMMS purchase requests: their lines carry BaseType 1470000113 (Purchase Request).
            $prToPo = @{}
            try {
                $codes = if ($mirror.ContainsKey($abbr)) { $mirror[$abbr] } else { @{} }
                $pos = New-Object System.Collections.ArrayList
                foreach ($po in (Sl-All "PurchaseOrders?`$select=DocEntry,DocNum,CardCode,CardName,DocDate,DocumentLines&`$filter=DocumentStatus eq 'bost_Open'" $jar)) {
                    $pl = New-Object System.Collections.ArrayList
                    foreach ($l in @($po.DocumentLines)) {
                        if ("$($l.BaseType)" -eq '1470000113' -and $l.BaseEntry) {
                            $k = [int]$l.BaseEntry
                            if (-not $prToPo.ContainsKey($k)) { $prToPo[$k] = New-Object System.Collections.ArrayList }
                            if (-not $prToPo[$k].Contains("$($po.DocNum)")) { [void]$prToPo[$k].Add("$($po.DocNum)") }
                        }
                        $code = "$($l.ItemCode)".Trim()
                        if (-not $codes.ContainsKey($code) -or "$($l.LineStatus)" -ne 'bost_Open' -or [double]$l.RemainingOpenQuantity -le 0) { continue }
                        [void]$pl.Add([ordered]@{ line = [int]$l.LineNum; sap_code = $code; item = "$($codes[$code].name)"; item_name = "$($codes[$code].item_name)"; open_qty = [double]$l.RemainingOpenQuantity; price = [double]$l.Price; tax_code = "$($l.TaxCode)"; warehouse = "$($l.WarehouseCode)"; uom = $(if ("$($l.UoMCode)" -eq 'Manual') { '' } else { "$($l.UoMCode)" }) })
                    }
                    if ($pl.Count) { [void]$pos.Add([ordered]@{ entry = [int]$po.DocEntry; number = "$($po.DocNum)"; vendor_code = "$($po.CardCode)"; vendor_name = "$($po.CardName)"; date = ("$($po.DocDate)" -replace 'T.*$', ''); lines = $pl.ToArray() }) }
                }
                $poSnapshot[$abbr] = [ordered]@{ company = "$($opt.company)"; sap_db = $db; refreshed_at = (Now-Ist); pos = $pos.ToArray() }
                Log INFO ("{0}: {1} open PO(s) with engineering lines" -f $db, $pos.Count)

                # Where each CMMS purchase request stands: Ordered once a PO is raised from it (its numbers are
                # kept after the PO is received and closed), Closed if SAP closed it with no PO. Written in a dry
                # run too: it only reports what SAP holds.
                # A PO it had that is no longer open was received, closed - or cancelled in SAP, which only this
                # read can see (PO 669, PR-2026-00323, cancelled 20 Oct 2026 and still Ordered here). A cancelled
                # one comes off the request; when every PO it had was cancelled, the request ends (the user, 20 Oct
                # 2026): Closed, not ordered again, and its SAP purchase request closed so it is not ordered there.
                foreach ($pq in $w.openPrs) {
                    try {
                        $known = @("$($pq.po_numbers)" -split '\s*,\s*' | Where-Object { $_ })
                        $new = if ($pq.sap_doc_entry -and $prToPo.ContainsKey([int]$pq.sap_doc_entry)) { @($prToPo[[int]$pq.sap_doc_entry]) } else { @() }
                        $cancelled = @()
                        foreach ($n in @($known | Where-Object { @($new) -notcontains $_ })) {
                            $doc = $null
                            if ("$n" -eq "$($pq.po_doc_number)" -and [int]("0$($pq.po_doc_entry)") -gt 0) {
                                $pr = Invoke-Sl -Method GET -Url ("$slBase/PurchaseOrders({0})?`$select=DocEntry,DocNum,Cancelled" -f [int]$pq.po_doc_entry) -Jar $jar
                                if ($pr.Http -eq '200') { $doc = $pr.Body | ConvertFrom-Json }
                            } else {
                                # DocNum repeats across numbering series, so the PO must also be based on this request.
                                $hits = Sl-All ("PurchaseOrders?`$select=DocEntry,DocNum,Cancelled,DocumentLines&`$filter=DocNum eq {0}" -f [int]$n) $jar
                                $doc = @($hits | Where-Object { @($_.DocumentLines | Where-Object { "$($_.BaseType)" -eq '1470000113' -and [int]("0$($_.BaseEntry)") -eq [int]$pq.sap_doc_entry }).Count }) | Select-Object -First 1
                            }
                            if ($doc -and "$($doc.Cancelled)" -eq 'tYES') { $cancelled += "$n" }
                        }
                        $all = @(@($known) + @($new) | Select-Object -Unique | Where-Object { $cancelled -notcontains $_ })
                        $status = if ($all.Count) { 'Ordered' } else { 'In SAP' }
                        $edit = [ordered]@{}
                        if ($cancelled.Count -and -not $all.Count) {
                            $status = 'Closed'
                            $all = @($known)   # the numbers stay, for the record
                            $edit.error = ("SAP PO {0} was cancelled in SAP - request closed {1}" -f ($cancelled -join ', '), (Now-Ist))
                            if ("$($pq.po_status)" -eq 'Posted' -and $cancelled -contains "$($pq.po_doc_number)") { $edit.po_status = 'Cancelled' }
                            if (-not $DryRun -and $postPrs -and $pq.sap_doc_entry) {
                                $rr = Invoke-Sl -Method GET -Url ("$slBase/PurchaseRequests({0})?`$select=DocEntry,DocumentStatus" -f [int]$pq.sap_doc_entry) -Jar $jar
                                if ($rr.Http -eq '200' -and "$(($rr.Body | ConvertFrom-Json).DocumentStatus)" -eq 'bost_Open') {
                                    $cl = Invoke-Sl -Method POST -Url ("$slBase/PurchaseRequests({0})/Close" -f [int]$pq.sap_doc_entry) -Jar $jar
                                    if ($cl.Http -eq '204' -or $cl.Http -eq '200') { Log INFO ("{0} [{1}]: SAP purchase request {2} closed" -f $pq.name, $db, $pq.sap_doc_number) }
                                    else { Log WARN ("{0} [{1}]: SAP purchase request {2} not closed (HTTP {3}): {4} - close it in the SAP client" -f $pq.name, $db, $pq.sap_doc_number, $cl.Http, ("$($cl.Body)" -replace '\s+', ' ').Trim()) }
                                }
                            }
                        } elseif (-not $all.Count -and $pq.sap_doc_entry) {
                            $rr = Invoke-Sl -Method GET -Url ("$slBase/PurchaseRequests({0})?`$select=DocEntry,DocumentStatus" -f [int]$pq.sap_doc_entry) -Jar $jar
                            if ($rr.Http -eq '200' -and "$(($rr.Body | ConvertFrom-Json).DocumentStatus)" -eq 'bost_Close') { $status = 'Closed' }
                        }
                        $joined = $all -join ', '
                        if ($status -ne "$($pq.status)" -or $joined -ne "$($pq.po_numbers)" -or $edit.Count) {
                            $body = [ordered]@{ status = $status; po_numbers = $joined }; foreach ($k in $edit.Keys) { $body[$k] = $edit[$k] }
                            try { $null = Erp-Send PUT (Res 'CMMS Purchase Request' $pq.name) $body }
                            catch {
                                # po_status "Cancelled" exists once server/scripts/syncPurchasing.js has been run again;
                                # until then the request still ends, without it.
                                if (-not $body.Contains('po_status')) { throw }
                                Log WARN ("{0}: po_status Cancelled refused (run server/scripts/syncPurchasing.js?): {1}" -f $pq.name, $_.Exception.Message)
                                $body.Remove('po_status'); $null = Erp-Send PUT (Res 'CMMS Purchase Request' $pq.name) $body
                            }
                            Log INFO ("{0} [{1}]: {2}{3}{4}" -f $pq.name, $db, $status, $(if ($joined) { " - PO $joined" } else { '' }), $(if ($cancelled.Count) { " (cancelled in SAP: $($cancelled -join ', '))" } else { '' }))
                        }
                    } catch { Log WARN ("{0}: purchase request status not refreshed: {1}" -f $pq.name, $_.Exception.Message) }
                }
            } catch { Log WARN ("{0}: open PO lines not refreshed: {1}" -f $db, $_.Exception.Message) }

            # ---------------- suppliers and purchase tax codes, for the CMMS PO form (post_purchase_orders)
            # Hourly, or at once when there are POs to make: a supplier added in SAP this morning should be
            # pickable this morning, but reading every business partner on every run is wasted work.
            if ($postPos) {
                try {
                    $stale = $true
                    if ($opt.PSObject.Properties['vendors_refreshed_at'] -and "$($opt.vendors_refreshed_at)") {
                        try { $stale = ((Get-Date) - [datetime]::ParseExact("$($opt.vendors_refreshed_at)", 'yyyy-MM-dd HH:mm:ss', $null)).TotalMinutes -ge 60 } catch { $stale = $true }
                    }
                    if ($stale -or $w.orders.Count) {
                        $vend = @((Sl-All "BusinessPartners?`$select=CardCode,CardName&`$filter=CardType eq 'cSupplier' and Valid eq 'tYES' and Frozen eq 'tNO'&`$orderby=CardName" $jar) |
                            ForEach-Object { [ordered]@{ code = "$($_.CardCode)"; name = (Norm $_.CardName) } })
                        $taxes = @()
                        try { $taxes = @((Sl-All "SalesTaxCodes?`$select=Code,Name,Rate,Inactive" $jar) | Where-Object { "$($_.Inactive)" -ne 'tYES' } |
                            ForEach-Object { [ordered]@{ code = "$($_.Code)"; name = (Norm $_.Name); rate = [double]("0$($_.Rate)") } }) }
                        catch { Log WARN ("{0}: tax codes not read, the PO form offers SAP's default only: {1}" -f $db, $_.Exception.Message) }
                        $opt | Add-Member -NotePropertyName vendors -NotePropertyValue $vend -Force
                        $opt | Add-Member -NotePropertyName tax_codes -NotePropertyValue $taxes -Force
                        $opt | Add-Member -NotePropertyName vendors_refreshed_at -NotePropertyValue (Now-Ist) -Force
                        $optionsChanged = $true
                        Log INFO ("{0}: {1} supplier(s), {2} tax code(s) published for the PO form" -f $db, $vend.Count, $taxes.Count)
                    }
                } catch { Log WARN ("{0}: suppliers not refreshed: {1}" -f $db, $_.Exception.Message) }
            }

            # ---------------- options for this company, fresh from SAP
            foreach ($p in @($opt.groups | ForEach-Object { "$($_.prefix)" } | Where-Object { $_ } | Select-Object -Unique)) {
                if (-not $nextFor.ContainsKey($p)) {
                    $codes = (Sl-All ("Items?`$select=ItemCode&`$filter=startswith(ItemCode,'{0}')" -f $p.TrimEnd('-')) $jar) | ForEach-Object { $_.ItemCode }
                    $nextFor[$p] = (Prefix-Max $codes $p) + 1
                }
                if ([int]$opt.next_codes.$p -ne [int]$nextFor[$p]) { $opt.next_codes | Add-Member -NotePropertyName $p -NotePropertyValue ([int]$nextFor[$p]) -Force; $optionsChanged = $true }
            }
            if ($needHsn) {
                $sorted = @($hsnList | Sort-Object)
                if ((@($opt.hsn) -join ',') -ne ($sorted -join ',')) { $opt.hsn = $sorted; $optionsChanged = $true }
            }
        } finally {
            if (Test-Path -LiteralPath $jar) {
                try { $lo = Invoke-Sl -Method POST -Url "$slBase/Logout" -Jar $jar; Log INFO ("SAP logout {0}: HTTP {1}" -f $db, $lo.Http) } catch { }
                [IO.File]::Delete($jar)
            }
        }
    }

    if ($optionsChanged -and -not $DryRun) {
        foreach ($abbr in @($options.PSObject.Properties.Name)) { $options.$abbr | Add-Member -NotePropertyName refreshed_at -NotePropertyValue (Now-Ist) -Force }
        $null = Erp-Send PUT (Res $control $control) @{ item_master_options = ($options | ConvertTo-Json -Compress -Depth 8) }
        Log INFO 'item master options refreshed from SAP'
    }
    if ($groupsChanged -and -not $DryRun) {
        $null = Erp-Send PUT (Res $control $control) @{ engineering_groups = ($groupsByAbbr | ConvertTo-Json -Compress -Depth 8) }
        Log INFO 'engineering item groups published'
    }
    # Open PO lines are published in a dry run too: they only describe SAP, and the form needs them to be tried.
    # Companies this run could not read keep their previous lines.
    if ($poSnapshot.Count) {
        $merged = [ordered]@{}
        try { $prev = "$($ctl.open_po_lines)" | ConvertFrom-Json; if ($prev) { foreach ($n in $prev.PSObject.Properties.Name) { $merged[$n] = $prev.$n } } } catch { }
        foreach ($n in $poSnapshot.Keys) { $merged[$n] = $poSnapshot[$n] }
        $null = Erp-Send PUT (Res $control $control) @{ open_po_lines = ($merged | ConvertTo-Json -Compress -Depth 8); open_po_refreshed_at = (Now-Ist) }
    }

    $wouldC = @($result.items | Where-Object { $_.kind -eq 'create' -and $_.action -eq 'would create' }).Count
    $wouldP = @($result.items | Where-Object { $_.action -eq 'would patch' }).Count
    $wouldR = @($result.items | Where-Object { $_.kind -eq 'receipt' -and $_.action -like 'would post*' }).Count
    $wouldG = @($result.items | Where-Object { $_.kind -eq 'group' -and $_.action -eq 'would create' }).Count
    $wouldQ = @($result.items | Where-Object { $_.kind -eq 'purchase request' -and $_.action -like 'would post*' }).Count
    $wouldI = @($result.items | Where-Object { $_.kind -eq 'issue' -and $_.action -like 'would post*' }).Count
    $wouldO = @($result.items | Where-Object { $_.kind -eq 'purchase order' -and $_.action -like 'would post*' }).Count
    $same   = @($result.items | Where-Object { $_.action -like 'already in SAP*' }).Count
    $result.summary = if ($DryRun) { "DRY RUN: $wouldC item(s) would be created, $wouldP would change, $wouldR receipt(s) would post, $wouldG item group(s) would be created, $wouldQ purchase request(s) would post, $wouldO purchase order(s) would post, $wouldI spares issue(s) would post, $($result['fetched']) change(s) would be fetched from SAP, $same already match, $($result.failures) failed." }
                      else { "$($result.created) item(s) created in SAP, $($result.changed - $result.created - $result['receipts'] - $result['groups'] - $result['prs'] - $result['issues'] - $result['pos']) updated, $($result['receipts']) receipt(s) posted, $($result['groups']) item group(s) created, $($result['prs']) purchase request(s) posted, $($result['pos']) purchase order(s) posted, $($result['issues']) spares issue(s) posted, $($result['fetched']) change(s) fetched from SAP, $same already matched, $($result.failures) failed." }
    Log INFO $result.summary
    if ($result.failures -gt 0) { $result.exitCode = 1 }
} catch {
    $result.exitCode = 2; $result.error = $_.Exception.Message
    Log ERROR ("fatal: {0}" -f $_.Exception.Message)
}
Save-Result
exit $result.exitCode
