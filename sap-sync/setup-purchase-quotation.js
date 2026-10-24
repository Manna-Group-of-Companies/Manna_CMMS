// ERPNext schema for the quotation step of engineering purchases (24 Oct 2026). Idempotent; only adds.
//   node setup-purchase-quotation.js            dry run
//   node setup-purchase-quotation.js --apply
//
// The purchase manager enters the chosen vendor's quotation against a purchase request already in SAP, prints
// it for management's signature, and makes the PO from it once it is in SAP - one PO per quotation. The PO is
// no longer made on the request (its po_* fields stay as the record of POs made that way before).
//
//   CMMS Purchase Quotation (+ Line)  PQ-YYYY-#####. Lines in the vendor's unit, from SAP's unit list.
//                                     status Queued -> Posted, or Failed; Cancelled when cancelled in SAP.
//   CMMS Purchase Order (+ Line)      PO-YYYY-#####, named by the CMMS server: one above the last PO number
//                                     used, which includes the stamps of POs once made on a request, so a
//                                     new PO never shares a SAP Reference2 with an old one.
//                                     status Open -> Purchased, or Closed (from SAP); sync_status Queued ->
//                                     Posted, or Failed - kept apart, so a PO is Open while SAP has not got it.
//   CMMS Purchase Request Line        coverage (blank = open, Quoted, Dropped), quotation, drop_reason.
//   CMMS Goods Receipt (+ Line)       received against a CMMS PO (24 Oct 2026, phase 4): the PO, and per line the
//                                     PO line, the vendor's unit, the billed qty, the bill price and the quoted
//                                     price. qty / uom / rate stay the received qty, the inventory unit and the
//                                     cost per inventory unit, as on a receipt against an old PO.
//
// Posting quotations and these POs to SAP is a later pass of the sync, behind its own switches.
const erp = require('./erp.js');
const APPLY = process.argv.includes('--apply');
const PR_LINE = 'CMMS Purchase Request Line';

const f = (fieldname, label, fieldtype, extra = {}) => ({ fieldname, label, fieldtype, ...extra });
// The HSN a quotation line brings for an item that has none (24 Oct 2026): SAP needs one on a line with a GST tax code.
const HSN_FIELD = () => f('hsn_code', 'HSN Code', 'Data', { length: 20, description: "Given on the quotation when the item has none; written onto the item too." });
// The SAP PO line a PO line became: a goods receipt is based on it. Lines can come back from SAP in another order.
const SAP_LINE_FIELD = () => f('sap_line', 'SAP PO Line', 'Int', { read_only: 1, description: 'LineNum on the SAP Purchase Order, written by the sync.' });
const PERMS = [
  { role: 'System Manager', read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1, share: 1 },
  { role: 'Store Purchase Manager', read: 1, write: 1, create: 1, report: 1, export: 1 },
  { role: 'Store Manager', read: 1, report: 1, export: 1 },
  { role: 'Store Maintenance Manager', read: 1, report: 1, export: 1 },
  { role: 'VP Operations', read: 1, report: 1, export: 1 },
];

const QUOTE_LINE = {
  doctype: 'DocType', name: 'CMMS Purchase Quotation Line', module: 'Custom', custom: 1, istable: 1, editable_grid: 1,
  fields: [
    f('pr_line', 'Purchase Request Line', 'Data', { read_only: 1, description: 'The row name of the request line it quotes.' }),
    f('item', 'Item', 'Link', { options: 'Item', reqd: 1, in_list_view: 1 }),
    f('item_name', 'Item Name', 'Data', { in_list_view: 1, read_only: 1 }),
    f('sap_item_code', 'SAP Item Code', 'Data', { read_only: 1 }),
    f('request_qty', 'Requested Qty', 'Float', { read_only: 1, description: 'On the purchase request, in the inventory unit.' }),
    f('inventory_uom', 'Inventory Unit', 'Data', { read_only: 1 }),
    f('vendor_uom', 'Vendor Unit', 'Data', { reqd: 1, in_list_view: 1, description: "From SAP's unit list for the company." }),
    f('vendor_qty', 'Qty (vendor unit)', 'Float', { reqd: 1, in_list_view: 1 }),
    f('price', 'Unit Price (vendor unit)', 'Currency', { reqd: 1, in_list_view: 1 }),
    f('tax_code', 'SAP Tax Code', 'Data', { length: 20, reqd: 1 }),
    HSN_FIELD(),
  ],
};

