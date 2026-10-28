import {
  callMethod,
  createDoc,
  getDoc,
  listChildRows,
  listDocs,
  updateDoc,
} from "../integrations/erpnext/client.js";
import { erpNow, erpToday } from "../integrations/erpnext/time.js";
import { storeForCompany } from "../integrations/erpnext/stores.js";
import { catalogProducts } from "./catalog.js";
import { itemMasterOptions, raiseSapFlag } from "./sapCategories.js";
import { COMPLETED, ordersFor, receiptProgress, receiptsAgainst, stageOf, toReceiptSummary, workOf } from "./purchaseCompletion.js";

/**
 * Purchase requests for engineering stock, raised in the CMMS (9 Oct 2026).
 *
 * The Maintenance Manager picks items of one SAP company and says how many,
 * by when, and why. The sync on the SAP server posts it as a SAP Purchase
 * Request; the purchase manager at the maintenance office converts it to a
 * Purchase Order in SAP, as they raise every PO; the sync sees the PO (its
 * lines are based on the request) and records its number here, and the PO
 * shows up in the goods receipt form, so what arrives is received against it.
 *
 *   Queued -> In SAP (SAP request no.) -> Ordered (PO no.) -> Closed
 *                                                         or Failed (SAP's reason)
 *
 * Like the rest of the item master, this server never talks to SAP: it writes
 * a "CMMS Purchase Request" in ERPNext and raises the flag.
 *
 * Since 20 Oct 2026 the purchase manager can make the PO here instead of in
 * SAP: vendor, dates and a price per line, written on the request as an order
 * (po_status Queued). The sync posts it as a SAP Purchase Order copied from the
 * SAP purchase request, so SAP links the two, and the request goes Ordered as
 * it does for a PO made in SAP.
 *
 *   order: (none) -> Queued -> Posted (SAP PO no.), or Failed (SAP's reason)
 *          Posted -> Cancelled, when the PO is cancelled in SAP
 *
 * A request whose every PO was cancelled in SAP ends (20 Oct 2026): the sync
 * closes it, says so in `error`, and closes its SAP purchase request. It is
 * not ordered again; a new need is a new request.
 *
 * Since 23 Oct 2026 an Ordered request goes Completed once the goods receipts
 * posted against its PO cover every line (purchaseCompletion.js). Completed is
 * the CMMS's own, read only: nothing can be ordered or sent again from it.
 *
 *   Ordered -> Completed (every item received), and back if that stops holding
 *
 * Since 24 Oct 2026 the PO is no longer made on the request. The purchase
 * manager enters the chosen vendor's quotation against it instead
 * (purchaseQuotations.js) and makes the PO from that. Each line is open until a
 * quotation takes it (Quoted) or the purchase manager drops it with a reason
 * (Dropped). The po_* fields stay as the record of POs made here before, and
 * one of those that SAP refused can still be sent again.
 */

const DOCTYPE = "CMMS Purchase Request";
const LINE = "CMMS Purchase Request Line";

const FIELDS = ["name", "company", "status", "required_by", "reason", "raised_by", "raised_at", "sap_doc_entry", "sap_doc_number", "po_numbers", "posted_at", "error", "modified",
  "po_status", "po_vendor_code", "po_vendor_name", "po_date", "po_due_date", "po_remarks", "po_raised_by", "po_raised_at", "po_doc_entry", "po_doc_number", "po_error",
  "cancel_status", "cancel_reason", "cancel_requested_by", "cancel_requested_at"];
const LINE_FIELDS = ["parent", "idx", "name", "item", "item_name", "sap_item_code", "qty", "uom", "remarks", "po_qty", "po_price", "po_tax_code",
  "coverage", "quotation", "drop_reason"];

const tidy = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const notFound = (message) => Object.assign(new Error(message), { status: 404 });

/** SAP's Comments on a document hold 254 characters; the reason goes there with who raised it. */
const REASON_MAX = 250;
/** SAP's line FreeText is 100. */
const REMARKS_MAX = 100;
/** Why a line was dropped, said on the request card. */
const DROP_REASON_MAX = 140;

const toLine = (row, received = null) => ({
  lineId: row.name,
  itemCode: row.item,
  name: row.item_name || row.item,
  sapItemCode: row.sap_item_code || "",
  qty: Number(row.qty || 0),
  unit: row.uom || "",
  remarks: row.remarks || "",
  orderQty: Number(row.po_qty || 0),
  price: Number(row.po_price || 0),
  taxCode: row.po_tax_code || "",
  // What the goods receipts posted against its PO have brought in, once ordered.
  received: received ? received.get(row.item) || 0 : null,
  coverage: row.coverage || "",
  quotation: row.quotation || "",
  dropReason: row.drop_reason || "",
});

