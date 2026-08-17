/**
 * Derives a product catalog from the "Products - Transactions" sheet export.
 *
 * That sheet is an issue/return ledger, not a catalog: one row per movement,
 * with the product identified by its SAP id. This collapses it to one row per
 * distinct SAPID and writes a CSV that scripts/importProducts.js can read.
 *
 *   node scripts/extractProductsFromTransactions.js <transactions.csv> <products.csv>
 *
 * Two things the ledger cannot tell us, and which this deliberately does not
 * guess at:
 *
 *   Stock on hand. The `Qty` column is the size of one movement — and it runs
 *   negative on correction rows — so it is not a balance. Every product is
 *   written with an opening stock of 0; real balances come in later through
 *   the stock-in flow, which records who counted them and when.
 *
 * Rows the ledger cannot describe are left out of the output and listed in a
 * review file instead: a product with no name anywhere is not something this
 * can honestly synthesise.
 */
import path from "path";
import { readFileSync, writeFileSync } from "fs";

const UNKNOWN = "Unknown";

/** Shared with importProducts.js in behaviour; kept local so each script runs alone. */
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
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += char;
  }

  row.push(field);
  rows.push(row);
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
};

/** The export writes M/D/YYYY H:mm:ss, which Date parses inconsistently across platforms. */
const parseTimestamp = (value) => {
  const match = String(value).match(/(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+):(\d+)/);
  if (!match) return 0;
  const [, month, day, year, hour, minute, second] = match.map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second);
};

const escapeCsv = (value) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const run = () => {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error("Usage: node scripts/extractProductsFromTransactions.js <transactions.csv> <products.csv>");
    process.exit(1);
  }

  const rows = parseCsv(readFileSync(path.resolve(input), "utf8"));
  const headingIndex = rows.findIndex((cells) => cells.includes("SAPID"));
  if (headingIndex === -1) throw new Error('No heading row containing "SAPID" was found.');

  const heading = rows[headingIndex].map((cell) => cell.trim());
  const records = rows.slice(headingIndex + 1).map((cells) =>
    Object.fromEntries(heading.map((key, i) => [key, (cells[i] ?? "").trim()]))
  );

  const products = new Map();

  for (const record of records) {
    const code = record.SAPID;
    if (!code) continue;

    if (!products.has(code)) {
      products.set(code, { code, names: new Map(), category: "", unit: "", movements: 0 });
    }

    const product = products.get(code);
    product.movements += 1;
    // Category and UOM are consistent per SAPID across this export, so last
    // non-empty wins is enough; the name is the field that actually varies.
    if (record.Category) product.category = record.Category;
    if (record.UOM) product.unit = record.UOM;

    const name = record["Transaction Product"];
    if (name) {
      const at = parseTimestamp(record.Timestamp);
      const seen = product.names.get(name);
      if (seen === undefined || at > seen) product.names.set(name, at);
    }
  }

  const ready = [];
  const unnamed = [];
  const conflicts = [];

  for (const product of products.values()) {
    if (product.names.size === 0) {
      unnamed.push(product);
      continue;
    }

    // Most recent spelling wins: where one SAP id carries two names the later
    // rows are the correction, but it is still flagged for review below.
    const ranked = [...product.names.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length > 1) {
      conflicts.push({ code: product.code, chosen: ranked[0][0], rejected: ranked.slice(1).map(([n]) => n) });
    }

    ready.push({
      code: product.code,
      name: ranked[0][0],
      category: product.category || UNKNOWN,
      quantity: 0,
      unit: product.unit || "Units",
      minStock: 5,
      description: `Imported from transaction ledger (${product.movements} movement${product.movements === 1 ? "" : "s"}).`,
    });
  }

  ready.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  const columns = ["code", "name", "category", "quantity", "unit", "minStock", "description"];
  const csv = [
    columns.join(","),
    ...ready.map((product) => columns.map((column) => escapeCsv(product[column])).join(",")),
  ].join("\n");

  const outputPath = path.resolve(output);
  writeFileSync(outputPath, `${csv}\n`, "utf8");

  const reviewPath = outputPath.replace(/\.csv$/i, "") + ".review.txt";
  const review = [
    `Products written: ${ready.length} of ${products.size} distinct SAP ids.`,
    ``,
    `LEFT OUT — no product name anywhere in the ledger (${unnamed.length}).`,
    `These need a name before they can be imported; the schema requires one.`,
    ...unnamed.map((product) => `  ${product.code}  [${product.category || "?"}]  ${product.movements} movement(s)`),
    ``,
    `IMPORTED BUT AMBIGUOUS — one SAP id, more than one name (${conflicts.length}).`,
    `The most recent name was used. Confirm each of these.`,
    ...conflicts.map((c) => `  ${c.code}  kept "${c.chosen}"  (also seen as ${c.rejected.map((n) => `"${n}"`).join(", ")})`),
    ``,
    `ALWAYS CHECK: opening stock is 0 for every row. Qty in the ledger is the size`,
    `of a movement, not stock on hand, so real balances must be counted and loaded`,
    `separately (scripts/setStock.js).`,
  ].join("\n");

  writeFileSync(reviewPath, `${review}\n`, "utf8");

  console.log(`Read ${records.length} transaction row(s) covering ${products.size} SAP id(s).`);
  console.log(`Wrote ${ready.length} product(s) to ${outputPath}`);
  console.log(`Left out ${unnamed.length} unnamed SAP id(s); ${conflicts.length} name conflict(s) resolved by most-recent.`);
  console.log(`Review notes: ${reviewPath}`);
};

try {
  run();
} catch (error) {
  console.error(`Extraction failed: ${error.message}`);
  process.exitCode = 1;
}
