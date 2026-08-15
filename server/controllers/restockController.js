import IssueHistory from "../models/IssueHistory.js";
import Product from "../models/Product.js";
import RestockItem from "../models/RestockItem.js";
import Notification from "../models/Notification.js";
import { recordMovement } from "../utils/stockLedger.js";
import { weekWindowFor, nextMergeRunAt } from "../utils/weeklyMerge.js";

const generateRestockNumber = () => `RT-${Math.floor(100000 + Math.random() * 900000)}`;

const RETURN_CONDITIONS = ["Good", "Damaged", "Repairable", "Expired"];

/**
 * @desc    Return issued stock into the Red Stock Room. No Admin approval —
 *          the stock is in Red Stock the moment this succeeds.
 * @route   POST /api/red-stock/returns
 * @access  Private (Supervisor)
 *
 * Any supervisor may return any issue. The supervisors run one store between
 * them, so whoever the recipient hands the stock back to is the one who books
 * it in — waiting for the supervisor who issued it to come on shift would
 * leave the stock unaccounted for. `returnedBy` records who did the booking,
 * which is not necessarily who issued it.
 */
export const returnIssuedStock = async (req, res) => {
  const { issueId, quantity, condition, department } = req.body;

  try {
    if (!issueId) {
      return res.status(400).json({ message: "Issue ID is required" });
    }
    if (condition && !RETURN_CONDITIONS.includes(condition)) {
      return res.status(400).json({
        message: `Stock condition must be one of: ${RETURN_CONDITIONS.join(", ")}`,
      });
    }

    const issue = await IssueHistory.findById(issueId);
    if (!issue) {
      return res.status(404).json({ message: "Issue history not found" });
    }

    const outstanding = issue.quantity - (issue.returnedQuantity || 0);
    if (outstanding <= 0) {
      return res.status(400).json({ message: "This issue has already been fully returned" });
    }

    // Default to returning everything still outstanding.
    const returnQty = quantity === undefined || quantity === null ? outstanding : Number(quantity);
    if (!Number.isInteger(returnQty) || returnQty < 1) {
      return res.status(400).json({ message: "Return quantity must be a whole number of at least 1" });
    }
    if (returnQty > outstanding) {
      return res.status(400).json({
        message: `Cannot return ${returnQty}. Only ${outstanding} still outstanding on ${issue.issueNumber}`,
      });
    }

    const product = await Product.findById(issue.product);
    if (!product) {
      return res.status(404).json({ message: "Product no longer exists" });
    }

    const restockItem = await RestockItem.create({
      restockNumber: generateRestockNumber(),
      product: product._id,
      productName: product.name,
      productCode: product.code,
      unit: product.unit,
      quantity: returnQty,
      condition: condition || "Good",
      returnedBy: req.user._id,
      department: (department && department.trim()) || issue.recipient,
      returnDate: new Date(),
      sourceIssue: issue._id,
      sourceRoom: issue.sourceRoom || product.storeRoom || "",
      status: "In Red Stock",
    });

    issue.returnedQuantity = (issue.returnedQuantity || 0) + returnQty;
    issue.returnStatus =
      issue.returnedQuantity >= issue.quantity ? "Returned" : "Partially Returned";
    await issue.save();

    // The store rooms are deliberately untouched — the stock sits
    // in Red Stock until an approved weekly merge moves it.
    await recordMovement({
      product,
      type: "RETURN_TO_RED_STOCK",
      direction: "NONE",
      quantity: returnQty,
      reference: restockItem.restockNumber,
      performedBy: req.user._id,
      note: `Returned from ${issue.issueNumber} into Red Stock; awaiting the weekly merge`,
      fromRoom: restockItem.sourceRoom,
      toRoom: "Red Stock Room",
    });

    // Admin-facing: visibility only, there is nothing for them to approve yet.
    await Notification.create({
      message: `Red Stock: ${returnQty} × "${product.name}" returned by ${req.user.name} (${restockItem.restockNumber})`,
      type: "STOCK_RETURNED",
    });

    const populated = await RestockItem.findById(restockItem._id)
      .populate("product", "name code unit storeRoom image")
      .populate("returnedBy", "name email role")
      .populate("sourceIssue", "issueNumber recipient sourceRoom");

    res.status(201).json({
      message: `Returned ${returnQty} ${product.unit} of "${product.name}" to the Red Stock Room.`,
      restockItem: populated,
      outstanding: issue.quantity - issue.returnedQuantity,
    });
  } catch (error) {
    console.error("Error returning stock to Red Stock:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    The Red Stock Room. Admins and supervisors alike see every return —
 *          what came back, who returned it and when. `?scope=mine` narrows it
 *          to the caller's own returns.
 * @route   GET /api/red-stock?status=In%20Red%20Stock&scope=all|mine
 * @access  Private
 *
 * Reading is open; asking for a merge is not. `requestSupervisorMerge` only
 * ever picks up the caller's own items, so a supervisor cannot move someone
 * else's stock out of Red Stock from here.
 */
export const getRestockItems = async (req, res) => {
  try {
    const query = {};

    if (req.query.scope === "mine") {
      query.returnedBy = req.user._id;
    }

    const { status } = req.query;
    if (status && status !== "All") {
      query.status = status;
    }

    const items = await RestockItem.find(query)
      .populate("product", "name code unit storeRoom image")
      .populate("returnedBy", "name email role")
      .populate("sourceIssue", "issueNumber recipient sourceRoom")
      .populate("mergeRequest", "requestId status weekKey destinationRoom")
      .sort({ createdAt: -1 });

    // Weekly merge eligibility is a property of the status, so it is derived
    // here rather than stored and kept in sync. `isMine` is what the UI counts
    // when it offers to raise a merge — the server scopes that request anyway.
    res.json(
      items.map((item) => ({
        ...item.toObject(),
        eligibleForWeeklyMerge: RestockItem.MERGEABLE_STATUSES.includes(item.status),
        isMine:
          String(item.returnedBy?._id || item.returnedBy) === String(req.user._id),
      }))
    );
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Red Stock totals for the Admin's weekly review header
 * @route   GET /api/red-stock/summary
 * @access  Private (Admin)
 */
export const getRestockSummary = async (req, res) => {
  try {
    const grouped = await RestockItem.aggregate([
      { $group: { _id: "$status", items: { $sum: 1 }, quantity: { $sum: "$quantity" } } },
    ]);

    const summary = {
      "In Red Stock": { items: 0, quantity: 0 },
      "Weekly Merge Pending": { items: 0, quantity: 0 },
      "Moved to Stock Room": { items: 0, quantity: 0 },
    };

    for (const row of grouped) {
      if (summary[row._id]) {
        summary[row._id] = { items: row.items, quantity: row.quantity };
      }
    }

    // What the next weekly merge would pick up.
    summary.awaitingMerge = summary["In Red Stock"];
    summary.week = weekWindowFor();
    summary.nextMergeRunAt = nextMergeRunAt();

    res.json(summary);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    The Red Stock Room as a room: contents rolled up per product, the
 *          same shape the store rooms are read in
 * @route   GET /api/red-stock/room
 * @access  Private
 */
export const getRedStockRoom = async (req, res) => {
  try {
    const items = await RestockItem.find({
      status: { $in: ["In Red Stock", "Weekly Merge Pending"] },
    })
      .populate("product", "name code unit image")
      .sort({ returnDate: -1 });

    const byProduct = new Map();
    for (const item of items) {
      const key = String(item.product?._id || item.product);
      const row = byProduct.get(key) || {
        productId: key,
        name: item.productName,
        code: item.productCode,
        unit: item.unit,
        image: item.product?.image || "",
        quantity: 0,
        awaitingMerge: 0,
        inOpenMerge: 0,
      };
      row.quantity += item.quantity;
      if (item.status === "In Red Stock") row.awaitingMerge += item.quantity;
      else row.inOpenMerge += item.quantity;
      byProduct.set(key, row);
    }

    const rows = [...byProduct.values()].sort((a, b) => b.quantity - a.quantity);

    res.json({
      name: "Red Stock Room",
      itemCount: rows.length,
      totalQuantity: rows.reduce((sum, row) => sum + row.quantity, 0),
      items: rows,
      week: weekWindowFor(),
      nextMergeRunAt: nextMergeRunAt(),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