/** The purchase order made from it in the app, or null. */
const toOrder = (row, lines) => {
  if (!row.po_status) return null;
  const value = lines.reduce((sum, l) => sum + Number(l.po_qty || 0) * Number(l.po_price || 0), 0);
  return {
    status: row.po_status,
    vendorCode: row.po_vendor_code || "",
    vendorName: row.po_vendor_name || "",
    date: row.po_date || null,
    dueDate: row.po_due_date || null,
    remarks: row.po_remarks || "",
    raisedBy: row.po_raised_by || "",
    raisedAt: row.po_raised_at || null,
    sapDocEntry: row.po_doc_entry || null,
    sapDocNumber: row.po_doc_number || "",
    error: row.po_error || "",
    value: Math.round(value * 100) / 100,
  };
};

/**
 * A quotation can be entered against it: in SAP, no PO made on the request the
 * old way (one made in SAP itself turns it Ordered), and a line still open.
 * `row.lines` are the request's line rows.
 */
/**
 * Statuses a request may be quoted from: In SAP, and Ordered once a PO from one
 * of its quotations is in SAP (25 Oct 2026) - quoted in parts, a request would
 * otherwise be stuck with its other lines open.
 */
export const QUOTING = ["In SAP", "Ordered"];

/**
 * Whether its open lines can still be quoted or dropped. Ordered counts only
 * through a quotation (a line already Quoted): one ordered in SAP itself, or on
 * the request the old way, is not quoted.
 */
export const linesOpenFor = (row) =>
  !row.po_status &&
  (row.status === "In SAP" || (row.status === "Ordered" && (row.lines || []).some((l) => l.coverage === "Quoted")));

export const mayQuote = (row) => linesOpenFor(row) && Boolean(row.sap_doc_entry) && (row.lines || []).some((l) => !l.coverage);

/** What a cancel reason can be: it goes into SAP's Comments with the canceller's login. */
export const CANCEL_REASON_MAX = 140;

/**
 * Why a request cannot be cancelled now, or "" when it can (27 Oct 2026). Pure.
 *
 * Its quotations and POs are cancelled first, one by one (the user's choice) - a cancel never cascades. One still
 * Queued is on its way to SAP, so it waits for the sync rather than racing it.
 *
 * @param quotations [{ id, status }]   orders: the request's CMMS POs [{ name, status }]
 */
export const cancelRefusal = (row, quotations = [], orders = []) => {
  const status = row.status || "Queued";
  if (row.cancel_status === "Queued") return "Its cancellation is already with the SAP sync.";
  if (status === "Queued") return "It is on its way to SAP. Wait a few seconds for the sync, then cancel it.";
  if (status === "Closed" || status === COMPLETED) return `It is ${status}; there is nothing to cancel.`;
  const liveQuotes = quotations.filter((q) => q.status !== "Cancelled");
  // A quotation SAP has not got yet (Queued, Failed) is deleted rather than cancelled.
  if (liveQuotes.length) return `Cancel or delete its quotation${liveQuotes.length > 1 ? "s" : ""} first: ${liveQuotes.map((q) => q.id).join(", ")}.`;
  const liveOrders = orders.filter((o) => o.status !== "Closed");
  if (liveOrders.length) return `Cancel its purchase order${liveOrders.length > 1 ? "s" : ""} first: ${liveOrders.map((o) => o.name).join(", ")}.`;
  if (row.po_status && row.po_status !== "Failed") return "A PO was made on it before quotations; cancel that PO in SAP.";
  if (status === "Ordered") return "SAP has a PO for it. Cancel that PO in SAP first.";
  return "";
};

/** Statuses whose goods can be coming in, so their receipts are looked up. */
const RECEIVING = ["Ordered", COMPLETED];

/** The posted receipts against each request, by request name. */
const receiptsOf = async (rows) => {
  const out = new Map();
  const open = rows.filter((r) => RECEIVING.includes(r.status));
  if (!open.length) return out;
  const receipts = await receiptsAgainst(open);
  for (const r of open) {
    const progress = receiptProgress(r, receipts);
    out.set(r.name, {
      receipts: progress.receipts.map(toReceiptSummary),
      received: new Map(progress.lines.map((l) => [l.item, l.received])),
    });
  }
  return out;
};

