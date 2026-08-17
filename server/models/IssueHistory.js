import mongoose from "mongoose";

const issueHistorySchema = new mongoose.Schema(
  {
    issueNumber: {
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
    recipient: {
      type: String,
      required: [true, "Recipient is required"],
      trim: true,
    },
    purpose: {
      type: String,
      trim: true,
      default: "",
    },
    supervisor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Which room(s) the stock was drawn from, so a later return can show where
    // it originally came from.
    sourceRoom: {
      type: String,
      default: "",
      trim: true,
    },
    returnStatus: {
      type: String,
      enum: ["Not Returned", "Partially Returned", "Returned"],
      default: "Not Returned",
    },
    // How much of `quantity` has been handed back into the Red Stock Room.
    // Returns may be partial, so this is tracked separately from the status.
    returnedQuantity: {
      type: Number,
      default: 0,
      min: [0, "Returned quantity cannot be negative"],
    },
    // An issued batch settles in three ways, not one: it comes back, it gets
    // used up, or it is thrown away (ST-19). Each is tracked on its own
    // counter, because an issue can end in a mix of all three and the totals
    // have to keep adding up to `quantity`.
    //
    // Neither of these touches a store room. The stock left Main Stock when it
    // was issued; consuming or scrapping it only closes out what is still
    // outstanding with the recipient.
    consumedQuantity: {
      type: Number,
      default: 0,
      min: [0, "Consumed quantity cannot be negative"],
    },
    scrappedQuantity: {
      type: Number,
      default: 0,
      min: [0, "Scrapped quantity cannot be negative"],
    },
  },
  {
    timestamps: true,
  }
);

/**
 * How much of the issue is accounted for — returned, consumed or scrapped.
 *
 * Documents written before those last two counters existed have neither field,
 * so both are coalesced to 0 rather than trusted to be present.
 */
issueHistorySchema.virtual("settledQuantity").get(function settled() {
  return (
    (this.returnedQuantity || 0) +
    (this.consumedQuantity || 0) +
    (this.scrappedQuantity || 0)
  );
});

/** What is still out with the recipient, and so still actionable. */
issueHistorySchema.virtual("outstanding").get(function outstanding() {
  return Math.max(0, this.quantity - this.settledQuantity);
});

/**
 * Matches issues with stock still out. Expressed as `$expr` rather than a
 * plain field test because it compares three fields against a fourth, and
 * `$ifNull` covers the pre-existing rows that predate the new counters.
 */
issueHistorySchema.statics.OUTSTANDING_FILTER = {
  $expr: {
    $gt: [
      "$quantity",
      {
        $add: [
          { $ifNull: ["$returnedQuantity", 0] },
          { $ifNull: ["$consumedQuantity", 0] },
          { $ifNull: ["$scrappedQuantity", 0] },
        ],
      },
    ],
  },
};

// The virtuals are read off `.toObject()` output in the issue list responses.
issueHistorySchema.set("toObject", { virtuals: true });
issueHistorySchema.set("toJSON", { virtuals: true });

const IssueHistory = mongoose.model("IssueHistory", issueHistorySchema);
export default IssueHistory;
