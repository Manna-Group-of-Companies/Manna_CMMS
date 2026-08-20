/**
 * What "low stock" means on screen.
 *
 * Whether an item *is* low is decided on the server — `quantity <= minStock`,
 * behind `stockStatus=low` — so the catalog filter, the dashboard count and the
 * Low Stock page never disagree on the size of the list. What is left is how
 * urgent each shortfall reads, and that is here rather than in either page, so
 * the dashboard panel and the full report speak the same three words.
 */

/**
 * How urgent one shortfall is.
 *
 * Three bands rather than a number: an empty shelf stops work today, half a
 * minimum gives a few days, and anything else is a reorder to plan. [rank] is
 * what the Low Stock page sorts on by default, so the empty shelves sit at the
 * top of the list without the Admin sorting anything.
 */
export const severityOf = (product) => {
  const min = Number(product?.minStock) || 0;
  const qty = Number(product?.quantity) || 0;

  if (qty <= 0) return { key: "out", rank: 3, label: "Out of Stock", badge: "badge-rose" };
  // An item with no minimum set cannot be "half of" anything, so it stays a
  // plain warning rather than reading as critical off a divide-by-zero.
  const ratio = min > 0 ? qty / min : 1;
  if (ratio <= 0.5) return { key: "critical", rank: 2, label: "Critical", badge: "badge-orange" };
  return { key: "warning", rank: 1, label: "Warning", badge: "badge-amber" };
};

/** How many units bring the shelf back up to its minimum. */
export const shortageOf = (product) =>
  Math.max(0, (Number(product?.minStock) || 0) - (Number(product?.quantity) || 0));

/** What refilling to the minimum costs, at the unit cost held on the item. */
export const reorderCostOf = (product) => shortageOf(product) * (Number(product?.unitCost) || 0);
