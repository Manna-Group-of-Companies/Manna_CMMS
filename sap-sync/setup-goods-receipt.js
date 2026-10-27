// ERPNext schema for goods receipts, nil-value stock additions and new SAP item groups from the CMMS
// (added 9 Oct 2026, on top of setup-erpnext.js and setup-item-master.js). Idempotent.
//   node setup-goods-receipt.js            dry run
//   node setup-goods-receipt.js --apply
//
// CMMS Goods Receipt (+ CMMS Goods Receipt Line): one record per receipt the Maintenance Manager enters.
//   kind = Goods Receipt   - against an open SAP Purchase Order, from the supplier's bill. The sync posts a
//                            GRPO (PurchaseDeliveryNotes, BaseType 22) and the ERPNext Material Receipt at the
//                            PO price; a nil-valued item is revalued to that price first.
//   kind = Stock Addition  - no bill: SAP Goods Receipt (InventoryGenEntries) at price 0 + ERPNext Material
//                            Receipt at zero value.
//   status Queued -> Posted / Failed, written by the sync on the SAP server.
// CMMS SAP Item Group Request: a new engineering item group, created in SAP by the sync (accounts copied
//   from the company's existing engineering group), then published on the control Single.
// CMMS Item Naming Request: opening_qty - stock on hand at nil value when the item is added.
// SAP Item Category Sync Control: open_po_lines (per company, open PO lines for engineering items, from SAP).
const erp = require('./erp.js');
const APPLY = process.argv.includes('--apply');
const CONTROL = 'SAP Item Category Sync Control';
const NAMING = 'CMMS Item Naming Request';

const f = (fieldname, label, fieldtype, extra = {}) => ({ fieldname, label, fieldtype, ...extra });
const PERMS = [
  { role: 'System Manager', read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1, share: 1 },
  { role: 'Store Manager', read: 1, report: 1, export: 1 },
  { role: 'Store Maintenance Manager', read: 1, write: 1, create: 1, report: 1, export: 1 },
  { role: 'VP Operations', read: 1, report: 1, export: 1 },
];

const LINE = {
  doctype: 'DocType', name: 'CMMS Goods Receipt Line', module: 'Custom', custom: 1, istable: 1, editable_grid: 1,
  fields: [
    f('item', 'Item', 'Link', { options: 'Item', reqd: 1, in_list_view: 1 }),
    f('item_name', 'Item Name', 'Data', { in_list_view: 1, read_only: 1 }),
    f('sap_item_code', 'SAP Item Code', 'Data', { read_only: 1 }),
    f('po_line', 'PO Line', 'Int', { description: 'LineNum on the SAP Purchase Order (Goods Receipt only).' }),
    f('qty', 'Quantity', 'Float', { reqd: 1, in_list_view: 1 }),
    f('rate', 'Rate', 'Currency', { in_list_view: 1, description: 'Price per unit before tax: the PO price, or 0 for a stock addition.' }),
    f('uom', 'Unit', 'Data'),
    f('tax_code', 'SAP Tax Code', 'Data', { description: "From the bill, typed on the receipt (27 Oct 2026); before then, the PO line's." }),
    f('hsn_code', 'HSN Code', 'Data', { length: 20 }),
    f('tax_rate', 'Tax Rate', 'Data', { length: 20 }),
    f('warehouse', 'SAP Warehouse', 'Data', { length: 20 }),
  ],
};

const RECEIPT = {
  doctype: 'DocType', name: 'CMMS Goods Receipt', module: 'Custom', custom: 1, istable: 0, track_changes: 1,
  naming_rule: 'Expression', autoname: 'format:GR-{YYYY}-{#####}', sort_field: 'creation', sort_order: 'DESC',
  permissions: PERMS.slice(0, 1),
  fields: [
    f('kind', 'Kind', 'Select', { options: 'Goods Receipt\nStock Addition', reqd: 1, in_list_view: 1 }),
    f('company', 'SAP Company', 'Data', { length: 10, reqd: 1, in_list_view: 1, description: 'ERPNext company abbreviation = SAP item code prefix (MRPPL, MT, HRI, MTR).' }),
    f('status', 'Status', 'Select', { options: 'Queued\nPosted\nFailed', default: 'Queued', read_only: 1, in_list_view: 1 }),
    f('col_a', '', 'Column Break'),
    f('raised_by', 'Raised By', 'Link', { options: 'User', read_only: 1 }),
    f('raised_at', 'Raised At', 'Datetime', { read_only: 1 }),
    f('naming_request', 'From New Item', 'Link', { options: NAMING, read_only: 1, description: 'Set when this is the opening stock of an item added in the CMMS.' }),
    f('bill_section', 'Bill and Purchase Order', 'Section Break'),
    f('sap_po_entry', 'SAP PO DocEntry', 'Int', { read_only: 1 }),
    f('sap_po_number', 'SAP PO Number', 'Data', { in_list_view: 1 }),
    f('vendor_code', 'Vendor Code', 'Data'),
    f('vendor_name', 'Vendor', 'Data'),
    f('col_b', '', 'Column Break'),
    f('bill_no', 'Bill No.', 'Data', { length: 100 }),
    f('bill_date', 'Bill Date', 'Date'),
    f('remarks', 'Remarks', 'Small Text'),
    f('lines_section', 'Items', 'Section Break'),
    f('lines', 'Lines', 'Table', { options: LINE.name, reqd: 1 }),
    f('sap_section', 'Posting', 'Section Break'),
    f('sap_doc_entry', 'SAP DocEntry', 'Int', { read_only: 1 }),
    f('sap_doc_number', 'SAP Document No.', 'Data', { read_only: 1, description: 'GRPO number (Goods Receipt) or Goods Receipt number (Stock Addition).' }),
    f('sap_revaluation', 'SAP Revaluation', 'Data', { read_only: 1, description: 'Inventory revaluation posted first when the item was at nil value.' }),
    f('col_c', '', 'Column Break'),
    f('erp_stock_entry', 'ERPNext Stock Entry', 'Data', { read_only: 1 }),
    f('erp_reconciliation', 'ERPNext Revaluation', 'Data', { read_only: 1 }),
    f('posted_at', 'Posted At', 'Datetime', { read_only: 1 }),
    f('error', 'Error', 'Small Text', { read_only: 1 }),
  ],
};

