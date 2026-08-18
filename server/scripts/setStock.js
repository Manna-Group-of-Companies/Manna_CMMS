/**
 * Sets opening stock levels from a counted-stock sheet.
 *
 *   node scripts/setStock.js <stock.csv> [--room "Manna Rubber Products"] [--add] [--dry-run]
 *
 * The file needs a product code column and a quantity column; the same heading
 * aliases importProducts.js accepts work here (code/sku/sapid, qty/quantity/
 * stock/closingstock/physicalstock...). Everything else in the file is ignored.
 *
 *   default   the quantity is the counted total — the room is adjusted up or
 *             down to match it, so re-running the same sheet is a no-op
 *   --add     the quantity is added to whatever is already there
 *
 * Every change is written twice: once through creditRoom/debitRoom, which move
 * the per-room row and recompute `Product.quantity` from it, and once as a
 * STOCK_IN/STOCK_OUT row in the StockMovement ledger. The ledger entry is the
 * point — without it a balance appears in the app with no record of where it
 * came from, and the Admin's movement history for that product starts with an
 * unexplained number.
 */
import path from "path";
import { readFileSync } from "fs";
import mongoose from "mongoose";
import dotenv from "dotenv";

import Product from "../models/Product.js";
import StockMovement from "../models/StockMovement.js";
import StockRoomInventory from "../models/StockRoomInventory.js";
import { creditRoom, debitRoom, ensureDefaultRooms, resolveRoom } from "../utils/stockRooms.js";

dotenv.config();

const DEFAULT_ROOM = "Manna Rubber Products";

const CODE_ALIASES = ["code", "productcode", "itemcode", "sku", "sapid", "sap", "partno", "id"];
const QTY_ALIASES = [
  "quantity", "qty", "stock", "currentstock", "openingstock", "closingstock",
  "physicalstock", "countedstock", "balance", "onhand", "instock", "availablestock",
];
const ROOM_ALIASES = ["storeroom", "room", "store", "location", "stockroom", "warehouse"];

const normalize = (heading) => String(heading).toLowerCase().replace(/[^a-z0-9]/g, "");

const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (input[i + 1] === '"') { field += '"'; i += 1; }
      else quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "," || char === "\t") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += char;
  }
  row.push(field);
  rows.push(row);
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
};

const toNumber = (value) => {
  if (value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/[,\s]/g, ""));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
};

