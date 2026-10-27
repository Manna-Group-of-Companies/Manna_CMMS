import { createDoc, deleteDoc, getDoc, listChildRows, listDocs, updateDoc } from "../integrations/erpnext/client.js";
import { erpNow, erpToday } from "../integrations/erpnext/time.js";
import { storeForCompany } from "../integrations/erpnext/stores.js";
import { raiseSapFlag } from "./sapCategories.js";
import { QUOTATION_DOCTYPE, isExpired, mayMakeOrder, readQuotation } from "./purchaseQuotations.js";
import { cancelReason } from "./purchaseRequests.js";

/**
 * Purchase orders made from a quotation (24 Oct 2026).
 *
 * Management signs the printed quotation; the signature is the approval, so
 * there is no draft and no approval tick here. Once SAP has the quotation the
 * purchase manager makes the PO from it - one quotation, one PO - and the sync
 * posts it straight away.
 *
 *   status       Open -> Purchased (every line received), or Closed (closed or
 *                cancelled in SAP, or cancelled from the CMMS since 27 Oct 2026 -
 *                cancelOrder, which the sync carries out in SAP)
 *   sync_status  Queued -> Posted (SAP PO no.), or Failed (SAP's reason)
 *
 * Kept apart, so a PO is Open while SAP has not got it yet; it is received only
 * once Posted. Prices and units are the quotation's. The quantity can change,
 * because a vendor sometimes quotes for a single unit.
 *
 * Named here, not by a naming series: PO-YYYY-##### one above the last PO
 * number used, counting the POs once made on a request (PR-2026-00340's PO is
 * stamped PO26-00340 in SAP), so a new PO never shares a SAP Reference2 with an
 * old one and a re-run of the sync never adopts the wrong document.
 */

const DOCTYPE = "CMMS Purchase Order";
const LINE = "CMMS Purchase Order Line";

const FIELDS = ["name", "purchase_quotation", "purchase_request", "company", "status", "sync_status", "vendor_code", "vendor_name",
  "po_date", "delivery_date", "remarks", "quotation_expired", "raised_by", "raised_at", "sap_doc_entry", "sap_doc_number", "posted_at", "error", "modified",
  "cancel_status", "cancel_reason", "cancel_requested_by", "cancel_requested_at"];
const LINE_FIELDS = ["parent", "idx", "name", "quotation_line", "pr_line", "item", "item_name", "sap_item_code", "vendor_uom", "inventory_uom",
  "qty", "price", "tax_code", "received_qty"];

const tidy = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const notFound = (message) => Object.assign(new Error(message), { status: 404 });

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The PO's remarks go to SAP's Comments with the PO number, which hold 254. */
const REMARKS_MAX = 200;

const toLine = (row) => {
  const qty = Number(row.qty || 0);
  const received = Number(row.received_qty || 0);
  return {
    lineId: row.name,
    itemCode: row.item,
    name: row.item_name || row.item,
    sapItemCode: row.sap_item_code || "",
    vendorUnit: row.vendor_uom || "",
    inventoryUnit: row.inventory_uom || "",
    qty,
    price: Number(row.price || 0),
    taxCode: row.tax_code || "",
    received,
    pending: Math.max(0, qty - received),
  };
};

/**
 * Why a PO cannot be cancelled now, or "" when it can (27 Oct 2026). Pure.
 *
 * Only an Open one nothing has been received against: SAP refuses to cancel a PO with a GRPO on it, and goods in
 * the store are not undone by a cancel. One still Queued is on its way to SAP, so it waits for the sync.
 *
 * @param lines    its line rows (received_qty)
 * @param receipts goods receipts entered against it and not posted yet: [{ name }]
 */
export const cancelRefusal = (row, lines = [], receipts = []) => {
  if (row.cancel_status === "Queued") return "Its cancellation is already with the SAP sync.";
  if ((row.status || "Open") !== "Open") return `It is ${row.status}; there is nothing to cancel.`;
  if (row.sync_status === "Queued") return "It is on its way to SAP. Wait a few seconds for the sync, then cancel it.";
  if (lines.some((l) => Number(l.received_qty || 0) > 0)) return "Goods have been received against it, so SAP will not cancel it.";
  if (receipts.length) return `A goods receipt is entered against it (${receipts.map((r) => r.name).join(", ")}); delete that first.`;
  return "";
};

