import mongoose from "mongoose";
import StockDisposal from "../models/StockDisposal.js";
import IssueHistory from "../models/IssueHistory.js";
import RestockItem from "../models/RestockItem.js";
import Product from "../models/Product.js";
import Notification from "../models/Notification.js";
import { recordMovement } from "../utils/stockLedger.js";

const DISPOSAL_TYPES = ["Consumed", "Scrapped"];

const PREFIX = { Consumed: "CON", Scrapped: "SCR" };

const generateDisposalNumber = (type) =>
  `${PREFIX[type]}-${Math.floor(100000 + Math.random() * 900000)}`;

/**
 * Parse a `?from=`/`?to=` bound. Returns undefined for anything unusable so a
 * mistyped date widens the report rather than silently returning nothing.
 */
const parseDate = (raw) => {
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

/** Builds the `disposedAt` clause shared by the log and the summary. */
const periodFilter = (query) => {
  const from = parseDate(query.from);
  const to = parseDate(query.to);
  if (!from && !to) return null;
  return { ...(from && { $gte: from }), ...(to && { $lte: to }) };
};

/**
 * @desc    Record an issued or returned batch as Consumed or Scrapped.
 * @route   POST /api/disposals
 * @access  Private (Admin, Supervisor)
 *
 * This is the second and third of the three outcomes an issued item can have
 * (ST-19); returning is the first and lives in restockController.
 *
 * Neither outcome moves a store room balance. The stock was debited from its
 * room the moment it was issued, so consuming or scrapping it only closes out
 * what is still outstanding against the issue — booking a room decrement here
 * as well would take the same quantity out of stock twice. Scrap out of the
 * Red Stock Room is the one case that does change a balance, and it changes
 * Red Stock rather than a store room, by decrementing the batch itself.
 */
export const recordDisposal = async (req, res) => {
  const { type, issueId, restockItemId, quantity, reason } = req.body;

  try {
    if (!DISPOSAL_TYPES.includes(type)) {
      return res.status(400).json({
        message: `Disposal type must be one of: ${DISPOSAL_TYPES.join(", ")}`,
      });
    }
    if (!issueId && !restockItemId) {
      return res
        .status(400)
        .json({ message: "Either an issue or a Red Stock item must be named" });
    }
    if (issueId && restockItemId) {
      return res.status(400).json({
        message: "Name either an issue or a Red Stock item, not both",
      });
    }
    // Section 9 allows ISSUED → CONSUMED and (ISSUED | RED RACK) → SCRAPPED.
    // Consuming out of Red Stock is not a transition the lifecycle has: stock
    // that came back to the store gets re-shelved, not used up in place.
    if (restockItemId && type === "Consumed") {
      return res.status(400).json({
        message:
          "Red Stock can only be scrapped. Return it to stock first if it is to be used.",
      });
    }

    const source = issueId
      ? await IssueHistory.findById(issueId)
      : await RestockItem.findById(restockItemId);

    if (!source) {
      return res
        .status(404)
        .json({ message: issueId ? "Issue history not found" : "Red Stock item not found" });
    }

    // How much of the source is still available to dispose of.
    let available;
    if (issueId) {
      available = source.outstanding;
      if (available <= 0) {
        return res.status(400).json({
          message: `${source.issueNumber} is already fully accounted for`,
        });
      }
    } else {
      // A batch already claimed by an open weekly merge is spoken for: its
      // quantity is counted in that request's lines, and scrapping it here
      // would leave the Admin approving a merge for stock that no longer
      // exists. It has to leave the merge before it can be scrapped.
      if (source.status !== "In Red Stock") {
        return res.status(400).json({
          message: `${source.restockNumber} is "${source.status}" and cannot be scrapped from here`,
        });
      }
      available = source.quantity;
      if (available <= 0) {
        return res
          .status(400)
          .json({ message: `${source.restockNumber} has nothing left to scrap` });
      }
    }

    // Default to disposing of everything still outstanding.
    const qty =
      quantity === undefined || quantity === null ? available : Number(quantity);
    if (!Number.isInteger(qty) || qty < 1) {
      return res
        .status(400)
        .json({ message: "Quantity must be a whole number of at least 1" });
    }
    if (qty > available) {
      return res.status(400).json({
        message: `Cannot ${type.toLowerCase()} ${qty}. Only ${available} available on ${
          issueId ? source.issueNumber : source.restockNumber
        }`,
      });
    }

    const product = await Product.findById(source.product);
    if (!product) {
      return res.status(404).json({ message: "Engineering Stock no longer exists" });
    }

    const disposal = await StockDisposal.create({
      disposalNumber: generateDisposalNumber(type),
      type,
      product: product._id,
      productName: product.name,
      productCode: product.code,
      unit: product.unit,
      quantity: qty,
      // Snapshot: the scrap value of this event must not move when the
      // product is re-costed later.
      unitCost: product.unitCost || 0,
      // Both an issue and a Red Stock batch snapshot the room the stock was
      // drawn from; the product's home room is the fallback for the older
      // rows that carry neither.
      storeRoom: source.sourceRoom || product.storeRoom || "",
      source: issueId ? "Issue" : "Red Stock",
      sourceIssue: issueId ? source._id : null,
      sourceRestockItem: restockItemId ? source._id : null,
      reference: issueId ? source.issueNumber : source.restockNumber,
      department: issueId ? source.recipient : source.department,
      reason: (reason || "").trim(),
      disposedBy: req.user._id,
      disposedAt: new Date(),
    });

    // Close the quantity out against whichever source it came from.
    if (issueId) {
      if (type === "Consumed") {
        source.consumedQuantity = (source.consumedQuantity || 0) + qty;
      } else {
        source.scrappedQuantity = (source.scrappedQuantity || 0) + qty;
      }
      await source.save();
    } else {
      source.quantity -= qty;
      if (source.quantity === 0) source.status = "Scrapped";
      await source.save();
    }

    await recordMovement({
      product,
      type: type === "Consumed" ? "CONSUMED" : "SCRAPPED",
      // Main Stock is untouched — see the note at the top of this function.
      direction: "NONE",
      quantity: qty,
      reference: disposal.disposalNumber,
      performedBy: req.user._id,
      note:
        type === "Consumed"
          ? `Consumed against ${disposal.reference}${
              disposal.reason ? ` — ${disposal.reason}` : ""
            }`
          : `Scrapped from ${disposal.source} (${disposal.reference}); value ${disposal.value}${
              disposal.reason ? ` — ${disposal.reason}` : ""
            }`,
      fromRoom: issueId ? "" : "Red Stock Room",
    });

    await Notification.create({
      message:
        type === "Consumed"
          ? `Consumed: ${qty} × "${product.name}" against ${disposal.reference} by ${req.user.name} (${disposal.disposalNumber})`
          : `Scrapped: ${qty} × "${product.name}" worth ${disposal.value} by ${req.user.name} (${disposal.disposalNumber})`,
      type: "REQUEST_CREATED",
    });

    const populated = await StockDisposal.findById(disposal._id)
      .populate("product", "name code unit storeRoom image")
      .populate("disposedBy", "name email role");

    res.status(201).json({
      message: `${qty} ${product.unit} of "${product.name}" recorded as ${type.toLowerCase()}.`,
      disposal: populated,
      // What is left on the source, so the caller can refresh a row in place.
      outstanding: issueId ? source.outstanding : source.quantity,
      scrapValue: type === "Scrapped" ? disposal.value : 0,
    });
  } catch (error) {
    console.error("Error recording disposal:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    The consumption and scrap logs (ST-25, ST-26, ST-28).
 * @route   GET /api/disposals?type=Consumed|Scrapped&from=&to=&storeRoom=&productId=
 * @access  Private (Admin, Supervisor)
 *
 * History is never pruned, so this is also the audit read.
 */
export const getDisposals = async (req, res) => {
  try {
    const query = {};

    if (DISPOSAL_TYPES.includes(req.query.type)) {
      query.type = req.query.type;
    }
    if (req.query.storeRoom && req.query.storeRoom !== "All") {
      query.storeRoom = req.query.storeRoom;
    }
    if (mongoose.isValidObjectId(req.query.productId)) {
      query.product = req.query.productId;
    }
    if (req.query.scope === "mine") {
      query.disposedBy = req.user._id;
    }

    const period = periodFilter(req.query);
    if (period) query.disposedAt = period;

    const disposals = await StockDisposal.find(query)
      .populate("product", "name code unit storeRoom image")
      .populate("disposedBy", "name email role")
      .sort({ disposedAt: -1 });

    res.json(
      disposals.map((row) => ({
        ...row.toObject(),
        isMine: String(row.disposedBy?._id || row.disposedBy) === String(req.user._id),
      }))
    );
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Scrap value totalled per item, per store room and per period —
 *          the primary maintenance metric of ST-27 and section 10.
 * @route   GET /api/disposals/scrap-summary?from=&to=&groupBy=month|week|day
 * @access  Private (Admin, Supervisor)
 *
 * All three breakdowns come back in one response because the report page shows
 * them together, and running them as three round trips would let the totals
 * disagree if a scrap landed between two of the calls.
 */
export const getScrapSummary = async (req, res) => {
  try {
    const match = { type: "Scrapped" };
    const period = periodFilter(req.query);
    if (period) match.disposedAt = period;

    const GROUP_FORMATS = { day: "%Y-%m-%d", week: "%Y-W%V", month: "%Y-%m" };
    const format = GROUP_FORMATS[req.query.groupBy] || GROUP_FORMATS.month;

    const totalsOf = (idExpr) => [
      { $match: match },
      {
        $group: {
          _id: idExpr,
          quantity: { $sum: "$quantity" },
          value: { $sum: "$value" },
          events: { $sum: 1 },
        },
      },
      { $sort: { value: -1 } },
    ];

    const [byItem, byStoreRoom, byPeriod, overall] = await Promise.all([
      StockDisposal.aggregate([
        ...totalsOf({ product: "$product", name: "$productName", code: "$productCode" }),
        { $limit: 100 },
      ]),
      StockDisposal.aggregate(totalsOf("$storeRoom")),
      StockDisposal.aggregate([
        { $match: match },
        {
          $group: {
            _id: { $dateToString: { format, date: "$disposedAt" } },
            quantity: { $sum: "$quantity" },
            value: { $sum: "$value" },
            events: { $sum: 1 },
          },
        },
        // Chronological: this one is read as a trend, not a ranking.
        { $sort: { _id: 1 } },
      ]),
      StockDisposal.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            quantity: { $sum: "$quantity" },
            value: { $sum: "$value" },
            events: { $sum: 1 },
          },
        },
      ]),
    ]);

    res.json({
      total: overall[0]
        ? { quantity: overall[0].quantity, value: overall[0].value, events: overall[0].events }
        : { quantity: 0, value: 0, events: 0 },
      byItem: byItem.map((row) => ({
        productId: row._id.product,
        name: row._id.name,
        code: row._id.code,
        quantity: row.quantity,
        value: row.value,
        events: row.events,
      })),
      byStoreRoom: byStoreRoom.map((row) => ({
        storeRoom: row._id || "Unassigned",
        quantity: row.quantity,
        value: row.value,
        events: row.events,
      })),
      byPeriod: byPeriod.map((row) => ({
        period: row._id,
        quantity: row.quantity,
        value: row.value,
        events: row.events,
      })),
      groupBy: req.query.groupBy || "month",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
