import Company, { ERP_RED_STOCK_WAREHOUSE } from "../../models/Company.js";
import StockRoom from "../../models/StockRoom.js";
import { RED_STOCK_ROOM } from "./stockEntry.js";

/**
 * Room name → ERPNext warehouse name.
 *
 * Built as a snapshot rather than queried per movement. Enqueueing happens on
 * the request path, right after a supervisor taps Issue, and two extra round
 * trips to MongoDB for every line would be paid by the person holding the
 * tablet. The map is small — one entry per room — and rebuilt on a short
 * interval, so a newly attached room starts posting within a minute.
 */

let cache = null;
let builtAt = 0;

/** Long enough to spare the request path, short enough that a fix lands soon. */
const TTL_MS = 60_000;

const build = async () => {
  const map = new Map();

  const rooms = await StockRoom.find().populate("company", "erpWarehouse isActive");
  for (const room of rooms) {
    const warehouse = room.company?.erpWarehouse;
    if (warehouse) map.set(room.name, warehouse);
  }

  // Red Stock is not a room record — it is where returns wait for a merge —
  // but the ledger names it like one, so it resolves like one.
  map.set(RED_STOCK_ROOM, ERP_RED_STOCK_WAREHOUSE);

  return map;
};

/** Rebuilds the map if it has gone stale. */
export const warehouseMap = async () => {
  if (cache && Date.now() - builtAt < TTL_MS) return cache;
  cache = await build();
  builtAt = Date.now();
  return cache;
};

/** Drops the cache, so an admin's mapping change takes effect immediately. */
export const invalidateWarehouseMap = () => {
  cache = null;
  builtAt = 0;
};

/**
 * The ERPNext company every posting is made against.
 *
 * Read from the company records rather than hard-coded so that correcting it
 * in the console is enough; falls back to the seeded constant when no company
 * has been mapped yet.
 */
export const erpCompanyName = async () => {
  const mapped = await Company.findOne({ isActive: true, erpCompany: { $ne: "" } });
  return mapped?.erpCompany || "";
};
