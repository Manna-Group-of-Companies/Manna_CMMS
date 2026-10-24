import { createDoc, deleteDoc, getDoc, listChildRows, listDocs, updateDoc } from "../integrations/erpnext/client.js";
import { erpNow, erpToday } from "../integrations/erpnext/time.js";
import { storeForCompany } from "../integrations/erpnext/stores.js";
import { hsnDigits, hsnProblem, itemMasterOptions, pickFrom, raiseSapFlag } from "./sapCategories.js";
import { QUOTING, listRequests, mayQuote, setLineFields, vendorsFor } from "./purchaseRequests.js";
import { catalogProducts, forgetCatalog } from "./catalog.js";
import { dropQueuedForQuotation, raiseHsnRequests } from "./hsnRequests.js";

/**
 * The chosen vendor's quotation for a purchase request (24 Oct 2026).
 *
 * Vendors quote outside the system and management picks one; the purchase
 * manager enters that one here, in the vendor's own unit (from SAP's unit list
 * for the company), prints it, and management signs the printout. The signature
 * is the approval - there is no approval step in the CMMS. Once SAP has the
 * quotation, the purchase manager makes the PO from it: one quotation, one PO
 * (purchaseOrders.js).
 *
 *   Queued -> Posted (SAP quotation no.), or Failed (SAP's reason)
 *   Posted -> Cancelled, when it is cancelled in SAP - the CMMS cancels nothing
 *
 * A quotation is changed or deleted only while SAP does not have it (Queued or
 * Failed). A posted one is cancelled in SAP and entered again.
 *
 * Each request line it quotes is marked Quoted on the request, so a line has
 * one vendor: a line already on a live quotation is not offered to another.
 *
 * SAP needs an HSN code on a line with a GST tax code, and takes it from the
 * item (PQ-2026-00352, 24 Oct 2026). A line whose item has none asks for one,
 * as a goods receipt line does: it is saved on the line, written onto the item
 * (the sync sets it in SAP before it posts the quotation), and a code SAP does
 * not have yet is asked for as an HSN request - the quotation then waits, as a
 * receipt does, until the sync has created it.
 *
 * Like the rest of purchasing, this server never talks to SAP: it writes the
 * record in ERPNext and raises the flag.
 */

const DOCTYPE = "CMMS Purchase Quotation";
const LINE = "CMMS Purchase Quotation Line";

const FIELDS = ["name", "purchase_request", "company", "status", "vendor_code", "vendor_name", "quotation_date", "valid_until", "remarks",
  "raised_by", "raised_at", "purchase_order", "sap_doc_entry", "sap_doc_number", "posted_at", "error", "modified"];
const LINE_FIELDS = ["parent", "idx", "name", "pr_line", "item", "item_name", "sap_item_code", "request_qty", "inventory_uom", "vendor_uom", "vendor_qty", "price", "tax_code", "hsn_code"];

const tidy = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const notFound = (message) => Object.assign(new Error(message), { status: 404 });

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The remarks go to SAP's Comments with the quotation number, which hold 254. */
const REMARKS_MAX = 200;

/**
 * The kind of GST tax code a supplier's lines need (24 Oct 2026): a supplier in
 * the company's own state is charged CGST+SGST, one in another state IGST - SAP
 * refuses anything else ("For intrastate transactions you must choose
 * CGST+SGST"). Null when either state is not known: then nothing is narrowed and
 * SAP judges, as before. States are SAP's codes (KL, KT), as the sync publishes them.
 */
export const gstKindFor = (supplierState, companyState) => {
  const a = tidy(supplierState).toUpperCase();
  const b = tidy(companyState).toUpperCase();
  if (!a || !b) return null;
  return a === b ? "cgst_sgst" : "igst";
};

/** The tax codes a supplier's lines may take: all of them when the kind is not known. */
export const taxCodesFor = (taxCodes = [], kind = null) => (kind ? taxCodes.filter((t) => t.kind === kind) : taxCodes);

