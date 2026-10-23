import * as erp from "../integrations/erpnext/client.js";
import { erpNow } from "../integrations/erpnext/time.js";

/**
 * A purchase request is Completed once its goods are in (23 Oct 2026).
 *
 * The goods arrive as a "CMMS Goods Receipt" against the request's PO; the
 * sync on the SAP server posts it as a GRPO and sets it Posted. There is no
 * ERPNext Purchase Receipt and no webhook, so this module looks, on a timer
 * (purchaseCompletionRunner.js), at what has been received against each
 * Ordered request:
 *
 *   Ordered   -> Completed  once every line's posted receipts add up to at
 *                           least the quantity requested, across any number
 *                           of receipts. Less than that, it stays Ordered.
 *   Completed -> Ordered    if they no longer do (a receipt taken out of
 *                           ERPNext by hand); the sync then follows it again.
 *
 * Nothing else ever moves: Queued, In SAP, Failed and Closed (every PO
 * cancelled in SAP) are never completed. Completed is the CMMS's own status,
 * on its own doctype; the sync reads only In SAP and Ordered requests, so
 * nothing about it reaches SAP.
 *
 * Each move writes an Info comment on the request naming the receipts, and the
 * doctype tracks changes, so ERPNext keeps the history. A run that finds
 * nothing to move writes nothing, so running twice - or two servers running
 * at once - leaves a single entry.
 */

const REQUEST = "CMMS Purchase Request";
const REQUEST_LINE = "CMMS Purchase Request Line";
const RECEIPT = "CMMS Goods Receipt";
const RECEIPT_LINE = "CMMS Goods Receipt Line";

export const COMPLETED = "Completed";
/** Only an ordered request has a PO to receive against. */
const ORDERED = "Ordered";

