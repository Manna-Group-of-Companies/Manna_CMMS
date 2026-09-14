/**
 * Writing CSV that ERPNext's Data Import will actually accept.
 *
 * Pure, so the escaping can be tested rather than trusted. Escaping is the
 * whole job here: the catalog is full of values that break naive CSV — item
 * names carrying commas, descriptions with line breaks, and codes with
 * embedded quotes. One unescaped comma shifts every column after it, and
 * ERPNext will import that silently.
 */

/**
 * Quotes one value per RFC 4180.
 *
 * Quoted whenever it contains a comma, a quote or a newline; inner quotes are
 * doubled. Values are quoted rather than stripped because a comma inside a
 * product name is part of the name, and removing it would change what the
 * store calls the thing.
 */
export const escapeCell = (value) => {
  if (value === null || value === undefined) return "";

  // Booleans go out as ERPNext's 1/0 rather than true/false, which its
  // importer reads as text and stores as 0.
  if (typeof value === "boolean") return value ? "1" : "0";

  const text = String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
};

/** One row. */
export const toRow = (columns, record) =>
  columns.map((column) => escapeCell(record[column])).join(",");

/**
 * A whole sheet, header first.
 *
 * Prefixed with a UTF-8 BOM. Excel assumes the system codepage for a CSV
 * without one, so a supplier named "Süd" or any Malayalam text in a
 * description arrives mangled — and the person opening it has no way to tell
 * that the file was fine and Excel was wrong.
 */
export const toCsv = (columns, records) => {
  const lines = [columns.join(","), ...records.map((record) => toRow(columns, record))];
  return `﻿${lines.join("\r\n")}\r\n`;
};

/**
 * Reads a CSV back into records, keyed by the header row.
 *
 * The counterpart to `toCsv`, and it has to be a real parser rather than a
 * `split(",")`: the files this reads are the ones written above, so they carry
 * quoted commas and embedded newlines by design. Splitting on commas would
 * shift every column after the first quoted value - the exact silent
 * corruption `escapeCell` exists to prevent.
 */
export const parseCsv = (text) => {
  // The BOM `toCsv` writes for Excel's sake would otherwise become part of the
  // first column's name.
  const body = text.replace(/^﻿/, "");

  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < body.length; i++) {
    const c = body[i];

    if (quoted) {
      if (c !== '"') cell += c;
      else if (body[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
      continue;
    }

    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && body[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  // A file not ending in a newline still has a last row to give up.
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const header = rows.shift();
  if (!header) return [];

  return rows
    // A trailing blank line is one empty cell, not a record.
    .filter((r) => r.some((v) => v !== ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
};
