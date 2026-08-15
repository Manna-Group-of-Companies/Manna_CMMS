/**
 * Copies the stock-take export into data/, folding category spellings that
 * differ only in case or punctuation onto their majority spelling. Prints every
 * substitution it makes. Run once when a new export arrives.
 *
 *   node scripts/_canonicalize.mjs <source.csv> <destination.csv>
 */
import { readFileSync, writeFileSync } from "fs";

const [source, destination] = process.argv.slice(2);
const text = readFileSync(source, "utf8").replace(/^﻿/, "");

const parse = (input, delimiter = ",") => {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (input[i + 1] === '"') { field += '"'; i += 1; }
      else quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += char;
  }
  row.push(field); rows.push(row);
  return rows.filter((cells) => cells.some((c) => c.trim() !== ""));
};

const escape = (value) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

const rows = parse(text);
const header = rows[0].map((h) => h.trim());
const column = (name) => header.indexOf(name);

// Fold on letters and digits only, so "Pipe fittings", "PIPE FITTINGS" and
// "Pipe Fittings" are one key, and the spelling used by the most rows wins.
const key = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const canonical = (index) => {
  const tally = new Map();
  for (const row of rows.slice(1)) {
    const value = (row[index] ?? "").trim();
    if (!value) continue;
    const k = key(value);
    if (!tally.has(k)) tally.set(k, new Map());
    const spellings = tally.get(k);
    spellings.set(value, (spellings.get(value) || 0) + 1);
  }

  const winners = new Map();
  for (const [k, spellings] of tally) {
    const sorted = [...spellings.entries()].sort((a, b) => b[1] - a[1]);
    winners.set(k, sorted[0][0]);
    if (sorted.length > 1) {
      console.log(
        `  ${header[index]}: ${sorted
          .slice(1)
          .map(([s, n]) => `"${s}" (${n} row${n === 1 ? "" : "s"})`)
          .join(", ")} → "${sorted[0][0]}" (${sorted[0][1]} rows)`
      );
    }
  }
  return winners;
};

console.log("Category spellings folded:");
const targets = ["Main Category", "Sub-Category"].map(column).filter((i) => i >= 0);
const winnersByColumn = new Map(targets.map((i) => [i, canonical(i)]));

let changed = 0;
for (const row of rows.slice(1)) {
  for (const index of targets) {
    const value = (row[index] ?? "").trim();
    if (!value) continue;
    const winner = winnersByColumn.get(index).get(key(value));
    if (winner && winner !== value) {
      row[index] = winner;
      changed += 1;
    }
  }
}

writeFileSync(destination, rows.map((row) => row.map(escape).join(",")).join("\n") + "\n", "utf8");
console.log(`\n${changed} cell(s) rewritten. Wrote ${rows.length - 1} product rows to ${destination}`);
