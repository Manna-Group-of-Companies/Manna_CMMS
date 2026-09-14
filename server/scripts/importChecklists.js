import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

import { createDoc, docExists, listDocs, listAll } from "../integrations/erpnext/client.js";
import { erpDisabledReason, erpHasCredentials } from "../integrations/erpnext/config.js";
import { FREQUENCIES } from "../integrations/erpnext/preventiveDoctypes.js";

dotenv.config();

/**
 * Loads the maintenance department's Word checklists into CMMS Checklist.
 *
 *   node scripts/importChecklists.js --dry-run
 *   node scripts/importChecklists.js
 *
 * Run `syncPreventive.js` first — this writes CMMS Checklist records and
 * cannot create the DocType itself.
 *
 * --- Why this reads .docx rather than a transcription -------------------
 *
 * The five files in data/Check-List are the originals the maintenance team
 * wrote and still edit. Transcribing them into JSON here would make this repo
 * the second copy, and the second copy is the one that goes stale — somebody
 * adds a point to the Word file, nobody re-transcribes, and the printed sheet
 * quietly stops matching the system. Reading the documents directly means a
 * re-run picks up whatever they now say.
 *
 * The cost is a small ZIP reader below, because a .docx is a ZIP and this
 * server has six dependencies and no reason to gain a seventh for one script.
 *
 * --- What it does not decide -------------------------------------------
 *
 * Nothing is invented. Points, their order and their check method come across
 * verbatim. `responsibility` is left blank because the documents name no role,
 * and `is_safety` is left unset because the documents mark no point as a
 * safety point — deciding which checks are safety-critical in somebody else's
 * plant is the maintenance manager's call, not this script's.
 *
 * Safe to run again: a checklist that already exists on the same asset with
 * the same title is left alone, never edited.
 */

const DRY = process.argv.includes("--dry-run");
const log = (...p) => console.log(...p);
const step = (t) => log(`\n=== ${t} ===`);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = path.resolve(HERE, "../../data/Check-List");

/* ------------------------------------------------------------------ the zip */

/**
 * Reads one file out of a ZIP archive.
 *
 * Enough of the format to open a .docx and no more: find the end-of-central-
 * directory record, walk the central directory for the wanted name, then
 * inflate its local entry. Deflate (method 8) and stored (method 0) are the
 * only methods Word writes.
 */
const readFromZip = (buffer, wanted) => {
  // The EOCD is at the end, after a comment of unknown length, so it is found
  // by scanning backwards for its signature rather than by arithmetic.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i >= buffer.length - 66_000; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a ZIP file (no end-of-central-directory record)");

  const count = buffer.readUInt16LE(eocd + 10);
  let at = buffer.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error("Damaged central directory");

    const method = buffer.readUInt16LE(at + 10);
    const compressedSize = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const localOffset = buffer.readUInt32LE(at + 42);
    const name = buffer.toString("utf8", at + 46, at + 46 + nameLength);

    if (name === wanted) {
      // The local header repeats the name and extra fields, and its extra
      // field length often differs from the central one — so it is read from
      // the local header rather than reused.
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const data = buffer.subarray(start, start + compressedSize);
      return method === 0 ? data : zlib.inflateRawSync(data);
    }

    at += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`${wanted} is not in the archive`);
};

/* ------------------------------------------------------------------ the xml */

const decode = (text) =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");

/** The visible text of a fragment: every <w:t>, in order. */
const textOf = (xml) => {
  const out = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let m;
  while ((m = re.exec(xml))) out.push(decode(m[1]));
  return out
    .join("")
    // Word writes a real en-dash here; anything that survived a bad round trip
    // is normalised rather than printed as a replacement character.
    .replace(/�/g, "-")
    .replace(/\s+/g, " ")
    .trim();
};

/**
 * The body's top-level paragraphs and tables, in document order.
 *
 * Walked rather than matched with a regex because a table contains paragraphs,
 * and `<w:p` also prefixes `<w:pPr` and `<w:pStyle` — both of which a naive
 * pattern picks up.
 */
