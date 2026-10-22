// ERPNext schema for an item billed in a different unit from the one it is stocked in (added 22 Oct 2026):
// flex billed in KGS and stocked in MTR, bolts billed in KGS and stocked in NOS. Idempotent.
//   node setup-bill-unit.js            dry run
//   node setup-bill-unit.js --apply
//
// Item.custom_bill_uom: the unit the supplier bills in, from the company's SAP unit list; empty = billed in the
//   item's own unit (every item until now). CMMS only - the item keeps one unit in SAP (Manual UoM group); each
//   goods receipt line carries the bill's quantity and the ratio to the stock unit (tested in the demo company
//   HITECH_RUBBER, 22 Oct 2026).
// CMMS Item Naming Request.bill_uom: the same, chosen when the item is added; the sync copies it onto the Item it
//   creates (PASS A).
// CMMS Goods Receipt Line.bill_qty / bill_uom: the quantity on the bill in the item's bill unit. `qty` stays the
//   quantity received in the stock unit; the sync posts the GRPO line in the bill unit with the ratio qty / bill_qty
//   (PASS C).
const erp = require('./erp.js');
const APPLY = process.argv.includes('--apply');

const ITEM = 'Item';
const NAMING = 'CMMS Item Naming Request';
const LINE = 'CMMS Goods Receipt Line';

const ITEM_FIELDS = [
  { fieldname: 'custom_bill_uom', label: 'Bill Unit (if not the stock unit)', fieldtype: 'Data', length: 20, insert_after: 'stock_uom', description: 'The unit the supplier bills in when it is not the stock unit, e.g. KGS for flex stocked in MTR. Empty: billed in the stock unit. Goods receipts then ask for the bill quantity as well.' },
];
const NAMING_FIELDS = [
  { fieldname: 'bill_uom', label: 'Bill Unit (if not the stock unit)', fieldtype: 'Data', length: 20, insert_after: 'sap_uom', description: 'Copied onto the Item when the sync creates it.' },
];
// CMMS Goods Receipt Line is a custom DocType (setup-goods-receipt.js): fields go on the DocType itself.
const LINE_FIELDS = [
  { fieldname: 'bill_qty', label: 'Qty on Bill', fieldtype: 'Float', description: 'Quantity on the supplier bill in the bill unit, for an item billed in another unit. Qty is what was received in the stock unit.' },
  { fieldname: 'bill_uom', label: 'Bill Unit', fieldtype: 'Data', length: 20, description: "The item's bill unit when the receipt was entered; empty = billed in the stock unit." },
];

(async () => {
  for (const [dt, fields] of [[ITEM, ITEM_FIELDS], [NAMING, NAMING_FIELDS]]) {
    const have = new Set((await erp.list('Custom Field', { fields: ['fieldname'], filters: [['dt', '=', dt]] })).map((x) => x.fieldname));
    for (const x of fields) {
      const present = have.has(x.fieldname);
      console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${dt}.${x.fieldname}: ${present ? 'present' : 'missing'}`);
      if (APPLY && !present) { await erp.insert('Custom Field', { dt, ...x }); console.log(`${dt} field created:`, x.fieldname); }
    }
  }

  const line = await erp.get('DocType', LINE);
  const lineMissing = LINE_FIELDS.filter((x) => !line.fields.some((y) => y.fieldname === x.fieldname));
  for (const x of LINE_FIELDS) console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${LINE}.${x.fieldname}: ${lineMissing.includes(x) ? 'missing' : 'present'}`);
  if (APPLY && lineMissing.length) {
    // At the end, as setup-goods-receipt.js adds control fields: existing rows keep their idx.
    line.fields.push(...lineMissing);
    await erp.update('DocType', LINE, { fields: line.fields });
    console.log(`${LINE} fields added:`, lineMissing.map((x) => x.fieldname).join(', '));
  }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
