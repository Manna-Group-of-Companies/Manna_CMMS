// Fills the SAP category mirror on the imported engineering items from the SAP snapshots, and publishes the
// per-company engineering item groups on the control Single (field engineering_groups) so the CMMS can offer
// only valid moves and the sync can map a group name back to ItemsGroupCode.
//   node backfill-categories.js [--apply]
const fs = require('fs'); const path = require('path'); const erp = require('./erp.js');
const APPLY = process.argv.includes('--apply');
const SNAP = path.join(__dirname, 'snapshots', '2026-09-24');
const CONTROL = 'SAP Item Category Sync Control';
const COMPANIES = [
  { db: 'MANNA_RUBBER_LIVE', abbr: 'MRPPL', company: 'Manna Rubber Products Private Limited', groups: [108] },
  { db: 'HITECH_PRETREADS_LIVE', abbr: 'MT', company: 'Manna Treads', groups: [110] },
  { db: 'HITECH_RUBBER_LIVE', abbr: 'HRI', company: 'Hi-Tech Rubber Industries', groups: [106, 108, 109] },
  { db: 'MANNA_TYRE_LIVE', abbr: 'MTR', company: 'Manna Tyre Retreads', groups: [115, 116] },
];
const t = s => String(s ?? '').trim().replace(/\s+/g, ' ');
(async () => {
  // 1. the engineering_groups field on the control Single (custom doctype, so edit the DocType itself)
  const dt = await erp.get('DocType', CONTROL);
  if (!dt.fields.some(f => f.fieldname === 'engineering_groups')) {
    console.log('control doctype: engineering_groups field missing');
    if (APPLY) {
      dt.fields.push({ fieldname: 'engineering_groups', label: 'Engineering Groups (per company, from SAP)', fieldtype: 'Code', options: 'JSON', read_only: 1 });
      await erp.update('DocType', CONTROL, { fields: dt.fields });
      console.log('control doctype: engineering_groups field added');
    }
  }
  const map = {};
  for (const c of COMPANIES) {
    const groups = JSON.parse(fs.readFileSync(path.join(SNAP, c.db + '.json'), 'utf8'))[1].rows;
    map[c.abbr] = { company: c.company, sap_db: c.db, groups: c.groups.map(code => ({ code, name: t(groups.find(g => g.Number === code).GroupName) })) };
  }
  console.log('engineering_groups:', JSON.stringify(map));
  // 2. the three category fields on every imported item
  const items = await erp.list('Item', { fields: ['name', 'custom_sap_item_code', 'custom_sap_item_group', 'custom_sap_sub_type_a', 'custom_sap_sub_type_b'], filters: [['name', 'like', '%-%'], ['custom_sap_item_code', 'is', 'set']] });
  const byName = new Map(items.map(i => [i.name, i]));
  const todo = [];
  for (const c of COMPANIES) {
    const rows = JSON.parse(fs.readFileSync(path.join(SNAP, 'subtypes-' + c.db + '.json'), 'utf8'))[0].rows;
    for (const r of rows) {
      const code = `${c.abbr}-${t(r.ItemCode)}`;
      const cur = byName.get(code);
      if (!cur) { console.log('not in ERPNext:', code); continue; }
      const want = { custom_sap_item_group: map[c.abbr].groups.find(g => g.code === r.ItemsGroupCode).name, custom_sap_sub_type_a: t(r.U_SubTypeA), custom_sap_sub_type_b: t(r.U_SubTypeB) };
      if (Object.keys(want).some(k => (cur[k] || '') !== want[k])) todo.push({ code, want });
    }
  }
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: items to fill: ${todo.length}; e.g. ${todo.filter(x => x.want.custom_sap_sub_type_a).slice(0, 3).map(x => x.code + ' ' + JSON.stringify(x.want)).join(' | ')}`);
  if (!APPLY) return;
  await erp.update(CONTROL, CONTROL, { engineering_groups: JSON.stringify(map, null, 1) });
  const stamp = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');   // IST, naive
  let ok = 0; const failed = [];
  await erp.pool(todo, 4, async x => { try { await erp.update('Item', x.code, { ...x.want, custom_sap_category_pending: 0, custom_sap_category_synced_at: stamp, custom_sap_category_error: '' }); ok++; } catch (e) { failed.push(x.code + ': ' + e.message); } });
  console.log('items filled:', ok, 'failed:', failed.length, failed.slice(0, 3).join(' | '));
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
