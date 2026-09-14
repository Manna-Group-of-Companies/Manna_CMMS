import ErpSyncOutbox from "../../models/ErpSyncOutbox.js";
import { ERP_MAX_ATTEMPTS, ERP_POLL_MS, erpDisabledReason, erpEnabled } from "./config.js";
import { ErpError, createDoc, listDocs, ping } from "./client.js";

/**
 * Draining the queue into ERPNext.
 *
 * One job at a time, oldest first. Deliberately serial: ERPNext maintains the
 * warehouse tree as a nested set and takes a lock on the parent node, so
 * concurrent postings into sibling warehouses deadlock each other. Nothing is
 * waiting on the throughput — the store's request finished long ago — so the
 * simpler, safer shape wins.
 */

let timer = null;
let running = false;

/**
 * Exponential backoff, capped. A job that fails because ERPNext is down should
 * not hammer it, and a job that fails for its own reasons should get out of
 * the way of the ones behind it.
 */
const backoffMs = (attempts) => Math.min(2 ** attempts * 1_000, 15 * 60_000);

/**
 * Has this movement already been posted?
 *
 * The dangerous failure is not a job that errors — it is a job that succeeds
 * and then loses the answer: ERPNext creates the Stock Entry, the connection
 * drops before the reply arrives, and the retry posts the stock a second time.
 *
 * So before posting, ask ERPNext whether it already holds an entry carrying
 * this job's id. The id is written into `remarks` on the way out, which makes
 * it searchable without a custom field or a change to ERPNext.
 */
const alreadyPosted = async (job) => {
  const found = await listDocs("Stock Entry", {
    fields: ["name"],
    filters: [["Stock Entry", "remarks", "like", `%[cmms:${job._id}]%`]],
    limit: 1,
  });
  return Array.isArray(found) && found.length > 0 ? found[0].name : "";
};

/** Runs one job. Returns true when there may be more waiting. */
const runOne = async () => {
  const job = await ErpSyncOutbox.findOneAndUpdate(
    {
      status: "Pending",
      nextAttemptAt: { $lte: new Date() },
      // A row that already carries a docname succeeded on an earlier pass and
      // lost the acknowledgement; leave it for the reconciler, never repost.
      erpDocName: "",
    },
    { $inc: { attempts: 1 } },
    { sort: { createdAt: 1 }, returnDocument: "after" }
  );

  if (!job) return false;

  try {
    // Stamped rather than generated, so the same id survives every retry.
    const payload = {
      ...job.payload,
      remarks: `${job.payload.remarks || ""} [cmms:${job._id}]`.trim().slice(0, 1000),
    };

    const existing = await alreadyPosted(job);
    if (existing) {
      job.erpDocName = existing;
      job.status = "Sent";
      job.sentAt = new Date();
      job.lastError = "already present in ERPNext; not posted again";
      await job.save();
      return true;
    }

    const created = await createDoc(job.doctype, payload);

    // Docname first, status second. A crash between the two leaves a row that
    // reads Pending but carries a docname, which the query above refuses to
    // pick up — the stock is posted once and a human can close the row.
    job.erpDocName = created?.name || "";
    await job.save();

    job.status = "Sent";
    job.sentAt = new Date();
    job.lastError = "";
    await job.save();

    return true;
  } catch (error) {
    const retryable = error instanceof ErpError ? error.retryable : true;
    const exhausted = job.attempts >= ERP_MAX_ATTEMPTS;

    job.lastError = String(error.message || error).slice(0, 1000);
    // A permanent error stops immediately rather than burning five more
    // attempts on a document ERPNext will reject identically every time.
    job.status = !retryable || exhausted ? "Failed" : "Pending";
    job.nextAttemptAt = new Date(Date.now() + backoffMs(job.attempts));
    await job.save();

    if (job.status === "Failed") {
      console.error(
        `ERPNext sync gave up on ${job.entity} ${job.entityId}: ${job.lastError}`
      );
    }
    return retryable && !exhausted;
  }
};

/** Drains everything currently due, then stops. */
export const drainOutbox = async ({ max = 50 } = {}) => {
  if (!erpEnabled() || running) return 0;
  running = true;

  let done = 0;
  try {
    while (done < max) {
      const more = await runOne();
      if (!more) break;
      done += 1;
    }
  } catch (error) {
    console.error("ERPNext sync worker error:", error.message);
  } finally {
    running = false;
  }
  return done;
};

/**
 * Starts the poll loop.
 *
 * `unref` so a queue that is quiet cannot keep the process alive on shutdown.
 */
export const startErpSyncWorker = async () => {
  if (!erpEnabled()) {
    console.log(`ERPNext sync is off (${erpDisabledReason()}).`);
    return;
  }

  try {
    const { ms } = await ping();
    console.log(`ERPNext reachable in ${ms}ms; sync worker starting.`);
  } catch (error) {
    // Not fatal. The queue keeps filling and drains once ERPNext answers —
    // which is the whole point of there being a queue.
    console.warn(`ERPNext unreachable at boot (${error.message}); worker will keep retrying.`);
  }

  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    drainOutbox().catch((error) =>
      console.error("ERPNext sync tick failed:", error.message)
    );
  }, ERP_POLL_MS);
  timer.unref?.();
};

export const stopErpSyncWorker = () => {
  if (timer) clearInterval(timer);
  timer = null;
};
