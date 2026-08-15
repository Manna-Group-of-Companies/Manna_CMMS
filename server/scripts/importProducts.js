/**
 * One-off bulk import of the product catalog from a spreadsheet export.
 *
 * The seeder in utils/seeder.js only fires when the products collection is
 * completely empty, so it cannot be used to top up an existing catalog. This
 * script is the re-runnable alternative: it matches on `code`, skips rows that
 * are already in the database, and reports exactly what it did.
 *
 *   node scripts/importProducts.js <file.csv> [options]
 *
 *   --room "<name>"  Room for rows with no store room column (default: Engineer Room)
 *   --update         Overwrite the fields of products whose code already exists
 *   --dry-run        Parse and validate only; write nothing
 *   --tidy           Repair rows the store take left rough instead of rejecting
 *                    them: blank unit, blank category, negative quantity. Every
 *                    repair is listed before anything is written.
 *
 * Opening stock is never written to `Product.quantity` directly — that field is
 * derived. Quantities go in through creditRoom(), which writes the per-room row
 * and recomputes the total; see the note at the top of utils/stockRooms.js.
 */
import path from "path";
import { readFileSync } from "fs";
import mongoose from "mongoose";
import dotenv from "dotenv";

import Product from "../models/Product.js";
import StockRoomInventory from "../models/StockRoomInventory.js";
import {
  creditRoom,
  ensureDefaultRooms,
  migrateProductsIntoRooms,
  resolveRoom,
  syncProductTotal,
} from "../utils/stockRooms.js";

dotenv.config();

const DEFAULT_ROOM = "Engineer Room";

/** What a row falls back to under --tidy when the sheet left the cell empty. */
const TIDY_UNIT = "Units";
const TIDY_CATEGORY = "Uncategorized";

/**
 * Spreadsheet heading → schema field. Headings are matched after stripping
 * everything but letters and digits, so "Min. Stock", "min_stock" and
 * "MIN STOCK" all land on the same field and the sheet can be laid out however
 * its author found readable.
 */
const COLUMN_ALIASES = {
  code: ["code", "productcode", "itemcode", "sku", "partno", "partnumber", "id", "sapid"],
  name: ["name", "productname", "itemname", "product", "item", "description1"],
  category: ["category", "type", "group", "productcategory", "maincategory"],
  subCategory: ["subcategory", "subgroup", "secondarycategory"],
  brand: ["brand", "make", "manufacturer"],
  status: ["status", "condition"],
  // "location" belongs here, not on storeRoom: a stock sheet's location column
  // holds a rack — "C15", "Tool Peg Board" — and reading it as a store room
  // would create a room per shelf. Rooms come from the store room column or
  // --room.
  rackNumber: [
    "rack", "racknumber", "rackno", "shelf", "shelfno", "bin", "binlocation", "position", "location",
  ],
  quantity: [
    "quantity", "qty", "stock", "openingstock", "currentstock", "instock",
    "stockavailable", "availablestock",
  ],
  unit: ["unit", "uom", "units", "measure"],
  minStock: ["minstock", "min", "minimum", "minimumstock", "reorderlevel", "minqty"],
  maxStock: ["maxstock", "max", "maximum", "maximumstock", "maxqty"],
  unitCost: ["unitcost", "cost", "rate", "price", "unitprice"],
  storeRoom: ["storeroom", "room", "store", "stockroom", "warehouse"],
  description: ["description", "details", "remarks", "notes", "specification"],
  image: ["image", "imageurl", "photo", "picture", "img"],
};

const normalizeHeading = (heading) => String(heading).toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Splits delimited text into rows of cells.
 *
 * Written out by hand rather than pulled in as a dependency: the server has no
 * CSV library and a spreadsheet export only needs quoted fields, doubled quotes
 * and embedded newlines to be handled correctly.
 */
