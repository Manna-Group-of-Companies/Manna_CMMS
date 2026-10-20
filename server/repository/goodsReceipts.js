import {
  createDoc,
  deleteDoc,
  getDoc,
  listChildRows,
  listDocs,
  updateDoc,
} from "../integrations/erpnext/client.js";
import { erpNow, erpToday } from "../integrations/erpnext/time.js";
import { storeForCompany } from "../integrations/erpnext/stores.js";
import { catalogProducts, forgetCatalog } from "./catalog.js";
import { CONTROL, hsnDigits, hsnProblem, itemMasterOptions, pickFrom, pickHsn, raiseSapFlag } from "./sapCategories.js";
import { dropQueuedRequests, raiseHsnRequests, requestsForReceipts } from "./hsnRequests.js";

/**
 * Stock coming into the engineering store, decided 9 Oct 2026. Two kinds,
 * kept apart on purpose:
 *
 *   Goods Receipt   - from a supplier's bill, against the open SAP Purchase
 *                     Order purchase raised. The store picks the PO, enters the
 *                     bill number and date, what arrived, and each line's HSN
 *                     and tax rate from the bill. Vendor, price and SAP tax
 *                     code come from the PO. The sync posts a GRPO in SAP (so
 *                     accounts make the A/P invoice from it, as before) and the
 *                     same quantity into the company's ERPNext store at the PO
 *                     price. A bill's HSN code SAP does not have yet, on an
 *                     item with none, is asked for with the receipt (20 Oct
 *                     2026, see hsnRequests.js); the sync holds the receipt
 *                     until SAP has it.
 *   Stock Addition  - stock on the shelf with no bill: no value, no HSN. The
 *                     sync posts a SAP Goods Receipt at price 0 and an ERPNext
 *                     receipt at zero value.
 *
 * An item still at nil value takes the price of its first goods receipt: the
 * sync revalues what is already on the shelf to that price before receiving,
 * in SAP and in ERPNext, so the receipt replaces the nil value rather than
 * averaging into it.
 *
 * Every engineering goods receipt is made here from now on; raw materials and
 * consumables stay in SAP and are not engineering items.
 *
 * Like the rest of the item master, this server never talks to SAP. It writes
 * a "CMMS Goods Receipt" in ERPNext and raises the flag; the sync on the SAP
 * server posts it and sets Posted or Failed. The open PO lines the form offers
 * are what that sync last read from SAP (`open_po_lines` on the control Single).
 */

const DOCTYPE = "CMMS Goods Receipt";
const LINE = "CMMS Goods Receipt Line";

const FIELDS = [
  "name",
  "kind",
  "company",
  "status",
  "raised_by",
  "raised_at",
  "naming_request",
  "sap_po_entry",
  "sap_po_number",
  "vendor_code",
  "vendor_name",
  "bill_no",
  "bill_date",
  "remarks",
  "sap_doc_entry",
  "sap_doc_number",
  "sap_revaluation",
  "erp_stock_entry",
  "erp_reconciliation",
  "posted_at",
  "error",
  "modified",
];
const LINE_FIELDS = ["parent", "idx", "item", "item_name", "sap_item_code", "po_line", "qty", "rate", "uom", "tax_code", "hsn_code", "tax_rate", "warehouse"];

const tidy = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const notFound = (message) => Object.assign(new Error(message), { status: 404 });

/** The SAP warehouse a stock addition lands in, per company (every engineering receipt so far used 01). */
const warehouseOf = (options) => tidy(options?.warehouse) || "01";

const toLine = (row) => ({
  itemCode: row.item,
  name: row.item_name || row.item,
  sapItemCode: row.sap_item_code || "",
  poLine: row.po_line ?? null,
  qty: Number(row.qty || 0),
  rate: Number(row.rate || 0),
  unit: row.uom || "",
  taxCode: row.tax_code || "",
  hsnCode: row.hsn_code || "",
  taxRate: row.tax_rate || "",
  warehouse: row.warehouse || "",
});

