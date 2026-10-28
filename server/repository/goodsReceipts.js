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
import { CONTROL, hsnDigits, hsnProblem, itemMasterOptions, pickFrom, raiseSapFlag } from "./sapCategories.js";
import { dropQueuedRequests, raiseHsnRequests, requestsForReceipts } from "./hsnRequests.js";
import { vendorsFor } from "./purchaseRequests.js";
import { checkTaxCode } from "./purchaseQuotations.js";

/**
 * Stock coming into the engineering store, decided 9 Oct 2026. Two kinds,
 * kept apart on purpose:
 *
 *   Goods Receipt   - from a supplier's bill, against the open SAP Purchase
 *                     Order purchase raised. The store picks the PO, enters the
 *                     bill number and date, what arrived, and each line's SAP
 *                     tax code from the bill. Vendor and price come from the
 *                     PO. The sync posts a GRPO in SAP (so accounts make the
 *                     A/P invoice from it, as before) and the same quantity
 *                     into the company's ERPNext store at the PO price.
 *
 *                     The only document that asks for tax (27 Oct 2026): the
 *                     tax code on every line, and the HSN and tax rate only
 *                     for an item that has none - an item's own stand, and
 *                     the form shows them without letting them be changed.
 *                     What the bill fills in goes onto the item master, in
 *                     ERPNext and SAP. A bill's HSN code SAP does not have
 *                     yet is asked for with the receipt (20 Oct 2026, see
 *                     hsnRequests.js); the sync holds the receipt until SAP
 *                     has it.
 *   Stock Addition  - stock on the shelf with no bill: no value, no HSN. The
 *                     sync posts a SAP Goods Receipt at price 0 and an ERPNext
 *                     receipt at zero value.
 *
 * An item still at nil value takes the price of its first goods receipt: the
 * sync revalues what is already on the shelf to that price before receiving,
 * in SAP and in ERPNext, so the receipt replaces the nil value rather than
 * averaging into it.
 *
 * A PO made from a quotation (24 Oct 2026, phase 4) is received against its
 * CMMS record instead, in the vendor's unit: the store types the billed qty
 * and the bill price per vendor unit, and the quantity that actually came in,
 * in the inventory unit, or the inventory units per vendor unit. Nothing more
 * than is pending on the PO, in the vendor's unit, can be received. The sync
 * posts the GRPO in the vendor's unit at the bill price with the measured
 * ratio, so SAP books exactly the bill, and the ERPNext receipt in the
 * inventory unit at bill value / received qty, unrounded, which books the same.
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
  "purchase_order",
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
const LINE_FIELDS = ["parent", "idx", "item", "item_name", "sap_item_code", "po_line", "qty", "rate", "uom", "tax_code", "hsn_code", "tax_rate", "warehouse",
  "order_line", "vendor_uom", "vendor_qty", "bill_price", "quoted_price"];
const ORDER = "CMMS Purchase Order";
const ORDER_LINE = "CMMS Purchase Order Line";

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
  // Against a CMMS PO: what the bill says, in the vendor's unit.
  orderLine: row.order_line || "",
  vendorUnit: row.vendor_uom || "",
  vendorQty: Number(row.vendor_qty || 0),
  billPrice: Number(row.bill_price || 0),
  quotedPrice: Number(row.quoted_price || 0),
});

/** What a line is worth: the bill, when it was billed in the vendor's unit (rate is rounded to the paisa). */
const lineValue = (l) => (l.order_line ? Number(l.vendor_qty || 0) * Number(l.bill_price || 0) : Number(l.qty || 0) * Number(l.rate || 0));

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
  purchaseOrder: row.purchase_order || "",
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
  total: Math.round(lines.reduce((sum, l) => sum + lineValue(l), 0) * 100) / 100,
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
 * A company's CMMS POs that can be received against: in SAP and Open. Each
 * line in the vendor's unit, less what is entered here and waiting to post.
 */
