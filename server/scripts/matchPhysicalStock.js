import fs from "node:fs";

import dotenv from "dotenv";

import { catalogProducts } from "../repository/catalog.js";
import { validateItemName } from "../utils/itemNaming.js";
import { standardize } from "../utils/nameRepair.js";

dotenv.config();

/**
 * Matches the physical stock inspection of the Manna Rubber Products store to
 * the engineering items SAP holds for that company, and writes each physical
 * name in the SOI1/SOP1 standard format.
 *
 *   node scripts/matchPhysicalStock.js <physical.json> <out.json>
 *
 * <physical.json> is the inspection workbook's rows (SAPID, Product Name,
 * categories, brand, location, Stock Available, UOM, Unit Cost) as JSON. Reads
 * ERPNext; writes nothing to it. The output is a proposal for the Maintenance
 * Manager to confirm row by row - the workbook built from it carries a
 * Decision column - never something applied blind.
 *
 * --- How a match is scored ------------------------------------------------
 *
 * Neither side follows the convention: the inspection says "M16 Anchor Bolt",
 * SAP says "ANCHER BOLT 10 MM" and "TVS HEX BOLT M 20 X 75". So both names are
 * reduced to the same two things before they are compared:
 *
 *   sizes  - every number, with fractions as decimals ("1 1/2" = 1.5) and M-
 *            thread sizes as numbers (M20 = 20). A size that differs is a
 *            different item, so sizes weigh heavily and a "Strong" match needs
 *            them to agree exactly.
 *   words  - the remaining words, uppercased, singular, with the store's
 *            recurring misspellings mapped (ANCHER, VALUE for valve, COLLER...)
 *            and units and filler words dropped; a one-letter typo in a long
 *            word still counts.
 */

// An optional third file: SAP's own item list (Sap-Get output of Items in group 108) to match against
// instead of the CMMS copy - it carries today's on-hand quantity and items made in SAP since the import.
const [, , IN, OUT, SAP_ITEMS] = process.argv;
if (!IN || !OUT) {
  console.error("usage: node scripts/matchPhysicalStock.js <physical.json> <out.json>");
  process.exit(1);
}

/** The store's and SAP's recurring spellings, mapped to one word. */
const SYNONYMS = {
  ANCHER: "ANCHOR", VALUE: "VALVE", COLLER: "COLLAR", COLLOR: "COLLAR", TUFFLON: "TEFLON", TEFLONE: "TEFLON",
  SPANER: "SPANNER", BIOCK: "BLOCK", AUXILARY: "AUXILIARY", GOOGLES: "GOGGLES", GOGGLE: "GOGGLES",
  COPPER: "CU", ALUMINIUM: "AL", ALUMINUM: "AL", STAINLESS: "SS", JACKEY: "JACK", SCREWDRIVER: "SCREW DRIVER",
  BEARINGS: "BEARING", NIPPEL: "NIPPLE", CONECTOR: "CONNECTOR", CONNECTER: "CONNECTOR", SOCKETT: "SOCKET",
  REDUCER: "REDUCER", REDUSER: "REDUCER", ELBOW: "ELBOW", BEND: "BEND", WASHERS: "WASHER", SWICH: "SWITCH",
  CONTACTER: "CONTACTOR", MCB: "MCB", TERMINALS: "TERMINAL", TAP: "TAPE",
};
const STOP = new Set(["AND", "FOR", "WITH", "OF", "THE", "TO", "IN", "ON", "SET", "NO", "NOS", "PCS", "TYPE", "SIZE"]);
const UNITS = new Set(["MM", "CM", "MTR", "M", "SQMM", "SQ", "INCH", "INCHES", "IN", "FT", "V", "A", "W", "KW", "HP", "KVA", "HZ", "BAR", "PSI", "KG", "GM", "G", "ML", "LTR", "L", "RPM", "AMP", "VOLT", "X"]);

const toNumber = (s) => {
  const m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  const f = s.match(/^(\d+)\/(\d+)$/);
  if (f) return Number(f[1]) / Number(f[2]);
  return Number(s);
};

const FRACTION_CHARS = { "¼": " 1/4", "½": " 1/2", "¾": " 3/4" };

