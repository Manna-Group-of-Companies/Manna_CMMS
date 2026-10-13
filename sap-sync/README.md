# sap-engineering-sync

SAP Business One engineering items → ERPNext → Manna CMMS, and back: CMMS creates new engineering items and
item groups in SAP, pushes edits, and posts the engineering store's goods receipts (GRPO against the PO) and
nil-value stock additions. Built 24-25 Sep 2026; receipts, groups and the end of approvals 9 Oct 2026.

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
| `setup-goods-receipt.js` | 9 Oct: *CMMS Goods Receipt* (+ *Line*), *CMMS SAP Item Group Request*, `opening_qty` on the naming request, `open_po_lines` on the Single. Applied 9 Oct. |
| `setup-purchase-request.js` | 9 Oct: *CMMS Purchase Request* (+ *Line*). Applied 9 Oct. |
| `setup-goods-issue.js` | 10 Oct: *CMMS Goods Issue* (+ *Line*) - spares issued to breakdowns. Applied 12 Oct 2026. |
| `setup-erpnext.js` | Created the Item fields and the `SAP Item Category Sync Control` Single. Idempotent. |
| `backfill-categories.js` | Filled the three category fields on the 567 items from SAP and published `engineering_groups`. |
| `Sync-SapItemCategories.ps1` | **The item master sync** (name kept from day one). Creates item groups and items in SAP, pushes pending edits, posts receipts, publishes open PO lines, refreshes the options. |
| `Invoke-SapCategorySyncPoller.ps1` | Its poller (a copy of the stock fetch poller, field names changed). |
| `New-CategorySyncConfig.ps1` | **Run this yourself** - asks for the secrets and writes `config.json` + `poller.config.json`. |
| `config.example.json`, `poller.config.example.json` | Templates. |
| `snapshots/2026-09-24/` | The SAP reads everything above was built from. |
| `apply-mrppl-cleanup.js`, `verify-mrppl-cleanup.js`, `cancel-mrppl-po.js` | 10 Oct: the Manna Rubber physical-count clean-up, applied through the Service Layer (see below). Done 10 Oct 2026. |
| `pull-mrppl-from-sap.js` | 11 Oct: PASS E (fetch from SAP) for Manna Rubber only, as a script that needs no `config.json` (SAP read from `sap-treads-stock-sync\config.json`, ERPNext via `erp.js`). Dry run by default, `--apply` writes ERPNext only, backs it up first and compares both sides after. Run 11 Oct 2026 (see below). |

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
2. **No approval since 9 Oct 2026.** Saving approves the request at once (the integration account applies
   *Approve*, so ERPNext still stamps it) → `sap_create_status = Queued` + flag raised. HSN and tax rate may
   be empty (an item on the shelf with no bill has neither); an opening quantity becomes a nil-value stock
   addition once the item exists in SAP. Before 9 Oct the VP Operations approved each one.
3. The sync creates it in SAP with the next code: MRPPL `ENG-<n>`; HRI and MTR `ENG-<n>` (tools, spares) /
   `EL-<n>` (electrical); Manna Treads by SAP's automatic series 104. Stamp `SWW = IR<year>-<n>` makes a re-run
   adopt instead of duplicating. Then the ERPNext copy `<abbr>-<code>` is made and the request goes *In SAP*.
   A failure shows on the request with SAP's message; the Maintenance Manager can *Send to SAP again*.

Edits (CMMS *Edit* button, Maintenance Manager): description, category levels, HSN, tax rate → SAP; foreign
name, minimum stock and brand stay in the CMMS (`edit_fields` can add the first two); unit and company are
fixed.

## Engineering store receipts (9 Oct 2026)

Every engineering goods receipt is made in the CMMS from now on; raw materials and consumables stay in SAP.
Two kinds, kept apart (Maintenance Manager, *Engineering Stock*):

| | Goods Receipt (from a bill) | Stock Addition (no bill) |
|---|---|---|
| CMMS asks for | SAP company, the open PO, bill no., bill date, qty per line, HSN + tax rate per line | the item, qty |
| SAP document | GRPO (`PurchaseDeliveryNotes`) against the PO lines: `NumAtCard` = bill no., `TaxDate` = bill date, vendor / price / tax code from the PO - accounts raise the A/P invoice from it as before | Goods Receipt (`InventoryGenEntries`) at price 0, warehouse `01` |
| ERPNext | Material Receipt into the company's store at the PO price | Material Receipt at zero value |
| Item master | the bill's HSN / tax rate onto the item (PASS B patches SAP before the GRPO) | - |

