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
    * Against a CMMS PO made from a quotation (post_quotation_receipts, 24 Oct 2026): the GRPO line in the
      vendor's unit at the bill price with the measured items per unit; ERPNext at bill value / received
      qty, unrounded; then the PO's received quantities, Purchased once all is in, and its SAP PO closed.

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

  PASS Q - PURCHASE QUOTATIONS (post_purchase_quotations, 24 Oct 2026). Every "CMMS Purchase Quotation" Queued
  - the chosen vendor's quotation, entered by the purchase manager against a request in SAP: a SAP Purchase
  Quotation (PurchaseQuotations) for the vendor, DocDueDate = valid until, RequriedDate = the request's required
  by, each line based on the request's line (BaseType 1470000113) in the vendor's unit (MeasureUnit, an estimated
  UnitsOfMeasurment - the measured one comes with the goods receipt), Reference2 = "PQ<yy>-<n>". No tax code and no
  HSN on a quotation or any PO (27 Oct 2026): the goods receipt brings both off the bill. Only items on
  the Manual UoM group. Posted with the SAP number, or Failed with SAP's reason; the item's purchase unit then
  follows the vendor's unit, in SAP and on the ERPNext item (custom_purchase_uom), for the record only.

  PASS P - PURCHASE ORDERS FROM QUOTATIONS (post_quotation_purchase_orders, 24 Oct 2026). Every "CMMS Purchase
  Order" whose sync_status is Queued - made by the purchase manager from a posted quotation, one PO per
  quotation: a SAP Purchase Order, each line based on the quotation's line (BaseType 540000006) at the quoted
  price and unit and the quantity given, Reference2 = "PO<yy>-<n>". sync_status goes Posted with the SAP number,
  or Failed. Such POs are left out of the open PO lines below: they are received through their own record.

  Order within a company (24 Oct 2026): PASS H, 0, A, B, then D, Q, G, P, C, F, E - a purchase request, its
  quotation, the PO, then what is received against it. A quotation or PO whose predecessor is not
  in SAP yet is left Queued with the reason in its error, and goes in a later run.

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
    [string[]] $SkipCompany = @(),
    # Job (default, every flag): pushes only the queued work, only to the companies with any, and skips every bulk read.
    # Routine (3 times a day): everything today's run does - PASS E, open PO lines, cancellations, HSN list, units,
    # next codes, suppliers and tax codes for every company. A Job run with nothing queued and no vendor refresh asked
    # for falls through to a Routine run, so today's app's Sync / "Fetch from SAP" buttons still do what they did.
    [ValidateSet('Job','Routine')] [string] $Mode = 'Job',
    # The watcher passes this on a safety-net run (fix 1, 27 Oct 2026): a Job with nothing queued must stop, not fall
    # through to a Routine. The fallback is only for a real flag raised with nothing queued (today's Sync / Fetch buttons).
    [switch] $NoRoutineFallback
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

# Fix 3 (27 Oct 2026): login-blocked companies. SAP locks a user after 3 wrong passwords, and the sync shares one user,
# so a 400/401 at /Login must never be retried automatically. The file is written when the first refusal is seen; a person
# fixes the password and deletes the file to unblock.
$loginBlockedFile = Join-Path $logDir 'login-blocked.json'
$loginBlocked = @{}
if (Test-Path -LiteralPath $loginBlockedFile) {
    try {
        $raw = [IO.File]::ReadAllText($loginBlockedFile)
        if ($raw.Trim()) { $parsed = $raw | ConvertFrom-Json; foreach ($p in $parsed.PSObject.Properties) { $loginBlocked[$p.Name.ToUpper()] = $p.Value } }
    } catch { Log WARN "login-blocked.json unreadable: $($_.Exception.Message); treated as empty" }
}
function Save-LoginBlocked {
    try {
        $out = [ordered]@{}; foreach ($k in @($loginBlocked.Keys | Sort-Object)) { $out[$k] = $loginBlocked[$k] }
        [IO.File]::WriteAllText($loginBlockedFile, ($out | ConvertTo-Json -Depth 4), (New-Object System.Text.UTF8Encoding($false)))
    } catch { Log WARN "could not write login-blocked.json: $($_.Exception.Message)" }
}
function Login-Reason([string] $Db) { "SAP login refused for $Db - not retried; a person must check the password and delete logs\login-blocked.json" }

