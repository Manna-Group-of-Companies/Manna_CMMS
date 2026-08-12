import mongoose from "mongoose";
import MergeRequest from "../models/MergeRequest.js";
import RestockItem from "../models/RestockItem.js";
import Product from "../models/Product.js";
import Notification from "../models/Notification.js";
import { recordMovement } from "../utils/stockLedger.js";

/**
 * MERGE-YYYYMM-NNN, where NNN restarts each calendar month. Merge reviews are
 * a weekly ritual, so a date-anchored id is easier to talk about than a
 * random one.
 */
const generateRequestId = async (now = new Date()) => {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `MERGE-${year}${month}`;

  const countThisMonth = await MergeRequest.countDocuments({
    requestId: { $regex: `^${prefix}-` },
  });

  return `${prefix}-${String(countThisMonth + 1).padStart(3, "0")}`;
};

/**
 * @desc    Open a merge request over selected restock items
 * @route   POST /api/merge-requests
 * @access  Private (Admin)
 */
export const createMergeRequest = async (req, res) => {
  const { restockItemIds, comment } = req.body;

  try {
    if (!Array.isArray(restockItemIds) || restockItemIds.length === 0) {
      return res.status(400).json({ message: "Select at least one restock item to merge" });
    }

    const validIds = restockItemIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (validIds.length !== restockItemIds.length) {
      return res.status(400).json({ message: "One or more restock item ids are invalid" });
    }

    const items = await RestockItem.find({ _id: { $in: validIds } });

    if (items.length !== validIds.length) {
      return res.status(404).json({ message: "One or more restock items no longer exist" });
    }

    // An item already sitting in an open request must not be double-counted.
    const unavailable = items.filter(
      (item) => !RestockItem.MERGEABLE_STATUSES.includes(item.status)
    );
    if (unavailable.length > 0) {
      return res.status(400).json({
        message: `These items are not available to merge: ${unavailable
          .map((item) => `${item.restockNumber} (${item.status})`)
          .join(", ")}`,
      });
    }

    const requestId = await generateRequestId();

    const mergeRequest = await MergeRequest.create({
      requestId,
      items: items.map((item) => ({
        restockItem: item._id,
        product: item.product,
        productName: item.productName,
        unit: item.unit,
        quantity: item.quantity,
      })),
      itemCount: items.length,
      totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
      requestedBy: req.user._id,
      requestedAt: new Date(),
      comment: (comment || "").trim(),
    });

    // Lock the items to this request. No stock moves yet.
    await RestockItem.updateMany(
      { _id: { $in: items.map((item) => item._id) } },
      { status: "Merge Requested", mergeRequest: mergeRequest._id, rejectionReason: "" }
    );

    await Notification.create({
      message: `Merge request ${requestId} raised by ${req.user.name}: ${mergeRequest.totalQuantity} pcs across ${mergeRequest.itemCount} item(s), pending approval`,
      type: "MERGE_REQUESTED",
    });

    const populated = await MergeRequest.findById(mergeRequest._id)
      .populate("requestedBy", "name email")
      .populate("items.product", "name code unit storeRoom image");

    res.status(201).json({
      message: `Merge request ${requestId} created and is pending approval`,
      mergeRequest: populated,
    });
  } catch (error) {
    console.error("Error creating merge request:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    List merge requests (open plus history)
 * @route   GET /api/merge-requests?status=Pending%20Approval
 * @access  Private (Admin)
 */
export const getMergeRequests = async (req, res) => {
  try {
    const query = {};
    const { status } = req.query;
    if (status && status !== "All") {
      query.status = status;
    }

    const requests = await MergeRequest.find(query)
      .populate("requestedBy", "name email")
      .populate("reviewedBy", "name email")
      .populate("items.product", "name code unit storeRoom image")
      .sort({ createdAt: -1 });

    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    One merge request with its restock items resolved
 * @route   GET /api/merge-requests/:id
 * @access  Private (Admin)
 */
export const getMergeRequestById = async (req, res) => {
  try {
    const request = await MergeRequest.findById(req.params.id)
      .populate("requestedBy", "name email")
      .populate("reviewedBy", "name email")
      .populate("items.product", "name code unit storeRoom image")
      .populate("items.restockItem");

    if (!request) {
      return res.status(404).json({ message: "Merge request not found" });
    }

    res.json(request);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Approve a merge request — the only path back into Main Stock
 * @route   PUT /api/merge-requests/:id/approve
 * @access  Private (Admin)
 */
export const approveMergeRequest = async (req, res) => {
  const { comment } = req.body;

  try {
    const request = await MergeRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ message: "Merge request not found" });
    }
    if (request.status !== "Pending Approval") {
      return res.status(400).json({
        message: `This merge request has already been resolved (${request.status})`,
      });
    }

    const merged = [];

    for (const line of request.items) {
      const restockItem = await RestockItem.findById(line.restockItem);
      // Skip anything that vanished or was already merged rather than
      // double-counting it into Main Stock.
      if (!restockItem || restockItem.status === "Merged") continue;

      const product = await Product.findById(line.product);
      if (!product) {
        console.warn(`Merge ${request.requestId}: product ${line.product} missing, skipping line`);
        continue;
      }

      product.quantity += line.quantity;
      await product.save();

      restockItem.status = "Merged";
      restockItem.mergedAt = new Date();
      restockItem.rejectionReason = "";
      await restockItem.save();

      await recordMovement({
        product,
        type: "MERGE_IN",
        direction: "IN",
        quantity: line.quantity,
        reference: request.requestId,
        performedBy: req.user._id,
        note: `Merged from restock ${restockItem.restockNumber}`,
      });

      merged.push({
        restockNumber: restockItem.restockNumber,
        productName: product.name,
        quantity: line.quantity,
        newBalance: product.quantity,
        returnedBy: restockItem.returnedBy,
      });
    }

    request.status = "Merged Successfully";
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    request.rejectionReason = "";
    if (comment && comment.trim()) request.comment = comment.trim();
    await request.save();

    // Tell each supervisor whose returns made it back into Main Stock.
    const supervisorIds = [...new Set(merged.map((entry) => String(entry.returnedBy)))];
    await Promise.all(
      supervisorIds.map((supervisorId) =>
        Notification.create({
          user: supervisorId,
          message: `Your returned stock has been merged into Main Stock (${request.requestId})`,
          type: "MERGE_APPROVED",
        })
      )
    );

    await Notification.create({
      message: `Merge ${request.requestId} approved by ${req.user.name}: ${request.totalQuantity} pcs moved into Main Stock`,
      type: "MERGE_APPROVED",
    });

    const populated = await MergeRequest.findById(request._id)
      .populate("requestedBy", "name email")
      .populate("reviewedBy", "name email")
      .populate("items.product", "name code unit storeRoom image");

    res.json({
      message: `Merge ${request.requestId} completed. ${merged.length} item(s) moved into Main Stock.`,
      mergeRequest: populated,
      merged,
    });
  } catch (error) {
    console.error("Error approving merge request:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Reject a merge request — stock stays in Restock
 * @route   PUT /api/merge-requests/:id/reject
 * @access  Private (Admin)
 */
export const rejectMergeRequest = async (req, res) => {
  const { rejectionReason } = req.body;

  try {
    if (!rejectionReason || !rejectionReason.trim()) {
      return res.status(400).json({ message: "A rejection reason is required" });
    }

    const request = await MergeRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ message: "Merge request not found" });
    }
    if (request.status !== "Pending Approval") {
      return res.status(400).json({
        message: `This merge request has already been resolved (${request.status})`,
      });
    }

    const reason = rejectionReason.trim();

    // The stock never left Restock, so rejection only relabels it. Items go
    // back to being selectable for a later merge.
    await RestockItem.updateMany(
      { mergeRequest: request._id, status: "Merge Requested" },
      { status: "Merge Rejected", rejectionReason: reason }
    );

    request.status = "Merge Rejected";
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    request.rejectionReason = reason;
    await request.save();

    const restockItems = await RestockItem.find({ mergeRequest: request._id });
    const supervisorIds = [...new Set(restockItems.map((item) => String(item.returnedBy)))];
    await Promise.all(
      supervisorIds.map((supervisorId) =>
        Notification.create({
          user: supervisorId,
          message: `Merge ${request.requestId} was rejected — your returned stock stays in Restock. Reason: ${reason}`,
          type: "MERGE_REJECTED",
        })
      )
    );

    await Notification.create({
      message: `Merge ${request.requestId} rejected by ${req.user.name}. Reason: ${reason}`,
      type: "MERGE_REJECTED",
    });

    const populated = await MergeRequest.findById(request._id)
      .populate("requestedBy", "name email")
      .populate("reviewedBy", "name email")
      .populate("items.product", "name code unit storeRoom image");

    res.json({
      message: `Merge ${request.requestId} rejected. Stock remains in Restock.`,
      mergeRequest: populated,
    });
  } catch (error) {
    console.error("Error rejecting merge request:", error);
    res.status(500).json({ message: error.message });
  }
};