const blocksOf = (xml) => {
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml);
  const source = body ? body[1] : xml;

  const blocks = [];
  const opener = /<w:(p|tbl)(?=[\s>/])/g;
  let m;

  while ((m = opener.exec(source))) {
    const tag = m[1];
    const from = m.index;

    // Self-closing, so it holds nothing worth reading.
    const head = /^<w:(?:p|tbl)[^>]*>/.exec(source.slice(from));
    if (head && head[0].endsWith("/>")) {
      opener.lastIndex = from + head[0].length;
      continue;
    }

    // Find the matching close, allowing for the same tag nested inside.
    const nest = new RegExp(`<w:${tag}(?=[\\s>/])|</w:${tag}>`, "g");
    nest.lastIndex = from;
    let depth = 0;
    let to = -1;
    let n;
    while ((n = nest.exec(source))) {
      if (n[0].startsWith("</")) {
        depth -= 1;
        if (depth === 0) {
          to = n.index + n[0].length;
          break;
        }
      } else {
        const selfClosing = /^<w:(?:p|tbl)[^>]*\/>/.test(source.slice(n.index));
        if (!selfClosing) depth += 1;
      }
    }
    if (to < 0) break;

    blocks.push({ kind: tag, xml: source.slice(from, to) });
    opener.lastIndex = to;
  }
  return blocks;
};

/** A table as rows of cell text. */
const rowsOf = (tableXml) => {
  const rows = [];
  const rowRe = /<w:tr(?=[\s>])[\s\S]*?<\/w:tr>/g;
  let r;
  while ((r = rowRe.exec(tableXml))) {
    const cells = [];
    const cellRe = /<w:tc(?=[\s>])([\s\S]*?)<\/w:tc>/g;
    let c;
    while ((c = cellRe.exec(r[0]))) cells.push(textOf(c[1]));
    if (cells.length) rows.push(cells);
  }
  return rows;
};

/* ----------------------------------------------------- reading a frequency */

/**
 * The frequency a heading or a table header names, and what to call the sheet.
 *
 * Order matters: "MORNING SHIFT" has to be tested before the bare shift and
 * daily patterns, or every shift round becomes the same list.
 */
const LABELS = [
  [/morning\s*shift/i, { frequency: "Daily", title: "Morning Shift Round" }],
  [/night\s*shift/i, { frequency: "Daily", title: "Night Shift Round" }],
  [/shift\s*wise|shiftwise/i, { frequency: "Daily", title: "Shift Round" }],
  [/\bdaily\b/i, { frequency: "Daily", title: "Daily Round" }],
  [/\bweekly\b/i, { frequency: "Weekly", title: "Weekly Check" }],
  [/\bmonthly\b/i, { frequency: "Monthly", title: "Monthly Check" }],
  [/\bquarterly\b/i, { frequency: "Quarterly", title: "Quarterly Check" }],
  [/half.?yearly|six\s*month/i, { frequency: "Half-Yearly", title: "Half-Yearly Check" }],
  [/\bannual|\byearly\b/i, { frequency: "Yearly", title: "Annual Check" }],
];

const labelFor = (text) => {
  for (const [pattern, label] of LABELS) if (pattern.test(text)) return label;
  return null;
};

/** What a row's own "Inspection Frequency" cell means, for the electrical sheet. */
const ROW_FREQUENCIES = [
  [/^\s*daily\s*$/i, "Daily"],
  [/1\s*month|monthly/i, "Monthly"],
  [/3\s*month|quarterly/i, "Quarterly"],
  [/6\s*month|half.?yearly/i, "Half-Yearly"],
  [/year|annual|rainy\s*season/i, "Yearly"],
];

const rowFrequency = (text) => {
  for (const [pattern, frequency] of ROW_FREQUENCIES) if (pattern.test(text)) return frequency;
  return null;
};

/* ------------------------------------------------------------- the sources */

/**
 * Which machines each document covers, by the free-text `machine_type` on the
 * register. Stated here rather than guessed from the file name, because the
 * two vocabularies genuinely differ — the register says "Pre-Refiner Mill" and
 * the document says "Refiners".
 */
