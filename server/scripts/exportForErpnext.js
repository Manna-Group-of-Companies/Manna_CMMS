import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import dotenv from "dotenv";

import connectDB from "../config/db.js";
import Product from "../models/Product.js";
import Company from "../models/Company.js";
import StockRoom from "../models/StockRoom.js";
import StockRoomInventory from "../models/StockRoomInventory.js";
import RestockItem from "../models/RestockItem.js";
import Recipient from "../models/Recipient.js";
import { toCsv } from "../integrations/erpnext/csv.js";
import { buildItem, planItemGroups, buildBrands } from "../integrations/erpnext/masterData.js";
import { resolveUom } from "../integrations/erpnext/uom.js";
import { listDocs } from "../integrations/erpnext/client.js";
import { erpEnabled } from "../integrations/erpnext/config.js";
import { ERP_COMPANY, ERP_ABBR, ERP_RED_STOCK_WAREHOUSE } from "../models/Company.js";

dotenv.config();

/**
 * Exports the CMMS catalog and balances as sheets for ERPNext's Data Import.
 *
 *   node scripts/exportForErpnext.js
 *   node scripts/exportForErpnext.js --out "C:\\erp-import"
 *
 * Needs MONGO_URI in server/.env and nothing else. It never contacts ERPNext,
 * so it can be run before any of the integration is configured.
 *
 * The files are deliberately the same shapes the API push would create,
 * because they are built by the same mappers — `buildItem`, `planItemGroups`,
 * `resolveUom`. Importing these by hand and running the API push later cannot
 * therefore produce two different catalogs.
 *
 * Written as CSV rather than .xlsx: Excel opens it directly, ERPNext's
 * importer takes it without conversion, and it needs no library that would
 * have to be added to the server's dependencies for a one-time migration.
 */

const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const OUT_DIR = outAt >= 0 && args[outAt + 1]
  ? args[outAt + 1]
  : path.join(process.cwd(), "exports", "erpnext");

const log = (...parts) => console.log(...parts);

/**
 * The production Item Groups as they stood on 21 Aug 2026.
 *
 * A fallback, used only when ERPNext credentials are not configured — this
 * script is meant to run with nothing but a MONGO_URI, and a category that
 * silently reuses one of these would file maintenance spares into production
 * stock with nothing afterwards to show it had happened.
 *
 * A snapshot can go stale, which is why the live list is preferred whenever
 * the connection details are present.
 */
const KNOWN_PRODUCTION_GROUPS = [
  "All Item Groups", "Bonding Gum", "Consumable", "Hot Rubber", "Maintenance Store",
  "Precured", "Products", "Raw Material", "Repair Tyres", "Retread Tyres",
  "Retreading", "Services", "Sub Assemblies", "Vulcanizing Solution",
];

/** Item Group names already in use, live if possible and from the snapshot if not. */
const takenItemGroups = async () => {
  if (!erpEnabled()) {
    log("ERPNext not configured - checking name clashes against the 21 Aug snapshot.\n");
    return new Set(KNOWN_PRODUCTION_GROUPS);
  }

  try {
    const names = new Set();
    let start = 0;
    for (;;) {
      const page = await listDocs("Item Group", { fields: ["name"], limit: 100, start });
      if (!Array.isArray(page) || page.length === 0) break;
      for (const row of page) names.add(row.name);
      if (page.length < 100) break;
      start += 100;
    }
    log(`Checked name clashes against ${names.size} live Item Group(s).\n`);
    return names;
  } catch (error) {
    log(`Could not read ERPNext (${error.message}); using the 21 Aug snapshot.\n`);
    return new Set(KNOWN_PRODUCTION_GROUPS);
  }
};

/** Writes one sheet and reports it. */
const writeSheet = async (file, columns, rows, note = "") => {
  const target = path.join(OUT_DIR, file);
  await fs.writeFile(target, toCsv(columns, rows), "utf8");
  log(`  ${file.padEnd(28)} ${String(rows.length).padStart(6)} row(s)${note ? `  ${note}` : ""}`);
  return rows.length;
};