- **Nil value replaced (`revalue_nil_stock`).** If the item's stock is on the shelf at zero cost, the sync
  first revalues it to the GR price - SAP `MaterialRevaluation` (price change, per warehouse: item cost is
  managed per warehouse) and an ERPNext Stock Reconciliation - and sets the Item's valuation rate, so the
  receipt *replaces* the nil value instead of averaging with it.
- **Open PO lines** come from SAP: every run reads each company's open POs and publishes the lines for
  engineering items as `open_po_lines` on the Single (in a dry run too). *Refresh from SAP* on the form
  raises the flag. The CMMS refuses more than is open, less what is already entered and waiting.
- `Reference2 = GR<yy>-<n>` on the SAP document (unused by the store until now) makes a re-run adopt it.
  A receipt posted in SAP but refused by ERPNext is marked Failed with both facts; *Send again* finishes
  the ERPNext side only.
- Found 9 Oct: engineering stock sits in warehouse `01` (`ENG` exists but is inactive); every engineering
  receipt so far was PO → GRPO → A/P invoice (e.g. GRPO 3304, A/P 6373).

## Fetching from SAP (9 Oct 2026)

PASS E (`pull_from_sap`) brings SAP's side into the CMMS on every flagged run - **the engineering item
groups only** (`engineering_groups`: MRPPL 108, MT 110, HRI 106/108/109, MTR 115/116). Items SAP has
that the CMMS lacks are added (found 9 Oct: ENG-437/438/439, made in SAP on 30 Sep); SAP-side changes to
name, groups, HSN, tax, minimum and active state are copied unless the CMMS has its own edit waiting; an
item moved out of the engineering groups is disabled; and SAP's on-hand quantity (`QuantityOnStock`, as
the opening stock) is posted to the company's ERPNext store as a Stock Reconciliation where it differs.
Items in other groups (raw materials, consumables - e.g. ENG-235 in 107, ENG-366/367 in 100) never come
across. The CMMS **Sync with SAP** button (Engineering Stock) raises the flag; so does every save that goes
to SAP. Nothing runs on a timer.

## Purchase requests (9 Oct 2026)

*Engineering Stock → Raise purchase request* (Maintenance Manager): items of one SAP company, quantity per
line, required by, reason. PASS D posts a SAP **Purchase Request** (`PurchaseRequests`: `RequriedDate`
- SAP's spelling - = required by, `ReqType 12` + `ReqCode` = `pr_requester` or the SAP login, the CMMS
raiser and reason in `Comments`, `Reference2 = PR<yy>-<n>`, warehouse `01`). The purchase manager at the
maintenance office converts it to a **PO** in SAP (Copy To → Purchase Order); every run's open PO read sees
lines with `BaseType 1470000113` and marks the CMMS request **Ordered** with the PO number, and that PO is
in the goods receipt form. Statuses: Queued → In SAP → Ordered (or Closed if SAP closed it with no PO) /
Failed. Found 9 Oct: Manna Rubber had never used SAP Purchase Requests - every PO was entered directly.

## New item groups (9 Oct 2026)

