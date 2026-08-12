import mongoose from "mongoose";

/**
 * One returned batch sitting in the Restock section.
 *
 * Returned stock never goes straight back to Main Stock: it lands here as
 * "Restock Pending" and only reaches the product's quantity once an Admin
 * approves a merge request that includes it.
 */
const restockItemSchema = new mongoose.Schema(
  {
    restockNumber: {
      type: String,
      required: true,
      unique: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    // Snapshot so the restock list still reads correctly if the product is
    // renamed or deleted later.
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
      min: [1, "Returned quantity must be at least 1"],
    },
    reason: {
      type: String,
      required: [true, "Return reason is required"],
      trim: true,
    },
    condition: {
      type: String,
      required: true,
      enum: ["Good", "Damaged", "Repairable", "Expired"],
      default: "Good",
    },
    // Who handed the stock back, and which department it came back from.
    returnedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    department: {
      type: String,
      required: [true, "Returning department is required"],
      trim: true,
    },
    returnDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    status: {
      type: String,
      required: true,
      enum: ["Restock Pending", "Merge Requested", "Merged", "Merge Rejected"],
      default: "Restock Pending",
    },
    // The issuance this stock came back from.
    sourceIssue: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "IssueHistory",
      required: true,
    },
    // Set while the item is part of an open or decided merge request.
    mergeRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MergeRequest",
      default: null,
    },
    rejectionReason: {
      type: String,
      default: "",
      trim: true,
    },
    mergedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

/** Items an Admin is allowed to pull into a new merge request. */
restockItemSchema.statics.MERGEABLE_STATUSES = ["Restock Pending", "Merge Rejected"];

const RestockItem = mongoose.model("RestockItem", restockItemSchema);
export default RestockItem;
