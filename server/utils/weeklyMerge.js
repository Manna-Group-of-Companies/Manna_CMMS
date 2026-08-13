import MergeRequest from "../models/MergeRequest.js";
import RestockItem from "../models/RestockItem.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";

/**
 * The Red Stock → Store Room merge.
 *
 * Red Stock accumulates all week with no Admin involvement. Once a week this
 * gathers everything eligible into a single merge request, which is the only
 * Admin approval in the whole return flow. Two rules shape the code here:
 *
 *   - one merge per week reaches approval, and
 *   - a Red Stock item can only ever be inside one open merge,
 *
 * so no quantity can be merged — and credited to a store room — twice.
 *
 * A Supervisor can also ask for their own returns to be merged early. Those
 * requests sit outside the weekly cycle: they claim only that supervisor's
 * items, and they neither use up the week nor hold up the scheduler. The
 * second rule still applies, and it is the one that keeps a quantity from
 * being credited twice.
 */

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** Monday 00:00 of the week containing [date]. */
export const startOfWeek = (date = new Date()) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  // getDay() is Sunday-first; shift so Monday is day 0.
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
};

/** Sunday 23:59:59.999 of the week containing [date]. */
export const endOfWeek = (date = new Date()) => {
  const end = startOfWeek(date);
  end.setDate(end.getDate() + 7);
  end.setMilliseconds(-1);
  return end;
};

/**
 * ISO-8601 week label, e.g. "2026-W33". Weeks are numbered by the Thursday
 * they contain, so the label does not drift at a year boundary.
 */
export const weekKeyFor = (date = new Date()) => {
  const thursday = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
  thursday.setUTCDate(thursday.getUTCDate() - ((thursday.getUTCDay() + 6) % 7) + 3);

  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(
    firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3
  );

  const week = 1 + Math.round((thursday - firstThursday) / MS_PER_WEEK);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
};

/** Week bounds and label in one object, the shape the API returns. */
export const weekWindowFor = (date = new Date()) => ({
  weekKey: weekKeyFor(date),
  weekStart: startOfWeek(date),
  weekEnd: endOfWeek(date),
});

/**
 * REQ-MERGE-00125 — a single running sequence, as printed on the request.
 * Numbered off the highest id rather than a count, so deleting a request never
 * makes the next one collide.
 */
const generateRequestId = async () => {
  const [highest] = await MergeRequest.aggregate([
    { $match: { requestId: { $regex: "^REQ-MERGE-\\d+$" } } },
    { $project: { seq: { $toInt: { $substrBytes: ["$requestId", 10, 12] } } } },
    { $sort: { seq: -1 } },
    { $limit: 1 },
  ]);

  return `REQ-MERGE-${String((highest?.seq || 0) + 1).padStart(5, "0")}`;
};

/** Red Stock the next weekly merge would pick up. */
export const eligibleRedStock = () =>
  RestockItem.find({ status: { $in: RestockItem.MERGEABLE_STATUSES } })
    .populate("product", "name code unit storeRoom image")
    .populate("returnedBy", "name email")
    .sort({ returnDate: 1 });

/**
 * Merges belonging to the weekly cycle. A supervisor-raised merge is excluded
 * so that asking for an early merge neither uses up the week nor stops the
 * scheduler from running. Written as `$ne` rather than `$in` so documents
 * predating `createdVia` still count as weekly.
 */
const WEEKLY_CYCLE = { createdVia: { $ne: "Supervisor" } };

/** The merge that has already claimed [weekKey], if there is one. */
export const mergeForWeek = (weekKey) =>
  MergeRequest.findOne({
    ...WEEKLY_CYCLE,
    weekKey,
    status: { $in: MergeRequest.CLAIMS_WEEK },
  });

/** The weekly merge currently sitting on the Admin's desk, if any. */
export const openMergeRequest = () =>
  MergeRequest.findOne({ ...WEEKLY_CYCLE, status: "Pending Approval" }).sort({
    createdAt: -1,
  });

/**
 * Turn [candidates] into a merge request and claim them, which is all that
 * differs between the weekly run and a supervisor's early request. The caller
 * decides which Red Stock is eligible and whether it is allowed to raise a
 * merge at all.
 *
 * Returns `{ created, reason, mergeRequest }` rather than throwing when there
 * is simply nothing to do, because the scheduler calls this on a timer and a
 * quiet week is not an error.
 */
