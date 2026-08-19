import mongoose from "mongoose";

/**
 * Red Stock gathered into a single request for the Admin.
 *
 * Two things raise one: the weekly run over everything in Red Stock, and a
 * Supervisor merging the room back without waiting for the week. Weekly merges
 * wait for Admin approval; supervisor merges are approved and moved directly to
 * the main store room. A return itself creates nothing.
 */
const mergeRequestItemSchema = new mongoose.Schema(
  {
    restockItem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RestockItem",
      required: true,
    },
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
    unit: {
      type: String,
      default: "",
      trim: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, "Merge quantity must be at least 1"],
    },
    // Filled in at approval time with the room the Admin chose for this line.
    destinationRoom: {
      type: String,
      default: "",
      trim: true,
    },
    // Guards against a line being credited twice if an approval is retried.
    moved: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const mergeRequestSchema = new mongoose.Schema(
  {
    // Human-facing identifier, e.g. REQ-MERGE-00125
    requestId: {
      type: String,
      required: true,
      unique: true,
    },
    // ISO week this merge covers, e.g. 2026-W33. One merge per week reaches
    // approval; see utils/weeklyMerge.js.
    weekKey: {
      type: String,
      required: true,
      trim: true,
    },
    weekStart: {
      type: Date,
      required: true,
    },
    weekEnd: {
      type: Date,
      required: true,
    },
    items: {
      type: [mergeRequestItemSchema],
      validate: {
        validator: (items) => Array.isArray(items) && items.length > 0,
        message: "A merge request must contain at least one Red Stock item",
      },
    },
    itemCount: {
      type: Number,
      required: true,
      min: 1,
    },
    totalQuantity: {
      type: Number,
      required: true,
      min: 1,
    },
    status: {
      type: String,
      required: true,
      enum: ["Pending Approval", "Approved", "Rejected"],
      default: "Pending Approval",
    },
    // Who set this merge going: the weekly scheduler, an Admin running the
    // week early, or a Supervisor merging the Red Stock Room back.
    // A "Supervisor" merge sits outside the weekly cycle — see
    // utils/weeklyMerge.js.
    createdVia: {
      type: String,
      enum: ["Scheduled", "Manual", "Supervisor"],
      default: "Manual",
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    requestedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    comment: {
      type: String,
      default: "",
      trim: true,
    },
    // The room the Admin sent the whole merge to. Individual lines may be
    // overridden, so `items[].destinationRoom` is the authoritative record.
    destinationRoom: {
      type: String,
      default: "",
      trim: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// A week is only ever looked up together with its status ("is this week's
// merge still open?"), which is the check that keeps merges from duplicating.
mergeRequestSchema.index({ weekKey: 1, status: 1 });

/** Statuses that mean this week has already been merged (or is mid-merge). */
mergeRequestSchema.statics.CLAIMS_WEEK = ["Pending Approval", "Approved"];

const MergeRequest = mongoose.model("MergeRequest", mergeRequestSchema);
export default MergeRequest;
