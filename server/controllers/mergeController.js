import MergeRequest from "../models/MergeRequest.js";
import RestockItem from "../models/RestockItem.js";
import Product from "../models/Product.js";
import StockRoom from "../models/StockRoom.js";
import Notification from "../models/Notification.js";
import { recordMovement } from "../utils/stockLedger.js";
import { creditRoom, resolveRoom, roomBreakdownFor } from "../utils/stockRooms.js";
import {
  runWeeklyMerge,
  requestSupervisorMerge,
  weekWindowFor,
  mergeForWeek,
  openMergeRequest,
  eligibleRedStock,
  nextMergeRunAt,
} from "../utils/weeklyMerge.js";

/**
 * @desc    Raise this week's Red Stock merge request
 * @route   POST /api/merge-requests/weekly
 * @access  Private (Admin)
 *
 * The scheduler normally does this; the endpoint lets an Admin run the week's
 * merge early. Either way only one merge per week reaches approval.
 */
export const createWeeklyMergeRequest = async (req, res) => {
  const { comment, restockItemIds } = req.body || {};

  try {
    const result = await runWeeklyMerge({
      user: req.user,
      comment,
      restockItemIds: Array.isArray(restockItemIds) && restockItemIds.length ? restockItemIds : null,
      createdVia: "Manual",
    });

    if (!result.created) {
      return res.status(409).json({ message: result.reason, mergeRequest: result.mergeRequest });
    }

    res.status(201).json({ message: result.reason, mergeRequest: result.mergeRequest });
  } catch (error) {
    console.error("Error creating weekly merge request:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Supervisor asks for their own Red Stock to be merged into a store
 *          room, instead of waiting for the weekly run
 * @route   POST /api/merge-requests/mine
 * @access  Private (Supervisor)
 *
 * Nothing moves here: this puts the request on the Admin's desk, and the
 * supervisor follows it from their Red Stock Room screen.
 */
export const createSupervisorMergeRequest = async (req, res) => {
  const { comment, restockItemIds } = req.body || {};

  try {
    const result = await requestSupervisorMerge({
      user: req.user,
      comment,
      restockItemIds:
        Array.isArray(restockItemIds) && restockItemIds.length ? restockItemIds : null,
    });

    if (!result.created) {
      return res.status(409).json({ message: result.reason, mergeRequest: result.mergeRequest });
    }

    res.status(201).json({ message: result.reason, mergeRequest: result.mergeRequest });
  } catch (error) {
    console.error("Error creating supervisor merge request:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    The merges a supervisor has raised, newest first, so they can see
 *          where each one stands
 * @route   GET /api/merge-requests/mine
 * @access  Private (Supervisor)
 */
export const getMyMergeRequests = async (req, res) => {
  try {
    const requests = await MergeRequest.find({
      createdVia: "Supervisor",
      requestedBy: req.user._id,
    })
      .populate("reviewedBy", "name email role")
      .populate("items.product", "name code unit image")
      .sort({ createdAt: -1 })
      .limit(25);

    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Where this week stands: what is in Red Stock, whether the merge has
 *          been raised, and when the next one is due
 * @route   GET /api/merge-requests/weekly/status
 * @access  Private (Admin)
 */
export const getWeeklyMergeStatus = async (req, res) => {
  try {
    const window = weekWindowFor();
    const [thisWeek, open, eligible] = await Promise.all([
      mergeForWeek(window.weekKey),
      openMergeRequest(),
      eligibleRedStock(),
    ]);

    // Grouped the way the merge request itself reads: one line per product.
    const byProduct = new Map();
    for (const item of eligible) {
      const key = String(item.product?._id || item.product);
      const row = byProduct.get(key) || {
        productId: key,
        productName: item.productName,
        unit: item.unit,
        quantity: 0,
        returns: 0,
      };
      row.quantity += item.quantity;
      row.returns += 1;
      byProduct.set(key, row);
    }

    res.json({
      ...window,
      nextMergeRunAt: nextMergeRunAt(),
      alreadyMerged: Boolean(thisWeek),
      thisWeekRequest: thisWeek
        ? {
            _id: thisWeek._id,
            requestId: thisWeek.requestId,
            status: thisWeek.status,
            totalQuantity: thisWeek.totalQuantity,
            itemCount: thisWeek.itemCount,
          }
        : null,
      openRequestId: open?.requestId || null,
      eligibleItems: eligible.length,
      eligibleQuantity: eligible.reduce((sum, item) => sum + item.quantity, 0),
      eligibleByProduct: [...byProduct.values()].sort((a, b) =>
        a.productName.localeCompare(b.productName)
      ),
    });
  } catch (error) {
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
    const { status, weekKey } = req.query;
    if (status && status !== "All") query.status = status;
    if (weekKey) query.weekKey = weekKey;

    const requests = await MergeRequest.find(query)
      .populate("requestedBy", "name email role")
      .populate("reviewedBy", "name email role")
      .populate("items.product", "name code unit storeRoom image")
      .sort({ createdAt: -1 });

    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    One merge request with everything the approval decision needs:
 *          Red Stock held, current store room balances, and return history
 * @route   GET /api/merge-requests/:id
 * @access  Private (Admin)
 */
export const getMergeRequestById = async (req, res) => {
  try {
    const request = await MergeRequest.findById(req.params.id)
      .populate("requestedBy", "name email role")
      .populate("reviewedBy", "name email role")
      .populate("items.product", "name code unit storeRoom image")
      .populate("items.restockItem");

    if (!request) {
      return res.status(404).json({ message: "Merge request not found" });
    }

    const rooms = await StockRoom.find({ isActive: true }).sort({ name: 1 });

    const lines = await Promise.all(
      request.items.map(async (line) => {
        const productId = line.product?._id || line.product;

        const [redStock, breakdown, history] = await Promise.all([
          // Everything this product still holds in Red Stock, including the
          // quantity on this request.
          RestockItem.aggregate([
            {
              $match: {
                product: productId,
                status: { $in: ["In Red Stock", "Weekly Merge Pending"] },
              },
            },
            { $group: { _id: null, total: { $sum: "$quantity" } } },
          ]).then((rows) => rows[0]?.total || 0),
          roomBreakdownFor(productId),
          RestockItem.find({ product: productId })
            .populate("returnedBy", "name email role")
            .sort({ returnDate: -1 })
            .limit(5),
        ]);

        return {
          ...(line.toObject ? line.toObject() : line),
          redStockQuantity: redStock,
          roomQuantities: rooms.map((room) => ({
            stockRoomId: room._id,
            stockRoom: room.name,
            quantity:
              breakdown.find((entry) => String(entry.stockRoomId) === String(room._id))
                ?.quantity || 0,
          })),
          returnHistory: history.map((item) => ({
            restockNumber: item.restockNumber,
            quantity: item.quantity,
            condition: item.condition,
            reason: item.reason,
            department: item.department,
            sourceRoom: item.sourceRoom,
            returnDate: item.returnDate,
            status: item.status,
            returnedBy: item.returnedBy?.name || "Unknown",
          })),
        };
      })
    );

    res.json({ ...request.toObject(), items: lines, stockRooms: rooms });
  } catch (error) {
    console.error("Error loading merge request:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Approve the weekly merge — the only path out of Red Stock and into
 *          a store room. The Admin names the destination here.
 * @route   PUT /api/merge-requests/:id/approve
 * @access  Private (Admin)
 */
export const approveMergeRequest = async (req, res) => {
  const { comment, destinationRoom, lineDestinations } = req.body;

  try {
    if (!destinationRoom) {
      return res.status(400).json({
        message: "Choose a destination store room for the approved quantity",
      });
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

    const defaultRoom = await resolveRoom(destinationRoom);
    if (!defaultRoom) {
      return res.status(404).json({ message: "Destination store room not found" });
    }

    const merged = [];

    for (const line of request.items) {
      // A line is only ever credited once, however often approval is retried.
      if (line.moved) continue;

      const restockItem = await RestockItem.findById(line.restockItem);
      if (!restockItem || restockItem.status !== "Weekly Merge Pending") continue;

      const product = await Product.findById(line.product);
      if (!product) {
        console.warn(`Merge ${request.requestId}: product ${line.product} missing, skipping line`);
        continue;
      }

      // Per-line overrides let a merge split across both store rooms; without
      // one the whole merge lands in the room chosen for the request.
      const override = lineDestinations?.[String(line.restockItem)];
      const room = override ? (await resolveRoom(override)) || defaultRoom : defaultRoom;

      const { roomQuantity } = await creditRoom({
        product,
        room,
        quantity: line.quantity,
      });

      restockItem.status = "Moved to Stock Room";
      restockItem.destinationRoom = room.name;
      restockItem.mergedAt = new Date();
      await restockItem.save();

      line.destinationRoom = room.name;
      line.moved = true;

      await recordMovement({
        product,
        type: "MERGE_IN",
        direction: "IN",
        quantity: line.quantity,
        reference: request.requestId,
        performedBy: req.user._id,
        note: `Weekly merge of ${restockItem.restockNumber} from Red Stock into ${room.name}`,
        fromRoom: "Red Stock Room",
        toRoom: room.name,
      });

      merged.push({
        restockNumber: restockItem.restockNumber,
        productName: product.name,
        quantity: line.quantity,
        destinationRoom: room.name,
        roomQuantity,
        newBalance: product.quantity,
        returnedBy: restockItem.returnedBy,
      });
    }

    request.status = "Approved";
    request.destinationRoom = defaultRoom.name;
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    request.rejectionReason = "";
    if (comment && comment.trim()) request.comment = comment.trim();
    await request.save();

    // Tell each supervisor whose returns reached a store room.
    const supervisorIds = [...new Set(merged.map((entry) => String(entry.returnedBy)))];
    await Promise.all(
      supervisorIds.map((supervisorId) =>
        Notification.create({
          user: supervisorId,
          message: `Your returned stock has moved from Red Stock into ${defaultRoom.name} (${request.requestId})`,
          type: "MERGE_APPROVED",
        })
      )
    );

    await Notification.create({
      message: `Weekly merge ${request.requestId} approved by ${req.user.name}: ${request.totalQuantity} pcs moved into ${defaultRoom.name}`,
      type: "MERGE_APPROVED",
    });

    const populated = await MergeRequest.findById(request._id)
      .populate("requestedBy", "name email role")
      .populate("reviewedBy", "name email role")
      .populate("items.product", "name code unit storeRoom image");

    res.json({
      message: `Merge ${request.requestId} approved. ${merged.length} item(s) moved out of Red Stock.`,
      mergeRequest: populated,
      merged,
    });
  } catch (error) {
    console.error("Error approving merge request:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Reject the weekly merge — nothing moves and the stock stays in Red
 *          Stock, ready for next week
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

    // The stock never left Red Stock, so rejection only releases the claim on
    // it. The rejection is recorded on each item so its history survives.
    const releasedItems = await RestockItem.find({
      mergeRequest: request._id,
      status: "Weekly Merge Pending",
    });

    await RestockItem.updateMany(
      { mergeRequest: request._id, status: "Weekly Merge Pending" },
      {
        status: "In Red Stock",
        mergeRequest: null,
        lastRejection: { reason, requestId: request.requestId, at: new Date() },
      }
    );

    request.status = "Rejected";
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    request.rejectionReason = reason;
    await request.save();

    const supervisorIds = [
      ...new Set(releasedItems.map((item) => String(item.returnedBy))),
    ];
    await Promise.all(
      supervisorIds.map((supervisorId) =>
        Notification.create({
          user: supervisorId,
          message: `Merge ${request.requestId} was rejected — your returned stock stays in Red Stock for the next weekly merge. Reason: ${reason}`,
          type: "MERGE_REJECTED",
        })
      )
    );

    await Notification.create({
      message: `Weekly merge ${request.requestId} rejected by ${req.user.name}. Stock remains in Red Stock. Reason: ${reason}`,
      type: "MERGE_REJECTED",
    });

    const populated = await MergeRequest.findById(request._id)
      .populate("requestedBy", "name email role")
      .populate("reviewedBy", "name email role")
      .populate("items.product", "name code unit storeRoom image");

    res.json({
      message: `Merge ${request.requestId} rejected. ${releasedItems.length} item(s) stay in Red Stock.`,
      mergeRequest: populated,
    });
  } catch (error) {
    console.error("Error rejecting merge request:", error);
    res.status(500).json({ message: error.message });
  }
};

// Kept so any client still posting to the old collection endpoint lands on the
// weekly merge rather than opening a second, parallel merge.
export const createMergeRequest = createWeeklyMergeRequest;