const toOrder = (row, lines = []) => ({
  id: row.name,
  quotation: row.purchase_quotation,
  request: row.purchase_request || "",
  company: row.company,
  companyName: storeForCompany(row.company)?.label || row.company,
  status: row.status || "Open",
  syncStatus: row.sync_status || "Queued",
  vendorCode: row.vendor_code || "",
  vendorName: row.vendor_name || "",
  date: row.po_date || null,
  deliveryDate: row.delivery_date || null,
  remarks: row.remarks || "",
  quotationExpired: Number(row.quotation_expired) === 1,
  raisedBy: row.raised_by || "",
  raisedAt: row.raised_at || null,
  sapDocEntry: row.sap_doc_entry || null,
  sapDocNumber: row.sap_doc_number || "",
  postedAt: row.posted_at || null,
  error: row.error || "",
  lines: lines.map(toLine),
  value: Math.round(lines.reduce((sum, l) => sum + Number(l.qty || 0) * Number(l.price || 0), 0) * 100) / 100,
  // The receipts waiting against it are checked when Cancel is pressed; the list goes by its lines alone.
  cancel: {
    status: row.cancel_status || "",
    reason: row.cancel_reason || "",
    by: row.cancel_requested_by || "",
    at: row.cancel_requested_at || null,
    refusal: cancelRefusal(row, lines),
  },
  updatedAt: row.modified,
});

/**
 * The next PO name: one above the highest number this year among the CMMS POs
 * and the requests that carried a PO the old way. Pure.
 *
 * @param year          "2026"
 * @param orderNames    names of CMMS Purchase Orders, any year
 * @param oldPoRequests names of CMMS Purchase Requests with a PO made on them
 */
export const nextOrderName = (year, orderNames = [], oldPoRequests = []) => {
  const numberOf = (prefix) => (name) => {
    const m = new RegExp(`^${prefix}-${year}-(\\d+)$`).exec(String(name));
    return m ? Number(m[1]) : 0;
  };
  const last = Math.max(0, ...orderNames.map(numberOf("PO")), ...oldPoRequests.map(numberOf("PR")));
  return `PO-${year}-${String(last + 1).padStart(5, "0")}`;
};

/**
 * Checks a PO against its quotation, and gives back what to write. Pure, so
 * the rules can be tested without ERPNext.
 *
 * @param quotation the CMMS Purchase Quotation, with its lines
 * @param body      { poDate, deliveryDate, remarks, acceptExpired, lines: [{ lineId, qty }] }
 * @param today     YYYY-MM-DD
 */
