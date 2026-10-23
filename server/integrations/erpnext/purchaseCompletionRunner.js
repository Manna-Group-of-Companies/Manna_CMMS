import { erpHasCredentials } from "./config.js";
import { reconcileCompletion } from "../../repository/purchaseCompletion.js";

/**
 * Completes purchase requests whose goods are in (see
 * repository/purchaseCompletion.js), every PR_COMPLETION_MINUTES (10 by
 * default; 0 turns it off).
 *
 * A timer, not a webhook: the goods receipt is posted by the sync on the SAP
 * server, which tells this server nothing, and the timer also catches whatever
 * happened while this server or ERPNext was down.
 */

let timer = null;
let running = false;

const minutes = () => {
  const raw = process.env.PR_COMPLETION_MINUTES;
  const n = raw === undefined || raw === "" ? 10 : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 10;
};

export const runCompletionCheck = async () => {
  if (running) return [];
  running = true;
  try {
    const moved = await reconcileCompletion();
    for (const m of moved) console.log(`Purchase request ${m.id}: ${m.from} -> ${m.to}`);
    return moved;
  } catch (error) {
    console.error("Purchase request completion check failed:", error.message);
    return [];
  } finally {
    running = false;
  }
};

export const startPurchaseCompletionScheduler = () => {
  const every = minutes();
  if (!every || !erpHasCredentials()) return null;
  console.log(`Purchase request completion checked every ${every} min.`);
  runCompletionCheck();
  if (timer) clearInterval(timer);
  timer = setInterval(runCompletionCheck, every * 60_000);
  timer.unref?.();
  return timer;
};

export const stopPurchaseCompletionScheduler = () => {
  if (timer) clearInterval(timer);
  timer = null;
};