const openOrders = async (company, byCode) => {
  const orders = await listDocs(ORDER, {
    fields: ["name", "vendor_code", "vendor_name", "po_date", "sap_doc_entry", "sap_doc_number", "purchase_request"],
    filters: [
      [ORDER, "company", "=", company],
      [ORDER, "sync_status", "=", "Posted"],
      [ORDER, "status", "=", "Open"],
      // Not one being cancelled (27 Oct 2026): a receipt against it would race the cancel in SAP.
      [ORDER, "cancel_status", "!=", "Queued"],
    ],
    orderBy: "creation desc",
    limit: 200,
  });
  if (!orders.length) return [];
  const names = orders.map((o) => o.name);
  const [lines, queued] = await Promise.all([
    listChildRows(ORDER_LINE, ORDER, {
      fields: ["parent", "idx", "name", "item", "item_name", "sap_item_code", "vendor_uom", "inventory_uom", "qty", "price", "tax_code", "received_qty"],
      filters: [[ORDER_LINE, "parent", "in", names]],
      limit: 2000,
      orderBy: "idx asc",
    }),
    listDocs(DOCTYPE, {
      fields: ["name"],
      filters: [
        [DOCTYPE, "purchase_order", "in", names],
        [DOCTYPE, "status", "in", ["Queued", "Failed"]],
      ],
      limit: 500,
    }),
  ]);
  // Billed qty already entered against each PO line and not posted yet.
  const waiting = new Map();
  if (queued.length) {
    const rows = await listChildRows(LINE, DOCTYPE, {
      fields: ["parent", "order_line", "vendor_qty"],
      filters: [[LINE, "parent", "in", queued.map((q) => q.name)]],
      limit: 2000,
    });
    for (const r of rows) waiting.set(r.order_line, (waiting.get(r.order_line) || 0) + Number(r.vendor_qty || 0));
  }
  return orders
    .map((o) => ({
      order: o.name,
      request: o.purchase_request || "",
      entry: o.sap_doc_entry,
      number: String(o.sap_doc_number ?? ""),
      vendorCode: o.vendor_code || "",
      vendorName: o.vendor_name || "",
      date: o.po_date || null,
      lines: lines
        .filter((l) => l.parent === o.name)
        .map((l) => {
          const product = byCode.get(l.item);
          const ordered = Number(l.qty || 0);
          const received = Number(l.received_qty || 0);
          const waitingQty = waiting.get(l.name) || 0;
          return {
            line: l.name,
            itemCode: l.item,
            sapItemCode: l.sap_item_code || "",
            name: product?.name || l.item_name || l.item,
            vendorUnit: l.vendor_uom || "",
            unit: l.inventory_uom || product?.unit || "",
            orderedQty: ordered,
            receivedQty: received,
            waitingQty,
            openQty: Math.max(0, ordered - received),
            receivableQty: Math.max(0, ordered - received - waitingQty),
            price: Number(l.price || 0),
            taxCode: l.tax_code || "",
            hsnCode: product?.hsnCode || "",
            taxRate: product?.taxRate || "",
            itemValue: product?.unitCost || 0,
            inCatalog: Boolean(product),
          };
        })
        .filter((l) => l.openQty > 0),
    }))
    .filter((o) => o.lines.length);
};

/**
 * One company's open PO lines for engineering items, as the sync last read
 * them from SAP, less what is already entered here and waiting to post; and
 * its CMMS POs made from quotations, which SAP's list leaves out.
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
  const orders = abbr ? await openOrders(abbr, byCode) : [];

  // For the bill's tax code on each line: SAP's codes, and each supplier's state against the company's, which
  // narrows them to CGST+SGST or IGST as checkTaxCode does.
  const { vendors, taxCodes } = abbr ? await vendorsFor(abbr) : { vendors: [], taxCodes: [] };
  const stateOf = new Map(vendors.map((v) => [tidy(v.code), v.state || ""]));
  const all = [...orders, ...pos].map((p) => ({ ...p, vendorState: stateOf.get(tidy(p.vendorCode)) || "" }));

  return {
    company: abbr,
    refreshedAt: entry?.refreshed_at || refreshedAt,
    refreshing: requested,
    // The CMMS POs first: they are the new purchases.
    pos: all,
    taxCodes,
    companyState: abbr ? (await itemMasterOptions())[abbr]?.company_info?.state || "" : "",
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

const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;
/** A number typed, or null when the box was left empty. */
const typed = (value) => (value === undefined || value === null || String(value).trim() === "" ? null : Number(value));