const poList = (value) =>
  String(value || "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);

/**
 * Is this receipt against one of the request's POs? A PO made in the CMMS is
 * matched by its SAP DocEntry; one made in SAP by its number, in the request's
 * company (SAP numbers each company's POs on its own).
 */
export const receivesFor = (request, receipt) => {
  if (receipt.kind && receipt.kind !== "Goods Receipt") return false;
  if (receipt.status !== "Posted") return false;
  if (receipt.company !== request.company) return false;
  if (request.po_doc_entry && Number(receipt.sap_po_entry) === Number(request.po_doc_entry)) return true;
  return poList(request.po_numbers).includes(String(receipt.sap_po_number || "").trim());
};

/**
 * What has come in against a request. Pure.
 *
 * @param request  { company, status, po_numbers, po_doc_entry, lines: [{ item, qty }] }
 * @param receipts [{ name, kind, company, status, sap_po_entry, sap_po_number, sap_doc_number, bill_no, posted_at, lines: [{ item, qty }] }]
 * @returns { receipts, lines: [{ item, requested, received }], complete }
 */
export const receiptProgress = (request, receipts = []) => {
  const mine = receipts.filter((r) => receivesFor(request, r));
  const received = new Map();
  for (const r of mine) {
    for (const l of r.lines || []) received.set(l.item, (received.get(l.item) || 0) + Number(l.qty || 0));
  }
  const lines = (request.lines || []).map((l) => ({
    item: l.item,
    requested: Number(l.qty || 0),
    received: received.get(l.item) || 0,
  }));
  return {
    receipts: mine,
    lines,
    complete: lines.length > 0 && lines.every((l) => l.received >= l.requested),
  };
};

/**
 * The status a request should move to, or null to leave it. Pure.
 */
export const nextStatus = (request, progress) => {
  if (request.status === ORDERED && progress.complete) return COMPLETED;
  if (request.status === COMPLETED && !progress.complete) return ORDERED;
  return null;
};

const receiptLabel = (r) =>
  [r.name, r.sap_doc_number ? `SAP GRPO ${r.sap_doc_number}` : "", r.bill_no ? `bill ${r.bill_no}` : ""]
    .filter(Boolean)
    .join(", ");

/** The history entry for a move. */
export const historyNote = (from, to, progress, at) => {
  const names = progress.receipts.map(receiptLabel).join("; ") || "none";
  if (to === COMPLETED) {
    return `Completed by the CMMS from ERPNext goods receipts at ${at}: every item received in full. Receipts: ${names}.`;
  }
  const short = progress.lines
    .filter((l) => l.received < l.requested)
    .map((l) => `${l.item} ${l.received} of ${l.requested}`)
    .join(", ");
  return `Back to ${to} from ${from} by the CMMS at ${at}: the goods receipts no longer cover the request (${short}). Receipts: ${names}.`;
};

/** Lines of many parents at once, grouped by parent. */
const linesByParent = async (api, child, parent, names, fields) => {
  const out = new Map();
  for (let i = 0; i < names.length; i += 100) {
    const rows = await api.listChildRows(child, parent, {
      fields: ["parent", ...fields],
      filters: [[child, "parent", "in", names.slice(i, i + 100)]],
      limit: 5000,
    });
    for (const row of rows) {
      if (!out.has(row.parent)) out.set(row.parent, []);
      out.get(row.parent).push(row);
    }
  }
  return out;
};

/**
 * The posted goods receipts that may be against these requests, with their
 * lines: those of the requests' companies whose PO is one of theirs.
 */
export const receiptsAgainst = async (requests, api = erp) => {
  const numbers = [...new Set(requests.flatMap((r) => poList(r.po_numbers)))];
  const entries = [...new Set(requests.map((r) => r.po_doc_entry).filter(Boolean).map(Number))];
  const companies = [...new Set(requests.map((r) => r.company))];
  if (!companies.length || (!numbers.length && !entries.length)) return [];

  const or = [];
  if (numbers.length) or.push([RECEIPT, "sap_po_number", "in", numbers]);
  if (entries.length) or.push([RECEIPT, "sap_po_entry", "in", entries]);
  const rows = await api.listDocs(RECEIPT, {
    fields: ["name", "kind", "company", "status", "sap_po_entry", "sap_po_number", "sap_doc_number", "bill_no", "posted_at"],
    filters: [
      [RECEIPT, "company", "in", companies],
      [RECEIPT, "kind", "=", "Goods Receipt"],
      [RECEIPT, "status", "=", "Posted"],
    ],
    orFilters: or,
    orderBy: "posted_at asc",
    limit: 2000,
  });
  if (!rows.length) return [];
  const lines = await linesByParent(api, RECEIPT_LINE, RECEIPT, rows.map((r) => r.name), ["item", "qty"]);
  return rows.map((r) => ({ ...r, lines: lines.get(r.name) || [] }));
};

/** The receipts shown on a request, newest last. */
export const toReceiptSummary = (r) => ({
  id: r.name,
  sapDocNumber: r.sap_doc_number || "",
  poNumber: r.sap_po_number || "",
  billNo: r.bill_no || "",
  postedAt: r.posted_at || null,
});

/** Set when ERPNext refused the status because the doctype lacks it; see the warning below. */
let missingOption = false;

/**
 * Re-checks every Ordered and Completed request against its receipts and moves
 * the ones that changed. Safe to run at any time and any number of times.
 *
 * @param api  the ERPNext client; the tests pass a fake.
 * @returns    [{ id, from, to }] for each request moved
 */
export const reconcileCompletion = async ({ api = erp, now = erpNow } = {}) => {
  const requests = await api.listDocs(REQUEST, {
    fields: ["name", "company", "status", "po_numbers", "po_doc_entry"],
    filters: [[REQUEST, "status", "in", [ORDERED, COMPLETED]]],
    limit: 2000,
  });
  if (!requests.length) return [];
  const lines = await linesByParent(api, REQUEST_LINE, REQUEST, requests.map((r) => r.name), ["item", "qty"]);
  for (const r of requests) r.lines = lines.get(r.name) || [];
  const receipts = await receiptsAgainst(requests, api);

  const moved = [];
  for (const request of requests) {
    const progress = receiptProgress(request, receipts);
    const to = nextStatus(request, progress);
    if (!to) continue;
    try {
      await api.updateDoc(REQUEST, request.name, { status: to });
    } catch (error) {
      if (to === COMPLETED && /Completed/.test(String(error?.message))) {
        if (!missingOption) {
          console.warn(`Purchase requests cannot be Completed until the status option is added: run "npm run erp:sync-purchasing". (${error.message})`);
        }
        missingOption = true;
        return moved;
      }
      console.error(`${request.name}: status not moved to ${to}:`, error.message);
      continue;
    }
    missingOption = false;
    const at = now();
    await api
      .createDoc("Comment", {
        doctype: "Comment",
        comment_type: "Info",
        reference_doctype: REQUEST,
        reference_name: request.name,
        content: historyNote(request.status, to, progress, at),
      })
      .catch((error) => console.error(`${request.name}: history note not written:`, error.message));
    moved.push({ id: request.name, from: request.status, to });
  }
  return moved;
};