export const checkOrder = (quotation, body = {}, today = erpToday()) => {
  if (quotation.purchase_order) throw badRequest(`PO ${quotation.purchase_order} has already been made from this quotation.`);
  if (quotation.cancel_status === "Queued") throw badRequest("This quotation is being cancelled in SAP.");
  if (!mayMakeOrder(quotation)) {
    if (quotation.status === "Cancelled") throw badRequest("This quotation was cancelled in SAP.");
    throw badRequest("SAP does not have this quotation yet, so a PO cannot be made from it. Wait for the sync.");
  }

  const poDate = tidy(body.poDate) || today;
  const deliveryDate = tidy(body.deliveryDate);
  if (!DAY.test(poDate)) throw badRequest("Give the PO date.");
  if (!DAY.test(deliveryDate)) throw badRequest("Give the delivery date.");
  if (deliveryDate < poDate) throw badRequest("The delivery date cannot be before the PO date.");
  const remarks = tidy(body.remarks);
  if (remarks.length > REMARKS_MAX) throw badRequest(`The remarks can be at most ${REMARKS_MAX} characters.`);

  // Approved with a warning (24 Oct 2026): the signature on the printout is the
  // approval, so an expired quotation still makes a PO once that is confirmed.
  const expired = isExpired(quotation, poDate);
  if (expired && body.acceptExpired !== true) {
    throw badRequest(`The quotation expired on ${String(quotation.valid_until).slice(0, 10)}. Confirm to make the PO anyway.`);
  }

  const wanted = new Map((Array.isArray(body.lines) ? body.lines : []).map((w) => [tidy(w?.lineId), w]));
  const lines = (quotation.lines || []).map((line) => {
    const label = line.item_name || line.item;
    const w = wanted.get(line.name);
    // The whole quotation is what was signed; a line is not left off.
    const qty = Number(w ? w.qty : line.vendor_qty);
    if (!Number.isFinite(qty) || qty <= 0) throw badRequest(`The quantity for ${label} must be more than zero.`);
    return {
      doctype: LINE,
      quotation_line: line.name,
      pr_line: line.pr_line,
      item: line.item,
      item_name: line.item_name,
      sap_item_code: line.sap_item_code,
      vendor_uom: line.vendor_uom,
      inventory_uom: line.inventory_uom,
      qty,
      price: Number(line.price || 0),
      // No tax code on a PO (27 Oct 2026), even from a quotation saved with one: the goods receipt takes it off the bill.
      tax_code: "",
      received_qty: 0,
    };
  });
  if (!lines.length) throw badRequest("The quotation has no lines.");
  for (const id of wanted.keys()) {
    if (!(quotation.lines || []).some((l) => l.name === id)) throw badRequest("A line is not on this quotation.");
  }

  return {
    purchase_quotation: quotation.name,
    purchase_request: quotation.purchase_request,
    company: quotation.company,
    vendor_code: quotation.vendor_code,
    vendor_name: quotation.vendor_name,
    po_date: poDate,
    delivery_date: deliveryDate,
    remarks,
    quotation_expired: expired ? 1 : 0,
    lines,
  };
};

/** Purchase orders, newest first, each with its lines. */
export const listOrders = async ({ status = "", syncStatus = "", limit = 100 } = {}) => {
  const filters = [];
  if (status) filters.push([DOCTYPE, "status", "=", status]);
  if (syncStatus) filters.push([DOCTYPE, "sync_status", "=", syncStatus]);
  const rows = await listDocs(DOCTYPE, { fields: FIELDS, filters: filters.length ? filters : undefined, orderBy: "creation desc", limit });
  if (!rows.length) return [];
  const byParent = new Map();
  for (let i = 0; i < rows.length; i += 100) {
    const lines = await listChildRows(LINE, DOCTYPE, {
      fields: LINE_FIELDS,
      filters: [[LINE, "parent", "in", rows.slice(i, i + 100).map((r) => r.name)]],
      limit: 2000,
      orderBy: "idx asc",
    });
    for (const l of lines) {
      if (!byParent.has(l.parent)) byParent.set(l.parent, []);
      byParent.get(l.parent).push(l);
    }
  }
  return rows.map((r) => toOrder(r, byParent.get(r.name) || []));
};

export const getOrder = async (id) => {
  const doc = await getDoc(DOCTYPE, id).catch((error) => {
    if (error?.status === 404) return null;
    throw error;
  });
  return doc ? toOrder(doc, doc.lines || []) : null;
};

const nextName = async () => {
  const year = erpToday().slice(0, 4);
  const [orders, oldPos] = await Promise.all([
    listDocs(DOCTYPE, { fields: ["name"], filters: [[DOCTYPE, "name", "like", `PO-${year}-%`]], orderBy: "name desc", limit: 1 }),
    listDocs("CMMS Purchase Request", {
      fields: ["name"],
      filters: [["CMMS Purchase Request", "po_status", "is", "set"], ["CMMS Purchase Request", "name", "like", `PR-${year}-%`]],
      orderBy: "name desc",
      limit: 1,
    }),
  ]);
  return nextOrderName(year, orders.map((o) => o.name), oldPos.map((r) => r.name));
};

