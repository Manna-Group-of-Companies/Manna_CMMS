import {
  callMethod,
  createDoc,
  getDoc,
  listDocs,
  updateDoc,
} from "../integrations/erpnext/client.js";
import { createCatalogItem, nextItemCode } from "./catalog.js";
import { resolveItemName } from "../utils/itemNaming.js";
import { resolveUom } from "../integrations/erpnext/uom.js";
import { erpNow } from "../integrations/erpnext/time.js";

/**
 * Item naming requests.
 *
 * Stock turns up that nobody has a name for. The Maintenance Manager proposes
 * one against the naming convention; the VP Operations approves it; only then
 * does it become a catalog item, and only after that does it go to SAP.
 *
 * Nothing here writes `workflow_state`. Approving is a workflow transition
 * ERPNext enforces and stamps, which is the whole point — the DocType this
 * replaced had a plain status field, so "approved" meant somebody had typed
 * the word.
 */

const FIELDS = [
  "name",
  "proposed_name",
  "plant",
  "item_group",
  "proposed_category",
  "proposed_sub_category",
  "uom",
  "brand",
  "rack_location",
  "min_stock",
  "description",
  "reason",
  "raised_by",
  "raised_at",
  "workflow_state",
  "decided_by",
  "decided_at",
  "decision_note",
  "erp_item",
  "sap_item_code",
  "pushed_at",
  "name_compliant",
  "modified",
];

/** ERPNext's datetime format, in ERPNext's timezone. See time.js. */
const now = () => erpNow();

/** What each state is waiting for, in the words the screen shows. */
const WAITING_ON = {
  "Awaiting Approval": "The VP Operations to approve the name",
  Approved: "Someone to push it to SAP",
  "In SAP": "",
  Rejected: "The Maintenance Manager to revise it",
};

const toSummary = (row) => ({
  id: row.name,
  proposedName: row.proposed_name,
  plant: row.plant || "",
  itemGroup: row.item_group || "",
  category: row.proposed_category || "",
  subCategory: row.proposed_sub_category || "",
  unit: row.uom,
  brand: row.brand || "",
  rackLocation: row.rack_location || "",
  minStock: Number(row.min_stock || 0),
  description: row.description || "",
  reason: row.reason || "",
  raisedBy: row.raised_by,
  raisedAt: row.raised_at,
  state: row.workflow_state,
  waitingOn: WAITING_ON[row.workflow_state] ?? "",
  decidedBy: row.decided_by || "",
  decidedAt: row.decided_at || null,
  decisionNote: row.decision_note || "",
  itemCode: row.erp_item || "",
  sapItemCode: row.sap_item_code || "",
  pushedAt: row.pushed_at || null,
  nameCompliant: Boolean(row.name_compliant),
  updatedAt: row.modified,
});

/** Requests, newest first. */
export const listRequests = async ({ state = "", open = false, limit = 100 } = {}) => {
  const filters = [];
  if (state) filters.push(["CMMS Item Naming Request", "workflow_state", "=", state]);
  if (open) filters.push(["CMMS Item Naming Request", "workflow_state", "not in", ["In SAP", "Rejected"]]);

  const rows = await listDocs("CMMS Item Naming Request", {
    fields: FIELDS,
    filters: filters.length ? filters : undefined,
    orderBy: "creation desc",
    limit,
  });
  return rows.map(toSummary);
};

/** One request in full. */
export const getRequest = async (id) => {
  const doc = await getDoc("CMMS Item Naming Request", id).catch((error) => {
    if (error?.status === 404) return null;
    throw error;
  });
  if (!doc) return null;

  return {
    ...toSummary(doc),
    namingIssues: doc.naming_issues || "",
    naming: (() => {
      try {
        return doc.naming_parts ? JSON.parse(doc.naming_parts) : null;
      } catch {
        // A draft saved by an older build, or hand-edited in ERPNext. The name
        // itself is authoritative, so a broken parts blob costs the builder
        // view and nothing else.
        return null;
      }
    })(),
  };
};

/**
 * Raises a request. This is now the only way an item enters the catalog.
 *
 * The naming convention is checked here rather than only in the browser, and
 * the result is stored alongside the request - so a Manager approving one can
 * see that the name was checked, and by what.
 */
export const raiseRequest = async ({
  proposedName,
  naming = null,
  plant,
  category,
  subCategory = "",
  unit,
  brand = "",
  rackLocation = "",
  minStock = 0,
  description = "",
  reason = "",
  raisedBy,
} = {}) => {
  const resolved = resolveItemName({ name: proposedName, naming });
  if (!resolved.name?.trim()) throw new Error("A name is required");
  if (!String(category || "").trim()) throw new Error("A category is required");
  if (!unit) throw new Error("A unit is required");
  // Required here rather than on the DocType, so the two requests raised before
  // this field existed can still be opened and edited. See the field comment in
  // namingRequestDoctype.js.
  if (!String(plant || "").trim()) throw new Error("A plant is required");

  // `uom` is a Link field, so a spelling ERPNext does not hold is refused on
  // save. The form offers the real list, but this is the backstop: "Pcs" is
  // the store's word and has never been an ERPNext UOM - its countable unit is
  // "Nos" - so anything arriving from an older client or a script still lands
  // on something that exists.
  const { uom } = resolveUom(unit);

  const created = await createDoc("CMMS Item Naming Request", {
    doctype: "CMMS Item Naming Request",
    proposed_name: resolved.name.slice(0, 140),
    plant: String(plant).trim(),
    naming_parts: naming ? JSON.stringify(naming) : "",
    name_compliant: resolved.compliant ? 1 : 0,
    naming_issues: (resolved.issues || []).map((i) => i.message).join("\n").slice(0, 500),
    // The category is text at this stage. It becomes a real Item Group only on
    // approval - a request that gets rejected should not leave a group behind
    // it that nobody asked for and nothing files under.
    proposed_category: String(category).trim(),
    proposed_sub_category: String(subCategory || "").trim(),
    uom,
    brand,
    rack_location: rackLocation,
    min_stock: Number(minStock) || 0,
    description,
    reason,
    raised_by: raisedBy,
    raised_at: now(),
  });

  return getRequest(created.name);
};

