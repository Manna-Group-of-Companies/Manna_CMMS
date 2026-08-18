import mongoose from "mongoose";

/**
 * One line of a count sheet: what the system says a room holds of a product,
 * and what the person walking the shelves actually found.
 *
 * `countedQuantity` is null until somebody enters a figure. Zero is a real
 * count — "the shelf is empty" — and has to stay distinguishable from "nobody
 * has looked yet", which is why this is not defaulted to 0.
 */
const auditLineSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    // Snapshots, so a closed audit still reads correctly once a product is
    // renamed, re-coded or deleted.
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
    category: {
      type: String,
      default: "",
      trim: true,
    },
    rackNumber: {
      type: String,
      default: "",
      trim: true,
    },
    /**
     * The room's balance to compare the count against.
     *
     * Written when the sheet is drawn up and rewritten to the live balance the
     * moment a count is entered. A count means "this is what is on the shelf
     * right now", so the only honest thing to hold it against is what the
     * system believed right then — otherwise an issue raised halfway through
     * the count shows up as a counting error.
     */
    systemQuantity: {
      type: Number,
      default: 0,
      min: [0, "System quantity cannot be negative"],
    },
    countedQuantity: {
      type: Number,
      default: null,
      min: [0, "Counted quantity cannot be negative"],
    },
    /** Per-unit cost as it stood when the line was counted, for the variance value. */
    unitCost: {
      type: Number,
      default: 0,
      min: [0, "Unit cost cannot be negative"],
    },
    countedAt: {
      type: Date,
      default: null,
    },
    countedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    note: {
      type: String,
      default: "",
      trim: true,
    },
    /**
     * True for a line the counter added because they found stock the sheet did
     * not list. Its `systemQuantity` is almost always 0, and it is the single
     * most useful row on the report, so it is flagged rather than inferred.
     */
    addedDuringCount: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: false }
);

/** counted − system. Null while the line is uncounted. */
auditLineSchema.virtual("variance").get(function () {
  if (this.countedQuantity === null || this.countedQuantity === undefined) return null;
  return this.countedQuantity - (this.systemQuantity || 0);
});

/** What the discrepancy is worth, in rupees, regardless of direction. */
auditLineSchema.virtual("varianceValue").get(function () {
  const variance = this.variance;
  if (variance === null) return 0;
  return Math.round(Math.abs(variance) * (this.unitCost || 0) * 100) / 100;
});

auditLineSchema.set("toJSON", { virtuals: true });
auditLineSchema.set("toObject", { virtuals: true });

/**
 * A month's physical stock count of one store room (ST-36), the score it
 * earned (ST-37), and the record both are reported from afterwards (ST-38).
 *
 * One document per room per month — see the unique index at the bottom. The
 * count sheet is snapshotted into `lines` when the audit is opened rather than
 * assembled on read, because the whole point of an audit is to be able to say
 * later what was on the shelves and what the system claimed at that time; a
 * sheet rebuilt from today's catalog could not answer that.
 *
 * Nothing here moves stock. A discrepancy is a finding, not a correction:
 * putting the balance right stays the Admin's deliberate action on the stock
 * room screen, so the audit keeps measuring the store rather than papering
 * over it.
 */
