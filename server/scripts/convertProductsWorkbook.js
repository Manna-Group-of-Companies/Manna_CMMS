import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

import { listAll } from "../integrations/erpnext/client.js";
import { toCsv } from "../integrations/erpnext/csv.js";
import { planItemGroups, MAINTENANCE_ROOT } from "../integrations/erpnext/masterData.js";
import { resolveUom } from "../integrations/erpnext/uom.js";
import { ERP_COMPANY, MAIN_WAREHOUSE, RED_STOCK_WAREHOUSE } from "../integrations/erpnext/stores.js";

dotenv.config();

/**
 * Turns the engineering store's own product workbook into ERPNext import files.
 *
 *   node scripts/convertProductsWorkbook.js <rows.json> <out-dir>
 *
 * The workbook is read by a small Python step first, because this project has
 * no xlsx reader and adding one for a job done twice is not worth the
 * dependency. Everything after that - the item group tree, the UOM mapping,
 * the item payload - goes through the same mappers the API push uses, so
 * importing these by hand and running the push later cannot produce two
 * different catalogs.
 */

const [, , rowsFile, outDir] = process.argv;
if (!rowsFile || !outDir) {
  console.error("usage: node scripts/convertProductsWorkbook.js <rows.json> <out-dir>");
  process.exit(1);
}

const clean = (v) => (v === null || v === undefined ? "" : String(v).trim());

/**
 * Folds categories that are the same thing typed differently.
 *
 * The store's sheet carries "Bearings" and "BEARINGS", "Pipe Fittings" and
 * "Pipe fittings", "Chains and Parts" and "CHAINS& PARTS". Importing those
 * faithfully would create a duplicate group for each and split items away from
 * where the rest of their kind sits - and merging Item Groups afterwards in
 * ERPNext is considerably more painful than getting it right here.
 *
 * The spelling used by the most items wins, on the grounds that it is the one
 * the store actually uses and the others are slips.
 */