/**
 * The purchase manager makes the PO from a quotation SAP has.
 *
 * @param body { poDate, deliveryDate, remarks, acceptExpired, lines: [{ lineId, qty }] }
 */
export const makeOrder = async (quotationId, body = {}, user) => {
  const quotation = await readQuotation(quotationId);
  if (!quotation) throw notFound("Quotation not found");
  const fields = checkOrder(quotation, body);
  const doc = { doctype: DOCTYPE, ...fields, status: "Open", sync_status: "Queued", raised_by: user?.email || "", raised_at: erpNow() };

  // Two POs made in the same moment would be given the same number; the
  // second is refused as a duplicate and takes the next one.
  let created = null;
  for (let attempt = 0; !created; attempt += 1) {
    try {
      created = await createDoc(DOCTYPE, { ...doc, name: await nextName() });
    } catch (error) {
      if (error?.status !== 409 || attempt >= 2) throw error;
    }
  }

  // The quotation names its PO, which is what stops a second one. A PO the
  // quotation could not be pointed at is taken back rather than left behind.
  try {
    await updateDoc(QUOTATION_DOCTYPE, quotation.name, { purchase_order: created.name });
  } catch (error) {
    await deleteDoc(DOCTYPE, created.name).catch(() => {});
    console.error("Quotation not linked to its PO:", error.message);
    throw Object.assign(new Error("The PO could not be recorded on the quotation, so it was not saved. Try again."), { status: 400 });
  }
  await raiseSapFlag(user?.email);
  return getOrder(created.name);
};

/**
 * Cancels a PO (27 Oct 2026). One SAP has is cancelled there by the sync (PurchaseOrders(n)/Cancel), which turns it
 * Closed, marks its quotation Cancelled - SAP keeps that closed - and opens its request lines for a new quotation
 * (the user's choice; tested in HITECH_RUBBER the same day: the request's lines stay open in SAP and a new quotation
 * can be based on them). One SAP refused, and so never had, is closed here at once, and its quotation - still open
 * in SAP - is free to make a new PO from.
 */
export const cancelOrder = async (id, body = {}, user) => {
  const doc = await getDoc(DOCTYPE, tidy(id)).catch((error) => {
    if (error?.status === 404) return null;
    throw error;
  });
  if (!doc) throw notFound("Purchase order not found");
  const receipts = await listDocs("CMMS Goods Receipt", {
    fields: ["name"],
    filters: [["CMMS Goods Receipt", "purchase_order", "=", doc.name], ["CMMS Goods Receipt", "status", "in", ["Queued", "Failed"]]],
    limit: 20,
  });
  const refusal = cancelRefusal(doc, doc.lines || [], receipts);
  if (refusal) throw badRequest(refusal);
  const reason = cancelReason(body.reason);
  const at = erpNow();
  const stamp = { cancel_reason: reason, cancel_requested_by: user?.email || "", cancel_requested_at: at };
  if (doc.sync_status === "Failed") {
    await updateDoc(DOCTYPE, doc.name, { ...stamp, cancel_status: "Done", status: "Closed", error: `Cancelled in the CMMS by ${user?.email || "?"} ${at} - SAP never had it: ${reason}` });
    await updateDoc(QUOTATION_DOCTYPE, doc.purchase_quotation, { purchase_order: "" });
  } else {
    await updateDoc(DOCTYPE, doc.name, { ...stamp, cancel_status: "Queued" });
    await raiseSapFlag(user?.email);
  }
  return getOrder(doc.name);
};

/** Sends a PO that SAP refused back to the SAP server as it is. */
export const retryOrder = async (id, user) => {
  const doc = await getDoc(DOCTYPE, id).catch(() => null);
  if (!doc) throw notFound("Purchase order not found");
  if (doc.sync_status !== "Failed") throw badRequest("Only a purchase order that SAP refused can be sent again.");
  await updateDoc(DOCTYPE, id, { sync_status: "Queued", error: "" });
  await raiseSapFlag(user?.email);
  return getOrder(id);
};
