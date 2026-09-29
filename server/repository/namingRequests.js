import {
  callMethod,
  createDoc,
  getDoc,
  listDocs,
  updateDoc,
} from "../integrations/erpnext/client.js";
import { ensureBrand } from "./catalog.js";
import { resolveItemName } from "../utils/itemNaming.js";
import { resolveUom } from "../integrations/erpnext/uom.js";
import { erpNow } from "../integrations/erpnext/time.js";
import { storeForCompany } from "../integrations/erpnext/stores.js";
import {
  SAP_NAME_MAX,
  itemMasterOptions,
  pickFrom,
  pickHsn,
  raiseSapFlag,
} from "./sapCategories.js";

/**
 * Item naming requests - the only way a new engineering item is made.
 *
 * Since 25 Sep 2026 an item is made in SAP, not just in the CMMS:
 *
 *   1. The Maintenance Manager fills in the SAP item master fields - SAP
 *      company, item group, Sub-category A/B, the description from the SOP
 *      naming builder, foreign name, unit, HSN code, tax rate - plus minimum
 *      stock and brand, and sends it for approval.
 *   2. The VP Operations approves it (or rejects it). Approving marks it
 *      `sap_create_status = Queued` and raises the flag on "SAP Item Category
 *      Sync Control".
 *   3. On the SAP server, the flagged sync creates the item in that SAP company
 *      with the company's next item code (ENG-437, EL-20, or SAP's automatic
 *      series), creates its ERPNext copy "<abbr>-<SAP code>", fills in
 *      `erp_item` / `sap_item_code`, and moves the request to "In SAP".
 *      A failure lands as `sap_create_status = Failed` with the reason, and the
 *      Maintenance Manager can send it again.
 *
 * This server never talks to SAP; it only writes ERPNext and raises the flag.
 * Nothing here writes `workflow_state` directly - every step is a workflow
 * transition ERPNext enforces and stamps.
 */

const DOCTYPE = "CMMS Item Naming Request";

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
  "sap_company",
  "sap_item_group",
  "sap_sub_type_a",
  "sap_sub_type_b",
  "foreign_name",
  "sap_uom",
  "hsn_code",
  "tax_rate",
  "sap_create_status",
  "sap_create_error",
  "sap_response",
  "modified",
];

const now = () => erpNow();
const tidy = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const forbidden = (message) => Object.assign(new Error(message), { status: 403 });

/** What each state is waiting for, in the words the screen shows. */
const waitingOn = (row) => {
  if (row.workflow_state === "Awaiting Approval") return "The VP Operations to approve it";
  if (row.workflow_state === "Approved") {
    if (row.sap_create_status === "Failed") return "The Maintenance Manager to fix it and send it to SAP again";
    return "The SAP server to create it in SAP";
  }
  if (row.workflow_state === "Rejected") return "The Maintenance Manager to revise it";
  return "";
};

const toSummary = (row) => ({
  id: row.name,
  proposedName: row.proposed_name,
  plant: row.plant || "",
  itemGroup: row.item_group || "",
  // SAP levels first; requests raised before 25 Sep carry only the old two.
  category: row.sap_item_group || row.proposed_category || "",
  subCategory: row.sap_item_group ? row.sap_sub_type_a || "" : row.proposed_sub_category || "",
  subCategoryB: row.sap_sub_type_b || "",
  company: row.sap_company || "",
  companyName: storeForCompany(row.sap_company)?.label || row.plant || "",
  foreignName: row.foreign_name || "",
  unit: row.sap_uom || row.uom,
  hsnCode: row.hsn_code || "",
  taxRate: row.tax_rate || "",
  brand: row.brand || "",
  rackLocation: row.rack_location || "",
  minStock: Number(row.min_stock || 0),
  description: row.description || "",
  reason: row.reason || "",
  raisedBy: row.raised_by,
  raisedAt: row.raised_at,
  state: row.workflow_state,
  waitingOn: waitingOn(row),
  decidedBy: row.decided_by || "",
  decidedAt: row.decided_at || null,
  decisionNote: row.decision_note || "",
  itemCode: row.erp_item || "",
  sapItemCode: row.sap_item_code || "",
  sapStatus: row.sap_create_status || "",
  sapError: row.sap_create_error || "",
  pushedAt: row.pushed_at || null,
  nameCompliant: Boolean(row.name_compliant),
  // False for requests raised before the SAP fields existed: they cannot be created in SAP.
  hasSapFields: Boolean(row.sap_company && row.sap_item_group),
  updatedAt: row.modified,
});

/** Requests, newest first. */
export const listRequests = async ({ state = "", open = false, limit = 100 } = {}) => {
  const filters = [];
  if (state) filters.push([DOCTYPE, "workflow_state", "=", state]);
  if (open) filters.push([DOCTYPE, "workflow_state", "not in", ["In SAP", "Rejected"]]);

  const rows = await listDocs(DOCTYPE, {
    fields: FIELDS,
    filters: filters.length ? filters : undefined,
    orderBy: "creation desc",
    limit,
  });
  return rows.map(toSummary);
};