const canonicaliser = (values) => {
  const counts = new Map();
  for (const v of values) {
    const name = clean(v);
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }

  // Letters only, so casing, spacing and "&" versus "and" all collapse.
  const key = (s) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

  const best = new Map();
  for (const [name, n] of counts) {
    const k = key(name);
    const held = best.get(k);
    if (!held || n > held.n) best.set(k, { name, n });
  }

  const merged = [];
  for (const [name, n] of counts) {
    const winner = best.get(key(name)).name;
    if (winner !== name) merged.push({ from: name, to: winner, items: n });
  }

  return {
    map: (v) => {
      const name = clean(v);
      if (!name) return "";
      return best.get(key(name))?.name ?? name;
    },
    merged,
  };
};
const num = (v) => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const main = async () => {
  const rows = JSON.parse(await fs.readFile(rowsFile, "utf8")).filter((r) => clean(r.SAPID));
  await fs.mkdir(outDir, { recursive: true });
  console.log(`${rows.length} products read\n`);

  // --- item groups ------------------------------------------------------
  // Checked against the live tree so a category sharing a name with the
  // production side is suffixed rather than silently merged into it.
  //
  // Everything already hanging under the maintenance root is excluded, because
  // it is this script's own output from a previous run. Counting it as taken
  // would have the second run decide its own groups were somebody else's and
  // suffix all of them - which is exactly what happened once the first batch
  // was created, turning "Bearings" into "Bearings (Maintenance)" and pointing
  // 654 items at groups that do not exist.
  const live = await listAll("Item Group", {
    fields: ["name", "parent_item_group"],
  });

  const childrenOf = new Map();
  for (const g of live) {
    const parent = g.parent_item_group || "";
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent).push(g.name);
  }

  const ourBranch = new Set();
  const walk = [MAINTENANCE_ROOT];
  while (walk.length) {
    const node = walk.pop();
    ourBranch.add(node);
    for (const child of childrenOf.get(node) || []) {
      if (!ourBranch.has(child)) walk.push(child);
    }
  }

  const taken = new Set(live.map((g) => g.name).filter((n) => !ourBranch.has(n)));
  if (ourBranch.size > 1) {
    console.log(`     ${ourBranch.size - 1} groups already under ${MAINTENANCE_ROOT}, treated as ours\n`);
  }

  const mainCat = canonicaliser(rows.map((r) => r["Main Category"]));
  const subCat = canonicaliser(rows.map((r) => r["Sub-Category"]));

  for (const m of [...mainCat.merged, ...subCat.merged]) {
    console.log(`     merged "${m.from}" (${m.items} items) into "${m.to}"`);
  }

  const pairs = rows.map((r) => {
    const main = mainCat.map(r["Main Category"]);
    const sub = subCat.map(r["Sub-Category"]);
    // 139 rows repeat the main category as the sub. That is not a level, it
    // is the same thing said twice, and creating it would put every one of
    // those items one pointless step deeper in the tree.
    return { category: main, subCategory: sub && sub !== main ? sub : "" };
  });

  const { groups, groupFor } = planItemGroups(pairs, taken);
  const renamed = groups.filter((g) => g.item_group_name.includes("(Maintenance)"));

  await fs.writeFile(
    path.join(outDir, "01-item-groups.csv"),
    toCsv(["item_group_name", "parent_item_group", "is_group"], groups),
    "utf8"
  );
  console.log(`01-item-groups.csv   ${groups.length} groups` +
    (renamed.length ? `  (${renamed.length} renamed to avoid a clash)` : ""));
  for (const g of renamed) console.log(`     ! "${g.item_group_name}"`);

  // --- brands -----------------------------------------------------------
  const brands = [...new Set(rows.map((r) => clean(r.Brand)).filter(Boolean))].sort();
  await fs.writeFile(
    path.join(outDir, "02-brands.csv"),
    toCsv(["brand", "description"], brands.map((b) => ({ brand: b, description: b }))),
    "utf8"
  );
  console.log(`02-brands.csv        ${brands.length} brands`);

  // --- items ------------------------------------------------------------
  const itemCols = [
    "item_code", "item_name", "item_group", "stock_uom",
    "is_stock_item", "include_item_in_manufacturing", "is_purchase_item", "is_sales_item",
    "brand", "description", "safety_stock", "valuation_rate",
    "custom_rack_location", "image",
    "company (Item Default)", "default_warehouse (Item Default)",
  ];

  const guessed = new Map();
  const items = rows.map((r) => {
    const code = clean(r.SAPID);
    const name = clean(r["Product Name"]) || code;
    const { uom, exact } = resolveUom(r.UOM);
    if (!exact) guessed.set(clean(r.UOM) || "(blank)", uom);

    const cost = num(r["Unit Cost"]);
    const status = clean(r.Status);

    return {
      item_code: code,
      item_name: name.slice(0, 140),
      item_group: groupFor(mainCat.map(r["Main Category"]), subCat.map(r["Sub-Category"])),
      stock_uom: uom,
      is_stock_item: 1,
      include_item_in_manufacturing: 0,
      is_purchase_item: 1,
      is_sales_item: 0,
      brand: clean(r.Brand),
      // The store's condition wording is kept, because it is what the shelf
      // label says and losing it would make the catalog read differently
      // from the store it describes.
      description: status ? `${name} (${status})` : name,
      safety_stock: num(r["Min Stock"]),
      valuation_rate: cost > 0 ? cost : "",
      custom_rack_location: clean(r.Location),
      image: clean(r.Image),
      "company (Item Default)": ERP_COMPANY,
      "default_warehouse (Item Default)": MAIN_WAREHOUSE,
    };
  });

  await fs.writeFile(path.join(outDir, "03-items.csv"), toCsv(itemCols, items), "utf8");
  console.log(`03-items.csv         ${items.length} items`);

  // --- opening stock ----------------------------------------------------
  // Two warehouses: the shelf, and the Red Rack for what has come back and is
  // waiting on a merge. Leaving the second out would open ERPNext short.
  const balances = [];
  for (const r of rows) {
    const code = clean(r.SAPID);
    const rate = num(r["Unit Cost"]);
    const onHand = num(r["Stock Available"]);
    const onRed = num(r["Stock on Red Rack"]);
    if (onHand > 0) balances.push({ item_code: code, warehouse: MAIN_WAREHOUSE, qty: onHand, valuation_rate: rate });
    if (onRed > 0) balances.push({ item_code: code, warehouse: RED_STOCK_WAREHOUSE, qty: onRed, valuation_rate: rate });
  }

  await fs.writeFile(
    path.join(outDir, "04-opening-stock.csv"),
    toCsv(["item_code", "warehouse", "qty", "valuation_rate"], balances),
    "utf8"
  );
  const units = balances.reduce((s, b) => s + b.qty, 0);
  console.log(`04-opening-stock.csv ${balances.length} balances, ${units.toLocaleString()} units`);

  // --- what needs a human's eye ----------------------------------------
  console.log("");
  if (guessed.size) {
    console.log("Units with no exact ERPNext match, defaulted:");
    for (const [from, to] of guessed) console.log(`   "${from}" -> ${to}`);
  }
  const uncosted = rows.filter((r) => num(r["Unit Cost"]) <= 0).length;
  console.log(`\n${uncosted} of ${rows.length} items have no unit cost.`);
  console.log("Tick 'Allow Zero Valuation Rate' on the Stock Reconciliation, or it refuses them.");

  return { groups: groups.length, brands: brands.length, items: items.length, balances: balances.length };
};

main().catch((error) => {
  console.error("\nConversion failed:", error.message);
  process.exit(1);
});