/** The CMMS POs made from each request's quotations, by request name. The stage stands without them. */
const ordersOf = async (names) => {
  const out = new Map();
  const orders = await ordersFor(names).catch((error) => {
    console.error("Purchase orders for purchase requests not read:", error.message);
    return [];
  });
  for (const o of orders) {
    if (!out.has(o.purchase_request)) out.set(o.purchase_request, []);
    out.get(o.purchase_request).push(o);
  }
  return out;
};

const toRequest = (row, lines = [], got = null, quotations = [], orders = []) => ({
  id: row.name,
  company: row.company,
  companyName: storeForCompany(row.company)?.label || row.company,
  status: row.status || "Queued",
  // Where it stands for the people waiting on it: Quotation Made, Ordered and Completed as soon as they are
  // true, without waiting for the sync. `status` stays what SAP says, and what the actions go by.
  stage: stageOf({ ...row, lines }, quotations, orders),
  // The purchase manager's side alone: Pending until a PO is made for every line, then Complete (27 Oct 2026).
  work: workOf({ ...row, lines }, orders),
  requiredBy: row.required_by || null,
  reason: row.reason || "",
  raisedBy: row.raised_by || "",
  raisedAt: row.raised_at || null,
  sapDocEntry: row.sap_doc_entry || null,
  sapDocNumber: row.sap_doc_number || "",
  poNumbers: row.po_numbers || "",
  postedAt: row.posted_at || null,
  error: row.error || "",
  lines: lines.map((l) => toLine(l, got?.received)),
  receipts: got?.receipts || [],
  order: toOrder(row, lines),
  quotations,
  mayQuote: mayQuote({ ...row, lines }),
  // Cancelling from the CMMS (27 Oct 2026). Who may press it is the controller's; whether it can be is this.
  cancel: {
    status: row.cancel_status || "",
    reason: row.cancel_reason || "",
    by: row.cancel_requested_by || "",
    at: row.cancel_requested_at || null,
    refusal: cancelRefusal(row, quotations, orders),
  },
  updatedAt: row.modified,
});

/** Requests, newest first, each with its lines. */
export const listRequests = async ({ status = "", limit = 100, onlyCompanies = null } = {}) => {
  const filters = [];
  if (status) filters.push([DOCTYPE, "status", "=", status]);
  // A plant head sees their own company's requests and no other. An empty
  // list means none, not all - see scopeFor.
  if (Array.isArray(onlyCompanies)) {
    filters.push([DOCTYPE, "company", "in", onlyCompanies.length ? onlyCompanies : ["__none__"]]);
  }
  const rows = await listDocs(DOCTYPE, {
    fields: FIELDS,
    filters: filters.length ? filters : undefined,
    orderBy: "creation desc",
    limit,
  });
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
  for (const r of rows) r.lines = byParent.get(r.name) || [];
  // The receipts are a nicety on the card; the list stands without them.
  const got = await receiptsOf(rows).catch((error) => {
    console.error("Goods receipts for purchase requests not read:", error.message);
    return new Map();
  });
  const quotations = await quotationsForRequests(rows.map((r) => r.name));
  const orders = await ordersOf(rows.map((r) => r.name));
  return rows.map((r) => toRequest(r, r.lines, got.get(r.name), quotations.get(r.name) || [], orders.get(r.name) || []));
};

export const getRequest = async (id) => {
  const doc = await getDoc(DOCTYPE, id).catch((error) => {
    if (error?.status === 404) return null;
    throw error;
  });
  if (!doc) return null;
  const got = await receiptsOf([doc]).catch(() => new Map());
  const quotations = await quotationsForRequests([doc.name]);
  const orders = await ordersOf([doc.name]);
  return toRequest(doc, doc.lines || [], got.get(doc.name), quotations.get(doc.name) || [], orders.get(doc.name) || []);
};

/** A cancel reason, checked: required, and short enough for SAP's Comments. */
export const cancelReason = (value) => {
  const reason = tidy(value);
  if (!reason) throw badRequest("Say why it is being cancelled.");
  if (reason.length > CANCEL_REASON_MAX) throw badRequest(`Keep the reason to ${CANCEL_REASON_MAX} characters.`);
  return reason;
};

/**
 * Cancels a request (27 Oct 2026). One SAP has is cancelled there by the sync (PurchaseRequests(n)/Cancel), which
 * then turns it Closed; one SAP refused, and so never had, is closed here at once.
 */
