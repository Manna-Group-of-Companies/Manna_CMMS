// Publishes the per-company item master options on the control Single and fills the new mirrored fields
// (foreign name, HSN code, tax rate, min stock) on the imported engineering items. Idempotent.
//   node backfill-item-master.js [--apply]
// Reads snapshots\2026-09-24\master-<DB>.json (Items) and snapshots\2026-09-25\options-<DB>.json (IndiaHsn,
// ENG*/EL* codes). The sync (Sync-SapItemCategories.ps1) refreshes the options of every company it touches.
const fs = require('fs'); const path = require('path'); const erp = require('./erp.js');
const APPLY = process.argv.includes('--apply');
const CONTROL = 'SAP Item Category Sync Control';
const S = (d, f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'snapshots', d, f), 'utf8'));
const t = v => String(v ?? '').trim().replace(/\s+/g, ' ');

// Numbering, as agreed with the user on 25 Sep 2026. `series` is the SAP numbering series used on creation;
// `prefixes` maps an item group code to the manual prefix whose next number the sync assigns ("" = the
// series is automatic and SAP assigns the code).
const COMPANIES = [
  { abbr: 'MRPPL', db: 'MANNA_RUBBER_LIVE', series: 3, prefixes: { 108: 'ENG-' } },
  { abbr: 'MT', db: 'HITECH_PRETREADS_LIVE', series: 104, prefixes: { 110: '' } },
  { abbr: 'HRI', db: 'HITECH_RUBBER_LIVE', series: 3, prefixes: { 106: 'ENG-', 108: 'ENG-', 109: 'EL-' } },
  { abbr: 'MTR', db: 'MANNA_TYRE_LIVE', series: 3, prefixes: { 115: 'ENG-', 116: 'EL-' } },
];
const UNITS = ['NOS', 'KGS', 'MTR', 'LTR', 'SET', 'PCS', 'PAIR', 'BOX', 'ROLL'];
const TAX_RATES = ['0%', '5%', '12%', '18%', '28%'];

const hsnDigits = h => `${t(h.Chapter)}${t(h.Heading)}${t(h.SubHeading)}`.replace(/\D/g, '');
const maxOf = (rows, prefix) => {
  const re = new RegExp(`^${prefix.replace(/-$/, '')}[\\s-]*(\\d+)$`, 'i');
  return rows.map(r => (t(r.ItemCode).match(re) || [])[1]).filter(Boolean).map(Number).reduce((m, n) => Math.max(m, n), 0);
};

(async () => {
  const ctl = await erp.get(CONTROL, CONTROL);
  const groups = JSON.parse(ctl.engineering_groups || '{}');
  const options = {};
  const hsnByAbs = {};
  for (const c of COMPANIES) {
    const [hsn, eng, el] = S('2026-09-25', `options-${c.db}.json`);
    if (hsn.http !== '200' || hsn.truncated) throw new Error(`${c.db}: IndiaHsn snapshot unusable`);
    hsnByAbs[c.abbr] = new Map(hsn.rows.map(h => [h.AbsEntry, hsnDigits(h)]));
    const codeRows = [...(eng.rows || []), ...(el.rows || [])];
    const next = {};
    for (const p of new Set(Object.values(c.prefixes).filter(Boolean))) next[p] = maxOf(codeRows, p) + 1;
    const master = S('2026-09-24', `master-${c.db}.json`)[0].rows;
    const unitsInUse = master.map(r => t(r.InventoryUOM).toUpperCase()).filter(Boolean);
    options[c.abbr] = {
      company: groups[c.abbr]?.company, sap_db: c.db, series: c.series,
      groups: (groups[c.abbr]?.groups || []).map(g => ({ ...g, prefix: c.prefixes[g.code] ?? null })),
      next_codes: next,
      units: [...new Set([...UNITS, ...unitsInUse])],
      tax_rates: TAX_RATES,
      hsn: [...new Set([...hsnByAbs[c.abbr].values()].filter(Boolean))].sort(),
      refreshed_at: '2026-09-25',
    };
  }
  console.log('options:', Object.entries(options).map(([a, o]) => `${a}: groups ${o.groups.map(g => g.name + (g.prefix ? ' ' + g.prefix + (o.next_codes[g.prefix]) : ' auto')).join(' / ')}, ${o.hsn.length} HSN, units ${o.units.join(',')}`).join('\n         '));

  // Item fields
  const items = await erp.list('Item', { fields: ['name', 'safety_stock', 'custom_sap_foreign_name', 'custom_sap_hsn_code', 'custom_sap_tax_rate'], filters: [['custom_sap_item_code', 'is', 'set'], ['custom_sap_item_group', 'is', 'set']] });
  const byName = new Map(items.map(i => [i.name, i]));
  const todo = [];
  for (const c of COMPANIES) {
    for (const r of S('2026-09-24', `master-${c.db}.json`)[0].rows) {
      const code = `${c.abbr}-${t(r.ItemCode)}`;
      const cur = byName.get(code); if (!cur) continue;
      const want = {
        custom_sap_foreign_name: t(r.ForeignName),
        custom_sap_hsn_code: r.ChapterID > 0 ? hsnByAbs[c.abbr].get(r.ChapterID) || '' : '',
        custom_sap_tax_rate: t(r.U_TaxRate),
      };
      if (Number(r.MinInventory) > 0) want.safety_stock = Number(r.MinInventory);
      if (Object.keys(want).some(k => (k === 'safety_stock' ? Number(cur[k] || 0) : cur[k] || '') !== want[k])) todo.push({ code, want });
    }
  }
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: items to fill ${todo.length}; with HSN ${todo.filter(x => x.want.custom_sap_hsn_code).length}, foreign name ${todo.filter(x => x.want.custom_sap_foreign_name).length}, tax ${todo.filter(x => x.want.custom_sap_tax_rate).length}; e.g. ${todo.filter(x => x.want.custom_sap_hsn_code).slice(0, 2).map(x => x.code + ' ' + JSON.stringify(x.want)).join(' | ')}`);
  if (!APPLY) return;
  await erp.update(CONTROL, CONTROL, { item_master_options: JSON.stringify(options) });
  console.log('item_master_options published');
  let ok = 0; const failed = [];
  await erp.pool(todo, 4, async x => { try { await erp.update('Item', x.code, x.want); ok++; } catch (e) { failed.push(x.code + ': ' + e.message); } });
  console.log('items filled:', ok, 'failed:', failed.length, failed.slice(0, 3).join(' | '));
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
