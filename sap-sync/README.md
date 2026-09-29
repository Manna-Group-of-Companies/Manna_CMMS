# sap-engineering-sync

SAP Business One engineering items → ERPNext → Manna CMMS, and back: CMMS creates new engineering items
in SAP (on VP Operations approval) and pushes edits. Built 24-25 Sep 2026.

Two copies, kept identical: this one in the Manna_CMMS repo (`sap-sync/`), and the live one on the SAP server
(`C:\Users\eldhose\sap-engineering-sync\`) - the paths in the scripts and templates point at the live one.
config.json, poller.config.json, logs, SAP snapshots and backups exist only there and are never committed.

Read `C:\Users\eldhose\sap-tools\BRIEFING.md` before changing anything here.

## What lives here

| File | What it does |
|---|---|
| `import-sap-engineering.js` | One-time import of the engineering items from 4 SAP companies into ERPNext (dry run by default). Done 24 Sep: 567 items, opening stock MAT-RECO-2026-00169..00172, old SAP1..SAP657 disabled. |
| `backup/` | The 657 stock-take items (with photos, brands, racks, stock) as they were before they were disabled. |
| `revert-my-groups.js`, `retire-old-taxonomy.js` | History of the catalog URL-limit incident (see below). `retire-old-taxonomy.js` was blocked and never ran. |
| `setup-item-master.js` | 25 Sep: Item fields foreign name / HSN / tax rate, SAP fields + creation status on *CMMS Item Naming Request*, `item_master_options` on the Single. |
| `backfill-item-master.js` | Published the per-company options (groups + numbering, units, HSN list, tax rates) and filled foreign name / HSN / tax on the 567 items. |
| `setup-erpnext.js` | Created the Item fields and the `SAP Item Category Sync Control` Single. Idempotent. |
| `backfill-categories.js` | Filled the three category fields on the 567 items from SAP and published `engineering_groups`. |
| `Sync-SapItemCategories.ps1` | **The item master sync** (name kept from day one). Creates approved items in SAP, pushes pending edits, refreshes the options. |
| `Invoke-SapCategorySyncPoller.ps1` | Its poller (a copy of the stock fetch poller, field names changed). |
| `New-CategorySyncConfig.ps1` | **Run this yourself** - asks for the secrets and writes `config.json` + `poller.config.json`. |
| `config.example.json`, `poller.config.example.json` | Templates. |
| `snapshots/2026-09-24/` | The SAP reads everything above was built from. |

## Company mapping (set by the user, 24 Sep 2026)

| SAP CompanyDB | ERPNext company | Code prefix | Engineering item groups (SAP code) |
|---|---|---|---|
| `MANNA_RUBBER_LIVE` | Manna Rubber Products Private Limited | `MRPPL-` | 108 Engineering Stocks |
| `HITECH_PRETREADS_LIVE` | Manna Treads | `MT-` | 110 TOOLS AND EQUIPMENTS |
| `HITECH_RUBBER_LIVE` | Hi-Tech Rubber Industries | `HRI-` | 106 SPARE PARTS, 108 Engineering Tools, 109 Electrical Items |
| `MANNA_TYRE_LIVE` | Manna Tyre Retreads | `MTR-` | 115 Engineering Toools, 116 Electrical Items |

`MANNA_TYRE_LIVE` has its own SAP password (`sap.password_overrides` in `config.json`).

## The three category levels

| CMMS | ERPNext Item field | SAP Items field |
|---|---|---|
| 1 Item group | `custom_sap_item_group` | `ItemsGroupCode` (name ↔ code via `engineering_groups` on the Single) |
| 2 Sub-category A | `custom_sap_sub_type_a` | `U_SubTypeA` (free text, 50) |
| 3 Sub-category B | `custom_sap_sub_type_b` | `U_SubTypeB` (free text, 50) |

The ERPNext `item_group` of these items stays `Maintenance Store` (the root) on purpose: adding Item Groups
under it breaks the catalog of any CMMS server still running the old code (it put every group name into
one URL; Frappe Cloud refuses request lines over ~4 KB). The new CMMS code uses a `descendants of` filter.

## New items: made in SAP (25 Sep 2026)

1. The **Maintenance Manager** (only) fills in the CMMS form, which is the SAP item master: SAP company, item
   group, Sub-category A/B, description (SOP naming builder → `ItemName`, 100 chars), foreign name, one unit
   (inventory = purchasing = sales), HSN code (that company's SAP HSN list), tax rate (`U_TaxRate`), minimum
   stock (`MinInventory`), brand (CMMS only). Images, rack, condition, reason, plant are gone.
2. The **VP Operations** approves or rejects in *Item Naming*. Approve → request
   `sap_create_status = Queued` + flag raised.
3. The sync creates it in SAP with the next code: MRPPL `ENG-<n>`; HRI and MTR `ENG-<n>` (tools, spares) /
   `EL-<n>` (electrical); Manna Treads by SAP's automatic series 104. Stamp `SWW = IR<year>-<n>` makes a re-run
   adopt instead of duplicating. Then the ERPNext copy `<abbr>-<code>` is made and the request goes *In SAP*.
   A failure shows on the request with SAP's message; the Maintenance Manager can *Send to SAP again*.

Edits (CMMS *Edit* button, Maintenance Manager): description, foreign name, HSN, tax rate, minimum stock,
category levels → SAP; brand stays in the CMMS; unit and company are fixed.

## How an edit reaches SAP (a flagged sync, BRIEFING §5)

1. CMMS (catalog folder button, or Categories → rename) writes the new values on the ERPNext Item,
   sets `custom_sap_category_pending = 1`, and raises `sync_requested` on **SAP Item Category Sync Control**.
2. `Invoke-FlagWatch.ps1` (task `SAP-Watch-Categories`) sees the flag and runs the poller.
3. The poller claims the run and runs `Sync-SapItemCategories.ps1`, which per company: logs in, reads each
   pending item, PATCHes only the fields that differ, reads SAP back to verify, clears `pending`, logs out.
4. The poller writes Success/Failed back; the CMMS shows it (Categories page, item dialog).

**Reviewed exceptions to BRIEFING §1 rule 2**, approved by the user: category edits (24 Sep 2026) and creating
+ editing engineering items (25 Sep 2026). It only creates items in a company's engineering groups, only
PATCHes `ItemName, ForeignName, ChapterID, U_TaxRate, MinInventory, ItemsGroupCode, U_SubTypeA, U_SubTypeB`,
never creates or renames item groups or HSN codes, never touches stock. Item groups drive nothing financially here: every
engineering item uses G/L by warehouse (`glm_WH`), and the groups within a company carry identical accounts
(checked 24 Sep).

The Single starts with **`dry_run = 1`**: the sync reads SAP and reports what it would change, writes nothing.

## Still to do (needs you)

1. **Create the configs:** `powershell -File C:\Users\eldhose\sap-engineering-sync\New-CategorySyncConfig.ps1`
2. **Test:** `powershell -File C:\Users\eldhose\sap-engineering-sync\Sync-SapItemCategories.ps1 -DryRun`
3. **Register the watcher.** Add this to the `$watchers` list in `Register-FlagWatchTasks.ps1` - in **both**
   `C:\Users\eldhose\sap-order-sync\` (live) and `C:\Users\eldhose\SALES_DASHBOARD\sap-order-sync\` (repo) -
   and add `'Invoke-SapCategorySyncPoller.ps1'` to its `$retire` list. It must live in that list: the script
   unregisters every `Invoke-FlagWatch.ps1` task before re-registering, so a separately registered watcher
   would be wiped. (The agent's edit was blocked by the auto-mode classifier.)
   ```powershell
       @{ Name = 'SAP-Watch-Categories'
          Poller = 'C:\Users\eldhose\sap-engineering-sync\Invoke-SapCategorySyncPoller.ps1'
          Config = 'C:\Users\eldhose\sap-engineering-sync\poller.config.json'
          Flag   = 'sync_requested' }
   ```
   **Do step 1 first** - the script's preflight refuses to change anything if any watcher's files are
   missing, which would also stop the order, stock and credit watchers. Then run it elevated:
   `Register-FlagWatchTasks.ps1` (preview), then `-Apply`.
4. When the dry runs look right, untick **Dry Run** on *SAP Item Category Sync Control* in ERPNext.

## Known gaps

- **One direction only.** Edits made in the SAP client (SubType A/B, item group) do not flow back into the
  CMMS. Re-run a snapshot + `backfill-categories.js` to pick them up, or extend the sync to pull.
- Renaming a SAP item group in the SAP client (e.g. fixing "Engineering Toools") needs `engineering_groups`
  and the items' `custom_sap_item_group` updated too, or the sync will reject those items.
- Editing the three fields directly in ERPNext Desk does not set `pending`; tick it by hand to send them.
