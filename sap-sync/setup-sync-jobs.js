// Adds five Custom Fields to the Single "SAP Item Category Sync Control" that the fast sync (job and
// routine runs, 27 Oct 2026) relies on, and turns off history for the control (fix 4, same date).
// Idempotent.
//   node setup-sync-jobs.js            dry run
//   node setup-sync-jobs.js --apply
//
// The sync and the watcher both carry on if the fields are missing: the watcher treats a missing field
// as empty and skips writing it with a warning in its log, so this script can be deferred - but then
// the CMMS cannot see "SAP sync offline since 10:42" or ask for a vendor refresh, and the routine run
// cannot report when it finished.
//
//   watcher_seen_at           Datetime    heartbeat the watcher writes at least every 60 s
//   watcher_version           Data        a short version string, e.g. "cmms-watch 2026-10-27"
//   routine_last_at           Datetime    when the last routine run finished
//   routine_last_result       Small Text  its one-line summary
//   vendor_refresh_requested  Small Text  JSON array of company abbreviations the CMMS wants
//                                         refreshed in the next job run, e.g. ["HRI"]. The sync
//                                         removes an abbreviation once that company is refreshed.
//
// track_changes on the control (fix 4): the DocType was created with track_changes = 1, so every PUT
// that changes it saves a Version row. The watcher writes watcher_seen_at every 60 s, plus a claim and
// a result per run, which adds up to 1,500+ Version rows a day on Frappe Cloud for ever. This script
// sets track_changes to 0. Existing Version rows (683 at writing) are LEFT ALONE: the user decides
// whether to delete them.
const erp = require('./erp.js');
const APPLY = process.argv.includes('--apply');
const CONTROL = 'SAP Item Category Sync Control';

const FIELDS = [
  { fieldname: 'watcher_seen_at', label: 'Watcher Seen At', fieldtype: 'Datetime', insert_after: 'last_sync_at', read_only: 1,
    description: 'Written by the SAP server\'s watcher at least every 60 s. If it is older than that, the sync is offline.' },
  { fieldname: 'watcher_version', label: 'Watcher Version', fieldtype: 'Data', length: 40, insert_after: 'watcher_seen_at', read_only: 1,
    description: 'Short version string the watcher reports, e.g. "cmms-watch 2026-10-27".' },
  { fieldname: 'routine_last_at', label: 'Routine Last At', fieldtype: 'Datetime', insert_after: 'watcher_version', read_only: 1,
    description: 'When the last routine run (3x a day: SAP->CMMS fetch, open PO lines, options refresh) finished.' },
  { fieldname: 'routine_last_result', label: 'Routine Last Result', fieldtype: 'Small Text', insert_after: 'routine_last_at', read_only: 1 },
  { fieldname: 'vendor_refresh_requested', label: 'Vendor Refresh Requested', fieldtype: 'Small Text', insert_after: 'routine_last_result',
    description: 'JSON array of company abbreviations (e.g. ["HRI"]) that need suppliers and tax codes refreshed in the next job run. The sync removes an abbreviation once refreshed.' },
];

(async () => {
  // The control must already be present (setup-erpnext.js); if not, there is nothing to add fields to.
  let dt;
  try { dt = await erp.get('DocType', CONTROL); }
  catch (e) { console.error(`ERROR: ${CONTROL} is not present yet. Run setup-erpnext.js --apply first.`); process.exit(1); }

  const have = new Set((await erp.list('Custom Field', { fields: ['fieldname'], filters: [['dt', '=', CONTROL]] })).map(f => f.fieldname));
  const missing = FIELDS.filter(f => !have.has(f.fieldname));
  const trackChangesNow = Number(dt.track_changes || 0);
  const trackChangesChange = trackChangesNow === 1;
  const versionCount = (await erp.list('Version', { fields: ['name'], filters: [['ref_doctype', '=', CONTROL]] })).length;

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${CONTROL}`);
  console.log(`  fields missing      : ${missing.map(f => f.fieldname).join(', ') || 'none'}`);
  console.log(`  track_changes       : ${trackChangesNow}${trackChangesChange ? ' -> would set to 0' : ' (no change)'}`);
  console.log(`  existing Version rows: ${versionCount} (LEFT ALONE - delete only on the user's say-so)`);
  if (!APPLY) return;

  for (const f of missing) {
    await erp.insert('Custom Field', { dt: CONTROL, ...f });
    console.log(`${CONTROL} field created: ${f.fieldname}`);
  }
  if (trackChangesChange) {
    await erp.update('DocType', CONTROL, { track_changes: 0 });
    console.log(`${CONTROL} track_changes set to 0`);
  }
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
