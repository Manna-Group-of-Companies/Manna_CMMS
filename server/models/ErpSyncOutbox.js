import mongoose from "mongoose";

/**
 * One thing that still has to reach ERPNext.
 *
 * The store floor never waits on ERPNext. A movement is written to MongoDB and
 * the request returns; a row lands here in the same breath, and a background
 * worker drains it whenever ERPNext is reachable. An ERPNext outage therefore
 * slows this queue and nothing else — no issue is refused because Frappe Cloud
 * was busy.
 *
 * Rows are kept after they succeed rather than deleted. `erpDocName` is the
 * only record of which Stock Entry a movement became, and it is what makes a
 * retry safe: a job that already has one is never posted twice.
 */
const erpSyncOutboxSchema = new mongoose.Schema(
  {
    /**
     * What kind of thing this is. Only stock movements for now; Item and
     * Warehouse pushes land here too once the master-data sync is written,
     * which is why this is not simply hard-coded to one value.
     */
    entity: {
      type: String,
      required: true,
      enum: ["StockMovement"],
      default: "StockMovement",
    },
    /** The MongoDB document this job came from. */
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    /** The ERPNext DocType this job creates. */
    doctype: {
      type: String,
      required: true,
      default: "Stock Entry",
      trim: true,
    },
    /**
     * The finished ERPNext payload, built when the job was queued rather than
     * when it runs.
     *
     * Deliberate: a movement describes what happened at a moment in time, and
     * rebuilding the payload hours later — after a product was renamed, or a
     * room reassigned — would post something that never occurred. The payload
     * is a snapshot for the same reason `StockMovement` snapshots the product
     * name.
     */
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    status: {
      type: String,
      required: true,
      enum: ["Pending", "Sent", "Failed", "Skipped"],
      default: "Pending",
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    /**
     * The ERPNext document this became. Empty until it succeeds.
     *
     * Written before the status is flipped, so a crash between the two leaves
     * a row that looks Pending but already carries a docname — which the
     * worker treats as done rather than posting it again.
     */
    erpDocName: {
      type: String,
      default: "",
      trim: true,
    },
    lastError: {
      type: String,
      default: "",
      trim: true,
    },
    /**
     * When the worker may next pick this up. Backoff is written here rather
     * than slept on, so a restart does not lose it and one poisoned job cannot
     * hold up the queue behind it.
     */
    nextAttemptAt: {
      type: Date,
      default: () => new Date(),
    },
    sentAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// The worker's only read: the oldest due Pending job.
erpSyncOutboxSchema.index({ status: 1, nextAttemptAt: 1 });

// One job per source document. A movement must not be able to queue twice —
// this is the backstop behind the worker's own idempotency check.
erpSyncOutboxSchema.index({ entity: 1, entityId: 1 }, { unique: true });

const ErpSyncOutbox = mongoose.model("ErpSyncOutbox", erpSyncOutboxSchema);
export default ErpSyncOutbox;
