import fs from "node:fs";

/**
 * The Manna Rubber Products SAP clean-up plan (user, 10 Oct 2026): SAP keeps the
 * critical engineering items only, under their standard names.
 *
 *   node scripts/planMrpplSapCleanup.js <match-live.json> <sap-items.json> <out.json>
 *
 * <match-live.json> is matchPhysicalStock.js run against SAP's live item list;
 * <sap-items.json> is that list (Sap-Get: Items in group 108, then all ENG codes).
 * Reads files only; the DTW files are built from <out.json> by
 * tools/build_sap_cleanup_dtw.py and imported by the user.
 *
 * The rules, as given:
 *   - Bolts, nuts and washers are not one SAP item per size: every counted bolt goes into one "Bolt"
 *     item, nuts into "Nut", washers into "Washer". The per-size SAP items are not renamed.
 *   - Matched = an Exact or Strong match, or a suspected one scoring 0.9 or more.
 *     One SAP item takes one counted item - the best (band, score, quantity);
 *     the others it would have taken count as unmatched.
 *   - Matched  -> SAP item renamed to the counted item's standard name.
 *   - SAP item unmatched, no stock -> deactivated.
 *   - SAP item unmatched, with stock -> listed for the user to rename by hand
 *     (no DTW).
 *   - Counted item unmatched -> a new SAP item under its standard name, with or without stock; stock
 *     goes in at nil value (a Goods Receipt at price 0).
 *   - Sub-category A / B follow the count (Main Category / Sub-Category), for renamed and new items.
 *   - A bolt, nut or washer already in SAP is not renamed: with no stock it is
 *     deactivated, with stock it goes on the by-hand list.
 *   - An item on an open PO line is never deactivated: it goes on the by-hand list.
 */

// [open-po.json]: Sap-Get output of the open Purchase Orders - an item with an open PO line is never
// deactivated (its goods could not be received).
const [, , MATCH, SAP, OUT, OPEN_PO] = process.argv;
if (!MATCH || !SAP || !OUT) {
  console.error("usage: node scripts/planMrpplSapCleanup.js <match-live.json> <sap-items.json> <out.json>");
  process.exit(1);
}

const { rows } = JSON.parse(fs.readFileSync(MATCH, "utf8"));
const raw = JSON.parse(fs.readFileSync(SAP, "utf8").replace(/^﻿/, ""));
const sapItems = raw[0].rows;
const engCodes = raw[1].rows.map((r) => String(r.ItemCode));
/** What was decided beyond the inspected lists, for the report back. */
const notes = [];

// No word boundary before WASHER: the count writes "PlateWasher" / "SpringWasher" (and "PlateWahser").
const FASTENER = /(\bBOLTS?\b|\bNUTS?\b|WASHERS?\b|WAHSERS?\b)/i;
/**
 * Bolts, nuts and washers are kept as three SAP items, not one per size (user, 10 Oct 2026). The first
 * of the three words a name carries decides which: "2*1/2 Bolt and Nut" is a bolt. Other fasteners
 * (screws, rivets, studs) stay items of their own.
 */
const fastenerClass = (name) => {
  const m = String(name || "").match(/(\bBOLT|\bNUT|WASHER|WAHSER)S?\b/i);
  if (!m) return "";
  const w = m[1].toUpperCase();
  return w === "BOLT" ? "Bolt" : w === "NUT" ? "Nut" : "Washer";
};
const isFastenerRow = (r) => Boolean(fastenerClass(r.physicalName));
const isFastenerName = (name) => FASTENER.test(name || "");
/**
 * One spelling per category, as the CMMS shows them: the count writes "Pipe Fittings" and "Pipe fittings",
 * "Bearings" and "BEARINGS". SAP gets the spelling most counted rows use (compared lower-case, trimmed).
 */
const spellings = (pick) => {
  const tally = new Map();
  for (const r of rows) {
    const v = String(pick(r) || "").trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (!tally.has(k)) tally.set(k, new Map());
    tally.get(k).set(v, (tally.get(k).get(v) || 0) + 1);
  }
  const best = new Map();
  for (const [k, votes] of tally) best.set(k, [...votes].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0]);
  return (v) => { const t = String(v || "").trim(); return best.get(t.toLowerCase()) || t; };
};
const spellA = spellings((r) => r.category);
const spellB = spellings((r) => r.subCategory);
/** Sub-category A / B as the count files the item: Main Category / Sub-Category (B empty when it repeats A). */
const siblingsCategory = (r) => {
  const word = (String(r.physicalName || "").match(/\b(belt|bearing|pulley|valve|seal|gasket|switch|contactor|relay|fuse|mcb)\b/i) || [])[1];
  if (!word) return null;
  const re = new RegExp("\\b" + word + "\\b", "i");
  const tally = new Map();
  for (const x of rows) {
    if (!x.category || !re.test(x.physicalName || "")) continue;
    const k = `${x.category}\u0001${x.subCategory || ""}`;
    tally.set(k, (tally.get(k) || 0) + 1);
  }
  const best = [...tally].sort((x, y) => y[1] - x[1])[0];
  return best ? best[0].split("\u0001") : null;
};
const subsOf = (r) => {
  let cat = r.category, sub = r.subCategory;
  if (!String(cat || "").trim()) {
    const sib = siblingsCategory(r);
    if (sib) { [cat, sub] = sib; notes.push(`${r.oldId} ${r.physicalName}: no category in the count - filed like its siblings, ${cat} / ${sub || "-"}`); }
  }
  const a = spellA(cat);
  const b = spellB(sub);
  return { subA: a.slice(0, 50), subB: b && b.toLowerCase() !== a.toLowerCase() ? b.slice(0, 50) : "" };
};

