// Checks the Manna Rubber Products clean-up (apply-mrppl-cleanup.js) against a fresh, independent read of SAP.
//
//   node verify-mrppl-cleanup.js <plan.json> <before.json> <after.json> <gr.json> [result.json]
//
// <before.json>  Sap-Get output read BEFORE the run: [0].rows = every group-108 item (the plan was built from it)
// <after.json>   the same two queries read AFTER the run, plus [1].rows = every ENG* code
// <gr.json>      Sap-Get output: [0].rows = InventoryGenEntries whose Reference2 starts with "PSC" (with lines)
// <result.json>  what the executor says it did (optional; its skips are allowed for, nothing else is taken on trust)
//
// Reads files only - never SAP. Prints a report and writes <after>.verify.json next to the after file.
const fs = require('fs');

const [, , PLAN, BEFORE, AFTER, GR, RESULT] = process.argv;
if (!PLAN || !BEFORE || !AFTER || !GR) { console.error('usage: node verify-mrppl-cleanup.js <plan.json> <before.json> <after.json> <gr.json> [result.json]'); process.exit(2); }
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const plan = read(PLAN);
const before = new Map(read(BEFORE)[0].rows.map((r) => [norm(r.ItemCode), r]));
const afterRaw = read(AFTER);
const after = new Map(afterRaw[0].rows.map((r) => [norm(r.ItemCode), r]));
const grDocs = read(GR)[0].rows || [];
const result = RESULT ? read(RESULT) : null;

const bad = [];
const ok = [];
const note = (list, msg) => list.push(msg);
const same = (a, b) => norm(a) === norm(b);
const num = (v) => Number(v || 0);
// Every group-108 item manages stock by warehouse: the minimum is the warehouse-01 row's (mirrored at item level).
const minOf = (it) => {
  const row = Array.isArray(it.ItemWarehouseInfoCollection) ? it.ItemWarehouseInfoCollection.find((w) => norm(w.WarehouseCode) === '01') : null;
  return it.ManageStockByWarehouse === 'tYES' && row ? num(row.MinimalStock) : num(it.MinInventory);
};

// ---- 1. renames
let renamed = 0;
for (const r of plan.renames) {
  const it = after.get(norm(r.sapCode));
  if (!it) { note(bad, `rename ${r.sapCode}: not in SAP group 108 after the run`); continue; }
  const wrong = [];
  if (!same(it.ItemName, r.newName)) wrong.push(`ItemName "${it.ItemName}"`);
  if (!same(it.U_SubTypeA, r.subA || '')) wrong.push(`U_SubTypeA "${it.U_SubTypeA}"`);
  if (!same(it.U_SubTypeB, r.subB || '')) wrong.push(`U_SubTypeB "${it.U_SubTypeB}"`);
  if (minOf(it) !== num(r.minStock)) wrong.push(`minimum ${minOf(it)}`);
  if (it.Valid !== 'tYES' || it.Frozen === 'tYES') wrong.push('inactive');
  const b = before.get(norm(r.sapCode));
  if (b && num(it.QuantityOnStock) !== num(b.QuantityOnStock)) wrong.push(`stock changed ${b.QuantityOnStock} -> ${it.QuantityOnStock}`);
  if (wrong.length) note(bad, `rename ${r.sapCode}: ${wrong.join(', ')} (wanted "${r.newName}" / ${r.subA} / ${r.subB} / min ${r.minStock})`);
  else renamed += 1;
}
note(ok, `renames: ${renamed} of ${plan.renames.length} exactly as planned`);

