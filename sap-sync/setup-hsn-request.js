// ERPNext schema for new HSN codes typed on a CMMS goods receipt (added 20 Oct 2026, on top of
// setup-goods-receipt.js). Idempotent.
//   node setup-hsn-request.js            dry run
//   node setup-hsn-request.js --apply
//
// CMMS SAP HSN Request: one record per HSN code the Maintenance Manager types on a goods receipt line for an
//   item that has no HSN, when that code is not yet in the company's SAP HSN list (item_master_options.hsn).
//   The sync (PASS H, create_hsn) creates it in SAP's IndiaHsn master - or adopts it if SAP already has it -
//   before the item edit (PASS B) puts it on the item and the receipt (PASS C) posts the GRPO. A receipt whose
//   HSN request is not Created yet stays Queued.
//   status Queued -> Created / Failed, written by the sync on the SAP server.
const erp = require('./erp.js');
const APPLY = process.argv.includes('--apply');

const f = (fieldname, label, fieldtype, extra = {}) => ({ fieldname, label, fieldtype, ...extra });
const PERMS = [
  { role: 'System Manager', read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1, share: 1 },
  { role: 'Store Manager', read: 1, report: 1, export: 1 },
  { role: 'Store Maintenance Manager', read: 1, write: 1, create: 1, report: 1, export: 1 },
  { role: 'VP Operations', read: 1, report: 1, export: 1 },
];

const HSN = {
  doctype: 'DocType', name: 'CMMS SAP HSN Request', module: 'Custom', custom: 1, istable: 0, track_changes: 1,
  naming_rule: 'Expression', autoname: 'format:HSN-{YYYY}-{####}', sort_field: 'creation', sort_order: 'DESC',
  permissions: PERMS.slice(0, 1),
  fields: [
    f('company', 'SAP Company', 'Data', { length: 10, reqd: 1, in_list_view: 1, description: 'ERPNext company abbreviation = SAP item code prefix (MRPPL, MT, HRI, MTR).' }),
    f('hsn_code', 'HSN Code', 'Data', { length: 20, reqd: 1, in_list_view: 1, description: 'Digits only, 4, 6 or 8 long (e.g. 73181500).' }),
    f('status', 'Status', 'Select', { options: 'Queued\nCreated\nFailed', default: 'Queued', read_only: 1, in_list_view: 1 }),
    f('description', 'Description', 'Data', { length: 100, description: 'Stored on the SAP HSN record. Empty: the sync writes "Added from CMMS goods receipt <receipt>".' }),
    f('col_a', '', 'Column Break'),
    f('goods_receipt', 'Goods Receipt', 'Link', { options: 'CMMS Goods Receipt', in_list_view: 1 }),
    f('item', 'Item', 'Link', { options: 'Item' }),
    f('raised_by', 'Raised By', 'Link', { options: 'User', read_only: 1 }),
    f('raised_at', 'Raised At', 'Datetime', { read_only: 1 }),
    f('sap_section', 'SAP', 'Section Break'),
    f('sap_abs_entry', 'SAP HSN Entry', 'Int', { read_only: 1, description: 'IndiaHsn AbsEntry = the ChapterID SAP items point to.' }),
    f('sap_chapter_id', 'SAP Chapter ID', 'Data', { read_only: 1, description: 'As SAP shows it, e.g. 73.18.1500.' }),
    f('col_b', '', 'Column Break'),
    f('created_at', 'Created In SAP At', 'Datetime', { read_only: 1 }),
    f('error', 'Error', 'Small Text', { read_only: 1 }),
  ],
};

const exists = async (dt, name) => { try { await erp.get(dt, name); return true; } catch (e) { if (/ 404 /.test(e.message)) return false; throw e; } };

(async () => {
  const have = await exists('DocType', HSN.name);
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${HSN.name}: ${have ? 'present' : 'missing'}`);
  if (!APPLY) return;
  if (!have) { await erp.insert('DocType', HSN); console.log('doctype created:', HSN.name); }
  // The other roles as Custom DocPerm rows: a non-Administrator cannot put them on a custom DocType.
  // System Manager is listed too - once any Custom DocPerm exists, Frappe uses only those.
  const held = new Set((await erp.list('Custom DocPerm', { fields: ['role'], filters: [['parent', '=', HSN.name], ['permlevel', '=', 0]] })).map((x) => x.role));
  for (const perm of PERMS) {
    if (held.has(perm.role)) continue;
    await erp.insert('Custom DocPerm', { parent: HSN.name, parenttype: 'DocType', parentfield: 'permissions', permlevel: 0, ...perm });
    console.log(`${HSN.name}: granted ${perm.role}`);
  }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
