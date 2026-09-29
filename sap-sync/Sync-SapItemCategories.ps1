<#
.SYNOPSIS
  CMMS -> SAP Business One item master sync: creates approved engineering items in SAP and pushes edits.

.DESCRIPTION
  One run, one SAP login per company that has work, logout in a finally:

  PASS A - CREATE. Every "CMMS Item Naming Request" with workflow_state = Approved and
  sap_create_status = Queued (the VP Operations approved it in the CMMS):
    * item code: the company's next manual code for the group's prefix (ENG-<n> / EL-<n>, counted from
      SAP's own Items, every spelling "ENG-12" / "ENG 12" / "ENG - 12"), or - where the group has no
      prefix (Manna Treads) - SAP's automatic series assigns it;
    * POST /Items with ItemName (the SOP name), ForeignName, ItemsGroupCode, U_SubTypeA/B, one unit as
      inventory/purchasing/sales UoM, ChapterID (the HSN code looked up in that company's IndiaHsn),
      U_TaxRate, MinInventory, and SWW = "IR<year>-<n>" (the request number: an idempotency stamp - a
      request whose stamp is already in SAP is adopted, never created twice);
    * creates the ERPNext copy "<abbr>-<SAP code>" on the Maintenance Store root with the mirrored fields
      and the company's store as default warehouse;
    * writes erp_item / sap_item_code / sap_create_status = Created back and applies "Mark In SAP".
    A failure sets sap_create_status = Failed + sap_create_error; the Maintenance Manager can re-send it.

  PASS B - EDIT. Every mirrored Item with custom_sap_category_pending = 1: PATCH Items('<code>') with only
  the fields that differ among ItemName, ForeignName, ChapterID, U_TaxRate, MinInventory, ItemsGroupCode,
  U_SubTypeA, U_SubTypeB; read back to verify; clear pending only if ERPNext still holds what was pushed.

  Then the per-company options on the control Single (next codes, HSN list) are refreshed for every
  company touched.

  REVIEWED EXCEPTIONS TO BRIEFING §1 RULE 2, approved by the user: category edits (24 Sep 2026) and
  creating + editing engineering items (25 Sep 2026). It only ever creates items in a company's
  engineering item groups, only PATCHes the fields above, never creates or renames item groups or HSN
  codes (SAP configuration, rule 3), never touches stock.

  Built per BRIEFING §2: curl.exe with "-H Expect:" (PowerShell 5.1 sends Expect: 100-continue and this
  Service Layer answers it with an empty 500); MANNA_TYRE_LIVE's own password from sap.password_overrides.
  Dry run when -DryRun is passed OR the control Single has dry_run = 1 (its starting state): reads SAP and
  ERPNext, logs exactly what it would send, writes nothing anywhere.

.PARAMETER ConfigPath      config.json (see config.example.json). Defaults to the file next to this script.
.PARAMETER DryRun          Read only; report what would be created / changed.
.PARAMETER ResultJsonPath  Where to write {exitCode, changed, failures, summary, error} for the poller.
.PARAMETER Limit           At most this many creates and this many edits (testing).
#>
[CmdletBinding()]
param(
    [string] $ConfigPath,
    [switch] $DryRun,
    [string] $ResultJsonPath,
    [int] $Limit = 0
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

    # ------------------------------------------------------------------ ERPNext
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $erp = "$($cfg.erpnext.url)".TrimEnd('/')
    $erpHdr = @{ Authorization = ('token {0}:{1}' -f $cfg.erpnext.api_key, $cfg.erpnext.api_secret) }
    function Erp-Get([string] $Path) { Invoke-RestMethod -Method Get -Uri "$erp$Path" -Headers $erpHdr -TimeoutSec 60 }
    function Erp-Send([string] $Method, [string] $Path, $Body) {
        Invoke-RestMethod -Method $Method -Uri "$erp$Path" -Headers $erpHdr -ContentType 'application/json; charset=utf-8' -Body $utf8.GetBytes(($Body | ConvertTo-Json -Compress -Depth 10)) -TimeoutSec 60
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
    $creates = @(Erp-List 'CMMS Item Naming Request' @('name', 'proposed_name', 'sap_company', 'sap_item_group', 'sap_sub_type_a', 'sap_sub_type_b', 'foreign_name', 'sap_uom', 'hsn_code', 'tax_rate', 'min_stock', 'brand', 'uom') '[["workflow_state","=","Approved"],["sap_create_status","=","Queued"]]')
    $edits = @(Erp-List 'Item' @('name', 'item_name', 'safety_stock', 'custom_sap_item_code', 'custom_sap_item_group', 'custom_sap_sub_type_a', 'custom_sap_sub_type_b', 'custom_sap_foreign_name', 'custom_sap_hsn_code', 'custom_sap_tax_rate') '[["custom_sap_category_pending","=",1]]')
    if ($Limit -gt 0) { $creates = @($creates | Select-Object -First $Limit); $edits = @($edits | Select-Object -First $Limit) }
    Log INFO ("{0} item(s) to create, {1} item(s) with pending edits{2}." -f $creates.Count, $edits.Count, $(if ($DryRun) { ' - DRY RUN, nothing will be written' } else { '' }))
    if ($creates.Count -eq 0 -and $edits.Count -eq 0) { $result.summary = 'Nothing to do.'; Save-Result; exit 0 }

    # ------------------------------------------------------------------ SAP (curl.exe, BRIEFING §2)
    $curl = (Get-Command curl.exe).Source
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
        if (-not $work.ContainsKey($o.sap_db)) { $work[$o.sap_db] = @{ abbr = $Abbr; opt = $o; creates = New-Object System.Collections.ArrayList; edits = New-Object System.Collections.ArrayList } }
        $work[$o.sap_db]
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
        $password = "$($cfg.sap.password)"
        if ($cfg.sap.PSObject.Properties['password_overrides'] -and $cfg.sap.password_overrides.PSObject.Properties[$db]) { $password = "$($cfg.sap.password_overrides.$db)" }
        $jar = Join-Path $env:TEMP ("imsync-{0}.jar" -f [guid]::NewGuid().ToString('N').Substring(0, 8))
        try {
            $login = @{ CompanyDB = $db; UserName = "$($cfg.sap.username)"; Password = $password } | ConvertTo-Json -Compress
            $lg = Invoke-Sl -Method POST -Url "$slBase/Login" -Body $login -Jar $jar -SaveCookies
            $login = $null
            if ($lg.Http -ne '200') { Sl-Fail $lg "login to $db" }
            Log INFO ("SAP login OK: {0} ({1} to create, {2} to edit)" -f $db, $w.creates.Count, $w.edits.Count)

            # This company's HSN list: digits -> AbsEntry (ChapterID).
            $hsn = @{}; $hsnList = New-Object System.Collections.ArrayList
            foreach ($h in (Sl-All 'IndiaHsn?$select=AbsEntry,Chapter,Heading,SubHeading' $jar)) {
                $d = Digits ("{0}{1}{2}" -f $h.Chapter, $h.Heading, $h.SubHeading)
                if ($d -and -not $hsn.ContainsKey($d)) { $hsn[$d] = [int]$h.AbsEntry; [void]$hsnList.Add($d) }
            }
            function Chapter-Of([string] $code) {
                $d = Digits $code
                if (-not $d) { return -1 }
                if (-not $hsn.ContainsKey($d)) { throw "HSN $d is not in $db's HSN list in SAP" }
                $hsn[$d]
            }
            $groupOf = @{}; foreach ($g in $opt.groups) { $groupOf[(Norm $g.name).ToLower()] = $g }
            $nextFor = @{}   # prefix -> next number, counted from SAP once per run

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
                        }
                        if ((Norm $c.foreign_name)) { $payload.ForeignName = Norm $c.foreign_name }
                        if ((Norm $c.sap_sub_type_a)) { $payload.U_SubTypeA = Norm $c.sap_sub_type_a }
                        if ((Norm $c.sap_sub_type_b)) { $payload.U_SubTypeB = Norm $c.sap_sub_type_b }
                        if ((Norm $c.tax_rate)) { $payload.U_TaxRate = Norm $c.tax_rate }
                        if ((Digits $c.hsn_code)) { $payload.ChapterID = [int](Chapter-Of $c.hsn_code) }
                        if ([double]("0$($c.min_stock)") -gt 0) { $payload.MinInventory = [double]$c.min_stock }
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
                            $pr = Invoke-Sl -Method POST -Url "$slBase/Items" -Body ($payload | ConvertTo-Json -Compress) -Jar $jar
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
                    }
                    Log INFO ("{0} [{1}]: {2} {3} {4}" -f $c.name, $db, $entry.action, $entry.sap_code, $(if ($DryRun -and $entry.payload) { ($entry.payload | ConvertTo-Json -Compress) } else { '' }))
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
                    $want = [ordered]@{
                        ItemName = (Norm $it.item_name); ForeignName = (Norm $it.custom_sap_foreign_name)
                        ChapterID = [int](Chapter-Of $it.custom_sap_hsn_code); U_TaxRate = (Norm $it.custom_sap_tax_rate)
                        MinInventory = [double]("0$($it.safety_stock)"); ItemsGroupCode = [int]$g.code
                        U_SubTypeA = (Norm $it.custom_sap_sub_type_a); U_SubTypeB = (Norm $it.custom_sap_sub_type_b)
                    }
                    if (-not $want.ItemName -or $want.ItemName.Length -gt 100) { throw 'the description is empty or longer than SAP allows (100)' }
                    if ($want.U_SubTypeA.Length -gt 50 -or $want.U_SubTypeB.Length -gt 50) { throw 'SubType A/B is longer than SAP allows (50)' }
                    $r = Invoke-Sl -Method GET -Url ((Key-Url $code) + '?$select=ItemCode,ItemName,ForeignName,ChapterID,U_TaxRate,MinInventory,ItemsGroupCode,U_SubTypeA,U_SubTypeB') -Jar $jar
                    if ($r.Http -ne '200') { Sl-Fail $r 'read item' }
                    $cur = $r.Body | ConvertFrom-Json
                    $patch = [ordered]@{}
                    foreach ($k in $want.Keys) {
                        $a = $cur.$k; $b = $want[$k]
                        $same = if ($b -is [int] -or $b -is [double]) { [double]("0$a") -eq [double]$b -or ("$a" -eq "$b") } else { (Norm $a) -ceq $b }
                        if ($k -eq 'ChapterID' -and [int]$b -eq -1 -and ([int]("0$a") -le 0)) { $same = $true }
                        if (-not $same) { $patch[$k] = $b; $entry.changes[$k] = @{ from = "$a"; to = "$b" } }
                    }
                    if ($patch.Count -eq 0) { $entry.action = 'already in SAP' }
                    elseif ($DryRun) { $entry.action = 'would patch' }
                    else {
                        $etag = $null; if ($cur.PSObject.Properties['odata.etag']) { $etag = "$($cur.'odata.etag')" }
                        $pr = Invoke-Sl -Method PATCH -Url (Key-Url $code) -Body ($patch | ConvertTo-Json -Compress) -Jar $jar -IfMatch $etag
                        if ($pr.Http -ne '204' -and $pr.Http -ne '200') { Sl-Fail $pr 'PATCH' }
                        $v = (Invoke-Sl -Method GET -Url ((Key-Url $code) + '?$select=' + (($patch.Keys) -join ',')) -Jar $jar).Body | ConvertFrom-Json
                        foreach ($k in $patch.Keys) { if ("$($v.$k)" -ne "$($patch[$k])" -and [double]("0$($v.$k)") -ne [double]("0$($patch[$k])")) { throw "SAP accepted the PATCH but reads back $k = '$($v.$k)'" } }
                        $entry.action = 'patched'; $result.changed++
                    }
                    if (-not $DryRun) {
                        $now = (Erp-Get (Res 'Item' $it.name)).data
                        $still = (Norm $now.item_name) -ceq $want.ItemName -and (Norm $now.custom_sap_foreign_name) -ceq $want.ForeignName -and (Digits $now.custom_sap_hsn_code) -eq (Digits $it.custom_sap_hsn_code) -and (Norm $now.custom_sap_tax_rate) -ceq $want.U_TaxRate -and [double]("0$($now.safety_stock)") -eq $want.MinInventory -and (Norm $now.custom_sap_item_group).ToLower() -eq (Norm $it.custom_sap_item_group).ToLower() -and (Norm $now.custom_sap_sub_type_a) -ceq $want.U_SubTypeA -and (Norm $now.custom_sap_sub_type_b) -ceq $want.U_SubTypeB
                        if ($still) { $null = Erp-Send PUT (Res 'Item' $it.name) @{ custom_sap_category_pending = 0; custom_sap_category_synced_at = (Now-Ist); custom_sap_category_error = '' } }
                        else { $entry.action += ' (edited again meanwhile - left pending)' }
                    }
                    Log INFO ("{0} [{1}]: {2} {3}" -f $it.name, $db, $entry.action, (($entry.changes.Keys | ForEach-Object { "$_ '$($entry.changes[$_].from)' -> '$($entry.changes[$_].to)'" }) -join '; '))
                } catch {
                    $entry.action = 'failed'; $entry.error = $_.Exception.Message; $result.failures++
                    Log ERROR ("{0} [{1}]: {2}" -f $it.name, $db, $entry.error)
                    if (-not $DryRun) { try { $null = Erp-Send PUT (Res 'Item' $it.name) @{ custom_sap_category_error = $entry.error.Substring(0, [Math]::Min(500, $entry.error.Length)) } } catch { Log WARN "could not record the error on $($it.name): $($_.Exception.Message)" } }
                }
                $result.items += [pscustomobject]$entry
            }

            # ---------------- options for this company, fresh from SAP
            foreach ($p in @($opt.groups | ForEach-Object { "$($_.prefix)" } | Where-Object { $_ } | Select-Object -Unique)) {
                if (-not $nextFor.ContainsKey($p)) {
                    $codes = (Sl-All ("Items?`$select=ItemCode&`$filter=startswith(ItemCode,'{0}')" -f $p.TrimEnd('-')) $jar) | ForEach-Object { $_.ItemCode }
                    $nextFor[$p] = (Prefix-Max $codes $p) + 1
                }
                if ([int]$opt.next_codes.$p -ne [int]$nextFor[$p]) { $opt.next_codes | Add-Member -NotePropertyName $p -NotePropertyValue ([int]$nextFor[$p]) -Force; $optionsChanged = $true }
            }
            $sorted = @($hsnList | Sort-Object)
            if ((@($opt.hsn) -join ',') -ne ($sorted -join ',')) { $opt.hsn = $sorted; $optionsChanged = $true }
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

    $wouldC = @($result.items | Where-Object { $_.action -eq 'would create' }).Count
    $wouldP = @($result.items | Where-Object { $_.action -eq 'would patch' }).Count
    $same   = @($result.items | Where-Object { $_.action -like 'already in SAP*' }).Count
    $result.summary = if ($DryRun) { "DRY RUN: $wouldC item(s) would be created, $wouldP would change, $same already match, $($result.failures) failed." }
                      else { "$($result.created) item(s) created in SAP, $($result.changed - $result.created) updated, $same already matched, $($result.failures) failed." }
    Log INFO $result.summary
    if ($result.failures -gt 0) { $result.exitCode = 1 }
} catch {
    $result.exitCode = 2; $result.error = $_.Exception.Message
    Log ERROR ("fatal: {0}" -f $_.Exception.Message)
}
Save-Result
exit $result.exitCode