const BAND_RANK = { Exact: 0, Strong: 1, Likely: 2, Possible: 3 };
/**
 * SAP items the 0.9 rule would rename but where the match is a guess (10 Oct 2026 review): not renamed, so
 * they follow rule 2 / 3 like any unmatched item, and every counted row involved becomes a new item.
 */
const NO_RENAME = {
  "ENG-245": "three counted 4\" B2 pulleys (28, 32, 38MM bore) scored the same against 'Pully 04*2B', which names no bore",
};
const matchedBand = (r) => r.match && !NO_RENAME[r.match.sapCode] && (r.band === "Exact" || r.band === "Strong" || (["Likely", "Possible"].includes(r.band) && r.score >= 0.9));

// One SAP item, one counted item.
const claims = new Map();
for (const r of rows.filter(matchedBand)) {
  const k = r.match.sapCode;
  claims.set(k, [...(claims.get(k) || []), r]);
}
const winner = new Map();
const bumped = new Map();
for (const [code, list] of claims) {
  list.sort((a, b) => BAND_RANK[a.band] - BAND_RANK[b.band] || b.score - a.score || (Number(b.physicalQty) || 0) - (Number(a.physicalQty) || 0));
  winner.set(code, list[0]);
  for (const r of list.slice(1)) bumped.set(r.oldId, list[0].oldId);
}
const matchedIds = new Set([...winner.values()].map((r) => r.oldId));

const sapByCode = new Map(sapItems.map((s) => [String(s.ItemCode).trim(), s]));
const onOpenPo = new Map();
if (OPEN_PO) {
  const po = JSON.parse(fs.readFileSync(OPEN_PO, "utf8").replace(/^﻿/, ""));
  for (const d of po[0].rows || []) for (const l of d.DocumentLines || []) {
    if (l.LineStatus !== "bost_Open" || !(Number(l.RemainingOpenQuantity) > 0)) continue;
    const k = String(l.ItemCode).trim();
    onOpenPo.set(k, [...(onOpenPo.get(k) || []), `PO ${d.DocNum} (${l.RemainingOpenQuantity} open)`]);
  }
}
const active = (s) => s.Valid === "tYES" && s.Frozen !== "tYES";
/** SAP items the user said to keep whatever the match or stock says (10 Oct 2026). */
const KEEP = { "ENG - 399": "user, 10 Oct 2026: keep after its open PO 1033 was cancelled" };

// ---- 1. renames
const renames = [];
const fastenersMatched = [];
for (const [code, r] of winner) {
  const s = sapByCode.get(code);
  if (!s) continue;
  const entry = {
    sapCode: code,
    currentName: String(s.ItemName ?? ""),
    newName: r.standardName,
    physicalId: r.oldId,
    physicalName: r.physicalName,
    band: r.band,
    score: r.score,
    caution: r.caution || "",
    compliant: r.compliant,
    sapQty: Number(s.QuantityOnStock || 0),
    physicalQty: r.physicalQty,
    bumped: [...bumped].filter(([, w]) => w === r.oldId).map(([id]) => id).join(", "),
    ...subsOf(r),
    currentSubA: String(s.U_SubTypeA ?? "").trim(),
    currentSubB: String(s.U_SubTypeB ?? "").trim(),
    // Counting details the user wants on every counted item (10 Oct 2026): the counted minimum stock.
    // The unit is reported, never changed - SAP refuses a new inventory unit on an item with transactions.
    minStock: Number(r.minStock ?? 0) || 0,
    currentMin: Number(s.MinInventory || 0),
    countedUom: String(r.uom || ""),
    currentUom: String(s.InventoryUOM || ""),
  };
  if (isFastenerRow(r) || isFastenerName(s.ItemName)) fastenersMatched.push(entry);
  else renames.push({ ...entry, unchanged: entry.currentName === entry.newName, tooLong: entry.newName.length > 100 });
}