// ---- 2. deactivations
let deactivated = 0;
const skippedDeact = new Map((result?.deactivate || []).filter((e) => e.action === 'skipped').map((e) => [norm(e.code), e.note]));
for (const d of plan.deactivate) {
  const code = norm(d.sapCode);
  const it = after.get(code);
  if (!it) { note(bad, `deactivate ${code}: not in SAP group 108 after the run`); continue; }
  if (skippedDeact.has(code)) {
    if (it.Valid === 'tNO' || it.Frozen === 'tYES') note(bad, `deactivate ${code}: executor says skipped (${skippedDeact.get(code)}) but SAP shows it inactive`);
    else note(ok, `deactivate ${code}: left active, executor's reason: ${skippedDeact.get(code)}`);
    continue;
  }
  const wrong = [];
  if (it.Valid !== 'tNO') wrong.push(`Valid ${it.Valid}`);
  if (it.Frozen !== 'tYES') wrong.push(`Frozen ${it.Frozen}`);
  if (num(it.QuantityOnStock) !== 0) wrong.push(`holds ${it.QuantityOnStock}`);
  const b = before.get(code);
  if (b && !same(b.ItemName, it.ItemName)) wrong.push(`name changed "${b.ItemName}" -> "${it.ItemName}"`);
  if (wrong.length) note(bad, `deactivate ${code}: ${wrong.join(', ')}`); else deactivated += 1;
}
note(ok, `deactivations: ${deactivated} of ${plan.deactivate.length} inactive with zero stock and the name untouched`);

// ---- 3. items with stock that matched nothing: untouched
const FIELDS = ['ItemName', 'U_SubTypeA', 'U_SubTypeB', 'MinInventory', 'Valid', 'Frozen', 'QuantityOnStock', 'InventoryUOM', 'ItemsGroupCode'];
const changedFields = (b, a) => FIELDS.filter((f) => (f === 'MinInventory' || f === 'QuantityOnStock' ? num(b[f]) !== num(a[f]) : !same(b[f], a[f])));
let untouched = 0;
for (const m of plan.manual) {
  const code = norm(m.sapCode);
  const b = before.get(code); const a = after.get(code);
  if (!b || !a) { note(bad, `left-alone ${code}: ${!b ? 'missing before' : 'missing after'}`); continue; }
  const ch = changedFields(b, a);
  if (ch.length) note(bad, `left-alone ${code} CHANGED: ${ch.map((f) => `${f} ${b[f]} -> ${a[f]}`).join(', ')}`); else untouched += 1;
}
note(ok, `items with stock that matched nothing: ${untouched} of ${plan.manual.length} untouched`);

// ---- 4. every other group-108 item untouched
const planned = new Set([...plan.renames.map((r) => norm(r.sapCode)), ...plan.deactivate.map((d) => norm(d.sapCode)), ...plan.manual.map((m) => norm(m.sapCode))]);
let others = 0; let othersChanged = 0;
for (const [code, b] of before) {
  if (planned.has(code)) continue;
  const a = after.get(code);
  if (!a) { note(bad, `other ${code}: gone from group 108`); continue; }
  const ch = changedFields(b, a);
  if (ch.length) { othersChanged += 1; note(bad, `other ${code} CHANGED: ${ch.map((f) => `${f} ${b[f]} -> ${a[f]}`).join(', ')}`); } else others += 1;
}
note(ok, `other pre-existing group-108 items: ${others} untouched${othersChanged ? `, ${othersChanged} CHANGED` : ''}`);

// ---- 5. new items
const stampOf = (n) => (n.combined ? `PS-${n.name.toUpperCase()}` : `PS-${String(n.physicalIds).split(',')[0].trim()}`);
const bySww = new Map([...after.values()].filter((r) => norm(r.SWW).startsWith('PS-')).map((r) => [norm(r.SWW), r]));
let created = 0; let stocked = 0;
const newCodes = new Set();
for (const n of plan.newItems) {
  const it = bySww.get(stampOf(n));
  if (!it) { note(bad, `new ${n.itemCode} "${n.name}": not in SAP (stamp ${stampOf(n)})`); continue; }
  newCodes.add(norm(it.ItemCode));
  const wrong = [];
  if (!same(it.ItemName, n.name)) wrong.push(`ItemName "${it.ItemName}"`);
  if (num(it.ItemsGroupCode) !== 108) wrong.push(`group ${it.ItemsGroupCode}`);
  if (!same(it.U_SubTypeA, n.subA || '')) wrong.push(`U_SubTypeA "${it.U_SubTypeA}"`);
  if (!same(it.U_SubTypeB, n.subB || '')) wrong.push(`U_SubTypeB "${it.U_SubTypeB}"`);
  if (minOf(it) !== num(n.minStock)) wrong.push(`minimum ${minOf(it)}`);
  if (!same(it.InventoryUOM, n.uom)) wrong.push(`unit ${it.InventoryUOM}`);
  if (it.Valid !== 'tYES' || it.Frozen === 'tYES') wrong.push('inactive');
  if (before.has(norm(it.ItemCode))) wrong.push('code existed before the run');
  // A row counted as a negative quantity is created with nothing received, like a zero row (ENG-875, counted -2).
  const expected = Math.max(0, num(n.physicalQty));
  if (Math.abs(num(it.QuantityOnStock) - expected) > 1e-6) wrong.push(`stock ${it.QuantityOnStock}, counted ${n.physicalQty}`); else if (expected > 0) stocked += 1;
  if (wrong.length) note(bad, `new ${norm(it.ItemCode)} "${n.name}": ${wrong.join(', ')}`); else created += 1;
}
note(ok, `new items: ${created} of ${plan.newItems.length} exactly as planned; ${stocked} hold their counted quantity, ${plan.newItems.filter((n) => !(num(n.physicalQty) > 0)).length} were counted with none`);
const strays = [...bySww.values()].filter((r) => !plan.newItems.some((n) => stampOf(n) === norm(r.SWW)));
if (strays.length) note(bad, `stamped items not in the plan: ${strays.map((r) => r.ItemCode).join(', ')}`);

