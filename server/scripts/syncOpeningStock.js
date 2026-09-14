import mongoose from "mongoose";
import dotenv from "dotenv";

import connectDB from "../config/db.js";
import Company from "../models/Company.js";
import StockRoomInventory from "../models/StockRoomInventory.js";
import RestockItem from "../models/RestockItem.js";
import ErpSyncOutbox from "../models/ErpSyncOutbox.js";
import { createDoc, listDocs } from "../integrations/erpnext/client.js";
import { erpDisabledReason, erpEnabled } from "../integrations/erpnext/config.js";
import { DEFAULT_BATCH_SIZE, planOpeningStock } from "../integrations/erpnext/openingStock.js";
import { warehouseMap } from "../integrations/erpnext/warehouses.js";
import { RED_STOCK_ROOM } from "../integrations/erpnext/stockEntry.js";

dotenv.config();

/**
 * PHASE-3: the cutover. Opens ERPNext's balances at whatever the CMMS holds
 * right now.
 *
 *   node scripts/syncOpeningStock.js --dry-run    the plan, no writes
 *   node scripts/syncOpeningStock.js              the cutover itself
 *
 * Run it with the stores closed. A reconciliation records the balance at a
 * moment; if somebody issues stock between this reading MongoDB and ERPNext
 * accepting the document, the two systems start out disagreeing, and the
 * nightly drift report is what will eventually tell you so.
 *
 * The order matters and is not interchangeable:
 *
 *   1. Phase 2 first. A balance can only be opened for an item that exists.
 *   2. This script, with ERPNEXT_SYNC_ENABLED still false.
 *   3. Turn the sync on afterwards.
 *
 * Doing (3) before (2) is the one genuinely destructive mistake available
 * here: a reconciliation sets an absolute quantity, so it would flatten every
 * movement the worker had already posted. The guard below refuses that.
 */

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const FORCE = args.includes("--force");
const at = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BATCH_SIZE = Number(at("--batch", DEFAULT_BATCH_SIZE)) || DEFAULT_BATCH_SIZE;
const POSTED_AT = at("--date", "") ? new Date(`${at("--date", "")}T00:00:00Z`) : new Date();

const log = (...parts) => console.log(...parts);
const step = (title) => log(`\n=== ${title} ===`);

/**
 * Everything the CMMS currently holds, as flat balances.
 *
 * Two sources, because stock sits in two shapes. The per-room rows are the
 * store balances. Red Stock is not a room record at all — it is the returned
 * batches waiting for a merge — so it is summed per product out of
 * `RestockItem` and posted to its own warehouse. Leaving it out would open
 * ERPNext short by everything currently awaiting a merge.
 */
const collectBalances = async (warehouses) => {
  const balances = [];
  const problems = [];

  const rows = await StockRoomInventory.find({ quantity: { $gt: 0 } })
    .populate("product", "code unitCost name")
    .populate("stockRoom", "name");

  for (const row of rows) {
    if (!row.product?.code) {
      problems.push(`${row.product?.name || row.product?._id || "unknown product"}: no code`);
      continue;
    }
    const warehouse = warehouses.get(row.stockRoom?.name);
    if (!warehouse) {
      problems.push(`${row.product.code}: room "${row.stockRoom?.name || "?"}" has no ERPNext warehouse`);
      continue;
    }
    balances.push({
      itemCode: row.product.code,
      warehouse,
      qty: row.quantity,
      valuationRate: Number(row.product.unitCost || 0),
    });
  }

  // Red Stock: batches still physically in the room. "Moved to Stock Room" has
  // already been credited to a store and counted above; "Scrapped" is gone.
  const redStockWarehouse = warehouses.get(RED_STOCK_ROOM);
  const pending = await RestockItem.find({
    status: { $in: ["In Red Stock", "Weekly Merge Pending"] },
    quantity: { $gt: 0 },
  }).populate("product", "code unitCost");

  const redStock = new Map();
  for (const item of pending) {
    const code = item.productCode || item.product?.code;
    if (!code) {
      problems.push(`${item.restockNumber}: no product code`);
      continue;
    }
    // Several returns of the same product are separate batches here but one
    // balance on the shelf, so they are summed rather than sent as rows that
    // would overwrite one another inside a single reconciliation.
    const existing = redStock.get(code) || { qty: 0, valuationRate: Number(item.product?.unitCost || 0) };
    existing.qty += item.quantity;
    redStock.set(code, existing);
  }

  if (redStock.size > 0 && !redStockWarehouse) {
    problems.push(`Red Stock holds ${redStock.size} product(s) but has no ERPNext warehouse`);
  } else {
    for (const [itemCode, { qty, valuationRate }] of redStock) {
      balances.push({ itemCode, warehouse: redStockWarehouse, qty, valuationRate });
    }
  }

  return { balances, problems };
};

