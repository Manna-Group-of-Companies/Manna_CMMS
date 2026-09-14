import fs from "node:fs/promises";
import dotenv from "dotenv";

import { createDoc, docExists, listAll, listDocs } from "../integrations/erpnext/client.js";
import { parseCsv } from "../integrations/erpnext/csv.js";
import { DEFAULT_BATCH_SIZE, planOpeningStock } from "../integrations/erpnext/openingStock.js";
import { ERP_ABBR, ERP_COMPANY, isOurs } from "../integrations/erpnext/stores.js";

dotenv.config();

/**
 * Opens ERPNext's balances from the generated opening-stock file.
 *
 *   node scripts/openingStockFromFile.js <opening-stock.csv> --dry-run
 *   node scripts/openingStockFromFile.js <opening-stock.csv>
 *
 * This exists because Stock Reconciliation cannot be imported. ERPNext ships
 * it with `allow_import = 0`, so it never appears in Data Import's document
 * list - and it could not work there anyway: it is a submittable document with
 * a child table, and the importer would have to group hundreds of rows under
 * one parent by guessing where each document ends.
 *
 * Run it with the stores closed. A reconciliation records the balance at a
 * moment; if somebody issues stock between the sheet being written and ERPNext
 * accepting these documents, the two start out disagreeing.
 *
 * Re-running is safe: a reconciliation sets an absolute quantity, so a second
 * run writes the same figures rather than doubling them. That same property is
 * why it must not be run once the sync worker is live - it would flatten
 * whatever the worker had posted since.
 */

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const DRY_RUN = args.includes("--dry-run");
const MISSING_ONLY = args.includes("--missing-only");
const at = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BATCH_SIZE = Number(at("--batch", DEFAULT_BATCH_SIZE)) || DEFAULT_BATCH_SIZE;
const POSTED_AT = at("--date", "") ? new Date(`${at("--date", "")}T00:00:00Z`) : new Date();
const EXPENSE_ACCOUNT = at("--expense-account", `Temporary Opening - ${ERP_ABBR}`);

if (!file) {
  console.error("usage: node scripts/openingStockFromFile.js <opening-stock.csv> [--dry-run]");
  console.error("       [--missing-only] [--batch N] [--date YYYY-MM-DD]");
  console.error("       [--expense-account NAME]");
  process.exit(1);
}

const log = (...parts) => console.log(...parts);
const step = (title) => log(`\n=== ${title} ===`);

/** Asks in chunks: one round trip per item would be 627 of them. */
const missingFrom = async (doctype, names) => {
  const missing = [];
  const CHUNK = 200;
  for (let i = 0; i < names.length; i += CHUNK) {
    const chunk = names.slice(i, i + CHUNK);
    const found = await listDocs(doctype, {
      fields: ["name"],
      filters: [[doctype, "name", "in", chunk]],
      limit: CHUNK,
    });
    const present = new Set((Array.isArray(found) ? found : []).map((r) => r.name));
    for (const name of chunk) if (!present.has(name)) missing.push(name);
  }
  return missing;
};