/** { sizes: [numbers], words: Set } for one name. */
const keyOf = (raw) => {
  let s = String(raw ?? "").toUpperCase();
  s = s.replace(/[¼½¾]/g, (c) => FRACTION_CHARS[c]);
  s = s.replace(/[“”″]|''/g, '"');
  s = s.replace(/SQ\s*\.?\s*MM/g, " SQMM ");
  s = s.replace(/\bS\s+S\b/g, "SS");
  s = s.replace(/\bM\s+S\b/g, "MS");
  s = s.replace(/\bCU\./g, "CU ");
  // M-thread sizes are sizes: M20, M 20.
  s = s.replace(/\bM\s?(\d{1,2})\b/g, " $1 ");

  const sizes = [];
  // Mixed fractions first ("1 1/2"), then fractions, then plain numbers.
  s = s.replace(/(\d+)\s+(\d+\/\d+)/g, (m) => { sizes.push(toNumber(m)); return " "; });
  s = s.replace(/(\d+\/\d+)/g, (m) => { sizes.push(toNumber(m)); return " "; });
  s = s.replace(/\d+(\.\d+)?/g, (m) => { sizes.push(Number(m)); return " "; });

  const words = new Set();
  for (let w of s.split(/[^A-Z]+/)) {
    if (!w || w.length < 2 || STOP.has(w) || UNITS.has(w)) continue;
    w = SYNONYMS[w] || w;
    if (w.length > 3 && w.endsWith("S") && !w.endsWith("SS")) w = w.slice(0, -1);
    for (const part of w.split(" ")) words.add(part);
  }
  return { sizes: sizes.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b), words };
};

const levenshtein = (a, b) => {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1)
    for (let j = 1; j <= b.length; j += 1)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
};

const wordDice = (A, B) => {
  if (!A.size || !B.size) return 0;
  let hit = 0;
  const used = new Set();
  for (const a of A) {
    let found = null;
    if (B.has(a)) found = a;
    else if (a.length >= 5) for (const b of B) if (!used.has(b) && b.length >= 5 && levenshtein(a, b) <= 1) { found = b; break; }
    if (found && !used.has(found)) { used.add(found); hit += 1; }
  }
  return (2 * hit) / (A.size + B.size);
};

const sizeScore = (a, b) => {
  if (!a.length && !b.length) return { score: 0.7, same: true, both: false, hit: 0 };
  if (!a.length || !b.length) return { score: 0.3, same: false, both: false, hit: 0 };
  const rest = [...b];
  let hit = 0;
  for (const x of a) {
    const i = rest.findIndex((y) => Math.abs(x - y) < 1e-6);
    if (i !== -1) { hit += 1; rest.splice(i, 1); }
  }
  return { score: (2 * hit) / (a.length + b.length), same: hit === a.length && hit === b.length, both: true, hit };
};

/** Materials of construction: two names naming different ones are different items. */
const MATERIAL_WORDS = new Set(["MS", "SS", "CS", "GI", "CI", "PVC", "CPVC", "UPVC", "CU", "AL", "BRASS", "BRONZE", "NYLON", "TEFLON", "PTFE", "PP", "HDPE", "RUBBER"]);
const materialsOf = (words) => new Set([...words].filter((w) => MATERIAL_WORDS.has(w)));
const materialClash = (a, b) => {
  const x = materialsOf(a);
  const y = materialsOf(b);
  return x.size > 0 && y.size > 0 && ![...x].some((m) => y.has(m));
};

/**
 * In engineering spares a different size or material is a different item, so
 * those cap the band however alike the words are: sizes that disagree outright
 * are no match, a partial size or a material clash is at most Possible.
 */
const band = (best, exact) => {
  if (!best) return "No match";
  if (exact) return "Exact";
  if (best.sizesBoth && best.sizeHit === 0) return "No match";
  const capped = best.materialClash || (best.sizesBoth && !best.sizesSame) || best.sizeOneSide;
  if (!capped && best.sizesSame && best.words >= 0.6 && best.score >= 0.75) return "Strong";
  if (!capped && best.words >= 0.6 && best.score >= 0.6) return "Likely";
  if (best.score >= 0.45) return "Possible";
  return "No match";
};

const why = (best) =>
  !best ? "" : [
    best.sizesBoth && !best.sizesSame ? "sizes differ" : "",
    best.materialClash ? "materials differ" : "",
    best.sizeOneSide ? "size on one side only" : "",
  ].filter(Boolean).join(", ");

