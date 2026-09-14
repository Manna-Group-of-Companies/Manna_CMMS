import ErpSyncOutbox from "../../models/ErpSyncOutbox.js";
import { erpEnabled } from "./config.js";
import { buildStockEntry } from "./stockEntry.js";
import { erpCompanyName, warehouseMap } from "./warehouses.js";

/**
 * Putting a movement on the queue.
 *
 * Called from `recordMovement`, so it sits on the request path — which is why
 * it is written to be cheap and, above all, to never throw. A ledger write
 * must not be able to fail an issue that has already moved stock, and neither
 * must this: the queue is a copy of what happened, not the record of it.
 */

/**
 * Queues one movement for ERPNext.
 *
 * The payload is built now rather than when the job runs. A movement describes
 * a moment — which rooms the stock came out of, what the product was called —
 * and rebuilding it hours later, after a room was reassigned or a product
 * renamed, would post something that never happened.
 *
 * A movement the mapping deliberately has no document for is still recorded,
 * as "Skipped" with the reason. Silence would be indistinguishable from a bug.
 */
export const enqueueMovement = async ({ movement, product, rooms = [] }) => {
  if (!erpEnabled()) return null;

  try {
    const [warehouses, company] = await Promise.all([
      warehouseMap(),
      erpCompanyName(),
    ]);

    if (!company) {
      return ErpSyncOutbox.create({
        entity: "StockMovement",
        entityId: movement._id,
        doctype: "Stock Entry",
        payload: {},
        status: "Skipped",
        lastError: "no company carries an ERPNext mapping yet",
      });
    }

    const built = buildStockEntry({
      movement: {
        type: movement.type,
        direction: movement.direction,
        quantity: movement.quantity,
        productCode: movement.productCode,
        fromRoom: movement.fromRoom,
        toRoom: movement.toRoom,
        reference: movement.reference,
        note: movement.note,
        createdAt: movement.createdAt,
        // Where the product lives when the call site named no room.
        homeRoom: product?.storeRoom || "",
      },
      rooms,
      unitCost: Number(product?.unitCost || 0),
      company,
      warehouseFor: (room) => warehouses.get(room) || "",
    });

    if (built.skip) {
      return ErpSyncOutbox.create({
        entity: "StockMovement",
        entityId: movement._id,
        doctype: "Stock Entry",
        payload: {},
        status: "Skipped",
        lastError: built.reason,
      });
    }

    return await ErpSyncOutbox.create({
      entity: "StockMovement",
      entityId: movement._id,
      doctype: built.doctype,
      payload: built.payload,
      status: "Pending",
    });
  } catch (error) {
    // Includes the duplicate-key case: the movement is already queued, which
    // is exactly what the unique index is there to guarantee.
    if (error?.code === 11000) return null;

    console.error("Failed to queue movement for ERPNext:", error.message);
    return null;
  }
};
