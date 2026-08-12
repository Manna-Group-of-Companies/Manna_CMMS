import StockMovement from "../models/StockMovement.js";

/**
 * Append one entry to the stock movement ledger.
 *
 * Call this *after* `product.save()` so `product.quantity` is the balance the
 * movement resulted in. Ledger writes must never break the operation that
 * triggered them, so failures are logged rather than thrown.
 */
export const recordMovement = async ({
  product,
  type,
  direction,
  quantity,
  reference = "",
  performedBy = null,
  note = "",
}) => {
  try {
    await StockMovement.create({
      product: product._id,
      productName: product.name,
      productCode: product.code || "",
      type,
      direction,
      quantity,
      balanceAfter: product.quantity,
      reference,
      performedBy,
      note,
    });
  } catch (error) {
    console.error("Failed to record stock movement:", error.message);
  }
};