const main = async () => {
  if (!erpEnabled()) {
    console.error(`ERPNext is not configured (${erpDisabledReason()}).`);
    console.error("This script needs the credentials even though the worker should stay off.");
    console.error("Set ERPNEXT_URL / API key / secret, and ERPNEXT_SYNC_ENABLED=true only after the cutover.");
    process.exit(1);
  }

  await connectDB();

  const company = await Company.findOne({ isActive: true, erpCompany: { $ne: "" } });
  if (!company) {
    console.error("No company carries an ERPNext mapping. Run the server once to seed them.");
    process.exit(1);
  }

  // The destructive case, refused rather than warned about.
  const alreadySynced = await ErpSyncOutbox.countDocuments({ status: "Sent" });
  if (alreadySynced > 0 && !FORCE) {
    console.error(`\nRefusing to run: ${alreadySynced} movement(s) have already been posted to ERPNext.`);
    console.error("A reconciliation sets absolute quantities, so this would overwrite them.");
    console.error("The cutover belongs before the sync is switched on. If you are certain");
    console.error("you want to reset ERPNext to the CMMS's current figures, pass --force.");
    await mongoose.connection.close();
    process.exit(1);
  }

  log(`Company:   ${company.erpCompany}`);
  log(`Posted at: ${POSTED_AT.toISOString()}`);
  log(`Batch:     ${BATCH_SIZE} rows per reconciliation`);
  if (DRY_RUN) log("DRY RUN - nothing will be written to ERPNext.");
  if (alreadySynced > 0) log(`WARNING: overwriting balances after ${alreadySynced} synced movement(s).`);

  // --- gather -----------------------------------------------------------
  step("Reading balances");

  const warehouses = await warehouseMap();
  const { balances, problems } = await collectBalances(warehouses);

  const totalQty = balances.reduce((sum, b) => sum + b.qty, 0);
  log(`${balances.length} balance(s) across ${new Set(balances.map((b) => b.warehouse)).size} warehouse(s), ${totalQty} unit(s) total.`);

  if (problems.length > 0) {
    log(`\n${problems.length} balance(s) cannot be posted:`);
    for (const p of problems.slice(0, 30)) log(`  - ${p}`);
    if (problems.length > 30) log(`  ...and ${problems.length - 30} more.`);
  }

  // --- plan -------------------------------------------------------------
  step("Plan");

  const plan = planOpeningStock({
    balances,
    company: company.erpCompany,
    // "Opening Stock" posts against Temporary Opening rather than writing the
    // whole catalog to Stock Adjustment as though it had been found in a count.
    expenseAccount: `Temporary Opening - ${company.erpAbbr}`,
    postedAt: POSTED_AT,
    batchSize: BATCH_SIZE,
  });

  for (const doc of plan) {
    log(`  ${doc.warehouse}: ${doc.rowCount} row(s)`);
  }
  log(`${plan.length} reconciliation(s) to submit.`);

  if (DRY_RUN) {
    step("Dry run complete");
    log("Re-run without --dry-run to perform the cutover.");
    await mongoose.connection.close();
    return;
  }

  // --- verify the items exist ------------------------------------------
  step("Checking items exist in ERPNext");

  const codes = [...new Set(balances.map((b) => b.itemCode))];
  const missing = [];

  // Asked 200 at a time rather than one by one. A catalog of a few thousand
  // would otherwise be a few thousand round trips to Frappe Cloud, which turns
  // a preflight check into a twenty-minute wait during a cutover window when
  // the stores are standing closed.
  const CHUNK = 200;
  for (let i = 0; i < codes.length; i += CHUNK) {
    const chunk = codes.slice(i, i + CHUNK);
    const found = await listDocs("Item", {
      fields: ["name"],
      filters: [["Item", "name", "in", chunk]],
      limit: CHUNK,
    });
    const present = new Set((Array.isArray(found) ? found : []).map((row) => row.name));
    for (const code of chunk) if (!present.has(code)) missing.push(code);
    log(`  ${Math.min(i + CHUNK, codes.length)}/${codes.length} checked, ${missing.length} missing`);
  }

  if (missing.length > 0) {
    console.error(`\n${missing.length} item(s) do not exist in ERPNext:`);
    for (const code of missing.slice(0, 30)) console.error(`  - ${code}`);
    if (missing.length > 30) console.error(`  ...and ${missing.length - 30} more.`);
    console.error("\nRun `npm run erp:sync-master` first, then try again.");
    await mongoose.connection.close();
    process.exit(1);
  }
  log(`All ${codes.length} item(s) present.`);

  // --- submit -----------------------------------------------------------
  step("Submitting reconciliations");

  let submitted = 0;
  const failures = [];
  for (const doc of plan) {
    try {
      // Serial on purpose. Each document runs the valuation chain for every
      // row it carries, and several at once against one warehouse contend on
      // the same ledger.
      const created = await createDoc("Stock Reconciliation", doc.payload);
      submitted += 1;
      log(`  + ${created?.name || "(unnamed)"} - ${doc.warehouse}, ${doc.rowCount} row(s)`);
    } catch (error) {
      failures.push({ warehouse: doc.warehouse, rows: doc.rowCount, error: error.message });
      console.error(`  ! ${doc.warehouse} (${doc.rowCount} rows): ${error.message}`);
    }
  }

  step("Done");
  log(`${submitted} of ${plan.length} reconciliation(s) submitted.`);
  if (failures.length > 0) {
    log(`${failures.length} failed. Fix the cause and re-run: a reconciliation sets`);
    log("absolute quantities, so re-running rewrites the same figures rather than doubling them.");
  } else {
    log("\nERPNext now holds the CMMS's balances.");
    log("Next: set ERPNEXT_SYNC_ENABLED=true and restart the server.");
  }

  await mongoose.connection.close();
};

main().catch(async (error) => {
  console.error("\nOpening stock cutover failed:", error.message);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
