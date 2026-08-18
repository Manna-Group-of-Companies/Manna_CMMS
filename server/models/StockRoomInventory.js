import mongoose from "mongoose";

/**
 * How much of one product sits in one room — the authoritative per-room
 * balance.
 *
 * `Product.quantity` is kept as the sum of these rows so the many screens that
 * only care about a single total keep working. Both are written together by
 * `utils/stockRooms.js`; nothing else should touch either directly.
 */
const stockRoomInventorySchema = new mongoose.Schema(
  {
    stockRoom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StockRoom",
      required: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      default: 0,
      min: [0, "Room quantity cannot be negative"],
    },

    /**
     * The month this product was last physically counted on this shelf, as
     * "YYYY-MM", and what that count found.
     *
     * Stamped when an audit is submitted — not when a count is saved, because
     * a figure entered against the wrong line and cleared again was never a
     * count. This is what the quarterly and half-yearly schedule is measured
     * from, so it is per room rather than per product: the same item can be
     * monthly-fresh in Main Stock and six months stale in the Red Stock Room.
     */
    lastCountedPeriod: {
      type: String,
      default: "",
    },
    lastCountedAt: {
      type: Date,
      default: null,
    },
    /** What the shelf held at that count — the baseline reconciliation runs from. */
    lastCountedQuantity: {
      type: Number,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// One row per product per room; the credit/debit helpers rely on this to
// upsert safely under concurrent approvals.
stockRoomInventorySchema.index({ stockRoom: 1, product: 1 }, { unique: true });

const StockRoomInventory = mongoose.model("StockRoomInventory", stockRoomInventorySchema);
export default StockRoomInventory;
