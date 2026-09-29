// One-time import of SAP B1 engineering items into ERPNext for the Manna CMMS.
//
//   node import-sap-engineering.js                 dry run (default) - prints the plan, writes nothing
//   node import-sap-engineering.js --apply [--step=groups|items|stock|disable] [--limit=N]
//
// Reads the SAP snapshots taken with sap-tools\Sap-Get.ps1 (snapshots\<date>\<CompanyDB>.json);
// never talks to SAP itself. Writes ERPNext with the key in Manna_CMMS\server\.env.
// Every step is idempotent: an existing group, item or tagged reconciliation is skipped.
//
// Conventions follow the CMMS code (Manna_CMMS/server):
//   - catalog = Item Groups under "Maintenance Store", max two levels (repository/catalog.js)
//   - a sub-category repeated under two parents is named "<sub> (<parent>)" (masterData.js)
//   - units via the same map as integrations/erpnext/uom.js, "Nos" when unknown
//   - opening stock = submitted Stock Reconciliation, purpose "Opening Stock",
//     remarks "CMMS opening stock: <warehouse>", zero valuation allowed (openingStock.js)
const fs = require('fs');
const path = require('path');
const erp = require('./erp.js');

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const APPLY = !!args.apply;
const STEP = args.step || 'all';
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const SNAP = path.join(__dirname, 'snapshots', args.snapshot || '2026-09-24');
const POSTING_DATE = '2026-09-24';
const ROOT = 'Maintenance Store';

// SAP company database -> ERPNext company, as set by the user on 2026-09-24.
const COMPANIES = [
  { db: 'MANNA_RUBBER_LIVE',     company: 'Manna Rubber Products Private Limited', abbr: 'MRPPL', label: 'Manna Rubber Products',     warehouse: 'Manna Rubber Products Store - MRPPL', groups: { 108: 'Engineering Stocks' } },
  { db: 'HITECH_PRETREADS_LIVE', company: 'Manna Treads',                          abbr: 'MT',    label: 'Manna Treads',              warehouse: 'Stores - MT',                         groups: { 110: 'Tools and Equipments' } },
  { db: 'HITECH_RUBBER_LIVE',    company: 'Hi-Tech Rubber Industries',             abbr: 'HRI',   label: 'Hi-Tech Rubber Industries', warehouse: 'Stores - HRI',                        groups: { 108: 'Engineering Tools', 109: 'Electrical Items', 106: 'Spare Parts' } },
  { db: 'MANNA_TYRE_LIVE',       company: 'Manna Tyre Retreads',                   abbr: 'MTR',   label: 'Manna Tyre Retreads',       warehouse: 'Stores - MTR',                        groups: { 115: 'Engineering Tools', 116: 'Electrical Items' } },
];

// Same vocabulary as Manna_CMMS/server/integrations/erpnext/uom.js.
const UOM = new Map([
  ...['pcs', 'pc', 'pce', 'piece', 'pieces', 'nos', 'no', 'nr', 'num', 'number', 'numbers', 'each', 'ea', 'qty', 'quantity'].map(k => [k, 'Nos']),
  ...['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms'].map(k => [k, 'Kg']),
  ...['g', 'gm', 'gms', 'gram', 'grams'].map(k => [k, 'Gram']),
  ...['l', 'ltr', 'ltrs', 'lt', 'litre', 'litres', 'liter', 'liters'].map(k => [k, 'Litre']),
  ...['m', 'mtr', 'mtrs', 'meter', 'meters', 'metre', 'metres'].map(k => [k, 'Meter']),
  ...['cm', 'cms', 'centimeter', 'centimeters', 'centimetre', 'centimetres'].map(k => [k, 'Centimeter']),
  ...['packet', 'packets', 'pkt', 'pkts'].map(k => [k, 'Packet']),
  ...['box', 'boxes', 'bx'].map(k => [k, 'Box']),
  ...['set', 'sets'].map(k => [k, 'Set']),
  ...['pair', 'pairs', 'pr'].map(k => [k, 'Pair']),
  ...['roll', 'rolls'].map(k => [k, 'Roll']),
  ...['unit', 'units'].map(k => [k, 'Unit']),
]);
const resolveUom = u => { const raw = String(u ?? '').trim(); const m = UOM.get(raw.toLowerCase().replace(/[.,;:]+$/, '').trim()); return { uom: m || 'Nos', exact: !!m, raw }; };