/**
 * The lines of a receipt against a CMMS PO, checked. Pure, so the rules can be
 * tested without ERPNext.
 *
 * Per line the store gives the billed qty in the vendor's unit, the bill price
 * per vendor unit (the quoted price when left empty), and what came in: the
 * received qty in the inventory unit, or the inventory units per vendor unit
 * (received = billed x ratio). No ratio is kept; the value is the bill's, and
 * the cost per inventory unit follows from it, unrounded.
 *
 * @param po     a CMMS PO as openPurchaseOrders gives it: { order, number, lines: [{ line, name, vendorUnit, unit, receivableQty, waitingQty, price }] }
 * @param wanted [{ orderLine, vendorQty, receivedQty, ratio, billPrice }] - lines with nothing typed are skipped
 * @returns [{ line, vendorQty, receivedQty, billPrice, value, cost, priceChanged }]
 */
export const checkOrderLines = (po, wanted = []) => {
  const entered = (Array.isArray(wanted) ? wanted : []).filter(
    (w) => [w?.vendorQty, w?.receivedQty, w?.ratio].some((v) => typed(v) !== null && Number(v) !== 0),
  );
  if (!entered.length) throw badRequest("Enter the billed quantity on at least one line.");
  const seen = new Set();
  return entered.map((w) => {
    const line = po.lines.find((l) => String(l.line) === String(w.orderLine));
    if (!line) throw badRequest(`A line is not an open line of PO ${po.number || po.order}.`);
    if (seen.has(line.line)) throw badRequest(`${line.name} is entered twice.`);
    seen.add(line.line);

    const vendorQty = typed(w.vendorQty);
    if (vendorQty === null || !Number.isFinite(vendorQty) || vendorQty <= 0) {
      throw badRequest(`${line.name}: give the quantity on the bill, in ${line.vendorUnit}.`);
    }
    // Over-receipt is not supported (decided 24 Oct 2026): the PO is tracked in the vendor's unit.
    if (vendorQty > line.receivableQty + 1e-9) {
      throw badRequest(
        `${line.name}: ${vendorQty} ${line.vendorUnit} is more than is pending on PO ${po.number || po.order} (${line.receivableQty}` +
          (line.waitingQty ? `, after ${line.waitingQty} already entered and waiting to post` : "") +
          ").",
      );
    }

    // ERPNext keeps quantities to 3 decimals; what is checked here is what it will hold.
    let receivedQty = typed(w.receivedQty);
    if (receivedQty === null || receivedQty === 0) {
      const ratio = typed(w.ratio);
      if (ratio !== null && Number.isFinite(ratio) && ratio > 0) receivedQty = vendorQty * ratio;
    }
    receivedQty = receivedQty === null ? null : round(receivedQty, 3);
    if (receivedQty === null || !Number.isFinite(receivedQty) || receivedQty <= 0) {
      throw badRequest(`${line.name}: give what came in, in ${line.unit}, or the ${line.unit} per ${line.vendorUnit}.`);
    }

    const given = typed(w.billPrice);
    const billPrice = round(given === null ? line.price : given, 2);
    if (!Number.isFinite(billPrice) || billPrice <= 0) throw badRequest(`${line.name}: the bill price must be more than zero.`);

    const value = round(billPrice * vendorQty, 2);
    return {
      line,
      vendorQty,
      receivedQty,
      billPrice,
      value,
      cost: value / receivedQty,
      priceChanged: Math.abs(billPrice - line.price) >= 0.005,
    };
  });
};

/**
 * One line's tax from the bill, checked. Pure, so the rules can be tested
 * without ERPNext.
 *
 * The tax code is asked on every line. The HSN and tax rate are the item's
 * once it has them (27 Oct 2026): whatever was sent for them is ignored, and
 * only an item without one takes the bill's. A new HSN code goes into newCodes.
 *
 * @param taxes { vendors, taxCodes, companyState } - what checkTaxCode needs
 */