/** Edits a request that has not been decided yet. */
export const updateRequest = async (id, fields = {}) => {
  const doc = await getDoc("CMMS Item Naming Request", id);
  if (doc.workflow_state !== "Awaiting Approval") {
    throw new Error(`This request is ${doc.workflow_state} and can no longer be edited`);
  }

  const ALLOWED = {
    proposedName: "proposed_name",
    plant: "plant",
    category: "proposed_category",
    subCategory: "proposed_sub_category",
    unit: "uom",
    brand: "brand",
    rackLocation: "rack_location",
    minStock: "min_stock",
    description: "description",
    reason: "reason",
  };

  const edits = {};
  for (const [from, to] of Object.entries(ALLOWED)) {
    if (fields[from] !== undefined) edits[to] = fields[from];
  }

  if (edits.uom) edits.uom = resolveUom(edits.uom).uom;

  if (edits.proposed_name) {
    const resolved = resolveItemName({ name: edits.proposed_name, naming: fields.naming || null });
    edits.proposed_name = resolved.name.slice(0, 140);
    edits.name_compliant = resolved.compliant ? 1 : 0;
    edits.naming_issues = (resolved.issues || []).map((i) => i.message).join("\n").slice(0, 500);
    if (fields.naming) edits.naming_parts = JSON.stringify(fields.naming);
  }

  if (Object.keys(edits).length) await updateDoc("CMMS Item Naming Request", id, edits);
  return getRequest(id);
};

/**
 * Approves a request, and creates the catalog item it was for.
 *
 * The item is created here rather than at the SAP push so the store can stock
 * and issue the part while SAP is still being dealt with - the same
 * arrangement the 654 imported items are in, where `custom_sap_item_code` sits
 * empty until a real SAP code exists.
 *
 * The item is created *before* the transition. If creating it fails, the
 * request stays where it was and can be approved again; the other order would
 * leave a request marked Approved with no item behind it, which is the state
 * nobody would think to look for.
 */
export const decide = async (id, action, { note = "", user } = {}) => {
  const doc = await getDoc("CMMS Item Naming Request", id);

  if (action === "Approve") {
    if (doc.workflow_state !== "Awaiting Approval") {
      throw new Error(`This request is ${doc.workflow_state}, so there is nothing to approve`);
    }

    const item = await createCatalogItem({
      code: await nextItemCode(),
      name: doc.proposed_name,
      // The category becomes a real Item Group here, at the moment somebody
      // agrees to it - creating it when the request was raised would litter
      // the tree with groups from requests that were turned down.
      category: doc.proposed_category,
      subCategory: doc.proposed_sub_category || "",
      unit: doc.uom,
      brand: doc.brand || "",
      minStock: Number(doc.min_stock || 0),
      rackNumber: doc.rack_location || "",
      description: doc.description || "",
      // No opening stock. What arrived is received separately, so approving a
      // name cannot quietly add stock nobody counted.
      quantity: 0,
    });

    await updateDoc("CMMS Item Naming Request", id, {
      erp_item: item.code,
      // Recorded so the request says which group it actually ended up in,
      // which is not always the name that was typed - a sub-category whose
      // name is taken elsewhere gets qualified by its parent.
      item_group: item.itemGroup || "",
      decided_by: user?.email || "",
      decided_at: now(),
      decision_note: note,
    });
  } else {
    await updateDoc("CMMS Item Naming Request", id, {
      decided_by: user?.email || "",
      decided_at: now(),
      decision_note: note,
    });
  }

  const fresh = await getDoc("CMMS Item Naming Request", id);
  await callMethod("frappe.model.workflow.apply_workflow", { doc: fresh, action });
  return getRequest(id);
};

/**
 * Records that the item reached SAP.
 *
 * Not written yet: nothing in this system can talk to the SAP Service Layer
 * until the capability probe comes back, and a push that quietly did nothing
 * would be worse than one that refuses. Until then this records a code entered
 * by hand, which is what the store is doing today anyway.
 */
export const recordSapCode = async (id, { sapItemCode, response = "", user } = {}) => {
  const code = String(sapItemCode || "").trim();
  if (!code) throw new Error("The SAP item code is required");

  const doc = await getDoc("CMMS Item Naming Request", id);
  if (doc.workflow_state !== "Approved") {
    throw new Error(`This request is ${doc.workflow_state}, so it is not ready for SAP`);
  }
  if (!doc.erp_item) throw new Error("This request has no catalog item behind it");

  await updateDoc("CMMS Item Naming Request", id, {
    sap_item_code: code,
    pushed_by: user?.email || "",
    pushed_at: now(),
    sap_response: response.slice(0, 500),
  });

  // The catalog item carries the SAP code too, which is where every other
  // screen already looks for it.
  await updateDoc("Item", doc.erp_item, { custom_sap_item_code: code });

  const fresh = await getDoc("CMMS Item Naming Request", id);
  await callMethod("frappe.model.workflow.apply_workflow", { doc: fresh, action: "Mark In SAP" });
  return getRequest(id);
};
