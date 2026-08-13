import mongoose from "mongoose";

/**
 * A supervisor's request for more stock of a product (`REQ-IN-######`).
 *
 * Approving one credits a single stock room — the one the Admin picks at
 * approval time, which may differ from the room the supervisor asked for.
 * The approval/rejection audit trail is kept on the request itself so the
 * supervisor's Requests tab can show who decided, when, and where the stock
 * landed.
 */
const stockInRequestSchema = new mongoose.Schema(
  {
    requestNumber: {
      type: String,
      required: true,
      unique: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, "Quantity must be at least 1"],
    },
    // Where the supervisor would like it stored. Advisory — the Admin picks
    // the room that is actually credited.
    requestedStockRoom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StockRoom",
      default: null,
    },
    // The product's total at the moment the request was raised, kept so the
    // Admin can see what the supervisor was looking at.
    stockAtRequest: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      required: true,
      enum: ["Pending", "Approved", "Rejected", "Cancelled"],
      default: "Pending",
    },
    adminComments: {
      type: String,
      default: "",
    },
    supervisor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // ── Decision audit ──────────────────────────────────────────────────────
    /** May be less than `quantity` if the Admin approved a partial amount. */
    approvedQuantity: {
      type: Number,
      default: null,
    },
    /** The room actually credited. Set only on approval. */
    stockRoom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StockRoom",
      default: null,
    },
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    rejectedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const StockInRequest = mongoose.model("StockInRequest", stockInRequestSchema);
export default StockInRequest;
