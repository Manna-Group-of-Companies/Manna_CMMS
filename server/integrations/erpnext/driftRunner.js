import StockRoomInventory from "../../models/StockRoomInventory.js";
import RestockItem from "../../models/RestockItem.js";
import ErpSyncOutbox from "../../models/ErpSyncOutbox.js";
import ErpDriftReport from "../../models/ErpDriftReport.js";
import { listDocs } from "./client.js";
import { erpEnabled } from "./config.js";
import { compareBalances, summarise } from "./drift.js";
import { warehouseMap } from "./warehouses.js";
import { RED_STOCK_ROOM } from "./stockEntry.js";

/**
 * PHASE-5: running the comparison and keeping the result.
 *
 * Reads both systems, diffs them, stores a report. Nothing here corrects
 * anything: a drift report is evidence, and deciding which side is right needs
 * somebody who knows why the two disagree. Silently "fixing" a difference
 * would destroy the only trace of how it happened.
 */

/** How often the scheduler wakes to see whether the run is due. */
const CHECK_INTERVAL_MS = 15 * 60_000;

/** Hour of the day (0-23, server time) the comparison runs. */
export const driftHour = () => {
  const hour = Number(process.env.ERPNEXT_DRIFT_HOUR);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 2;
};

export const driftEnabled = () =>
  erpEnabled() && process.env.ERPNEXT_DRIFT_ENABLED !== "false";

/**
 * Everything the CMMS holds, in the shape the comparison wants.
 *
 * The same two sources the cutover reads, and for the same reason: Red Stock
 * is not a room record but returned batches awaiting a merge, and omitting it
 * would report every one of them as stock ERPNext holds and the CMMS does not.
 */
const cmmsBalances = async (warehouses) => {
  const balances = [];

  const rows = await StockRoomInventory.find({ quantity: { $gt: 0 } })
    .populate("product", "code")
    .populate("stockRoom", "name");

  for (const row of rows) {
    const warehouse = warehouses.get(row.stockRoom?.name);
    if (!row.product?.code || !warehouse) continue;
    balances.push({ itemCode: row.product.code, warehouse, qty: row.quantity });
  }

  const redStock = warehouses.get(RED_STOCK_ROOM);
  if (redStock) {
    const pending = await RestockItem.find({
      status: { $in: ["In Red Stock", "Weekly Merge Pending"] },
      quantity: { $gt: 0 },
    }).populate("product", "code");

    for (const item of pending) {
      const code = item.productCode || item.product?.code;
      if (!code) continue;
      // Left as separate rows; the comparison sums them per shelf.
      balances.push({ itemCode: code, warehouse: redStock, qty: item.quantity });
    }
  }

  return balances;
};

/**
 * Every Bin ERPNext holds in the CMMS's warehouses.
 *
 * Filtered to those warehouses in the query rather than afterwards. The
 * company's production stock lives in the same instance and runs to a thousand
 * items; pulling it back only to discard it would make the nightly run several
 * times larger for nothing.
 */
const erpBalances = async (warehouseNames) => {
  const rows = [];
  const PAGE = 500;
  let start = 0;

  for (;;) {
    const page = await listDocs("Bin", {
      fields: ["item_code", "warehouse", "actual_qty"],
      filters: [["Bin", "warehouse", "in", warehouseNames]],
      limit: PAGE,
      start,
    });
    if (!Array.isArray(page) || page.length === 0) break;

    for (const row of page) {
      rows.push({
        itemCode: row.item_code,
        warehouse: row.warehouse,
        qty: Number(row.actual_qty || 0),
      });
    }
    if (page.length < PAGE) break;
    start += PAGE;
  }
  return rows;
};

/**
 * Runs one comparison and stores the report.
 *
 * A failure is recorded rather than thrown. "ERPNext was unreachable last
 * night" is itself worth knowing, and a run that vanishes leaves the Admin
 * looking at a stale report with no sign it is stale.
 */
export const runDriftCheck = async () => {
  const startedAt = Date.now();

  const [pendingJobs, failedJobs] = await Promise.all([
    ErpSyncOutbox.countDocuments({ status: "Pending" }),
    ErpSyncOutbox.countDocuments({ status: "Failed" }),
  ]);

  try {
    const warehouses = await warehouseMap();
    const names = [...new Set(warehouses.values())].filter(Boolean);

    if (names.length === 0) {
      return ErpDriftReport.create({
        summary: "No company carries an ERPNext warehouse yet; nothing to compare.",
        pendingJobs,
        failedJobs,
        durationMs: Date.now() - startedAt,
      });
    }

    const [cmms, erp] = await Promise.all([cmmsBalances(warehouses), erpBalances(names)]);
    const result = compareBalances({ cmms, erp, warehouses: names });

    const cap = ErpDriftReport.MAX_ROWS;
    const truncated =
      result.differences.length > cap ||
      result.missingInErp.length > cap ||
      result.missingInCmms.length > cap;

    const summary = summarise(result, { pending: pendingJobs, failed: failedJobs });
    if (result.driftCount > 0) console.warn(summary);
    else console.log(summary);

    return await ErpDriftReport.create({
      compared: result.compared,
      matched: result.matched,
      driftCount: result.driftCount,
      differences: result.differences.slice(0, cap),
      missingInErp: result.missingInErp.slice(0, cap),
      missingInCmms: result.missingInCmms.slice(0, cap),
      truncated,
      pendingJobs,
      failedJobs,
      warehouses: names,
      summary,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error("ERPNext drift check failed:", error.message);
    return ErpDriftReport.create({
      error: String(error.message || error).slice(0, 1000),
      summary: `Drift check could not run: ${error.message}`,
      pendingJobs,
      failedJobs,
      durationMs: Date.now() - startedAt,
    });
  }
};

let timer = null;

/** True once a report already exists for the current day. */
const ranToday = async (now) => {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  return (await ErpDriftReport.countDocuments({ createdAt: { $gte: startOfDay } })) > 0;
};

/**
 * Starts the nightly comparison.
 *
 * Polls rather than sleeping until the exact hour, matching the weekly merge
 * scheduler: a process that restarts twice a day would otherwise keep pushing
 * its own deadline back and the check would never run.
 */
export const startDriftScheduler = () => {
  if (!driftEnabled()) return null;

  const hour = driftHour();

  const tick = async () => {
    try {
      const now = new Date();
      if (now.getHours() !== hour) return;
      if (await ranToday(now)) return;
      await runDriftCheck();
    } catch (error) {
      console.error("Drift scheduler failed:", error.message);
    }
  };

  console.log(`ERPNext drift check scheduled daily at ${String(hour).padStart(2, "0")}:00.`);

  tick();
  if (timer) clearInterval(timer);
  timer = setInterval(tick, CHECK_INTERVAL_MS);
  timer.unref?.();
  return timer;
};

export const stopDriftScheduler = () => {
  if (timer) clearInterval(timer);
  timer = null;
};