// ---- 2/4. SAP items with no match
const bestFor = new Map();
for (const r of rows) {
  if (!r.match || matchedIds.has(r.oldId)) continue;
  const k = r.match.sapCode;
  bestFor.set(k, [...(bestFor.get(k) || []), r]);
}
const deactivate = [];
const manual = [];
const alreadyInactive = [];
for (const s of sapItems) {
  const code = String(s.ItemCode).trim();
  if (winner.has(code)) continue;
  const qty = Number(s.QuantityOnStock || 0);
  const base = { sapCode: code, name: String(s.ItemName ?? ""), sapQty: qty, uom: s.InventoryUOM || "", subA: s.U_SubTypeA || "", subB: s.U_SubTypeB || "", fastener: isFastenerName(s.ItemName), openPo: (onOpenPo.get(code) || []).join(", "), reason: "no match in the count" };
  if (!active(s)) { alreadyInactive.push(base); continue; }
  if (KEEP[code]) { manual.push({ ...base, reason: KEEP[code], nearest: (bestFor.get(code) || []).sort((x, y) => y.score - x.score).slice(0, 3).map((r) => `${r.oldId} ${r.standardName} (${r.score})`).join("; ") }); continue; }
  if (qty > 0 || base.openPo) {
    const near = (bestFor.get(code) || []).sort((a, b) => b.score - a.score).slice(0, 3);
    manual.push({ ...base, nearest: near.map((r) => `${r.oldId} ${r.standardName} (${r.score})`).join("; ") });
  } else deactivate.push(base);
}

// Matched bolts, nuts and washers: not renamed - deactivated when SAP holds none, else by hand.
for (const f of fastenersMatched) {
  const s = sapByCode.get(f.sapCode);
  const base = { sapCode: f.sapCode, name: f.currentName, sapQty: f.sapQty, uom: s?.InventoryUOM || "", subA: s?.U_SubTypeA || "", subB: s?.U_SubTypeB || "", fastener: true, openPo: (onOpenPo.get(f.sapCode) || []).join(", "), reason: `bolt / nut / washer - matched ${f.physicalId} ${f.physicalName}` };
  if (s && !active(s)) alreadyInactive.push(base);
  else if (f.sapQty > 0 || base.openPo) manual.push({ ...base, nearest: `${f.physicalId} ${f.newName} (${f.score})` });
  else deactivate.push(base);
}