const QUOTE = {
  doctype: 'DocType', name: 'CMMS Purchase Quotation', module: 'Custom', custom: 1, istable: 0, track_changes: 1,
  naming_rule: 'Expression', autoname: 'format:PQ-{YYYY}-{#####}', sort_field: 'creation', sort_order: 'DESC',
  permissions: PERMS.slice(0, 1),
  fields: [
    f('purchase_request', 'Purchase Request', 'Link', { options: 'CMMS Purchase Request', reqd: 1, in_list_view: 1 }),
    f('company', 'SAP Company', 'Data', { length: 10, reqd: 1, in_list_view: 1 }),
    f('status', 'Status', 'Select', { options: 'Queued\nPosted\nFailed\nCancelled', default: 'Queued', read_only: 1, in_list_view: 1 }),
    f('vendor_code', 'Vendor Code', 'Data', { reqd: 1 }),
    f('vendor_name', 'Vendor', 'Data', { in_list_view: 1 }),
    f('col_a', '', 'Column Break'),
    f('quotation_date', 'Quotation Date', 'Date', { reqd: 1 }),
    f('valid_until', 'Valid Until', 'Date', { reqd: 1 }),
    f('remarks', 'Remarks', 'Small Text'),
    f('raised_by', 'Entered By', 'Link', { options: 'User', read_only: 1 }),
    f('raised_at', 'Entered At', 'Datetime', { read_only: 1 }),
    // Data, not a Link: the PO doctype is created after this one, and links back to it.
    f('purchase_order', 'Purchase Order', 'Data', { read_only: 1, in_list_view: 1, description: 'The CMMS PO made from it. One quotation makes one PO.' }),
    f('lines_section', 'Items', 'Section Break'),
    f('lines', 'Lines', 'Table', { options: QUOTE_LINE.name, reqd: 1 }),
    f('sap_section', 'SAP', 'Section Break'),
    f('sap_doc_entry', 'SAP DocEntry', 'Int', { read_only: 1 }),
    f('sap_doc_number', 'SAP Quotation No.', 'Data', { read_only: 1, in_list_view: 1 }),
    f('col_b', '', 'Column Break'),
    f('posted_at', 'Posted At', 'Datetime', { read_only: 1 }),
    f('error', 'Error', 'Small Text', { read_only: 1 }),
  ],
};

const ORDER_LINE = {
  doctype: 'DocType', name: 'CMMS Purchase Order Line', module: 'Custom', custom: 1, istable: 1, editable_grid: 1,
  fields: [
    f('quotation_line', 'Quotation Line', 'Data', { read_only: 1 }),
    f('pr_line', 'Purchase Request Line', 'Data', { read_only: 1 }),
    f('item', 'Item', 'Link', { options: 'Item', reqd: 1, in_list_view: 1 }),
    f('item_name', 'Item Name', 'Data', { in_list_view: 1, read_only: 1 }),
    f('sap_item_code', 'SAP Item Code', 'Data', { read_only: 1 }),
    f('vendor_uom', 'Vendor Unit', 'Data', { read_only: 1, in_list_view: 1 }),
    f('inventory_uom', 'Inventory Unit', 'Data', { read_only: 1 }),
    f('qty', 'Qty (vendor unit)', 'Float', { reqd: 1, in_list_view: 1 }),
    f('price', 'Unit Price (vendor unit)', 'Currency', { read_only: 1, in_list_view: 1, description: 'As quoted.' }),
    f('tax_code', 'SAP Tax Code', 'Data', { length: 20, read_only: 1 }),
    f('received_qty', 'Received (vendor unit)', 'Float', { read_only: 1, default: '0', description: 'Goods receipts posted against it.' }),
    SAP_LINE_FIELD(),
  ],
};