const main = async () => {
  const rows = parseCsv(await fs.readFile(file, "utf8"));
  const balances = rows.map((r) => ({
    itemCode: r.item_code,
    warehouse: r.warehouse,
    qty: Number(r.qty || 0),
    valuationRate: Number(r.valuation_rate || 0),
  }));

  log(`Company:   ${ERP_COMPANY}`);
  log(`Expense:   ${EXPENSE_ACCOUNT}`);
  log(`Posted at: ${POSTED_AT.toISOString()}`);
  log(`Batch:     ${BATCH_SIZE} rows per reconciliation`);
  if (DRY_RUN) log("DRY RUN - nothing will be written to ERPNext.");

  // A warehouse outside our own set means the file was generated against a
  // different instance, and posting it would open balances somewhere nobody
  // is looking.
  const warehouses = [...new Set(balances.map((b) => b.warehouse))];
  const foreign = warehouses.filter((w) => !isOurs(w));
  if (foreign.length) {
    console.error(`\nThese warehouses are not the CMMS's: ${foreign.join(", ")}`);
    process.exit(1);
  }

  /**
   * Drops balances ERPNext already holds at exactly the right quantity.
   *
   * For picking up after a partial run. Re-posting everything is harmless -
   * setting a balance to what it already is moves no stock and writes no
   * ledger entry - but it leaves a pile of reconciliations that say nothing,
   * and someone reading the stock history later has to work out that they were
   * retries rather than real corrections.
   *
   * Not the default, because a balance that is present but WRONG is exactly
   * what a reconciliation is for, and skipping it silently would be the wrong
   * way round.
   */
  let posting = balances;
  if (MISSING_ONLY) {
    const bins = await listAll("Bin", {
      fields: ["item_code", "warehouse", "actual_qty"],
      filters: [["Bin", "warehouse", "in", warehouses]],
    });
    const held = new Map(bins.map((b) => [`${b.item_code}\u0000${b.warehouse}`, Number(b.actual_qty)]));
    posting = balances.filter((b) => held.get(`${b.itemCode}\u0000${b.warehouse}`) !== b.qty);
    const already = balances.length - posting.length;
    log(`
--missing-only: ${already} balance(s) already correct, ${posting.length} to post.`);
    if (!posting.length) {
      step("Nothing to do");
      log("Every balance in the file already matches ERPNext.");
      return;
    }
  }

  step("Plan");
  const plan = planOpeningStock({
    balances: posting,
    company: ERP_COMPANY,
    expenseAccount: EXPENSE_ACCOUNT,
    postedAt: POSTED_AT,
    batchSize: BATCH_SIZE,
  });

  const totalRows = plan.reduce((s, d) => s + d.rowCount, 0);
  for (const doc of plan) log(`  ${doc.warehouse}: ${doc.rowCount} row(s)`);
  const totalQty = posting.reduce((sum, b) => sum + b.qty, 0);
  log(`${plan.length} reconciliation(s), ${totalRows} row(s), ${Math.round(totalQty * 10) / 10} unit(s).`);

  step("Checking ERPNext is ready");
  if (!(await docExists("Account", EXPENSE_ACCOUNT))) {
    console.error(`The expense account "${EXPENSE_ACCOUNT}" does not exist.`);
    console.error("Pass the right one with --expense-account.");
    process.exit(1);
  }
  log(`  account "${EXPENSE_ACCOUNT}" exists`);

  const noWarehouse = await missingFrom("Warehouse", warehouses);
  if (noWarehouse.length) {
    console.error(`  missing warehouse(s): ${noWarehouse.join(", ")}`);
    process.exit(1);
  }
  log(`  ${warehouses.length} warehouse(s) exist`);

  // The one that actually bites: the items have to be imported first.
  const codes = [...new Set(balances.map((b) => b.itemCode))];
  const missing = await missingFrom("Item", codes);
  if (missing.length) {
    console.error(`\n${missing.length} of ${codes.length} item(s) are not in ERPNext yet:`);
    for (const c of missing.slice(0, 20)) console.error(`  - ${c}`);
    if (missing.length > 20) console.error(`  ...and ${missing.length - 20} more.`);
    console.error("\nImport 02-Item.xlsx first, then run this again.");
    process.exit(1);
  }
  log(`  all ${codes.length} item(s) exist`);

  if (DRY_RUN) {
    step("Dry run complete");
    log("Re-run without --dry-run to post the balances.");
    return;
  }

  step("Submitting");
  let submitted = 0;
  const failures = [];
  for (const doc of plan) {
    try {
      // Serial on purpose. Each document runs the valuation chain for every
      // row it carries, and several at once against one warehouse contend on
      // the same ledger.
      const created = await createDoc("Stock Reconciliation", doc.payload);
      submitted += 1;
      log(`  + ${created?.name || "(unnamed)"}  ${doc.warehouse}, ${doc.rowCount} row(s)`);
    } catch (error) {
      failures.push({ warehouse: doc.warehouse, rows: doc.rowCount, message: error.message });
      console.error(`  ! ${doc.warehouse} (${doc.rowCount} rows): ${error.message}`);
    }
  }

  step("Done");
  log(`${submitted} of ${plan.length} reconciliation(s) submitted.`);
  if (failures.length) {
    log(`${failures.length} failed. Fix the cause and re-run - a reconciliation sets`);
    log("absolute quantities, so re-running rewrites the same figures rather than doubling them.");
    process.exitCode = 1;
  } else {
    log("ERPNext now holds the store's opening balances.");
  }
};

main().catch((error) => {
  console.error("\nOpening stock failed:", error.message);
  process.exit(1);
});
