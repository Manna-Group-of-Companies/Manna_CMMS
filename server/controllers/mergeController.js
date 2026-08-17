import MergeRequest from "../models/MergeRequest.js";
import RestockItem from "../models/RestockItem.js";
import Product from "../models/Product.js";
import StockRoom from "../models/StockRoom.js";
import Notification from "../models/Notification.js";
import { recordMovement } from "../utils/stockLedger.js";
import {
  creditRoom,
  resolveRoom,
  roomBreakdownFor,
  fallbackRoomFor,
} from "../utils/stockRooms.js";
import {
  runWeeklyMerge,
  requestSupervisorMerge,
  weekWindowFor,
  mergeForWeek,
  openMergeRequest,
  eligibleRedStock,
  nextMergeRunAt,
  withdrawMerge,
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
 * @desc    Supervisor merges their own Red Stock back into the store rooms
 * @route   POST /api/merge-requests/mine
 * @access  Private (Supervisor)
 *
 * Applied immediately, and never handed to the Admin. A supervisor is returning
 * stock they issued themselves, to the room it came from, so there was nothing
 * for an approval to decide — the quantity is on the shelf and countable by the
 * time this responds.
 *
 * Each line goes to its product's home room, since no one is asked to name a
 * destination, falling back to the room the stock was issued out of for a
 * product that carries none. The MergeRequest is still written and closed as
 * Approved, so the merge keeps its request id, its ledger entries and its place
 * in the Admin's history — the record is unchanged, only the waiting is gone.
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
    const { merged, skipped, closed } = await applyMerge({
      request,
      performedBy: req.user,
      noteFor: (restockItem, room) =>
        `${req.user.name} merged ${restockItem.restockNumber} from Red Stock into ${room.name}`,
    });

    const rooms = [...new Set(merged.map((entry) => entry.destinationRoom))];
    const quantity = merged.reduce((sum, entry) => sum + entry.quantity, 0);

    // Nothing could be placed, which now means one thing only: the install has
    // no active store room to place it in. There is no destination an approval
    // could pick either, so the request is withdrawn rather than parked on the
    // Admin's desk — the stock stays in Red Stock, mergeable again the moment a
    // room exists.
    if (!closed) {
      await withdrawMerge(request);

      return res.status(409).json({
        message:
          "There is no active store room to merge into. Ask the Admin to add one, " +
          "then merge again — your stock is still in Red Stock.",
        skipped,
      });
    }

    await Notification.create({
      message:
        `${req.user.name} merged ${quantity} pcs across ${merged.length} returned ` +
        `item(s) from Red Stock into ${rooms.join(", ")} (${request.requestId})` +
        // The weekly merge had claimed some of this, so say so: the Admin's
        // pending request is smaller than when they last looked at it.
        (result.reclaimedFrom?.length
          ? `, taken back out of ${result.reclaimedFrom.join(", ")}`
          : ""),
      type: "MERGE_APPROVED",
    });

    const populated = await MergeRequest.findById(request._id)
      .populate("requestedBy", "name email role")
      .populate("reviewedBy", "name email role")
      .populate("items.product", "name code unit storeRoom image");

    // Partial: say what was left behind rather than reporting a clean merge over
    // stock that never moved.
    const message = skipped.length
      ? `Merged ${quantity} pcs into ${rooms.join(", ")}. ${skipped.length} item(s) ` +
        `stayed in Red Stock — no store room could be found for ` +
        `${skipped.map((entry) => entry.productName).join(", ")}.`
      : `Merged ${quantity} pcs across ${merged.length} item(s) into ${rooms.join(", ")}. ` +
        `It is in stock now.`;

    res.status(201).json({ message, mergeRequest: populated, merged, skipped });
  } catch (error) {
    console.error("Error merging supervisor Red Stock:", error);
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
 * Credits every not-yet-moved line of [request] into a store room, writes the
 * ledger entries, and closes the request as Approved.
 *
 * Shared by the Admin's approval of the weekly merge and the Supervisor's
 * direct merge of their own returns, so the two cannot drift apart — the same
 * idempotency guard, the same movements, the same destination rules.
 *
 * A line's destination is the first of: an explicit per-line override,
 * [defaultRoom], the product's own home room, or — for a product carrying no
 * home room — the room the stock came out of, by way of `fallbackRoomFor`.
 * Those last two are what let a merge run without anyone naming a room, which
 * is how the Supervisor's direct path works: there is no Admin to ask, so
 * every line has to be placeable on its own.
 */
const applyMerge = async ({
  request,
  defaultRoom = null,
  lineDestinations = null,
  performedBy,
  noteFor,
}) => {
  const merged = [];
  const skipped = [];

  for (const line of request.items) {
    // A line is only ever credited once, however often this is retried.
    if (line.moved) continue;

    const restockItem = await RestockItem.findById(line.restockItem);
    if (!restockItem || restockItem.status !== "Weekly Merge Pending") continue;

    const product = await Product.findById(line.product);
    if (!product) {
      console.warn(
        `Merge ${request.requestId}: product ${line.product} missing, skipping line`
      );
      continue;
    }

    // Per-line overrides let a merge split across both store rooms.
    const override = lineDestinations?.[String(line.restockItem)];
    const room =
      (override ? await resolveRoom(override) : null) ||
      defaultRoom ||
      (await resolveRoom(product.storeRoom)) ||
      (await fallbackRoomFor({ product, sourceRoom: restockItem.sourceRoom }));

    // Nowhere to put it — no active store room exists at all. Leave the line
    // claimed rather than inventing a room, and report it so the caller can say
    // what was left behind.
    if (!room) {
      skipped.push({ productName: product.name, quantity: line.quantity });
      continue;
    }

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
      performedBy: performedBy._id,
      note: noteFor(restockItem, room),
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

  // Nothing moved and stock is still claimed: leave the request open so an
  // Admin can name a destination, rather than closing it over stock that never
  // left Red Stock.
  if (merged.length === 0 && skipped.length > 0) {
    return { merged, skipped, closed: false };
  }

  request.status = "Approved";
  // Named room when one was chosen; otherwise whichever home rooms the lines
  // actually landed in, which may be more than one.
  request.destinationRoom =
    defaultRoom?.name ||
    [...new Set(merged.map((entry) => entry.destinationRoom))].join(", ");
  request.reviewedBy = performedBy._id;
  request.reviewedAt = new Date();
  request.rejectionReason = "";
  await request.save();

  return { merged, skipped, closed: true };
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