const stockAuditSchema = new mongoose.Schema(
  {
    auditNumber: {
      type: String,
      required: true,
      unique: true,
    },
    /** The month being counted, as "YYYY-MM" — sorts and groups as a string. */
    period: {
      type: String,
      required: true,
      match: [/^\d{4}-\d{2}$/, "Period must look like 2026-08"],
    },
    stockRoom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StockRoom",
      required: true,
    },
    /** Snapshot, so a retired or renamed room still reads on an old audit. */
    stockRoomName: {
      type: String,
      required: true,
      trim: true,
    },
    /**
     * "In Progress" while counts are being entered, "Submitted" once the
     * counter closes it — from which point the lines are frozen — and
     * "Reviewed" once the Admin has signed it off.
     */
    status: {
      type: String,
      required: true,
      enum: ["In Progress", "Submitted", "Reviewed"],
      default: "In Progress",
    },
    lines: {
      type: [auditLineSchema],
      default: [],
    },

    // ---- Scoring (ST-37). All derived from `lines` in the hook below; never
    // written by a caller, so the score can never disagree with the sheet.

    /** Lines on the sheet. */
    linesTotal: { type: Number, default: 0 },
    /** Lines somebody actually entered a figure for. */
    linesCounted: { type: Number, default: 0 },
    /** Counted lines where the count equalled the system balance. */
    linesMatched: { type: Number, default: 0 },
    /** Counted lines holding more than the system said. */
    linesOver: { type: Number, default: 0 },
    /** Counted lines holding less than the system said. */
    linesShort: { type: Number, default: 0 },
    /** Units of discrepancy, ignoring direction — 3 short plus 2 over is 5. */
    varianceQuantity: { type: Number, default: 0 },
    /** The same, signed, so a room that is broadly over reads as positive. */
    netVarianceQuantity: { type: Number, default: 0 },
    /** Rupee value of the discrepancies, at the unit cost snapshotted per line. */
    varianceValue: { type: Number, default: 0 },
    /** How much of the sheet was counted, 0–100. */
    coverage: { type: Number, default: 0 },
    /** How much of what was counted was right, 0–100. */
    accuracy: { type: Number, default: 0 },
    /**
     * The room's score for the month, 0–100: matched lines over lines on the
     * sheet.
     *
     * Accuracy alone would let a room score 100 by counting the two items it
     * was sure of and leaving the rest, so coverage is folded in rather than
     * reported beside it — a line nobody counted is a line the store cannot
     * vouch for, and it costs the same as one counted wrong.
     */
    score: { type: Number, default: 0 },

    openedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    openedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    submittedAt: {
      type: Date,
      default: null,
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
    reviewNote: {
      type: String,
      default: "",
      trim: true,
    },
    /** Anything the counter wants on the record — who helped, what was blocked. */
    note: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

const percent = (part, whole) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

// Keep every stored total honest. Runs on create and on any later save, so a
// count saved through any route re-scores the whole sheet.
stockAuditSchema.pre("validate", function computeScore() {
  const lines = this.lines || [];
  let counted = 0;
  let matched = 0;
  let over = 0;
  let short = 0;
  let varianceQuantity = 0;
  let netVariance = 0;
  let varianceValue = 0;

  for (const line of lines) {
    if (line.countedQuantity === null || line.countedQuantity === undefined) continue;
    counted += 1;

    const variance = line.countedQuantity - (line.systemQuantity || 0);
    if (variance === 0) {
      matched += 1;
      continue;
    }
    if (variance > 0) over += 1;
    else short += 1;

    varianceQuantity += Math.abs(variance);
    netVariance += variance;
    varianceValue += Math.abs(variance) * (line.unitCost || 0);
  }

  this.linesTotal = lines.length;
  this.linesCounted = counted;
  this.linesMatched = matched;
  this.linesOver = over;
  this.linesShort = short;
  this.varianceQuantity = varianceQuantity;
  this.netVarianceQuantity = netVariance;
  this.varianceValue = Math.round(varianceValue * 100) / 100;
  this.coverage = percent(counted, lines.length);
  this.accuracy = percent(matched, counted);
  this.score = percent(matched, lines.length);
});

// One audit per room per month. The controller catches the duplicate-key error
// and hands back the audit that already exists, so two supervisors opening the
// month at the same moment land on the same sheet rather than two.
stockAuditSchema.index({ stockRoom: 1, period: 1 }, { unique: true });
// The history list, and the per-room trend on the report, both read this way.
stockAuditSchema.index({ period: -1, stockRoomName: 1 });

stockAuditSchema.set("toJSON", { virtuals: true });
stockAuditSchema.set("toObject", { virtuals: true });

const StockAudit = mongoose.model("StockAudit", stockAuditSchema);
export default StockAudit;
