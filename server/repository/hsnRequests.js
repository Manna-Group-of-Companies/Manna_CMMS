import { createDoc, deleteDoc, getDoc, listDocs, updateDoc } from "../integrations/erpnext/client.js";
import { erpNow } from "../integrations/erpnext/time.js";
import { forgetCatalog } from "./catalog.js";
import { hsnDigits, hsnProblem, raiseSapFlag } from "./sapCategories.js";

/**
 * New HSN codes from goods receipts (20 Oct 2026).
 *
 * A bill can carry an HSN code SAP has never had. Rather than refuse the
 * receipt until somebody adds the code in the SAP client, the receipt asks for
 * it: one "CMMS SAP HSN Request" per new code, linked to the receipt and the
 * item. The sync on the SAP server creates the code (or adopts it if SAP has
 * it by then), marks the request Created or Failed, puts the code on the item,
 * and holds the receipt Queued - the reason in its error - until every request
 * linked to it is Created. Raised and shown like "CMMS SAP Item Group Request".
 *
 *   Queued -> Created (sap_chapter_id) | Failed (error)
 *
 * A failed one is the Maintenance Manager's to send again or to correct.
 */

export const HSN_REQUEST = "CMMS SAP HSN Request";
const RECEIPT = "CMMS Goods Receipt";

const FIELDS = ["name", "company", "hsn_code", "status", "goods_receipt", "item", "raised_by", "raised_at", "sap_chapter_id", "created_at", "error"];

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const notFound = (message) => Object.assign(new Error(message), { status: 404 });

const toHsnRequest = (row) => ({
  id: row.name,
  company: row.company,
  hsnCode: row.hsn_code || "",
  status: row.status || "Queued",
  goodsReceipt: row.goods_receipt || "",
  item: row.item || "",
  sapChapterId: row.sap_chapter_id || "",
  createdAt: row.created_at || null,
  error: row.error || "",
  raisedBy: row.raised_by || "",
  raisedAt: row.raised_at || null,
});

/** The requests raised by these receipts, keyed by receipt. */
export const requestsForReceipts = async (names) => {
  const out = new Map();
  for (let i = 0; i < names.length; i += 100) {
    const rows = await listDocs(HSN_REQUEST, {
      fields: FIELDS,
      filters: [[HSN_REQUEST, "goods_receipt", "in", names.slice(i, i + 100)]],
      orderBy: "creation asc",
      limit: 500,
    }).catch(() => []);
    for (const r of rows) {
      if (!out.has(r.goods_receipt)) out.set(r.goods_receipt, []);
      out.get(r.goods_receipt).push(toHsnRequest(r));
    }
  }
  return out;
};

/**
 * One request per new code on a receipt. Called in the same call that saved
 * the receipt; if any insert fails, the ones made are taken back and the
 * error rises, so the caller can take the receipt back too.
 *
 * @param codes Map of hsn digits -> the item of the first line carrying it
 * @param quotation instead of `receipt`, since 24 Oct 2026: the quotation is held, as a receipt is, until SAP has the code
 */
export const raiseHsnRequests = async ({ company, receipt, quotation, codes, user }) => {
  const made = [];
  try {
    for (const [hsn, item] of codes) {
      const created = await createDoc(HSN_REQUEST, {
        doctype: HSN_REQUEST,
        company,
        hsn_code: hsn,
        status: "Queued",
        ...(quotation ? { purchase_quotation: quotation } : { goods_receipt: receipt }),
        item,
        raised_by: user?.email || "",
        raised_at: erpNow(),
      });
      made.push(created.name);
    }
  } catch (error) {
    for (const name of made) await deleteDoc(HSN_REQUEST, name).catch(() => {});
    throw error;
  }
  return made;
};

/** Takes back a Queued receipt's Queued requests, when the receipt itself is deleted. */
export const dropQueuedRequests = async (receipt, field = "goods_receipt") => {
  const rows = await listDocs(HSN_REQUEST, {
    fields: ["name"],
    filters: [[HSN_REQUEST, field, "=", receipt], [HSN_REQUEST, "status", "=", "Queued"]],
    limit: 100,
  });
  for (const r of rows) await deleteDoc(HSN_REQUEST, r.name);
  return rows.length;
};

/** The same for a quotation: deleted, or changed and about to raise its codes again. */
export const dropQueuedForQuotation = (quotation) => dropQueuedRequests(quotation, "purchase_quotation");

const loadFailed = async (id) => {
  const doc = await getDoc(HSN_REQUEST, id).catch(() => null);
  if (!doc) throw notFound("HSN request not found");
  if (doc.status !== "Failed") throw badRequest(`This HSN request is ${doc.status}; only a failed one can be sent again or corrected.`);
  return doc;
};

/** The company a request belongs to, for the caller's scope check. */
export const hsnRequestCompany = async (id) => (await getDoc(HSN_REQUEST, id).catch(() => null))?.company || null;

/** Sends a failed request back to the SAP server as it is. */
export const resendHsnRequest = async (id, user) => {
  await loadFailed(id);
  await updateDoc(HSN_REQUEST, id, { status: "Queued", error: "" });
  await raiseSapFlag(user?.email);
  return toHsnRequest(await getDoc(HSN_REQUEST, id));
};

/**
 * Corrects a failed request's code - most often a digit mistyped from the bill
 * - and sends it again. The receipt's lines that carried the old code, and
 * their items, take the new one, so what the sync posts agrees with itself.
 */
export const correctHsnRequest = async (id, value, user) => {
  const doc = await loadFailed(id);
  const hsn = hsnDigits(value);
  if (!hsn) throw badRequest("Enter the HSN code from the bill.");
  const problem = hsnProblem(hsn);
  if (problem) throw badRequest(`${hsn}: ${problem}.`);
  const old = doc.hsn_code;

  if (doc.goods_receipt && hsn !== old) {
    const receipt = await getDoc(RECEIPT, doc.goods_receipt).catch(() => null);
    const lines = receipt?.lines || [];
    const touched = lines.filter((l) => l.hsn_code === old);
    if (touched.length) {
      // The whole table, as Frappe replaces a child table it is given.
      await updateDoc(RECEIPT, doc.goods_receipt, {
        lines: lines.map((l) => (l.hsn_code === old ? { ...l, hsn_code: hsn } : l)),
      });
      for (const item of new Set(touched.map((l) => l.item))) {
        await updateDoc("Item", item, { custom_sap_hsn_code: hsn, custom_sap_category_pending: 1, custom_sap_category_error: "" });
      }
      forgetCatalog();
    }
  }

  await updateDoc(HSN_REQUEST, id, { hsn_code: hsn, status: "Queued", error: "" });
  await raiseSapFlag(user?.email);
  return toHsnRequest(await getDoc(HSN_REQUEST, id));
};