const raiseMerge = async ({ candidates, user, now, comment, createdVia, notify }) => {
  const { weekKey, weekStart, weekEnd } = weekWindowFor(now);

  const requestId = await generateRequestId();

  const mergeRequest = await MergeRequest.create({
    requestId,
    weekKey,
    weekStart,
    weekEnd,
    items: candidates.map((item) => ({
      restockItem: item._id,
      product: item.product,
      productName: item.productName,
      unit: item.unit,
      quantity: item.quantity,
    })),
    itemCount: candidates.length,
    totalQuantity: candidates.reduce((sum, item) => sum + item.quantity, 0),
    requestedBy: user?._id || null,
    requestedAt: now,
    createdVia,
    comment: (comment || "").trim(),
  });

  // Rule 2: claim the items. The status guard is inside the filter, so if a
  // second merge ran at the same moment only one of them can take an item.
  await RestockItem.updateMany(
    {
      _id: { $in: candidates.map((item) => item._id) },
      status: { $in: RestockItem.MERGEABLE_STATUSES },
    },
    { status: "Weekly Merge Pending", mergeRequest: mergeRequest._id }
  );

  // Keep only what this request actually managed to claim.
  const claimed = await RestockItem.find({
    mergeRequest: mergeRequest._id,
    status: "Weekly Merge Pending",
  });

  if (claimed.length === 0) {
    await MergeRequest.deleteOne({ _id: mergeRequest._id });
    return {
      created: false,
      reason: "Another merge claimed this Red Stock first",
      mergeRequest: null,
    };
  }

  if (claimed.length !== candidates.length) {
    const claimedIds = new Set(claimed.map((item) => String(item._id)));
    mergeRequest.items = mergeRequest.items.filter((line) =>
      claimedIds.has(String(line.restockItem))
    );
    mergeRequest.itemCount = mergeRequest.items.length;
    mergeRequest.totalQuantity = mergeRequest.items.reduce(
      (sum, line) => sum + line.quantity,
      0
    );
    await mergeRequest.save();
  }

  // Admin-facing: no `user`, so it reaches every Admin.
  await Notification.create({
    message: notify(mergeRequest),
    type: "MERGE_REQUESTED",
  });

  const populated = await MergeRequest.findById(mergeRequest._id)
    .populate("requestedBy", "name email")
    .populate("items.product", "name code unit storeRoom image");

  return {
    created: true,
    reason: `Merge ${requestId} created with ${mergeRequest.itemCount} item(s)`,
    mergeRequest: populated,
  };
};

/**
 * Raise this week's merge request over the eligible Red Stock.
 *
 * [restockItemIds] narrows the merge to specific items; omit it for the normal
 * "everything in Red Stock" weekly run.
 */
export const runWeeklyMerge = async ({
  user = null,
  now = new Date(),
  comment = "",
  restockItemIds = null,
  createdVia = "Manual",
} = {}) => {
  const { weekKey } = weekWindowFor(now);

  // Rule 1: one merge per week.
  const existingForWeek = await mergeForWeek(weekKey);
  if (existingForWeek) {
    return {
      created: false,
      reason:
        existingForWeek.status === "Pending Approval"
          ? `This week's merge (${existingForWeek.requestId}) is already waiting for approval`
          : `This week's merge (${existingForWeek.requestId}) has already been approved`,
      mergeRequest: existingForWeek,
    };
  }

  // A merge left over from an earlier week still holds its items, so opening a
  // second one would only ever be empty or confusing.
  const stillOpen = await openMergeRequest();
  if (stillOpen) {
    return {
      created: false,
      reason: `Merge ${stillOpen.requestId} is still awaiting approval — resolve it first`,
      mergeRequest: stillOpen,
    };
  }

  const filter = { status: { $in: RestockItem.MERGEABLE_STATUSES } };
  if (Array.isArray(restockItemIds) && restockItemIds.length > 0) {
    filter._id = { $in: restockItemIds };
  }

  const candidates = await RestockItem.find(filter);
  if (candidates.length === 0) {
    return { created: false, reason: "There is nothing in Red Stock to merge", mergeRequest: null };
  }

  const result = await raiseMerge({
    candidates,
    user,
    now,
    comment,
    createdVia,
    notify: (request) =>
      `Weekly merge ${request.requestId} is ready for approval: ${request.totalQuantity} pcs across ${request.itemCount} item(s) in Red Stock`,
  });

  return result.created
    ? { ...result, reason: `Weekly merge ${result.mergeRequest.requestId} created with ${result.mergeRequest.itemCount} item(s)` }
    : result;
};

/**
 * A Supervisor asking for their own Red Stock to be moved into a store room
 * without waiting for the weekly run.
 *
 * Only their own returns are ever claimed, so two supervisors can have
 * requests open at once and neither blocks the scheduler. Nothing moves here
 * either — the Admin still approves the merge and names the destination room.
 *
 * [restockItemIds] narrows the request to specific returns; omit it to send
 * everything the supervisor has sitting in Red Stock.
 */
export const requestSupervisorMerge = async ({
  user,
  now = new Date(),
  comment = "",
  restockItemIds = null,
} = {}) => {
  if (!user?._id) {
    return { created: false, reason: "A supervisor is required to raise this merge", mergeRequest: null };
  }

  const filter = {
    status: { $in: RestockItem.MERGEABLE_STATUSES },
    returnedBy: user._id,
  };
  if (Array.isArray(restockItemIds) && restockItemIds.length > 0) {
    filter._id = { $in: restockItemIds };
  }

  const candidates = await RestockItem.find(filter);
  if (candidates.length === 0) {
    return {
      created: false,
      // Their earlier request may still be open, which is the usual reason
      // there is nothing left to send.
      reason: "You have nothing in Red Stock to merge. Anything already sent is waiting on the Admin.",
      mergeRequest: null,
    };
  }

  const result = await raiseMerge({
    candidates,
    user,
    now,
    comment,
    createdVia: "Supervisor",
    notify: (request) =>
      `${user.name} asked to merge ${request.totalQuantity} pcs across ${request.itemCount} returned item(s) into a store room (${request.requestId})`,
  });

  return result.created
    ? {
        ...result,
        reason: `Merge ${result.mergeRequest.requestId} sent to the Admin: ${result.mergeRequest.totalQuantity} pcs across ${result.mergeRequest.itemCount} item(s)`,
      }
    : result;
};