const main = async () => {
  const physical = JSON.parse(fs.readFileSync(IN, "utf8"));
  const items = SAP_ITEMS
    ? (() => {
        const raw = JSON.parse(fs.readFileSync(SAP_ITEMS, "utf8").replace(/^﻿/, ""));
        const rowsOf = Array.isArray(raw) ? raw[0].rows : raw.rows || raw;
        return rowsOf.map((r) => ({
          code: `MRPPL-${String(r.ItemCode).trim()}`,
          name: String(r.ItemName ?? "").trim(),
          sap: { code: String(r.ItemCode).trim() },
          quantity: Number(r.QuantityOnStock || 0),
          unit: r.InventoryUOM || "",
          category: "Engineering Stocks",
          subCategory: String(r.U_SubTypeA ?? "").trim(),
          active: r.Valid === "tYES" && r.Frozen !== "tYES",
        }));
      })()
    : (await catalogProducts()).filter((p) => p.sapCategory?.company === "MRPPL");
  console.log(`${physical.length} physical rows, ${items.length} Manna Rubber Products items from SAP.`);

  const itemKeys = items.map((p) => ({ p, k: keyOf(p.name), std: standardize(p.name).name }));

  const rows = physical.map((r) => {
    const name = String(r["Product Name"] ?? "").trim();
    const std = standardize(name);
    const k = keyOf(name);
    const scored = itemKeys
      .map(({ p, k: ik, std: istd }) => {
        const words = wordDice(k.words, ik.words);
        const sz = sizeScore(k.sizes, ik.sizes);
        const clash = materialClash(k.words, ik.words);
        const oneSide = !sz.both && k.sizes.length > 0 !== ik.sizes.length > 0;
        return { p, istd, words, sizesSame: sz.same, sizesBoth: sz.both, sizeHit: sz.hit, sizeOneSide: oneSide, materialClash: clash, score: 0.55 * words + 0.45 * sz.score - (clash ? 0.15 : 0) };
      })
      .filter((c) => c.words > 0)
      .sort((a, b) => b.score - a.score);
    const best = scored[0] || null;
    const exact = best && best.istd.toUpperCase() === std.name.toUpperCase();
    return {
      oldId: r.SAPID,
      physicalName: name,
      standardName: std.name,
      compliant: std.compliant,
      issues: std.issues.map((i) => i.message).join(" "),
      category: r["Main Category"] || "",
      subCategory: r["Sub-Category"] || "",
      condition: r.Status || "",
      brand: r.Brand || "",
      location: r.Location || "",
      physicalQty: r["Stock Available"] ?? null,
      minStock: r["Min Stock"] ?? null,
      uom: r.UOM || "",
      unitCost: r["Unit Cost"] ?? null,
      band: band(best, exact),
      score: best ? Math.round(best.score * 100) / 100 : 0,
      caution: why(best),
      match: best ? { code: best.p.code, sapCode: best.p.sap?.code || "", name: best.p.name, standardName: best.istd, qty: best.p.quantity, unit: best.p.unit, group: best.p.category, subA: best.p.subCategory } : null,
      others: scored.slice(1, 3).map((c) => `${c.p.sap?.code || c.p.code} ${c.p.name} (${Math.round(c.score * 100) / 100})`),
    };
  });

  // One SAP item claimed by several physical rows: say so on each.
  const claims = new Map();
  for (const r of rows) if (r.match && ["Exact", "Strong", "Likely"].includes(r.band)) claims.set(r.match.code, [...(claims.get(r.match.code) || []), r.oldId]);
  for (const r of rows) {
    const c = r.match && claims.get(r.match.code);
    r.sharedWith = c && c.length > 1 ? c.filter((id) => id !== r.oldId).join(", ") : "";
  }

  const matched = new Set(rows.filter((r) => r.match && ["Exact", "Strong", "Likely"].includes(r.band)).map((r) => r.match.code));
  const unmatchedSap = items
    .filter((p) => !matched.has(p.code))
    .map((p) => ({ code: p.code, sapCode: p.sap?.code || "", name: p.name, standardName: standardize(p.name).name, qty: p.quantity, unit: p.unit, group: p.category, subA: p.subCategory }));

  fs.writeFileSync(OUT, JSON.stringify({ rows, unmatchedSap }, null, 1));
  const count = (b) => rows.filter((r) => r.band === b).length;
  console.log(["Exact", "Strong", "Likely", "Possible", "No match"].map((b) => `${b}: ${count(b)}`).join(" | "));
  console.log(`standard names compliant: ${rows.filter((r) => r.compliant).length}/${rows.length}; SAP items with no physical match: ${unmatchedSap.length}`);
  process.exit(0);
};

main().catch((error) => {
  console.error("\nFailed:", error.message);
  process.exit(1);
});

