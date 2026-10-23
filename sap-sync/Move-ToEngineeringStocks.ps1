<#
.SYNOPSIS
One-time (23 Oct 2026): one engineering item group per SAP company, "Engineering Stocks" (-Target), so the
CMMS stops asking for the item group. The other engineering groups stay in SAP and in the options for now
(nothing is removed); their items move into it. MRPPL already had 108 "Engineering Stocks".

.DESCRIPTION
One company per run (-Company MRPPL | MT | HRI | MTR). Without -Apply it only reads and prints the plan.
With -Apply, in order:
  1. The group. If the company's item_master_options has no group named -Target:
       -RenameGroup <code>  renames that SAP group (MTR 115, HRI 108) and the name in ERPNext
                            (item_master_options, engineering_groups, the items' custom_sap_item_group);
       otherwise            raises a "CMMS SAP Item Group Request" (as the CMMS "New item group" does),
                            copied from the company's largest engineering group, and raises the sync flag.
                            The sync (PASS 0) creates it and publishes it; run this again after that.
     The group must be in the options before any item moves: PASS E disables an item that is no longer in
     one of the company's engineering groups.
  2. Backup: every engineering item of the company, SAP and ERPNext side, to logs\.
  3. Move: each item of the other engineering groups -> PATCH ItemsGroupCode only (plus U_SubTypeA = the old
     group's name when it is empty and the company had more than one engineering group, so "Electrical Items"
     / "SPARE PARTS" stay visible), read back, then the ERPNext Item (no pending flag: SAP already has it).
     Items with a CMMS edit waiting (custom_sap_category_pending = 1) are skipped and listed.
     Items take their accounts from the warehouse (GLMethod glm_WH, every engineering item on 23 Oct), so a
     move posts nothing; checked in HITECH_RUBBER.
  4. default_group = -Target on the company's item_master_options (for the CMMS form).

-Rollback <results csv> puts the items listed as moved back into their old group and Sub-category A.

The control Single is only written when the sync is not running (it rewrites item_master_options at the end
of a run from the copy it read at the start).
#>
param(
    [Parameter(Mandatory)] [ValidateSet('MRPPL', 'MT', 'HRI', 'MTR')] [string] $Company,
    [switch] $Apply,
    [int] $RenameGroup = 0,
    [string] $Rollback,
    [string] $ConfigPath,
    # "Engineering Tools" until 23 Oct 2026 13:30 (HRI and MTR were first renamed / moved to that); the user meant this.
    [string] $Target = 'Engineering Stocks'
)
Set-StrictMode -Version 1.0
$ErrorActionPreference = 'Stop'
$scriptDir = $PSScriptRoot; if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $ConfigPath) { $ConfigPath = Join-Path $scriptDir 'config.json' }
$utf8 = New-Object System.Text.UTF8Encoding($false)
$cfg = [IO.File]::ReadAllText($ConfigPath) | ConvertFrom-Json
$control = "$($cfg.control_doctype)"
$curl = (Get-Command curl.exe).Source
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logDir = Join-Path $scriptDir 'logs'
$logFile = Join-Path $logDir ("engineering-stocks-{0}-{1}.log" -f $Company, $stamp)
function Log([string] $Message) { $line = "{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message; Write-Host $line; [IO.File]::AppendAllText($logFile, $line + "`r`n", $utf8) }
function Norm([string] $s) { ("$s" -replace '\s+', ' ').Trim() }
function Key([string] $s) { (Norm $s).ToLower() }

# ------------------------------------------------------------------ ERPNext
$erp = "$($cfg.erpnext.url)".TrimEnd('/')
$erpAuth = 'token {0}:{1}' -f $cfg.erpnext.api_key, $cfg.erpnext.api_secret
function Erp([string] $Method, [string] $Path, $Body) {
    $tag = [guid]::NewGuid().ToString('N').Substring(0, 8)
    $resp = Join-Path $env:TEMP "et-erp-$tag.txt"; $bodyFile = $null
    $a = @('-k', '-s', '--globoff', '--connect-timeout', '15', '--max-time', '120', '-H', 'Expect:', '-H', "Authorization: $erpAuth", '-o', $resp, '-w', '%{http_code}', '-X', $Method)
    if ($null -ne $Body) { $bodyFile = Join-Path $env:TEMP "et-erp-$tag-body.json"; [IO.File]::WriteAllText($bodyFile, ($Body | ConvertTo-Json -Compress -Depth 10), $utf8); $a += @('-H', 'Content-Type: application/json; charset=utf-8', '--data-binary', "@$bodyFile") }
    $a += ("$erp$Path" -replace ' ', '%20')
    try { $code = & $curl @a; $text = if (Test-Path -LiteralPath $resp) { [IO.File]::ReadAllText($resp) } else { '' } }
    finally { foreach ($f in @($resp, $bodyFile)) { if ($f -and (Test-Path -LiteralPath $f)) { [IO.File]::Delete($f) } } }
    if ($code -lt '200' -or $code -ge '300') { throw "ERPNext $Method $Path HTTP $code`: $text" }
    $text | ConvertFrom-Json
}
function Res([string] $Doctype, [string] $Name) { "/api/resource/$([uri]::EscapeDataString($Doctype))" + $(if ($Name) { "/$([uri]::EscapeDataString($Name))" } else { '' }) }
function Erp-List([string] $Doctype, [string[]] $Fields, [string] $FiltersJson) {
    @((Erp GET ("{0}?fields={1}&filters={2}&limit_page_length=0" -f (Res $Doctype ''), [uri]::EscapeDataString((ConvertTo-Json -InputObject @($Fields) -Compress)), [uri]::EscapeDataString($FiltersJson)) $null).data)
}
function Read-Control { (Erp GET (Res $control $control) $null).data }
# The sync writes item_master_options back at the end of its run; never write while one is going.
function Assert-SyncIdle {
    $c = Read-Control
    if ("$($c.status)" -match 'Running' -or "$($c.sync_requested)" -eq '1') { throw "the sync is running or about to run (status '$($c.status)', sync_requested $($c.sync_requested)) - wait for it and run this again" }
    $c
}

# ------------------------------------------------------------------ SAP
$slBase = "$($cfg.sap.url)".TrimEnd('/')
$slRoot = ([Uri]$slBase).GetLeftPart([UriPartial]::Authority)
$jar = Join-Path $env:TEMP ("et-{0}.jar" -f [guid]::NewGuid().ToString('N').Substring(0, 8))
function Invoke-Sl([string] $Method, [string] $Url, $Body, [switch] $SaveCookies) {
    $tag = [guid]::NewGuid().ToString('N').Substring(0, 8)
    $resp = Join-Path $env:TEMP "et-sl-$tag.txt"; $bodyFile = $null
    $a = @('-k', '-s', '--globoff', '--connect-timeout', '15', '--max-time', '120', '-H', 'Expect:', '-H', 'Prefer: odata.maxpagesize=200', '-o', $resp, '-w', '%{http_code}', '-X', $Method)
    if ($SaveCookies) { $a += @('-c', $jar) } else { $a += @('-b', $jar) }
    if ($null -ne $Body) { $bodyFile = Join-Path $env:TEMP "et-sl-$tag-body.json"; [IO.File]::WriteAllText($bodyFile, $(if ($Body -is [string]) { $Body } else { $Body | ConvertTo-Json -Compress -Depth 5 }), $utf8); $a += @('-H', 'Content-Type: application/json', '--data-binary', "@$bodyFile") }
    $a += ($Url -replace ' ', '%20' -replace "'", '%27')
    try { $code = & $curl @a; $text = if (Test-Path -LiteralPath $resp) { [IO.File]::ReadAllText($resp) } else { '' } }
    finally { foreach ($f in @($resp, $bodyFile)) { if ($f -and (Test-Path -LiteralPath $f)) { [IO.File]::Delete($f) } } }
    [pscustomobject]@{ Http = "$code"; Body = $text }
}
function Sl-Get([string] $Path) { $r = Invoke-Sl GET "$slBase/$Path" $null; if ($r.Http -ne '200') { throw "SAP GET $Path HTTP $($r.Http): $($r.Body)" }; $r.Body | ConvertFrom-Json }
function Sl-All([string] $Path) {
    $rows = New-Object System.Collections.ArrayList; $next = "$slBase/$Path"
    while ($next) {
        $r = Invoke-Sl GET $next $null; if ($r.Http -ne '200') { throw "SAP GET $Path HTTP $($r.Http): $($r.Body)" }
        $j = $r.Body | ConvertFrom-Json; foreach ($v in $j.value) { [void]$rows.Add($v) }
        $lnk = $null; foreach ($n in 'odata.nextLink', '@odata.nextLink') { if ($j.PSObject.Properties[$n] -and $j.$n) { $lnk = [string]$j.$n } }
        $next = if (-not $lnk) { $null } elseif ($lnk -match '^https?://') { $lnk } elseif ($lnk.StartsWith('/')) { "$slRoot$lnk" } else { "$slBase/$lnk" }
    }
    , $rows
}
function Key-Url([string] $Code) { "$slBase/Items('$([uri]::EscapeDataString($Code.Replace("'", "''")))')" }

# ------------------------------------------------------------------ start
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory $logDir | Out-Null }
Log ("{0}: {1}" -f $Company, $(if ($Rollback) { "ROLLBACK from $Rollback" } elseif ($Apply) { 'APPLY' } else { 'PREVIEW - nothing is written' }))
$ctl = Read-Control
$options = "$($ctl.item_master_options)" | ConvertFrom-Json
$groupsByAbbr = "$($ctl.engineering_groups)" | ConvertFrom-Json
$opt = $options.$Company
$db = "$($opt.sap_db)"
$password = "$($cfg.sap.password)"
if ($cfg.sap.PSObject.Properties['password_overrides'] -and $cfg.sap.password_overrides.PSObject.Properties[$db]) { $password = "$($cfg.sap.password_overrides.$db)" }
# One login attempt: SAP locks the user after 3 wrong passwords.
$lg = Invoke-Sl POST "$slBase/Login" (@{ CompanyDB = $db; UserName = "$($cfg.sap.username)"; Password = $password } | ConvertTo-Json -Compress) -SaveCookies
if ($lg.Http -ne '200') { throw "SAP login to $db HTTP $($lg.Http)" }
try {
    Log ("{0} ({1}) engineering groups: {2}" -f $db, $Company, ((@($opt.groups) | ForEach-Object { "$($_.code) '$($_.name)' prefix '$($_.prefix)'" }) -join '; '))
    $mirror = @{}
    foreach ($it in (Erp-List 'Item' @('name', 'custom_sap_item_code', 'custom_sap_item_group', 'custom_sap_sub_type_a', 'custom_sap_category_pending', 'disabled') ("[[""name"",""like"",""$Company-%""],[""custom_sap_item_group"",""is"",""set""]]"))) {
        if ("$($it.custom_sap_item_code)".Trim()) { $mirror["$($it.custom_sap_item_code)".Trim()] = $it }
    }

    # ---------------- rollback
    if ($Rollback) {
        if (-not $Apply) { throw 'a rollback writes - add -Apply' }
        $rows = @(Import-Csv $Rollback | Where-Object { $_.result -eq 'moved' })
        Log ("{0} item(s) to put back" -f $rows.Count)
        foreach ($r in $rows) {
            $body = [ordered]@{ ItemsGroupCode = [int]$r.from_group; U_SubTypeA = $r.from_sub_a }
            $p = Invoke-Sl PATCH (Key-Url $r.sap_code) $body
            if ($p.Http -ne '204') { Log ("{0}: FAILED HTTP {1} {2}" -f $r.sap_code, $p.Http, $p.Body); continue }
            if ($r.erp_item) { $null = Erp PUT (Res 'Item' $r.erp_item) @{ custom_sap_item_group = $r.from_group_name; custom_sap_sub_type_a = $r.from_sub_a } }
            Log ("{0}: back in {1} '{2}'" -f $r.sap_code, $r.from_group, $r.from_group_name)
        }
        return
    }

    # ---------------- 1. the group
    $tg = @($opt.groups | Where-Object { (Key $_.name) -eq (Key $Target) })[0]
    if (-not $tg) {
        if ($RenameGroup) {
            $old = @($opt.groups | Where-Object { [int]$_.code -eq $RenameGroup })[0]
            if (-not $old) { throw "group $RenameGroup is not one of $Company's engineering groups" }
            $clash = @((Sl-All ("ItemGroups?`$select=Number,GroupName&`$filter=GroupName eq '{0}'" -f $Target)))
            if ($clash.Count) { throw "$db already has an item group '$Target' ($($clash[0].Number)) that is not in the options" }
            $erpItems = @($mirror.Values | Where-Object { (Key $_.custom_sap_item_group) -eq (Key $old.name) })
            Log ("RENAME SAP group {0} '{1}' -> '{2}'; {3} ERPNext item(s) carry the old name" -f $old.code, $old.name, $Target, $erpItems.Count)
            if ($Apply) {
                $null = Assert-SyncIdle
                $p = Invoke-Sl PATCH "$slBase/ItemGroups($($old.code))" (@{ GroupName = $Target } | ConvertTo-Json -Compress)
                if ($p.Http -ne '204') { throw "rename HTTP $($p.Http): $($p.Body)" }
                if ((Sl-Get "ItemGroups($($old.code))?`$select=GroupName").GroupName -ne $Target) { throw 'SAP accepted the rename but reads back another name' }
                $oldName = "$($old.name)"
                # Fresh copy of the Single right before writing it.
                $ctl = Assert-SyncIdle
                $options = "$($ctl.item_master_options)" | ConvertFrom-Json; $groupsByAbbr = "$($ctl.engineering_groups)" | ConvertFrom-Json
                foreach ($g in @($options.$Company.groups) + @($groupsByAbbr.$Company.groups)) { if ([int]$g.code -eq [int]$old.code) { $g.name = $Target } }
                $null = Erp PUT (Res $control $control) @{ item_master_options = ($options | ConvertTo-Json -Compress -Depth 8); engineering_groups = ($groupsByAbbr | ConvertTo-Json -Compress -Depth 8) }
                foreach ($it in $erpItems) { $null = Erp PUT (Res 'Item' $it.name) @{ custom_sap_item_group = $Target }; $it.custom_sap_item_group = $Target }
                Log ("renamed in SAP and ERPNext ({0} item(s)); was '{1}'" -f $erpItems.Count, $oldName)
                $opt = $options.$Company
                $tg = @($opt.groups | Where-Object { [int]$_.code -eq [int]$old.code })[0]
            } else { $tg = [pscustomobject]@{ code = $old.code; name = $Target; prefix = $old.prefix } }
        } else {
            # Template: the group with most of the company's items (the CMMS does the same).
            $count = @{}; foreach ($it in $mirror.Values) { $k = Key $it.custom_sap_item_group; $count[$k] = 1 + [int]$count[$k] }
            $tpl = @($opt.groups | Sort-Object { - [int]$count[(Key $_.name)] })[0]
            $waiting = @(Erp-List 'CMMS SAP Item Group Request' @('name', 'status') ("[[""company"",""="",""$Company""],[""group_name"",""="",""$Target""]]"))
            Log ("CREATE '{0}' in {1}: copy of {2} '{3}', code prefix '{4}'{5}" -f $Target, $db, $tpl.code, $tpl.name, $tpl.prefix, $(if ($waiting.Count) { " - request $($waiting[0].name) already exists ($($waiting[0].status))" } else { '' }))
            if ($Apply -and -not $waiting.Count) {
                $null = Assert-SyncIdle
                $req = Erp POST (Res 'CMMS SAP Item Group Request' '') @{ company = $Company; group_name = $Target; code_prefix = "$($tpl.prefix)"; template_group_code = [int]$tpl.code; status = 'Queued'; raised_by = ''; raised_at = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') }
                $null = Erp PUT (Res $control $control) @{ sync_requested = 1; sync_requested_by = ''; sync_requested_at = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') }
                Log ("raised {0} and the sync flag - run this again once the sync has created the group" -f $req.data.name)
            }
            if ($Apply) { return }
            $tg = [pscustomobject]@{ code = '(new)'; name = $Target; prefix = $tpl.prefix }
        }
    }
    Log ("target: {0} '{1}' (new item codes: {2})" -f $tg.code, $tg.name, $(if ("$($tg.prefix)") { "$($tg.prefix)<n>" } else { "SAP series $($opt.series)" }))

    # ---------------- 2. backup + plan
    $from = @($opt.groups | Where-Object { "$($_.code)" -ne "$($tg.code)" -and (Key $_.name) -ne (Key $Target) })
    # The old group's name only tells items apart when groups merge: two or more old groups (HRI), or one into a
    # target that already holds items (MTR 116 -> 115). A new, empty target (MT 123) is a plain move. (Counting
    # the target as a group gave 22 MT items "TOOLS AND EQUIPMENTS"; cleared again 23 Oct 2026.)
    $targetHasItems = "$($tg.code)" -match '^\d+$' -and @(Sl-All ("Items?`$select=ItemCode&`$filter=ItemsGroupCode eq {0}&`$top=1" -f [int]$tg.code)).Count -gt 0
    $carry = $from.Count -gt 1 -or ($from.Count -eq 1 -and $targetHasItems)
    $plan = New-Object System.Collections.ArrayList
    $backup = New-Object System.Collections.ArrayList
    foreach ($g in @($opt.groups)) {
        foreach ($si in (Sl-All ("Items?`$select=ItemCode,ItemName,ItemsGroupCode,U_SubTypeA,Valid,QuantityOnStock,GLMethod&`$filter=ItemsGroupCode eq {0}" -f [int]$g.code))) {
            $code = "$($si.ItemCode)".Trim(); $e = $mirror[$code]
            [void]$backup.Add([pscustomobject]@{ sap_code = $code; sap_group = $si.ItemsGroupCode; sap_group_name = $g.name; sap_sub_a = "$($si.U_SubTypeA)"; valid = $si.Valid; qty = $si.QuantityOnStock; gl_method = $si.GLMethod; erp_item = $(if ($e) { $e.name } else { '' }); erp_group = $(if ($e) { $e.custom_sap_item_group } else { '' }); erp_sub_a = $(if ($e) { $e.custom_sap_sub_type_a } else { '' }); erp_pending = $(if ($e) { $e.custom_sap_category_pending } else { '' }) })
            if (-not @($from | Where-Object { [int]$_.code -eq [int]$g.code }).Count) { continue }
            $sub = "$($si.U_SubTypeA)"
            $newSub = if ($carry -and -not (Norm $sub)) { Norm $g.name } else { $sub }
            [void]$plan.Add([pscustomobject]@{ sap_code = $code; name = "$($si.ItemName)"; from_group = [int]$g.code; from_group_name = "$($g.name)"; from_sub_a = $sub; to_sub_a = $newSub; valid = $si.Valid; gl_method = $si.GLMethod; erp_item = $(if ($e) { $e.name } else { '' }); pending = $(if ($e) { "$($e.custom_sap_category_pending)" } else { '' }); result = ''; error = '' })
        }
    }
    $backupCsv = Join-Path $logDir ("engineering-stocks-{0}-{1}-backup.csv" -f $Company, $stamp)
    $backup | Export-Csv -NoTypeInformation -Encoding UTF8 -Path $backupCsv
    Log ("backup: {0} item(s) -> {1}" -f $backup.Count, $backupCsv)
    foreach ($g in $from) { $n = @($plan | Where-Object { $_.from_group -eq [int]$g.code }); Log ("  from {0} '{1}': {2} item(s) ({3} inactive){4}" -f $g.code, $g.name, $n.Count, @($n | Where-Object { $_.valid -ne 'tYES' }).Count, $(if ($carry) { ", $(@($n | Where-Object { $_.to_sub_a -ne $_.from_sub_a }).Count) get Sub-category A '$($g.name)'" } else { '' })) }
    $notWh = @($plan | Where-Object { $_.gl_method -ne 'glm_WH' }); if ($notWh.Count) { throw ("{0} item(s) do not take their accounts from the warehouse ({1}) - a move could change postings; stopping" -f $notWh.Count, (($notWh | Select-Object -First 5 | ForEach-Object { $_.sap_code }) -join ', ')) }
    $noErp = @($plan | Where-Object { -not $_.erp_item }); if ($noErp.Count) { Log ("  {0} item(s) are not in ERPNext (moved in SAP only; the next sync's fetch brings them): {1}" -f $noErp.Count, (($noErp | Select-Object -First 10 | ForEach-Object { $_.sap_code }) -join ', ')) }
    $pend = @($plan | Where-Object { $_.pending -eq '1' }); if ($pend.Count) { Log ("  {0} item(s) have a CMMS edit waiting and are skipped: {1}" -f $pend.Count, (($pend | ForEach-Object { $_.sap_code }) -join ', ')) }
    $resultsCsv = Join-Path $logDir ("engineering-stocks-{0}-{1}-results.csv" -f $Company, $stamp)

    # ---------------- 3. move
    if ($Apply -and $plan.Count) {
        if ("$($tg.code)" -notmatch '^\d+$') { throw 'no target group code' }
        $null = Assert-SyncIdle
        $i = 0
        foreach ($p in $plan) {
            $i++
            if ($p.pending -eq '1') { $p.result = 'skipped (CMMS edit waiting)'; continue }
            try {
                $body = [ordered]@{ ItemsGroupCode = [int]$tg.code }
                if ($p.to_sub_a -ne $p.from_sub_a) { $body.U_SubTypeA = $p.to_sub_a }
                $r = Invoke-Sl PATCH (Key-Url $p.sap_code) $body
                if ($r.Http -ne '204') { throw "PATCH HTTP $($r.Http): $($r.Body)" }
                $v = Sl-Get ("Items('{0}')?`$select=ItemsGroupCode,U_SubTypeA" -f [uri]::EscapeDataString($p.sap_code.Replace("'", "''")))
                if ([int]$v.ItemsGroupCode -ne [int]$tg.code -or (Norm $v.U_SubTypeA) -ne (Norm $p.to_sub_a)) { throw "SAP reads back group $($v.ItemsGroupCode), Sub-category A '$($v.U_SubTypeA)'" }
                if ($p.erp_item) {
                    $eb = @{ custom_sap_item_group = $Target }; if ($p.to_sub_a -ne $p.from_sub_a) { $eb.custom_sap_sub_type_a = $p.to_sub_a }
                    $null = Erp PUT (Res 'Item' $p.erp_item) $eb
                }
                $p.result = 'moved'
            } catch { $p.result = 'failed'; $p.error = $_.Exception.Message; Log ("  {0}: FAILED {1}" -f $p.sap_code, $p.error) }
            if ($i % 50 -eq 0) { Log ("  {0}/{1}" -f $i, $plan.Count); $plan | Export-Csv -NoTypeInformation -Encoding UTF8 -Path $resultsCsv }
        }
        $plan | Export-Csv -NoTypeInformation -Encoding UTF8 -Path $resultsCsv
        Log ("moved {0}, failed {1}, skipped {2} -> {3}" -f @($plan | Where-Object result -eq 'moved').Count, @($plan | Where-Object result -eq 'failed').Count, @($plan | Where-Object { $_.result -like 'skipped*' }).Count, $resultsCsv)
    } else {
        $plan | Export-Csv -NoTypeInformation -Encoding UTF8 -Path $resultsCsv
        Log ("plan: {0} item(s) to move -> {1}" -f $plan.Count, $resultsCsv)
    }

    # ---------------- 4. default group for the CMMS form
    if ("$($opt.default_group)" -eq $Target) { Log "default_group already '$Target'" }
    else {
        Log ("default_group: '{0}' -> '{1}'" -f $opt.default_group, $Target)
        if ($Apply) {
            $ctl = Assert-SyncIdle
            $options = "$($ctl.item_master_options)" | ConvertFrom-Json
            $options.$Company | Add-Member -NotePropertyName default_group -NotePropertyValue $Target -Force
            $null = Erp PUT (Res $control $control) @{ item_master_options = ($options | ConvertTo-Json -Compress -Depth 8) }
            Log 'default_group set'
        }
    }
} finally {
    try { $null = Invoke-Sl POST "$slBase/Logout" $null } catch { }
    if (Test-Path -LiteralPath $jar) { [IO.File]::Delete($jar) }
}