const ORDER = {
  doctype: 'DocType', name: 'CMMS Purchase Order', module: 'Custom', custom: 1, istable: 0, track_changes: 1,
  // Named by the CMMS server, not a naming series - see the header.
  naming_rule: 'Set by user', autoname: 'prompt', sort_field: 'creation', sort_order: 'DESC',
  permissions: PERMS.slice(0, 1),
  fields: [
    f('purchase_quotation', 'Purchase Quotation', 'Link', { options: QUOTE.name, reqd: 1, in_list_view: 1 }),
    f('purchase_request', 'Purchase Request', 'Link', { options: 'CMMS Purchase Request', read_only: 1 }),
    f('company', 'SAP Company', 'Data', { length: 10, reqd: 1, in_list_view: 1 }),
    f('status', 'Status', 'Select', { options: 'Open\nPurchased\nClosed', default: 'Open', read_only: 1, in_list_view: 1 }),
    f('sync_status', 'SAP Status', 'Select', { options: 'Queued\nPosted\nFailed', default: 'Queued', read_only: 1, in_list_view: 1 }),
    f('vendor_code', 'Vendor Code', 'Data', { reqd: 1 }),
    f('vendor_name', 'Vendor', 'Data', { in_list_view: 1 }),
    f('col_a', '', 'Column Break'),
    f('po_date', 'PO Date', 'Date', { reqd: 1 }),
    f('delivery_date', 'Delivery Date', 'Date', { reqd: 1 }),
    f('remarks', 'Remarks', 'Small Text'),
    f('quotation_expired', 'Made After the Quotation Expired', 'Check', { read_only: 1 }),
    f('raised_by', 'Made By', 'Link', { options: 'User', read_only: 1 }),
    f('raised_at', 'Made At', 'Datetime', { read_only: 1 }),
    f('lines_section', 'Items', 'Section Break'),
    f('lines', 'Lines', 'Table', { options: ORDER_LINE.name, reqd: 1 }),
    f('sap_section', 'SAP', 'Section Break'),
    f('sap_doc_entry', 'SAP DocEntry', 'Int', { read_only: 1 }),
    f('sap_doc_number', 'SAP PO No.', 'Data', { read_only: 1, in_list_view: 1 }),
    f('col_b', '', 'Column Break'),
    f('posted_at', 'Posted At', 'Datetime', { read_only: 1 }),
    f('error', 'Error', 'Small Text', { read_only: 1 }),
  ],
};

const PR_LINE_FIELDS = [
  f('coverage', 'Quotation Status', 'Select', { options: '\nQuoted\nDropped', read_only: 1, in_list_view: 1, description: 'Blank: still open for a quotation.' }),
  f('quotation', 'Quotation', 'Data', { read_only: 1 }),
  f('drop_reason', 'Why Dropped', 'Data', { length: 140, read_only: 1 }),
];

// The vendor's unit of the latest posted quotation, for the record only - nothing reads it back (decided 24 Oct
// 2026). Written by the sync's quotation pass, beside the same change to the item's PurchaseUnit in SAP.
const ITEM_FIELD = f('custom_purchase_uom', 'Purchase Unit (latest quotation)', 'Data', {
  read_only: 1, insert_after: 'stock_uom', description: "The vendor's unit on the latest quotation posted to SAP. For the record only.",
});

// Fields added after the doctypes above were first created on a site: put on as Custom Fields when missing.
//   hsn_code on a quotation line, and the quotation an HSN request was raised by - a new code typed on a quotation
//   is created in SAP by the sync's PASS H, and the quotation is held until it is, as a goods receipt is.
const LATER_FIELDS = [
  { dt: 'CMMS Purchase Quotation Line', ...HSN_FIELD(), insert_after: 'tax_code' },
  { dt: 'CMMS SAP HSN Request', ...f('purchase_quotation', 'Purchase Quotation', 'Link', { options: 'CMMS Purchase Quotation', in_list_view: 1 }), insert_after: 'goods_receipt' },
  // Phase 4: receiving against a CMMS PO, in the vendor's unit (see the header).
  { dt: 'CMMS Purchase Order Line', ...SAP_LINE_FIELD(), insert_after: 'received_qty' },
  { dt: 'CMMS Goods Receipt', ...f('purchase_order', 'CMMS Purchase Order', 'Link', { options: 'CMMS Purchase Order', read_only: 1, in_list_view: 1, description: 'Set when received against a PO made from a quotation.' }), insert_after: 'sap_po_number' },
  { dt: 'CMMS Goods Receipt Line', ...f('order_line', 'PO Line (CMMS)', 'Data', { read_only: 1, description: 'The row name of the CMMS PO line received.' }), insert_after: 'po_line' },
  { dt: 'CMMS Goods Receipt Line', ...f('vendor_uom', 'Vendor Unit', 'Data', { read_only: 1 }), insert_after: 'order_line' },
  { dt: 'CMMS Goods Receipt Line', ...f('vendor_qty', 'Billed Qty (vendor unit)', 'Float', { read_only: 1 }), insert_after: 'vendor_uom' },
  { dt: 'CMMS Goods Receipt Line', ...f('bill_price', 'Bill Price (vendor unit)', 'Currency', { read_only: 1 }), insert_after: 'vendor_qty' },
  { dt: 'CMMS Goods Receipt Line', ...f('quoted_price', 'Quoted Price (vendor unit)', 'Currency', { read_only: 1, description: 'Copied from the PO line when the receipt was made.' }), insert_after: 'bill_price' },
];

