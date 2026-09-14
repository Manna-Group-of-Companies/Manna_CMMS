import { erpPostingParts } from "./time.js";

/**
 * Turning the CMMS's current balances into ERPNext Stock Reconciliations.
 *
 * Pure: no database, no network. The runnable cutover lives in
 * `scripts/syncOpeningStock.js`.
 *
 * A Stock Reconciliation sets an absolute quantity rather than adding to one,
 * which has two consequences worth stating plainly. It makes the cutover
 * re-runnable — a second run writes the same numbers — and it makes running it
 * *after* the sync is live destructive, because it would flatten whatever the
 * worker has posted since. The script guards that; this file only builds.
 */

/**
 * ERPNext's account for a balance that has no history behind it.
 *
 * "Opening Stock" is the honest purpose here: these quantities are not a
 * correction of an ERPNext figure, they are the first figure ERPNext has ever
 * had. The alternative purpose, "Stock Reconciliation", writes the difference
 * to Stock Adjustment and reads in the accounts as though stock had been found
 * or lost.
 */
export const OPENING_PURPOSE = "Opening Stock";

/**
 * How many item rows go into one document.
 *
 * A reconciliation carrying several thousand rows runs the whole valuation
 * chain in a single request, and Frappe Cloud times it out well before it
 * finishes. Batching keeps each document inside a request, and means a failure
 * costs one batch rather than the entire cutover.
 */
export const DEFAULT_BATCH_SIZE = 100;

/**
 * ERPNext wants the date and the time of day as separate fields, in its own
 * timezone. Posting in UTC dated a cutover run in the small hours to the
 * previous day.
 */
const postingParts = (at) => erpPostingParts(at instanceof Date ? at : new Date(at || Date.now()));

/**
 * Groups balances by warehouse, then splits each warehouse into batches.
 *
 * Grouped by warehouse rather than simply chunked, so that a batch which fails
 * names one store rather than an arbitrary slice of several. It also keeps the
 * documents legible to whoever opens them in ERPNext afterwards.
 *
 * @param balances  [{ itemCode, warehouse, qty, valuationRate }]
 * @returns [{ warehouse, rows }]
 */
export const batchByWarehouse = (balances, batchSize = DEFAULT_BATCH_SIZE) => {
  const size = Math.max(1, Number(batchSize) || DEFAULT_BATCH_SIZE);
  const byWarehouse = new Map();

  for (const balance of balances) {
    const warehouse = String(balance.warehouse || "").trim();
    const qty = Number(balance.qty || 0);
    const itemCode = String(balance.itemCode || "").trim();

    // A zero balance is not worth a row. ERPNext treats an item it has never
    // seen as zero already, and reconciling to zero on thousands of them would
    // make the cutover enormous for no change at all.
    if (!warehouse || !itemCode || qty <= 0) continue;

    if (!byWarehouse.has(warehouse)) byWarehouse.set(warehouse, []);
    byWarehouse.get(warehouse).push({ itemCode, qty, valuationRate: Number(balance.valuationRate || 0) });
  }

  const batches = [];
  for (const [warehouse, rows] of [...byWarehouse].sort((a, b) => a[0].localeCompare(b[0]))) {
    rows.sort((a, b) => a.itemCode.localeCompare(b.itemCode));
    for (let i = 0; i < rows.length; i += size) {
      batches.push({ warehouse, rows: rows.slice(i, i + size) });
    }
  }
  return batches;
};

/**
 * Builds one Stock Reconciliation document from a batch.
 */
export const buildReconciliation = ({
  warehouse,
  rows,
  company,
  expenseAccount,
  postedAt,
  note = "",
}) => ({
  doctype: "Stock Reconciliation",
  purpose: OPENING_PURPOSE,
  company,
  expense_account: expenseAccount,
  ...postingParts(postedAt),
  // Without this ERPNext stamps the moment the request landed, and a cutover
  // run over several minutes would scatter its batches across that window.
  set_posting_time: 1,
  remarks: [`CMMS opening stock: ${warehouse}`, note].filter(Boolean).join(" - ").slice(0, 500),
  items: rows.map((row) => ({
    doctype: "Stock Reconciliation Item",
    item_code: row.itemCode,
    warehouse,
    qty: row.qty,
    ...(row.valuationRate > 0
      ? { valuation_rate: row.valuationRate }
      : // Most of the catalog has never been costed, and ERPNext refuses to
        // open a balance it cannot value unless told that is expected.
        { valuation_rate: 0, allow_zero_valuation_rate: 1 }),
  })),
  // Inserted and submitted together. A draft reconciliation moves nothing and
  // would still look, from this side, like a completed cutover.
  docstatus: 1,
});

/** Every document the cutover will submit, in order. */
export const planOpeningStock = ({
  balances,
  company,
  expenseAccount,
  postedAt,
  batchSize = DEFAULT_BATCH_SIZE,
}) => {
  const batches = batchByWarehouse(balances, batchSize);

  return batches.map((batch, index) => {
    const forWarehouse = batches.filter((b) => b.warehouse === batch.warehouse);
    const part = forWarehouse.indexOf(batch) + 1;

    return {
      warehouse: batch.warehouse,
      rowCount: batch.rows.length,
      index,
      payload: buildReconciliation({
        ...batch,
        company,
        expenseAccount,
        postedAt,
        note: forWarehouse.length > 1 ? `part ${part} of ${forWarehouse.length}` : "",
      }),
    };
  });
};
