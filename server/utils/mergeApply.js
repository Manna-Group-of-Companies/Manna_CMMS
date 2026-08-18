import MergeRequest from "../models/MergeRequest.js";
import RestockItem from "../models/RestockItem.js";
import Product from "../models/Product.js";
import StockRoom from "../models/StockRoom.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import { recordMovement } from "./stockLedger.js";
import { creditRoom, resolveRoom, fallbackRoomFor } from "./stockRooms.js";
import { withdrawMerge } from "./weeklyMerge.js";

/**
 * Putting merged stock on the shelf.
 *
 * Two callers apply a merge: the Admin approving the weekly one, and a
 * Supervisor merging their own returns — which is applied where it is raised,
 * with no approval in it at all. They share `applyMerge` so the two cannot
 * drift apart: the same idempotency guard, the same movements, the same
 * destination rules.
 */

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
export const applyMerge = async ({
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
 * Credits [request] into the main store room and says what moved.
 *
 * The one place a supervisor merge is applied: by the supervisor raising it,
 * by the endpoint that clears one an older build parked, and by the boot sweep
 * that clears the rest. None of them asks an Admin anything.
 *
 * Answers `{ ok: true, message, mergeRequest, merged, skipped }` when the stock
 * is on the shelf, or `{ ok: false, message, skipped }` when there was nowhere
 * to put it — in which case the request is withdrawn and its stock is back in
 * Red Stock, mergeable again the moment a room exists.
 */
export const mergeIntoMainStore = async ({ request, user, reclaimedFrom = [] }) => {
  // The first configured default room is the application's main store room.
  // If an older installation does not have it, use its earliest active room
  // rather than putting a supervisor's merge back into an approval queue.
  const mainStoreRoom =
    (await StockRoom.findOne({
      name: StockRoom.DEFAULT_ROOMS[0],
      isActive: true,
    })) || (await StockRoom.findOne({ isActive: true }).sort({ createdAt: 1 }));

  if (!mainStoreRoom) {
    await withdrawMerge(request);
    return {
      ok: false,
      message:
        "There is no active main store room. Ask the Admin to add one, then merge again — " +
        "your stock is still in Red Stock.",
      skipped: [],
    };
  }

  const { merged, skipped, closed } = await applyMerge({
    request,
    defaultRoom: mainStoreRoom,
    performedBy: user,
    noteFor: (restockItem, room) =>
      `${user.name} merged ${restockItem.restockNumber} from Red Stock into ${room.name}`,
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
    return {
      ok: false,
      message:
        "There is no active store room to merge into. Ask the Admin to add one, " +
        "then merge again — your stock is still in Red Stock.",
      skipped,
    };
  }

  await Notification.create({
    message:
      `${user.name} merged ${quantity} pcs across ${merged.length} returned ` +
      `item(s) from Red Stock into ${rooms.join(", ")} (${request.requestId})` +
      // The weekly merge had claimed some of this, so say so: the Admin's
      // pending request is smaller than when they last looked at it.
      (reclaimedFrom?.length ? `, taken back out of ${reclaimedFrom.join(", ")}` : ""),
    type: "MERGE_APPROVED",
  });

  const mergeRequest = await MergeRequest.findById(request._id)
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

  return { ok: true, message, mergeRequest, merged, skipped };
};

/**
 * Applies every supervisor merge left sitting at Pending Approval.
 *
 * A supervisor merge is never the Admin's to decide, but one build in between
 * claimed the stock and parked the request waiting for a second call its
 * clients never made. Those merges are stuck: the stock is out of Red Stock,
 * not in a store room, and countable nowhere. This puts them on the shelf at
 * boot so nobody has to approve stock that was never theirs to approve.
 *
 * Runs on every start and is quiet when there is nothing parked. A merge the
 * supervisor has since raised again is already Approved and will not match.
 */
export const settleParkedSupervisorMerges = async () => {
  const parked = await MergeRequest.find({
    createdVia: "Supervisor",
    status: "Pending Approval",
  }).sort({ createdAt: 1 });

  if (parked.length === 0) return { settled: 0, left: [] };

  let settled = 0;
  const left = [];

  for (const request of parked) {
    // The merge is credited to the supervisor who raised it, so the ledger and
    // the notification read as their merge, not the server's. A deleted user
    // leaves the movement attributed to their id and named plainly.
    const supervisor =
      (await User.findById(request.requestedBy)) ||
      { _id: request.requestedBy, name: "A supervisor" };

    try {
      const result = await mergeIntoMainStore({ request, user: supervisor });
      if (result.ok) settled += 1;
      else left.push(request.requestId);
    } catch (error) {
      // One bad request must not stop the rest, or hold up the boot.
      console.error(`Could not settle merge ${request.requestId}:`, error.message);
      left.push(request.requestId);
    }
  }

  console.log(
    `Settled ${settled} supervisor merge(s) that were waiting on approval` +
      (left.length ? `; ${left.length} could not be placed: ${left.join(", ")}` : "")
  );

  return { settled, left };
};