const exists = async (dt, name) => { try { await erp.get(dt, name); return true; } catch (e) { if (/ 404 /.test(e.message)) return false; throw e; } };

(async () => {
  // Children before parents (a Table field names its child), and the quotation before the PO that links to it.
  const doctypes = [QUOTE_LINE, QUOTE, ORDER_LINE, ORDER];
  const have = {};
  for (const d of doctypes) have[d.name] = await exists('DocType', d.name);
  const lineMeta = await erp.get('DocType', PR_LINE);
  const custom = await erp.list('Custom Field', { fields: ['fieldname'], filters: [['dt', '=', PR_LINE]] });
  const present = new Set([...lineMeta.fields, ...custom].map((x) => x.fieldname));
  const missingLine = PR_LINE_FIELDS.filter((x) => !present.has(x.fieldname));
  const itemFieldMissing = !(await erp.list('Custom Field', { fields: ['fieldname'], filters: [['dt', '=', 'Item'], ['fieldname', '=', ITEM_FIELD.fieldname]] })).length;
  const laterMissing = [];
  for (const x of LATER_FIELDS) {
    // A doctype not on the site yet gets the field with its own creation (QUOTE_LINE), or is not this script's.
    const meta = await erp.get('DocType', x.dt).catch(() => null);
    if (!meta) continue;
    const own = await erp.list('Custom Field', { fields: ['fieldname'], filters: [['dt', '=', x.dt], ['fieldname', '=', x.fieldname]] });
    if (!meta.fields.some((y) => y.fieldname === x.fieldname) && !own.length) laterMissing.push(x);
  }

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ` +
    doctypes.map((d) => `${d.name}: ${have[d.name] ? 'present' : 'missing'}`).join(' | ') +
    ` | ${PR_LINE} fields missing: ${missingLine.map((x) => x.fieldname).join(', ') || 'none'}` +
    ` | Item.${ITEM_FIELD.fieldname}: ${itemFieldMissing ? 'missing' : 'present'}` +
    ` | later fields missing: ${laterMissing.map((x) => `${x.dt}.${x.fieldname}`).join(', ') || 'none'}`);
  if (!APPLY) return;

  for (const d of doctypes) {
    if (have[d.name]) continue;
    await erp.insert('DocType', d);
    console.log('doctype created:', d.name);
  }
  // The other roles as Custom DocPerm rows: a non-Administrator cannot put them on a custom DocType.
  // System Manager is listed too - once any Custom DocPerm exists, Frappe uses only those.
  for (const d of [QUOTE, ORDER]) {
    const held = new Set((await erp.list('Custom DocPerm', { fields: ['role'], filters: [['parent', '=', d.name], ['permlevel', '=', 0]] })).map((x) => x.role));
    for (const perm of PERMS) {
      if (held.has(perm.role)) continue;
      await erp.insert('Custom DocPerm', { parent: d.name, parenttype: 'DocType', parentfield: 'permissions', permlevel: 0, ...perm });
      console.log(`${d.name}: granted ${perm.role}`);
    }
  }
  let after = lineMeta.fields[lineMeta.fields.length - 1]?.fieldname;
  for (const x of PR_LINE_FIELDS) {
    if (!present.has(x.fieldname)) {
      await erp.insert('Custom Field', { dt: PR_LINE, ...x, insert_after: after });
      console.log(`${PR_LINE} field created:`, x.fieldname);
    }
    after = x.fieldname;
  }
  if (itemFieldMissing) {
    await erp.insert('Custom Field', { dt: 'Item', ...ITEM_FIELD });
    console.log('Item field created:', ITEM_FIELD.fieldname);
  }
  for (const x of laterMissing) {
    await erp.insert('Custom Field', x);
    console.log(`${x.dt} field created:`, x.fieldname);
  }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
