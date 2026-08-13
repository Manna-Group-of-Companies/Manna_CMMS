import mongoose from "mongoose";

/**
 * A request raised by a Branch engineer for stock held in their own room.
 *
 * Unlike the Supervisor request types, this one is decided twice: the Admin
 * reviews it first, and only after that does it reach the Supervisor for the
 * final say. `status` therefore names the stage it is waiting on rather than a
 * simple pending/decided pair:
 *
 *   Pending Admin  →  Pending Supervisor  →  Approved
 *          ↘ Rejected            ↘ Rejected
 *
 * Every decision is appended to `history`, so all three portals can show the
 * full trail rather than just the current state.
 */

/** Waiting on the Admin — the first stage. */
const PENDING_ADMIN = "Pending Admin";
/** Admin approved; waiting on the Supervisor — the second stage. */
const PENDING_SUPERVISOR = "Pending Supervisor";

const decisionSchema = new mongoose.Schema(
  {
    stage: {
      type: String,
      required: true,
      enum: ["Submitted", "Admin", "Supervisor", "Branch"],
    },
    action: {
      type: String,
      required: true,
      enum: ["Submitted", "Approved", "Rejected", "Cancelled"],
    },
    by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    // Name and role are snapshotted so the trail still reads correctly if the
    // account is renamed or removed later.
    byName: { type: String, default: "" },
    byRole: { type: String, default: "" },
    comment: { type: String, default: "" },
    quantity: { type: Number, default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const branchRequestSchema = new mongoose.Schema(
  {
    requestNumber: {
      type: String,
      required: true,
      unique: true,
    },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // The room the request draws from — always the branch's own room, taken
    // from the account rather than the request body.
    stockRoom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StockRoom",
      required: true,
    },
    stockRoomName: { type: String, default: "" },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    // Product details as they read at submission time.
    productName: { type: String, default: "" },
    productCode: { type: String, default: "" },
    unit: { type: String, default: "" },
    quantity: {
      type: Number,
      required: true,
      min: [1, "Quantity must be at least 1"],
    },
    /** What the room held when the request was raised, for context later. */
    stockAtRequest: { type: Number, default: 0 },
    purpose: { type: String, default: "", trim: true },
    status: {
      type: String,
      required: true,
      enum: [PENDING_ADMIN, PENDING_SUPERVISOR, "Approved", "Rejected", "Cancelled"],
      default: PENDING_ADMIN,
    },

    // --- Stage one: Admin ---
    admin: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    adminComments: { type: String, default: "" },
    adminDecidedAt: { type: Date, default: null },

    // --- Stage two: Supervisor ---
    supervisor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    supervisorComments: { type: String, default: "" },
    supervisorDecidedAt: { type: Date, default: null },

    /**
     * The quantity that actually moves. The Admin may cut it at stage one and
     * the Supervisor may cut it again at stage two; it is only taken out of
     * the room on the Supervisor's approval.
     */
    approvedQuantity: { type: Number, default: null },

    history: { type: [decisionSchema], default: [] },
  },
  {
    timestamps: true,
  }
);

branchRequestSchema.statics.PENDING_ADMIN = PENDING_ADMIN;
branchRequestSchema.statics.PENDING_SUPERVISOR = PENDING_SUPERVISOR;
/** Statuses that are still moving through the workflow. */
branchRequestSchema.statics.OPEN_STATUSES = [PENDING_ADMIN, PENDING_SUPERVISOR];

const BranchRequest = mongoose.model("BranchRequest", branchRequestSchema);
export default BranchRequest;