/**
 * When the scheduler raises the merge: Monday 09:00 by default, overridable
 * with WEEKLY_MERGE_DAY (0 = Sunday) and WEEKLY_MERGE_HOUR.
 */
export const mergeSchedule = () => {
  const day = Number(process.env.WEEKLY_MERGE_DAY);
  const hour = Number(process.env.WEEKLY_MERGE_HOUR);
  return {
    weekday: Number.isInteger(day) && day >= 0 && day <= 6 ? day : 1,
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 9,
    enabled: process.env.WEEKLY_MERGE_ENABLED !== "false",
  };
};

/** The next moment the scheduler will raise a merge, from [from] onwards. */
export const nextMergeRunAt = (from = new Date()) => {
  const { weekday, hour } = mergeSchedule();
  const next = startOfWeek(from);
  // startOfWeek is Monday; walk forward to the configured weekday.
  next.setDate(next.getDate() + ((weekday + 6) % 7));
  next.setHours(hour, 0, 0, 0);
  if (next <= from) next.setDate(next.getDate() + 7);
  return next;
};

/** True once this week's scheduled slot has passed. */
const isDue = (now) => {
  const { weekday, hour } = mergeSchedule();
  const slot = startOfWeek(now);
  slot.setDate(slot.getDate() + ((weekday + 6) % 7));
  slot.setHours(hour, 0, 0, 0);
  return now >= slot;
};

const CHECK_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Poll for the weekly slot rather than sleeping until it: a restart, a clock
 * change or a slot that passed while the server was down all still get their
 * merge, and `runWeeklyMerge` refuses to raise a second one for the week.
 */
export const startWeeklyMergeScheduler = () => {
  const { enabled, weekday, hour } = mergeSchedule();
  if (!enabled) {
    console.log("Weekly merge scheduler disabled (WEEKLY_MERGE_ENABLED=false)");
    return null;
  }

  const tick = async () => {
    try {
      const now = new Date();
      if (!isDue(now)) return;
      if (await mergeForWeek(weekKeyFor(now))) return;

      // The request needs an owner for the audit trail; without an Admin on
      // file it is left for someone to raise by hand.
      const admin = await User.findOne({ role: "Admin" }).sort({ createdAt: 1 });

      const result = await runWeeklyMerge({
        user: admin,
        now,
        createdVia: "Scheduled",
        comment: `Scheduled weekly merge for ${weekKeyFor(now)}`,
      });

      if (result.created) console.log(`Weekly merge: ${result.reason}`);
    } catch (error) {
      console.error("Weekly merge scheduler failed:", error.message);
    }
  };

  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  console.log(
    `Weekly merge scheduled for ${days[weekday]} ${String(hour).padStart(2, "0")}:00 — next run ${nextMergeRunAt().toLocaleString()}`
  );

  tick();
  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  timer.unref?.();
  return timer;
};

/**
 * Rewrites the pre-Red-Stock status vocabulary in place. Runs on boot and is a
 * no-op once every document has been converted.
 */
export const migrateRedStockStatuses = async () => {
  const itemStatuses = [
    ["Restock Pending", "In Red Stock"],
    // A rejected merge used to park items in their own status; they belong in
    // Red Stock, ready for the next weekly merge.
    ["Merge Rejected", "In Red Stock"],
    ["Merge Requested", "Weekly Merge Pending"],
    ["Merged", "Moved to Stock Room"],
  ];

  let items = 0;
  for (const [from, to] of itemStatuses) {
    const { modifiedCount } = await RestockItem.collection.updateMany(
      { status: from },
      { $set: { status: to } }
    );
    items += modifiedCount || 0;
  }

  const requestStatuses = [
    ["Merged Successfully", "Approved"],
    ["Merge Rejected", "Rejected"],
  ];

  let requests = 0;
  for (const [from, to] of requestStatuses) {
    const { modifiedCount } = await MergeRequest.collection.updateMany(
      { status: from },
      { $set: { status: to } }
    );
    requests += modifiedCount || 0;
  }

  // Merge requests predate the weekly window, so anchor them to the week they
  // were raised in.
  const undated = await MergeRequest.find({
    $or: [{ weekKey: { $exists: false } }, { weekKey: "" }],
  });
  for (const request of undated) {
    const window = weekWindowFor(request.requestedAt || request.createdAt || new Date());
    await MergeRequest.collection.updateOne({ _id: request._id }, { $set: window });
  }

  if (items || requests || undated.length) {
    console.log(
      `Red Stock migration: ${items} returned item(s), ${requests} merge request(s), ${undated.length} week label(s) updated.`
    );
  }
};