/** One request in full. */
export const getRequest = async (id) => {
  const doc = await getDoc(DOCTYPE, id).catch((error) => {
    if (error?.status === 404) return null;
    throw error;
  });
  if (!doc) return null;

  return {
    ...toSummary(doc),
    namingIssues: doc.naming_issues || "",
    sapResponse: doc.sap_response || "",
    naming: (() => {
      try {
        return doc.naming_parts ? JSON.parse(doc.naming_parts) : null;
      } catch {
        return null;
      }
    })(),
  };
};

/**
 * What the form offers, per SAP company: item groups with the code the next
 * item would get, units, HSN codes, tax rates. Published on the control Single
 * by the sync, from SAP itself.
 */
export const requestOptions = async () => {
  const options = await itemMasterOptions();
  return Object.entries(options).map(([abbr, o]) => ({
    abbr,
    company: o.company || storeForCompany(abbr)?.label || abbr,
    sapDb: o.sap_db,
    groups: (o.groups || []).map((g) => ({
      code: g.code,
      name: g.name,
      // The code the next item in this group should get. SAP confirms it on
      // creation - two approvals before a run get consecutive numbers.
      nextCode: g.prefix ? `${g.prefix}${o.next_codes?.[g.prefix] ?? 1}` : "",
      automatic: !g.prefix,
    })),
    units: o.units || [],
    taxRates: o.tax_rates || [],
    hsn: o.hsn || [],
  }));
};

/**
 * Checks the SAP item master fields against the chosen company's published
 * SAP lists, returning SAP's own spellings.
 */
const checkSapFields = async ({ company, itemGroup, subCategory, subCategoryB, foreignName, unit, hsnCode, taxRate, minStock }) => {
  const abbr = tidy(company).toUpperCase();
  const options = (await itemMasterOptions())[abbr];
  if (!options) throw badRequest("Choose the SAP company the item belongs to.");
  const label = options.company || abbr;

  const group = (options.groups || []).find((g) => tidy(g.name).toLowerCase() === tidy(itemGroup).toLowerCase());
  if (!group) throw badRequest(`Choose one of ${label}'s item groups: ${(options.groups || []).map((g) => g.name).join(", ")}.`);

  const a = tidy(subCategory);
  const b = tidy(subCategoryB);
  if (a.length > 50 || b.length > 50) throw badRequest("Sub-category A and B can be at most 50 characters - that is SAP's limit.");
  if (b && !a) throw badRequest("Sub-category B needs a Sub-category A above it.");

  const foreign = tidy(foreignName);
  if (foreign.length > SAP_NAME_MAX) throw badRequest(`The foreign name can be at most ${SAP_NAME_MAX} characters.`);

  const sapUnit = pickFrom(options.units, unit, "unit", label);
  if (!sapUnit) throw badRequest("Choose a unit.");

  const min = Number(minStock || 0);
  if (!Number.isFinite(min) || min < 0) throw badRequest("Minimum stock must be zero or more.");

  return {
    abbr,
    label,
    fields: {
      sap_company: abbr,
      sap_item_group: group.name,
      sap_sub_type_a: a,
      sap_sub_type_b: b,
      foreign_name: foreign,
      sap_uom: sapUnit,
      hsn_code: pickHsn(options.hsn, hsnCode, label),
      tax_rate: pickFrom(options.tax_rates, taxRate, "tax rate", label),
      min_stock: min,
    },
  };
};

const checkName = ({ proposedName, naming }) => {
  const resolved = resolveItemName({ name: proposedName, naming });
  const name = tidy(resolved.name);
  if (!name) throw badRequest("A description is required - build it with the SOP naming builder.");
  if (name.length > SAP_NAME_MAX) throw badRequest(`The description can be at most ${SAP_NAME_MAX} characters - that is SAP's limit.`);
  return {
    proposed_name: name,
    naming_parts: naming ? JSON.stringify(naming) : "",
    name_compliant: resolved.compliant ? 1 : 0,
    naming_issues: (resolved.issues || []).map((i) => i.message).join("\n").slice(0, 500),
  };
};

/**
 * Raises a request (the Maintenance Manager). The SOP name becomes SAP's
 * item description; everything else is checked against SAP's own lists for the
 * chosen company.
 */
export const raiseRequest = async (body = {}) => {
  const name = checkName(body);
  const sap = await checkSapFields(body);
  const brand = await ensureBrand(body.brand);

  const created = await createDoc(DOCTYPE, {
    doctype: DOCTYPE,
    ...name,
    ...sap.fields,
    // The CMMS Plant of the same name, which is also the company's store.
    plant: storeForCompany(sap.abbr)?.label || "",
    // The mirror items live on the catalog root; the SAP group is a field.
    item_group: "Maintenance Store",
    proposed_category: sap.fields.sap_item_group,
    proposed_sub_category: sap.fields.sap_sub_type_a,
    uom: resolveUom(sap.fields.sap_uom).uom,
    brand,
    description: name.proposed_name,
    raised_by: body.raisedBy,
    raised_at: now(),
  });

  return getRequest(created.name);
};

