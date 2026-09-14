import mongoose from "mongoose";
import dotenv from "dotenv";

import connectDB from "../config/db.js";
import Product from "../models/Product.js";
import Company from "../models/Company.js";
import { createDoc, docExists, listDocs } from "../integrations/erpnext/client.js";
import { erpDisabledReason, erpEnabled } from "../integrations/erpnext/config.js";
import {
  MAINTENANCE_ROOT,
  buildBrands,
  buildItem,
  planItemGroups,
} from "../integrations/erpnext/masterData.js";
import { summariseUoms } from "../integrations/erpnext/uom.js";

dotenv.config();

/**
 * PHASE-2: pushes the maintenance catalog into ERPNext as Item Groups, Brands
 * and Items.
 *
 * Run once, by hand, rather than on boot. It touches thousands of records in
 * another system, it is the step most likely to need a second look at its plan
 * before it runs, and nothing about it belongs in the path of a server restart.
 *
 *   node scripts/syncMasterData.js --dry-run     what it would do, no writes
 *   node scripts/syncMasterData.js --limit 20    a small real batch first
 *   node scripts/syncMasterData.js               the whole catalog
 *
 * Safe to run again. Everything checks for existence first, so a run that dies
 * halfway is resumed simply by running it once more.
 *
 * It deliberately does NOT send stock balances. Quantities arrive in Phase 3 as
 * one Stock Reconciliation per warehouse; sending them here as well would put
 * every product into ERPNext twice.
 */

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitAt = args.indexOf("--limit");
const LIMIT = limitAt >= 0 ? Number(args[limitAt + 1]) || 0 : 0;

const log = (...parts) => console.log(...parts);
const step = (title) => log(`\n=== ${title} ===`);

/** Every Item Group name ERPNext already holds, so collisions are visible. */
const existingItemGroups = async () => {
  const names = new Set();
  let start = 0;

  // Paged rather than one big read: an instance with a large tree would
  // otherwise silently return only the first page and the collision check
  // would pass on names that are in fact taken.
  for (;;) {
    const page = await listDocs("Item Group", { fields: ["name"], limit: 100, start });
    if (!Array.isArray(page) || page.length === 0) break;
    for (const row of page) names.add(row.name);
    if (page.length < 100) break;
    start += 100;
  }
  return names;
};

const main = async () => {
  if (!erpEnabled()) {
    console.error(`ERPNext sync is not configured (${erpDisabledReason()}).`);
    console.error("Set ERPNEXT_URL, ERPNEXT_API_KEY, ERPNEXT_API_SECRET and");
    console.error("ERPNEXT_SYNC_ENABLED=true in server/.env, then run again.");
    process.exit(1);
  }

  await connectDB();

  const company = await Company.findOne({ isActive: true, erpCompany: { $ne: "" } });
  if (!company) {
    console.error("No company carries an ERPNext mapping. Run the server once to seed them.");
    process.exit(1);
  }
  log(`Posting against ERPNext company: ${company.erpCompany}`);
  if (DRY_RUN) log("DRY RUN - nothing will be written to ERPNext.\n");

  const products = await Product.find(LIMIT ? {} : {})
    .sort({ code: 1 })
    .limit(LIMIT || 0);

  log(`Catalog: ${products.length} product(s)${LIMIT ? ` (limited to ${LIMIT})` : ""}`);

  // --- the plan ---------------------------------------------------------
  step("Item groups");

  const taken = await existingItemGroups();
  const { groups, groupFor } = planItemGroups(
    products.map((p) => ({ category: p.category, subCategory: p.subCategory })),
    taken
  );

  const collisions = groups.filter((g) => g.item_group_name.includes("(Maintenance)"));
  log(`${groups.length} group(s) needed, ${collisions.length} renamed to avoid a clash:`);
  for (const g of collisions) log(`  - "${g.item_group_name}" (the plain name is already in use)`);

  // --- units ------------------------------------------------------------
  step("Units");

  const { guessed } = summariseUoms(products.map((p) => p.unit));
  if (guessed.size === 0) {
    log("Every unit in the catalog maps to a known ERPNext UOM.");
  } else {
    log(`${guessed.size} unit(s) had no exact match and will default:`);
    for (const [input, uom] of guessed) log(`  - "${input}" -> ${uom}`);
    log("Check these before running for real; they cannot be changed once an");
    log("item holds stock, only corrected by recreating the item.");
  }

  const brands = buildBrands(products.map((p) => p.brand));
  log(`\n${brands.length} brand(s) to create.`);

  if (DRY_RUN) {
    step("Dry run complete");
    log(`Would create: ${groups.length} item group(s), ${brands.length} brand(s), up to ${products.length} item(s).`);
    await mongoose.connection.close();
    return;
  }

  // --- item groups ------------------------------------------------------
  step("Creating item groups");

  let created = 0;
  let skipped = 0;
  for (const group of groups) {
    if (await docExists("Item Group", group.item_group_name)) {
      skipped += 1;
      continue;
    }
    // Serial, and it must stay that way. ERPNext keeps the Item Group tree as
    // a nested set and locks the parent's bounds while inserting a child, so
    // two children of one parent created at once deadlock each other.
    await createDoc("Item Group", group);
    created += 1;
    log(`  + ${group.item_group_name}`);
  }
  log(`${created} created, ${skipped} already present.`);

  // --- brands -----------------------------------------------------------
  step("Creating brands");

  created = 0;
  skipped = 0;
  for (const brand of brands) {
    if (await docExists("Brand", brand.brand)) {
      skipped += 1;
      continue;
    }
    await createDoc("Brand", brand);
    created += 1;
  }
  log(`${created} created, ${skipped} already present.`);

  // --- items ------------------------------------------------------------
  step("Creating items");

  let done = 0;
  let made = 0;
  let present = 0;
  const failures = [];
  const guessedUnits = [];

  for (const product of products) {
    done += 1;

    const built = buildItem({
      product,
      itemGroup: groupFor(product.category, product.subCategory),
      company: company.erpCompany,
      // Where this product lives, so a receipt in ERPNext defaults to the
      // right shelf instead of the company's production Stores.
      defaultWarehouse: company.erpWarehouse,
    });

    if (built.skip) {
      failures.push({ code: product.code || "(no code)", error: built.reason });
      continue;
    }
    if (built.uomWasGuessed) guessedUnits.push(product.code);

    try {
      if (await docExists("Item", built.payload.item_code)) {
        present += 1;
      } else {
        await createDoc("Item", built.payload);
        made += 1;
      }
    } catch (error) {
      failures.push({ code: built.payload.item_code, error: error.message });
    }

    if (done % 50 === 0) {
      log(`  ${done}/${products.length} - ${made} created, ${present} present, ${failures.length} failed`);
    }
  }

  step("Done");
  log(`${made} item(s) created, ${present} already present, ${failures.length} failed.`);
  if (guessedUnits.length > 0) {
    log(`${guessedUnits.length} item(s) were created with a defaulted unit.`);
  }
  if (failures.length > 0) {
    log("\nFailures:");
    for (const f of failures.slice(0, 40)) log(`  - ${f.code}: ${f.error}`);
    if (failures.length > 40) log(`  ...and ${failures.length - 40} more.`);
  }

  await mongoose.connection.close();
};

main().catch(async (error) => {
  console.error("\nMaster data sync failed:", error.message);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
