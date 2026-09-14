import { createDoc, listAll, listDocs } from "../integrations/erpnext/client.js";
import {
  ALL_WAREHOUSES,
  ERP_COMPANY,
  MAIN_WAREHOUSE,
  RED_STOCK_WAREHOUSE,
  labelFor,
  warehouseFor,
} from "../integrations/erpnext/stores.js";

/**
 * Moving stock.
 *
 * Every quantity change in the CMMS becomes one submitted Stock Entry here.
 * Nothing in this file writes a balance: ERPNext derives the Bin from the
 * ledger, and the ledger from documents, so the only honest way to change a
 * number is to post the document that explains it.
 *
 * --- Why an issue leaves the company -----------------------------------
 *
 * Issued stock is out of the CMMS's room balances entirely — a spanner with a
 * fitter is not stock on a shelf, and no screen counts it. ERPNext is told the
 * same thing, so an issue is a Material Issue rather than a transfer to some
 * "in use" warehouse. That keeps a Bin and what the store believes it holds
 * the same number, which is what makes them comparable at all.
 *
 * The consequence is that consuming or scrapping issued stock posts nothing:
 * it left at issue time, and posting again would remove it twice.
 */

const ISSUE = "Material Issue";
const RECEIPT = "Material Receipt";
const TRANSFER = "Material Transfer";

/** ERPNext wants the date and the time of day as separate fields. */
const postingParts = (at) => {
  const date = at instanceof Date ? at : new Date(at || Date.now());
  const iso = date.toISOString();
  return { posting_date: iso.slice(0, 10), posting_time: iso.slice(11, 19) };
};

/**
 * One line of a Stock Entry.
 *
 * `allow_zero_valuation_rate` is on every row because most of the catalog has
 * never been costed, and ERPNext refuses to move an item it cannot value
 * unless told that is expected. The CMMS tracks quantity, not value, so it is.
 */
const line = ({ itemCode, quantity, from, to, rate = 0 }) => ({
  item_code: itemCode,
  qty: quantity,
  ...(from ? { s_warehouse: from } : {}),
  ...(to ? { t_warehouse: to } : {}),
  allow_zero_valuation_rate: 1,
  ...(rate > 0 ? { basic_rate: rate } : {}),
});

/**
 * Posts one Stock Entry and returns its name.
 *
 * Inserted and submitted in a single call. A draft would move nothing while
 * still looking, from this side, like a completed operation — which is the
 * kind of discrepancy that surfaces weeks later during a count.
 */
const post = async ({ purpose, items, reference = "", note = "", at, as }) => {
  if (!items.length) throw new Error("A stock entry needs at least one line");

  const entry = await createDoc(
    "Stock Entry",
    {
      doctype: "Stock Entry",
      stock_entry_type: purpose,
      company: ERP_COMPANY,
      ...postingParts(at),
      // Without this ERPNext stamps the moment the request landed rather than
      // the moment the store recorded.
      set_posting_time: 1,
      remarks: [reference, note].filter(Boolean).join(" - ").slice(0, 500),
      items,
      docstatus: 1,
    },
    { as }
  );

  return entry?.name || "";
};

/**
 * What a warehouse currently holds of one item.
 *
 * Read before every debit, because ERPNext will refuse a Material Issue that
 * takes a Bin negative and the error it raises is far less useful than saying
 * up front how much is actually there.
 */
export const availableAt = async (itemCode, warehouse) => {
  const [bin] = await listDocs("Bin", {
    fields: ["actual_qty"],
    filters: [
      ["Bin", "item_code", "=", itemCode],
      ["Bin", "warehouse", "=", warehouse],
    ],
    limit: 1,
  });
  return Number(bin?.actual_qty || 0);
};

/** Every warehouse of ours holding this item, fullest first. */
export const whereIs = async (itemCode) => {
  const bins = await listAll("Bin", {
    fields: ["warehouse", "actual_qty"],
    filters: [
      ["Bin", "item_code", "=", itemCode],
      ["Bin", "warehouse", "in", ALL_WAREHOUSES],
      ["Bin", "actual_qty", ">", 0],
    ],
  });

  return bins
    .map((bin) => ({
      warehouse: bin.warehouse,
      room: labelFor(bin.warehouse),
      quantity: Number(bin.actual_qty || 0),
    }))
    .sort((a, b) => b.quantity - a.quantity);
};

/**
 * Works out which warehouses an issue should draw from.
 *
 * Preferred store first, then the fullest remaining — the same rule
 * `debitAcrossRooms` used, and for the same reason: a product's stock should
 * consolidate rather than scatter into ever smaller piles across four sites.
 *
 * Red Stock is never drawn from. That stock is returned goods awaiting a
 * decision, and issuing it straight back out would skip the merge that is
 * supposed to put it on a shelf first.
 */
