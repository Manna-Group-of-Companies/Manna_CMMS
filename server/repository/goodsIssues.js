import {
  createDoc,
  listChildRows,
  listDocs,
  updateDoc,
} from "../integrations/erpnext/client.js";
import { erpNow } from "../integrations/erpnext/time.js";
import { resolveStore } from "../integrations/erpnext/stores.js";
import { catalogProducts } from "./catalog.js";
import { itemMasterOptions, raiseSapFlag } from "./sapCategories.js";

/**
 * Spares issued to a breakdown, decided 10 Oct 2026.
 *
 * The spares used on a repair are picked from the store of the breakdown's own
 * company - the plant's store, which is that company's SAP item list - and no
 * more can be taken than is on the shelf there, less what other breakdowns have
 * already taken and SAP has not posted yet. Saving the repair writes one "CMMS
 * Goods Issue" for its spares; the sync on the SAP server posts it as a SAP
 * Goods Issue (InventoryGenExits) from the company's engineering warehouse and
 * the same quantity out of the company's ERPNext store (Material Issue), then
 * sets Posted or Failed.
 *
 * The issue is written as Draft before the breakdown moves on and released to
 * Queued only once it has: a repair the workflow refused must not take stock
 * off the shelf, so its issue is Cancelled. A Draft left behind by a failure
 * after the breakdown moved on is shown on it with a button to send it.
 *
 * Errors are plain Errors (no status): the breakdown controller hands their
 * message to the screen as a 400, which is what a refusal here is.
 */

const DOCTYPE = "CMMS Goods Issue";
const LINE = "CMMS Goods Issue Line";

/** Issued here but not yet off the shelf in ERPNext, so still to be counted against it. */
const HOLDING = ["Draft", "Queued", "Failed"];

const FIELDS = [
  "name",
  "company",
  "status",
  "breakdown",
  "raised_by",
  "raised_at",
  "sap_doc_number",
  "erp_stock_entry",
  "posted_at",
  "error",
];

/**
 * Units counted whole - the sync's list too. ERPNext refuses a fraction of
 * them, and by then SAP would already have posted the issue.
 */
const WHOLE_UNITS = new Set(["Nos", "Set", "Pair", "Box", "Packet", "Unit", "Roll"]);

const tidy = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const round = (n) => Math.round(n * 1000) / 1000;

/** The store, and with it the SAP company, a plant draws its spares from. */
const storeOfPlant = (plant) => {
  const store = resolveStore(plant);
  if (!store) throw new Error(`No store is set up for the plant "${plant}", so no spares can be issued to it.`);
  return store;
};

/** Quantity issued to breakdowns and not yet posted, per item, for one company: item -> qty. */
const waitingByItem = async (company) => {
  const held = await listDocs(DOCTYPE, {
    fields: ["name"],
    filters: [
      [DOCTYPE, "company", "=", company],
      [DOCTYPE, "status", "in", HOLDING],
    ],
    limit: 500,
  }).catch((error) => {
    if (error?.status === 404) {
      throw new Error(
        "Spares cannot be issued yet: goods issues are not set up in ERPNext (sap-sync/setup-goods-issue.js)."
      );
    }
    throw error;
  });
  const out = new Map();
  if (!held.length) return out;
  const lines = await listChildRows(LINE, DOCTYPE, {
    fields: ["parent", "item", "qty"],
    filters: [[LINE, "parent", "in", held.map((h) => h.name)]],
    limit: 5000,
  });
  for (const l of lines) out.set(l.item, (out.get(l.item) || 0) + Number(l.qty || 0));
  return out;
};

/**
 * What a breakdown at this plant can take: every item of the plant's company
 * that SAP knows, with what is on the shelf, what is already promised to other
 * breakdowns, and what is left. In-stock items first, then by name.
 */
export const sparesFor = async (plant) => {
  const store = storeOfPlant(plant);
  const [products, waiting] = await Promise.all([catalogProducts(), waitingByItem(store.abbr)]);
  const items = products
    .filter((p) => !p.disabled && p.sapCategory?.company === store.abbr && p.sap?.code)
    .map((p) => {
      const onShelf = p.rooms.find((r) => r.room === store.label)?.quantity || 0;
      const held = waiting.get(p.code) || 0;
      return {
        code: p.code,
        name: p.name,
        sapCode: p.sap.code,
        unit: p.unit,
        whole: WHOLE_UNITS.has(p.unit),
        onShelf,
        waiting: held,
        available: Math.max(0, round(onShelf - held)),
      };
    })
    .sort((a, b) => (b.available > 0) - (a.available > 0) || String(a.name).localeCompare(String(b.name)));
  return { company: store.abbr, companyName: store.label, items };
};

