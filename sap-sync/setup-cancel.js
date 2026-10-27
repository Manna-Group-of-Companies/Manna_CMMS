// Cancelling from the CMMS (27 Oct 2026): four Custom Fields on each of the purchase request, the quotation and the PO.
// Idempotent; only adds.
//   node setup-cancel.js            dry run
//   node setup-cancel.js --apply
//
// The purchase manager (and the Admin; for a request also whoever raised it) presses Cancel with a reason. The CMMS
// sets cancel_status = Queued and raises the flag; the sync cancels the document in SAP and sets Done - the document
// itself turns Closed (request, PO) or Cancelled (quotation) - or Failed with SAP's reason, when it can be asked
// again. A document SAP never took (status Failed) is cancelled in the CMMS at once, with nothing to send.
//
//   cancel_status         Data       "" | Queued | Done | Failed
//   cancel_reason         Small Text why, as typed
//   cancel_requested_by   Data       the login that pressed Cancel
//   cancel_requested_at   Datetime
//
// Point it at the local copy with CMMS_ENV (see erp.js).
const erp = require('./erp.js');
const APPLY = process.argv.includes('--apply');

const DOCTYPES = ['CMMS Purchase Request', 'CMMS Purchase Quotation', 'CMMS Purchase Order'];
const FIELDS = [
  { fieldname: 'cancel_status', label: 'Cancel Status', fieldtype: 'Data', length: 10, read_only: 1, in_standard_filter: 1,
    description: 'Queued when cancelled in the CMMS, Done once SAP has cancelled it, Failed with the reason in Error.' },
  { fieldname: 'cancel_reason', label: 'Cancel Reason', fieldtype: 'Small Text', read_only: 1 },
  { fieldname: 'cancel_requested_by', label: 'Cancel Requested By', fieldtype: 'Data', read_only: 1 },
  { fieldname: 'cancel_requested_at', label: 'Cancel Requested At', fieldtype: 'Datetime', read_only: 1 },
];

(async () => {
  const todo = [];
  for (const dt of DOCTYPES) {
    const meta = await erp.get('DocType', dt).catch(() => null);
    if (!meta) { console.log(`${dt}: not on this site - skipped (run setup-purchase-request.js / setup-purchase-quotation.js first)`); continue; }
    const own = new Set((await erp.list('Custom Field', { fields: ['fieldname'], filters: [['dt', '=', dt]] })).map((f) => f.fieldname));
    const present = new Set([...meta.fields.map((f) => f.fieldname), ...own]);
    const missing = FIELDS.filter((f) => !present.has(f.fieldname));
    console.log(`${dt}: ${missing.length ? `missing ${missing.map((f) => f.fieldname).join(', ')}` : 'all present'}`);
    // After error, each after the last, so they sit together on the form.
    let after = present.has('error') ? 'error' : meta.fields[meta.fields.length - 1]?.fieldname;
    for (const f of FIELDS) {
      if (!present.has(f.fieldname)) todo.push({ dt, ...f, insert_after: after });
      after = f.fieldname;
    }
  }
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${todo.length} field(s) to add`);
  if (!APPLY) return;
  for (const f of todo) {
    await erp.insert('Custom Field', f);
    console.log(`${f.dt} field created: ${f.fieldname}`);
  }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