*Categories → New item group* (Maintenance Manager): company, name (20 chars, SAP's limit), code prefix
(`ENG-`, `EL-`, … or SAP's automatic numbering) and the group to copy. PASS 0 reads that group
(`ItemGroups(n)`) and POSTs a new one with every account and setting copied (not its default-bin rows),
then publishes it in `engineering_groups` / `item_master_options`. Renaming a group stays in the SAP client.
Sub-category A / B are free text in SAP: a new value goes across with the first item filed under it.

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
and on 9 Oct 2026 engineering goods receipts (GRPO against the PO), nil-value stock additions, revaluing
nil-valued engineering stock, and new engineering item groups. It never renames item groups or creates HSN
codes, and only posts receipts for engineering items mirrored in the CMMS. Item groups drive nothing financially here: every
engineering item uses G/L by warehouse (`glm_WH`), and the groups within a company carry identical accounts
(checked 24 Sep).

The Single starts with **`dry_run = 1`**: the sync reads SAP and reports what it would change, writes nothing.

**Switches in `config.json` - each kind of SAP document is off until you turn it on:**

| Key | Does | Default |
|---|---|---|
| `create_items` | create items added in the CMMS | off |
| `post_receipts` | GRPOs and nil-value Goods Receipts | off |
| `create_groups` | new engineering item groups | off |
| `revalue_nil_stock` | revalue nil-valued stock to the GR price first | off |
| `post_purchase_requests` | SAP Purchase Requests from the CMMS | off |
| `post_issues` | SAP Goods Issues (+ ERPNext Material Issues) for spares used on breakdowns | off |
| `pull_from_sap` | fetch engineering items and their stock from SAP (writes ERPNext only) | off |
| `pr_requester` | SAP user code the requests are raised under | the SAP login |
| `skip_companies` | company databases left out (no SAP login; their CMMS work stays Queued), e.g. `["MANNA_TYRE_LIVE"]` while its password is sorted out - SAP locks a user after 3 wrong passwords, and the watcher would retry on every flag | `[]` |
| `edit_fields` | what edits send | `ItemName, ItemsGroupCode, U_SubTypeA, U_SubTypeB, ChapterID, U_TaxRate` |

A kind that is off is left `Queued` and goes the run after it is turned on. The 9 Oct session wrote them
off by default because the agent's edit switching them on was stopped by the auto-mode classifier - turning
them on is your call, after a dry run.

## The Manna Rubber clean-up (10 Oct 2026)

A one-off, asked for by the user after inspecting the lists, and the one time this folder wrote item
masters through the Service Layer instead of DTW (BRIEFING §1 rule 2, reviewed exception). The physical count
of the Manna Rubber engineering store (654 rows, `Downloads\PhysicalStock.xlsx`) was matched to SAP group 108
(`server/scripts/matchPhysicalStock.js`, standard names from `server/utils/nameRepair.js`), and the user's
rules were: exact matches renamed to the standard name; unmatched items with zero stock deactivated; unmatched
items with stock left alone; counted items SAP lacked created at nil value with their stock received at price
0 (one Bolt, one Nut, one Washer item instead of per-size fasteners); Sub-category A / B and minimum stock
from the count on every counted item. `MANNA_RUBBER_LIVE` only.

| Step | Script | What it did |
|---|---|---|
| plan | `server/scripts/planMrpplSapCleanup.js <match> <sap-items> <out> [open-po]` | The lists (renames 54, deactivate 288, manual 71, new 486); `KEEP` / `NO_RENAME` hold the user's and the review's exceptions. The plan the run used: `logs\mrppl-cleanup-plan-2026-10-10.json`. |
| apply | `node apply-mrppl-cleanup.js <plan> [--apply] [--limit N] [--steps rename,new,stock,deactivate] [--gr-chunk N]` | Dry run by default. Decides every write on a fresh read, journals each write the moment SAP accepts it and reads it back; a backup of every item it may touch goes to `logs\` first. Safe to re-run: new items are adopted by stamp `SWW = PS-<counted id>`, stock is not received twice, equal fields are a no-op. |
| verify | `node verify-mrppl-cleanup.js <plan> <before> <after> <gr> [result]` | Files only, no SAP: checks the after-read against the plan and the before-read, field by field. |
| | `node cancel-mrppl-po.js <docEntry> --docnum N --item CODE [--apply]` | Cancelled PO 1033 (ENG - 399) on the user's instruction; ENG - 399 kept. |

Result on 10 Oct 2026 (log, journal `mrppl-cleanup-journal-2026-10-10.jsonl`, backups and result files in
`C:\Users\eldhose\sap-engineering-sync\logs\`): 54 renamed, 486 created (ENG-440..ENG-925), opening stock in
Goods Receipts 1608-1619 (471 lines, 3,589.9 pcs, value 0, warehouse 01, Reference2 `PSC<HHMM>-<part>`),
288 deactivated, 71 stocked items untouched. Group 108 went from 414 items (413 active) to 900 (611 active).

Learned on the way, verified against the live company:
- `Items` PATCH with `If-Match` (the etag SAP itself returns) answers HTTP 412 (-2039); every row's etag is the
  same constant. Write without it; the fresh read is the guard.
- Every group-108 item manages stock by warehouse, so the minimum lives on
  `ItemWarehouseInfoCollection[WarehouseCode '01'].MinimalStock`; a PATCH of item-level `MinInventory` is
  accepted and ignored. New items: send `ManageStockByWarehouse: 'tYES'` and the warehouse row in the POST.
  (The sync's `MinInventory` edit in `edit_fields` has the same blind spot - use the warehouse row.)
- `Reference2` on `InventoryGenEntries` holds 11 characters. Item keys with spaces go as `Items('ENG%20-%20399')`.
- The CMMS / ERPNext mirror did not know about any of this until it was fetched: done 11 Oct 2026 with
  `pull-mrppl-from-sap.js --apply` - 488 items added (the 486 new ones plus ENG-437 and ENG-439, made in SAP on
  30 Sep), 341 updated (286 + 2 disabled, 55 renamed, sub-categories and minimums), opening stock in Stock
  Reconciliations MAT-RECO-2026-00177..00181. Afterwards ERPNext matched SAP on every item; ENG-65's 3.9 (no
  unit in SAP, Nos in ERPNext) was not fetched, and ENG-141's 170-character SAP name is cut to ERPNext's 140.

## Fixed before switching on (12 Oct 2026)

The sync had only ever run dry (24-25 Sep). Three things the 10 Oct clean-up proved on live SAP were wrong in it:
- PASS B sent `If-Match` with its PATCH; SAP answers that with HTTP 412 (-2039), so every edit would have failed.
  Removed; the fresh read and the "edited again meanwhile" check are the guard.
- PASS A / PASS B wrote the minimum only as item-level `MinInventory`, which SAP ignores for items managed by
  warehouse (all MRPPL engineering items). Both now write `ItemWarehouseInfoCollection[{WarehouseCode, MinimalStock}]`.
- PASS E sent SAP's full name to ERPNext's 140-character `item_name` and failed on MRPPL-ENG-141 (~170), which
  would have stopped the fetch for Manna Rubber. Now cut at 140, full name in the description.
- PASS E read SAP with `@(Sl-All ...)`; Sl-All returns its rows as one object, so the loop saw a single "item"
  holding the whole list and failed for every company (13 Oct 2026, the first dry run with `pull_from_sap` on).
  The pass had never run before. Fixed; the dry run then read HRI 20, MRPPL 900 and MT 78 items with 0 failures.

## Still to do (needs you)

1. **Create the configs:** `powershell -File C:\Users\eldhose\sap-engineering-sync\New-CategorySyncConfig.ps1`
2. **Test:** `powershell -File C:\Users\eldhose\sap-engineering-sync\Sync-SapItemCategories.ps1 -DryRun`
3. **Register the watcher.** `SAP-Watch-Categories` is in the `$watchers` list of `Register-FlagWatchTasks.ps1`
   (both `C:\Users\eldhose\sap-order-sync\` and `SALES_DASHBOARD\sap-order-sync\`, 9 Oct 2026), and its
   poller is in `$retire`. **Do step 1 first** - the script's preflight stops if any watcher's files are
   missing. Then, elevated: `Register-FlagWatchTasks.ps1` (preview), then `-Apply`. It re-registers all
   five watchers; the other four carry on as before.
4. **Switch on** in `config.json`: `"create_items": true, "post_receipts": true, "create_groups": true,
   "revalue_nil_stock": true, "post_purchase_requests": true` (New-CategorySyncConfig.ps1 writes them as
   false), and `pr_requester` if requests should carry a SAP user other than the sync's login.
   **Spares issued to breakdowns (10 Oct):** first `node setup-goods-issue.js` (dry run) then `--apply`, so
   the CMMS can record them; then `"post_issues": true` (add it to an existing `config.json`). Until then a
   repair with spares cannot be saved (no doctype), or its issue waits Queued (switch off). SAP refuses a
   Goods Issue that would take the warehouse below zero, and may refuse one for an item with no cost (stock
   added with no bill) unless the company allows stock release without item cost - the reason shows on the
   breakdown, which can send it again.
5. When the dry runs look right, untick **Dry Run** on *SAP Item Category Sync Control* in ERPNext. A
   receipt entered in the CMMS while Dry Run is on stays Queued and posts on the first live run - so enter
   only real ones.
6. ~~Bring the CMMS up to date with the 10 Oct clean-up~~ - done 11 Oct 2026 with `pull-mrppl-from-sap.js`.
   PASS E in `Sync-SapItemCategories.ps1` would still fail on MRPPL-ENG-141 (it sends SAP's full 170-character
   name to ERPNext's 140-character item_name) until it cuts the name the same way.

## Known gaps

- **One direction only.** Edits made in the SAP client (SubType A/B, item group) do not flow back into the
  CMMS. Re-run a snapshot + `backfill-categories.js` to pick them up, or extend the sync to pull.
- Renaming a SAP item group in the SAP client (e.g. fixing "Engineering Toools") needs `engineering_groups`
  and the items' `custom_sap_item_group` updated too, or the sync will reject those items.
- Editing the three fields directly in ERPNext Desk does not set `pending`; tick it by hand to send them.