const toReceipt = (row, lines = [], hsnRequests = []) => ({
  id: row.name,
  kind: row.kind,
  company: row.company,
  companyName: storeForCompany(row.company)?.label || row.company,
  status: row.status || "Queued",
  raisedBy: row.raised_by || "",
  raisedAt: row.raised_at || null,
  fromNewItem: row.naming_request || "",
  poEntry: row.sap_po_entry || null,
  poNumber: row.sap_po_number || "",
  vendorCode: row.vendor_code || "",
  vendorName: row.vendor_name || "",
  billNo: row.bill_no || "",
  billDate: row.bill_date || null,
  remarks: row.remarks || "",
  sapDocEntry: row.sap_doc_entry || null,
  sapDocNumber: row.sap_doc_number || "",
  sapRevaluation: row.sap_revaluation || "",
  erpStockEntry: row.erp_stock_entry || "",
  erpReconciliation: row.erp_reconciliation || "",
  postedAt: row.posted_at || null,
  error: row.error || "",
  lines: lines.map(toLine),
  hsnRequests,
  total: lines.reduce((sum, l) => sum + Number(l.qty || 0) * Number(l.rate || 0), 0),
  updatedAt: row.modified,
});

/** Receipts, newest first, each with its lines. */
const forbidden = (message) => Object.assign(new Error(message), { status: 403 });

export const listReceipts = async ({ status = "", kind = "", limit = 100, onlyCompanies = null } = {}) => {
  const filters = [];
  if (status) filters.push([DOCTYPE, "status", "=", status]);
  if (kind) filters.push([DOCTYPE, "kind", "=", kind]);
  // A plant head sees their own company's receipts and no other. An empty
  // list means none, not all - see scopeFor.
  if (Array.isArray(onlyCompanies)) {
    filters.push([DOCTYPE, "company", "in", onlyCompanies.length ? onlyCompanies : ["__none__"]]);
  }
  const rows = await listDocs(DOCTYPE, { fields: FIELDS, filters: filters.length ? filters : undefined, orderBy: "creation desc", limit });
  if (!rows.length) return [];

  const byParent = new Map();
  // A hundred names stays well under Frappe Cloud's ~4 KB request line.
  for (let i = 0; i < rows.length; i += 100) {
    const names = rows.slice(i, i + 100).map((r) => r.name);
    const lines = await listChildRows(LINE, DOCTYPE, {
      fields: LINE_FIELDS,
      filters: [[LINE, "parent", "in", names]],
      limit: 2000,
      orderBy: "idx asc",
    });
    for (const l of lines) {
      if (!byParent.has(l.parent)) byParent.set(l.parent, []);
      byParent.get(l.parent).push(l);
    }
  }
  const requests = await requestsForReceipts(rows.filter((r) => r.kind === "Goods Receipt").map((r) => r.name));
  return rows.map((r) => toReceipt(r, byParent.get(r.name) || [], requests.get(r.name) || []));
};

export const getReceipt = async (id) => {
  const doc = await getDoc(DOCTYPE, id).catch((error) => {
    if (error?.status === 404) return null;
    throw error;
  });
  if (!doc) return null;
  const requests = doc.kind === "Goods Receipt" ? await requestsForReceipts([doc.name]) : new Map();
  return toReceipt(doc, doc.lines || [], requests.get(doc.name) || []);
};

/* ------------------------------------------------------------- open purchase orders */

const readSnapshot = async () => {
  const doc = await getDoc(CONTROL, CONTROL);
  let map = {};
  try {
    map = JSON.parse(doc.open_po_lines || "{}");
  } catch {
    map = {};
  }
  return { map, refreshedAt: doc.open_po_refreshed_at || null, doc };
};

