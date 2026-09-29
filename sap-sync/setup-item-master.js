// ERPNext schema for creating / editing engineering items in SAP from the CMMS (added 25 Sep 2026,
// on top of setup-erpnext.js). Idempotent.
//   node setup-item-master.js            dry run
//   node setup-item-master.js --apply
//
// Item (mirror of more SAP item master fields; edits go to SAP through the same flagged sync):
//   custom_sap_foreign_name  -> ForeignName      custom_sap_hsn_code -> ChapterID (via that company's IndiaHsn)
//   custom_sap_tax_rate      -> U_TaxRate        (item_name -> ItemName, safety_stock -> MinInventory)
//   custom_sap_category_pending is relabelled "SAP Change Pending" - it now covers every mirrored field.
// CMMS Item Naming Request (what the Maintenance Manager fills in; the sync creates the SAP item from it):
//   sap_company, sap_item_group, sap_sub_type_a, sap_sub_type_b, foreign_name, hsn_code, tax_rate, sap_uom,
//   sap_create_status (Queued / Created / Failed), sap_create_error
// SAP Item Category Sync Control: item_master_options (per company: units, HSN codes, tax rates, code rules).
const erp = require('./erp.js');
const APPLY = process.argv.includes('--apply');
const CONTROL = 'SAP Item Category Sync Control';
const NAMING = 'CMMS Item Naming Request';

const ITEM_FIELDS = [
  { fieldname: 'custom_sap_foreign_name', label: 'SAP Foreign Name', fieldtype: 'Data', length: 100, insert_after: 'custom_sap_sub_type_b', description: 'Mirrors SAP ForeignName.' },
  { fieldname: 'custom_sap_hsn_code', label: 'SAP HSN Code', fieldtype: 'Data', length: 20, insert_after: 'custom_sap_foreign_name', description: 'HSN code as digits (e.g. 84819090). Mirrors SAP ChapterID via that company\'s HSN list.' },
  { fieldname: 'custom_sap_tax_rate', label: 'SAP Tax Rate', fieldtype: 'Data', length: 20, insert_after: 'custom_sap_hsn_code', description: 'Mirrors SAP U_TaxRate (e.g. 18%).' },
];
const RELABEL = { custom_sap_category_pending: 'SAP Change Pending', custom_sap_category_section: 'SAP Item Master', custom_sap_category_synced_at: 'SAP Synced At', custom_sap_category_error: 'SAP Sync Error' };

const NAMING_FIELDS = [
  { fieldname: 'sap_section', label: 'SAP Item Master', fieldtype: 'Section Break', insert_after: 'plant' },
  { fieldname: 'sap_company', label: 'SAP Company', fieldtype: 'Data', length: 10, insert_after: 'sap_section', description: 'ERPNext company abbreviation = SAP item code prefix (MRPPL, MT, HRI, MTR).' },
  { fieldname: 'sap_item_group', label: 'SAP Item Group', fieldtype: 'Data', length: 100, insert_after: 'sap_company' },
  { fieldname: 'sap_sub_type_a', label: 'SAP Sub Type A', fieldtype: 'Data', length: 50, insert_after: 'sap_item_group' },
  { fieldname: 'sap_sub_type_b', label: 'SAP Sub Type B', fieldtype: 'Data', length: 50, insert_after: 'sap_sub_type_a' },
  { fieldname: 'sap_col', fieldtype: 'Column Break', insert_after: 'sap_sub_type_b' },
  { fieldname: 'foreign_name', label: 'Foreign Name', fieldtype: 'Data', length: 100, insert_after: 'sap_col' },
  { fieldname: 'sap_uom', label: 'SAP Unit', fieldtype: 'Data', length: 20, insert_after: 'foreign_name', description: 'Inventory = purchasing = sales unit in SAP (e.g. NOS).' },
  { fieldname: 'hsn_code', label: 'HSN Code', fieldtype: 'Data', length: 20, insert_after: 'sap_uom' },
  { fieldname: 'tax_rate', label: 'Tax Rate', fieldtype: 'Data', length: 20, insert_after: 'hsn_code' },
  { fieldname: 'sap_create_status', label: 'SAP Creation', fieldtype: 'Select', options: '\nQueued\nCreated\nFailed', insert_after: 'tax_rate', read_only: 1, description: 'Queued when approved; the SAP server creates the item and sets Created (or Failed).' },
  { fieldname: 'sap_create_error', label: 'SAP Creation Error', fieldtype: 'Small Text', insert_after: 'sap_create_status', read_only: 1 },
];

(async () => {
  const itemHave = new Map((await erp.list('Custom Field', { fields: ['name', 'fieldname', 'label'], filters: [['dt', '=', 'Item']] })).map(f => [f.fieldname, f]));
  const namingHave = new Set((await erp.list('Custom Field', { fields: ['fieldname'], filters: [['dt', '=', NAMING]] })).map(f => f.fieldname));
  const dt = await erp.get('DocType', CONTROL);
  const missingItem = ITEM_FIELDS.filter(f => !itemHave.has(f.fieldname));
  const relabel = Object.entries(RELABEL).filter(([f, l]) => itemHave.get(f) && itemHave.get(f).label !== l);
  const missingNaming = NAMING_FIELDS.filter(f => !namingHave.has(f.fieldname));
  const needOptions = !dt.fields.some(f => f.fieldname === 'item_master_options');
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: Item fields missing: ${missingItem.map(f => f.fieldname).join(', ') || 'none'} | relabel: ${relabel.map(([f]) => f).join(', ') || 'none'} | ${NAMING} fields missing: ${missingNaming.map(f => f.fieldname).join(', ') || 'none'} | control item_master_options: ${needOptions ? 'missing' : 'present'}`);
  if (!APPLY) return;
  for (const f of missingItem) { await erp.insert('Custom Field', { dt: 'Item', ...f }); console.log('Item field created:', f.fieldname); }
  for (const [f, label] of relabel) { await erp.update('Custom Field', itemHave.get(f).name, { label }); console.log('relabelled:', f, '->', label); }
  for (const f of missingNaming) { await erp.insert('Custom Field', { dt: NAMING, ...f }); console.log(`${NAMING} field created:`, f.fieldname); }
  if (needOptions) {
    dt.fields.push({ fieldname: 'item_master_options', label: 'Item Master Options (per company, from SAP)', fieldtype: 'Code', options: 'JSON', read_only: 1 });
    await erp.update('DocType', CONTROL, {
      fields: dt.fields,
      description: 'Flag + status for the CMMS -> SAP item master sync: creates approved engineering items in SAP and pushes edits (item group, SubType A/B, description, foreign name, HSN, tax rate, min stock). Raised by the CMMS server, run by Invoke-FlagWatch.ps1 on the SAP server.',
    });
    console.log('control doctype: item_master_options added');
  }
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
