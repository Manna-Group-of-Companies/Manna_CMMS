import mongoose from "mongoose";
import StockAudit from "../models/StockAudit.js";
import StockRoom from "../models/StockRoom.js";
import StockRoomInventory from "../models/StockRoomInventory.js";
import Product from "../models/Product.js";
import Notification from "../models/Notification.js";
import StockMovement from "../models/StockMovement.js";
import {
  AUDIT_FREQUENCY_NAMES,
  VARIANCE_REASONS,
  dueState,
  intervalOf,
  periodPlus,
} from "../utils/auditSchedule.js";

const generateAuditNumber = (period) =>
  `AUD-${period.replace("-", "")}-${Math.floor(1000 + Math.random() * 9000)}`;

/**
 * The month a date falls in, as "YYYY-MM", read in Indian time.
 *
 * Every store this serves is in India but the API runs on a UTC host, so a
 * count opened at 5am on the 1st would otherwise be filed under the month that
 * had just ended — and, worse, collide with the audit already closed for it.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export const periodOf = (date = new Date()) =>
  new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 7);

/** Rejects anything that is not a "YYYY-MM" month. */
const isPeriod = (value) => /^\d{4}-\d{2}$/.test(String(value ?? ""));

/** The three-field summary of a user, as every other list here returns it. */
const USER_FIELDS = "name email role";

/** Everything a room is holding, with the product details a line needs. */
const roomHoldings = (room) =>
  StockRoomInventory.find({ stockRoom: room._id, quantity: { $gt: 0 } })
    .populate("product", "name code unit category rackNumber unitCost auditFrequency")
    .sort({ quantity: -1 });

/** One count sheet line from a room's inventory row. */
const lineFrom = (row, due) => ({
  product: row.product._id,
  productName: row.product.name,
  productCode: row.product.code || "",
  unit: row.product.unit || "",
  category: row.product.category || "",
  rackNumber: row.product.rackNumber || "",
  auditFrequency: row.product.auditFrequency || "Monthly",
  lastCountedPeriod: row.lastCountedPeriod || "",
  dueReason: due.reason,
  systemQuantity: row.quantity,
  countedQuantity: null,
  unitCost: row.product.unitCost || 0,
});

/**
 * Draws up the count sheet for a room: one line per product the room is
 * holding that the schedule says is owed a count this month.
 *
 * Products the room holds nothing of are left off. The catalog runs to several
 * thousand items and all but a handful of them sit in one room, so listing
 * every product against every room would bury the count that matters under
 * pages of zeroes. Stock that turns up on a shelf the system did not expect is
 * added to the sheet as it is found — see `addAuditLine`.
 *
 * Items on a quarterly or half-yearly cadence are held back in the months
 * between their turns, and counted in `skipped` so the sheet can say what it
 * chose not to ask for. A full count takes everything regardless, for the
 * wall-to-wall stock take the schedule is not meant to replace.
 */
const buildLines = async (room, period, { full = false } = {}) => {
  // A row whose product was deleted has nothing left to count.
  const rows = (await roomHoldings(room)).filter((row) => row.product);

  const lines = [];
  let skipped = 0;

  for (const row of rows) {
    const due = dueState({
      frequency: row.product.auditFrequency,
      lastCountedPeriod: row.lastCountedPeriod,
      period,
    });
    if (!due.due && !full) {
      skipped += 1;
      continue;
    }
    lines.push({
      ...lineFrom(row, due),
      dueReason: due.due ? due.reason : `Full count — ${due.reason}`,
    });
  }

  return { lines, skipped };
};

/** Loads an audit and answers 404 itself, so every route below reads the same. */
const loadAudit = async (id, res) => {
  if (!mongoose.isValidObjectId(id)) {
    res.status(404).json({ message: "Audit not found" });
    return null;
  }
  const audit = await StockAudit.findById(id);
  if (!audit) {
    res.status(404).json({ message: "Audit not found" });
    return null;
  }
  return audit;
};

/**
 * Whether [user] may enter counts on [audit].
 *
 * The supervisor who opened it owns the count; an Admin can work on any sheet,
 * because somebody has to be able to finish a month a supervisor left half
 * done or has since left.
 */
const canCount = (audit, user) =>
  user.role === "Admin" ||
  // Called with both a raw and a populated audit, so read the id either way.
  String(audit.openedBy?._id || audit.openedBy) === String(user._id);

const populated = (query) =>
  query
    .populate("stockRoom", "name description")
    .populate("openedBy", USER_FIELDS)
    .populate("submittedBy", USER_FIELDS)
    .populate("reviewedBy", USER_FIELDS);

/**
 * An audit as it is safe to hand out while the count is still open: the
 * balance the system expects is withheld from every line nobody has counted
 * yet.
 *
 * The count is taken blind — a counter who can see the expected figure tends
 * to write it down, and a sheet that agrees with the system by construction
 * scores well while telling nobody anything. Hiding it in the page alone would
 * leave it a keystroke away in the network tab, so it is never sent. Saving a
 * line returns its balance with it, which is what puts the variance on screen
 * while the shelf is still in reach.
 */
