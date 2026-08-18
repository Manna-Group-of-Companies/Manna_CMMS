import MergeRequest from "../models/MergeRequest.js";
import RestockItem from "../models/RestockItem.js";
import StockRoom from "../models/StockRoom.js";
import Notification from "../models/Notification.js";
import { resolveRoom, roomBreakdownFor } from "../utils/stockRooms.js";
import { applyMerge, mergeIntoMainStore } from "../utils/mergeApply.js";
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
 * 201 with what reached the shelf, or 409 with why nothing could. The stock is
 * back in Red Stock either way, so there is nothing for the caller to undo.
 */
const respondToMerge = (res, outcome) =>
  outcome.ok
    ? res.status(201).json({
        message: outcome.message,
        mergeRequest: outcome.mergeRequest,
        merged: outcome.merged,
        skipped: outcome.skipped,
      })
    : res.status(409).json({ message: outcome.message, skipped: outcome.skipped });

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
 * @desc    Supervisor merges their own Red Stock back into the main store room
 * @route   POST /api/merge-requests/mine
 * @access  Private (Supervisor)
 *
 * Applied where it is raised, and never handed to the Admin: one call, and the
 * stock is in the main store. A supervisor is returning stock they issued
 * themselves, so there is nothing for an approval to decide — the quantity is
 * on the shelf and countable by the time this responds.
 *
 * Every line goes straight to the main store room. The MergeRequest is still
 * written and closed as Approved, so the merge keeps its request id, its
 * ledger entries and its place in the Admin's history — the record is
 * unchanged, only the waiting is gone.
 *
 * The Admin's weekly merge still needs approval: it sweeps every supervisor's
 * returns at once, and that one does need a decision. It cannot lock a
 * supervisor out of their own stock, though — `requestSupervisorMerge` takes
 * their returns back out of an open weekly merge first.
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

    // Re-read as a document: requestSupervisorMerge returns a populated copy,
    // and applyMerge saves what it is given.
    const request = await MergeRequest.findById(result.mergeRequest._id);
    const outcome = await mergeIntoMainStore({
      request,
      user: req.user,
      reclaimedFrom: result.reclaimedFrom,
    });

    respondToMerge(res, outcome);
  } catch (error) {
    console.error("Error creating supervisor merge request:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Apply a supervisor merge that was left sitting Pending Approval
 * @route   POST /api/merge-requests/:id/confirm
 * @access  Private (Supervisor)
 *
 * Nothing a current client does reaches this: `/mine` merges as it is raised.
 * It is here for the merges an interim build claimed and parked — the
 * supervisor whose merge it is can put their own stock away rather than
 * waiting on an Admin who was never meant to be asked.
 */
export const confirmSupervisorMerge = async (req, res) => {
  try {
    const request = await MergeRequest.findById(req.params.id);

    if (!request) {
      return res.status(404).json({ message: "Merge request not found" });
    }

    // The weekly merge is the Admin's to decide; only a supervisor's own
    // returns go straight to the shelf.
    if (request.createdVia !== "Supervisor") {
      return res
        .status(403)
        .json({ message: "Only a supervisor's own merge can be applied this way" });
    }

    if (String(request.requestedBy) !== String(req.user._id)) {
      return res.status(403).json({ message: "You can only merge your own returns" });
    }

    // Already settled: say where the stock went rather than re-reviewing a
    // closed record, so a client that retries reads the same answer.
    if (request.status === "Approved") {
      const populated = await MergeRequest.findById(request._id)
        .populate("requestedBy", "name email role")
        .populate("reviewedBy", "name email role")
        .populate("items.product", "name code unit storeRoom image");

      return res.json({
        message: request.destinationRoom
          ? `Merge ${request.requestId} is already in ${request.destinationRoom}.`
          : `Merge ${request.requestId} is already in stock.`,
        mergeRequest: populated,
        merged: [],
        skipped: [],
      });
    }

    if (request.status !== "Pending Approval") {
      return res.status(409).json({
        message:
          `Merge ${request.requestId} was ${request.status.toLowerCase()} — your stock is ` +
          `back in Red Stock, so merge it again.`,
        mergeRequest: request,
      });
    }

    respondToMerge(res, await mergeIntoMainStore({ request, user: req.user }));
  } catch (error) {
    console.error("Error confirming supervisor merge:", error);
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
 * @desc    Approve the weekly merge and move its stock into a store room. The
 *          Admin names the destination here.
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

    // A supervisor's merge is applied where it is raised, so there is no
    // decision to make over one. An older server could still leave one at
    // Pending Approval; those are settled by the boot sweep, and approving one
    // here would credit the stock to a room the supervisor never chose.
    if (request.createdVia === "Supervisor") {
      return res.status(403).json({
        message:
          "A supervisor's merge is applied when they raise it — there is nothing here to " +
          "decide. It settles itself the next time the server starts.",
      });
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

    if (comment && comment.trim()) request.comment = comment.trim();

    const { merged } = await applyMerge({
      request,
      defaultRoom,
      lineDestinations,
      performedBy: req.user,
      noteFor: (restockItem, room) =>
        `Weekly merge of ${restockItem.restockNumber} from Red Stock into ${room.name}`,
    });

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

    // Nothing to reject either: the stock left Red Stock when the supervisor
    // merged it, so a rejection here would release a claim that is already gone.
    if (request.createdVia === "Supervisor") {
      return res.status(403).json({
        message:
          "A supervisor's merge is applied when they raise it — there is nothing here to " +
          "decide. It settles itself the next time the server starts.",
      });
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
