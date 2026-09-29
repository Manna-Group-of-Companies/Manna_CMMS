// ERPNext schema for the SAP item-category mirror and its flagged sync (BRIEFING §5 recipe).
//   node setup-erpnext.js            dry run - lists what is missing
//   node setup-erpnext.js --apply    creates what is missing (idempotent)
//
// Item custom fields (mirror SAP 1:1, see README):
//   custom_sap_item_group        SAP item group name (level 1 in the CMMS)
//   custom_sap_sub_type_a        SAP U_SubTypeA        (level 2)
//   custom_sap_sub_type_b        SAP U_SubTypeB        (level 3)
//   custom_sap_category_pending  set by the CMMS when a level is edited; cleared by the sync once SAP holds it
//   custom_sap_category_synced_at, custom_sap_category_error   written by the sync
// Single "SAP Item Category Sync Control": the flag the CMMS raises and the watcher on the SAP server reads.
const erp = require('./erp.js');
const APPLY = process.argv.includes('--apply');

const CONTROL = 'SAP Item Category Sync Control';
const FIELDS = [
  { fieldname: 'custom_sap_category_section', label: 'SAP Category', fieldtype: 'Section Break', insert_after: 'custom_sap_item_code', collapsible: 1 },
  { fieldname: 'custom_sap_item_group', label: 'SAP Item Group', fieldtype: 'Data', length: 100, insert_after: 'custom_sap_category_section', description: 'Level 1 of the CMMS category. Mirrors the SAP item group of this item\'s SAP company.' },
  { fieldname: 'custom_sap_sub_type_a', label: 'SAP Sub Type A', fieldtype: 'Data', length: 50, insert_after: 'custom_sap_item_group', description: 'Level 2. Mirrors SAP U_SubTypeA.' },
  { fieldname: 'custom_sap_sub_type_b', label: 'SAP Sub Type B', fieldtype: 'Data', length: 50, insert_after: 'custom_sap_sub_type_a', description: 'Level 3. Mirrors SAP U_SubTypeB.' },
  { fieldname: 'custom_sap_category_col', fieldtype: 'Column Break', insert_after: 'custom_sap_sub_type_b' },
  { fieldname: 'custom_sap_category_pending', label: 'SAP Category Change Pending', fieldtype: 'Check', default: '0', insert_after: 'custom_sap_category_col', description: 'Set when the category is edited in the CMMS; cleared once SAP has it.' },
  { fieldname: 'custom_sap_category_synced_at', label: 'SAP Category Synced At', fieldtype: 'Datetime', read_only: 1, insert_after: 'custom_sap_category_pending' },
  { fieldname: 'custom_sap_category_error', label: 'SAP Category Sync Error', fieldtype: 'Small Text', read_only: 1, insert_after: 'custom_sap_category_synced_at' },
];

const DOCTYPE = {
  doctype: 'DocType', name: CONTROL, module: 'Stock', custom: 1, issingle: 1, track_changes: 1,
  description: 'Flag + status for the CMMS -> SAP item category sync (ItemsGroupCode, U_SubTypeA, U_SubTypeB). Raised by the CMMS server, run by Invoke-FlagWatch.ps1 on the SAP server.',
  fields: [
    { fieldname: 'status', label: 'Status', fieldtype: 'Select', options: 'Idle\nQueued\nRunning\nSuccess\nFailed', default: 'Idle', read_only: 1 },
    { fieldname: 'sync_requested', label: 'Sync Requested', fieldtype: 'Check', default: '0' },
    { fieldname: 'sync_requested_by', label: 'Sync Requested By', fieldtype: 'Data', read_only: 1 },
    { fieldname: 'sync_requested_at', label: 'Sync Requested At', fieldtype: 'Datetime', read_only: 1 },
    { fieldname: 'dry_run', label: 'Dry Run (read SAP, write nothing)', fieldtype: 'Check', default: '1' },
    { fieldname: 'cooldown_minutes', label: 'Cooldown Minutes', fieldtype: 'Int', default: '2' },
    { fieldname: 'col_break_1', fieldtype: 'Column Break' },
    { fieldname: 'cooldown_until', label: 'Cooldown Until', fieldtype: 'Datetime', read_only: 1 },
    { fieldname: 'last_run_started_at', label: 'Last Run Started At', fieldtype: 'Datetime', read_only: 1 },
    { fieldname: 'last_sync_at', label: 'Last Sync At', fieldtype: 'Datetime', read_only: 1 },
    { fieldname: 'last_rows_changed', label: 'Last Rows Changed', fieldtype: 'Int', read_only: 1 },
    { fieldname: 'last_result_message', label: 'Last Result Message', fieldtype: 'Small Text', read_only: 1 },
  ],
  permissions: [
    { role: 'System Manager', read: 1, write: 1, create: 1 },
    { role: 'SAP Sync Bot', read: 1, write: 1 },
  ],
};

(async () => {
  const have = new Set((await erp.list('Custom Field', { fields: ['fieldname'], filters: [['dt', '=', 'Item']] })).map(f => f.fieldname));
  const missing = FIELDS.filter(f => !have.has(f.fieldname));
  const roles = new Set((await erp.list('Role', { fields: ['name'] })).map(r => r.name));
  const dt = (await erp.list('DocType', { fields: ['name'], filters: [['name', '=', CONTROL]] })).length > 0;
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: Item custom fields missing: ${missing.map(f => f.fieldname).join(', ') || 'none'} | ${CONTROL}: ${dt ? 'exists' : 'missing'} | role SAP Sync Bot: ${roles.has('SAP Sync Bot') ? 'exists' : 'MISSING'}`);
  if (!APPLY) return;
  for (const f of missing) {
    await erp.insert('Custom Field', { dt: 'Item', ...f });
    console.log('custom field created:', f.fieldname);
  }
  if (!dt) {
    if (!roles.has('SAP Sync Bot')) DOCTYPE.permissions = DOCTYPE.permissions.filter(p => p.role !== 'SAP Sync Bot');
    await erp.insert('DocType', DOCTYPE);
    console.log('doctype created:', CONTROL);
    await erp.update(CONTROL, CONTROL, { status: 'Idle', sync_requested: 0, dry_run: 1, cooldown_minutes: 2 });
    console.log('control record saved: status Idle, dry_run 1, cooldown 2 min');
  }
  const check = (await erp.list('Custom Field', { fields: ['fieldname'], filters: [['dt', '=', 'Item'], ['fieldname', 'in', FIELDS.map(f => f.fieldname)]] })).map(f => f.fieldname);
  console.log('verified Item fields present:', check.length, 'of', FIELDS.length);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