/** Quantity already entered against each PO line and not yet posted: "entry:line" -> qty. */
const queuedAgainstPo = async (company) => {
  const queued = await listDocs(DOCTYPE, {
    fields: ["name", "sap_po_entry"],
    filters: [
      [DOCTYPE, "company", "=", company],
      [DOCTYPE, "kind", "=", "Goods Receipt"],
      [DOCTYPE, "status", "in", ["Queued", "Failed"]],
    ],
    limit: 200,
  });
  const out = new Map();
  if (!queued.length) return out;
  const entryOf = new Map(queued.map((q) => [q.name, q.sap_po_entry]));
  const lines = await listChildRows(LINE, DOCTYPE, {
    fields: ["parent", "po_line", "qty"],
    filters: [[LINE, "parent", "in", queued.map((q) => q.name)]],
    limit: 2000,
  });
  for (const l of lines) {
    const key = `${entryOf.get(l.parent)}:${l.po_line}`;
    out.set(key, (out.get(key) || 0) + Number(l.qty || 0));
  }
  return out;
};

/**
 * One company's open PO lines for engineering items, as the sync last read
 * them from SAP, less what is already entered here and waiting to post.
 */
export const openPurchaseOrders = async (company) => {
  const abbr = tidy(company).toUpperCase();
  const [{ map, refreshedAt, doc }, queued, products] = await Promise.all([
    readSnapshot(),
    abbr ? queuedAgainstPo(abbr) : new Map(),
    catalogProducts(),
  ]);
  const byCode = new Map(products.map((p) => [p.code, p]));
  const entry = map[abbr] || null;
  const requested = Number(doc.sync_requested) === 1;

  const pos = (entry?.pos || [])
    .map((po) => ({
      entry: po.entry,
      number: String(po.number ?? ""),
      vendorCode: po.vendor_code || "",
      vendorName: po.vendor_name || "",
      date: po.date || null,
      lines: (po.lines || [])
        .map((l) => {
          const product = byCode.get(l.item);
          const waiting = queued.get(`${po.entry}:${l.line}`) || 0;
          return {
            line: l.line,
            itemCode: l.item,
            sapItemCode: l.sap_code,
            name: product?.name || l.item_name || l.item,
            openQty: Number(l.open_qty || 0),
            waitingQty: waiting,
            receivableQty: Math.max(0, Number(l.open_qty || 0) - waiting),
            price: Number(l.price || 0),
            taxCode: l.tax_code || "",
            warehouse: l.warehouse || "",
            unit: l.uom || product?.unit || "",
            hsnCode: product?.hsnCode || "",
            taxRate: product?.taxRate || "",
            itemValue: product?.unitCost || 0,
            inCatalog: Boolean(product),
          };
        })
        .filter((l) => l.openQty > 0),
    }))
    .filter((po) => po.lines.length);

  return {
    company: abbr,
    refreshedAt: entry?.refreshed_at || refreshedAt,
    refreshing: requested,
    pos,
  };
};

/** Asks the SAP server to read the open POs again (one flagged run). */
export const refreshPurchaseOrders = async (user) => {
  await raiseSapFlag(user?.email);
  return { ok: true };
};

/* ------------------------------------------------------------- entering a receipt */

/** Writes a bill's HSN and tax rate onto the item when they differ, so SAP's item master follows the bill. */
const followBill = async (product, hsn, tax) => {
  const edits = {};
  if (hsn && hsn !== product.hsnCode) edits.custom_sap_hsn_code = hsn;
  if (tax && tax !== product.taxRate) edits.custom_sap_tax_rate = tax;
  if (!Object.keys(edits).length) return false;
  await updateDoc("Item", product.code, { ...edits, custom_sap_category_pending: 1, custom_sap_category_error: "" });
  return true;
};

/**
 * A goods receipt from a supplier's bill, against one open SAP PO.
 *
 * @param body { company, poEntry, billNo, billDate, remarks, lines: [{ poLine, qty, hsnCode, taxRate }] }
 */