export const planDraw = (held, quantity, preferred = "") => {
  const available = held
    .filter((row) => row.warehouse !== RED_STOCK_WAREHOUSE)
    .reduce((sum, row) => sum + row.quantity, 0);

  if (available < quantity) {
    return { ok: false, available, drawn: [] };
  }

  const wanted = warehouseFor(preferred);
  const ordered = [
    ...held.filter((row) => row.warehouse === wanted),
    ...held.filter((row) => row.warehouse !== wanted && row.warehouse !== RED_STOCK_WAREHOUSE),
  ];

  const drawn = [];
  let remaining = quantity;

  for (const row of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(row.quantity, remaining);
    if (take > 0) {
      drawn.push({ warehouse: row.warehouse, room: row.room, quantity: take });
      remaining -= take;
    }
  }

  return { ok: remaining <= 0, available, drawn };
};

/**
 * Issues stock to a recipient.
 *
 * One Stock Entry with a row per warehouse drawn from, so ERPNext debits each
 * by what actually came out of it rather than taking the lot from the first.
 */
export const issue = async ({ itemCode, quantity, preferredStore = "", reference = "", note = "", at, as }) => {
  const held = await whereIs(itemCode);
  const plan = planDraw(held, quantity, preferredStore);

  if (!plan.ok) {
    const error = new Error(
      `Insufficient stock. Available: ${plan.available}, requested: ${quantity}`
    );
    error.code = "INSUFFICIENT_STOCK";
    error.available = plan.available;
    throw error;
  }

  const stockEntry = await post({
    purpose: ISSUE,
    items: plan.drawn.map((row) =>
      line({ itemCode, quantity: row.quantity, from: row.warehouse })
    ),
    reference,
    note,
    at,
    as,
  });

  return { stockEntry, drawn: plan.drawn };
};

/**
 * Brings returned stock into Red Stock.
 *
 * A receipt rather than a transfer, because the quantity left the company when
 * it was issued and this is it coming back — there is no warehouse for it to
 * have travelled from.
 */
export const receiveIntoRedStock = ({ itemCode, quantity, rate = 0, reference = "", note = "", at, as }) =>
  post({
    purpose: RECEIPT,
    items: [line({ itemCode, quantity, to: RED_STOCK_WAREHOUSE, rate })],
    reference,
    note,
    at,
    as,
  });

/** Moves merged Red Stock onto a shelf. */
export const mergeToStore = ({ itemCode, quantity, store, reference = "", note = "", at, as }) => {
  const to = warehouseFor(store) || MAIN_WAREHOUSE;
  return post({
    purpose: TRANSFER,
    items: [line({ itemCode, quantity, from: RED_STOCK_WAREHOUSE, to })],
    reference,
    note,
    at,
    as,
  });
};

/** Moves stock between two stores. */
export const transfer = ({ itemCode, quantity, from, to, reference = "", note = "", at, as }) => {
  const source = warehouseFor(from);
  const target = warehouseFor(to);

  if (!source || !target) throw new Error("Both a source and a destination store are required");
  if (source === target) throw new Error("Source and destination are the same store");

  return post({
    purpose: TRANSFER,
    items: [line({ itemCode, quantity, from: source, to: target })],
    reference,
    note,
    at,
    as,
  });
};

/** Adds stock that came from outside the system. */
export const receive = ({ itemCode, quantity, store, rate = 0, reference = "", note = "", at, as }) =>
  post({
    purpose: RECEIPT,
    items: [line({ itemCode, quantity, to: warehouseFor(store) || MAIN_WAREHOUSE, rate })],
    reference,
    note,
    at,
    as,
  });

/**
 * Discards stock straight out of Red Stock.
 *
 * The one disposal that does post a document. Scrapping *issued* stock posts
 * nothing because it already left; scrapping out of Red Stock is removing
 * something ERPNext currently believes is on a shelf.
 */
export const scrapFromRedStock = ({ itemCode, quantity, reference = "", note = "", at, as }) =>
  post({
    purpose: ISSUE,
    items: [line({ itemCode, quantity, from: RED_STOCK_WAREHOUSE })],
    reference,
    note,
    at,
    as,
  });

/**
 * The movement history for one item, newest first.
 *
 * Read from the Stock Ledger Entry rather than from Stock Entries: the ledger
 * is one row per item per warehouse per movement, which is exactly what the
 * movement page shows, and it carries the running balance ERPNext calculated
 * rather than one recomputed here and liable to disagree.
 */
export const movementsFor = async (itemCode, { limit = 50 } = {}) => {
  const rows = await listDocs("Stock Ledger Entry", {
    fields: [
      "name",
      "posting_date",
      "posting_time",
      "warehouse",
      "actual_qty",
      "qty_after_transaction",
      "voucher_type",
      "voucher_no",
      "is_cancelled",
    ],
    filters: [
      ["Stock Ledger Entry", "item_code", "=", itemCode],
      ["Stock Ledger Entry", "warehouse", "in", ALL_WAREHOUSES],
      ["Stock Ledger Entry", "is_cancelled", "=", 0],
    ],
    orderBy: "posting_date desc, posting_time desc",
    limit,
  });

  return rows.map((row) => ({
    at: `${row.posting_date} ${row.posting_time}`,
    room: labelFor(row.warehouse),
    warehouse: row.warehouse,
    change: Number(row.actual_qty || 0),
    direction: Number(row.actual_qty || 0) >= 0 ? "IN" : "OUT",
    balanceAfter: Number(row.qty_after_transaction || 0),
    reference: row.voucher_no,
    referenceType: row.voucher_type,
  }));
};
