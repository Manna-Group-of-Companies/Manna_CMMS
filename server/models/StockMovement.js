import mongoose from "mongoose";

/**
 * Append-only ledger of everything that moves stock, so the Admin can trace
 * how a product got to its current quantity.
 *
 * `direction` describes the effect on **Main Stock** specifically. A return
 * into the Red Stock Room is direction "NONE": the stock left Main Stock when
 * it was issued and does not come back until a merge is approved.
 */
const stockMovementSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    productName: {
      type: String,
      required: true,
      trim: true,
    },
    productCode: {
      type: String,
      default: "",
      trim: true,
    },
    type: {
      type: String,
      required: true,
      enum: [
        "ISSUE",
        // Into the Red Stock Room. Store room balances are unchanged, so these
        // are direction "NONE".
        "RETURN_TO_RED_STOCK",
        // Pre-Red-Stock name for the same movement, kept so old ledger rows
        // still validate.
        "RETURN_TO_RESTOCK",
        "MERGE_IN",
        "STOCK_IN",
        "STOCK_OUT",
        "STOCK_RETURN",
        "PRODUCT_CREATED",
        "PRODUCT_EDITED",
        // Stock moved between rooms. Main Stock is unchanged, so these are
        // always direction "NONE".
        "TRANSFER",
      ],
    },
    /** Rooms involved, when the movement was room-specific. */
    fromRoom: {
      type: String,
      default: "",
      trim: true,
    },
    toRoom: {
      type: String,
      default: "",
      trim: true,
    },
    direction: {
      type: String,
      required: true,
      enum: ["IN", "OUT", "NONE"],
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
    },
    /** Main Stock quantity after this movement was applied. */
    balanceAfter: {
      type: Number,
      required: true,
      min: 0,
    },
    /** Issue number, restock number or merge request id this came from. */
    reference: {
      type: String,
      default: "",
      trim: true,
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    note: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

stockMovementSchema.index({ product: 1, createdAt: -1 });

const StockMovement = mongoose.model("StockMovement", stockMovementSchema);
export default StockMovement;