const run = async () => {
  const argv = process.argv.slice(2);
  const file = argv.find((arg) => !arg.startsWith("--") && argv[argv.indexOf(arg) - 1] !== "--room");
  const add = argv.includes("--add");
  const dryRun = argv.includes("--dry-run");
  const roomName = argv.includes("--room") ? argv[argv.indexOf("--room") + 1] : DEFAULT_ROOM;

  if (!file) {
    console.error('Usage: node scripts/setStock.js <stock.csv> [--room "Manna Rubber Products"] [--add] [--dry-run]');
    process.exit(1);
  }

  const rows = parseCsv(readFileSync(path.resolve(file), "utf8"));

  let headingIndex = -1;
  let codeAt = -1;
  let qtyAt = -1;
  let roomAt = -1;

  for (let i = 0; i < rows.length; i += 1) {
    const keys = rows[i].map(normalize);
    const c = keys.findIndex((key) => CODE_ALIASES.includes(key));
    const q = keys.findIndex((key) => QTY_ALIASES.includes(key));
    if (c !== -1 && q !== -1) {
      headingIndex = i; codeAt = c; qtyAt = q;
      roomAt = keys.findIndex((key) => ROOM_ALIASES.includes(key));
      break;
    }
  }

  if (headingIndex === -1) {
    throw new Error(
      "No heading row with both a code column and a quantity column was found.\n" +
        `  code aliases: ${CODE_ALIASES.join(", ")}\n` +
        `  qty aliases:  ${QTY_ALIASES.join(", ")}`
    );
  }

  console.log(
    `Using column "${rows[headingIndex][codeAt]}" as code and "${rows[headingIndex][qtyAt]}" as quantity` +
      (roomAt !== -1 ? `, "${rows[headingIndex][roomAt]}" as room.` : `.`)
  );

  const counts = [];
  const problems = [];

  rows.slice(headingIndex + 1).forEach((cells, i) => {
    const line = headingIndex + i + 2;
    const code = (cells[codeAt] ?? "").trim();
    if (!code) return;

    const quantity = toNumber(cells[qtyAt]);
    if (quantity === null) { problems.push(`Line ${line} (${code}): quantity "${(cells[qtyAt] ?? "").trim()}" is not a number`); return; }
    if (quantity < 0) { problems.push(`Line ${line} (${code}): quantity cannot be negative`); return; }

    counts.push({ code, quantity, room: (roomAt !== -1 ? cells[roomAt] : "")?.trim() || roomName, line });
  });

  if (problems.length > 0) {
    console.error(`\n${problems.length} row(s) could not be read:`);
    problems.forEach((message) => console.error(`  ${message}`));
    console.error("\nNothing was written.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("MongoDB Connected");
  await ensureDefaultRooms();

  const plan = [];
  const missing = [];

  for (const count of counts) {
    const product = await Product.findOne({ code: count.code });
    if (!product) { missing.push(count); continue; }

    const room = await resolveRoom(count.room);
    const existing = await StockRoomInventory.findOne({ stockRoom: room._id, product: product._id });
    const current = existing?.quantity ?? 0;
    const target = add ? current + count.quantity : count.quantity;

    plan.push({ product, room, current, target, delta: target - current, code: count.code });
  }

  const changing = plan.filter((entry) => entry.delta !== 0);

  console.log(
    `\n${counts.length} counted row(s): ${plan.length} matched a product, ${missing.length} unknown code(s).`
  );
  console.log(`${changing.length} product(s) would change; ${plan.length - changing.length} already correct.`);

  if (missing.length > 0) {
    console.log(`\nUnknown codes (import these products first):`);
    console.log(`  ${missing.map((m) => m.code).join(", ")}`);
  }

  console.table(
    changing.slice(0, 15).map((entry) => ({
      code: entry.code,
      product: entry.product.name.slice(0, 32),
      room: entry.room.name,
      from: entry.current,
      to: entry.target,
      delta: entry.delta > 0 ? `+${entry.delta}` : entry.delta,
    }))
  );
  if (changing.length > 15) console.log(`... and ${changing.length - 15} more.`);

  if (dryRun) {
    console.log("\nDry run: nothing was written.");
    return;
  }

  const reference = `OPENING-${path.basename(file)}`;
  let applied = 0;
  const failed = [];

  for (const entry of changing) {
    try {
      const moved = Math.abs(entry.delta);
      const result = entry.delta > 0
        ? await creditRoom({ product: entry.product, room: entry.room, quantity: moved })
        : await debitRoom({ product: entry.product, room: entry.room, quantity: moved });

      await StockMovement.create({
        product: entry.product._id,
        productName: entry.product.name,
        productCode: entry.product.code,
        type: entry.delta > 0 ? "STOCK_IN" : "STOCK_OUT",
        direction: entry.delta > 0 ? "IN" : "OUT",
        toRoom: entry.delta > 0 ? entry.room.name : "",
        fromRoom: entry.delta > 0 ? "" : entry.room.name,
        quantity: moved,
        balanceAfter: result.productQuantity,
        reference,
        note: add
          ? `Stock added from ${path.basename(file)}`
          : `Opening balance set from ${path.basename(file)} (was ${entry.current})`,
      });

      applied += 1;
    } catch (error) {
      failed.push(`${entry.code}: ${error.message}`);
    }
  }

  console.log(`\nApplied to ${applied} product(s); ledger reference "${reference}".`);
  if (failed.length > 0) {
    console.error(`${failed.length} failed:`);
    failed.forEach((message) => console.error(`  ${message}`));
  }
};

run()
  .catch((error) => {
    console.error(`\nFailed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