const GROUP = {
  doctype: 'DocType', name: 'CMMS SAP Item Group Request', module: 'Custom', custom: 1, istable: 0, track_changes: 1,
  naming_rule: 'Expression', autoname: 'format:IGR-{YYYY}-{####}', sort_field: 'creation', sort_order: 'DESC',
  permissions: PERMS.slice(0, 1),
  fields: [
    f('company', 'SAP Company', 'Data', { length: 10, reqd: 1, in_list_view: 1 }),
    f('group_name', 'Item Group Name', 'Data', { length: 20, reqd: 1, in_list_view: 1, description: 'SAP OITB.ItmsGrpNam is 20 characters.' }),
    f('code_prefix', 'Item Code Prefix', 'Data', { length: 10, description: 'ENG- / EL- ...; empty = SAP automatic numbering.' }),
    f('template_group_code', 'Copy Settings From (SAP group no.)', 'Int', { description: 'The engineering group whose accounts and settings are copied.' }),
    f('status', 'Status', 'Select', { options: 'Queued\nCreated\nFailed', default: 'Queued', read_only: 1, in_list_view: 1 }),
    f('sap_group_code', 'SAP Group No.', 'Int', { read_only: 1, in_list_view: 1 }),
    f('error', 'Error', 'Small Text', { read_only: 1 }),
    f('raised_by', 'Raised By', 'Link', { options: 'User', read_only: 1 }),
    f('raised_at', 'Raised At', 'Datetime', { read_only: 1 }),
  ],
};

const NAMING_FIELDS = [
  { fieldname: 'opening_qty', label: 'Opening Quantity (nil value)', fieldtype: 'Float', insert_after: 'min_stock', description: 'Stock already on the shelf with no bill: received at zero value once the item exists in SAP.' },
];

const exists = async (dt, name) => { try { await erp.get(dt, name); return true; } catch (e) { if (/ 404 /.test(e.message)) return false; throw e; } };

(async () => {
  const have = {};
  for (const d of [LINE, RECEIPT, GROUP]) have[d.name] = await exists('DocType', d.name);
  const namingHave = new Set((await erp.list('Custom Field', { fields: ['fieldname'], filters: [['dt', '=', NAMING]] })).map((x) => x.fieldname));
  const missingNaming = NAMING_FIELDS.filter((x) => !namingHave.has(x.fieldname));
  const dt = await erp.get('DocType', CONTROL);
  const controlMissing = [
    { fieldname: 'open_po_lines', label: 'Open PO Lines (per company, from SAP)', fieldtype: 'Code', options: 'JSON', read_only: 1 },
    { fieldname: 'open_po_refreshed_at', label: 'Open PO Lines Refreshed At', fieldtype: 'Datetime', read_only: 1 },
  ].filter((x) => !dt.fields.some((y) => y.fieldname === x.fieldname));

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ` +
    [LINE, RECEIPT, GROUP].map((d) => `${d.name}: ${have[d.name] ? 'present' : 'missing'}`).join(' | ') +
    ` | ${NAMING} fields missing: ${missingNaming.map((x) => x.fieldname).join(', ') || 'none'}` +
    ` | control fields missing: ${controlMissing.map((x) => x.fieldname).join(', ') || 'none'}`);
  if (!APPLY) return;

  // The child table first: the parent's Table field links to it.
  for (const d of [LINE, RECEIPT, GROUP]) {
    if (have[d.name]) continue;
    await erp.insert('DocType', d);
    console.log('doctype created:', d.name);
  }
  // The other roles as Custom DocPerm rows: a non-Administrator cannot put them on a custom DocType.
  // System Manager is listed too - once any Custom DocPerm exists, Frappe uses only those.
  for (const d of [RECEIPT, GROUP]) {
    const held = new Set((await erp.list('Custom DocPerm', { fields: ['role'], filters: [['parent', '=', d.name], ['permlevel', '=', 0]] })).map((x) => x.role));
    for (const perm of PERMS) {
      if (held.has(perm.role)) continue;
      await erp.insert('Custom DocPerm', { parent: d.name, parenttype: 'DocType', parentfield: 'permissions', permlevel: 0, ...perm });
      console.log(`${d.name}: granted ${perm.role}`);
    }
  }
  for (const x of missingNaming) { await erp.insert('Custom Field', { dt: NAMING, ...x }); console.log(`${NAMING} field created:`, x.fieldname); }
  if (controlMissing.length) {
    dt.fields.push(...controlMissing);
    await erp.update('DocType', CONTROL, { fields: dt.fields });
    console.log('control fields added:', controlMissing.map((x) => x.fieldname).join(', '));
  }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
