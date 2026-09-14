import StockMovement from "../models/StockMovement.js";
import { enqueueMovement } from "../integrations/erpnext/outbox.js";

/**
 * Append one entry to the stock movement ledger.
 *
 * Call this *after* `product.save()` so `product.quantity` is the balance the
 * movement resulted in. Ledger writes must never break the operation that
 * triggered them, so failures are logged rather than thrown.
 *
 * [rooms] is an optional `[{ room, quantity }]` breakdown, for a movement that
 * drew on several rooms at once — an issue is filled from whichever rooms hold
 * the stock. The ledger row records the total, as it always has; the
 * breakdown is passed to ERPNext so each warehouse is debited by what actually
 * came out of it, rather than the whole quantity being taken from one.
 */
export const recordMovement = async ({
  product,
  type,
  direction,
  quantity,
  reference = "",
  performedBy = null,
  note = "",
  fromRoom = "",
  toRoom = "",
  rooms = [],
}) => {
  try {
    const movement = await StockMovement.create({
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
      fromRoom,
      toRoom,
    });

    // Queued, not posted. ERPNext is reached by a background worker, so a slow
    // or unreachable Frappe cannot hold up the tablet that triggered this.
    // Wrapped separately from the ledger write above: a movement that is
    // recorded but not queued is recoverable, one that is neither is not.
    try {
      await enqueueMovement({ movement, product, rooms });
    } catch (error) {
      console.error("Failed to queue movement for ERPNext:", error.message);
    }

    return movement;
  } catch (error) {
    console.error("Failed to record stock movement:", error.message);
    return null;
  }
};