const SOURCES = [
  {
    file: "PM Checklists for AutoClaves.docx",
    group: "Autoclaves",
    machineTypes: ["Autoclave"],
  },
  {
    file: "PM Checklists for Cracker&Grinder.docx",
    group: "Crackers and Grinders",
    machineTypes: ["Cracker Mill", "Grinder"],
  },
  {
    file: "PM Checklists for Refiners.docx",
    group: "Refiners",
    machineTypes: ["Refiner Mill", "Pre-Refiner Mill"],
  },
  {
    file: "PM Checklists for Forklifts.docx",
    group: "Forklifts",
    machineTypes: ["Forklift"],
  },
  {
    file: "PM Checklists for Electrical Systems.docx",
    group: "Electrical Systems",
    /**
     * Not a machine, and not every plant.
     *
     * The document names this site's own equipment — the refiner and autoclave
     * complex, the cracker and grinder complex, the 11 kV transformer the
     * rubber park team switches off. Copying it onto the other three plants
     * would claim an inspection regime nobody has written for them.
     */
    electricalPlant: "Manna Rubber Products",
  },
];

/* ---------------------------------------------------------------- parsing */

/** Column positions, read from the header row rather than assumed. */
const columnsOf = (header) => {
  const find = (pattern) => header.findIndex((h) => pattern.test(h));
  return {
    point: find(/inspection item|task/i),
    method: find(/check method|^method$/i),
    frequency: find(/frequency/i),
  };
};

/** One document's sheets: a frequency, a title and the points under it. */
const parseDocument = (filePath) => {
  const xml = readFromZip(fs.readFileSync(filePath), "word/document.xml").toString("utf8");
  const blocks = blocksOf(xml);

  const headings = blocks.map((b, i) =>
    b.kind === "p" ? { at: i, label: labelFor(textOf(b.xml)), claimed: false } : null
  );

  /** The nearest heading that names a frequency and no other table has taken. */
  const claimHeading = (at) => {
    for (const step of [-1, 1]) {
      for (let i = at + step; i >= 0 && i < headings.length; i += step) {
        const h = headings[i];
        if (!h) continue; // a table, not a paragraph
        if (!h.label) {
          // A run of unlabelled paragraphs is the date line and such; keep
          // looking, but not past the next table.
          continue;
        }
        if (h.claimed) break;
        h.claimed = true;
        return h.label;
      }
    }
    return null;
  };

  const sheets = [];

  blocks.forEach((block, i) => {
    if (block.kind !== "tbl") return;

    const rows = rowsOf(block.xml);
    if (rows.length < 2) return;

    const columns = columnsOf(rows[0]);
    if (columns.point < 0) return;

    const body = rows.slice(1);

    // The electrical sheet carries a frequency per row rather than per table.
    if (columns.frequency >= 0) {
      const groups = new Map();
      for (const row of body) {
        const point = (row[columns.point] || "").trim();
        if (!point) continue;

        const raw = (row[columns.frequency] || "").trim();
        const frequency = rowFrequency(raw);
        const key = frequency || "__unknown__";
        if (!groups.has(key)) groups.set(key, { frequency, raw: [], points: [] });
        groups.get(key).points.push({
          point,
          howToCheck: (row[columns.method] || "").trim(),
          sourceFrequency: raw,
        });
        if (raw) groups.get(key).raw.push(raw);
      }

      for (const [key, group] of groups) {
        const known = key !== "__unknown__";
        sheets.push({
          /**
           * A row whose frequency the document leaves as "?" still has to
           * reach the sheet. Filed on its own and named for what it is, so it
           * is visible and obviously awaiting a decision — dropping it would
           * lose a check nobody would notice was missing.
           */
          frequency: known ? group.frequency : "Monthly",
          title: known
            ? `${group.frequency} Check`
            : "Frequency To Be Confirmed",
          needsFrequency: !known,
          points: group.points,
        });
      }
      return;
    }

    const label = claimHeading(i) || labelFor(rows[0].join(" "));
    if (!label) return;

    sheets.push({
      frequency: label.frequency,
      title: label.title,
      points: body
        .map((row) => ({
          point: (row[columns.point] || "").trim(),
          howToCheck: (row[columns.method] || "").trim(),
        }))
        .filter((p) => p.point),
    });
  });

  return sheets.filter((s) => s.points.length);
};

/* ---------------------------------------------------------------- writing */

