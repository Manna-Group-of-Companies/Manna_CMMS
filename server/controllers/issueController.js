import IssueHistory from "../models/IssueHistory.js";
import Product from "../models/Product.js";
import Notification from "../models/Notification.js";
import { recordMovement } from "../utils/stockLedger.js";
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

    // 1. Reduce product quantity immediately
    product.quantity -= quantity;
    await product.save();

    // 2. Save issue history record
    const issue = await IssueHistory.create({
      issueNumber,
      product: productId,
      quantity,
      recipient: recipient.trim(),
      purpose: purpose ? purpose.trim() : "",
      supervisor: supervisorId,
    });

    // 3. Ledger entry so the movement page can trace the decrement
    await recordMovement({
      product,
      type: "ISSUE",
      direction: "OUT",
      quantity,
      reference: issueNumber,
      performedBy: supervisorId,
      note: `Issued to ${recipient.trim()}`,
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
      .populate("supervisor", "name email");

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
// @route   GET /api/issues
// @access  Private (Admin and Supervisor)
export const getIssueHistory = async (req, res) => {
  try {
    let query = {};

    // If Supervisor, only show their own issues
    if (req.user.role === "Supervisor") {
      query.supervisor = req.user._id;
    }

    const issues = await IssueHistory.find(query)
      .populate("product", "name code unit storeRoom image")
      .populate("supervisor", "name email")
      .sort({ createdAt: -1 });

    res.json(issues);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Return an issued product into the Restock section
// @route   PUT /api/issues/:id/return
// @access  Private (Supervisor)
//
// Returns never restore Main Stock directly — this is a thin alias over
// POST /api/restock/returns kept so the issue-centric URL still works. The
// body must carry a return reason, same as the canonical endpoint.
export const returnIssueProduct = (req, res) => {
  req.body = { ...req.body, issueId: req.params.id };
  return returnIssuedStock(req, res);
};