export const cancelRequest = async (id, body = {}, user) => {
  const doc = await getDoc(DOCTYPE, tidy(id)).catch((error) => {
    if (error?.status === 404) return null;
    throw error;
  });
  if (!doc) throw notFound("Purchase request not found");
  const quotations = (await quotationsForRequests([doc.name])).get(doc.name) || [];
  const orders = (await ordersOf([doc.name])).get(doc.name) || [];
  const refusal = cancelRefusal(doc, quotations, orders);
  if (refusal) throw badRequest(refusal);
  const reason = cancelReason(body.reason);
  const at = erpNow();
  const stamp = { cancel_reason: reason, cancel_requested_by: user?.email || "", cancel_requested_at: at };
  if (!doc.sap_doc_entry) {
    await updateDoc(DOCTYPE, doc.name, { ...stamp, cancel_status: "Done", status: "Closed", error: `Cancelled in the CMMS by ${user?.email || "?"} ${at} - SAP never had it: ${reason}` });
  } else {
    await updateDoc(DOCTYPE, doc.name, { ...stamp, cancel_status: "Queued", error: "" });
    await raiseSapFlag(user?.email);
  }
  return getRequest(doc.name);
};

/**
 * Raises a purchase request for items of one SAP company.
 *
 * @param body { company, requiredBy, reason, lines: [{ itemCode, qty, remarks }] }
 */
export const raiseRequest = async (body = {}, user) => {
  const company = tidy(body.company).toUpperCase();
  const options = (await itemMasterOptions())[company];
  if (!options) throw badRequest("Choose the SAP company the items are for.");

  const requiredBy = tidy(body.requiredBy);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requiredBy)) throw badRequest("Say by when the items are needed.");
  if (requiredBy < erpToday()) throw badRequest("The required-by date cannot be in the past.");
  const reason = tidy(body.reason);
  if (!reason) throw badRequest("Give the reason - the purchase manager reads it in SAP.");
  if (reason.length > REASON_MAX) throw badRequest(`The reason can be at most ${REASON_MAX} characters - SAP keeps it in the document's remarks.`);

  const wanted = Array.isArray(body.lines) ? body.lines : [];
  if (!wanted.length) throw badRequest("Add at least one item.");
  const products = new Map((await catalogProducts()).map((p) => [p.code, p]));
  const seen = new Set();
  const lines = wanted.map((w) => {
    const product = products.get(tidy(w?.itemCode));
    if (!product) throw notFound(`${tidy(w?.itemCode) || "An item"} is not in Engineering Stock.`);
    if (product.sapCategory?.company !== company) throw badRequest(`${product.name} belongs to another company - a purchase request is for one company.`);
    if (!product.sap?.code) throw badRequest(`${product.name} is not in SAP yet, so it cannot be requested.`);
    if (seen.has(product.code)) throw badRequest(`${product.name} is on the request twice.`);
    seen.add(product.code);
    const qty = Number(w.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw badRequest(`The quantity for ${product.name} must be more than zero.`);
    const remarks = tidy(w.remarks);
    if (remarks.length > REMARKS_MAX) throw badRequest(`The remarks for ${product.name} can be at most ${REMARKS_MAX} characters.`);
    return { doctype: LINE, item: product.code, item_name: product.name, sap_item_code: product.sap.code, qty, uom: product.unit, remarks };
  });

  const created = await createDoc(DOCTYPE, {
    doctype: DOCTYPE,
    company,
    status: "Queued",
    required_by: requiredBy,
    reason,
    raised_by: user?.email || "",
    raised_at: erpNow(),
    lines,
  });
  await raiseSapFlag(user?.email);
  return getRequest(created.name);
};

/** Sends a request that failed to reach SAP back to the SAP server. */
export const retryRequest = async (id, user) => {
  const doc = await getDoc(DOCTYPE, id).catch(() => null);
  if (!doc) throw notFound("Purchase request not found");
  if (doc.status !== "Failed") throw badRequest(`This request is ${doc.status}; only a failed one can be sent again.`);
  await updateDoc(DOCTYPE, id, { status: doc.sap_doc_entry ? "In SAP" : "Queued", error: "" });
  await raiseSapFlag(user?.email);
  return getRequest(id);
};

/**
 * Every SAP company the sync publishes, named as a request's card names it -
 * for the list's company filter, which offers them whether or not any has a
 * request yet.
 */
export const companyOptions = async () =>
  Object.entries(await itemMasterOptions()).map(([abbr, o]) => ({
    abbr,
    company: storeForCompany(abbr)?.label || o.company || abbr,
  }));