// ---- 6. the Goods Receipts: nil value, the right lines
let grLines = 0; let grValue = 0;
for (const d of grDocs) {
  for (const l of d.DocumentLines || []) { grLines += 1; grValue += num(l.LineTotal) + num(l.Price) * 0; if (num(l.Price) !== 0 || num(l.UnitPrice) !== 0) note(bad, `Goods Receipt ${d.DocNum} line ${l.LineNum} ${l.ItemCode}: price ${l.Price} / ${l.UnitPrice}, not nil`); if (norm(l.WarehouseCode) !== '01') note(bad, `Goods Receipt ${d.DocNum} line ${l.LineNum} ${l.ItemCode}: warehouse ${l.WarehouseCode}`); if (!newCodes.has(norm(l.ItemCode))) note(bad, `Goods Receipt ${d.DocNum} line ${l.LineNum}: ${l.ItemCode} is not a new item`); }
  if (num(d.DocTotal) !== 0) note(bad, `Goods Receipt ${d.DocNum}: DocTotal ${d.DocTotal}, not nil`);
}
const wantLines = plan.newItems.filter((n) => num(n.physicalQty) > 0).length;
note(grLines === wantLines ? ok : bad, `Goods Receipts: ${grDocs.length} document(s) (${grDocs.map((d) => d.DocNum).join(', ')}), ${grLines} line(s) - ${wantLines} expected - total value ${grValue}`);

// ---- 7. every counted row accounted for
const counted = plan.renames.length + plan.fastenersNotCreated.length + plan.newItems.filter((n) => !n.combined).reduce((s, n) => s + String(n.physicalIds).split(',').length, 0);
note(ok, `counted rows accounted for by the plan: ${counted} (renamed ${plan.renames.length} + inside Bolt/Nut/Washer ${plan.fastenersNotCreated.length} + new ${counted - plan.renames.length - plan.fastenersNotCreated.length}; the count has 654 rows)`);
if (counted !== 654) note(bad, `counted rows accounted for: ${counted}, not 654`);

// ---- 8. totals
const active = [...after.values()].filter((r) => r.Valid === 'tYES' && r.Frozen !== 'tYES');
note(ok, `group 108 now: ${after.size} items, ${active.length} active (${[...before.values()].filter((r) => r.Valid === 'tYES' && r.Frozen !== 'tYES').length} active before), highest ENG code ${afterRaw[1] ? Math.max(0, ...afterRaw[1].rows.map((r) => { const m = norm(r.ItemCode).match(/^ENG[\s-]*(\d+)$/i); return m ? Number(m[1]) : 0; })) : '?'}`);

console.log('OK:'); for (const m of ok) console.log('  ' + m);
console.log(bad.length ? `PROBLEMS (${bad.length}):` : 'PROBLEMS: none'); for (const m of bad) console.log('  ' + m);
fs.writeFileSync(AFTER.replace(/\.json$/i, '') + '.verify.json', JSON.stringify({ ok, bad }, null, 1));
process.exit(bad.length ? 1 : 0);