const main = async () => {
  if (!erpHasCredentials()) {
    console.error(`ERPNext credentials are not set (${erpDisabledReason()}).`);
    process.exit(1);
  }
  if (DRY) log("DRY RUN - nothing will be written.\n");

  step("Prerequisites");
  if (!(await docExists("DocType", "CMMS Checklist"))) {
    console.error(
      '\nCMMS Checklist does not exist. Run "npm run erp:sync-preventive" first.'
    );
    process.exit(1);
  }
  log("  = CMMS Checklist - present");

  const machines = await listAll("CMMS Machine", {
    fields: ["name", "machine_name", "machine_type", "plant", "status"],
  });
  const systems = await listAll("CMMS Electrical System", {
    fields: ["name", "system_name", "plant"],
  });
  log(`  = ${machines.length} machines, ${systems.length} electrical systems on the register`);

  let created = 0;
  let skipped = 0;
  const pending = [];

  for (const source of SOURCES) {
    step(source.group);

    const filePath = path.join(SOURCE_DIR, source.file);
    if (!fs.existsSync(filePath)) {
      log(`  ! ${source.file} is not in ${SOURCE_DIR} - skipped`);
      continue;
    }

    const sheets = parseDocument(filePath);
    log(
      `  ${source.file}: ${sheets.length} sheet(s) - ` +
        sheets.map((s) => `${s.title} (${s.points.length})`).join(", ")
    );

    // Who the sheets get attached to.
    const targets = source.electricalPlant
      ? systems
          .filter((sys) => sys.plant === source.electricalPlant)
          .map((sys) => ({ kind: "electrical", id: sys.name, name: sys.system_name }))
      : machines
          .filter((m) => source.machineTypes.includes(m.machine_type))
          .filter((m) => m.status !== "Retired")
          .map((m) => ({ kind: "machine", id: m.name, name: m.machine_name }));

    if (!targets.length) {
      pending.push(source.group);
      log(`  ! nothing on the register matches - ${sheets.length} sheet(s) not loaded`);
      continue;
    }
    log(`  -> ${targets.length} asset(s): ${targets.map((t) => t.id).join(", ")}`);

    for (const target of targets) {
      const existing = await listDocs("CMMS Checklist", {
        fields: ["name", "title"],
        filters: [
          [
            "CMMS Checklist",
            target.kind === "machine" ? "machine" : "electrical_system",
            "=",
            target.id,
          ],
        ],
        limit: 100,
      }).catch(() => []);
      const held = new Set(existing.map((c) => c.title));

      for (const sheet of sheets) {
        if (held.has(sheet.title)) {
          skipped += 1;
          continue;
        }
        if (DRY) {
          log(`     + ${target.id} / ${sheet.title} (${sheet.points.length} points) - would create`);
          created += 1;
          continue;
        }

        const notes = [
          `Imported from "${source.file}".`,
          sheet.needsFrequency
            ? "The source document leaves the frequency as \"?\". Filed as Monthly " +
              "as a placeholder - set the real frequency before this sheet is printed."
            : "",
          sheet.points.some((p) => p.sourceFrequency)
            ? "Source frequencies: " +
              [...new Set(sheet.points.map((p) => p.sourceFrequency).filter(Boolean))].join(", ") +
              "."
            : "",
        ]
          .filter(Boolean)
          .join(" ");

        await createDoc("CMMS Checklist", {
          doctype: "CMMS Checklist",
          title: sheet.title,
          ...(target.kind === "machine"
            ? { machine: target.id }
            : { electrical_system: target.id }),
          plant: source.electricalPlant || machines.find((m) => m.name === target.id)?.plant || "",
          frequency: sheet.frequency,
          is_active: 1,
          revision: "1",
          notes,
          points: sheet.points.map((p) => ({
            doctype: "CMMS Checklist Point",
            point: p.point,
            how_to_check: p.howToCheck,
            acceptance: "",
            is_safety: 0,
          })),
        });
        created += 1;
        log(`     + ${target.id} / ${sheet.title} (${sheet.points.length} points)`);
      }
    }
  }

  step("Done");
  log(`  ${DRY ? "would create" : "created"}: ${created}`);
  log(`  already present, left alone: ${skipped}`);
  if (pending.length) {
    log(
      `\n  Not loaded - nothing on the register to attach them to: ${pending.join(", ")}.` +
        "\n  Add the assets in Asset Management, then run this again."
    );
  }
  log(
    "\n  No point was marked as a safety point and no sheet was given a " +
      "responsibility: the source documents state neither, and both are the " +
      "maintenance manager's to set."
  );
};

main().catch((error) => {
  console.error("\nFailed:", error.message);
  process.exit(1);
});