/**
 * Checks the spares a repair used against the plant's store and builds both
 * the breakdown's spare rows and the issue's lines. Refuses anything not picked
 * from the store, entered twice, or more than is available.
 *
 * @param spares [{ item_code, qty_required }]
 */
export const prepareIssue = async (plant, spares = []) => {
  const wanted = (spares || []).filter((s) => tidy(s?.item_code) || tidy(s?.description));
  if (!wanted.length) return { company: "", rows: [], lines: [] };

  const { company, companyName, items } = await sparesFor(plant);
  const byCode = new Map(items.map((i) => [i.code, i]));
  const warehouse = tidy((await itemMasterOptions())[company]?.warehouse) || "01";
  const seen = new Set();
  const rows = [];
  const lines = [];
  for (const s of wanted) {
    const code = tidy(s.item_code);
    if (!code) throw new Error(`Pick "${tidy(s.description)}" from the list of ${companyName}'s store items.`);
    const item = byCode.get(code);
    if (!item) throw new Error(`${code} is not an item of ${companyName}'s store with a SAP code.`);
    if (seen.has(code)) throw new Error(`${item.name} is entered twice.`);
    seen.add(code);
    const qty = Number(s.qty_required);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Enter a quantity above zero for ${item.name}.`);
    if (item.whole && !Number.isInteger(qty)) throw new Error(`${item.name} is counted in whole ${item.unit}; enter a whole number.`);
    if (qty > item.available + 1e-9) {
      throw new Error(
        `${item.name}: ${qty} ${item.unit} is more than the ${item.available} available in ${companyName}'s store` +
          (item.waiting ? ` (${item.onShelf} on the shelf, ${item.waiting} already issued and waiting for SAP)` : "") +
          ".",
      );
    }
    rows.push({
      doctype: "CMMS Breakdown Spare",
      item_code: code,
      description: item.name,
      qty_required: qty,
      qty_in_store: item.onShelf,
    });
    lines.push({
      doctype: LINE,
      item: code,
      item_name: item.name,
      sap_item_code: item.sapCode,
      qty,
      uom: item.unit,
      warehouse,
    });
  }
  return { company, rows, lines };
};

/** Records the issue, held back from SAP (Draft) until the breakdown has moved on. */
export const draftIssue = ({ company, lines, breakdown, user }) =>
  createDoc(DOCTYPE, {
    doctype: DOCTYPE,
    company,
    status: "Draft",
    breakdown: breakdown.name,
    machine: breakdown.machine || "",
    plant: breakdown.plant || "",
    raised_by: user?.email || "",
    raised_at: erpNow(),
    lines,
  });

/** Hands the issue to the SAP server. */
export const releaseIssue = async (name, user) => {
  await updateDoc(DOCTYPE, name, { status: "Queued", error: "" });
  await raiseSapFlag(user?.email);
};

/** Cancels an issue whose breakdown did not move on: nothing was taken. Kept, not deleted, as the record of the attempt. */
export const cancelIssue = (name) =>
  updateDoc(DOCTYPE, name, { status: "Cancelled" }).catch((error) =>
    console.warn(`Could not cancel ${name}:`, error.message)
  );

const toIssue = (row) => ({
  id: row.name,
  company: row.company,
  status: row.status || "Draft",
  raisedBy: row.raised_by || "",
  raisedAt: row.raised_at || null,
  sapDocNumber: row.sap_doc_number || "",
  erpStockEntry: row.erp_stock_entry || "",
  postedAt: row.posted_at || null,
  error: row.error || "",
});

/** The breakdown's latest issue, or null (also when goods issues are not set up in ERPNext yet). */
export const issueForBreakdown = async (breakdown) => {
  try {
    const rows = await listDocs(DOCTYPE, {
      fields: FIELDS,
      filters: [
        [DOCTYPE, "breakdown", "=", breakdown],
        [DOCTYPE, "status", "!=", "Cancelled"],
      ],
      orderBy: "creation desc",
      limit: 1,
    });
    return rows.length ? toIssue(rows[0]) : null;
  } catch {
    return null;
  }
};

/** Sends a breakdown's issue that failed, or never left Draft, to the SAP server. */
export const resendIssue = async (breakdown, user) => {
  const issue = await issueForBreakdown(breakdown);
  if (!issue) throw new Error("No spares were issued to this breakdown.");
  if (!["Draft", "Failed"].includes(issue.status)) {
    throw new Error(`The spares issue is ${issue.status}; only one that failed or was never sent can be sent again.`);
  }
  await releaseIssue(issue.id, user);
  return issueForBreakdown(breakdown);
};
