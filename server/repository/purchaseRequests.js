import {
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
 */

const DOCTYPE = "CMMS Purchase Request";
const LINE = "CMMS Purchase Request Line";

const FIELDS = ["name", "company", "status", "required_by", "reason", "raised_by", "raised_at", "sap_doc_entry", "sap_doc_number", "po_numbers", "posted_at", "error", "modified",
  "po_status", "po_vendor_code", "po_vendor_name", "po_date", "po_due_date", "po_remarks", "po_raised_by", "po_raised_at", "po_doc_entry", "po_doc_number", "po_error"];
const LINE_FIELDS = ["parent", "idx", "item", "item_name", "sap_item_code", "qty", "uom", "remarks", "po_qty", "po_price", "po_tax_code"];

const tidy = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const notFound = (message) => Object.assign(new Error(message), { status: 404 });

/** SAP's Comments on a document hold 254 characters; the reason goes there with who raised it. */
const REASON_MAX = 250;
/** SAP's line FreeText is 100. */
const REMARKS_MAX = 100;
/** The PO's remarks go to SAP's Comments with the request number, which hold 254. */
const PO_REMARKS_MAX = 200;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const toLine = (row) => ({
  itemCode: row.item,
  name: row.item_name || row.item,
  sapItemCode: row.sap_item_code || "",
  qty: Number(row.qty || 0),
  unit: row.uom || "",
  remarks: row.remarks || "",
  orderQty: Number(row.po_qty || 0),
  price: Number(row.po_price || 0),
  taxCode: row.po_tax_code || "",
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
 * A PO can be made from it: in SAP, no PO yet (one made in SAP itself turns it
 * Ordered), and no order of ours queued or posted. A failed one is made again.
 */
export const mayOrder = (row) =>
  row.status === "In SAP" && Boolean(row.sap_doc_entry) && ["", null, undefined, "Failed"].includes(row.po_status);

const toRequest = (row, lines = []) => ({
  id: row.name,
  company: row.company,
  companyName: storeForCompany(row.company)?.label || row.company,
  status: row.status || "Queued",
  requiredBy: row.required_by || null,
  reason: row.reason || "",
  raisedBy: row.raised_by || "",
  raisedAt: row.raised_at || null,
  sapDocEntry: row.sap_doc_entry || null,
  sapDocNumber: row.sap_doc_number || "",
  poNumbers: row.po_numbers || "",
  postedAt: row.posted_at || null,
  error: row.error || "",
  lines: lines.map(toLine),
  order: toOrder(row, lines),
  mayOrder: mayOrder(row),
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
  return rows.map((r) => toRequest(r, byParent.get(r.name) || []));
};

export const getRequest = async (id) => {
  const doc = await getDoc(DOCTYPE, id).catch((error) => {
    if (error?.status === 404) return null;
    throw error;
  });
  return doc ? toRequest(doc, doc.lines || []) : null;
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

/**
 * Checks an order against the request and the published SAP lists, and gives
 * back what to write. Pure, so the rules can be tested without ERPNext.
 *
 * @param doc       the CMMS Purchase Request, with its lines
 * @param body      { vendorCode, poDate, dueDate, remarks, lines: [{ itemCode, qty, price, taxCode }] }
 * @param published { vendors: [{ code, name }], taxCodes: [{ code, name, rate }] }
 * @param today     YYYY-MM-DD
 */
export const checkOrder = (doc, body = {}, published = {}, today = erpToday()) => {
  if (["Queued", "Posted"].includes(doc.po_status)) throw badRequest("A purchase order has already been made from this request.");
  if (!mayOrder(doc)) {
    if (["Queued", "Failed"].includes(doc.status)) throw badRequest("The request is not in SAP yet, so a PO cannot be made from it. Wait for the sync.");
    throw badRequest(`This request is ${doc.status}; only one in SAP without a PO can be ordered.`);
  }

  const vendorCode = tidy(body.vendorCode);
  if (!vendorCode) throw badRequest("Choose the vendor.");
  const vendor = (published.vendors || []).find((v) => tidy(v.code) === vendorCode);
  if (!vendor) throw badRequest(`That vendor is not among the SAP suppliers for ${doc.company}.`);

  const poDate = tidy(body.poDate) || today;
  const dueDate = tidy(body.dueDate);
  if (!DAY.test(poDate)) throw badRequest("Give the PO date.");
  if (!DAY.test(dueDate)) throw badRequest("Give the delivery date.");
  if (dueDate < poDate) throw badRequest("The delivery date cannot be before the PO date.");
  const remarks = tidy(body.remarks);
  if (remarks.length > PO_REMARKS_MAX) throw badRequest(`The remarks can be at most ${PO_REMARKS_MAX} characters.`);

  const taxCodes = (published.taxCodes || []).map((t) => t.code);
  const wanted = new Map((Array.isArray(body.lines) ? body.lines : []).map((w) => [tidy(w?.itemCode), w]));
  let ordered = 0;
  const lines = (doc.lines || []).map((line) => {
    const w = wanted.get(line.item);
    const label = line.item_name || line.item;
    const qty = Number(w?.qty || 0);
    if (!w || !(qty > 0)) return { ...line, po_qty: 0, po_price: 0, po_tax_code: "" };
    if (qty > Number(line.qty || 0)) throw badRequest(`Only ${Number(line.qty)} of ${label} was requested.`);
    const price = Number(w.price);
    if (!Number.isFinite(price) || price <= 0) throw badRequest(`Give the price for ${label}.`);
    const taxCode = tidy(w.taxCode);
    if (taxCode && taxCodes.length && !taxCodes.includes(taxCode)) throw badRequest(`The tax code for ${label} is not one SAP has.`);
    ordered += 1;
    return { ...line, po_qty: qty, po_price: price, po_tax_code: taxCode };
  });
  if (!ordered) throw badRequest("Order at least one item.");

  return {
    po_status: "Queued",
    po_vendor_code: vendorCode,
    po_vendor_name: tidy(vendor.name),
    po_date: poDate,
    po_due_date: dueDate,
    po_remarks: remarks,
    po_error: "",
    lines,
  };
};

/** The purchase manager makes the PO; the sync posts it to SAP. */
export const orderRequest = async (id, body, user) => {
  const doc = await getDoc(DOCTYPE, id).catch(() => null);
  if (!doc) throw notFound("Purchase request not found");
  const edits = checkOrder(doc, body, await vendorsFor(doc.company));
  await updateDoc(DOCTYPE, id, {
    ...edits,
    po_raised_by: user?.email || "",
    po_raised_at: erpNow(),
    // The whole table, as Frappe replaces a child table it is given.
    lines: edits.lines.map((l) => ({
      name: l.name,
      item: l.item,
      item_name: l.item_name,
      sap_item_code: l.sap_item_code,
      qty: l.qty,
      uom: l.uom,
      remarks: l.remarks,
      po_qty: l.po_qty,
      po_price: l.po_price,
      po_tax_code: l.po_tax_code,
    })),
  });
  await raiseSapFlag(user?.email);
  return getRequest(id);
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
