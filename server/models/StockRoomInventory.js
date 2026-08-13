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
