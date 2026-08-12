import IssueHistory from "../models/IssueHistory.js";
import Product from "../models/Product.js";
import RestockItem from "../models/RestockItem.js";
import Notification from "../models/Notification.js";
import { recordMovement } from "../utils/stockLedger.js";

const generateRestockNumber = () => `RT-${Math.floor(100000 + Math.random() * 900000)}`;

const RETURN_CONDITIONS = ["Good", "Damaged", "Repairable", "Expired"];

/**
 * @desc    Return issued stock into the Restock section (never into Main Stock)
 * @route   POST /api/restock/returns
 * @access  Private (Supervisor)
 */
export const returnIssuedStock = async (req, res) => {
  const { issueId, quantity, reason, condition, department } = req.body;

  try {
    if (!issueId) {
      return res.status(400).json({ message: "Issue ID is required" });
    }
    if (!reason || !reason.trim()) {
      return res.status(400).json({ message: "A return reason is required" });
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

    // Only the supervisor who issued the stock can return it.
    if (issue.supervisor.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized to return this issue" });
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
      reason: reason.trim(),
      condition: condition || "Good",
      returnedBy: req.user._id,
      department: (department && department.trim()) || issue.recipient,
      returnDate: new Date(),
      sourceIssue: issue._id,
    });

    issue.returnedQuantity = (issue.returnedQuantity || 0) + returnQty;
    issue.returnStatus =
      issue.returnedQuantity >= issue.quantity ? "Returned" : "Partially Returned";
    await issue.save();

    // Main Stock is deliberately untouched — the stock is parked in Restock.
    await recordMovement({
      product,
      type: "RETURN_TO_RESTOCK",
      direction: "NONE",
      quantity: returnQty,
      reference: restockItem.restockNumber,
      performedBy: req.user._id,
      note: `Returned from ${issue.issueNumber}; awaiting merge approval`,
    });

    // Admin-facing: something new is waiting in Restock.
    await Notification.create({
      message: `Restock pending: ${returnQty} × "${product.name}" returned by ${req.user.name} (${restockItem.restockNumber})`,
      type: "STOCK_RETURNED",
    });

    const populated = await RestockItem.findById(restockItem._id)
      .populate("product", "name code unit storeRoom image")
      .populate("returnedBy", "name email");

    res.status(201).json({
      message: `Returned ${returnQty} ${product.unit} of "${product.name}" to Restock. Awaiting weekly merge approval.`,
      restockItem: populated,
      outstanding: issue.quantity - issue.returnedQuantity,
    });
  } catch (error) {
    console.error("Error returning stock to restock:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    List restock items. Admins see everything; supervisors see their own.
 * @route   GET /api/restock?status=Restock%20Pending
 * @access  Private
 */
export const getRestockItems = async (req, res) => {
  try {
    const query = {};

    if (req.user.role === "Supervisor") {
      query.returnedBy = req.user._id;
    }

    const { status } = req.query;
    if (status && status !== "All") {
      query.status = status;
    }

    const items = await RestockItem.find(query)
      .populate("product", "name code unit storeRoom image")
      .populate("returnedBy", "name email")
      .populate("sourceIssue", "issueNumber recipient")
      .populate("mergeRequest", "requestId status")
      .sort({ createdAt: -1 });

    res.json(items);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Restock totals for the Admin's weekly review header
 * @route   GET /api/restock/summary
 * @access  Private (Admin)
 */
export const getRestockSummary = async (req, res) => {
  try {
    const grouped = await RestockItem.aggregate([
      { $group: { _id: "$status", items: { $sum: 1 }, quantity: { $sum: "$quantity" } } },
    ]);

    const summary = {
      "Restock Pending": { items: 0, quantity: 0 },
      "Merge Requested": { items: 0, quantity: 0 },
      Merged: { items: 0, quantity: 0 },
      "Merge Rejected": { items: 0, quantity: 0 },
    };

    for (const row of grouped) {
      if (summary[row._id]) {
        summary[row._id] = { items: row.items, quantity: row.quantity };
      }
    }

    // Everything an Admin could still pull into a merge request this week.
    summary.awaitingMerge = {
      items: summary["Restock Pending"].items + summary["Merge Rejected"].items,
      quantity: summary["Restock Pending"].quantity + summary["Merge Rejected"].quantity,
    };

    res.json(summary);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
