import mongoose from "mongoose";

/**
 * An issued or returned batch that will never come back to stock — either
 * used up (Consumed) or discarded as unusable (Scrapped).
 *
 * One collection carries both logs rather than two near-identical ones: the
 * spec asks for a consumption log and a scrap log separately (ST-25, ST-26),
 * but every report over them — scrap value per item, per store room, per
 * period (ST-27) — reads far more simply off a single series filtered by
 * `type`.
 *
 * Nothing here is ever deleted or rewritten (ST-28). `unitCost` is snapshotted
 * at disposal time on purpose: the product's cost is the *current* purchase
 * price and moves over time, so reading it live would silently restate the
 * scrap value of past periods every time somebody re-costs a product.
 */
const stockDisposalSchema = new mongoose.Schema(
  {
    disposalNumber: {
      type: String,
      required: true,
      unique: true,
    },
    type: {
      type: String,
      required: true,
      enum: ["Consumed", "Scrapped"],
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    // Snapshots, so the log still reads correctly once a product is renamed,
    // re-coded or deleted.
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
    unit: {
      type: String,
      default: "",
      trim: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, "Disposed quantity must be at least 1"],
    },
    /** Per-unit cost as it stood when this was disposed of. */
    unitCost: {
      type: Number,
      default: 0,
      min: [0, "Unit cost cannot be negative"],
    },
    /**
     * quantity × unitCost, stored rather than derived.
     *
     * This is the scrap value metric of ST-27 when `type` is "Scrapped". It is
     * computed once in the pre-validate hook below so no caller can write a
     * total that disagrees with its own operands.
     */
    value: {
      type: Number,
      default: 0,
      min: [0, "Value cannot be negative"],
    },
    /**
     * Where the stock belonged before it was issued, so scrap value can be
     * reported per store room (ST-27) long after the product moves rooms.
     */
    storeRoom: {
      type: String,
      default: "",
      trim: true,
    },
    /**
     * Which stage it was disposed from, per the lifecycle in section 9:
     * ISSUED → CONSUMED / SCRAPPED, or RED RACK → SCRAPPED.
     */
    source: {
      type: String,
      required: true,
      enum: ["Issue", "Red Stock"],
    },
    sourceIssue: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "IssueHistory",
      default: null,
    },
    sourceRestockItem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RestockItem",
      default: null,
    },
    /** Issue number or restock number this was booked against. */
    reference: {
      type: String,
      default: "",
      trim: true,
    },
    /** Who the stock had been issued to, snapshotted for the consumption log. */
    department: {
      type: String,
      default: "",
      trim: true,
    },
    reason: {
      type: String,
      default: "",
      trim: true,
    },
    disposedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    disposedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Keep the stored total honest. Runs on create and on any later save.
stockDisposalSchema.pre("validate", function computeValue() {
  const cost = Number(this.unitCost) || 0;
  const qty = Number(this.quantity) || 0;
  this.value = Math.round(cost * qty * 100) / 100;
});

// The scrap report groups by period, room and product; the log lists newest
// first. Both are covered by these two.
stockDisposalSchema.index({ type: 1, disposedAt: -1 });
stockDisposalSchema.index({ product: 1, disposedAt: -1 });

const StockDisposal = mongoose.model("StockDisposal", stockDisposalSchema);
export default StockDisposal;