const parseDelimited = (text, delimiter) => {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  // Strip the BOM Excel and Sheets both prepend, or it becomes part of the
  // first heading and that column stops matching its alias.
  const input = text.replace(/^﻿/, "");

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (quoted) {
      if (char !== '"') {
        field += char;
      } else if (input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = false;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      // Treat CRLF as one break rather than an extra empty row.
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field);
  rows.push(row);

  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
};

/** Sheets exports as CSV or TSV depending on which menu item was used. */
const detectDelimiter = (text) => {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  return firstLine.split("\t").length > firstLine.split(",").length ? "\t" : ",";
};

/**
 * Finds the heading row and maps each row onto schema field names.
 *
 * The heading row is searched for rather than assumed to be first: exports
 * often carry a title or a blank line above the real headings.
 */
const readRecords = (text) => {
  const rows = parseDelimited(text, detectDelimiter(text));
  if (rows.length === 0) throw new Error("The file is empty.");

  let headingIndex = -1;
  let columns = null;

  for (let i = 0; i < rows.length; i += 1) {
    const mapped = rows[i].map((cell) => {
      const key = normalizeHeading(cell);
      return Object.keys(COLUMN_ALIASES).find((field) =>
        COLUMN_ALIASES[field].includes(key)
      );
    });

    // A real heading row names at least the two fields nothing can be
    // invented for. Anything less is a title or a stray line above the table.
    if (mapped.includes("code") && mapped.includes("name")) {
      headingIndex = i;
      columns = mapped;
      break;
    }
  }

  if (headingIndex === -1) {
    throw new Error(
      `No heading row found. The sheet needs a row naming at least a code column and a name column.\n` +
        `First row seen: ${rows[0].join(" | ")}`
    );
  }

  const unmatched = rows[headingIndex].filter((_, i) => !columns[i] && rows[headingIndex][i].trim());

  const records = rows.slice(headingIndex + 1).map((cells, i) => {
    const record = { __line: headingIndex + i + 2 };
    columns.forEach((field, column) => {
      if (field) record[field] = (cells[column] ?? "").trim();
    });
    return record;
  });

  return { records, unmatched };
};

/** Spreadsheet numbers arrive as "1,200" or "12 " as often as they do as 12. */
const toNumber = (value, fallback) => {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(String(value).replace(/[,\s]/g, ""));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};

/**
 * Same, but keeps the fraction. Stock is counted in whole units nearly
 * everywhere, and then a row says half a packet of welding rods or 0.9 kg of
 * stay wire — truncating those to 0 would quietly delete the stock.
 */
const toDecimal = (value, fallback) => {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(String(value).replace(/[,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseArgs = (argv) => {
  const options = { file: null, room: DEFAULT_ROOM, update: false, dryRun: false, tidy: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--update") options.update = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--tidy") options.tidy = true;
    else if (arg === "--room") options.room = argv[++i];
    else if (!arg.startsWith("--")) options.file = arg;
  }

  return options;
};

/**
 * Places opening stock in one room.
 *
 * creditRoom() is the only sanctioned way to move stock and it insists on whole
 * units, which is right for every later flow — you cannot issue half a packet.
 * An opening balance is the one moment a fraction has to survive, so those rows
 * write the room row directly and let syncProductTotal recompute the total the
 * same way creditRoom would.
 */
const placeOpeningStock = async ({ product, room, quantity }) => {
  if (Number.isInteger(quantity)) {
    return creditRoom({ product, room, quantity });
  }

  const target = await resolveRoom(room);
  if (!target) throw new Error(`Store room "${room}" could not be resolved`);

  await StockRoomInventory.updateOne(
    { stockRoom: target._id, product: product._id },
    { $inc: { quantity } },
    { upsert: true, setDefaultsOnInsert: true }
  );
  product.quantity = await syncProductTotal(product._id);
  return { room: target };
};

const run = async () => {
  const options = parseArgs(process.argv.slice(2));

  if (!options.file) {
    console.error("Usage: node scripts/importProducts.js <file.csv> [--room \"Engineer Room\"] [--update] [--dry-run]");
    process.exit(1);
  }

  const filePath = path.resolve(options.file);
  const { records, unmatched } = readRecords(readFileSync(filePath, "utf8"));

  console.log(`Read ${records.length} row(s) from ${filePath}`);
  if (unmatched.length > 0) {
    console.log(`Ignored unrecognised column(s): ${unmatched.join(", ")}`);
  }

  // Validate the whole file before touching the database, so a bad row halfway
  // down is reported alongside the rest instead of after a partial import.
  const invalid = [];
  const repaired = [];
  const seen = new Map();
  const rows = [];

  for (const record of records) {
    const row = {
      code: record.code || "",
      name: record.name || "",
      category: record.category || "",
      subCategory: record.subCategory || "",
      brand: record.brand || "",
      status: record.status || "",
      rackNumber: record.rackNumber || "",
      unit: record.unit || "",
      storeRoom: record.storeRoom || options.room,
      description: record.description || "",
      image: record.image || "",
      minStock: toNumber(record.minStock, 5),
      maxStock: toNumber(record.maxStock, 100),
      unitCost: Math.max(toDecimal(record.unitCost, 0), 0),
      openingStock: toDecimal(record.quantity, 0),
      line: record.__line,
    };

    // A stock take fills the columns it can and leaves the rest. Under --tidy
    // the two cells that can be defaulted without inventing anything are, and
    // both are reported; without it the row is still refused.
    if (options.tidy) {
      if (!row.unit) {
        row.unit = TIDY_UNIT;
        repaired.push(`Line ${row.line} (${row.code}): blank unit → "${TIDY_UNIT}"`);
      }
      if (!row.category) {
        row.category = TIDY_CATEGORY;
        repaired.push(`Line ${row.line} (${row.code}): blank category → "${TIDY_CATEGORY}"`);
      }
      if (row.openingStock < 0) {
        repaired.push(
          `Line ${row.line} (${row.code}): quantity ${row.openingStock} → 0 (stock cannot be negative)`
        );
        row.openingStock = 0;
      }
    }

    const missing = ["code", "name", "category", "unit"].filter((field) => !row[field]);

    if (missing.length > 0) {
      invalid.push(`Line ${row.line}: missing ${missing.join(", ")}`);
      continue;
    }
    if (row.openingStock < 0) {
      invalid.push(`Line ${row.line} (${row.code}): quantity cannot be negative`);
      continue;
    }
    if (row.minStock < 0 || row.maxStock < 0) {
      invalid.push(`Line ${row.line} (${row.code}): min/max stock cannot be negative`);
      continue;
    }
    if (seen.has(row.code)) {
      invalid.push(`Line ${row.line}: code "${row.code}" repeats line ${seen.get(row.code)}`);
      continue;
    }

    seen.set(row.code, row.line);
    rows.push(row);
  }

  if (repaired.length > 0) {
    console.log(`\n${repaired.length} row(s) repaired by --tidy:`);
    repaired.forEach((message) => console.log(`  ${message}`));
  }

  if (invalid.length > 0) {
    console.error(`\n${invalid.length} row(s) could not be imported:`);
    invalid.forEach((message) => console.error(`  ${message}`));
    console.error("\nNothing was written. Fix these rows and run again.");
    process.exit(1);
  }

  if (options.dryRun) {
    console.log(`\nDry run: ${rows.length} row(s) are valid and ready to import.`);
    console.table(
      rows.slice(0, 10).map(({ code, name, openingStock, unit, storeRoom }) => ({
        code,
        name,
        qty: openingStock,
        unit,
        room: storeRoom,
      }))
    );
    if (rows.length > 10) console.log(`... and ${rows.length - 10} more.`);
    return;
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("MongoDB Connected");

  await ensureDefaultRooms();

  // Named up front so a typo in --room fails here rather than after half the
  // catalog has been created.
  for (const name of new Set(rows.map((row) => row.storeRoom))) {
    const room = await resolveRoom(name);
    if (!room) throw new Error(`Store room "${name}" could not be resolved or created.`);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const failed = [];

  for (const row of rows) {
    const { openingStock, line, ...fields } = row;

    try {
      const existing = await Product.findOne({ code: fields.code });

      if (existing) {
        if (!options.update) {
          skipped += 1;
          continue;
        }
        // `quantity` is deliberately absent from `fields`: overwriting the
        // catalog details of an existing product must not silently rewrite a
        // balance the room rows are the real record of.
        await Product.updateOne({ _id: existing._id }, { $set: fields });
        updated += 1;
        continue;
      }

      // Created without a quantity so it defaults to 0; creditRoom then places
      // the opening stock in the room and recomputes the total from the rows.
      const product = await Product.create(fields);

      if (openingStock > 0) {
        await placeOpeningStock({ product, room: fields.storeRoom, quantity: openingStock });
      }

      created += 1;
    } catch (error) {
      failed.push(`Line ${line} (${fields.code}): ${error.message}`);
    }
  }

  // Products imported with no opening stock have no room row yet. This gives
  // them a zero row in their own store room, so they show up in room-scoped
  // views instead of only appearing once stock first arrives.
  await migrateProductsIntoRooms();

  console.log(
    `\nImport finished: ${created} created, ${updated} updated, ${skipped} skipped (code already present).`
  );
  if (failed.length > 0) {
    console.error(`${failed.length} row(s) failed:`);
    failed.forEach((message) => console.error(`  ${message}`));
  }
  if (skipped > 0 && !options.update) {
    console.log("Re-run with --update to overwrite the skipped products.");
  }
};

run()
  .catch((error) => {
    console.error(`\nImport failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