const main = async () => {
  await connectDB();
  await fs.mkdir(OUT_DIR, { recursive: true });

  log(`Exporting to ${OUT_DIR}\n`);

  const company = (await Company.findOne({ isActive: true, erpCompany: { $ne: "" } }))?.erpCompany
    || ERP_COMPANY;

  const products = await Product.find().sort({ code: 1 });
  log(`Catalog: ${products.length} product(s)\n`);
  log("Sheets:");

  // --- 1. Item Groups ---------------------------------------------------
  // Exported in creation order, parents before children. ERPNext validates
  // parent_item_group on insert, so a child imported first is rejected.
  const { groups, groupFor } = planItemGroups(
    products.map((p) => ({ category: p.category, subCategory: p.subCategory })),
    await takenItemGroups()
  );

  await writeSheet(
    "01-item-groups.csv",
    ["item_group_name", "parent_item_group", "is_group"],
    groups,
    "import first, keep the row order"
  );

  // --- 2. Brands --------------------------------------------------------
  await writeSheet(
    "02-brands.csv",
    ["brand", "description"],
    buildBrands(products.map((p) => p.brand))
  );

  // --- 3. Items ---------------------------------------------------------
  const roomToWarehouse = new Map();
  for (const room of await StockRoom.find().populate("company", "erpWarehouse")) {
    if (room.company?.erpWarehouse) roomToWarehouse.set(room.name, room.company.erpWarehouse);
  }

  const itemRows = [];
  const skipped = [];
  const guessedUnits = new Map();

  for (const product of products) {
    const built = buildItem({
      product,
      itemGroup: groupFor(product.category, product.subCategory),
      company,
      defaultWarehouse: roomToWarehouse.get(product.storeRoom) || "",
    });

    if (built.skip) {
      skipped.push({ name: product.name, reason: built.reason });
      continue;
    }
    if (built.uomWasGuessed) {
      guessedUnits.set(product.unit || "(blank)", resolveUom(product.unit).uom);
    }

    const p = built.payload;
    itemRows.push({
      item_code: p.item_code,
      item_name: p.item_name,
      item_group: p.item_group,
      stock_uom: p.stock_uom,
      is_stock_item: p.is_stock_item,
      include_item_in_manufacturing: p.include_item_in_manufacturing,
      is_purchase_item: p.is_purchase_item,
      is_sales_item: p.is_sales_item,
      brand: p.brand || "",
      description: p.description,
      safety_stock: p.safety_stock,
      valuation_rate: p.valuation_rate ?? "",
      custom_sap_item_code: p.custom_sap_item_code || "",
      // ERPNext's importer fills a child table from flat columns named
      // "<child field> (<Child DocType>)". This is how the default warehouse
      // reaches Item Default without a second sheet.
      "company (Item Default)": company,
      "default_warehouse (Item Default)": p.item_defaults?.[0]?.default_warehouse || "",
    });
  }

  await writeSheet(
    "03-items.csv",
    [
      "item_code", "item_name", "item_group", "stock_uom",
      "is_stock_item", "include_item_in_manufacturing", "is_purchase_item", "is_sales_item",
      "brand", "description", "safety_stock", "valuation_rate", "custom_sap_item_code",
      "company (Item Default)", "default_warehouse (Item Default)",
    ],
    itemRows,
    "import after groups and brands"
  );

  // --- 4. Opening stock -------------------------------------------------
  // Two sources, as everywhere else: the per-room shelves, and Red Stock,
  // which is returned batches rather than a room and is summed per product.
  const balances = [];

  for (const row of await StockRoomInventory.find({ quantity: { $gt: 0 } })
    .populate("product", "code unitCost")
    .populate("stockRoom", "name")) {
    const warehouse = roomToWarehouse.get(row.stockRoom?.name);
    if (!row.product?.code || !warehouse) continue;
    balances.push({
      item_code: row.product.code,
      warehouse,
      qty: row.quantity,
      valuation_rate: Number(row.product.unitCost || 0),
    });
  }

  const redStock = new Map();
  for (const item of await RestockItem.find({
    status: { $in: ["In Red Stock", "Weekly Merge Pending"] },
    quantity: { $gt: 0 },
  }).populate("product", "code unitCost")) {
    const code = item.productCode || item.product?.code;
    if (!code) continue;
    const existing = redStock.get(code) || { qty: 0, rate: Number(item.product?.unitCost || 0) };
    existing.qty += item.quantity;
    redStock.set(code, existing);
  }
  for (const [code, { qty, rate }] of redStock) {
    balances.push({
      item_code: code,
      warehouse: ERP_RED_STOCK_WAREHOUSE,
      qty,
      valuation_rate: rate,
    });
  }

  await writeSheet(
    "04-opening-stock.csv",
    ["item_code", "warehouse", "qty", "valuation_rate"],
    balances,
    "import LAST, as Stock Reconciliation"
  );

  // --- 5. Recipients ----------------------------------------------------
  // Who stock gets issued to. Only the ones outside the group map to Supplier;
  // internal recipients are people and belong in Employee, which needs fields
  // the CMMS has never collected, so they are exported for review rather than
  // shaped into a DocType that would reject them.
  const recipients = await Recipient.find().sort({ name: 1 });
  await writeSheet(
    "05-recipients-review.csv",
    ["name", "type", "erpnext_suggestion"],
    recipients.map((r) => ({
      name: r.name,
      type: r.type,
      erpnext_suggestion: r.type === "Outside Company" ? "Supplier" : "Employee (needs joining date)",
    })),
    "review by hand, do not import blind"
  );

  // --- the README -------------------------------------------------------
  const readme = `ERPNext import - Manna CMMS
${"=".repeat(60)}

Generated from MongoDB. Import through Awesome Bar > "Data Import" in ERPNext,
choosing the DocType named below for each file. Import IN THIS ORDER: each one
depends on the one before it, and ERPNext validates links on insert.

  01-item-groups.csv      -> Item Group
                             Keep the row order. Parents must exist before
                             their children or the child row is rejected.

  02-brands.csv           -> Brand

  03-items.csv            -> Item
                             ${itemRows.length} rows. The two "(Item Default)"
                             columns fill the child table that sets each item's
                             default warehouse.

  04-opening-stock.csv    -> Stock Reconciliation
                             ${balances.length} rows. Import LAST. Set Purpose
                             to "Opening Stock" and the expense account to
                             "Temporary Opening - ${ERP_ABBR}".
                             Tick "Allow Zero Valuation Rate" for rows whose
                             valuation_rate is 0 - most of the catalog has
                             never been costed and ERPNext refuses to open a
                             balance it cannot value.

  05-recipients-review.csv -> nothing, yet
                             Read it first. Outside companies map to Supplier;
                             internal recipients are people and Employee needs
                             a joining date the CMMS has never collected.

BEFORE YOU IMPORT
${"-".repeat(60)}

1. Item Group name clashes - already handled, but worth checking.
   ERPNext Item Group names are unique across the whole system, and your
   production tree uses names like Consumable, Raw Material and Services.
   Any category of yours matching one has been renamed in the sheet with a
   " (Maintenance)" suffix, so importing cannot file maintenance spares into
   production stock. Scan 01-item-groups.csv for that suffix to see which
   were affected, and rename them to something you prefer if you like -
   just change it in BOTH 01-item-groups.csv and the item_group column of
   03-items.csv, or the item rows will point at a group that does not exist.

2. Units. ERPNext has no "Pcs"; its countable unit is "Nos".
${
  guessedUnits.size === 0
    ? "   Every unit in your catalog mapped cleanly."
    : `   ${guessedUnits.size} unit(s) had no exact match and were defaulted:\n` +
      [...guessedUnits].map(([from, to]) => `     "${from}" -> ${to}`).join("\n") +
      "\n   Check these before importing. A unit cannot be changed once an item\n   holds stock; it can only be corrected by recreating the item."
}

3. The warehouses must already exist. These four were created on 21 Aug 2026:
     Manna Rubber Products Store - ${ERP_ABBR}
     Hi-Tech Rubber Industries Store - ${ERP_ABBR}
     Manna Treads Store - ${ERP_ABBR}
     Red Stock - ${ERP_ABBR}
${
  skipped.length === 0
    ? ""
    : `\n4. ${skipped.length} product(s) were left out because they have no code:\n` +
      skipped.slice(0, 20).map((s) => `     ${s.name} - ${s.reason}`).join("\n") +
      (skipped.length > 20 ? `\n     ...and ${skipped.length - 20} more.` : "") +
      "\n   Give them a code in the CMMS and export again, or they will have no\n   Item in ERPNext and no balance can be opened for them."
}

Company for every row: ${company}
`;

  await fs.writeFile(path.join(OUT_DIR, "README.txt"), readme, "utf8");
  log(`  ${"README.txt".padEnd(28)}        read this first`);

  log(`\nDone. ${itemRows.length} item(s), ${balances.length} balance(s).`);
  if (guessedUnits.size > 0) log(`${guessedUnits.size} unit(s) were defaulted - see the README.`);
  if (skipped.length > 0) log(`${skipped.length} product(s) skipped for having no code.`);

  await mongoose.connection.close();
};

main().catch(async (error) => {
  console.error("\nExport failed:", error.message);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
