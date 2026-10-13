// ERPNext schema for spares issued to breakdowns from the CMMS (added 10 Oct 2026). Idempotent.
//   node setup-goods-issue.js            dry run
//   node setup-goods-issue.js --apply
//
// CMMS Goods Issue (+ CMMS Goods Issue Line): one record per repair whose spares were picked from the plant's
// store when it was marked "Machine running again". The CMMS checks each quantity against what the store has
// available. The sync posts a SAP Goods Issue (InventoryGenExits) from the company's engineering warehouse and an
// ERPNext Material Issue out of the company's store.
//   status Draft (held while the breakdown moves on) -> Queued -> Posted, or Failed; Cancelled when the
//   breakdown did not move on after all (nothing was taken).
const erp = require('./erp.js');
const APPLY = process.argv.includes('--apply');

const f = (fieldname, label, fieldtype, extra = {}) => ({ fieldname, label, fieldtype, ...extra });
const PERMS = [
  { role: 'System Manager', read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1, share: 1 },
  { role: 'Store Manager', read: 1, report: 1, export: 1 },
  { role: 'Store Maintenance Manager', read: 1, write: 1, create: 1, report: 1, export: 1 },
  { role: 'VP Operations', read: 1, report: 1, export: 1 },
];

const LINE = {
  doctype: 'DocType', name: 'CMMS Goods Issue Line', module: 'Custom', custom: 1, istable: 1, editable_grid: 1,
  fields: [
    f('item', 'Item', 'Link', { options: 'Item', reqd: 1, in_list_view: 1 }),
    f('item_name', 'Item Name', 'Data', { in_list_view: 1, read_only: 1 }),
    f('sap_item_code', 'SAP Item Code', 'Data', { read_only: 1 }),
    f('qty', 'Quantity', 'Float', { reqd: 1, in_list_view: 1 }),
    f('uom', 'Unit', 'Data'),
    f('warehouse', 'SAP Warehouse', 'Data', { length: 20 }),
  ],
};

const ISSUE = {
  doctype: 'DocType', name: 'CMMS Goods Issue', module: 'Custom', custom: 1, istable: 0, track_changes: 1,
  naming_rule: 'Expression', autoname: 'format:GI-{YYYY}-{#####}', sort_field: 'creation', sort_order: 'DESC',
  permissions: PERMS.slice(0, 1),
  fields: [
    f('company', 'SAP Company', 'Data', { length: 10, reqd: 1, in_list_view: 1, description: 'ERPNext company abbreviation = SAP item code prefix (MRPPL, MT, HRI, MTR).' }),
    f('status', 'Status', 'Select', { options: 'Draft\nQueued\nPosted\nFailed\nCancelled', default: 'Draft', read_only: 1, in_list_view: 1 }),
    f('breakdown', 'Breakdown', 'Link', { options: 'CMMS Breakdown', reqd: 1, in_list_view: 1 }),
    f('machine', 'Machine', 'Data', { read_only: 1 }),
    f('plant', 'Plant', 'Data', { read_only: 1 }),
    f('col_a', '', 'Column Break'),
    f('raised_by', 'Raised By', 'Link', { options: 'User', read_only: 1 }),
    f('raised_at', 'Raised At', 'Datetime', { read_only: 1 }),
    f('lines_section', 'Spares', 'Section Break'),
    f('lines', 'Lines', 'Table', { options: LINE.name, reqd: 1 }),
    f('sap_section', 'Posting', 'Section Break'),
    f('sap_doc_entry', 'SAP DocEntry', 'Int', { read_only: 1 }),
    f('sap_doc_number', 'SAP Goods Issue No.', 'Data', { read_only: 1, in_list_view: 1 }),
    f('col_b', '', 'Column Break'),
    f('erp_stock_entry', 'ERPNext Stock Entry', 'Data', { read_only: 1 }),
    f('posted_at', 'Posted At', 'Datetime', { read_only: 1 }),
    f('error', 'Error', 'Small Text', { read_only: 1 }),
  ],
};

const exists = async (dt, name) => { try { await erp.get(dt, name); return true; } catch (e) { if (/ 404 /.test(e.message)) return false; throw e; } };

(async () => {
  const have = {};
  for (const d of [LINE, ISSUE]) have[d.name] = await exists('DocType', d.name);
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ` + [LINE, ISSUE].map((d) => `${d.name}: ${have[d.name] ? 'present' : 'missing'}`).join(' | '));
  if (!APPLY) return;
  // The child table first: the parent's Table field links to it.
  for (const d of [LINE, ISSUE]) {
    if (have[d.name]) continue;
    await erp.insert('DocType', d);
    console.log('doctype created:', d.name);
  }
  // The other roles as Custom DocPerm rows (a non-Administrator cannot put them on a custom DocType);
  // System Manager too - once any Custom DocPerm exists, Frappe uses only those.
  const held = new Set((await erp.list('Custom DocPerm', { fields: ['role'], filters: [['parent', '=', ISSUE.name], ['permlevel', '=', 0]] })).map((x) => x.role));
  for (const perm of PERMS) {
    if (held.has(perm.role)) continue;
    await erp.insert('Custom DocPerm', { parent: ISSUE.name, parenttype: 'DocType', parentfield: 'permissions', permlevel: 0, ...perm });
    console.log(`${ISSUE.name}: granted ${perm.role}`);
  }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