export const billTaxes = (line, w = {}, product, options, label, newCodes, taxes = {}, vendorCode = "") => {
  let hsn = hsnDigits(product?.hsnCode);
  if (!hsn) {
    hsn = hsnDigits(w.hsnCode);
    if (!hsn) throw badRequest(`The HSN code for ${line.name} is required - it is on the bill.`);
    const problem = hsnProblem(hsn);
    if (problem) throw badRequest(`${line.name}: HSN ${hsn} - ${problem}.`);
  }
  // Asked for even when it is the item's own: an item can hold a code an earlier request has not got into SAP
  // yet, and SAP refuses a GRPO line with a GST tax code and no HSN. The sync adopts a code SAP already has.
  if (!(options.hsn || []).includes(hsn) && !newCodes.has(hsn)) newCodes.set(hsn, line.itemCode);
  let tax = tidy(product?.taxRate);
  if (!tax) {
    tax = pickFrom(options.tax_rates, w.taxRate, "tax rate", label);
    if (!tax) throw badRequest(`The tax rate for ${line.name} is required - it is on the bill.`);
  }
  const taxCode = checkTaxCode(taxes, vendorCode, w.taxCode, line.name);
  return { hsn, tax, taxCode };
};

/**
 * A goods receipt from a supplier's bill, against one open SAP PO, or one CMMS
 * PO made from a quotation.
 *
 * @param body { company, poEntry, billNo, billDate, remarks, lines: [{ poLine, qty, hsnCode, taxRate }] }
 *          or { company, purchaseOrder, billNo, billDate, remarks,
 *               lines: [{ orderLine, vendorQty, receivedQty, ratio, billPrice, hsnCode, taxRate }] }
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
  const orderId = tidy(body.purchaseOrder);
  const po = orderId
    ? open.pos.find((p) => p.order === orderId)
    : open.pos.find((p) => !p.order && String(p.entry) === String(body.poEntry));
  if (!po) {
    throw badRequest(
      orderId
        ? `${orderId} has nothing left to receive, or SAP does not have it yet.`
        : "That purchase order has no open engineering lines left. Refresh the purchase orders from SAP and pick again.",
    );
  }

  const products = new Map((await catalogProducts()).map((p) => [p.code, p]));
  // SAP's tax codes and the supplier's state, for the bill's tax code on each line.
  const taxes = { ...(await vendorsFor(company)), companyState: options.company_info?.state || "" };
  const lines = [];
  const billChanges = [];
  // HSN codes SAP does not have yet: digits -> the item of the first line carrying it.
  const newCodes = new Map();

  if (po.order) {
    const byLine = new Map((Array.isArray(body.lines) ? body.lines : []).map((w) => [String(w?.orderLine), w]));
    for (const c of checkOrderLines(po, body.lines)) {
      const { line } = c;
      if (!line.inCatalog) throw badRequest(`${line.sapItemCode} is on the PO but not in the engineering catalog yet.`);
      const product = products.get(line.itemCode);
      const { hsn, tax, taxCode } = billTaxes(line, byLine.get(String(line.line)), product, options, label, newCodes, taxes, po.vendorCode);
      billChanges.push([product, hsn, tax]);
      lines.push({
        doctype: LINE,
        item: line.itemCode,
        item_name: line.name,
        sap_item_code: line.sapItemCode,
        order_line: line.line,
        vendor_uom: line.vendorUnit,
        vendor_qty: c.vendorQty,
        bill_price: c.billPrice,
        quoted_price: line.price,
        qty: c.receivedQty,
        // For reading only, to the paisa; the sync works the cost out again from the bill, unrounded.
        rate: round(c.cost, 2),
        uom: line.unit,
        tax_code: taxCode,
        hsn_code: hsn,
        tax_rate: tax,
        warehouse: warehouseOf(options),
      });
    }
  }

  const wanted = po.order ? [] : (Array.isArray(body.lines) ? body.lines : []).filter((l) => Number(l?.qty) > 0);
  if (!po.order && !wanted.length) throw badRequest("Enter the quantity received on at least one line.");
  const seen = new Set();
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
    const { hsn, tax, taxCode } = billTaxes(line, w, product, options, label, newCodes, taxes, po.vendorCode);
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
      tax_code: taxCode,
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
    purchase_order: po.order || "",
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
