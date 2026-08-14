import mongoose from "mongoose";

/**
 * One returned batch sitting in the Red Stock Room.
 *
 * A supervisor's return needs no approval: it lands here as "In Red Stock"
 * immediately. It never touches a store room on its own — the
 * weekly merge picks it up, and only an approved merge moves the quantity into
 * the store room the Admin chooses.
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
      enum: ["In Red Stock", "Weekly Merge Pending", "Moved to Stock Room"],
      default: "In Red Stock",
    },
    // The issuance this stock came back from. Null for a return that came in
    // as a stock return request rather than against an issue.
    sourceIssue: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "IssueHistory",
      default: null,
    },
    // Where the stock was issued from, snapshotted at return time so the Red
    // Stock list can show its origin even after the product moves rooms.
    sourceRoom: {
      type: String,
      default: "",
      trim: true,
    },
    // Set while the item is part of an open weekly merge, and kept afterwards
    // as the record of the merge that moved it.
    mergeRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MergeRequest",
      default: null,
    },
    // The store room an approved merge moved this quantity into.
    destinationRoom: {
      type: String,
      default: "",
      trim: true,
    },
    mergedAt: {
      type: Date,
      default: null,
    },
    // A rejected merge leaves the stock in Red Stock, so the rejection is
    // recorded beside the item rather than as its status.
    lastRejection: {
      reason: { type: String, default: "", trim: true },
      requestId: { type: String, default: "", trim: true },
      at: { type: Date, default: null },
    },
  },
  {
    timestamps: true,
  }
);

/** Red Stock a weekly merge is allowed to pick up. */
restockItemSchema.statics.MERGEABLE_STATUSES = ["In Red Stock"];

const RestockItem = mongoose.model("RestockItem", restockItemSchema);
export default RestockItem;