const norm = s => String(s ?? '').trim().replace(/\s+/g, ' ');
const key = s => norm(s).toLowerCase();

async function main() {
  // ---------------------------------------------------------------- plan
  const snapshots = COMPANIES.map(c => {
    const [items] = JSON.parse(fs.readFileSync(path.join(SNAP, c.db + '.json'), 'utf8'));
    if (items.http !== '200' || items.truncated) throw new Error(`${c.db}: snapshot unusable (http ${items.http}, truncated ${items.truncated})`);
    return { ...c, rows: items.rows.filter(r => c.groups[r.ItemsGroupCode]) };
  });

  // Sub-category names: qualified with the parent only where two companies share one.
  const subUse = new Map();
  snapshots.forEach(c => Object.values(c.groups).forEach(g => subUse.set(key(g), (subUse.get(key(g)) || 0) + 1)));
  const subName = (c, g) => (subUse.get(key(g)) > 1 ? `${g} (${c.label})` : g);

  const existingGroups = await erp.list('Item Group', { fields: ['name', 'parent_item_group', 'is_group'] });
  const groupByKey = new Map(existingGroups.map(g => [key(g.name), g]));
  const groupPlan = [];
  for (const c of snapshots) {
    groupPlan.push({ name: c.label, parent: ROOT, is_group: 1 });
    Object.values(c.groups).forEach(g => groupPlan.push({ name: subName(c, g), parent: c.label, is_group: 0 }));
  }
  const groupProblems = groupPlan.filter(g => groupByKey.has(key(g.name)) && groupByKey.get(key(g.name)).parent_item_group !== g.parent)
    .map(g => `${g.name}: already exists under "${groupByKey.get(key(g.name)).parent_item_group}"`);

  // Item codes: "<company abbr>-<SAP code>" (user's choice 2026-09-24) - SAP companies reuse codes for
  // different items (ENG-11..25 in both MRPPL and MTR). The plain SAP code goes in custom_sap_item_code.
  // Anything that still collides is reported, not guessed.
  const existingItems = await erp.list('Item', { fields: ['name', 'item_group', 'disabled', 'custom_sap_item_code', 'item_defaults.company as company'] });
  const itemByKey = new Map(existingItems.map(i => [key(i.name), i]));
  const seen = new Map();
  const items = [];
  const collisions = [];
  const uomGuesses = new Map();
  for (const c of snapshots) {
    for (const r of c.rows) {
      const sapCode = norm(r.ItemCode);
      const code = `${c.abbr}-${sapCode}`;
      const u = resolveUom(r.InventoryUOM);
      if (!u.exact) uomGuesses.set(`${u.raw || '(blank)'} -> ${u.uom}`, (uomGuesses.get(`${u.raw || '(blank)'} -> ${u.uom}`) || 0) + 1);
      const name = norm(r.ItemName) || code;
      const foreign = norm(r.ForeignName);
      const item = {
        c, code, sap: r,
        doc: {
          item_code: code,
          item_name: name.slice(0, 140),
          item_group: subName(c, c.groups[r.ItemsGroupCode]),
          stock_uom: u.uom,
          is_stock_item: r.InventoryItem === 'tYES' ? 1 : 0,
          include_item_in_manufacturing: 0,
          is_purchase_item: 1,
          is_sales_item: 0,
          disabled: r.Valid === 'tYES' && r.Frozen !== 'tYES' ? 0 : 1,
          description: foreign && key(foreign) !== key(name) ? `${name} / ${foreign}` : name,
          custom_sap_item_code: sapCode,
          item_defaults: [{ doctype: 'Item Default', company: c.company, default_warehouse: c.warehouse }],
        },
      };
      if (seen.has(key(code))) collisions.push({ code, msg: `${code}: twice in ${c.db} (SAP codes differing only in case/spacing)` });
      seen.set(key(code), c.db);
      const hit = itemByKey.get(key(code));
      item.exists = hit ? (hit.custom_sap_item_code === sapCode && hit.company === c.company ? 'same' : `different (${hit.item_group}${hit.disabled ? ', disabled' : ''})`) : '';
      if (hit && item.exists !== 'same') collisions.push({ code, msg: `${code} (${c.db}): ERPNext already has an item with this code - ${item.exists}` });
      items.push(item);
    }
  }

  // Opening stock: SAP's company-wide on-hand qty, into the company's one CMMS/ERPNext store warehouse.
  const uomRules = new Map((await erp.list('UOM', { fields: ['name', 'must_be_whole_number'] })).map(u => [u.name, u.must_be_whole_number]));
  // A fractional balance in a whole-number unit (e.g. 3.9 of a blank SAP unit -> Nos) is skipped, not rounded:
  // the item is still created, its stock is left for someone to correct in SAP.
  const isFractional = i => uomRules.get(i.doc.stock_uom) && !Number.isInteger(Number(i.sap.QuantityOnStock));
  const withQty = items.filter(i => i.doc.is_stock_item && Number(i.sap.QuantityOnStock) > 0);
  const fractional = withQty.filter(isFractional)
    .map(i => `${i.code} ${i.doc.item_name}: ${i.sap.QuantityOnStock} ${i.doc.stock_uom} (SAP unit "${i.sap.InventoryUOM || ''}") - stock NOT imported`);
  const stockRows = withQty.filter(i => !isFractional(i));
  const recoPlan = [];
  for (const c of snapshots) {
    const rows = stockRows.filter(i => i.c === c).sort((a, b) => a.code.localeCompare(b.code));
    const parts = Math.ceil(rows.length / 100);
    for (let p = 0; p < parts; p++) {
      const tag = `CMMS opening stock: ${c.warehouse} - SAP ${c.db} import 2026-09-24${parts > 1 ? ` - part ${p + 1} of ${parts}` : ''}`;
      recoPlan.push({ c, tag, rows: rows.slice(p * 100, p * 100 + 100) });
    }
  }

  // The old stock-take catalog, disabled rather than deleted (user's choice 2026-09-24).
  const underRoot = new Set([ROOT]); let grew = true;
  while (grew) { grew = false; existingGroups.forEach(g => { if (underRoot.has(g.parent_item_group) && !underRoot.has(g.name)) { underRoot.add(g.name); grew = true; } }); }
  const oldItems = existingItems.filter(i => /^SAP\d+$/.test(i.name) && underRoot.has(i.item_group));
  const oldToDisable = oldItems.filter(i => !i.disabled);

  // ---------------------------------------------------------------- report
  console.log(`=== ${APPLY ? 'APPLY' : 'DRY RUN'}  step=${STEP}  snapshot=${path.basename(SNAP)}`);
  for (const c of snapshots) {
    const mine = items.filter(i => i.c === c);
    console.log(`  ${c.db.padEnd(22)} -> ${c.company.padEnd(38)} items ${String(mine.length).padStart(3)}  (new ${mine.filter(i => !i.exists).length}, disabled-in-SAP ${mine.filter(i => i.doc.disabled).length}, non-stock ${mine.filter(i => !i.doc.is_stock_item).length})  stock rows ${String(stockRows.filter(i => i.c === c).length).padStart(3)} -> ${c.warehouse}`);
  }
  console.log(`  item groups to create: ${groupPlan.filter(g => !groupByKey.has(key(g.name))).map(g => g.parent === ROOT ? `[${g.name}]` : g.name).join(', ') || 'none'}`);
  console.log(`  opening-stock reconciliations: ${recoPlan.length}`);
  console.log(`  old stock-take items (SAP1..): ${oldItems.length}, to disable now: ${oldToDisable.length}`);
  console.log(`  unit guesses (defaulted): ${[...uomGuesses].map(([k, n]) => `${k} x${n}`).join(', ') || 'none'}`);
  console.log(`  WARNINGS: ${fractional.length}`); fractional.forEach(f => console.log('   - fractional qty in a whole-number unit: ' + f));
  const problems = [...groupProblems, ...collisions.map(x => x.msg)];
  console.log(`  PROBLEMS: ${problems.length}`); problems.forEach(p => console.log('   - ' + p));
  console.log(`  e.g. ${items.filter((_, k) => k % 120 === 0).map(i => `${i.code} = "${i.doc.item_name}" [${i.doc.stock_uom}] -> ${i.doc.item_group}`).join('\n       ')}`);
  if (!APPLY) { console.log('Dry run only. Nothing was written.'); return; }
  if (problems.length && !args.force) throw new Error('Refusing to apply with problems listed above (fix them, or pass --force for the non-colliding rest).');

  const log = fs.createWriteStream(path.join(__dirname, 'logs', `import-${new Date().toISOString().replace(/[:.]/g, '-')}.log`));
  const note = s => { console.log(s); log.write(s + '\n'); };
  const blocked = new Set(collisions.map(x => key(x.code)));

  // ---------------------------------------------------------------- apply
  if (STEP === 'all' || STEP === 'groups') {
    for (const g of groupPlan) {
      if (groupByKey.has(key(g.name))) continue;
      await erp.insert('Item Group', { item_group_name: g.name, parent_item_group: g.parent, is_group: g.is_group });
      groupByKey.set(key(g.name), { name: g.name, parent_item_group: g.parent });
      note(`group created: ${g.name}  (under ${g.parent})`);
    }
  }
  if (STEP === 'all' || STEP === 'items') {
    const todo = items.filter(i => !i.exists && !blocked.has(key(i.code))).slice(0, LIMIT);
    let ok = 0; const failed = [];
    await erp.pool(todo, 4, async i => {
      try { await erp.insert('Item', i.doc); ok++; note(`item created: ${i.code}  ${i.doc.item_name}  [${i.c.abbr}]`); }
      catch (e) { failed.push(`${i.code}: ${e.message}`); note(`ITEM FAILED: ${i.code}: ${e.message}`); }
    });
    note(`items: ${ok} created, ${failed.length} failed, ${items.filter(i => i.exists === 'same').length} already present`);
  }
  if (STEP === 'all' || STEP === 'stock') {
    // This ERPNext's Stock Reconciliation has no `remarks` field (the tag is silently dropped), so "already
    // posted" = an Opening Stock entry dated POSTING_DATE for that company whose rows sit in that warehouse.
    // Parts of the same company/warehouse are counted off in order.
    const sameDay = await erp.list('Stock Reconciliation', { fields: ['name'], filters: [['purpose', '=', 'Opening Stock'], ['posting_date', '=', POSTING_DATE], ['docstatus', '!=', 2]] });
    const posted = new Map();
    for (const d of await erp.pool(sameDay.map(r => r.name), 4, n => erp.get('Stock Reconciliation', n))) {
      const k = `${d.company}|${(d.items[0] || {}).warehouse}`;
      posted.set(k, [...(posted.get(k) || []), d.name]);
    }
    for (const r of recoPlan.slice(0, LIMIT)) {
      const k = `${r.c.company}|${r.c.warehouse}`;
      const prior = posted.get(k) || [];
      if (prior.length) { note(`reconciliation already posted: ${prior.shift()}  ${r.tag}`); posted.set(k, prior); continue; }
      const rows = r.rows.filter(i => !blocked.has(key(i.code)));
      if (!rows.length) continue;
      const doc = await erp.insert('Stock Reconciliation', {
        purpose: 'Opening Stock', company: r.c.company, expense_account: `Temporary Opening - ${r.c.abbr}`, cost_center: `Main - ${r.c.abbr}`,
        posting_date: POSTING_DATE, posting_time: '09:00:00', set_posting_time: 1, remarks: r.tag.slice(0, 500),
        items: rows.map(i => ({ item_code: i.code, warehouse: r.c.warehouse, qty: Number(i.sap.QuantityOnStock), valuation_rate: 0, allow_zero_valuation_rate: 1 })),
        docstatus: 1,
      });
      note(`reconciliation submitted: ${doc.name}  ${rows.length} rows  ${r.tag}`);
    }
  }
  if (STEP === 'all' || STEP === 'disable') {
    let n = 0; const failed = [];
    await erp.pool(oldToDisable.slice(0, LIMIT), 4, async i => {
      try { await erp.update('Item', i.name, { disabled: 1 }); n++; }
      catch (e) { failed.push(`${i.name}: ${e.message}`); note(`DISABLE FAILED: ${i.name}: ${e.message}`); }
    });
    note(`old stock-take items disabled: ${n}, failed: ${failed.length}`);
  }
  log.end();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