/** The SAP suppliers and purchase tax codes the sync publishes for a company. */
export const vendorsFor = async (company) => {
  const abbr = tidy(company).toUpperCase();
  const options = (await itemMasterOptions())[abbr] || {};
  return {
    company: abbr,
    vendors: Array.isArray(options.vendors) ? options.vendors : [],
    taxCodes: Array.isArray(options.tax_codes) ? options.tax_codes : [],
    refreshedAt: options.vendors_refreshed_at || null,
  };
};

/** Sends a PO that SAP refused back to the SAP server. */
export const retryOrder = async (id, user) => {
  const doc = await getDoc(DOCTYPE, id).catch(() => null);
  if (!doc) throw notFound("Purchase request not found");
  if (doc.po_status !== "Failed") throw badRequest("Only a purchase order that failed can be sent again.");
  await updateDoc(DOCTYPE, id, { po_status: "Queued", po_error: "" });
  await raiseSapFlag(user?.email);
  return getRequest(id);
};

/**
 * The quotations entered against these requests, by request, for the request
 * cards - so maintenance and the plant heads can follow a request to its PO
 * without the purchase manager's screens.
 */
const quotationsForRequests = async (requestIds) => {
  const out = new Map();
  for (let i = 0; i < requestIds.length; i += 100) {
    const rows = await listDocs("CMMS Purchase Quotation", {
      fields: ["name", "purchase_request", "status", "vendor_name", "purchase_order", "sap_doc_number"],
      filters: [["CMMS Purchase Quotation", "purchase_request", "in", requestIds.slice(i, i + 100)]],
      orderBy: "creation asc",
      limit: 1000,
    });
    for (const r of rows) {
      if (!out.has(r.purchase_request)) out.set(r.purchase_request, []);
      out.get(r.purchase_request).push({
        id: r.name,
        status: r.status,
        vendorName: r.vendor_name || "",
        purchaseOrder: r.purchase_order || "",
        sapDocNumber: r.sap_doc_number || "",
      });
    }
  }
  return out;
};

/**
 * Writes some fields of one request line. frappe.client.set_value saves the
 * line through its request, so the rest of the table is left as it is - a
 * PUT of the request would have to send every line back.
 */
export const setLineFields = (lineId, fields) =>
  callMethod("frappe.client.set_value", { doctype: LINE, name: lineId, fieldname: fields });

/**
 * Checks dropping a request line - nobody will quote it - and gives back what
 * to write. Pure, so the rule can be tested without ERPNext.
 */
export const checkDrop = (doc, lineId, reason) => {
  const line = (doc.lines || []).find((l) => l.name === lineId);
  if (!line) throw notFound("That line is not on this purchase request.");
  const label = line.item_name || line.item;
  if (!linesOpenFor(doc)) throw badRequest(`This request is ${doc.po_status ? "ordered on the request" : doc.status}; its lines are not quoted or dropped.`);
  if (line.coverage === "Quoted") throw badRequest(`${label} is on quotation ${line.quotation}. Delete the quotation, or cancel it in SAP, first.`);
  if (line.coverage === "Dropped") throw badRequest(`${label} is already dropped.`);
  const why = tidy(reason);
  if (!why) throw badRequest(`Say why ${label} is dropped.`);
  if (why.length > DROP_REASON_MAX) throw badRequest(`Keep the reason to ${DROP_REASON_MAX} characters.`);
  return { coverage: "Dropped", quotation: "", drop_reason: why };
};

/** The purchase manager drops a line nobody will quote, with the reason. */
export const dropLine = async (id, lineId, reason) => {
  const doc = await getDoc(DOCTYPE, id).catch(() => null);
  if (!doc) throw notFound("Purchase request not found");
  await setLineFields(lineId, checkDrop(doc, lineId, reason));
  return getRequest(id);
};

/** A line dropped by mistake is open for a quotation again. */
export const reopenLine = async (id, lineId) => {
  const doc = await getDoc(DOCTYPE, id).catch(() => null);
  if (!doc) throw notFound("Purchase request not found");
  const line = (doc.lines || []).find((l) => l.name === lineId);
  if (!line) throw notFound("That line is not on this purchase request.");
  if (line.coverage !== "Dropped") throw badRequest(`${line.item_name || line.item} is not dropped.`);
  if (!linesOpenFor(doc)) throw badRequest(`This request is ${doc.status}; its lines cannot be opened again.`);
  await setLineFields(lineId, { coverage: "", drop_reason: "" });
  return getRequest(id);
};