const asCountSheet = (audit) => {
  if (!audit) return audit;
  const plain = audit.toObject();
  if (plain.status !== "In Progress") return plain;

  plain.lines = (plain.lines || []).map((line) =>
    line.countedQuantity === null || line.countedQuantity === undefined
      ? { ...line, systemQuantity: null }
      : line
  );
  return plain;
};

/**
 * Turns an open due-sheet into a full count by appending the room's remaining
 * holdings.
 *
 * Only ever adds. Dropping the lines a full count would not have listed would
 * throw away counts already entered against them, and the sheet is somebody's
 * afternoon on the shop floor.
 */
const widenToFullCount = async (audit, room, period) => {
  const onSheet = new Set(audit.lines.map((line) => String(line.product)));
  const rows = (await roomHoldings(room)).filter(
    (row) => row.product && !onSheet.has(String(row.product._id))
  );

  for (const row of rows) {
    const due = dueState({
      frequency: row.product.auditFrequency,
      lastCountedPeriod: row.lastCountedPeriod,
      period,
    });
    audit.lines.push({ ...lineFrom(row, due), dueReason: `Full count — ${due.reason}` });
  }

  audit.scope = "Full";
  audit.linesSkipped = 0;
  await audit.save();
  return rows.length;
};

/**
 * @desc    Open this month's audit for a store room, or resume the open one
 *          (ST-36).
 * @route   POST /api/audits
 * @access  Private (Admin, Supervisor)
 *
 * Idempotent on purpose: the button in the app says "Start / resume this
 * month's count", and a supervisor who taps it twice, or a second supervisor
 * who joins the count, has to land on the same sheet rather than open a rival
 * one. A month that has already been submitted is the one case that refuses —
 * reopening it is the Admin's call.
 *
 * `scope` picks what goes on the sheet: "due" (the default) asks the frequency
 * schedule which items are owed a count this month, "full" walks the whole
 * room. Asking for a full count of a room that already has a due sheet open
 * widens that sheet rather than starting a second one — the extra lines are
 * appended and nothing already counted is disturbed.
 */
