// Undoes the 11 Item Groups created by import-sap-engineering.js on 2026-09-24: moves the imported SAP items
// onto the "Maintenance Store" root (the CMMS lists root items, with no category) and deletes those groups.
// Reason: the CMMS catalog puts every Maintenance Store group name in one URL; the extra groups took it to
// 4390 bytes, over Frappe Cloud's ~4 KB request-line limit, and the catalog screen stopped loading.
const fs = require('fs'); const erp = require('./erp.js');
const SUBS = ['Engineering Stocks', 'Tools and Equipments', 'Spare Parts', 'Engineering Tools (Hi-Tech Rubber Industries)', 'Electrical Items (Hi-Tech Rubber Industries)', 'Engineering Tools (Manna Tyre Retreads)', 'Electrical Items (Manna Tyre Retreads)'];
const CATS = ['Manna Rubber Products', 'Manna Treads', 'Hi-Tech Rubber Industries', 'Manna Tyre Retreads'];
(async () => {
  const items = await erp.list('Item', { fields: ['name', 'item_group'], filters: [['item_group', 'in', [...SUBS, ...CATS]]] });
  const foreign = items.filter(i => !/^(MRPPL|MT|HRI|MTR)-/.test(i.name));
  if (foreign.length) throw new Error('groups hold items this import did not create: ' + foreign.map(i => i.name).join(', '));
  fs.appendFileSync('logs/revert-my-groups.log', `${new Date().toISOString()} moving ${items.length} items to root: ` + JSON.stringify(items.map(i => [i.name, i.item_group])) + '\n');
  let moved = 0, failed = [];
  await erp.pool(items, 4, async i => { try { await erp.update('Item', i.name, { item_group: 'Maintenance Store' }); moved++; } catch (e) { failed.push(i.name + ': ' + e.message); } });
  console.log('items moved to Maintenance Store root:', moved, 'failed:', failed.length, failed.slice(0, 3).join(' | '));
  if (failed.length) return;
  for (const g of [...SUBS, ...CATS]) {
    try { await erp.call('frappe.client.delete', { doctype: 'Item Group', name: g }); console.log('deleted group:', g); }
    catch (e) { console.log('GROUP DELETE FAILED:', g, e.message); }
  }
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
