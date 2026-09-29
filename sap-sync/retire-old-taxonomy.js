// Moves the old stock-take taxonomy (every direct child of "Maintenance Store" except the four SAP company
// categories) under a new top-level group outside the CMMS catalog tree. Groups and their (disabled) items
// are untouched - only the parent changes - so moving them back restores the old tree exactly.
// Needed because the CMMS catalog sends every Maintenance Store group name in one URL, and Frappe Cloud
// rejects request lines over ~4 KB; with the old tree plus the SAP groups it was 4390 bytes.
//   node retire-old-taxonomy.js            dry run
//   node retire-old-taxonomy.js --apply
//   node retire-old-taxonomy.js --undo     (moves them back)
const fs = require('fs'); const erp = require('./erp.js');
const RETIRED = 'Maintenance Store (Retired 2026-09)';
const KEEP = new Set(['Manna Rubber Products', 'Manna Treads', 'Hi-Tech Rubber Industries', 'Manna Tyre Retreads']);
const apply = process.argv.includes('--apply'), undo = process.argv.includes('--undo');
(async () => {
  const groups = await erp.list('Item Group', { fields: ['name', 'parent_item_group', 'is_group'] });
  const from = undo ? RETIRED : 'Maintenance Store', to = undo ? 'Maintenance Store' : RETIRED;
  const move = groups.filter(g => g.parent_item_group === from && !KEEP.has(g.name));
  console.log(`${apply || undo ? 'MOVING' : 'DRY RUN'}: ${move.length} groups from "${from}" to "${to}"`);
  if (!apply && !undo) { console.log(move.map(g => g.name).join(' | ')); return; }
  if (!undo && !groups.some(g => g.name === RETIRED)) { await erp.insert('Item Group', { item_group_name: RETIRED, parent_item_group: 'All Item Groups', is_group: 1 }); console.log('created', RETIRED); }
  fs.appendFileSync('logs/retire-old-taxonomy.log', `${new Date().toISOString()} ${undo ? 'undo' : 'apply'}: ${move.map(g => g.name).join(' | ')}\n`);
  let n = 0;
  for (const g of move) { await erp.update('Item Group', g.name, { parent_item_group: to }); n++; }
  console.log('moved', n);
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