export const openAudit = async (req, res) => {
  const { stockRoomId, period: requestedPeriod, scope } = req.body || {};
  const full = String(scope || "").toLowerCase() === "full";

  try {
    const period = requestedPeriod || periodOf();
    if (!isPeriod(period)) {
      return res.status(400).json({ message: "Period must look like 2026-08" });
    }
    // A count of a month that has not happened yet cannot mean anything.
    if (period > periodOf()) {
      return res.status(400).json({ message: "That month has not started yet" });
    }

    if (!mongoose.isValidObjectId(stockRoomId)) {
      return res.status(400).json({ message: "A store room must be named" });
    }
    const room = await StockRoom.findById(stockRoomId);
    if (!room) {
      return res.status(404).json({ message: "Store room not found" });
    }

    const existing = await StockAudit.findOne({ stockRoom: room._id, period });
    if (existing) {
      if (existing.status !== "In Progress") {
        return res.status(409).json({
          message: `${room.name} has already been audited for ${period}`,
          auditId: existing._id,
        });
      }

      let message = `Resuming the ${period} count of ${room.name}`;
      if (full && existing.scope !== "Full") {
        const added = await widenToFullCount(existing, room, period);
        message = added
          ? `${added} more ${added === 1 ? "line" : "lines"} added — ${room.name} is now a full count`
          : `${room.name} was already holding nothing beyond the due sheet`;
      }

      return res.json({
        message,
        audit: asCountSheet(await populated(StockAudit.findById(existing._id))),
      });
    }

    const { lines, skipped } = await buildLines(room, period, { full });
    if (lines.length === 0) {
      return res.status(400).json({
        message: skipped
          ? `Nothing is due for counting in ${room.name} this month — ${skipped} ${
              skipped === 1 ? "item is" : "items are"
            } on a longer cycle and not due yet. Start a full count to walk the whole room.`
          : `${room.name} holds no stock, so there is nothing to count`,
      });
    }

    let audit;
    try {
      audit = await StockAudit.create({
        auditNumber: generateAuditNumber(period),
        period,
        stockRoom: room._id,
        stockRoomName: room.name,
        scope: full ? "Full" : "Due",
        linesSkipped: skipped,
        lines,
        openedBy: req.user._id,
        openedAt: new Date(),
      });
    } catch (error) {
      // Two people opened the month at the same instant and the unique index
      // caught the second. Hand back the one that won rather than an error
      // neither of them can act on.
      if (error.code === 11000) {
        const winner = await StockAudit.findOne({ stockRoom: room._id, period });
        if (winner) {
          return res.json({
            message: `Resuming the ${period} count of ${room.name}`,
            audit: asCountSheet(await populated(StockAudit.findById(winner._id))),
          });
        }
      }
      throw error;
    }

    res.status(201).json({
      message: `${period} ${full ? "full count" : "count"} of ${room.name} opened with ${
        lines.length
      } lines${skipped ? `; ${skipped} not due yet` : ""}`,
      audit: asCountSheet(await populated(StockAudit.findById(audit._id))),
    });
  } catch (error) {
    console.error("Error opening the audit:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Audit history — every count, newest month first (ST-38).
 * @route   GET /api/audits?stockRoomId=&period=&from=&to=&status=&scope=mine
 * @access  Private (Admin, Supervisor)
 *
 * Lines are left out: the history list shows a row per audit and the sheets
 * run to hundreds of lines each. GET /api/audits/:id serves one in full.
 */
export const getAudits = async (req, res) => {
  try {
    const query = {};

    if (mongoose.isValidObjectId(req.query.stockRoomId)) {
      query.stockRoom = req.query.stockRoomId;
    }
    if (isPeriod(req.query.period)) {
      query.period = req.query.period;
    }
    if (["In Progress", "Submitted", "Reviewed"].includes(req.query.status)) {
      query.status = req.query.status;
    }
    if (req.query.scope === "mine") {
      query.openedBy = req.user._id;
    }

    // Month bounds, inclusive. Given as "YYYY-MM" and compared as strings,
    // which orders months correctly for as long as the year has four digits.
    // Ignored when an exact month was asked for, which is narrower than any
    // range could be.
    const from = isPeriod(req.query.from) ? req.query.from : null;
    const to = isPeriod(req.query.to) ? req.query.to : null;
    if (!query.period && (from || to)) {
      query.period = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
    }

    const audits = await populated(StockAudit.find(query).select("-lines")).sort({
      period: -1,
      stockRoomName: 1,
    });

    res.json(
      audits.map((audit) => ({
        ...audit.toObject(),
        isMine: String(audit.openedBy?._id || audit.openedBy) === String(req.user._id),
      }))
    );
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    One audit with its full count sheet.
 * @route   GET /api/audits/:id
 * @access  Private (Admin, Supervisor)
 */
export const getAudit = async (req, res) => {
  try {
    const audit = await populated(
      StockAudit.findById(mongoose.isValidObjectId(req.params.id) ? req.params.id : null)
    ).populate("lines.countedBy", USER_FIELDS);

    if (!audit) {
      return res.status(404).json({ message: "Audit not found" });
    }

    res.json({
      ...asCountSheet(audit),
      canCount: audit.status === "In Progress" && canCount(audit, req.user),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Save counted quantities against an open sheet (ST-36).
 * @route   PUT /api/audits/:id/lines
 * @access  Private (Admin, Supervisor — the counter or an Admin)
 *
 * Takes a batch rather than a line at a time: the count is entered on a phone
 * or a laptop out on the floor, often on a connection that drops, and a screen
 * full of figures has to survive as one save rather than forty.
 *
 * A line that does not match takes a `varianceReason` alongside the figure —
 * recorded at the shelf, while the counter can still see why. It is not
 * demanded here, because a count entered in a hurry and explained a minute
 * later is still a count; `submitAudit` is where the sheet refuses to close
 * with a discrepancy nobody has accounted for.
 *
 * Each saved line's `systemQuantity` is refreshed to the room's balance as it
 * stands now. The count is a statement about this moment, so it is scored
 * against what the system believes at this moment — otherwise stock issued
 * while the count was under way reads as a counting error.
 */
export const saveAuditCounts = async (req, res) => {
  const { counts } = req.body || {};

  try {
    const audit = await loadAudit(req.params.id, res);
    if (!audit) return undefined;

    if (audit.status !== "In Progress") {
      return res.status(400).json({
        message: `This count was ${audit.status.toLowerCase()} and can no longer be changed`,
      });
    }
    if (!canCount(audit, req.user)) {
      return res
        .status(403)
        .json({ message: "Only the supervisor who opened this count, or an Admin, can enter it" });
    }
    if (!Array.isArray(counts) || counts.length === 0) {
      return res.status(400).json({ message: "No counts were sent" });
    }

    // One read of the room's balances covers the whole batch.
    const rows = await StockRoomInventory.find({ stockRoom: audit.stockRoom });
    const liveQuantity = new Map(rows.map((row) => [String(row.product), row.quantity]));

    const now = new Date();
    let saved = 0;

    for (const entry of counts) {
      const line = entry?.lineId
        ? audit.lines.id(entry.lineId)
        : audit.lines.find((row) => String(row.product) === String(entry?.productId));

      if (!line) continue;

      // Null clears a count back to "not counted yet", which is how a figure
      // entered against the wrong line is undone. Leaving the field out
      // entirely changes nothing, so a note can be added to a line without
      // touching, or having to restate, the count already on it.
      if (entry.countedQuantity === undefined) {
        // Nothing to do — the note below is the whole edit.
      } else if (entry.countedQuantity === null || entry.countedQuantity === "") {
        line.countedQuantity = null;
        line.countedAt = null;
        line.countedBy = null;
        // The reason explained a variance that no longer exists.
        line.varianceReason = "";
      } else {
        const counted = Number(entry.countedQuantity);
        if (!Number.isInteger(counted) || counted < 0) {
          return res.status(400).json({
            message: `The count for "${line.productName}" must be a whole number of 0 or more`,
          });
        }
        line.countedQuantity = counted;
        line.systemQuantity = liveQuantity.get(String(line.product)) ?? 0;
        line.countedAt = now;
        line.countedBy = req.user._id;
      }

      if (entry.varianceReason !== undefined) {
        const reason = String(entry.varianceReason || "").trim();
        if (reason && !VARIANCE_REASONS.includes(reason)) {
          return res.status(400).json({
            message: `"${reason}" is not one of the variance reasons`,
          });
        }
        line.varianceReason = reason;
      }

      // A line that has come back into agreement has nothing left to explain,
      // so a reason left over from an earlier figure is dropped rather than
      // left to be totalled into next month's report.
      if (
        line.countedQuantity !== null &&
        line.countedQuantity === (line.systemQuantity || 0)
      ) {
        line.varianceReason = "";
      }

      if (entry.note !== undefined) {
        line.note = String(entry.note || "").trim();
      }
      saved += 1;
    }

    if (saved === 0) {
      return res.status(400).json({ message: "None of those lines are on this sheet" });
    }

    if (req.body?.note !== undefined) {
      audit.note = String(req.body.note || "").trim();
    }

    // The pre-validate hook re-scores the whole sheet on the way out.
    await audit.save();

    res.json({
      message: `${saved} ${saved === 1 ? "line" : "lines"} saved`,
      audit: asCountSheet(await populated(StockAudit.findById(audit._id))),
    });
  } catch (error) {
    console.error("Error saving the count:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Add a line for stock found in the room that the sheet did not list.
 * @route   POST /api/audits/:id/lines
 * @access  Private (Admin, Supervisor — the counter or an Admin)
 *
 * The sheet only lists what the room is holding, so an item the system thinks
 * is somewhere else — or nowhere — has no line to write the count on. This is
 * the finding an audit exists to surface, so it gets a line of its own rather
 * than a note nobody can total.
 */
export const addAuditLine = async (req, res) => {
  const { productId, countedQuantity, note, varianceReason } = req.body || {};

  try {
    const audit = await loadAudit(req.params.id, res);
    if (!audit) return undefined;

    if (audit.status !== "In Progress") {
      return res.status(400).json({
        message: `This count was ${audit.status.toLowerCase()} and can no longer be changed`,
      });
    }
    if (!canCount(audit, req.user)) {
      return res
        .status(403)
        .json({ message: "Only the supervisor who opened this count, or an Admin, can enter it" });
    }

    if (!mongoose.isValidObjectId(productId)) {
      return res.status(400).json({ message: "An engineering stock item must be named" });
    }
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Engineering Stock not found" });
    }

    if (audit.lines.some((line) => String(line.product) === String(product._id))) {
      return res
        .status(409)
        .json({ message: `"${product.name}" is already on this sheet` });
    }

    const counted = Number(countedQuantity);
    if (!Number.isInteger(counted) || counted < 0) {
      return res
        .status(400)
        .json({ message: "The count must be a whole number of 0 or more" });
    }

    const reason = String(varianceReason || "").trim();
    if (reason && !VARIANCE_REASONS.includes(reason)) {
      return res
        .status(400)
        .json({ message: `"${reason}" is not one of the variance reasons` });
    }

    // Whatever the room says it holds — normally nothing, which is exactly the
    // discrepancy being recorded.
    const row = await StockRoomInventory.findOne({
      stockRoom: audit.stockRoom,
      product: product._id,
    });

    audit.lines.push({
      product: product._id,
      productName: product.name,
      productCode: product.code || "",
      unit: product.unit || "",
      category: product.category || "",
      rackNumber: product.rackNumber || "",
      auditFrequency: product.auditFrequency || "Monthly",
      lastCountedPeriod: row?.lastCountedPeriod || "",
      dueReason: "Found on the shelf during the count",
      systemQuantity: row?.quantity ?? 0,
      countedQuantity: counted,
      unitCost: product.unitCost || 0,
      countedAt: new Date(),
      countedBy: req.user._id,
      note: String(note || "").trim(),
      varianceReason: reason,
      addedDuringCount: true,
    });

    await audit.save();

    res.status(201).json({
      message: `"${product.name}" added to the sheet`,
      audit: asCountSheet(await populated(StockAudit.findById(audit._id))),
    });
  } catch (error) {
    console.error("Error adding an audit line:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * Records, on each room inventory row, that this month's count reached it.
 *
 * Deliberately narrow: it writes only when the row has not already been
 * stamped with a later month, so re-submitting a reopened sheet is harmless
 * while a back-dated audit closed after a newer one cannot pull the schedule
 * backwards and make fresh stock look stale.
 *
 * It touches no balance. An audit never moves stock — putting a wrong balance
 * right stays the Admin's separate act on the stock room screen — so all this
 * leaves behind is the fact that somebody walked the shelf.
 */
const stampCountedLines = async (audit) => {
  const counted = audit.lines.filter(
    (line) => line.countedQuantity !== null && line.countedQuantity !== undefined
  );
  if (counted.length === 0) return;

  await StockRoomInventory.bulkWrite(
    counted.map((line) => ({
      updateOne: {
        filter: {
          stockRoom: audit.stockRoom,
          product: line.product,
          lastCountedPeriod: { $lte: audit.period },
        },
        update: {
          $set: {
            lastCountedPeriod: audit.period,
            lastCountedAt: line.countedAt || audit.submittedAt || new Date(),
            lastCountedQuantity: line.countedQuantity,
          },
        },
      },
    })),
    { ordered: false }
  );
};

/**
 * @desc    Close the count and post its score (ST-37).
 * @route   POST /api/audits/:id/submit
 * @access  Private (Admin, Supervisor — the counter or an Admin)
 *
 * Submitting freezes the sheet. The score is not recomputed here — the hook on
 * the model has kept it in step with every save — so what the counter saw on
 * screen is exactly what the Admin is shown.
 *
 * Every discrepancy has to carry a reason first. This is the last moment the
 * counter is still in the room, and an unaccounted variance found a week later
 * is a question nobody can answer; "Unexplained" is an accepted answer, so the
 * check costs an honest counter one tap and costs a careless sheet the right
 * to be closed.
 *
 * Closing also stamps every counted line onto the room's inventory row, which
 * is what the quarterly and half-yearly schedule measures the next count from.
 */
export const submitAudit = async (req, res) => {
  try {
    const audit = await loadAudit(req.params.id, res);
    if (!audit) return undefined;

    if (audit.status !== "In Progress") {
      return res
        .status(400)
        .json({ message: `This count has already been ${audit.status.toLowerCase()}` });
    }
    if (!canCount(audit, req.user)) {
      return res
        .status(403)
        .json({ message: "Only the supervisor who opened this count, or an Admin, can submit it" });
    }
    if (audit.linesCounted === 0) {
      return res
        .status(400)
        .json({ message: "Count at least one line before submitting" });
    }

    const unreasoned = audit.lines.filter(
      (line) =>
        line.countedQuantity !== null &&
        line.countedQuantity !== undefined &&
        line.countedQuantity !== (line.systemQuantity || 0) &&
        !line.varianceReason
    );
    if (unreasoned.length > 0) {
      const named = unreasoned
        .slice(0, 3)
        .map((line) => `"${line.productName}"`)
        .join(", ");
      return res.status(400).json({
        message: `${unreasoned.length} ${
          unreasoned.length === 1 ? "discrepancy needs" : "discrepancies need"
        } a reason before this sheet can be submitted — ${named}${
          unreasoned.length > 3 ? " and others" : ""
        }`,
        lineIds: unreasoned.map((line) => String(line._id)),
      });
    }

    // Submitted from the sheet with no body at all, so this cannot assume one.
    if (req.body?.note !== undefined) {
      audit.note = String(req.body.note || "").trim();
    }
    audit.status = "Submitted";
    audit.submittedBy = req.user._id;
    audit.submittedAt = new Date();
    await audit.save();

    await stampCountedLines(audit);

    await Notification.create({
      message: `${audit.period} audit of ${audit.stockRoomName} submitted by ${req.user.name}: scored ${audit.score}% over ${audit.linesTotal} lines, ${audit.linesOver + audit.linesShort} discrepancies worth ${audit.varianceValue}${audit.linesUnexplained ? `, ${audit.linesUnexplained} unexplained` : ""} (${audit.auditNumber})`,
      type: "AUDIT_SUBMITTED",
    });

    res.json({
      message: `${audit.stockRoomName} scored ${audit.score}% for ${audit.period}`,
      audit: asCountSheet(await populated(StockAudit.findById(audit._id))),
    });
  } catch (error) {
    console.error("Error submitting the audit:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Admin sign-off on a submitted count (ST-38).
 * @route   POST /api/audits/:id/review
 * @access  Private (Admin)
 *
 * Recording only. Correcting a balance a count disagrees with stays a separate,
 * deliberate act on the stock room screen, so signing an audit off never moves
 * stock by itself.
 */
export const reviewAudit = async (req, res) => {
  try {
    const audit = await loadAudit(req.params.id, res);
    if (!audit) return undefined;

    if (audit.status === "In Progress") {
      return res
        .status(400)
        .json({ message: "This count has not been submitted yet" });
    }
    if (audit.status === "Reviewed") {
      return res.status(400).json({
        message: `Already reviewed by ${audit.reviewedBy ? "an Admin" : "someone"}`,
      });
    }

    audit.status = "Reviewed";
    audit.reviewedBy = req.user._id;
    audit.reviewedAt = new Date();
    audit.reviewNote = String(req.body?.note || "").trim();
    await audit.save();

    await Notification.create({
      message: `${audit.period} audit of ${audit.stockRoomName} (${audit.auditNumber}) reviewed by ${req.user.name}`,
      type: "AUDIT_REVIEWED",
    });

    res.json({
      message: `${audit.auditNumber} marked as reviewed`,
      audit: asCountSheet(await populated(StockAudit.findById(audit._id))),
    });
  } catch (error) {
    console.error("Error reviewing the audit:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Put a submitted count back into the counter's hands.
 * @route   POST /api/audits/:id/reopen
 * @access  Private (Admin)
 *
 * A month can only be audited once, so a sheet submitted by mistake — or one
 * an Admin has queried with the store — would otherwise be stuck wrong until
 * the next month. A reviewed audit is final and is not reopened.
 */
export const reopenAudit = async (req, res) => {
  try {
    const audit = await loadAudit(req.params.id, res);
    if (!audit) return undefined;

    if (audit.status !== "Submitted") {
      return res.status(400).json({
        message:
          audit.status === "Reviewed"
            ? "A reviewed audit is closed for good"
            : "This count is already open",
      });
    }

    audit.status = "In Progress";
    audit.submittedBy = null;
    audit.submittedAt = null;
    await audit.save();

    res.json({
      message: `${audit.auditNumber} reopened for counting`,
      audit: asCountSheet(await populated(StockAudit.findById(audit._id))),
    });
  } catch (error) {
    console.error("Error reopening the audit:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Scores per store room and overall, month by month (ST-37, ST-38).
 * @route   GET /api/audits/scoreboard?from=&to=&includeOpen=true
 * @access  Private (Admin, Supervisor)
 *
 * Rooms, periods and the overall figure come back together, from one read, so
 * the three panels of the report cannot disagree with each other.
 *
 * Every rolled-up score is matched lines over lines on the sheet across the
 * audits in the window, not the mean of their percentages. Averaging the
 * percentages would let a room that counted twelve lines in March weigh as
 * heavily as one that counted nine hundred in April.
 */
export const getAuditScoreboard = async (req, res) => {
  try {
    const match = {};

    // Open sheets are half-counted by definition and would drag every score
    // down, so the report is of closed months unless asked otherwise.
    match.status =
      req.query.includeOpen === "true"
        ? { $in: ["In Progress", "Submitted", "Reviewed"] }
        : { $in: ["Submitted", "Reviewed"] };

    const from = isPeriod(req.query.from) ? req.query.from : null;
    const to = isPeriod(req.query.to) ? req.query.to : null;
    if (from || to) {
      match.period = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
    }

    // A month of audits is a few dozen documents at most — one per room — so
    // these are rolled up in plain code rather than an aggregation. Lines are
    // left behind; every figure needed here is already totalled on the header.
    const audits = await StockAudit.find(match)
      .select("-lines")
      .sort({ period: 1, stockRoomName: 1 });

    const scoreOf = (bucket) =>
      bucket.linesTotal > 0
        ? Math.round((bucket.linesMatched / bucket.linesTotal) * 1000) / 10
        : 0;

    const blank = (extra) => ({
      audits: 0,
      linesTotal: 0,
      linesCounted: 0,
      linesMatched: 0,
      linesOver: 0,
      linesShort: 0,
      varianceQuantity: 0,
      varianceValue: 0,
      ...extra,
    });

    const add = (bucket, audit) => {
      bucket.audits += 1;
      bucket.linesTotal += audit.linesTotal;
      bucket.linesCounted += audit.linesCounted;
      bucket.linesMatched += audit.linesMatched;
      bucket.linesOver += audit.linesOver;
      bucket.linesShort += audit.linesShort;
      bucket.varianceQuantity += audit.varianceQuantity;
      bucket.varianceValue += audit.varianceValue;
    };

    const byRoom = new Map();
    const byPeriod = new Map();
    const total = blank({});

    for (const audit of audits) {
      const roomKey = String(audit.stockRoom);
      if (!byRoom.has(roomKey)) {
        byRoom.set(
          roomKey,
          blank({
            stockRoomId: audit.stockRoom,
            stockRoom: audit.stockRoomName,
            latest: null,
            history: [],
          })
        );
      }
      const room = byRoom.get(roomKey);
      add(room, audit);
      // Sorted ascending above, so the last one seen is the newest month.
      room.latest = {
        auditId: audit._id,
        auditNumber: audit.auditNumber,
        period: audit.period,
        status: audit.status,
        score: audit.score,
        accuracy: audit.accuracy,
        coverage: audit.coverage,
        varianceValue: audit.varianceValue,
      };
      room.history.push({ period: audit.period, score: audit.score });

      if (!byPeriod.has(audit.period)) {
        byPeriod.set(audit.period, blank({ period: audit.period, rooms: 0 }));
      }
      const period = byPeriod.get(audit.period);
      add(period, audit);
      period.rooms += 1;

      add(total, audit);
    }

    // Which rooms have not been counted this month — the question the Admin
    // opens this page to answer, and one a list of completed audits alone
    // cannot answer.
    const currentPeriod = periodOf();
    const rooms = await StockRoom.find({ isActive: true }).sort({ name: 1 });
    const countedThisPeriod = new Set(
      audits
        .filter((audit) => audit.period === currentPeriod)
        .map((audit) => String(audit.stockRoom))
    );
    const outstanding = rooms
      .filter((room) => !countedThisPeriod.has(String(room._id)))
      .map((room) => ({ stockRoomId: room._id, stockRoom: room.name }));

    // Rupees only ever carry two decimals; summing them in floating point does
    // not, so every total is rounded on the way out rather than shown as
    // 1240.0000000000002.
    const rounded = (bucket) => ({
      ...bucket,
      varianceValue: Math.round(bucket.varianceValue * 100) / 100,
      score: scoreOf(bucket),
    });

    res.json({
      period: currentPeriod,
      overall: rounded(total),
      byStoreRoom: [...byRoom.values()].map(rounded).sort((a, b) => b.score - a.score),
      byPeriod: [...byPeriod.values()].map(rounded),
      outstanding,
    });
  } catch (error) {
    console.error("Error building the audit scoreboard:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    What the frequency schedule owes a room this month, and what it is
 *          holding back.
 * @route   GET /api/audits/schedule?stockRoomId=&period=
 * @access  Private (Admin, Supervisor)
 *
 * Answers the question a supervisor asks before opening a sheet — "how much of
 * this room am I being asked to walk?" — and the one the Admin asks after it:
 * how much of the room the count did not cover, and when it comes round again.
 *
 * Quantities are left out entirely. This is readable while a count is open, so
 * anything it returned about how much a shelf holds would put the expected
 * figure back in front of the counter the blind sheet exists to keep it from.
 */
export const getAuditSchedule = async (req, res) => {
  try {
    const period = isPeriod(req.query.period) ? req.query.period : periodOf();
    if (!mongoose.isValidObjectId(req.query.stockRoomId)) {
      return res.status(400).json({ message: "A store room must be named" });
    }
    const room = await StockRoom.findById(req.query.stockRoomId);
    if (!room) {
      return res.status(404).json({ message: "Store room not found" });
    }

    const rows = (await roomHoldings(room)).filter((row) => row.product);

    const byFrequency = new Map(
      AUDIT_FREQUENCY_NAMES.map((name) => [
        name,
        {
          frequency: name,
          intervalMonths: intervalOf(name),
          items: 0,
          due: 0,
          notDue: 0,
          neverCounted: 0,
          overdue: 0,
        },
      ])
    );
    /** How many items fall due in each future month, for the load ahead. */
    const upcoming = new Map();

    for (const row of rows) {
      const frequency = AUDIT_FREQUENCY_NAMES.includes(row.product.auditFrequency)
        ? row.product.auditFrequency
        : "Monthly";
      const bucket = byFrequency.get(frequency);
      const state = dueState({
        frequency,
        lastCountedPeriod: row.lastCountedPeriod,
        period,
      });

      bucket.items += 1;
      if (!state.due) {
        bucket.notDue += 1;
        upcoming.set(state.dueFrom, (upcoming.get(state.dueFrom) || 0) + 1);
        continue;
      }

      bucket.due += 1;
      if (!row.lastCountedPeriod) bucket.neverCounted += 1;
      // Its turn came round in an earlier month and the count never happened.
      else if (state.dueFrom < period) bucket.overdue += 1;
    }

    const buckets = [...byFrequency.values()];

    res.json({
      period,
      stockRoom: { _id: room._id, name: room.name },
      itemsHeld: rows.length,
      due: buckets.reduce((sum, bucket) => sum + bucket.due, 0),
      notDue: buckets.reduce((sum, bucket) => sum + bucket.notDue, 0),
      overdue: buckets.reduce((sum, bucket) => sum + bucket.overdue, 0),
      neverCounted: buckets.reduce((sum, bucket) => sum + bucket.neverCounted, 0),
      byFrequency: buckets,
      upcoming: [...upcoming.entries()]
        .map(([month, items]) => ({ period: month, items }))
        .sort((a, b) => a.period.localeCompare(b.period))
        .slice(0, 6),
    });
  } catch (error) {
    console.error("Error building the audit schedule:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * The effect one ledger entry had on one room's shelf.
 *
 * The ledger records the room a movement came from and went to, but not every
 * flow that writes to it fills those in — an issue raised against a request
 * names the room in its note rather than in its fields. So a movement is one
 * of three things here, and the difference matters enough to be reported
 * rather than averaged away: it moved this room's stock, it demonstrably moved
 * another room's, or nobody can tell.
 */
const roomEffectOf = (movement, roomName) => {
  const from = (movement.fromRoom || "").trim();
  const to = (movement.toRoom || "").trim();
  const here = (name) => name.toLowerCase() === String(roomName || "").toLowerCase();

  if (to && here(to)) return { effect: movement.quantity, attributed: true };
  if (from && here(from)) return { effect: -movement.quantity, attributed: true };
  if (from || to) return { effect: 0, attributed: true };
  return { effect: null, attributed: false };
};

/**
 * @desc    Reconcile one counted line against the stock movement ledger.
 * @route   GET /api/audits/:id/lines/:lineId/trail
 * @access  Private (Admin, Supervisor)
 *
 * A variance on its own says the shelf and the system disagree. It does not
 * say which of them is wrong, and that is the whole of what the Admin needs
 * before deciding whether to correct a balance or go and find out who took
 * something. So this walks back to the last time the item was counted in this
 * room, lists everything the ledger says happened to it since, and does the
 * arithmetic out loud:
 *
 *     what the last count found
 *   + everything the ledger moved since
 *   = what should be on the shelf now
 *
 * Held against this month's count, the leftover is stock that moved without
 * anybody recording it — the only figure here that is a finding in itself.
 * Held against the system balance instead, it says whether the balance has
 * drifted from its own ledger, which is a software problem rather than a store
 * one, and the two must not be shown as the same thing.
 *
 * The reconciliation is honest about what it cannot see. Movements the ledger
 * did not attribute to a room are listed and counted separately, and the
 * result is flagged partial rather than quietly folded in as though the sum
 * still held.
 */
export const getAuditLineTrail = async (req, res) => {
  try {
    const audit = await loadAudit(req.params.id, res);
    if (!audit) return undefined;

    const line = mongoose.isValidObjectId(req.params.lineId)
      ? audit.lines.id(req.params.lineId)
      : null;
    if (!line) {
      return res.status(404).json({ message: "That line is not on this sheet" });
    }

    // The blind count holds while the sheet is open, and the ledger carries
    // running balances, so an uncounted line's trail would hand over exactly
    // the figure the sheet is withholding.
    const counted = line.countedQuantity !== null && line.countedQuantity !== undefined;
    if (audit.status === "In Progress" && !counted) {
      return res.status(403).json({
        message: "Count this line first — its history stays hidden until then",
      });
    }

    // The most recent closed count of this item in this room.
    const previousAudit = await StockAudit.findOne({
      stockRoom: audit.stockRoom,
      period: { $lt: audit.period },
      status: { $in: ["Submitted", "Reviewed"] },
      lines: {
        $elemMatch: { product: line.product, countedQuantity: { $ne: null } },
      },
    })
      .sort({ period: -1 })
      .select("auditNumber period submittedAt lines");

    const previousLine = previousAudit?.lines.find(
      (row) =>
        String(row.product) === String(line.product) &&
        row.countedQuantity !== null &&
        row.countedQuantity !== undefined
    );

    const from = previousLine ? previousLine.countedAt || previousAudit.submittedAt : null;
    const to = line.countedAt || new Date();

    // Without a previous count there is no baseline to reconcile from, so the
    // trail becomes plain history: the last stretch of movements, which is
    // still the thing worth reading when a line comes up short.
    const rows = await StockMovement.find({
      product: line.product,
      createdAt: { ...(from && { $gt: from }), $lte: to },
    })
      .populate("performedBy", USER_FIELDS)
      .sort({ createdAt: from ? 1 : -1 })
      .limit(200);

    const movements = (from ? rows : rows.reverse()).map((row) => {
      const { effect, attributed } = roomEffectOf(row, audit.stockRoomName);
      return {
        _id: row._id,
        type: row.type,
        direction: row.direction,
        quantity: row.quantity,
        fromRoom: row.fromRoom || "",
        toRoom: row.toRoom || "",
        reference: row.reference || "",
        note: row.note || "",
        performedBy: row.performedBy || null,
        createdAt: row.createdAt,
        roomEffect: effect,
        attributed,
      };
    });

    const netMovement = movements.reduce((sum, row) => sum + (row.roomEffect || 0), 0);
    const unattributed = movements.filter((row) => !row.attributed).length;

    const baseline = previousLine ? previousLine.countedQuantity : null;
    const expectedQuantity = baseline === null ? null : baseline + netMovement;
    const systemQuantity = line.systemQuantity || 0;

    res.json({
      auditId: audit._id,
      auditNumber: audit.auditNumber,
      period: audit.period,
      stockRoom: audit.stockRoomName,
      line: {
        _id: line._id,
        product: line.product,
        productName: line.productName,
        productCode: line.productCode,
        unit: line.unit,
        auditFrequency: line.auditFrequency,
        systemQuantity,
        countedQuantity: counted ? line.countedQuantity : null,
        variance: counted ? line.countedQuantity - systemQuantity : null,
        varianceReason: line.varianceReason || "",
        note: line.note || "",
      },
      previousCount: previousLine
        ? {
            auditNumber: previousAudit.auditNumber,
            period: previousAudit.period,
            countedQuantity: previousLine.countedQuantity,
            countedAt: previousLine.countedAt || previousAudit.submittedAt,
          }
        : null,
      window: { from, to },
      movements,
      netMovement,
      unattributed,
      /** The sum only holds if every movement could be placed in a room. */
      partial: unattributed > 0,
      expectedQuantity,
      /** Count minus expected: stock that moved with nothing written down. */
      unrecordedMovement:
        expectedQuantity === null || !counted ? null : line.countedQuantity - expectedQuantity,
      /** System minus expected: the balance has drifted from its own ledger. */
      systemDrift: expectedQuantity === null ? null : systemQuantity - expectedQuantity,
      truncated: movements.length === 200,
    });
  } catch (error) {
    console.error("Error reconciling the audit line:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    The vocabulary a count sheet is allowed to use.
 * @route   GET /api/audits/vocabulary
 * @access  Private (Admin, Supervisor)
 *
 * Served rather than restated in the client, so a sheet can never offer a
 * reason the API would reject, and so the list can grow in one place.
 */
export const getAuditVocabulary = (req, res) => {
  res.json({ varianceReasons: VARIANCE_REASONS, frequencies: AUDIT_FREQUENCY_NAMES });
};