// ---- 3. new items from the count
const UOM = { UNITS: "NOS", UNIT: "NOS", NOS: "NOS", PCS: "NOS", KG: "KGS", KGS: "KGS", METERS: "MTR", METER: "MTR", MTR: "MTR", LITRE: "LTR", LTR: "LTR", PAIR: "PAIR", SET: "SET", ROLL: "ROLL", BOX: "BOX", PACKETS: "PKT", PACKET: "PKT", PKT: "PKT", CMS: "CM", CM: "CM" };
const maxEng = engCodes.reduce((m, c) => {
  const x = String(c).replace(/\s+/g, " ").trim().match(/^ENG[\s-]*(\d+)$/i);
  return x ? Math.max(m, Number(x[1])) : m;
}, 0);
let next = maxEng + 1;
const newByName = new Map();
const skippedNoStock = [];
const fastenersNotCreated = [];
// Every counted bolt, nut and washer - matched or not - goes into its one SAP item.
const combined = new Map();
// Counted rows whose matched SAP item is a per-size fastener that still holds stock: that item stays (rule 3),
// so its pieces are already in SAP and are not received again into the combined item.
const alreadyInSap = new Map(fastenersMatched.filter((f) => f.sapQty > 0).map((f) => [f.physicalId, f]));
for (const r of rows) {
  const cls = fastenerClass(r.physicalName);
  if (!cls) continue;
  const held = alreadyInSap.get(r.oldId);
  fastenersNotCreated.push({ ...r, combinedInto: held ? `(stays in SAP as ${held.sapCode})` : cls });
  const c = combined.get(cls) || { qty: 0, minStock: 0, ids: [], excluded: [], locations: new Set(), lines: 0 };
  if (held) {
    c.excluded.push(`${r.oldId} ${r.physicalName} (${r.physicalQty}) - in SAP as ${held.sapCode} "${held.currentName}", ${held.sapQty} on hand, left as it is`);
    notes.push(`${cls}: ${r.oldId} ${r.physicalName} (${r.physicalQty}) not received into ${cls} - already in SAP as ${held.sapCode} with ${held.sapQty} on hand`);
    combined.set(cls, c);
    continue;
  }
  c.qty += Number(r.physicalQty) || 0;
  c.minStock += Number(r.minStock) || 0;
  c.ids.push(r.oldId);
  c.locations.add(r.location);
  c.lines += 1;
  combined.set(cls, c);
}
for (const [cls, c] of combined) {
  newByName.set(`__${cls}`, {
    itemCode: "",
    name: cls,
    physicalName: `All counted ${cls.toLowerCase()}s, every size (${c.lines} counted lines)`,
    physicalIds: c.ids,
    compliant: false,
    issues: "One item for every size, as decided - no size in the name on purpose.",
    subA: "Fasteners",
    subB: `${cls}s`,
    uom: "NOS",
    uomNote: "",
    // The counted minimums of every size, added up - the one figure the count gives for the combined item.
    minStock: c.minStock,
    physicalQty: c.qty,
    unitCost: null,
    brand: "",
    locations: c.locations,
    bumpedFrom: "",
    closest: "",
    combined: true,
    excluded: c.excluded.join("; "),
  });
}
for (const r of rows) {
  if (matchedIds.has(r.oldId) || isFastenerRow(r)) continue;
  // Counted with no quantity: still a new item, created with no stock (user, 10 Oct 2026).
  const qty = Number(r.physicalQty) || 0;
  const key = r.standardName.toUpperCase();
  const prev = newByName.get(key);
  if (prev) {
    prev.physicalQty += qty; prev.physicalIds.push(r.oldId); prev.locations.add(r.location);
    // The same item counted twice may be filed differently (17MM Allenkey: Tools / Tools and Tools / Allenkeys):
    // a row that names a sub-category B wins over one that leaves it blank (post-run review, 10 Oct 2026).
    const s = subsOf(r);
    if (!prev.subB && s.subB && s.subA === prev.subA) prev.subB = s.subB;
    continue;
  }
  const unitKey = String(r.uom || "").trim().toUpperCase();
  const uom = UOM[unitKey] || "NOS";
  const uomNote = UOM[unitKey] ? "" : `counted in "${r.uom || "no unit"}"; SAP has no such unit - NOS used, change if needed`;
  newByName.set(key, {
    itemCode: "",
    name: r.standardName,
    physicalName: r.physicalName,
    physicalIds: [r.oldId],
    compliant: r.compliant,
    issues: r.issues,
    ...subsOf(r),
    uom,
    uomNote,
    minStock: Number(r.minStock ?? 0) || 0,
    physicalQty: qty,
    unitCost: r.unitCost,
    brand: r.brand,
    locations: new Set([r.location]),
    bumpedFrom: bumped.get(r.oldId) ? `${r.match.sapCode} went to ${bumped.get(r.oldId)}` : "",
    closest: r.match ? `${r.match.sapCode} ${r.match.name} (${r.score}${r.caution ? ", " + r.caution : ""})` : "",
  });
}
const newItems = [...newByName.values()]
  // The three combined fastener items first, then the rest by name.
  .sort((a, b) => Number(Boolean(b.combined)) - Number(Boolean(a.combined)) || a.name.localeCompare(b.name))
  .map((n) => ({ ...n, itemCode: `ENG-${next++}`, locations: [...n.locations].filter(Boolean).join(", "), physicalIds: n.physicalIds.join(", "), tooLong: n.name.length > 100 }));

notes.push(...Object.entries(NO_RENAME).map(([code, why]) => `${code}: not renamed - ${why}`));
const plan = { generatedAt: new Date().toISOString(), maxEng, notes, keep: Object.entries(KEEP).map(([sapCode, reason]) => ({ sapCode, reason })), renames, fastenersMatched, deactivate, manual, alreadyInactive, newItems, skippedNoStock: skippedNoStock.map((r) => ({ id: r.oldId, name: r.physicalName, standardName: r.standardName, category: r.category })), fastenersNotCreated: fastenersNotCreated.map((r) => ({ id: r.oldId, name: r.physicalName, standardName: r.standardName, category: r.category, qty: r.physicalQty, matched: matchedIds.has(r.oldId), combinedInto: r.combinedInto })) };
fs.writeFileSync(OUT, JSON.stringify(plan, null, 1));
console.log(`SAP items ${sapItems.length} | renames ${renames.length} (${renames.filter((r) => r.unchanged).length} already so named) | matched fasteners left alone ${fastenersMatched.length} | deactivate ${deactivate.length} | rename by hand ${manual.length} | already inactive ${alreadyInactive.length}`);
console.log(`counted items: new SAP items ${newItems.length} (ENG-${maxEng + 1}..ENG-${next - 1}; ${newItems.filter((n) => !(n.physicalQty > 0)).length} with no stock) | bolt/nut/washer lines combined into ${combined.size} items: ${[...combined].map(([k, c]) => k + ' ' + c.lines + ' lines, qty ' + c.qty).join('; ')} | bumped from a shared match ${bumped.size}`);