# The company's CMMS store = the ERPNext copy's default warehouse (see Manna_CMMS server stores.js).
$storeByAbbr = @{ MRPPL = 'Manna Rubber Products Store - MRPPL'; MT = 'Stores - MT'; HRI = 'Stores - HRI'; MTR = 'Stores - MTR'; HRD = 'Stores - HRD' }
$companyByAbbr = @{ MRPPL = 'Manna Rubber Products Private Limited'; MT = 'Manna Treads'; HRI = 'Hi-Tech Rubber Industries'; MTR = 'Manna Tyre Retreads'; HRD = 'Hi-Tech Rubber DEMO' }
# The demo company (28 Oct 2026) and SAP's test database belong to each other and to nothing else: HRD posts only to
# HITECH_RUBBER, and no other company may name it. A mismatch is skipped with an error, before any SAP login.
$demoAbbr = 'HRD'; $demoDb = 'HITECH_RUBBER'
function Demo-Mismatch([string] $Abbr, [string] $Db) {
    $isDemo = "$Abbr".Trim().ToUpper() -eq $demoAbbr; $isTestDb = "$Db".Trim().ToUpper() -eq $demoDb
    if ($isDemo -and -not $isTestDb) { return "demo company $demoAbbr may only post to $demoDb, not $Db" }
    if ($isTestDb -and -not $isDemo) { return "$demoDb is the demo company's ($demoAbbr) test database, not $Abbr's" }
    return ''
}

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
    # config.json "demo_company": { "abbr", "sap_db" } overrides the pair above - a developer PC, whose copy files HRI
    # under the test database, sets it to HRI (MannaHRM localdev/sap/run-sync.mjs). The server leaves it out.
    if ($cfg.PSObject.Properties['demo_company'] -and $cfg.demo_company) {
        if ("$($cfg.demo_company.abbr)".Trim()) { $demoAbbr = "$($cfg.demo_company.abbr)".Trim().ToUpper() }
        if ("$($cfg.demo_company.sap_db)".Trim()) { $demoDb = "$($cfg.demo_company.sap_db)".Trim().ToUpper() }
    }
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
    # Quotations entered in the CMMS, and the POs made from them (24 Oct 2026). Separate from post_purchase_orders, which
    # keeps posting the POs once made on a request, so each kind can be dry-run and switched on by itself.
    $postQuotes = Cfg-On 'post_purchase_quotations'
    $postQuotePos = Cfg-On 'post_quotation_purchase_orders'
    # Goods receipts against those POs, in the vendor's unit (24 Oct 2026, phase 4; rule 18): a switch of their own, apart
    # from post_receipts, so the first ones can be dry-run while receipts against older POs keep posting.
    $postQuoteReceipts = Cfg-On 'post_quotation_receipts'
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
    # Quotations and the POs made from them, with their lines (24 Oct 2026). Read in a try: the doctypes exist only once
    # setup-purchase-quotation.js has been applied.
    $quotes = @(); $qorders = @(); $quotePoEntries = @{}; $quotePosByPr = @{}; $closeLater = @()
    # Rule 7 (25 Oct 2026): what SAP has that may since have been cancelled or closed there, and per request the POs
    # from its quotations that SAP cancelled. Rule 15: requests with a dropped line, and every request quoted at all.
    $watchQuotes = @(); $watchOrders = @(); $quoteCancelledByPr = @{}; $quotedPrs = @{}; $quoteStatus = @{}; $droppedPrs = @()
    try {
        $quotes = @(Erp-List 'CMMS Purchase Quotation' @('name') '[["status","=","Queued"]]' | ForEach-Object { (Erp-Get (Res 'CMMS Purchase Quotation' $_.name)).data })
        $qorders = @(Erp-List 'CMMS Purchase Order' @('name') '[["sync_status","=","Queued"]]' | ForEach-Object { (Erp-Get (Res 'CMMS Purchase Order' $_.name)).data })
        # Purchased in the CMMS, but SAP refused to close the PO when it turned so (rule 19): tried again each Routine run.
        # Fix 2 (27 Oct 2026): a Job run skips this. The next Routine (3 times a day) or a run that already has work for
        # that company will retry the close - no need to add a bulk read to every flag. $Mode is still as given here;
        # $isRoutine is set below after the queued reads.
        if ($postQuoteReceipts -and $Mode -eq 'Routine') { $closeLater = @(Erp-List 'CMMS Purchase Order' @('name', 'company', 'sap_doc_entry', 'sap_doc_number') '[["status","=","Purchased"],["error","like","SAP PO not closed%"]]') }
        # Every one SAP already has: kept off the open PO lines the old receipt screen offers (decided 24 Oct 2026), and
        # counted as its request's POs. SAP bases them on the quotation, not the request, so the open PO read cannot tie
        # them to it - and SAP closes the request once every line is on a PO, which read as Closed (PR-2026-00349 and
        # PR-2026-00351, 24 Oct 2026). With their numbers the request goes Ordered, as for a PO based on it.
        foreach ($p in @(Erp-List 'CMMS Purchase Order' @('company', 'sap_doc_entry', 'sap_doc_number', 'purchase_request', 'status', 'error') '[["sap_doc_entry","is","set"]]')) {
            $quotePoEntries["$($p.company):$($p.sap_doc_entry)"] = $true
            $k = "$($p.purchase_request)"
            # One SAP cancelled no longer orders anything for its request.
            $into = if ("$($p.status)" -eq 'Closed' -and "$($p.error)" -like 'Cancelled in SAP*') { $quoteCancelledByPr } else { $quotePosByPr }
            if ($k -and "$($p.sap_doc_number)") { if (-not $into.ContainsKey($k)) { $into[$k] = @() }; $into[$k] += "$($p.sap_doc_number)" }
        }
        foreach ($q in @(Erp-List 'CMMS Purchase Quotation' @('name', 'purchase_request', 'status') '[]')) { $quotedPrs["$($q.purchase_request)"] = $true; $quoteStatus["$($q.name)"] = "$($q.status)" }
        if ($postQuotes -or $postQuotePos) {
            $watchQuotes = @(Erp-List 'CMMS Purchase Quotation' @('name', 'company', 'purchase_request', 'purchase_order', 'sap_doc_entry', 'sap_doc_number') '[["status","=","Posted"],["sap_doc_entry","is","set"]]')
            $watchOrders = @(Erp-List 'CMMS Purchase Order' @('name', 'company', 'purchase_request', 'purchase_quotation', 'sap_doc_entry', 'sap_doc_number') '[["status","=","Open"],["sync_status","=","Posted"]]')
            $droppedPrs = @(Erp-List 'CMMS Purchase Request' @('name', 'company', 'sap_doc_entry', 'sap_doc_number') '[["CMMS Purchase Request Line","coverage","=","Dropped"],["status","in",["In SAP","Ordered"]],["sap_doc_entry","is","set"]]' | Sort-Object name -Unique)
        }
        # A request already closed that way is read again, so it is put right rather than left Closed.
        $closedQuoted = @($quotePosByPr.Keys | Where-Object { $k = $_; -not @($openPrs | Where-Object { "$($_.name)" -eq $k }).Count })
        if ($closedQuoted.Count) {
            $openPrs += @(Erp-List 'CMMS Purchase Request' @('name', 'company', 'status', 'sap_doc_entry', 'sap_doc_number', 'po_numbers', 'po_status', 'po_doc_entry', 'po_doc_number') ('[["status","=","Closed"],["name","in",{0}]]' -f (ConvertTo-Json -InputObject @($closedQuoted) -Compress)))
        }
    } catch { if ($postQuotes -or $postQuotePos) { Log WARN ("quotations not read (run setup-purchase-quotation.js --apply?): {0}" -f $_.Exception.Message) } }
    if (-not $postQuotes -and $quotes.Count) { Log INFO ("{0} quotation(s) left Queued - posting them is off (post_purchase_quotations)." -f $quotes.Count); $quotes = @() }
    if (-not $postQuotePos -and $qorders.Count) { Log INFO ("{0} PO(s) from quotations left Queued - posting them is off (post_quotation_purchase_orders)." -f $qorders.Count); $qorders = @() }
    if (-not $postPrs -and $prs.Count) { Log INFO ("{0} purchase request(s) left Queued - posting them is off (post_purchase_requests)." -f $prs.Count); $prs = @() }
    # Cancellations asked for in the CMMS (27 Oct 2026, PASS X), each behind the switch that posts its kind of document.
    # Read in a try: cancel_status exists only once setup-cancel.js has been applied.
    $cancels = @()
    try {
        foreach ($cd in @(@{ dt = 'CMMS Purchase Request'; on = $postPrs }, @{ dt = 'CMMS Purchase Quotation'; on = $postQuotes }, @{ dt = 'CMMS Purchase Order'; on = $postQuotePos })) {
            $rows = @(Erp-List $cd.dt @('name') '[["cancel_status","=","Queued"]]')
            if (-not $rows.Count) { continue }
            if (-not $cd.on) { Log INFO ("{0} {1} cancellation(s) left Queued - its switch is off." -f $rows.Count, $cd.dt); continue }
            foreach ($r in $rows) { $cancels += [pscustomobject]@{ dt = $cd.dt; doc = (Erp-Get (Res $cd.dt $r.name)).data } }
        }
    } catch { Log WARN ("cancellations not read (run setup-cancel.js --apply?): {0}" -f $_.Exception.Message) }
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
    # Which of them a quotation raised (24 Oct 2026): it is held until they are Created, as a receipt is. A query of its
    # own, in a try - purchase_quotation exists only once setup-purchase-quotation.js has run, and asking for it in the
    # read above would leave every receipt's request unread on a site without it.
    $hsnByQuote = @{}
    try {
        foreach ($hq in @(Erp-List 'CMMS SAP HSN Request' @('name', 'purchase_quotation') '[["purchase_quotation","is","set"],["status","in",["Queued","Failed"]]]')) {
            $k = "$($hq.purchase_quotation)"; if (-not $hsnByQuote.ContainsKey($k)) { $hsnByQuote[$k] = @() }; $hsnByQuote[$k] += "$($hq.name)"
        }
    } catch { }
    $hsnQueued = @($hsnReqs | Where-Object { "$($_.status)" -eq 'Queued' })
    if (-not $createHsn -and $hsnQueued.Count) { Log INFO ("{0} HSN request(s) left Queued - creating HSN codes is off (create_hsn); their goods receipts are held." -f $hsnQueued.Count); $hsnQueued = @() }
    # Items whose HSN edit (PASS B) failed in this run: their goods receipts are held as well.
    $hsnEditFailed = @{}
    if (-not $createItems -and $creates.Count) { Log INFO ("{0} approved request(s) left Queued - creating items in SAP is off (create_items)." -f $creates.Count); $creates = @() }
    $quoteReceipts = @($receipts | Where-Object { "$($_.purchase_order)".Trim() })
    $receipts = @($receipts | Where-Object { -not "$($_.purchase_order)".Trim() })
    if (-not $postReceipts -and $receipts.Count) { Log INFO ("{0} receipt(s) left Queued - posting receipts is off (post_receipts)." -f $receipts.Count); $receipts = @() }
    if (-not $postQuoteReceipts -and $quoteReceipts.Count) { Log INFO ("{0} receipt(s) against POs from quotations left Queued - posting them is off (post_quotation_receipts)." -f $quoteReceipts.Count); $quoteReceipts = @() }
    $receipts = @($receipts) + @($quoteReceipts)
    if (-not $createGroups -and $groupReqs.Count) { Log INFO ("{0} item group request(s) left Queued - creating groups is off (create_groups)." -f $groupReqs.Count); $groupReqs = @() }
    if ($Limit -gt 0) { $creates = @($creates | Select-Object -First $Limit); $edits = @($edits | Select-Object -First $Limit); $receipts = @($receipts | Select-Object -First $Limit); $issues = @($issues | Select-Object -First $Limit) }
    # Companies the CMMS has asked for a supplier / tax code refresh (vendor_refresh_requested, 27 Oct 2026): a JSON array
    # of abbreviations. Treated as empty when the field is missing. Processed in Job mode too; the abbr is removed once
    # that company has been refreshed.
    $vendRefresh = @(); $vendRefreshRaw = ''
    if ($ctl.PSObject.Properties['vendor_refresh_requested']) {
        $vendRefreshRaw = "$($ctl.vendor_refresh_requested)".Trim()
        if ($vendRefreshRaw) { try { $vendRefresh = @(("$vendRefreshRaw" | ConvertFrom-Json) | ForEach-Object { "$_".Trim().ToUpper() } | Where-Object { $_ }) } catch { Log WARN "vendor_refresh_requested is not JSON ($vendRefreshRaw) - treated as empty"; $vendRefresh = @() } }
    }
    # Compatibility (27 Oct 2026): the app still has Sync / "Fetch from SAP" buttons that raise the flag with nothing queued.
    # A Job run with no queued work and no vendor refresh asked for runs as Routine, so those buttons still do what they did.
    # The app will drop them later, when every save queues work; the fallback stays in the code until then.
    # The watcher passes -NoRoutineFallback on a safety-net run (fix 1, 27 Oct 2026): a safety-net Job with nothing queued
    # must stop. Otherwise a record the sync left Queued on purpose (switch off, skip_companies, held waiting for HSN) would
    # fire the safety net every 30 s, each Job falling through to a Routine - every company logged in to about twice a minute.
    $anyWork = ($creates.Count + $edits.Count + $receipts.Count + $groupReqs.Count + $prs.Count + $orders.Count + $quotes.Count + $qorders.Count + $issues.Count + $hsnQueued.Count + $cancels.Count) -gt 0
    if ($Mode -eq 'Job' -and -not $anyWork -and -not $vendRefresh.Count) {
        if ($NoRoutineFallback) { Log INFO 'Job mode: nothing queued and no vendor refresh - -NoRoutineFallback is set, so exiting without a Routine run.' }
        else { Log INFO 'Job mode: nothing queued and no vendor refresh - running Routine instead (today''s app still presses Sync with nothing queued).'; $Mode = 'Routine' }
    }
    $isRoutine = ($Mode -eq 'Routine')
    $result.mode = $Mode
    Log INFO ("mode {0}: {1} item(s) to create, {2} with pending edits, {3} receipt(s), {4} spares issue(s), {5} new item group(s), {6} new HSN code(s), {7} purchase request(s), {8} PO(s), {9} quotation(s), {10} PO(s) from quotations; vendor refresh for {11}; edits send {12}{13}." -f $Mode, $creates.Count, $edits.Count, $receipts.Count, $issues.Count, $groupReqs.Count, $hsnQueued.Count, $prs.Count, $orders.Count, $quotes.Count, $qorders.Count, $(if ($vendRefresh.Count) { ($vendRefresh -join ',') } else { 'none' }), ($editFields -join ', '), $(if ($DryRun) { ' - DRY RUN, nothing will be written' } else { '' }))
    # No early exit: a Routine run also re-reads each company's open PO lines for the goods receipt form.

    # The engineering items ERPNext mirrors, per company: SAP code -> ERPNext item (for the open PO lines).
    # $mirrorAll includes disabled items, for PASS E (fetch from SAP) to re-enable or update them.
    # Job mode (27 Oct 2026): only the items this run needs - by name of each line in the queued work. PASS E, the open
    # PO lines read and the cancelled-in-SAP checks all skip in Job mode, so the whole engineering list is not needed.
    # Routine mode reads them all, as before.
    $mirror = @{}; $mirrorAll = @{}
    $itemFilter = '[["custom_sap_item_group","is","set"]]'
    if (-not $isRoutine) {
        $need = New-Object System.Collections.Generic.HashSet[string]
        foreach ($rc in $receipts) { foreach ($l in @($rc.lines)) { if ("$($l.item)".Trim()) { [void]$need.Add("$($l.item)".Trim()) } } }
        foreach ($gi in $issues) { foreach ($l in @($gi.lines)) { if ("$($l.item)".Trim()) { [void]$need.Add("$($l.item)".Trim()) } } }
        foreach ($pq in $prs) { foreach ($l in @($pq.lines)) { if ("$($l.item)".Trim()) { [void]$need.Add("$($l.item)".Trim()) } } }
        foreach ($po in $orders) { foreach ($l in @($po.lines)) { if ("$($l.item)".Trim()) { [void]$need.Add("$($l.item)".Trim()) } } }
        foreach ($q in $quotes) { foreach ($l in @($q.lines)) { if ("$($l.item)".Trim()) { [void]$need.Add("$($l.item)".Trim()) } } }
        foreach ($po in $qorders) { foreach ($l in @($po.lines)) { if ("$($l.item)".Trim()) { [void]$need.Add("$($l.item)".Trim()) } } }
        foreach ($e in $edits) { if ("$($e.name)".Trim()) { [void]$need.Add("$($e.name)".Trim()) } }
        if ($need.Count -eq 0) { $itemFilter = $null }
        else { $itemFilter = '[["name","in",{0}]]' -f (ConvertTo-Json -InputObject @($need) -Compress) }
    }
    foreach ($it in $(if ($itemFilter) { Erp-List 'Item' @('name', 'item_name', 'custom_sap_item_code', 'valuation_rate', 'disabled', 'stock_uom', 'custom_sap_item_group', 'custom_sap_sub_type_a', 'custom_sap_sub_type_b', 'custom_sap_foreign_name', 'custom_sap_hsn_code', 'custom_sap_tax_rate', 'safety_stock', 'custom_sap_category_pending') $itemFilter } else { @() })) {
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
    $result['receipts'] = 0; $result['groups'] = 0; $result['prs'] = 0; $result['fetched'] = 0; $result['issues'] = 0; $result['pos'] = 0; $result['quotes'] = 0; $result['qpos'] = 0

    # ------------------------------------------------------------------ SAP (curl.exe, BRIEFING §2)
    $slBase = "$($cfg.sap.url)".TrimEnd('/')
    $slRoot = ([Uri]$slBase).GetLeftPart([UriPartial]::Authority)
    $US = [string][char]0x1F
    # Optional sap.pinned_pubkey (base64 SHA-256 of the Service Layer's public key, 24 Oct 2026). -k stays, as the
    # certificate is self-signed and expired; with a pin curl still refuses any other server at the handshake,
    # before the password is sent. Set where the sync runs off the SAP server (a developer PC); absent, nothing changes.
    $pin = if ($cfg.sap.PSObject.Properties['pinned_pubkey'] -and "$($cfg.sap.pinned_pubkey)".Trim()) { "sha256//$("$($cfg.sap.pinned_pubkey)".Trim())" } else { '' }
    function Invoke-Sl {
        param([string] $Method, [string] $Url, [string] $Body, [string] $Jar, [switch] $SaveCookies, [string] $IfMatch)
        $tag = [guid]::NewGuid().ToString('N').Substring(0, 8)
        $resp = Join-Path $env:TEMP "imsync-$tag-resp.txt"; $bodyFile = $null
        $a = @('-k', '-s', '--globoff', '--connect-timeout', '15', '--max-time', '120', '-H', 'Expect:', '-H', 'Prefer: odata.maxpagesize=200',
               '-o', $resp, '-w', "%{http_code}$US%{time_total}", '-X', $Method)
        if ($pin) { $a += @('--pinnedpubkey', $pin) }
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
    # A line in the vendor's unit (24 Oct 2026): MeasureUnit, and an estimated items-per-unit - 1 when the vendor sells in
    # the item's own unit, else what was asked for divided by what is ordered, so the document stands for the request.
    # The goods receipt carries the measured ratio; SAP took a different one there in the demo test.
    function Vendor-Unit([string] $VendorUom, [string] $InventoryUom, [double] $AskedFor, [double] $Qty) {
        $u = Norm $VendorUom
        $per = if ($u.ToUpper() -eq (Norm $InventoryUom).ToUpper() -or $Qty -le 0 -or $AskedFor -le 0) { 1 } else { [Math]::Round($AskedFor / $Qty, 6) }
        @{ unit = $u; perUnit = $per }
    }
    function Prefix-Max($codes, [string] $Prefix) {
        $stem = [regex]::Escape($Prefix.TrimEnd('-')); $max = 0
        foreach ($c in $codes) { $m = [regex]::Match((Norm $c), "^$stem[\s-]*(\d+)$", 'IgnoreCase'); if ($m.Success) { $n = [int]$m.Groups[1].Value; if ($n -gt $max) { $max = $n } } }
        $max
    }

    # Work per SAP company.
    $work = @{}
    $demoRefused = @{}
    function Work-For([string] $Abbr) {
        $o = $options.$Abbr
        if (-not $o) { return $null }
        $demoWhy = Demo-Mismatch $Abbr "$($o.sap_db)"
        if ($demoWhy) {
            if (-not $demoRefused.ContainsKey($Abbr)) { $demoRefused[$Abbr] = $true; $result.failures++; Log ERROR ("{0}: refused - {1}" -f $Abbr, $demoWhy) }
            return $null
        }
        if (-not $work.ContainsKey($o.sap_db)) { $work[$o.sap_db] = @{ abbr = $Abbr; opt = $o; creates = New-Object System.Collections.ArrayList; edits = New-Object System.Collections.ArrayList; receipts = New-Object System.Collections.ArrayList; groups = New-Object System.Collections.ArrayList; prs = New-Object System.Collections.ArrayList; openPrs = New-Object System.Collections.ArrayList; issues = New-Object System.Collections.ArrayList; orders = New-Object System.Collections.ArrayList; quotes = New-Object System.Collections.ArrayList; qorders = New-Object System.Collections.ArrayList; hsnReqs = New-Object System.Collections.ArrayList; cancels = New-Object System.Collections.ArrayList } }
        $work[$o.sap_db]
    }
    # Routine mode: every company, for its open PO lines, PASS E and the options refresh.
    # Job mode: only the companies the CMMS asked for a vendor refresh. Companies with queued work are added below;
    # the rest are not logged in to at all.
    if ($isRoutine) { foreach ($ab in @($options.PSObject.Properties.Name)) { $null = Work-For $ab } }
    else { foreach ($ab in $vendRefresh) { $null = Work-For $ab } }
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
    # Fix 2 (27 Oct 2026): openPrs is only used by the Routine's open-PO status read. Letting it build work entries in Job
    # mode made every company with an open purchase request get logged in to, even with nothing queued for it.
    if ($isRoutine) { foreach ($pq in $openPrs) { $w = Work-For "$($pq.company)"; if ($w) { [void]$w.openPrs.Add($pq) } } }
    foreach ($po in $orders) {
        $w = Work-For "$($po.company)"
        if (-not $w) { $result.failures++; Log ERROR ("{0}: unknown SAP company '{1}'" -f $po.name, $po.company); continue }
        [void]$w.orders.Add($po)
    }
    foreach ($q in $quotes) {
        $w = Work-For "$($q.company)"
        if (-not $w) { $result.failures++; Log ERROR ("{0}: unknown SAP company '{1}'" -f $q.name, $q.company); continue }
        [void]$w.quotes.Add($q)
    }
    foreach ($po in $qorders) {
        $w = Work-For "$($po.company)"
        if (-not $w) { $result.failures++; Log ERROR ("{0}: unknown SAP company '{1}'" -f $po.name, $po.company); continue }
        [void]$w.qorders.Add($po)
    }
    foreach ($cx in $cancels) {
        $w = Work-For "$($cx.doc.company)"
        if (-not $w) { $result.failures++; Log ERROR ("{0}: unknown SAP company '{1}'" -f $cx.doc.name, $cx.doc.company); continue }
        [void]$w.cancels.Add($cx)
    }
    # The HSN requests to create, by company (PASS H). Restored 24 Oct 2026: the merge 7aa1cc3 dropped this and the
    # hsnReqs list from Work-For, so PASS H had nothing to create and every receipt or quotation waiting on a new code
    # waited for good.
    foreach ($hq in $hsnQueued) {
        $w = Work-For "$($hq.company)"
        if (-not $w) { $result.failures++; Log ERROR ("{0}: unknown SAP company '{1}'" -f $hq.name, $hq.company); continue }
        [void]$w.hsnReqs.Add($hq)
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
    # Fix 3 (27 Oct 2026): once a company has refused the login (400/401), its queued records' error carries the reason.
    # Walks the in-memory queued lists for this company and PUTs the error only when the current error differs - a run
    # that finds the same reason there writes nothing. Dry runs log and skip the PUT.
    $noteBlocked = {
        param([string] $Db, $Work, [string] $Reason)
        if ($DryRun) { Log INFO ("{0}: would mark {1} queued record(s) with the refused-login reason" -f $Db, ($Work.creates.Count + $Work.edits.Count + $Work.receipts.Count + $Work.groups.Count + $Work.prs.Count + $Work.orders.Count + $Work.quotes.Count + $Work.qorders.Count + $Work.issues.Count + $Work.hsnReqs.Count)); return }
        $puts = @(
            @{ list = $Work.creates;  dt = 'CMMS Item Naming Request';     field = 'sap_create_error' }
            @{ list = $Work.edits;    dt = 'Item';                         field = 'custom_sap_category_error' }
            @{ list = $Work.receipts; dt = 'CMMS Goods Receipt';           field = 'error' }
            @{ list = $Work.groups;   dt = 'CMMS SAP Item Group Request';  field = 'error' }
            @{ list = $Work.prs;      dt = 'CMMS Purchase Request';        field = 'error' }
            @{ list = $Work.orders;   dt = 'CMMS Purchase Request';        field = 'po_error' }
            @{ list = $Work.quotes;   dt = 'CMMS Purchase Quotation';      field = 'error' }
            @{ list = $Work.qorders;  dt = 'CMMS Purchase Order';          field = 'error' }
            @{ list = $Work.issues;   dt = 'CMMS Goods Issue';             field = 'error' }
            @{ list = $Work.hsnReqs;  dt = 'CMMS SAP HSN Request';         field = 'error' }
        )
        foreach ($p in $puts) {
            foreach ($row in $p.list) {
                $curErr = "$($row.$($p.field))"; if ($curErr -eq $Reason) { continue }
                try { $null = Erp-Send PUT (Res $p.dt $row.name) @{ "$($p.field)" = $Reason } }
                catch { Log WARN ("{0}: could not note refused-login reason on {1}: {2}" -f $Db, $row.name, $_.Exception.Message) }
            }
        }
    }

    # The refused-login reasons seen this run, appended to the final summary AFTER it is built (the summary
    # builder at the end would otherwise overwrite them - dev PC, 27 Oct 2026).
    $blockedReasons = @()
    foreach ($db in $work.Keys) {
        $w = $work[$db]; $abbr = $w.abbr; $opt = $w.opt
        if ($skipDbs -contains "$db".ToUpper()) { Log WARN ("{0}: skipped (skip_companies) - not logged in; its CMMS work stays Queued" -f $db); continue }
        # Second check, right before the login (Work-For is the first).
        $demoWhy = Demo-Mismatch $abbr $db
        if ($demoWhy) { $result.failures++; Log ERROR ("{0}: not logged in - {1}" -f $db, $demoWhy); continue }
        $dbUp = "$db".ToUpper()
        if ($loginBlocked.ContainsKey($dbUp)) {
            $reason = Login-Reason $db
            $when = "$($loginBlocked[$dbUp].at)"
            Log ERROR ("{0}: {1} (first refused at {2})" -f $db, $reason, $when)
            $blockedReasons += $reason
            & $noteBlocked $db $w $reason
            $result.failures++
            continue
        }
        $password = "$($cfg.sap.password)"
        if ($cfg.sap.PSObject.Properties['password_overrides'] -and $cfg.sap.password_overrides.PSObject.Properties[$db]) { $password = "$($cfg.sap.password_overrides.$db)" }
        $jar = Join-Path $env:TEMP ("imsync-{0}.jar" -f [guid]::NewGuid().ToString('N').Substring(0, 8))
        try {
            $login = @{ CompanyDB = $db; UserName = "$($cfg.sap.username)"; Password = $password } | ConvertTo-Json -Compress
            $lg = $null; $try = 0; $maxTries = 3
            while ($try -lt $maxTries) {
                $try++
                $lg = Invoke-Sl -Method POST -Url "$slBase/Login" -Body $login -Jar $jar -SaveCookies
                if ($lg.Http -eq '200') { break }
                $httpCode = [int]"0$($lg.Http)"
                # 400 / 401 is a refused login - never retried. Add to login-blocked, note the records, skip the company.
                if ($httpCode -eq 400 -or $httpCode -eq 401) { break }
                # 500+ or connection failures (curl writes http_code 000 when the socket never got a response): retry twice, 5 s apart.
                if ($try -lt $maxTries) { Log WARN ("{0}: SAP login HTTP {1} - retrying in 5 s (attempt {2} of {3})" -f $db, $lg.Http, $try, $maxTries); Start-Sleep -Seconds 5 }
            }
            $login = $null
            if ($lg.Http -ne '200') {
                $httpCode = [int]"0$($lg.Http)"
                if ($httpCode -eq 400 -or $httpCode -eq 401) {
                    $sapBody = ("$($lg.Body)" -replace '\s+', ' ').Trim()
                    if ($sapBody.Length -gt 200) { $sapBody = $sapBody.Substring(0, 200) }
                    $loginBlocked[$dbUp] = [ordered]@{ at = (Now-Ist); http = $httpCode; reason = $sapBody }
                    Save-LoginBlocked
                    $reason = Login-Reason $db
                    Log ERROR ("{0}: {1} (HTTP {2}: {3})" -f $db, $reason, $httpCode, $sapBody)
                    $blockedReasons += $reason
                    & $noteBlocked $db $w $reason
                    $result.failures++
                    continue
                }
                # Not a refusal - a server error or timeout we did retry. Fall through to the original behavior.
                Sl-Fail $lg "login to $db"
            }
            Log INFO ("SAP login OK: {0} ({1} to create, {2} to edit, {3} receipt(s), {4} spares issue(s), {5} new group(s), {6} purchase request(s), {7} purchase order(s), {8} quotation(s), {9} PO(s) from quotations)" -f $db, $w.creates.Count, $w.edits.Count, $w.receipts.Count, $w.issues.Count, $w.groups.Count, $w.prs.Count, $w.orders.Count, $w.quotes.Count, $w.qorders.Count)

            # This company's HSN list: digits -> AbsEntry (ChapterID). Only read when HSN is written.
            # Fix 6 (27 Oct 2026): in Job mode, read only when this company's queued work actually needs it. The Routine
            # keeps the old "whenever HSN is editable OR pulling from SAP" rule, so the UI's HSN list stays fresh.
            # Quotations no longer need it: they carry no HSN since the same day.
            $hsn = @{}; $hsnList = New-Object System.Collections.ArrayList
            $needHsn = if ($isRoutine) {
                $w.creates.Count -gt 0 -or ($editFields -contains 'ChapterID') -or $pullFromSap -or $w.hsnReqs.Count -gt 0
            } else {
                $w.creates.Count -gt 0 -or ($w.edits.Count -gt 0 -and ($editFields -contains 'ChapterID')) -or $w.hsnReqs.Count -gt 0
            }
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
                        if (-not $desc) { $desc = $(if ("$($hq.goods_receipt)".Trim()) { ('Added from CMMS goods receipt {0}' -f "$($hq.goods_receipt)").Trim() } else { 'Added from a CMMS purchase quotation' }) }
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
                        # SAP keeps 3 decimals of a quantity: 2.3456 reads back 2.346 and failed the check (demo, 23 Oct 2026).
                        MinInventory   = @{ want = { [Math]::Round([double]("0$($args[0].safety_stock)"), 3) } }
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

            # ---------------- PASS X: cancellations asked for in the CMMS (27 Oct 2026)
            # Cancel was pressed with a reason, and the CMMS checked it may be (cancelRefusal in purchaseRequests.js,
            # purchaseQuotations.js, purchaseOrders.js) and set cancel_status = Queued. SAP cancels the document - every
            # one of the three has a Cancel action - and the CMMS follows:
            #   request    Closed.
            #   quotation  Cancelled, its request lines open again for a new quotation.
            #   PO         Closed (SAP refuses one with a GRPO on it); its quotation Cancelled, as SAP keeps that closed;
            #              its request lines open for a new quotation (the user's choice), and the request back to
            #              In SAP when no other PO is live. Tested in HITECH_RUBBER the same day: the request's lines stay
            #              open in SAP after its quotation's PO is cancelled, and a new quotation is based on them.
            # The note on each starts "Cancelled in SAP", as rule 7's do, so the routine run reads them alike. One already
            # cancelled in SAP is taken as done. SAP's refusal leaves cancel_status Failed with the reason; Cancel can be
            # pressed again.
            foreach ($cx in $w.cancels) {
                $d = $cx.doc
                $entity = switch ($cx.dt) { 'CMMS Purchase Request' { 'PurchaseRequests' } 'CMMS Purchase Quotation' { 'PurchaseQuotations' } default { 'PurchaseOrders' } }
                $entry = [ordered]@{ kind = "cancel $entity"; request = "$($d.name)"; sap_db = $db; action = ''; sap_doc = "$($d.sap_doc_number)"; error = '' }
                try {
                    if ([int]("0$($d.sap_doc_entry)") -le 0) { throw "SAP has no document for it" }
                    $rd = Invoke-Sl -Method GET -Url ("$slBase/{0}({1})?`$select=DocEntry,DocNum,DocumentStatus,Cancelled" -f $entity, [int]$d.sap_doc_entry) -Jar $jar
                    if ($rd.Http -ne '200') { Sl-Fail $rd "read $entity $($d.sap_doc_number)" }
                    $sd = $rd.Body | ConvertFrom-Json
                    if ($DryRun) { $entry.action = "would cancel $entity $($sd.DocNum)"; Log INFO ("{0} [{1}]: would cancel {2} {3}" -f $d.name, $db, $entity, $sd.DocNum) }
                    else {
                        # Already closed in SAP: nothing is left to undo there, and SAP refuses to cancel it ("Document is
                        # already closed"), so the CMMS side is finished as for a cancel. A request is closed by a PO for its
                        # whole quantity, even once that PO is cancelled (PR 54, PR-2026-00416, 27 Oct 2026); the server
                        # keeps a PO with goods received from getting here.
                        $already = "$($sd.Cancelled)" -eq 'tYES' -or "$($sd.DocumentStatus)" -eq 'bost_Close'
                        if (-not $already) {
                            $cr = Invoke-Sl -Method POST -Url ("$slBase/{0}({1})/Cancel" -f $entity, [int]$d.sap_doc_entry) -Jar $jar
                            if ($cr.Http -ne '204' -and $cr.Http -ne '200') { Sl-Fail $cr "cancel $entity $($sd.DocNum)" }
                        }
                        $why = "Cancelled in SAP from the CMMS by $($d.cancel_requested_by) $(Now-Ist)$(if ($already -and "$($sd.Cancelled)" -ne 'tYES') { ' (SAP had already closed it)' }): $($d.cancel_reason)"
                        # Request lines a quotation covered, open again for a new quotation.
                        $reopen = {
                            param([string] $Request, [string] $Quotation)
                            $n = 0
                            if (-not $Request) { return 0 }
                            foreach ($rl in @((Erp-Get (Res 'CMMS Purchase Request' $Request)).data.lines | Where-Object { "$($_.quotation)" -eq $Quotation -and "$($_.coverage)" -eq 'Quoted' })) {
                                $null = Erp-Send POST '/api/method/frappe.client.set_value' @{ doctype = 'CMMS Purchase Request Line'; name = "$($rl.name)"; fieldname = @{ coverage = ''; quotation = '' } }
                                $n++
                            }
                            $n
                        }
                        if ($cx.dt -eq 'CMMS Purchase Request') {
                            $null = Erp-Send PUT (Res $cx.dt $d.name) @{ status = 'Closed'; cancel_status = 'Done'; error = $why }
                            $note = 'request closed'
                        } elseif ($cx.dt -eq 'CMMS Purchase Quotation') {
                            $null = Erp-Send PUT (Res $cx.dt $d.name) @{ status = 'Cancelled'; cancel_status = 'Done'; error = $why }
                            $quoteStatus["$($d.name)"] = 'Cancelled'
                            $note = "$(& $reopen "$($d.purchase_request)" "$($d.name)") request line(s) open again"
                        } else {
                            $null = Erp-Send PUT (Res $cx.dt $d.name) @{ status = 'Closed'; cancel_status = 'Done'; error = $why }
                            $qn = "$($d.purchase_quotation)"
                            $null = Erp-Send PUT (Res 'CMMS Purchase Quotation' $qn) @{ status = 'Cancelled'; error = "Its PO $($d.name) (SAP $($sd.DocNum)) was cancelled from the CMMS $(Now-Ist), and SAP keeps this quotation closed. Its request lines are open for a new quotation." }
                            $quoteStatus[$qn] = 'Cancelled'
                            $k = "$($d.purchase_request)"
                            $n = & $reopen $k $qn
                            # This run's own view of the request's POs, as rule 7 keeps it.
                            if ($quotePosByPr.ContainsKey($k)) { $quotePosByPr[$k] = @($quotePosByPr[$k] | Where-Object { $_ -ne "$($sd.DocNum)" }); if (-not $quotePosByPr[$k].Count) { $quotePosByPr.Remove($k) } }
                            if (-not $quoteCancelledByPr.ContainsKey($k)) { $quoteCancelledByPr[$k] = @() }; $quoteCancelledByPr[$k] += "$($sd.DocNum)"
                            # Back to In SAP, so it can be quoted again at once, when no other PO of it is live.
                            if ($k) {
                                $req = (Erp-Get (Res 'CMMS Purchase Request' $k)).data
                                $others = @(Erp-List 'CMMS Purchase Order' @('name') ('[["purchase_request","=",{0}],["status","!=","Closed"],["name","!=",{1}]]' -f (ConvertTo-Json -InputObject $k -Compress), (ConvertTo-Json -InputObject "$($d.name)" -Compress)))
                                $left = @("$($req.po_numbers)" -split '\s*,\s*' | Where-Object { $_ -and $_ -ne "$($sd.DocNum)" })
                                $body = [ordered]@{ po_numbers = ($left -join ', ') }
                                if (-not $others.Count -and "$($req.status)" -eq 'Ordered' -and -not "$($req.po_status)".Trim()) { $body.status = 'In SAP' }
                                $null = Erp-Send PUT (Res 'CMMS Purchase Request' $k) $body
                            }
                            $note = "quotation $qn cancelled, $n request line(s) open for a new quotation"
                        }
                        $entry.action = "cancelled $entity $($sd.DocNum)"; $result.changed++
                        Log INFO ("{0} [{1}]: {2} {3} {4} - {5}" -f $d.name, $db, $entity, $sd.DocNum, $(if ($already) { 'already closed in SAP, finished in the CMMS' } else { 'cancelled in SAP' }), $note)
                    }
                } catch {
                    $msg = $_.Exception.Message
                    $entry.error = $msg; $result.failures++
                    Log ERROR ("{0} [{1}]: not cancelled: {2}" -f $d.name, $db, $msg)
                    if (-not $DryRun) {
                        try { $null = Erp-Send PUT (Res $cx.dt $d.name) @{ cancel_status = 'Failed'; error = "Not cancelled: $msg" } }
                        catch { Log WARN ("{0}: could not write the refusal back: {1}" -f $d.name, $_.Exception.Message) }
                    }
                }
                $result.items += [pscustomobject]$entry
            }

            # ---------------- PASS Q: purchase quotations (post_purchase_quotations, 24 Oct 2026)
            # The chosen vendor's quotation, entered in the CMMS against a request already in SAP: a SAP Purchase Quotation
            # (PurchaseQuotations) whose lines are based on the request's lines (BaseType 1470000113), in the vendor's unit.
            # Reference2 = "PQ<yy>-<n>" makes a re-run adopt it. A quotation whose request is not in SAP yet waits, Queued,
            # with the reason in its error. Proven in HITECH_RUBBER on 24 Oct 2026 (Quotation 6): SAP keeps MeasureUnit and
            # UnitsOfMeasurment as sent on an item of the Manual UoM group; an item on a UoM group does not take them.
            foreach ($q in $w.quotes) {
                $entry = [ordered]@{ kind = 'purchase quotation'; request = "$($q.name)"; sap_db = $db; action = ''; sap_doc = ''; error = '' }
                # Held, not posted, while an HSN one of its lines brought is not in SAP yet - its HSN request not Created
                # (PASS H), or the item's HSN edit failed in this run (PASS B) - as a goods receipt is held. A later run posts it.
                $waits = @()
                foreach ($hn in @($hsnByQuote["$($q.name)"])) {
                    if (-not $hn) { continue }
                    $st = $hsnState[$hn]
                    if ($st -and $st -ne 'Created') { $waits += ("HSN request {0} is {1}" -f $hn, $st) }
                }
                # Any line's item, whether or not the line brought the HSN: SAP would refuse the GST line without it.
                foreach ($l in @($q.lines)) { if ($hsnEditFailed.ContainsKey("$($l.item)")) { $waits += ("HSN of {0} not set in SAP: {1}" -f $l.item, $hsnEditFailed["$($l.item)"]) } }
                if ($waits.Count) {
                    $why = 'waiting for HSN in SAP - ' + ($waits -join ' | ')
                    $entry.action = 'held'; $entry.error = $why
                    Log WARN ("{0} [{1}]: held, not posted - {2}" -f $q.name, $db, $why)
                    if (-not $DryRun) { try { $null = Erp-Send PUT (Res 'CMMS Purchase Quotation' $q.name) @{ error = $why.Substring(0, [Math]::Min(500, $why.Length)) } } catch { Log WARN "could not record the hold on $($q.name): $($_.Exception.Message)" } }
                    $result.items += [pscustomobject]$entry
                    continue
                }
                try {
                    $lines = @($q.lines)
                    if (-not $lines.Count) { throw 'the quotation has no lines' }
                    $rq = (Erp-Get (Res 'CMMS Purchase Request' "$($q.purchase_request)")).data
                    if (-not $rq.sap_doc_entry) {
                        $why = "waiting for purchase request $($q.purchase_request) to reach SAP"
                        Log INFO ("{0} [{1}]: {2}" -f $q.name, $db, $why)
                        if (-not $DryRun) { $null = Erp-Send PUT (Res 'CMMS Purchase Quotation' $q.name) @{ error = $why } }
                        continue
                    }
                    $m = [regex]::Match("$($q.name)", '\d{2}(\d{2})-(\d+)$')
                    $stamp = if ($m.Success) { 'PQ{0}-{1}' -f $m.Groups[1].Value, $m.Groups[2].Value } else { "PQ-$($q.name)" }
                    $found = Sl-All ("PurchaseQuotations?`$select=DocEntry,DocNum&`$filter=Reference2 eq '{0}'" -f $stamp) $jar
                    $pqEntry = $null; $pqNum = ''
                    if ($found.Count -gt 0) { $pqEntry = [int]$found[0].DocEntry; $pqNum = "$($found[0].DocNum)"; $entry.action = 'adopted (already in SAP)' }
                    else {
                        # The request's own lines, for BaseLine: matched by item, which is unique on a request.
                        $rr = Invoke-Sl -Method GET -Url ("$slBase/PurchaseRequests({0})?`$select=DocEntry,DocNum,DocumentStatus,DocumentLines" -f [int]$rq.sap_doc_entry) -Jar $jar
                        if ($rr.Http -ne '200') { Sl-Fail $rr 'read the purchase request' }
                        $rqDoc = $rr.Body | ConvertFrom-Json
                        # A request SAP has closed is quoted all the same (27 Oct 2026): a PO for a line's whole quantity
                        # uses the line up, and cancelling the PO does not give it back - so a request whose PO was
                        # cancelled has its lines open in the CMMS and closed in SAP (PR 54, PR-2026-00416). Such a line
                        # goes on the quotation with no base document, which SAP takes (tested the same day); the CMMS
                        # keeps the tie to the request. A request the CMMS itself closed never reaches here.
                        $baseOf = @{}; foreach ($bl in @($rqDoc.DocumentLines)) { $baseOf["$($bl.ItemCode)".Trim()] = $bl }
                        $comments = ("CMMS {0} by {1}{2}" -f $q.name, $q.raised_by, $(if ((Norm $q.remarks)) { ': ' + (Norm $q.remarks) } else { '' }))
                        if ($comments.Length -gt 254) { $comments = $comments.Substring(0, 254) }
                        $docLines = @()
                        # No tax code and no HSN on a quotation (27 Oct 2026): both come off the bill, on the goods receipt.
                        # Tested in HITECH_RUBBER the same day - SAP takes a request, quotation and PO with neither, and asks
                        # for the HSN only on a GRPO line with a GST tax code. SAP may still default a tax code onto a line
                        # whose item has an HSN; the GRPO's own tax code is what accounts invoice from.
                        foreach ($l in $lines) {
                            $code = "$($l.sap_item_code)".Trim()
                            $bl = $baseOf[$code]
                            if (-not $bl) { throw ("{0} is not on SAP purchase request {1}" -f $code, $rqDoc.DocNum) }
                            # The vendor's unit is a free-text unit on a Manual-group item only.
                            $ir = Invoke-Sl -Method GET -Url ((Key-Url $code) + '?$select=ItemCode,UoMGroupEntry,InventoryUOM') -Jar $jar
                            if ($ir.Http -ne '200') { Sl-Fail $ir "read item $code" }
                            $it = $ir.Body | ConvertFrom-Json
                            if ([int]$it.UoMGroupEntry -ne -1) { throw ("{0} is on SAP UoM group {1}; a vendor's unit works only for items on the Manual group" -f $code, $it.UoMGroupEntry) }
                            $ln = if ("$($bl.LineStatus)" -eq 'bost_Close') {
                                Log INFO ("{0} [{1}]: {2}'s line on SAP purchase request {3} is closed (its PO was cancelled) - quoted with no base document" -f $q.name, $db, $code, $rqDoc.DocNum)
                                [ordered]@{ ItemCode = $code; WarehouseCode = $(if ("$($bl.WarehouseCode)".Trim()) { "$($bl.WarehouseCode)" } else { $whOf }); Quantity = [double]$l.vendor_qty; UnitPrice = [double]$l.price }
                            } else {
                                [ordered]@{ BaseType = 1470000113; BaseEntry = [int]$rq.sap_doc_entry; BaseLine = [int]$bl.LineNum; Quantity = [double]$l.vendor_qty; UnitPrice = [double]$l.price }
                            }
                            $vu = Vendor-Unit $l.vendor_uom $l.inventory_uom ([double]$l.request_qty) ([double]$l.vendor_qty)
                            $ln.MeasureUnit = $vu.unit; $ln.UnitsOfMeasurment = $vu.perUnit
                            $docLines += $ln
                        }
                        $payload = [ordered]@{
                            CardCode = "$($q.vendor_code)".Trim(); DocDate = "$($q.quotation_date)"; TaxDate = "$($q.quotation_date)"
                            # A quotation's DocDueDate is its "valid until"; SAP refuses one without RequriedDate (OINV.ReqDate).
                            DocDueDate = "$($q.valid_until)"; RequriedDate = "$($rq.required_by)"
                            Reference2 = $stamp; Comments = $comments; DocumentLines = $docLines
                        }
                        if ($DryRun) { $entry.action = 'would post PurchaseQuotations'; $entry.payload = $payload }
                        else {
                            $pr = Invoke-Sl -Method POST -Url "$slBase/PurchaseQuotations" -Body ($payload | ConvertTo-Json -Compress -Depth 6) -Jar $jar
                            if ($pr.Http -ne '201' -and $pr.Http -ne '200') { Sl-Fail $pr 'post PurchaseQuotations' }
                            $doc = $pr.Body | ConvertFrom-Json
                            $pqEntry = [int]$doc.DocEntry; $pqNum = "$($doc.DocNum)"
                            $entry.action = 'posted PurchaseQuotations'; $result.changed++
                        }
                    }
                    if ($pqEntry) {
                        $entry.sap_doc = $pqNum
                        $null = Erp-Send PUT (Res 'CMMS Purchase Quotation' $q.name) @{ status = 'Posted'; sap_doc_entry = $pqEntry; sap_doc_number = $pqNum; posted_at = (Now-Ist); error = '' }
                        $result['quotes']++
                        # The item's purchase unit follows the latest quotation, for the record only: nothing reads it
                        # back (decided 24 Oct 2026). A refusal is logged and does not undo the quotation.
                        foreach ($l in $lines) {
                            $code = "$($l.sap_item_code)".Trim(); $unit = Norm $l.vendor_uom
                            try {
                                $ir = Invoke-Sl -Method GET -Url ((Key-Url $code) + '?$select=ItemCode,PurchaseUnit') -Jar $jar
                                if ($ir.Http -eq '200' -and (Norm ($ir.Body | ConvertFrom-Json).PurchaseUnit) -ne $unit) {
                                    $pt = Invoke-Sl -Method PATCH -Url (Key-Url $code) -Body (@{ PurchaseUnit = $unit } | ConvertTo-Json -Compress) -Jar $jar
                                    if ($pt.Http -ne '204' -and $pt.Http -ne '200') { Sl-Fail $pt "set the purchase unit of $code" }
                                    Log INFO ("{0} [{1}]: purchase unit of {2} set to {3}" -f $q.name, $db, $code, $unit)
                                }
                                $null = Erp-Send PUT (Res 'Item' "$($l.item)") @{ custom_purchase_uom = $unit }
                            } catch { Log WARN ("{0} [{1}]: purchase unit of {2} not updated: {3}" -f $q.name, $db, $code, $_.Exception.Message) }
                        }
                    }
                    Log INFO ("{0} [{1}]: {2} {3}{4}" -f $q.name, $db, $entry.action, $entry.sap_doc, $(if ($DryRun -and $entry.Contains('payload')) { ' ' + ($entry.payload | ConvertTo-Json -Compress -Depth 6) } else { '' }))
                } catch {
                    $entry.action = 'failed'; $entry.error = $_.Exception.Message; $result.failures++
                    Log ERROR ("{0} [{1}] quotation: {2}" -f $q.name, $db, $entry.error)
                    if (-not $DryRun) { try { $null = Erp-Send PUT (Res 'CMMS Purchase Quotation' $q.name) @{ status = 'Failed'; error = $entry.error.Substring(0, [Math]::Min(500, $entry.error.Length)) } } catch { Log WARN "could not record the failure on $($q.name): $($_.Exception.Message)" } }
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
                                # No tax code on a PO (27 Oct 2026): the goods receipt brings it, off the bill.
                                [ordered]@{ BaseType = 1470000113; BaseEntry = [int]$po.sap_doc_entry; BaseLine = [int]$bl.LineNum; Quantity = [double]$l.po_qty; UnitPrice = [double]$l.po_price }
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
                        # Set the request to Ordered in the same run, as the open-PO read did (Job mode skips that read -
                        # the request would stay In SAP until the next Routine run). The number is added to its po_numbers.
                        if (-not $DryRun) {
                            $knownPrNums = @("$($po.po_numbers)" -split '\s*,\s*' | Where-Object { $_ })
                            if ($knownPrNums -notcontains $poNum) { $knownPrNums += $poNum }
                            try { $null = Erp-Send PUT (Res 'CMMS Purchase Request' $po.name) @{ status = 'Ordered'; po_numbers = ($knownPrNums -join ', ') } }
                            catch { Log WARN ("{0}: Ordered status not written in-run: {1}" -f $po.name, $_.Exception.Message) }
                        }
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

            # ---------------- PASS P: purchase orders made from quotations (post_quotation_purchase_orders, 24 Oct 2026)
            # One SAP Purchase Order per CMMS PO, every line based on the SAP quotation's line for the same item
            # (BaseType 540000006), at the quoted price and unit, with the quantity the purchase manager gave. Reference2 =
            # "PO<yy>-<n>" from the PO's own number, which the CMMS numbers above every PO once made on a request, so it
            # never adopts one of those. A PO whose quotation is not in SAP yet waits, Queued, with the reason in its error.
            # The POs made on a request (PASS G) are a separate kind behind their own switch.
            foreach ($po in $w.qorders) {
                $entry = [ordered]@{ kind = 'quotation purchase order'; request = "$($po.name)"; sap_db = $db; action = ''; sap_doc = ''; error = '' }
                try {
                    $lines = @($po.lines)
                    if (-not $lines.Count) { throw 'the PO has no lines' }
                    $qt = (Erp-Get (Res 'CMMS Purchase Quotation' "$($po.purchase_quotation)")).data
                    if ("$($qt.status)" -ne 'Posted' -or -not $qt.sap_doc_entry) {
                        $why = "waiting for quotation $($po.purchase_quotation) to reach SAP (it is $($qt.status))"
                        Log INFO ("{0} [{1}]: {2}" -f $po.name, $db, $why)
                        if (-not $DryRun) { $null = Erp-Send PUT (Res 'CMMS Purchase Order' $po.name) @{ error = $why } }
                        continue
                    }
                    $m = [regex]::Match("$($po.name)", '\d{2}(\d{2})-(\d+)$')
                    $stamp = if ($m.Success) { 'PO{0}-{1}' -f $m.Groups[1].Value, $m.Groups[2].Value } else { "PO-$($po.name)" }
                    $found = Sl-All ("PurchaseOrders?`$select=DocEntry,DocNum&`$filter=Reference2 eq '{0}'" -f $stamp) $jar
                    $poEntry = $null; $poNum = ''
                    if ($found.Count -gt 0) { $poEntry = [int]$found[0].DocEntry; $poNum = "$($found[0].DocNum)"; $entry.action = 'adopted (already in SAP)' }
                    else {
                        $qr = Invoke-Sl -Method GET -Url ("$slBase/PurchaseQuotations({0})?`$select=DocEntry,DocNum,DocumentStatus,Cancelled,DocumentLines" -f [int]$qt.sap_doc_entry) -Jar $jar
                        if ($qr.Http -ne '200') { Sl-Fail $qr 'read the quotation' }
                        $qDoc = $qr.Body | ConvertFrom-Json
                        if ("$($qDoc.Cancelled)" -eq 'tYES') { throw "SAP quotation $($qDoc.DocNum) was cancelled in SAP" }
                        if ("$($qDoc.DocumentStatus)" -eq 'bost_Close') { throw "SAP has closed quotation $($qDoc.DocNum)" }
                        $baseOf = @{}; foreach ($bl in @($qDoc.DocumentLines)) { $baseOf["$($bl.ItemCode)".Trim()] = $bl }
                        # The request quantity each quoted line answers, for the estimated items per unit.
                        $askedFor = @{}; foreach ($ql in @($qt.lines)) { $askedFor["$($ql.name)"] = [double]$ql.request_qty }
                        $comments = ("CMMS {0} from {1} by {2}{3}" -f $po.name, $po.purchase_quotation, $po.raised_by, $(if ((Norm $po.remarks)) { ': ' + (Norm $po.remarks) } else { '' }))
                        if ($comments.Length -gt 254) { $comments = $comments.Substring(0, 254) }
                        $docLines = @()
                        foreach ($l in $lines) {
                            $code = "$($l.sap_item_code)".Trim()
                            $bl = $baseOf[$code]
                            if (-not $bl) { throw ("{0} is not on SAP quotation {1}" -f $code, $qDoc.DocNum) }
                            if ("$($bl.LineStatus)" -eq 'bost_Close') { throw ("{0}'s line on SAP quotation {1} is already closed" -f $code, $qDoc.DocNum) }
                            # No tax code on a PO (27 Oct 2026): the goods receipt brings it, off the bill.
                            $ln = [ordered]@{ BaseType = 540000006; BaseEntry = [int]$qt.sap_doc_entry; BaseLine = [int]$bl.LineNum; Quantity = [double]$l.qty; UnitPrice = [double]$l.price }
                            $vu = Vendor-Unit $l.vendor_uom $l.inventory_uom ([double]$askedFor["$($l.quotation_line)"]) ([double]$l.qty)
                            $ln.MeasureUnit = $vu.unit; $ln.UnitsOfMeasurment = $vu.perUnit
                            $docLines += $ln
                        }
                        $payload = [ordered]@{
                            CardCode = "$($po.vendor_code)".Trim(); DocDate = "$($po.po_date)"; TaxDate = "$($po.po_date)"; DocDueDate = "$($po.delivery_date)"
                            Reference2 = $stamp; Comments = $comments; DocumentLines = $docLines
                        }
                        if ($DryRun) { $entry.action = 'would post PurchaseOrders'; $entry.payload = $payload }
                        else {
                            $pr = Invoke-Sl -Method POST -Url "$slBase/PurchaseOrders" -Body ($payload | ConvertTo-Json -Compress -Depth 6) -Jar $jar
                            if ($pr.Http -ne '201' -and $pr.Http -ne '200') { Sl-Fail $pr 'post PurchaseOrders' }
                            $doc = $pr.Body | ConvertFrom-Json
                            $poEntry = [int]$doc.DocEntry; $poNum = "$($doc.DocNum)"
                            $entry.action = 'posted PurchaseOrders'; $result.changed++
                            # Each line's SAP LineNum, which a goods receipt is based on (phase 4); one line per item.
                            foreach ($l in $lines) {
                                $sl = @($doc.DocumentLines | Where-Object { (Norm $_.ItemCode) -eq (Norm $l.sap_item_code) })
                                if ($sl.Count -eq 1) { try { $null = Erp-Send POST '/api/method/frappe.client.set_value' @{ doctype = 'CMMS Purchase Order Line'; name = "$($l.name)"; fieldname = 'sap_line'; value = [int]$sl[0].LineNum } } catch { Log WARN "$($po.name): sap_line not written for $($l.sap_item_code): $($_.Exception.Message)" } }
                            }
                        }
                    }
                    if ($poEntry) {
                        $entry.sap_doc = $poNum
                        $null = Erp-Send PUT (Res 'CMMS Purchase Order' $po.name) @{ sync_status = 'Posted'; sap_doc_entry = $poEntry; sap_doc_number = $poNum; posted_at = (Now-Ist); error = '' }
                        # Off the open PO lines the old receipt screen reads, from this run on: it is received through its own record.
                        $quotePoEntries["$($abbr):$poEntry"] = $true
                        # And one of its request's POs, for the status read at the end of this same run.
                        $k = "$($po.purchase_request)"
                        if ($k) { if (-not $quotePosByPr.ContainsKey($k)) { $quotePosByPr[$k] = @() }; if ($quotePosByPr[$k] -notcontains $poNum) { $quotePosByPr[$k] += $poNum } }
                        # Set the request to Ordered in the same run (Job mode skips the open-PO read, which would set it).
                        if (-not $DryRun -and $k) {
                            try {
                                $req = (Erp-Get (Res 'CMMS Purchase Request' $k)).data
                                $knownPrNums = @("$($req.po_numbers)" -split '\s*,\s*' | Where-Object { $_ })
                                if ($knownPrNums -notcontains $poNum) { $knownPrNums += $poNum }
                                $wantStatus = if ("$($req.status)" -eq 'Closed') { 'Closed' } else { 'Ordered' }
                                $null = Erp-Send PUT (Res 'CMMS Purchase Request' $k) @{ status = $wantStatus; po_numbers = ($knownPrNums -join ', ') }
                            } catch { Log WARN ("{0}: Ordered status not written in-run on {1}: {2}" -f $po.name, $k, $_.Exception.Message) }
                        }
                        $result['qpos']++
                    }
                    Log INFO ("{0} [{1}]: {2} {3}{4}" -f $po.name, $db, $entry.action, $entry.sap_doc, $(if ($DryRun -and $entry.Contains('payload')) { ' ' + ($entry.payload | ConvertTo-Json -Compress -Depth 6) } else { '' }))
                } catch {
                    $entry.action = 'failed'; $entry.error = $_.Exception.Message; $result.failures++
                    Log ERROR ("{0} [{1}] PO: {2}" -f $po.name, $db, $entry.error)
                    if (-not $DryRun) { try { $null = Erp-Send PUT (Res 'CMMS Purchase Order' $po.name) @{ sync_status = 'Failed'; error = $entry.error.Substring(0, [Math]::Min(500, $entry.error.Length)) } } catch { Log WARN "could not record the failure on $($po.name): $($_.Exception.Message)" } }
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
            #   Against a CMMS PO made from a quotation (purchase_order set; post_quotation_receipts, 24 Oct 2026): the
            #   GRPO line is in the vendor's unit - the billed qty at the bill price, with the measured items per unit
            #   (received / billed) - so SAP books exactly the bill (option A, demo test 3). SAP's open quantity is not
            #   checked: it counts it at the PO's own ratio (demo test 5); the CMMS PO, in the vendor's unit, is what
            #   limits a receipt. ERPNext gets the received qty in the stock unit at bill value / received qty,
            #   unrounded, which books the bill to the paisa (conversion-factor test, 24 Oct 2026); the line's rate
            #   field holds only that cost rounded. Revaluation of nil-valued stock is at that cost to 2 decimals
            #   (item 8). Then the PO's received quantities are counted again from its posted receipts, and once every
            #   line is in, the PO turns Purchased and its SAP PO is closed (rule 19).
            # A line's cost per inventory unit: from the bill when billed in the vendor's unit, else the line rate.
            $costOf = { param($l) if ("$($l.order_line)".Trim() -and [double]$l.vendor_qty -gt 0 -and [double]$l.qty -gt 0) { [Math]::Round([double]$l.bill_price * [double]$l.vendor_qty, 2) / [double]$l.qty } else { [double]$l.rate } }
            # A CMMS PO's received quantities, counted afresh from its posted receipts and this one (so a retry never
            # counts a receipt twice), written to its lines; $true when that made it Purchased.
            # POs this run turned Purchased: SAP closing them is not news for the rule 7 read below.
            $purchasedNow = @{}
            $orderProgress = {
                param([string] $Order, [string] $Receipt)
                $counted = @{}
                $names = @(Erp-List 'CMMS Goods Receipt' @('name') ('[["purchase_order","=",{0}],["status","=","Posted"]]' -f (ConvertTo-Json -InputObject $Order -Compress)) | ForEach-Object { "$($_.name)" })
                if ($names -notcontains $Receipt) { $names += $Receipt }
                foreach ($n in $names) { foreach ($gl in @((Erp-Get (Res 'CMMS Goods Receipt' $n)).data.lines)) { $k = "$($gl.order_line)"; if ($k) { $counted[$k] = [double]$counted[$k] + [double]$gl.vendor_qty } } }
                $cur = (Erp-Get (Res 'CMMS Purchase Order' $Order)).data
                $full = $true
                foreach ($ol in @($cur.lines)) {
                    $got = [Math]::Round([double]$counted["$($ol.name)"], 6)
                    if ([Math]::Abs($got - [double]$ol.received_qty) -gt 1e-9) { $null = Erp-Send POST '/api/method/frappe.client.set_value' @{ doctype = 'CMMS Purchase Order Line'; name = "$($ol.name)"; fieldname = 'received_qty'; value = $got } }
                    if ($got + 1e-9 -lt [double]$ol.qty) { $full = $false }
                }
                if ($full -and "$($cur.status)" -eq 'Open') { $null = Erp-Send PUT (Res 'CMMS Purchase Order' $Order) @{ status = 'Purchased' }; $purchasedNow[$Order] = $true; return $true }
                $false
            }
            # Rule 19: SAP would leave a remainder open for good, counted at the PO's own ratio (demo test 5). A refusal
            # does not undo the receipt; it is kept on the PO, which is tried again on the next run ($closeLater).
            $closeSapPo = {
                param([string] $Order, [int] $Entry, [string] $Num)
                try {
                    $st = Invoke-Sl -Method GET -Url ("$slBase/PurchaseOrders({0})?`$select=DocEntry,DocumentStatus" -f $Entry) -Jar $jar
                    if ($st.Http -ne '200') { Sl-Fail $st "read PO $Num" }
                    if ("$(($st.Body | ConvertFrom-Json).DocumentStatus)" -eq 'bost_Open') {
                        $cl = Invoke-Sl -Method POST -Url ("$slBase/PurchaseOrders({0})/Close" -f $Entry) -Jar $jar
                        if ($cl.Http -ne '204' -and $cl.Http -ne '200') { Sl-Fail $cl "close PO $Num" }
                        Log INFO ("{0} [{1}]: Purchased - SAP PO {2} closed" -f $Order, $db, $Num)
                    }
                    $null = Erp-Send PUT (Res 'CMMS Purchase Order' $Order) @{ error = '' }
                } catch {
                    $why = "SAP PO not closed: $($_.Exception.Message)"
                    Log WARN ("{0} [{1}]: {2}" -f $Order, $db, $why)
                    try { $null = Erp-Send PUT (Res 'CMMS Purchase Order' $Order) @{ error = $why.Substring(0, [Math]::Min(500, $why.Length)) } } catch { Log WARN "could not record that on $($Order): $($_.Exception.Message)" }
                }
            }
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
                    $isQuote = $isGr -and "$($rc.purchase_order)".Trim()
                    $cpo = if ($isQuote) { (Erp-Get (Res 'CMMS Purchase Order' "$($rc.purchase_order)".Trim())).data } else { $null }
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
                            if ($isQuote) {
                                foreach ($l in $lines) {
                                    $ol = @($cpo.lines | Where-Object { "$($_.name)" -eq "$($l.order_line)" })
                                    if (-not $ol.Count) { throw "$($rc.purchase_order) has no line $($l.order_line)" }
                                    $ol = $ol[0]
                                    $code = Norm $l.sap_item_code
                                    # sap_line as PASS P wrote it; a PO posted before it did, found by its item (one line per item).
                                    $pl = @($po.DocumentLines | Where-Object { [int]$_.LineNum -eq [int]$ol.sap_line -and (Norm $_.ItemCode) -eq $code })
                                    if (-not $pl.Count) { $pl = @($po.DocumentLines | Where-Object { (Norm $_.ItemCode) -eq $code }) }
                                    if ($pl.Count -ne 1) { throw "PO $($po.DocNum) has $($pl.Count) lines for $code; expected one" }
                                    $pl = $pl[0]
                                    if ("$($pl.LineStatus)" -ne 'bost_Open') { throw "PO $($po.DocNum) line $($pl.LineNum) ($code) is closed in SAP" }
                                    $ir = Invoke-Sl -Method GET -Url ((Key-Url $code) + '?$select=ItemCode,UoMGroupEntry') -Jar $jar
                                    if ($ir.Http -ne '200') { Sl-Fail $ir "read item $code" }
                                    if ([int](($ir.Body | ConvertFrom-Json).UoMGroupEntry) -ne -1) { throw "$code is on a SAP UoM group, which cannot take the measured $($l.uom) per $($l.vendor_uom); move it to the Manual group" }
                                    $vq = [double]$l.vendor_qty
                                    if ($vq -le 0 -or [double]$l.qty -le 0) { throw "$code has no billed or received quantity" }
                                    $docLines += [ordered]@{
                                        BaseType = 22; BaseEntry = $poEntry; BaseLine = [int]$pl.LineNum; WarehouseCode = (& $lineWh $l "$($pl.WarehouseCode)")
                                        Quantity = $vq; UnitPrice = [double]$l.bill_price; MeasureUnit = (Norm $l.vendor_uom); UnitsOfMeasurment = [Math]::Round([double]$l.qty / $vq, 6)
                                        # The bill's tax code, typed on the receipt (27 Oct 2026); a receipt entered before then has none
                                        # of its own and keeps the PO line's.
                                        TaxCode = $(if ((Norm $l.tax_code)) { Norm $l.tax_code } else { "$($pl.TaxCode)" })
                                    }
                                    if ([int]$ol.sap_line -ne [int]$pl.LineNum -and -not $DryRun) { $null = Erp-Send POST '/api/method/frappe.client.set_value' @{ doctype = 'CMMS Purchase Order Line'; name = "$($ol.name)"; fieldname = 'sap_line'; value = [int]$pl.LineNum } }
                                }
                            }
                            foreach ($l in @(if (-not $isQuote) { $lines })) {
                                $pl = @($po.DocumentLines | Where-Object { [int]$_.LineNum -eq [int]$l.po_line })
                                if (-not $pl.Count) { throw "PO $($po.DocNum) has no line $($l.po_line)" }
                                $pl = $pl[0]
                                if ((Norm $pl.ItemCode) -ne (Norm $l.sap_item_code)) { throw "PO $($po.DocNum) line $($l.po_line) is $($pl.ItemCode), not $($l.sap_item_code)" }
                                if ("$($pl.LineStatus)" -ne 'bost_Open' -or [double]$pl.RemainingOpenQuantity -lt [double]$l.qty) {
                                    throw ("PO {0} line {1} ({2}) has {3} open in SAP; the receipt is for {4}" -f $po.DocNum, $l.po_line, $pl.ItemCode, $pl.RemainingOpenQuantity, $l.qty)
                                }
                                $gl = [ordered]@{ BaseType = 22; BaseEntry = $poEntry; BaseLine = [int]$l.po_line; Quantity = [double]$l.qty; WarehouseCode = (& $lineWh $l "$($pl.WarehouseCode)") }
                                # The bill's tax code (27 Oct 2026); without one SAP copies the PO line's, as before.
                                if ((Norm $l.tax_code)) { $gl.TaxCode = (Norm $l.tax_code) }
                                $docLines += $gl
                            }

                            # SAP takes a GRPO line's HSN from the PO line it is based on, ignores one sent with it, and refuses a
                            # GST tax code without one (GR-2026-00410, 27 Oct 2026). A PO carries no HSN since quotations stopped
                            # asking for one, so each PO line without it gets the item's first - which PASS H / PASS B put on the
                            # item earlier in this run when the bill brought it. Tested in HITECH_RUBBER the same day (PO 303).
                            $poHsn = @()
                            foreach ($gl in $docLines) {
                                $bl = @($po.DocumentLines | Where-Object { [int]$_.LineNum -eq [int]$gl.BaseLine })[0]
                                if ([int]("0$($bl.HSNEntry)" -replace '^0-', '-') -gt 0) { continue }
                                $ir = Invoke-Sl -Method GET -Url ((Key-Url "$($bl.ItemCode)") + '?$select=ItemCode,ChapterID') -Jar $jar
                                if ($ir.Http -ne '200') { Sl-Fail $ir "read item $($bl.ItemCode)" }
                                $ch = [int]("0$(($ir.Body | ConvertFrom-Json).ChapterID)" -replace '^0-', '-')
                                if ($ch -gt 0) { $poHsn += [ordered]@{ LineNum = [int]$bl.LineNum; HSNEntry = $ch } }
                            }
                            if ($poHsn.Count) {
                                $what = ($poHsn | ForEach-Object { "line $($_.LineNum) -> $($_.HSNEntry)" }) -join ', '
                                if ($DryRun) { Log INFO ("{0} [{1}]: would set HSN on SAP PO {2}: {3}" -f $rc.name, $db, $po.DocNum, $what) }
                                else {
                                    $pp = Invoke-Sl -Method PATCH -Url ("$slBase/PurchaseOrders({0})" -f $poEntry) -Body (@{ DocumentLines = @($poHsn) } | ConvertTo-Json -Compress -Depth 4) -Jar $jar
                                    if ($pp.Http -ne '204' -and $pp.Http -ne '200') { Sl-Fail $pp "set the HSN on PO $($po.DocNum)" }
                                    Log INFO ("{0} [{1}]: HSN set on SAP PO {2}: {3}" -f $rc.name, $db, $po.DocNum, $what)
                                }
                            }

                            if ($revalueNil) {
                                $reval = @()
                                foreach ($l in $lines) {
                                    $cost = [Math]::Round((& $costOf $l), 2)
                                    if ($cost -le 0) { continue }
                                    $wh = & $lineWh $l $whOf
                                    $ir = Invoke-Sl -Method GET -Url ((Key-Url "$($l.sap_item_code)") + '?$select=ItemCode,ItemWarehouseInfoCollection') -Jar $jar
                                    if ($ir.Http -ne '200') { Sl-Fail $ir "read item $($l.sap_item_code)" }
                                    $wi = @(($ir.Body | ConvertFrom-Json).ItemWarehouseInfoCollection | Where-Object { "$($_.WarehouseCode)" -eq $wh })
                                    if ($wi.Count -and [double]$wi[0].InStock -gt 0 -and [double]$wi[0].StandardAveragePrice -eq 0 -and -not @($reval | Where-Object { $_.ItemCode -eq "$($l.sap_item_code)" -and $_.WarehouseCode -eq $wh }).Count) {
                                        $reval += [ordered]@{ ItemCode = "$($l.sap_item_code)"; WarehouseCode = $wh; Price = $cost }
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
                                    $cost = [Math]::Round((& $costOf $l), 2)
                                    if ($cost -le 0 -or @($recoItems | Where-Object { $_.item_code -eq "$($l.item)" }).Count) { continue }
                                    $bins = @(Erp-List 'Bin' @('actual_qty', 'valuation_rate') ('[["item_code","=",' + (ConvertTo-Json -InputObject "$($l.item)" -Compress) + '],["warehouse","=",' + (ConvertTo-Json -InputObject $store -Compress) + ']]'))
                                    if ($bins.Count -and [double]$bins[0].actual_qty -gt 0 -and [double]$bins[0].valuation_rate -eq 0) {
                                        $recoItems += @{ item_code = "$($l.item)"; warehouse = $store; qty = [double]$bins[0].actual_qty; valuation_rate = $cost }
                                    }
                                }
                            }
                            $recoName = ''
                            if ($recoItems.Count) {
                                $reco = (Erp-Send POST (Res 'Stock Reconciliation' '') @{ company = $company; purpose = 'Stock Reconciliation'; posting_date = $today; set_posting_time = 1; docstatus = 1; items = $recoItems; remarks = "CMMS $($rc.name): nil-valued stock revalued to the goods receipt price" }).data
                                $recoName = "$($reco.name)"
                            }
                            # Unrounded: ERPNext keeps the rate to 9 decimals, so received qty x cost is the bill to the paisa.
                            $seItems = @(foreach ($l in $lines) { $cost = & $costOf $l; @{ item_code = "$($l.item)"; qty = [double]$l.qty; t_warehouse = $store; basic_rate = $cost; conversion_factor = 1; allow_zero_valuation_rate = $(if ($cost -le 0) { 1 } else { 0 }) } })
                            $se = (Erp-Send POST (Res 'Stock Entry' '') @{
                                stock_entry_type = 'Material Receipt'; purpose = 'Material Receipt'; company = $company; posting_date = $today; set_posting_time = 1; docstatus = 1
                                remarks = $(if ($isQuote) { "CMMS $($rc.name): GRPO $docNum against PO $($rc.sap_po_number) ($($rc.purchase_order)), bill $($rc.bill_no)" } elseif ($isGr) { "CMMS $($rc.name): GRPO $docNum against PO $($rc.sap_po_number), bill $($rc.bill_no)" } else { "CMMS $($rc.name): SAP Goods Receipt $docNum, no bill, nil value" })
                                items = $seItems
                            }).data
                            foreach ($l in $lines) {
                                $cost = [Math]::Round((& $costOf $l), 2)
                                if ($cost -le 0) { continue }
                                $cur = (Erp-Get ((Res 'Item' "$($l.item)") + '?fields=["valuation_rate"]')).data
                                if ([double]("0$($cur.valuation_rate)") -eq 0) { $null = Erp-Send PUT (Res 'Item' "$($l.item)") @{ valuation_rate = $cost } }
                            }
                            $entry.erp = "$($se.name)"
                            $null = Erp-Send PUT (Res 'CMMS Goods Receipt' $rc.name) @{ erp_stock_entry = "$($se.name)"; erp_reconciliation = $recoName }
                        }
                        # Before Posted: if this fails the receipt is Failed and Send again counts the PO afresh.
                        if ($isQuote) {
                            $order = "$($rc.purchase_order)".Trim()
                            if (& $orderProgress $order "$($rc.name)") {
                                $entry.po = "$order Purchased"
                                & $closeSapPo $order ([int]$rc.sap_po_entry) "$($rc.sap_po_number)"
                            }
                        }
                        $null = Erp-Send PUT (Res 'CMMS Goods Receipt' $rc.name) @{ status = 'Posted'; posted_at = (Now-Ist); error = '' }
                        $result['receipts']++
                    }
                    Log INFO ("{0} [{1}] {2}: {3} {4}{5}{6}{7}" -f $rc.name, $db, $rc.kind, $entry.action, $entry.sap_doc, $(if ($entry.revaluation) { " revaluation $($entry.revaluation)" } else { '' }), $(if ($DryRun -and $entry.Contains('payload')) { ' ' + ($entry.payload | ConvertTo-Json -Compress -Depth 6) } elseif ($entry.erp) { " ERPNext $($entry.erp)" } else { '' }), $(if ($entry.Contains('po')) { "; $($entry.po)" } else { '' }))
                } catch {
                    $msg = $_.Exception.Message
                    if ($sapDone) { $msg = "Posted in SAP as $docNum, but ERPNext refused: $msg" }
                    $entry.action = 'failed'; $entry.error = $msg; $result.failures++
                    Log ERROR ("{0} [{1}]: {2}" -f $rc.name, $db, $msg)
                    if (-not $DryRun) { try { $null = Erp-Send PUT (Res 'CMMS Goods Receipt' $rc.name) @{ status = 'Failed'; error = $msg.Substring(0, [Math]::Min(500, $msg.Length)) } } catch { Log WARN "could not record the failure on $($rc.name): $($_.Exception.Message)" } }
                }
                $result.items += [pscustomobject]$entry
            }

            # Purchased POs whose SAP PO an earlier run could not close.
            if (-not $DryRun) { foreach ($cl in @($closeLater | Where-Object { "$($_.company)" -eq $abbr -and $_.sap_doc_entry })) { & $closeSapPo "$($cl.name)" ([int]$cl.sap_doc_entry) "$($cl.sap_doc_number)" } }

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

            # ---------------- PASS E: fetch from SAP (pull_from_sap) - the engineering item groups only
            # Items in this company's engineering groups: one SAP has that the CMMS lacks is created in ERPNext
            # (e.g. ENG-437..439, made in SAP on 30 Sep); a SAP-side change to name, groups, HSN, tax, minimum or
            # active state is copied - unless the CMMS has an edit of its own waiting (PASS B sends that one).
            # An item moved out of the engineering groups in SAP is disabled here. Then the on-hand quantity:
            # SAP's QuantityOnStock against the company's ERPNext store, and the differences posted as one Stock
            # Reconciliation (absolute quantities, current valuation kept) - the same measure the 24 Sep opening
            # stock used. Runs after PASS C, so a receipt posted this run is already on both sides.
            # Routine mode only (27 Oct 2026): a Job run never fetches, to keep the flag -> SAP login time low.
            if ($pullFromSap -and $isRoutine) {
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

            # ---------------- quotations and POs cancelled or closed in SAP (rule 7, 25 Oct 2026)
            # Cancelling is done in SAP only, so only this read can see it. A quotation SAP cancelled (or closed with no
            # PO from the CMMS) turns Cancelled and frees its request lines for a new quotation. A PO SAP cancelled turns
            # Closed and comes off its request; SAP keeps its quotation closed, so the quotation is Cancelled and the request
            # lines it covered are dropped ("PO n cancelled in SAP") - a new purchase request buys them again (the user,
            # 24 Oct 2026). A PO SAP closed while goods were still pending - a heavier receipt brings in its quantity at the
            # PO's own ratio - turns Closed with what was pending, accepted as it is: the rest goes on a new request.
            # Reads SAP and writes the CMMS only (closing the request in SAP is rule 15's); a dry run says what it would do.
            # Routine mode only (27 Oct 2026): Job runs never check cancellations.
            $noteCancel = { param([string] $Doctype, [string] $Name, [hashtable] $Body) if (-not $DryRun) { $null = Erp-Send PUT (Res $Doctype $Name) $Body } }
            if ($isRoutine) {
            foreach ($q in @($watchQuotes | Where-Object { "$($_.company)" -eq $abbr -and -not "$($_.purchase_order)".Trim() })) {
                try {
                    $qr = Invoke-Sl -Method GET -Url ("$slBase/PurchaseQuotations({0})?`$select=DocEntry,DocNum,DocumentStatus,Cancelled" -f [int]$q.sap_doc_entry) -Jar $jar
                    if ($qr.Http -ne '200') { Sl-Fail $qr "read quotation $($q.sap_doc_number)" }
                    $qd = $qr.Body | ConvertFrom-Json
                    $gone = if ("$($qd.Cancelled)" -eq 'tYES') { 'Cancelled in SAP' } elseif ("$($qd.DocumentStatus)" -eq 'bost_Close') { 'Closed in SAP with no PO from the CMMS' } else { '' }
                    if (-not $gone) { continue }
                    $why = "$gone (quotation $($qd.DocNum)) $(Now-Ist); its request lines are open for a new quotation."
                    & $noteCancel 'CMMS Purchase Quotation' "$($q.name)" @{ status = 'Cancelled'; error = $why }
                    $reopened = 0
                    if (-not $DryRun -and "$($q.purchase_request)") {
                        foreach ($rl in @((Erp-Get (Res 'CMMS Purchase Request' "$($q.purchase_request)")).data.lines | Where-Object { "$($_.quotation)" -eq "$($q.name)" -and "$($_.coverage)" -eq 'Quoted' })) {
                            $null = Erp-Send POST '/api/method/frappe.client.set_value' @{ doctype = 'CMMS Purchase Request Line'; name = "$($rl.name)"; fieldname = @{ coverage = ''; quotation = '' } }
                            $reopened++
                        }
                    }
                    $quoteStatus["$($q.name)"] = 'Cancelled'
                    Log INFO ("{0} [{1}]: {2}{3}" -f $q.name, $db, $(if ($DryRun) { 'would mark Cancelled - ' } else { 'Cancelled - ' }), "$gone, quotation $($qd.DocNum)$(if ($reopened) { "; $reopened request line(s) open again" })")
                } catch { Log WARN ("{0}: cancellation not read from SAP: {1}" -f $q.name, $_.Exception.Message) }
            }
            foreach ($o in @($watchOrders | Where-Object { "$($_.company)" -eq $abbr -and -not $purchasedNow.ContainsKey("$($_.name)") })) {
                try {
                    $or = Invoke-Sl -Method GET -Url ("$slBase/PurchaseOrders({0})?`$select=DocEntry,DocNum,DocumentStatus,Cancelled" -f [int]$o.sap_doc_entry) -Jar $jar
                    if ($or.Http -ne '200') { Sl-Fail $or "read PO $($o.sap_doc_number)" }
                    $od = $or.Body | ConvertFrom-Json
                    if ("$($od.Cancelled)" -eq 'tYES') {
                        $why = "Cancelled in SAP (PO $($od.DocNum)) $(Now-Ist)."
                        $k = "$($o.purchase_request)"
                        # Only once it is written: a dry run must not move the request on a change it did not make.
                        if ($k -and -not $DryRun) {
                            if ($quotePosByPr.ContainsKey($k)) { $quotePosByPr[$k] = @($quotePosByPr[$k] | Where-Object { $_ -ne "$($od.DocNum)" }); if (-not $quotePosByPr[$k].Count) { $quotePosByPr.Remove($k) } }
                            if (-not $quoteCancelledByPr.ContainsKey($k)) { $quoteCancelledByPr[$k] = @() }; $quoteCancelledByPr[$k] += "$($od.DocNum)"
                        }
                        # SAP keeps the quotation closed when a PO based on it is cancelled (HITECH_RUBBER, 24 Oct 2026:
                        # PO 290 cancelled, quotation 12 stayed closed), so no new PO can be made from it: it is marked
                        # Cancelled with the PO. Should SAP ever open it again, the quotation is freed to make a new PO.
                        $qt = (Erp-Get (Res 'CMMS Purchase Quotation' "$($o.purchase_quotation)")).data
                        $qo = Invoke-Sl -Method GET -Url ("$slBase/PurchaseQuotations({0})?`$select=DocEntry,DocNum,DocumentStatus,Cancelled" -f [int]$qt.sap_doc_entry) -Jar $jar
                        $qOpen = $qo.Http -eq '200' -and "$(($qo.Body | ConvertFrom-Json).DocumentStatus)" -eq 'bost_Open'
                        if ($qOpen) { $why += " Quotation $($o.purchase_quotation) is open in SAP again, so a new PO can be made from it." }
                        else { $why += " SAP keeps quotation $($o.purchase_quotation) closed, so its request lines are dropped; raise a new purchase request to buy them." }
                        & $noteCancel 'CMMS Purchase Order' "$($o.name)" @{ status = 'Closed'; error = $why }
                        if ("$($qt.purchase_order)" -eq "$($o.name)") {
                            if ($qOpen) { & $noteCancel 'CMMS Purchase Quotation' "$($qt.name)" @{ purchase_order = '' } }
                            else { & $noteCancel 'CMMS Purchase Quotation' "$($qt.name)" @{ status = 'Cancelled'; error = "Its PO $($o.name) (SAP $($od.DocNum)) was cancelled in SAP $(Now-Ist), and SAP keeps this quotation closed." }; $quoteStatus["$($qt.name)"] = 'Cancelled' }
                        }
                        # Nothing in SAP can buy those lines now - the quotation and the request lines are closed there -
                        # so they are dropped, as an old PO cancelled in SAP ends its request (the user, 20 and 24 Oct
                        # 2026); a new purchase request buys them again. The rule 15 read below then closes the request
                        # if nothing else on it is live.
                        if (-not $qOpen -and -not $DryRun -and "$($o.purchase_request)") {
                            $req = (Erp-Get (Res 'CMMS Purchase Request' "$($o.purchase_request)")).data
                            $mine = @($req.lines | Where-Object { "$($_.coverage)" -eq 'Quoted' -and "$($_.quotation)" -eq "$($qt.name)" })
                            foreach ($rl in $mine) {
                                $null = Erp-Send POST '/api/method/frappe.client.set_value' @{ doctype = 'CMMS Purchase Request Line'; name = "$($rl.name)"; fieldname = @{ coverage = 'Dropped'; quotation = ''; drop_reason = "PO $($od.DocNum) cancelled in SAP" } }
                            }
                            if ($mine.Count) {
                                Log INFO ("{0} [{1}]: {2} line(s) dropped - PO {3} cancelled in SAP" -f $o.purchase_request, $db, $mine.Count, $od.DocNum)
                                if (-not @($droppedPrs | Where-Object { "$($_.name)" -eq "$($req.name)" }).Count) {
                                    $droppedPrs = @($droppedPrs) + @([pscustomobject]@{ name = "$($req.name)"; company = "$($req.company)"; sap_doc_entry = $req.sap_doc_entry; sap_doc_number = "$($req.sap_doc_number)" })
                                }
                            }
                        }
                        Log INFO ("{0} [{1}]: {2}{3}" -f $o.name, $db, $(if ($DryRun) { 'would close - ' } else { 'Closed - ' }), $why)
                    } elseif ("$($od.DocumentStatus)" -eq 'bost_Close') {
                        $cpo = (Erp-Get (Res 'CMMS Purchase Order' "$($o.name)")).data
                        $pend = @($cpo.lines | Where-Object { [double]$_.qty - [double]$_.received_qty -gt 1e-9 } | ForEach-Object { "{0} {1} of {2}" -f ([Math]::Round([double]$_.qty - [double]$_.received_qty, 6)), $_.vendor_uom, $_.item_name })
                        # Accepted as it is (the user, 24 Oct 2026): SAP closes a PO early when a heavier receipt brings in
                        # its quantity at the PO's own ratio; the rest is bought on a new purchase request.
                        $why = "Closed in SAP (PO $($od.DocNum)) $(Now-Ist)$(if ($pend.Count) { ' with ' + ($pend -join ', ') + ' not received; raise a new purchase request for the rest' } else { '; nothing more is received against it' })."
                        & $noteCancel 'CMMS Purchase Order' "$($o.name)" @{ status = 'Closed'; error = $why }
                        Log INFO ("{0} [{1}]: {2}{3}" -f $o.name, $db, $(if ($DryRun) { 'would close - ' } else { 'Closed - ' }), $why)
                    }
                } catch { Log WARN ("{0}: cancellation not read from SAP: {1}" -f $o.name, $_.Exception.Message) }
            }

            # ---------------- a request's dropped lines, closed in SAP (rule 15, 25 Oct 2026)
            # Once every line of a request is either dropped or on a quotation SAP has, nothing more will be bought from
            # its SAP purchase request: the quoted lines are closed there already (copied to the quotation), so what is
            # still open is the dropped lines - closed now, so SAP does not list them as wanted. A request whose lines
            # were all dropped ends Closed here too.
            $allDropped = @{}
            foreach ($dp in @($droppedPrs | Where-Object { "$($_.company)" -eq $abbr })) {
                try {
                    $doc = (Erp-Get (Res 'CMMS Purchase Request' "$($dp.name)")).data
                    $lines = @($doc.lines)
                    if (@($lines | Where-Object { -not "$($_.coverage)" }).Count) { continue }
                    if (@($lines | Where-Object { "$($_.coverage)" -eq 'Quoted' -and $quoteStatus["$($_.quotation)"] -ne 'Posted' }).Count) { continue }
                    if (-not @($lines | Where-Object { "$($_.coverage)" -eq 'Quoted' }).Count) { $allDropped["$($dp.name)"] = $true }
                    $rr = Invoke-Sl -Method GET -Url ("$slBase/PurchaseRequests({0})?`$select=DocEntry,DocumentStatus" -f [int]$dp.sap_doc_entry) -Jar $jar
                    if ($rr.Http -ne '200') { Sl-Fail $rr "read purchase request $($dp.sap_doc_number)" }
                    if ("$(($rr.Body | ConvertFrom-Json).DocumentStatus)" -ne 'bost_Open') { continue }
                    $nDropped = @($lines | Where-Object { "$($_.coverage)" -eq 'Dropped' }).Count
                    if ($DryRun) { Log INFO ("{0} [{1}]: would close SAP purchase request {2} - {3} line(s) dropped, the rest quoted" -f $dp.name, $db, $dp.sap_doc_number, $nDropped); continue }
                    $cl = Invoke-Sl -Method POST -Url ("$slBase/PurchaseRequests({0})/Close" -f [int]$dp.sap_doc_entry) -Jar $jar
                    if ($cl.Http -ne '204' -and $cl.Http -ne '200') { Sl-Fail $cl "close purchase request $($dp.sap_doc_number)" }
                    Log INFO ("{0} [{1}]: SAP purchase request {2} closed - {3} line(s) dropped, the rest quoted" -f $dp.name, $db, $dp.sap_doc_number, $nDropped)
                } catch { Log WARN ("{0}: dropped lines not closed in SAP: {1}" -f $dp.name, $_.Exception.Message) }
            }
            } # end if ($isRoutine) - cancellations and dropped-lines close

            # ---------------- open PO lines for engineering items, for the CMMS goods receipt form
            # Read after PASS C, so a GRPO just posted is already off the open quantity. The same read finds the
            # POs raised from CMMS purchase requests: their lines carry BaseType 1470000113 (Purchase Request).
            # Routine mode only (27 Oct 2026): Job mode marks a request Ordered in PASS G / PASS P instead of reading
            # the open POs. A Routine run refreshes the lines a goods receipt form offers.
            $prToPo = @{}
            if ($isRoutine) { try {
                $codes = if ($mirror.ContainsKey($abbr)) { $mirror[$abbr] } else { @{} }
                $pos = New-Object System.Collections.ArrayList
                foreach ($po in (Sl-All "PurchaseOrders?`$select=DocEntry,DocNum,CardCode,CardName,DocDate,DocumentLines&`$filter=DocumentStatus eq 'bost_Open'" $jar)) {
                    # A PO made from a quotation is received through its own CMMS record, never offered here (24 Oct 2026).
                    if ($quotePoEntries.ContainsKey("$($abbr):$($po.DocEntry)")) { continue }
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
                        # The POs made from its quotations (24 Oct 2026), which SAP bases on the quotation rather than on it.
                        if ($quotePosByPr.ContainsKey("$($pq.name)")) { $new = @(@($new) + @($quotePosByPr["$($pq.name)"]) | Select-Object -Unique) }
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
                        # Its POs from quotations that SAP cancelled (rule 7), which the read above cannot tie to it.
                        $name = "$($pq.name)"
                        if ($quoteCancelledByPr.ContainsKey($name)) { $cancelled = @(@($cancelled) + @($known | Where-Object { $quoteCancelledByPr[$name] -contains $_ -and @($new) -notcontains $_ }) | Select-Object -Unique) }
                        $quoteBased = $quotedPrs.ContainsKey($name) -or $quotePosByPr.ContainsKey($name) -or $quoteCancelledByPr.ContainsKey($name)
                        $all = @(@($known) + @($new) | Select-Object -Unique | Where-Object { $cancelled -notcontains $_ })
                        $status = if ($all.Count) { 'Ordered' } else { 'In SAP' }
                        $edit = [ordered]@{}
                        if ($quoteBased -and -not $all.Count) {
                            # Quoted (24 Oct 2026): SAP closes the request once every line is on a quotation, and a PO
                            # cancelled in SAP can be made again from its quotation, so neither ends it. Only every line
                            # dropped does (rule 15, above).
                            # The note is written with the move only, so a later run finds nothing to change.
                            if ($allDropped.ContainsKey($name)) { $status = 'Closed'; if ("$($pq.status)" -ne 'Closed') { $edit.error = "Every line was dropped - request closed $(Now-Ist)" } }
                            elseif ($cancelled.Count -and "$($pq.status)" -ne 'In SAP') { $edit.error = ("SAP PO {0} was cancelled in SAP" -f ($cancelled -join ', ')) }
                        } elseif ($cancelled.Count -and -not $all.Count) {
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
            } catch { Log WARN ("{0}: open PO lines not refreshed: {1}" -f $db, $_.Exception.Message) } }

            # ---------------- suppliers and purchase tax codes, for the CMMS PO form (post_purchase_orders)
            # Routine mode: refreshes hourly, as before.
            # Job mode (27 Oct 2026): only when the app asked for this company (vendor_refresh_requested).
            $askedVendors = $vendRefresh -contains "$abbr".ToUpper()
            if (($isRoutine -and ($postPos -or $postQuotes)) -or $askedVendors) {
                try {
                    $stale = $true
                    if ($opt.PSObject.Properties['vendors_refreshed_at'] -and "$($opt.vendors_refreshed_at)") {
                        try { $stale = ((Get-Date) - [datetime]::ParseExact("$($opt.vendors_refreshed_at)", 'yyyy-MM-dd HH:mm:ss', $null)).TotalMinutes -ge 60 } catch { $stale = $true }
                    }
                    # A list published before supplier states were (24 Oct 2026) is read again at once, not in an hour.
                    $noStates = @($opt.vendors).Count -gt 0 -and -not @(@($opt.vendors) | Where-Object { $_.PSObject.Properties['state'] }).Count
                    if ($stale -or $noStates -or $w.orders.Count -or $w.quotes.Count) {
                        # Each supplier's state, from its default bill-to address (else its first bill-to, else any): with the
                        # company's state it decides GST - the same state takes CGST+SGST, another state IGST (SAP refused
                        # PQ-2026-00352 for EXEMPT and PQ-2026-00350 for CGST+SGST, 24 Oct 2026).
                        $vend = @((Sl-All "BusinessPartners?`$select=CardCode,CardName,BilltoDefault,BPAddresses&`$filter=CardType eq 'cSupplier' and Valid eq 'tYES' and Frozen eq 'tNO'&`$orderby=CardName" $jar) |
                            ForEach-Object {
                                $bp = $_
                                $bill = @(@($bp.BPAddresses) | Where-Object { "$($_.AddressType)" -eq 'bo_BillTo' })
                                $pick = @($bill | Where-Object { "$($_.AddressName)" -eq "$($bp.BilltoDefault)" })
                                $addr = if ($pick.Count) { $pick[0] } elseif ($bill.Count) { $bill[0] } else { @($bp.BPAddresses)[0] }
                                [ordered]@{ code = "$($bp.CardCode)"; name = (Norm $bp.CardName); state = $(if ($addr) { Norm $addr.State } else { '' }) }
                            })
                        $taxes = @()
                        # Each tax code's kind from its components (STAType -100 CGST, -110 SGST, -120 IGST), not from its name.
                        try { $taxes = @((Sl-All "SalesTaxCodes?`$select=Code,Name,Rate,Inactive,SalesTaxCodes_Lines" $jar) | Where-Object { "$($_.Inactive)" -ne 'tYES' } |
                            ForEach-Object {
                                $types = @(@($_.SalesTaxCodes_Lines) | ForEach-Object { [int]$_.STAType })
                                $kind = if ($types -contains -120) { 'igst' } elseif ($types -contains -100 -and $types -contains -110) { 'cgst_sgst' } else { 'other' }
                                [ordered]@{ code = "$($_.Code)"; name = (Norm $_.Name); rate = [double]("0$($_.Rate)"); kind = $kind }
                            }) }
                        catch { Log WARN ("{0}: tax codes not read, the PO form offers SAP's default only: {1}" -f $db, $_.Exception.Message) }
                        $opt | Add-Member -NotePropertyName vendors -NotePropertyValue $vend -Force
                        $opt | Add-Member -NotePropertyName tax_codes -NotePropertyValue $taxes -Force
                        $opt | Add-Member -NotePropertyName vendors_refreshed_at -NotePropertyValue (Now-Ist) -Force
                        $optionsChanged = $true
                        Log INFO ("{0}: {1} supplier(s), {2} tax code(s) published for the PO form" -f $db, $vend.Count, $taxes.Count)
                    }
                } catch { Log WARN ("{0}: suppliers not refreshed: {1}" -f $db, $_.Exception.Message) }
            }

            # ---------------- the company as SAP knows it, for the CMMS's printed forms (24 Oct 2026)
            # Name, address, phones and email from Administration > Company Details: the letterhead of the quotation
            # printout. One read per run, published only when it changed. Read only; a dry run reads it too.
            # Routine mode only (27 Oct 2026).
            if ($isRoutine) { try {
                $ai = Invoke-Sl -Method POST -Url "$slBase/CompanyService_GetAdminInfo" -Body '{}' -Jar $jar
                if ($ai.Http -ne '200') { Sl-Fail $ai 'read the company details' }
                $a = $ai.Body | ConvertFrom-Json
                $info = [ordered]@{
                    name = Norm $a.CompanyName
                    printing_header = Norm $a.PrintingHeader
                    # SAP keeps the address as one text with a line break between street, city and state.
                    address = @("$($a.Address)" -split "[\r\n]+" | ForEach-Object { Norm $_ } | Where-Object { $_ })
                    phone = @(@($a.PhoneNumber1, $a.PhoneNumber2) | ForEach-Object { Norm $_ } | Where-Object { $_ })
                    fax = Norm $a.FaxNumber
                    email = Norm $a.eMail
                    tax_id = Norm $a.FederalTaxID
                    # SAP's state code (KL): set against each supplier's to choose CGST+SGST or IGST.
                    state = Norm $a.State
                }
                $before = if ($opt.PSObject.Properties['company_info']) { $opt.company_info | ConvertTo-Json -Compress -Depth 4 } else { '' }
                $after = [pscustomobject]$info | ConvertTo-Json -Compress -Depth 4
                if ($before -ne $after) {
                    $opt | Add-Member -NotePropertyName company_info -NotePropertyValue ([pscustomobject]$info) -Force
                    $optionsChanged = $true
                    Log INFO ("{0}: company details published - {1}, {2} address line(s)" -f $db, $info.name, $info.address.Count)
                }
            } catch { Log WARN ("{0}: company details not refreshed: {1}" -f $db, $_.Exception.Message) } }

            # ---------------- SAP's whole unit list, for a quotation's vendor unit (25 Oct 2026)
            # Not "units", which is the short list an item is created with: a vendor sells by the BAG, DRM or CTN, which
            # no engineering item is stocked in. "Manual" is SAP's placeholder for a unit typed by hand, not a unit.
            # Routine mode only (27 Oct 2026).
            if ($isRoutine) { try {
                # A foreach statement: Sl-All hands its rows down a pipeline as one object.
                $su = @(foreach ($u in (Sl-All 'UnitOfMeasurements?$select=Code' $jar)) { (Norm $u.Code).ToUpper() })
                $su = @($su | Where-Object { $_ -and $_ -ne 'MANUAL' } | Sort-Object -Unique)
                $had = if ($opt.PSObject.Properties['sap_units']) { @($opt.sap_units) -join ',' } else { '' }
                if ($su.Count -and $had -ne ($su -join ',')) {
                    $opt | Add-Member -NotePropertyName sap_units -NotePropertyValue $su -Force
                    $optionsChanged = $true
                    Log INFO ("{0}: {1} SAP unit(s) published for quotations" -f $db, $su.Count)
                }
            } catch { Log WARN ("{0}: SAP units not refreshed: {1}" -f $db, $_.Exception.Message) } }

            # ---------------- options for this company, fresh from SAP
            # Routine mode: every prefix in the options, with a SAP read for one that has not been looked up this run.
            # Job mode (27 Oct 2026): only the prefixes PASS A already looked up for a creation, so no extra SAP reads
            # are made. The CMMS creation form may still see the previous next number briefly; the next creation does
            # its own authoritative lookup before posting.
            $publishPrefixes = if ($isRoutine) { @($opt.groups | ForEach-Object { "$($_.prefix)" } | Where-Object { $_ } | Select-Object -Unique) } else { @($nextFor.Keys) }
            foreach ($p in $publishPrefixes) {
                if (-not $nextFor.ContainsKey($p)) {
                    $codes = (Sl-All ("Items?`$select=ItemCode&`$filter=startswith(ItemCode,'{0}')" -f $p.TrimEnd('-')) $jar) | ForEach-Object { $_.ItemCode }
                    $nextFor[$p] = (Prefix-Max $codes $p) + 1
                }
                if ([int]$opt.next_codes.$p -ne [int]$nextFor[$p]) { $opt.next_codes | Add-Member -NotePropertyName $p -NotePropertyValue ([int]$nextFor[$p]) -Force; $optionsChanged = $true }
            }
            # Publish the HSN list only in Routine mode: a Job run reads at most a few new codes (PASS H) and the full
            # list the UI shows is only refreshed by the routine.
            if ($needHsn -and $isRoutine) {
                $sorted = @($hsnList | Sort-Object)
                if ((@($opt.hsn) -join ',') -ne ($sorted -join ',')) { $opt.hsn = $sorted; $optionsChanged = $true }
            }
            # vendor_refresh_requested (27 Oct 2026): this company's refresh has run, so remove its abbr. Re-read the
            # field just before writing it back, so an abbr the CMMS added meanwhile is not lost.
            if ($askedVendors -and -not $DryRun) {
                try {
                    $cur = (Erp-Get (Res $control $control)).data
                    $live = @(); if ("$($cur.vendor_refresh_requested)".Trim()) { try { $live = @(("$($cur.vendor_refresh_requested)".Trim() | ConvertFrom-Json) | ForEach-Object { "$_".Trim().ToUpper() } | Where-Object { $_ }) } catch { } }
                    $keep = @($live | Where-Object { $_ -ne $abbr.ToUpper() })
                    $write = if ($keep.Count) { ConvertTo-Json -InputObject $keep -Compress } else { '' }
                    if ("$write" -ne "$($cur.vendor_refresh_requested)".Trim()) { $null = Erp-Send PUT (Res $control $control) @{ vendor_refresh_requested = $write } }
                } catch { Log WARN ("{0}: vendor_refresh_requested not cleared: {1}" -f $abbr, $_.Exception.Message) }
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
    $wouldS = @($result.items | Where-Object { $_.kind -eq 'purchase quotation' -and $_.action -like 'would post*' }).Count
    $wouldN = @($result.items | Where-Object { $_.kind -eq 'quotation purchase order' -and $_.action -like 'would post*' }).Count
    $same   = @($result.items | Where-Object { $_.action -like 'already in SAP*' }).Count
    $tag = "mode $Mode"
    $result.summary = if ($DryRun) { "DRY RUN ($tag): $wouldC item(s) would be created, $wouldP would change, $wouldR receipt(s) would post, $wouldG item group(s) would be created, $wouldQ purchase request(s) would post, $wouldO purchase order(s) would post, $wouldS quotation(s) would post, $wouldN PO(s) from quotations would post, $wouldI spares issue(s) would post, $($result['fetched']) change(s) would be fetched from SAP, $same already match, $($result.failures) failed." }
                      else { "$tag`: $($result.created) item(s) created in SAP, $($result.changed - $result.created - $result['receipts'] - $result['groups'] - $result['prs'] - $result['issues'] - $result['pos'] - $result['quotes'] - $result['qpos']) updated, $($result['receipts']) receipt(s) posted, $($result['groups']) item group(s) created, $($result['prs']) purchase request(s) posted, $($result['pos']) purchase order(s) posted, $($result['quotes']) quotation(s) posted, $($result['qpos']) PO(s) from quotations posted, $($result['issues']) spares issue(s) posted, $($result['fetched']) change(s) fetched from SAP, $same already matched, $($result.failures) failed." }
    if ($blockedReasons.Count) { $result.summary += ' ' + (@($blockedReasons | Select-Object -Unique) -join ' ') }
    Log INFO $result.summary
    # Routine stamps (27 Oct 2026): the app shows when the last routine run finished. A Routine run that fell through
    # from an empty Job still counts, so the user's Sync press is reported this way too.
    if ($isRoutine -and -not $DryRun) {
        try { $null = Erp-Send PUT (Res $control $control) @{ routine_last_at = (Now-Ist); routine_last_result = $result.summary.Substring(0, [Math]::Min(500, $result.summary.Length)) } }
        catch { Log WARN "routine_last_* not written (fields may be missing - run setup-sync-jobs.js --apply): $($_.Exception.Message)" }
    }
    if ($result.failures -gt 0) { $result.exitCode = 1 }
} catch {
    $result.exitCode = 2; $result.error = $_.Exception.Message
    Log ERROR ("fatal: {0}" -f $_.Exception.Message)
}
Save-Result
exit $result.exitCode
