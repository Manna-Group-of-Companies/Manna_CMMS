import mongoose from "mongoose";

/**
 * A batch of restock items an Admin has proposed moving back into Main Stock.
 *
 * Creating the request does not move any stock — that only happens when the
 * request is approved.
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
      min: [1, "Restock quantity must be at least 1"],
    },
  },
  { _id: false }
);

const mergeRequestSchema = new mongoose.Schema(
  {
    // Human-facing identifier, e.g. MERGE-202608-003
    requestId: {
      type: String,
      required: true,
      unique: true,
    },
    items: {
      type: [mergeRequestItemSchema],
      validate: {
        validator: (items) => Array.isArray(items) && items.length > 0,
        message: "A merge request must contain at least one restock item",
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
      enum: ["Pending Approval", "Merged Successfully", "Merge Rejected"],
      default: "Pending Approval",
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
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

const MergeRequest = mongoose.model("MergeRequest", mergeRequestSchema);
export default MergeRequest;
