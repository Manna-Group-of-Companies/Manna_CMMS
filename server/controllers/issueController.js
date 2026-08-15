import IssueHistory from "../models/IssueHistory.js";
import Product from "../models/Product.js";
import RestockItem from "../models/RestockItem.js";
import Notification from "../models/Notification.js";
import { recordMovement } from "../utils/stockLedger.js";
import { debitAcrossRooms } from "../utils/stockRooms.js";
import { returnIssuedStock } from "./restockController.js";

// Helper to generate unique issue numbers
const generateIssueNumber = () => {
  const randomStr = Math.floor(100000 + Math.random() * 900000);
  return `ISS-${randomStr}`;
};

// @desc    Issue a product (direct stock reduction by Supervisor)
// @route   POST /api/issues
// @access  Private (Supervisor only)
export const issueProduct = async (req, res) => {
  const { productId, quantity, recipient, purpose } = req.body;
  const supervisorId = req.user._id;

  try {
    // Validate inputs
    if (!productId || !quantity || quantity < 1) {
      return res.status(400).json({ message: "Valid Product ID and Quantity (>= 1) are required" });
    }
    if (!recipient || !recipient.trim()) {
      return res.status(400).json({ message: "Recipient is required" });
    }

    // Find product
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Check sufficient stock
    if (product.quantity < quantity) {
      return res.status(400).json({
        message: `Insufficient stock. Available: ${product.quantity} ${product.unit}, Requested: ${quantity}`,
      });
    }

    // Generate issue number
    const issueNumber = generateIssueNumber();

    // 1. Reduce stock immediately, drawing from the product's home room first
    // so the room balances stay the source of truth.
    const { drawn } = await debitAcrossRooms({
      product,
      preferredRoom: product.storeRoom,
      quantity,
    });

    // 2. Save issue history record
    const issue = await IssueHistory.create({
      issueNumber,
      product: productId,
      quantity,
      recipient: recipient.trim(),
      purpose: purpose ? purpose.trim() : "",
      supervisor: supervisorId,
      sourceRoom: drawn.map((entry) => entry.room).join(", "),
    });

    // 3. Ledger entry so the movement page can trace the decrement
    await recordMovement({
      product,
      type: "ISSUE",
      direction: "OUT",
      quantity,
      reference: issueNumber,
      performedBy: supervisorId,
      note: `Issued to ${recipient.trim()} from ${drawn
        .map((entry) => `${entry.room} (${entry.quantity})`)
        .join(", ")}`,
    });

    // 4. Low stock notification if quantity dropped below threshold
    if (product.quantity <= product.minStock) {
      await Notification.create({
        message: `Alert: "${product.name}" has hit low stock after issuance (${product.quantity} ${product.unit} left in ${product.storeRoom})`,
        type: "LOW_STOCK",
      });
    }

    // 5. Notify admin about the issuance
    await Notification.create({
      message: `Product issued: ${quantity} × "${product.name}" to "${recipient.trim()}" by ${req.user.name} (${issueNumber})`,
      type: "REQUEST_CREATED",
    });

    // Populate product info for the response
    const populatedIssue = await IssueHistory.findById(issue._id)
      .populate("product", "name code unit storeRoom image")
      .populate("supervisor", "name email role");

    res.status(201).json({
      message: `Successfully issued ${quantity} ${product.unit} of "${product.name}" to ${recipient.trim()}`,
      issue: populatedIssue,
      updatedStock: product.quantity,
    });
  } catch (error) {
    console.error("Error issuing product:", error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get all issue history records
// @route   GET /api/issues?scope=all|mine
// @access  Private (Admin and Supervisor)
//
// Supervisors share one store, so they read the same history: every issue,
// who made it and when. `?scope=mine` narrows it to the caller. Any supervisor
// may return any issue — see `returnIssuedStock`.
//
// A fully returned issue is closed business, so it drops off the supervisors'
// list entirely — whoever issued it and whoever returned it alike — leaving
// only rows with stock still out with a recipient. The Admin keeps the whole
// record: theirs is the audit view, and nothing is deleted either way.
export const getIssueHistory = async (req, res) => {
  try {
    const query = req.query.scope === "mine" ? { supervisor: req.user._id } : {};
    if (req.user.role === "Supervisor") {
      query.returnStatus = { $ne: "Returned" };
    }

    const issues = await IssueHistory.find(query)
      .populate("product", "name code unit storeRoom image")
      .populate("supervisor", "name email role")
      .sort({ createdAt: -1 });

    // The issue itself only counts how much came back. Who handed each batch
    // over, when, and in what condition lives on the Red Stock items raised
    // against it — one per return, since a return may be partial and repeated.
    const returnsByIssue = new Map();
    const restockItems = await RestockItem.find({
      sourceIssue: { $in: issues.map((issue) => issue._id) },
    })
      .populate("returnedBy", "name email role")
      .sort({ returnDate: 1 })
      .lean();

    for (const item of restockItems) {
      const key = String(item.sourceIssue);
      if (!returnsByIssue.has(key)) returnsByIssue.set(key, []);
      returnsByIssue.get(key).push({
        _id: item._id,
        restockNumber: item.restockNumber,
        quantity: item.quantity,
        condition: item.condition,
        department: item.department,
        returnDate: item.returnDate,
        // Null once the account is deleted; the UI falls back to "Unknown".
        returnedBy: item.returnedBy
          ? { name: item.returnedBy.name, email: item.returnedBy.email, role: item.returnedBy.role }
          : null,
        // Where it has got to since: still in Red Stock, or merged into a room.
        status: item.status,
        destinationRoom: item.destinationRoom || "",
        mergedAt: item.mergedAt || null,
      });
    }

    // `isMine` only labels the row as the caller's own — returning is open to
    // every supervisor, so nothing is gated on it.
    res.json(
      issues.map((issue) => ({
        ...issue.toObject(),
        returns: returnsByIssue.get(String(issue._id)) || [],
        isMine:
          String(issue.supervisor?._id || issue.supervisor) === String(req.user._id),
      }))
    );
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Return an issued product into the Red Stock Room
// @route   PUT /api/issues/:id/return
// @access  Private (Supervisor)
//
// Returns never restore a store room directly — this is a thin alias over
// POST /api/red-stock/returns kept so the issue-centric URL still works.
export const returnIssueProduct = (req, res) => {
  req.body = { ...req.body, issueId: req.params.id };
  return returnIssuedStock(req, res);
};