export const createGoodsReceipt = async (body = {}, user, { onlyCompanies = null } = {}) => {
  const company = tidy(body.company).toUpperCase();
  if (Array.isArray(onlyCompanies) && !onlyCompanies.includes(company)) {
    throw forbidden("That SAP company is not yours to receive for.");
  }
  const options = (await itemMasterOptions())[company];
  if (!options) throw badRequest("Choose the SAP company the stock was bought for.");
  const label = options.company || company;

  const billNo = tidy(body.billNo);
  if (!billNo) throw badRequest("The bill number is required - it goes to SAP as the vendor reference.");
  if (billNo.length > 100) throw badRequest("The bill number can be at most 100 characters.");
  const billDate = tidy(body.billDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(billDate)) throw badRequest("The bill date is required.");
  if (billDate > erpToday()) throw badRequest("The bill date cannot be in the future.");

  const open = await openPurchaseOrders(company);
  const po = open.pos.find((p) => String(p.entry) === String(body.poEntry));
  if (!po) throw badRequest("That purchase order has no open engineering lines left. Refresh the purchase orders from SAP and pick again.");

  const wanted = (Array.isArray(body.lines) ? body.lines : []).filter((l) => Number(l?.qty) > 0);
  if (!wanted.length) throw badRequest("Enter the quantity received on at least one line.");

  const products = new Map((await catalogProducts()).map((p) => [p.code, p]));
  const seen = new Set();
  const lines = [];
  const billChanges = [];
  // HSN codes SAP does not have yet: digits -> the item of the first line carrying it.
  const newCodes = new Map();
  for (const w of wanted) {
    const line = po.lines.find((l) => String(l.line) === String(w.poLine));
    if (!line) throw badRequest(`Line ${w.poLine} is not an open engineering line of PO ${po.number}.`);
    if (seen.has(line.line)) throw badRequest(`Line ${line.line} is entered twice.`);
    seen.add(line.line);
    if (!line.inCatalog) throw badRequest(`${line.sapItemCode} is on the PO but not in the engineering catalog yet.`);
    const qty = Number(w.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw badRequest(`The quantity for ${line.name} must be more than zero.`);
    if (qty > line.receivableQty + 1e-9) {
      throw badRequest(
        `${line.name}: ${qty} is more than is open on PO ${po.number} (${line.receivableQty}` +
          (line.waitingQty ? `, after ${line.waitingQty} already entered and waiting to post` : "") +
          ").",
      );
    }
    const product = products.get(line.itemCode);
    const hsn = hsnDigits(w.hsnCode);
    if (!hsn) throw badRequest(`The HSN code for ${line.name} is required - it is on the bill.`);
    if (!(options.hsn || []).includes(hsn)) {
      // A new code is asked for only for an item that has none yet; an item
      // that has one keeps to SAP's list, as before.
      if (product?.hsnCode) pickHsn(options.hsn, hsn, label);
      const problem = hsnProblem(hsn);
      if (problem) throw badRequest(`${line.name}: HSN ${hsn} - ${problem}.`);
      if (!newCodes.has(hsn)) newCodes.set(hsn, line.itemCode);
    }
    const tax = pickFrom(options.tax_rates, w.taxRate, "tax rate", label);
    if (!tax) throw badRequest(`The tax rate for ${line.name} is required - it is on the bill.`);

    billChanges.push([product, hsn, tax]);
    lines.push({
      doctype: LINE,
      item: line.itemCode,
      item_name: line.name,
      sap_item_code: line.sapItemCode,
      po_line: line.line,
      qty,
      rate: line.price,
      uom: line.unit,
      tax_code: line.taxCode,
      hsn_code: hsn,
      tax_rate: tax,
      warehouse: line.warehouse || warehouseOf(options),
    });
  }

  const created = await createDoc(DOCTYPE, {
    doctype: DOCTYPE,
    kind: "Goods Receipt",
    company,
    status: "Queued",
    raised_by: user?.email || "",
    raised_at: erpNow(),
    sap_po_entry: po.entry,
    sap_po_number: po.number,
    vendor_code: po.vendorCode,
    vendor_name: po.vendorName,
    bill_no: billNo,
    bill_date: billDate,
    remarks: tidy(body.remarks).slice(0, 500),
    lines,
  });

  // Its new HSN codes with it: a receipt that would wait for a code nobody
  // asked for is taken back rather than left behind.
  try {
    await raiseHsnRequests({ company, receipt: created.name, codes: newCodes, user });
  } catch (error) {
    await deleteDoc(DOCTYPE, created.name).catch(() => {});
    console.error("HSN request not saved:", error.message);
    throw Object.assign(new Error("The new HSN code could not be recorded, so the receipt was not saved. Try again."), {
      status: 400,
    });
  }

  // The bill's HSN and tax rate onto the items, so the same SAP run patches
  // the item master before it posts the GRPO that reads them; the flag last,
  // once everything it is meant to pick up is written.
  let followed = 0;
  for (const [product, hsn, tax] of billChanges) if (await followBill(product, hsn, tax)) followed += 1;
  if (followed) forgetCatalog();

  await raiseSapFlag(user?.email);
  return getReceipt(created.name);
};

/**
 * Takes back a goods receipt that has not posted yet - entered against the
 * wrong PO, say - with the HSN codes it asked for that are still waiting.
 */
export const deleteReceipt = async (id) => {
  const doc = await getDoc(DOCTYPE, id).catch(() => null);
  if (!doc) throw notFound("Receipt not found");
  if (doc.status !== "Queued") throw badRequest(`This receipt is ${doc.status}; only one still waiting to post can be deleted.`);
  const dropped = doc.kind === "Goods Receipt" ? await dropQueuedRequests(id) : 0;
  await deleteDoc(DOCTYPE, id);
  return { deleted: id, hsnRequestsDeleted: dropped };
};

/**
 * Stock on the shelf with no bill behind it: received at nil value, no HSN.
 *
 * @param body { itemCode, qty, remarks }
 */
export const createStockAddition = async (body = {}, user, { onlyCompanies = null } = {}) => {
  const code = tidy(body.itemCode);
  const product = (await catalogProducts()).find((p) => p.code === code);
  if (!product) throw notFound("Engineering Stock not found");
  if (!product.sapCategory || !product.sap?.code) {
    throw badRequest("This item is not in SAP yet, so stock cannot be added to it. Wait for it to be created in SAP.");
  }
  const qty = Number(body.qty);
  if (!Number.isFinite(qty) || qty <= 0) throw badRequest("The quantity must be more than zero.");
  const company = product.sapCategory.company;
  if (Array.isArray(onlyCompanies) && !onlyCompanies.includes(company)) {
    throw forbidden(`${product.name || product.code} is ${company}'s stock, not your company's.`);
  }
  const options = (await itemMasterOptions())[company];
  if (!options) throw badRequest(`No SAP options are published for ${company} yet.`);

  const created = await createDoc(DOCTYPE, {
    doctype: DOCTYPE,
    kind: "Stock Addition",
    company,
    status: "Queued",
    raised_by: user?.email || "",
    raised_at: erpNow(),
    remarks: tidy(body.remarks).slice(0, 500),
    lines: [
      {
        doctype: LINE,
        item: product.code,
        item_name: product.name,
        sap_item_code: product.sap.code,
        qty,
        rate: 0,
        uom: product.unit,
        warehouse: warehouseOf(options),
      },
    ],
  });
  await raiseSapFlag(user?.email);
  return getReceipt(created.name);
};

/** Sends a receipt that failed to post back to the SAP server. */
export const retryReceipt = async (id, user) => {
  const doc = await getDoc(DOCTYPE, id).catch(() => null);
  if (!doc) throw notFound("Receipt not found");
  if (doc.status !== "Failed") throw badRequest(`This receipt is ${doc.status}; only a failed one can be sent again.`);
  await updateDoc(DOCTYPE, id, { status: "Queued", error: "" });
  await raiseSapFlag(user?.email);
  return getReceipt(id);
};
