// The tax code comes off the bill, on the goods receipt (27 Oct 2026). Idempotent.
//   node setup-tax-on-receipt.js            dry run
//   node setup-tax-on-receipt.js --apply
//
// Quotations and POs carry no tax code or HSN any more: the goods receipt is the one document that asks for them -
// the tax code on every line, the HSN and tax rate only for an item that has none. SAP takes a request, quotation
// and PO without either (tested in HITECH_RUBBER the same day) and asks for the HSN only on a GRPO line with a GST
// tax code. So:
//
//   CMMS Purchase Quotation Line.tax_code   no longer mandatory (setup-purchase-quotation.js made it reqd)
//   CMMS Goods Receipt Line.tax_code        described as the bill's, not the PO line's
//
// The doctypes are custom (made through the API), so the field is changed on the DocType itself, as the desk does.
// Point it at the local copy with CMMS_ENV (see erp.js).
const erp = require('./erp.js');
const APPLY = process.argv.includes('--apply');

const CHANGES = [
  { dt: 'CMMS Purchase Quotation Line', fieldname: 'tax_code', set: { reqd: 0, description: 'Not asked since 27 Oct 2026: the goods receipt takes the tax code off the bill.' } },
  { dt: 'CMMS Goods Receipt Line', fieldname: 'tax_code', set: { description: "From the bill, typed on the receipt (27 Oct 2026); before then, the PO line's." } },
];

(async () => {
  const todo = [];
  for (const c of CHANGES) {
    const meta = await erp.get('DocType', c.dt).catch(() => null);
    if (!meta) { console.log(`${c.dt}: not on this site - skipped`); continue; }
    const field = meta.fields.find((x) => x.fieldname === c.fieldname);
    if (!field) { console.log(`${c.dt}.${c.fieldname}: no such field - skipped`); continue; }
    const diff = Object.entries(c.set).filter(([k, v]) => String(field[k] ?? '') !== String(v));
    console.log(`${c.dt}.${c.fieldname}: ${diff.length ? diff.map(([k, v]) => `${k} ${JSON.stringify(field[k] ?? '')} -> ${JSON.stringify(v)}`).join(', ') : 'already right'}`);
    if (diff.length) todo.push({ c, meta });
  }
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${todo.length} doctype(s) to change`);
  if (!APPLY) return;
  for (const { c, meta } of todo) {
    // The whole fields table, as Frappe replaces a child table it is given.
    const fields = meta.fields.map((x) => (x.fieldname === c.fieldname ? { ...x, ...c.set } : x));
    await erp.update('DocType', c.dt, { fields });
    console.log(`${c.dt}.${c.fieldname}: changed`);
  }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
