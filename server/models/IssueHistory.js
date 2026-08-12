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
    returnStatus: {
      type: String,
      enum: ["Not Returned", "Partially Returned", "Returned"],
      default: "Not Returned",
    },
    // How much of `quantity` has been handed back into the Restock section.
    // Returns may be partial, so this is tracked separately from the status.
    returnedQuantity: {
      type: Number,
      default: 0,
      min: [0, "Returned quantity cannot be negative"],
    },
  },
  {
    timestamps: true,
  }
);

const IssueHistory = mongoose.model("IssueHistory", issueHistorySchema);
export default IssueHistory;