/** SAP has it, or is being asked to: no longer the CMMS's to change. */
export const mayEdit = (row) => ["Queued", "Failed"].includes(row.status) && !row.purchase_order;
/** The PO is made from a quotation SAP has, once. */
export const mayMakeOrder = (row) => row.status === "Posted" && !row.purchase_order;
/** Past its validity date on `day`. A PO can still be made from it, with a warning. */
export const isExpired = (row, day = erpToday()) => Boolean(row.valid_until) && String(row.valid_until).slice(0, 10) < day;

const toLine = (row) => ({
  lineId: row.name,
  prLine: row.pr_line || "",
  itemCode: row.item,
  name: row.item_name || row.item,
  sapItemCode: row.sap_item_code || "",
  requestQty: Number(row.request_qty || 0),
  inventoryUnit: row.inventory_uom || "",
  vendorUnit: row.vendor_uom || "",
  qty: Number(row.vendor_qty || 0),
  price: Number(row.price || 0),
  taxCode: row.tax_code || "",
  hsnCode: row.hsn_code || "",
});

const toQuotation = (row, lines = []) => ({
  id: row.name,
  request: row.purchase_request,
  company: row.company,
  companyName: storeForCompany(row.company)?.label || row.company,
  status: row.status || "Queued",
  vendorCode: row.vendor_code || "",
  vendorName: row.vendor_name || "",
  date: row.quotation_date || null,
  validUntil: row.valid_until || null,
  expired: isExpired(row),
  remarks: row.remarks || "",
  raisedBy: row.raised_by || "",
  raisedAt: row.raised_at || null,
  purchaseOrder: row.purchase_order || "",
  sapDocEntry: row.sap_doc_entry || null,
  sapDocNumber: row.sap_doc_number || "",
  postedAt: row.posted_at || null,
  error: row.error || "",
  lines: lines.map(toLine),
  total: Math.round(lines.reduce((sum, l) => sum + Number(l.vendor_qty || 0) * Number(l.price || 0), 0) * 100) / 100,
  mayEdit: mayEdit(row),
  mayMakeOrder: mayMakeOrder(row),
  updatedAt: row.modified,
});

/**
 * Checks a quotation against its request and the lists the sync publishes, and
 * gives back what to write. Pure, so the rules can be tested without ERPNext.
 *
 * @param request   the CMMS Purchase Request, with its lines
 * @param body      { vendorCode, quotationDate, validUntil, remarks, lines: [{ lineId, vendorUnit, qty, price, taxCode, hsnCode }] }
 * @param published { vendors: [{ code, name, state }], taxCodes: [{ code, kind }], units: ["KGS", "BAG", ...],
 *                    companyState, itemHsn: { item code: its HSN, "" when it has none } }
 * @param today     YYYY-MM-DD
 * @param current   the quotation being changed, if it is a change: its own lines stay its to quote
 */
