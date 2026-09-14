/**
 * Comparing what the CMMS holds against what ERPNext holds.
 *
 * The safety net under everything else. A movement that silently failed to
 * post leaves the two systems disagreeing, and nothing in the normal working
 * day would reveal it: the store reads MongoDB, the accounts read ERPNext, and
 * neither ever looks at the other. Without this, drift surfaces months later
 * when a physical count contradicts the system and nobody can say when it
 * began.
 */

/**
 * Identifies one balance: one product on one shelf.
 *
 * A null byte, because both halves contain spaces and hyphens as a matter of
 * course - warehouses are named "Manna Treads Store - MRPPL" and item codes
 * run to "BONDING GUM (DOMESTIC)". Any printable separator would eventually
 * appear inside a name and split a key in the wrong place.
 */
const keyOf = (warehouse, itemCode) => `${warehouse}\u0000${itemCode}`;

/**
 * Compares two sets of balances, scoped to the warehouses the CMMS owns.
 *
 * That scoping is not a detail. ERPNext holds production stock in the same
 * company: `Stores - MRPPL`, `Work In Progress - MRPPL` and the rest are full
 * of tread rubber and bonding gum this system has never heard of. Comparing
 * against everything would report thousands of differences that are all
 * correct, and the real ones would be lost among them.
 *
 * @param cmms        [{ itemCode, warehouse, qty }]
 * @param erp         [{ itemCode, warehouse, qty }]
 * @param warehouses  the CMMS-owned warehouse names; anything else is ignored
 */
export const compareBalances = ({ cmms = [], erp = [], warehouses = [] }) => {
  const ours = new Set(warehouses);

  /** Sums rows into one balance per product per warehouse. */
  const fold = (rows) => {
    const out = new Map();
    for (const row of rows) {
      const warehouse = String(row.warehouse || "");
      const itemCode = String(row.itemCode || "");
      if (!ours.has(warehouse) || !itemCode) continue;

      const key = keyOf(warehouse, itemCode);
      const existing = out.get(key);
      const qty = Number(row.qty || 0);
      if (existing) existing.qty += qty;
      else out.set(key, { itemCode, warehouse, qty });
    }
    return out;
  };

  const mine = fold(cmms);
  const theirs = fold(erp);

  const differences = [];
  const missingInErp = [];
  const missingInCmms = [];
  let matched = 0;

  for (const [key, row] of mine) {
    const other = theirs.get(key);

    if (!other) {
      // ERPNext keeps no Bin for an item it has never held, so "no row" and
      // "zero" are the same statement. Only a non-zero CMMS balance is a gap.
      if (row.qty !== 0) {
        missingInErp.push({ itemCode: row.itemCode, warehouse: row.warehouse, cmmsQty: row.qty });
      } else {
        matched += 1;
      }
      continue;
    }

    if (other.qty === row.qty) {
      matched += 1;
    } else {
      differences.push({
        itemCode: row.itemCode,
        warehouse: row.warehouse,
        cmmsQty: row.qty,
        erpQty: other.qty,
        delta: other.qty - row.qty,
      });
    }
  }

  for (const [key, row] of theirs) {
    if (mine.has(key)) continue;
    // The same reasoning in reverse: a zero Bin is not stock the CMMS lost.
    if (row.qty !== 0) {
      missingInCmms.push({ itemCode: row.itemCode, warehouse: row.warehouse, erpQty: row.qty });
    }
  }

  // Largest disagreement first: that is the one worth looking at, and a report
  // truncated for display should keep it rather than an alphabetical accident.
  differences.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  missingInErp.sort((a, b) => b.cmmsQty - a.cmmsQty);
  missingInCmms.sort((a, b) => b.erpQty - a.erpQty);

  return {
    matched,
    compared: mine.size,
    differences,
    missingInErp,
    missingInCmms,
    // One number for "is anything wrong", so a caller does not have to add up
    // three lists to find out.
    driftCount: differences.length + missingInErp.length + missingInCmms.length,
  };
};

/**
 * Turns a comparison into a line worth logging.
 *
 * `pending` matters more than it looks. A movement sitting in the outbox has
 * legitimately not reached ERPNext yet, so drift alongside a non-empty queue
 * is expected rather than alarming, and saying so is what stops the nightly
 * report from crying wolf every time it happens to run mid-sync.
 */
export const summarise = (report, { pending = 0, failed = 0 } = {}) => {
  if (report.driftCount === 0) {
    return `ERPNext drift check: ${report.compared} balance(s) compared, all matching.`;
  }

  const parts = [
    `${report.differences.length} differing`,
    `${report.missingInErp.length} missing in ERPNext`,
    `${report.missingInCmms.length} unknown to the CMMS`,
  ];

  const queued = pending > 0 ? ` (${pending} movement(s) still queued, so some of this is expected)` : "";
  const broken = failed > 0 ? ` ${failed} sync job(s) have failed outright.` : "";

  return `ERPNext drift check: ${report.driftCount} of ${report.compared} balance(s) disagree - ${parts.join(", ")}${queued}.${broken}`;
};
