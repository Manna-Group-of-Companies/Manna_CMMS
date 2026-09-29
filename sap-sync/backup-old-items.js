// Backs up the current CMMS "Maintenance Store" items before they are disabled.
const fs = require('fs'); const erp = require('./erp.js');
(async () => {
  const groups = await erp.list('Item Group', { fields: ['*'] });
  const under = new Set(['Maintenance Store']); let grew = true;
  while (grew) { grew = false; groups.forEach(g => { if (under.has(g.parent_item_group) && !under.has(g.name)) { under.add(g.name); grew = true; } }); }
  const names = (await erp.list('Item', { fields: ['name', 'item_group'] })).filter(i => under.has(i.item_group)).map(i => i.name);
  const items = await erp.pool(names, 6, n => erp.get('Item', n));
  const bins = []; for (let k = 0; k < names.length; k += 100) bins.push(...await erp.list('Bin', { fields: ['*'], filters: [['item_code', 'in', names.slice(k, k + 100)]] }));
  const recos = await erp.pool(['MAT-RECO-2026-00001','MAT-RECO-2026-00002','MAT-RECO-2026-00003','MAT-RECO-2026-00004','MAT-RECO-2026-00005','MAT-RECO-2026-00006','MAT-RECO-2026-00007','MAT-RECO-2026-00008'], 4, n => erp.get('Stock Reconciliation', n));
  const file = 'backup/maintenance-store-items-2026-09-24.json';
  fs.writeFileSync(file, JSON.stringify({ taken_at: new Date().toISOString(), note: 'CMMS Maintenance Store items (SAP1..SAP657) before they were disabled for the SAP engineering import', item_groups: groups.filter(g => under.has(g.name)), items, bins, opening_stock_reconciliations: recos }, null, 1));
  console.log('backed up', items.length, 'items,', bins.length, 'bins,', recos.length, 'recos,', [...under].length, 'groups ->', file, (fs.statSync(file).size / 1024).toFixed(0) + ' KB');
  console.log('items with item_defaults:', items.filter(i => (i.item_defaults || []).length).length, '| already disabled:', items.filter(i => i.disabled).length, '| with image:', items.filter(i => i.image).length);
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