export const checkQuotation = (request, body = {}, published = {}, today = erpToday(), current = null) => {
  if (current && !mayEdit(current)) {
    throw badRequest(current.purchase_order
      ? `PO ${current.purchase_order} has been made from this quotation, so it cannot be changed.`
      : `This quotation is ${current.status}. SAP has it, so it is cancelled in SAP and entered again rather than changed.`);
  }
  if (!current && !mayQuote(request)) {
    if (["Queued", "Failed"].includes(request.status)) throw badRequest("The request is not in SAP yet, so it cannot be quoted. Wait for the sync.");
    if (request.po_status) throw badRequest("A PO was made on this request before quotations, so it is not quoted.");
    if (!QUOTING.includes(request.status)) throw badRequest(`This request is ${request.status}; only one in SAP or ordered through quotations can be quoted.`);
    throw badRequest("Every line of this request is already quoted or dropped.");
  }

  const vendorCode = tidy(body.vendorCode);
  if (!vendorCode) throw badRequest("Choose the vendor.");
  const vendor = (published.vendors || []).find((v) => tidy(v.code) === vendorCode);
  if (!vendor) throw badRequest(`That vendor is not among the SAP suppliers for ${request.company}.`);

  const quotationDate = tidy(body.quotationDate) || today;
  const validUntil = tidy(body.validUntil);
  if (!DAY.test(quotationDate)) throw badRequest("Give the quotation date.");
  if (quotationDate > today) throw badRequest("The quotation date cannot be in the future.");
  if (!DAY.test(validUntil)) throw badRequest("Give the date the quotation is valid until.");
  if (validUntil < quotationDate) throw badRequest("The quotation cannot expire before its own date.");
  const remarks = tidy(body.remarks);
  if (remarks.length > REMARKS_MAX) throw badRequest(`The remarks can be at most ${REMARKS_MAX} characters.`);

  const taxCodes = (published.taxCodes || []).map((t) => t.code);
  // Only the codes of the kind this supplier needs, once both states are known.
  const kind = gstKindFor(vendor.state, published.companyState);
  const allowed = kind ? taxCodesFor(published.taxCodes || [], kind).map((t) => t.code) : null;
  const units = published.units || [];
  if (!units.length) throw badRequest(`The SAP sync has not published the unit list for ${request.company} yet.`);
  const byId = new Map((request.lines || []).map((l) => [l.name, l]));
  const seen = new Set();
  const wanted = Array.isArray(body.lines) ? body.lines : [];
  if (!wanted.length) throw badRequest("Quote at least one item.");
  const lines = wanted.map((w) => {
    const line = byId.get(tidy(w?.lineId));
    if (!line) throw badRequest("A line is not on this purchase request.");
    const label = line.item_name || line.item;
    if (seen.has(line.name)) throw badRequest(`${label} is on the quotation twice.`);
    seen.add(line.name);
    const ours = current && line.quotation === current.name;
    if (line.coverage && !ours) {
      throw badRequest(line.coverage === "Dropped" ? `${label} was dropped from the request.` : `${label} is already on quotation ${line.quotation}.`);
    }
    const vendorUom = pickFrom(units, w.vendorUnit, "unit", request.company);
    if (!vendorUom) throw badRequest(`Give the vendor's unit for ${label}.`);
    const qty = Number(w.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw badRequest(`The quantity for ${label} must be more than zero.`);
    const price = Number(w.price);
    if (!Number.isFinite(price) || price <= 0) throw badRequest(`Give the unit price for ${label}.`);
    const taxCode = tidy(w.taxCode);
    if (!taxCode) throw badRequest(`Give the tax code for ${label}.`);
    if (taxCodes.length && !taxCodes.includes(taxCode)) throw badRequest(`The tax code for ${label} is not one SAP has.`);
    if (allowed && !allowed.includes(taxCode)) {
      throw badRequest(
        kind === "cgst_sgst"
          ? `${tidy(vendor.name)} is in ${vendor.state}, the company's own state, so ${label} takes a CGST+SGST tax code, not ${taxCode}.`
          : `${tidy(vendor.name)} is in ${vendor.state}, not the company's state (${published.companyState}), so ${label} takes an IGST tax code, not ${taxCode}.`
      );
    }
    // An item with no HSN takes one here; one whose HSN SAP has keeps it, and the line brings none. An item's HSN
    // that SAP does not have yet is not its own either: saving a quotation puts its HSN on the item at once, so the
    // line still carries it (and its HSN request) until SAP has the code - and an HSN this quotation brought stays
    // its to change (PQ-2026-00353, 24 Oct 2026: an edit dropped 8491 and its request when it read as the item's).
    let hsn = "";
    const brought = (current?.lines || []).some((l) => l.item === line.item && hsnDigits(l.hsn_code));
    const itemOwn = hsnDigits(published.itemHsn?.[line.item]);
    const sapHas = !(published.hsn || []).length || (published.hsn || []).includes(itemOwn);
    if (brought || !itemOwn || !sapHas) {
      hsn = hsnDigits(w.hsnCode);
      if (!hsn) throw badRequest(`${label} has no HSN code, and SAP needs one on a line with a GST tax code. Give it - it is on the quotation or the item's bill.`);
      const problem = hsnProblem(hsn);
      if (problem) throw badRequest(`${label}: HSN ${hsn} - ${problem}.`);
    }
    return {
      doctype: LINE,
      pr_line: line.name,
      item: line.item,
      item_name: line.item_name,
      sap_item_code: line.sap_item_code,
      request_qty: Number(line.qty || 0),
      inventory_uom: line.uom || "",
      vendor_uom: vendorUom,
      vendor_qty: qty,
      price,
      tax_code: taxCode,
      hsn_code: hsn,
    };
  });

  return {
    vendor_code: vendorCode,
    vendor_name: tidy(vendor.name),
    quotation_date: quotationDate,
    valid_until: validUntil,
    remarks,
    lines,
  };
};

/**
 * The HSN codes a quotation's lines bring that SAP does not have yet - asked for
 * as HSN requests, one per code: digits -> the item of the first line carrying
 * it. Pure.
 */
export const newHsnCodes = (lines = [], sapList = []) => {
  const out = new Map();
  for (const l of lines) {
    const hsn = hsnDigits(l.hsn_code);
    if (hsn && !(sapList || []).includes(hsn) && !out.has(hsn)) out.set(hsn, l.item);
  }
  return out;
};

/** Quotations, newest first, each with its lines. */
export const listQuotations = async ({ status = "", request = "", limit = 100 } = {}) => {
  const filters = [];
  if (status) filters.push([DOCTYPE, "status", "=", status]);
  if (request) filters.push([DOCTYPE, "purchase_request", "=", request]);
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
  return rows.map((r) => toQuotation(r, byParent.get(r.name) || []));
};

const readQuotation = (id) =>
  getDoc(DOCTYPE, id).catch((error) => {
    if (error?.status === 404) return null;
    throw error;
  });

export const getQuotation = async (id) => {
  const doc = await readQuotation(id);
  return doc ? toQuotation(doc, doc.lines || []) : null;
};

/** Requests a new quotation can be entered against, for the quotation page's picker. */
export const quotableRequests = async () =>
  (await Promise.all(QUOTING.map((status) => listRequests({ status, limit: 300 })))).flat().filter((r) => r.mayQuote);

/**
 * What the quotation form offers for one company: SAP's suppliers, tax codes and
 * units - and the company itself as SAP holds it (name, address, phones, email),
 * for the printout's letterhead. Null until the sync has published it.
 */
export const optionsFor = async (company) => {
  const published = await vendorsFor(company);
  const options = (await itemMasterOptions())[published.company] || {};
  const info = options.company_info || null;
  // Each of the company's items and its HSN: a line whose item has none asks for one.
  const itemHsn = {};
  for (const p of await catalogProducts()) {
    if (p.sapCategory?.company === published.company) itemHsn[p.code] = hsnDigits(p.hsnCode);
  }
  return {
    ...published,
    // SAP's whole unit list once the sync has published it; until then the units items are created with.
    units: Array.isArray(options.sap_units) && options.sap_units.length ? options.sap_units : Array.isArray(options.units) ? options.units : [],
    hsn: Array.isArray(options.hsn) ? options.hsn : [],
    itemHsn,
    // Set against each supplier's state to choose CGST+SGST or IGST (gstKindFor).
    companyState: info?.state || "",
    companyInfo: info
      ? {
          name: info.printing_header || info.name || "",
          address: Array.isArray(info.address) ? info.address : [],
          phone: Array.isArray(info.phone) ? info.phone : [],
          fax: info.fax || "",
          email: info.email || "",
          taxId: info.tax_id || "",
        }
      : null,
  };
};

const readRequest = async (id) => {
  const doc = await getDoc("CMMS Purchase Request", tidy(id)).catch((error) => {
    if (error?.status === 404) return null;
    throw error;
  });
  if (!doc) throw notFound("Purchase request not found");
  return doc;
};

/**
 * Writes the HSN a line brought onto its item, and marks the item for the sync,
 * which sets it in SAP (PASS B) before it posts the quotation (PASS Q) - as a
 * goods receipt's bill does.
 */
const followHsn = async (lines) => {
  let written = 0;
  for (const l of lines) {
    if (!l.hsn_code) continue;
    await updateDoc("Item", l.item, { custom_sap_hsn_code: l.hsn_code, custom_sap_category_pending: 1, custom_sap_category_error: "" });
    written += 1;
  }
  if (written) forgetCatalog();
};

/** Marks request lines as on this quotation, or open again. */
const markLines = async (lineIds, quotation) => {
  for (const id of lineIds) await setLineFields(id, quotation ? { coverage: "Quoted", quotation } : { coverage: "", quotation: "" });
};

/**
 * The purchase manager enters the chosen vendor's quotation.
 *
 * @param body { request, vendorCode, quotationDate, validUntil, remarks, lines: [{ lineId, vendorUnit, qty, price, taxCode }] }
 */
export const createQuotation = async (body = {}, user) => {
  const request = await readRequest(body.request);
  const options = await optionsFor(request.company);
  const edits = checkQuotation(request, body, options);
  const created = await createDoc(DOCTYPE, {
    doctype: DOCTYPE,
    purchase_request: request.name,
    company: request.company,
    status: "Queued",
    raised_by: user?.email || "",
    raised_at: erpNow(),
    ...edits,
  });
  // The request's lines are what stop a second vendor quoting them; a
  // quotation whose lines could not be marked is taken back, not left behind.
  const marked = [];
  try {
    for (const l of edits.lines) {
      await markLines([l.pr_line], created.name);
      marked.push(l.pr_line);
    }
  } catch (error) {
    await markLines(marked, null).catch(() => {});
    await deleteDoc(DOCTYPE, created.name).catch(() => {});
    console.error("Quotation lines not marked:", error.message);
    throw Object.assign(new Error("The request's lines could not be marked as quoted, so the quotation was not saved. Try again."), { status: 400 });
  }
  // Its new HSN codes with it: a quotation that would wait for a code nobody asked for is taken back.
  try {
    await raiseHsnRequests({ company: request.company, quotation: created.name, codes: newHsnCodes(edits.lines, options.hsn), user });
  } catch (error) {
    await markLines(marked, null).catch(() => {});
    await deleteDoc(DOCTYPE, created.name).catch(() => {});
    console.error("HSN request not saved:", error.message);
    throw Object.assign(new Error("The new HSN code could not be recorded, so the quotation was not saved. Try again."), { status: 400 });
  }
  await followHsn(edits.lines);
  await raiseSapFlag(user?.email);
  return getQuotation(created.name);
};

/** Changes a quotation SAP does not have yet. A failed one goes back to the queue with it. */
export const updateQuotation = async (id, body = {}, user) => {
  const doc = await readQuotation(id);
  if (!doc) throw notFound("Quotation not found");
  const request = await readRequest(doc.purchase_request);
  const options = await optionsFor(request.company);
  const edits = checkQuotation(request, body, options, erpToday(), doc);
  // The whole table, as Frappe replaces a child table it is given.
  await updateDoc(DOCTYPE, id, { ...edits, status: "Queued", error: "" });
  const before = new Set((doc.lines || []).map((l) => l.pr_line));
  const after = new Set(edits.lines.map((l) => l.pr_line));
  await markLines([...before].filter((l) => !after.has(l)), null);
  await markLines([...after].filter((l) => !before.has(l)), id);
  // The codes it asks for now replace the ones it asked for before, while SAP has not made those yet.
  await dropQueuedForQuotation(id);
  await raiseHsnRequests({ company: request.company, quotation: id, codes: newHsnCodes(edits.lines, options.hsn), user });
  await followHsn(edits.lines);
  await raiseSapFlag(user?.email);
  return getQuotation(id);
};

/** Takes back a quotation SAP does not have yet, and opens its request lines again. */
export const deleteQuotation = async (id) => {
  const doc = await readQuotation(id);
  if (!doc) throw notFound("Quotation not found");
  if (!mayEdit(doc)) throw badRequest(`This quotation is ${doc.status}; only one SAP does not have yet can be deleted. A posted one is cancelled in SAP.`);
  const request = await readRequest(doc.purchase_request);
  const mine = (request.lines || []).filter((l) => l.quotation === id).map((l) => l.name);
  await markLines(mine, null);
  await dropQueuedForQuotation(id);
  await deleteDoc(DOCTYPE, id);
  return { deleted: id };
};

/** Sends a quotation SAP refused back to the SAP server as it is. */
export const retryQuotation = async (id, user) => {
  const doc = await readQuotation(id);
  if (!doc) throw notFound("Quotation not found");
  if (doc.status !== "Failed") throw badRequest(`This quotation is ${doc.status}; only a failed one can be sent again.`);
  await updateDoc(DOCTYPE, id, { status: "Queued", error: "" });
  await raiseSapFlag(user?.email);
  return getQuotation(id);
};

export { DOCTYPE as QUOTATION_DOCTYPE, readQuotation };
