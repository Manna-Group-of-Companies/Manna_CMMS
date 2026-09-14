import mongoose from "mongoose";

/**
 * One night's comparison of the CMMS against ERPNext.
 *
 * Kept rather than recomputed on demand for two reasons. The comparison reads
 * every Bin in every CMMS warehouse, which is not something to do because
 * somebody opened a page; and a report is far more useful next to the ones
 * before it, because drift that appears on one night and persists is a
 * different problem from drift that appears and clears itself.
 */

const differenceSchema = new mongoose.Schema(
  {
    itemCode: { type: String, required: true },
    warehouse: { type: String, required: true },
    cmmsQty: { type: Number, default: null },
    erpQty: { type: Number, default: null },
    delta: { type: Number, default: null },
  },
  { _id: false }
);

const erpDriftReportSchema = new mongoose.Schema(
  {
    /** How many balances were compared, and how many agreed. */
    compared: { type: Number, default: 0 },
    matched: { type: Number, default: 0 },
    driftCount: { type: Number, default: 0 },

    /**
     * The disagreements themselves, capped.
     *
     * A report is a thing to act on, not an export. If ten thousand balances
     * disagree the cause is structural — the sync was off, or the cutover has
     * not run — and the first fifty say that just as clearly as all of them,
     * without putting a document of that size in the database every night.
     */
    differences: { type: [differenceSchema], default: [] },
    missingInErp: { type: [differenceSchema], default: [] },
    missingInCmms: { type: [differenceSchema], default: [] },
    truncated: { type: Boolean, default: false },

    /**
     * The state of the queue when the comparison ran.
     *
     * Without this a report cannot be read honestly: a movement still waiting
     * in the outbox has legitimately not reached ERPNext, so drift beside a
     * non-empty queue may be nothing at all.
     */
    pendingJobs: { type: Number, default: 0 },
    failedJobs: { type: Number, default: 0 },

    /** Which warehouses were in scope, so an added room is visible later. */
    warehouses: { type: [String], default: [] },

    summary: { type: String, default: "" },
    /** Set when the run could not finish, e.g. ERPNext was unreachable. */
    error: { type: String, default: "" },
    durationMs: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// The only read: the most recent reports, newest first.
erpDriftReportSchema.index({ createdAt: -1 });

/** How many differences of each kind one report keeps. */
erpDriftReportSchema.statics.MAX_ROWS = 50;

const ErpDriftReport = mongoose.model("ErpDriftReport", erpDriftReportSchema);
export default ErpDriftReport;
