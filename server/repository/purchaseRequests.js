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
 */

const DOCTYPE = "CMMS Purchase Request";
const LINE = "CMMS Purchase Request Line";

const FIELDS = ["name", "company", "status", "required_by", "reason", "raised_by", "raised_at", "sap_doc_entry", "sap_doc_number", "po_numbers", "posted_at", "error", "modified"];
const LINE_FIELDS = ["parent", "idx", "item", "item_name", "sap_item_code", "qty", "uom", "remarks"];

const tidy = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const notFound = (message) => Object.assign(new Error(message), { status: 404 });

/** SAP's Comments on a document hold 254 characters; the reason goes there with who raised it. */
const REASON_MAX = 250;
/** SAP's line FreeText is 100. */
const REMARKS_MAX = 100;

const toLine = (row) => ({
  itemCode: row.item,
  name: row.item_name || row.item,
  sapItemCode: row.sap_item_code || "",
  qty: Number(row.qty || 0),
  unit: row.uom || "",
  remarks: row.remarks || "",
});

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
