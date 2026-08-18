import mongoose from "mongoose";
import StockAudit from "../models/StockAudit.js";
import StockRoom from "../models/StockRoom.js";
import StockRoomInventory from "../models/StockRoomInventory.js";
import Product from "../models/Product.js";
import Notification from "../models/Notification.js";

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

/**
 * Draws up the count sheet for a room: one line per product the room is
 * holding stock of.
 *
 * Products the room holds nothing of are left off. The catalog runs to several
 * thousand items and all but a handful of them sit in one room, so listing
 * every product against every room would bury the count that matters under
 * pages of zeroes. Stock that turns up on a shelf the system did not expect is
 * added to the sheet as it is found — see `addAuditLine`.
 */
const buildLines = async (room) => {
  const rows = await StockRoomInventory.find({ stockRoom: room._id, quantity: { $gt: 0 } })
    .populate("product", "name code unit category rackNumber unitCost")
    .sort({ quantity: -1 });

  return rows
    // A row whose product was deleted has nothing left to count.
    .filter((row) => row.product)
    .map((row) => ({
      product: row.product._id,
      productName: row.product.name,
      productCode: row.product.code || "",
      unit: row.product.unit || "",
      category: row.product.category || "",
      rackNumber: row.product.rackNumber || "",
      systemQuantity: row.quantity,
      countedQuantity: null,
      unitCost: row.product.unitCost || 0,
    }));
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
 */
export const openAudit = async (req, res) => {
  const { stockRoomId, period: requestedPeriod } = req.body;

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
      return res.json({
        message: `Resuming the ${period} count of ${room.name}`,
        audit: asCountSheet(await populated(StockAudit.findById(existing._id))),
      });
    }

    const lines = await buildLines(room);
    if (lines.length === 0) {
      return res.status(400).json({
        message: `${room.name} holds no stock, so there is nothing to count`,
      });
    }

    let audit;
    try {
      audit = await StockAudit.create({
        auditNumber: generateAuditNumber(period),
        period,
        stockRoom: room._id,
        stockRoomName: room.name,
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
      message: `${period} count of ${room.name} opened with ${lines.length} lines`,
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
 * Each saved line's `systemQuantity` is refreshed to the room's balance as it
 * stands now. The count is a statement about this moment, so it is scored
 * against what the system believes at this moment — otherwise stock issued
 * while the count was under way reads as a counting error.
 */
export const saveAuditCounts = async (req, res) => {
  const { counts } = req.body;

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

      if (entry.note !== undefined) {
        line.note = String(entry.note || "").trim();
      }
      saved += 1;
    }

    if (saved === 0) {
      return res.status(400).json({ message: "None of those lines are on this sheet" });
    }

    if (req.body.note !== undefined) {
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
  const { productId, countedQuantity, note } = req.body;

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
      systemQuantity: row?.quantity ?? 0,
      countedQuantity: counted,
      unitCost: product.unitCost || 0,
      countedAt: new Date(),
      countedBy: req.user._id,
      note: String(note || "").trim(),
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
 * @desc    Close the count and post its score (ST-37).
 * @route   POST /api/audits/:id/submit
 * @access  Private (Admin, Supervisor — the counter or an Admin)
 *
 * Submitting freezes the sheet. The score is not recomputed here — the hook on
 * the model has kept it in step with every save — so what the counter saw on
 * screen is exactly what the Admin is shown.
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

    if (req.body.note !== undefined) {
      audit.note = String(req.body.note || "").trim();
    }
    audit.status = "Submitted";
    audit.submittedBy = req.user._id;
    audit.submittedAt = new Date();
    await audit.save();

    await Notification.create({
      message: `${audit.period} audit of ${audit.stockRoomName} submitted by ${req.user.name}: scored ${audit.score}% over ${audit.linesTotal} lines, ${audit.linesOver + audit.linesShort} discrepancies worth ${audit.varianceValue} (${audit.auditNumber})`,
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
    audit.reviewNote = String(req.body.note || "").trim();
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
