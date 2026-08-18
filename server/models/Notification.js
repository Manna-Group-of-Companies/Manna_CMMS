import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      // If user is null, it's a general notification for Admins
      required: false,
    },
    message: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      required: true,
      enum: [
        "REQUEST_CREATED",
        "REQUEST_APPROVED",
        "REQUEST_REJECTED",
        "REQUEST_UPDATED",
        "STOCK_RETURNED",
        "LOW_STOCK",
        "MERGE_REQUESTED",
        "MERGE_APPROVED",
        "MERGE_REJECTED",
        "AUDIT_SUBMITTED",
        "AUDIT_REVIEWED",
      ],
    },
    read: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

const Notification = mongoose.model("Notification", notificationSchema);
export default Notification;