/** Edits a request that has not been decided yet, or was rejected and is being revised. */
export const updateRequest = async (id, body = {}) => {
  const doc = await getDoc(DOCTYPE, id);
  if (!["Awaiting Approval", "Rejected"].includes(doc.workflow_state)) {
    throw badRequest(`This request is ${doc.workflow_state} and can no longer be edited`);
  }
  const name = body.proposedName !== undefined || body.naming ? checkName(body) : {};
  const sap = await checkSapFields({
    company: body.company ?? doc.sap_company,
    itemGroup: body.itemGroup ?? doc.sap_item_group,
    subCategory: body.subCategory ?? doc.sap_sub_type_a,
    subCategoryB: body.subCategoryB ?? doc.sap_sub_type_b,
    foreignName: body.foreignName ?? doc.foreign_name,
    unit: body.unit ?? doc.sap_uom,
    hsnCode: body.hsnCode ?? doc.hsn_code,
    taxRate: body.taxRate ?? doc.tax_rate,
    minStock: body.minStock ?? doc.min_stock,
  });
  const brand = body.brand !== undefined ? await ensureBrand(body.brand) : doc.brand;

  await updateDoc(DOCTYPE, id, {
    ...name,
    ...(name.proposed_name ? { description: name.proposed_name } : {}),
    ...sap.fields,
    plant: storeForCompany(sap.abbr)?.label || doc.plant || "",
    proposed_category: sap.fields.sap_item_group,
    proposed_sub_category: sap.fields.sap_sub_type_a,
    uom: resolveUom(sap.fields.sap_uom).uom,
    brand,
  });
  return getRequest(id);
};

/**
 * Approve / Reject (the VP Operations) or Reopen (the Maintenance Manager).
 *
 * Approving does not create anything here: it queues the item for the SAP
 * server, which creates it in SAP and then in ERPNext, with SAP's code. The
 * transition comes last, so a failure before it leaves the request where it was.
 */
export const decide = async (id, action, { note = "", user } = {}) => {
  const role = user?.role;
  if ((action === "Approve" || action === "Reject") && role !== "VP Operations") {
    throw forbidden("Only the VP Operations approves or rejects new items.");
  }
  if (action === "Reopen" && role !== "Maintenance Manager") {
    throw forbidden("Only the Maintenance Manager sends a rejected item for approval again.");
  }

  const doc = await getDoc(DOCTYPE, id);

  if (action === "Approve") {
    if (doc.workflow_state !== "Awaiting Approval") {
      throw badRequest(`This request is ${doc.workflow_state}, so there is nothing to approve`);
    }
    if (!doc.sap_company || !doc.sap_item_group) {
      throw badRequest("This request was raised before items were made in SAP, so it has no SAP company or item group. Reject it and raise it again from the form.");
    }
    await updateDoc(DOCTYPE, id, {
      decided_by: user?.email || "",
      decided_at: now(),
      decision_note: note,
      sap_create_status: "Queued",
      sap_create_error: "",
    });
  } else {
    await updateDoc(DOCTYPE, id, {
      decided_by: user?.email || "",
      decided_at: now(),
      decision_note: note,
      ...(action === "Reopen" ? { sap_create_status: "", sap_create_error: "" } : {}),
    });
  }

  const fresh = await getDoc(DOCTYPE, id);
  await callMethod("frappe.model.workflow.apply_workflow", { doc: fresh, action });
  if (action === "Approve") await raiseSapFlag(user?.email);
  return getRequest(id);
};

/** Sends an approved request whose SAP creation failed to the SAP server again. */
export const retrySapCreation = async (id, { user } = {}) => {
  if (user?.role !== "Maintenance Manager") throw forbidden("Only the Maintenance Manager sends an item to SAP again.");
  const doc = await getDoc(DOCTYPE, id);
  if (doc.workflow_state !== "Approved" || doc.sap_create_status !== "Failed") {
    throw badRequest("Only an approved request whose SAP creation failed can be sent again.");
  }
  await updateDoc(DOCTYPE, id, { sap_create_status: "Queued", sap_create_error: "" });
  await raiseSapFlag(user?.email);
  return getRequest(id);
};

/**
 * Records a SAP code typed in by hand (Manager). Kept as a fallback for an
 * item that was created in SAP some other way; the normal path is automatic.
 */
export const recordSapCode = async (id, { sapItemCode, response = "", user } = {}) => {
  const code = String(sapItemCode || "").trim();
  if (!code) throw badRequest("The SAP item code is required");

  const doc = await getDoc(DOCTYPE, id);
  if (doc.workflow_state !== "Approved") {
    throw badRequest(`This request is ${doc.workflow_state}, so it is not ready for SAP`);
  }
  if (!doc.erp_item) throw badRequest("This request has no catalog item behind it");

  await updateDoc(DOCTYPE, id, {
    sap_item_code: code,
    pushed_by: user?.email || "",
    pushed_at: now(),
    sap_response: response.slice(0, 500),
  });
  await updateDoc("Item", doc.erp_item, { custom_sap_item_code: code });

  const fresh = await getDoc(DOCTYPE, id);
  await callMethod("frappe.model.workflow.apply_workflow", { doc: fresh, action: "Mark In SAP" });
  return getRequest(id);
};
