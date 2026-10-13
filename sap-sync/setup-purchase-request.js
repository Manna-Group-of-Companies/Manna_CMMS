// ERPNext schema for purchase requests raised in the CMMS (added 9 Oct 2026). Idempotent.
//   node setup-purchase-request.js            dry run
//   node setup-purchase-request.js --apply
//
// CMMS Purchase Request (+ CMMS Purchase Request Line): the Maintenance Manager picks engineering items of one
// SAP company and raises a request. The sync posts a SAP Purchase Request (PurchaseRequests); the purchase
// manager converts it to a Purchase Order in SAP; the sync sees the PO (its lines carry BaseType 1470000113 =
// the request) and records the PO number, and the PO appears in the CMMS goods receipt form.
//   status Queued -> In SAP -> Ordered -> Closed, or Failed.
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
  doctype: 'DocType', name: 'CMMS Purchase Request Line', module: 'Custom', custom: 1, istable: 1, editable_grid: 1,
  fields: [
    f('item', 'Item', 'Link', { options: 'Item', reqd: 1, in_list_view: 1 }),
    f('item_name', 'Item Name', 'Data', { in_list_view: 1, read_only: 1 }),
    f('sap_item_code', 'SAP Item Code', 'Data', { read_only: 1 }),
    f('qty', 'Quantity', 'Float', { reqd: 1, in_list_view: 1 }),
    f('uom', 'Unit', 'Data'),
    f('remarks', 'Remarks', 'Data', { length: 100, description: 'Goes to SAP as the line free text.' }),
  ],
};

const REQUEST = {
  doctype: 'DocType', name: 'CMMS Purchase Request', module: 'Custom', custom: 1, istable: 0, track_changes: 1,
  naming_rule: 'Expression', autoname: 'format:PR-{YYYY}-{#####}', sort_field: 'creation', sort_order: 'DESC',
  permissions: PERMS.slice(0, 1),
  fields: [
    f('company', 'SAP Company', 'Data', { length: 10, reqd: 1, in_list_view: 1 }),
    f('status', 'Status', 'Select', { options: 'Queued\nIn SAP\nOrdered\nClosed\nFailed', default: 'Queued', read_only: 1, in_list_view: 1 }),
    f('required_by', 'Required By', 'Date', { reqd: 1, in_list_view: 1 }),
    f('reason', 'Reason', 'Small Text', { reqd: 1 }),
    f('col_a', '', 'Column Break'),
    f('raised_by', 'Raised By', 'Link', { options: 'User', read_only: 1 }),
    f('raised_at', 'Raised At', 'Datetime', { read_only: 1 }),
    f('lines_section', 'Items', 'Section Break'),
    f('lines', 'Lines', 'Table', { options: LINE.name, reqd: 1 }),
    f('sap_section', 'SAP', 'Section Break'),
    f('sap_doc_entry', 'SAP DocEntry', 'Int', { read_only: 1 }),
    f('sap_doc_number', 'SAP Purchase Request No.', 'Data', { read_only: 1, in_list_view: 1 }),
    f('po_numbers', 'SAP Purchase Order No(s).', 'Data', { read_only: 1, description: 'POs the purchase manager raised from this request.' }),
    f('col_b', '', 'Column Break'),
    f('posted_at', 'Posted At', 'Datetime', { read_only: 1 }),
    f('error', 'Error', 'Small Text', { read_only: 1 }),
  ],
};

const exists = async (dt, name) => { try { await erp.get(dt, name); return true; } catch (e) { if (/ 404 /.test(e.message)) return false; throw e; } };

(async () => {
  const have = {};
  for (const d of [LINE, REQUEST]) have[d.name] = await exists('DocType', d.name);
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ` + [LINE, REQUEST].map((d) => `${d.name}: ${have[d.name] ? 'present' : 'missing'}`).join(' | '));
  if (!APPLY) return;
  for (const d of [LINE, REQUEST]) {
    if (have[d.name]) continue;
    await erp.insert('DocType', d);
    console.log('doctype created:', d.name);
  }
  // The other roles as Custom DocPerm rows (a non-Administrator cannot put them on a custom DocType);
  // System Manager too - once any Custom DocPerm exists, Frappe uses only those.
  const held = new Set((await erp.list('Custom DocPerm', { fields: ['role'], filters: [['parent', '=', REQUEST.name], ['permlevel', '=', 0]] })).map((x) => x.role));
  for (const perm of PERMS) {
    if (held.has(perm.role)) continue;
    await erp.insert('Custom DocPerm', { parent: REQUEST.name, parenttype: 'DocType', parentfield: 'permissions', permlevel: 0, ...perm });
    console.log(`${REQUEST.name}: granted ${perm.role}`);
  }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
