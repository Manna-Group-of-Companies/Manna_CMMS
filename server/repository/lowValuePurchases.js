import { createDoc, getDoc, listDocs, updateDoc } from "../integrations/erpnext/client.js";
import { erpNow, erpToday } from "../integrations/erpnext/time.js";
import {
  APPROVAL_STATUSES,
  DONE_STATUSES,
  LOW_VALUE_DOCTYPE as DOCTYPE,
  PRIORITIES,
  PURCHASE_STATUSES,
  REQUEST_TYPES,
  SHEET_COMPANIES,
  sheetCompaniesFor,
} from "../integrations/erpnext/lowValuePurchaseDoctype.js";
import { attach, attachmentCounts, detach, listAttachments } from "./attachments.js";
import {
  HIGHER_MANAGEMENT,
  MANAGER,
  PURCHASE_MANAGER,
  VP_OPERATIONS,
} from "../config/access.js";

/**
 * The Purchase Request Sheet (20 Oct 2026). See lowValuePurchaseDoctype.js.
 *
 * Everybody with the screen sees every company's rows - it replaces a sheet
 * they all shared - and adds rows; except a plant head, who sees and adds their
 * own company's only (20 Oct 2026). What each person may then change:
 *
 *   - whoever raised a row: what they asked for, while it is still Pending;
 *   - the purchase manager and the Admin: every column;
 *   - the board and operations: the approval;
 *   - the remarks: anybody who may change anything else on the row.
 *
 * The rules are pure (`editableFields`, `checkNew`, `checkEdit`) so they are
 * tested without ERPNext - tests/purchasing.test.js.
 */

const FIELDS = [
  "name", "request_date", "request_type", "company", "raised_by_name", "description", "purpose", "links",
  "priority", "approval_status", "purchase_status", "expected_on", "received_on", "remarks", "raised_by",
  "raised_at", "updated_by", "updated_at", "modified",
];

/** The columns, as the API names them, with their ERPNext field and kind. */
const COLUMNS = {
  date: { field: "request_date", kind: "date" },
  type: { field: "request_type", kind: "pick", from: REQUEST_TYPES },
  company: { field: "company", kind: "pick", from: SHEET_COMPANIES },
  raisedByName: { field: "raised_by_name", kind: "text", max: 60 },
  description: { field: "description", kind: "text", max: 1000, required: true },
  purpose: { field: "purpose", kind: "text", max: 1000 },
  links: { field: "links", kind: "text", max: 1000 },
  priority: { field: "priority", kind: "pick", from: PRIORITIES },
  approvalStatus: { field: "approval_status", kind: "pick", from: APPROVAL_STATUSES },
  purchaseStatus: { field: "purchase_status", kind: "pick", from: PURCHASE_STATUSES },
  expectedOn: { field: "expected_on", kind: "date", empty: true },
  receivedOn: { field: "received_on", kind: "date", empty: true },
  remarks: { field: "remarks", kind: "text", max: 1000 },
};

/** What the person who raised a row asked for - theirs to correct until it is decided. */
const REQUEST_COLUMNS = ["date", "type", "company", "raisedByName", "description", "purpose", "links", "priority"];
const BUYERS = [PURCHASE_MANAGER, MANAGER];
const APPROVERS = [PURCHASE_MANAGER, MANAGER, HIGHER_MANAGEMENT, VP_OPERATIONS];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const tidy = (value) => String(value ?? "").trim().replace(/[ \t]+/g, " ");
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const forbidden = (message) => Object.assign(new Error(message), { status: 403 });
const notFound = (message) => Object.assign(new Error(message), { status: 404 });

/* ------------------------------------------------------------------ rules */

/**
 * The columns this person may change on this row.
 *
 * @param row   the record (ERPNext field names)
 * @param user  { email, role }
 */
export const editableFields = (row, user = {}) => {
  if (BUYERS.includes(user.role)) return Object.keys(COLUMNS);
  const out = new Set();
  const mine = Boolean(user.email) && row.raised_by === user.email;
  if (mine && (row.approval_status || "Pending") === "Pending") REQUEST_COLUMNS.forEach((c) => out.add(c));
  if (APPROVERS.includes(user.role)) out.add("approvalStatus");
  if (mine || out.size) out.add("remarks");
  return [...out];
};

/** One column's value, checked; what to write to ERPNext. */
const cleanValue = (column, value) => {
  const spec = COLUMNS[column];
  if (spec.kind === "pick") {
    const picked = spec.from.find((v) => v.toLowerCase() === tidy(value).toLowerCase());
    if (!picked) throw badRequest(`"${tidy(value)}" is not one of the choices for this column.`);
    return picked;
  }
  if (spec.kind === "date") {
    const day = tidy(value);
    if (!day && spec.empty) return null;
    if (!DAY.test(day)) throw badRequest("That is not a date.");
    return day;
  }
  // Text keeps its line breaks - descriptions are often a list, one item a line.
  const text = String(value ?? "").trim();
  if (spec.required && !text) throw badRequest("Say what is needed.");
  if (text.length > spec.max) throw badRequest(`At most ${spec.max} characters.`);
  return text;
};

/**
 * A new row, checked. Gives back the ERPNext fields to write.
 *
 * @param body { date, type, company, raisedByName, description, purpose, links, priority }
 */
export const checkNew = (body = {}, { fullName = "", today = erpToday(), companies = null } = {}) => {
  const fields = {
    request_date: tidy(body.date) ? cleanValue("date", body.date) : today,
    request_type: cleanValue("type", body.type || "Purchase Request"),
    company: tidy(body.company) ? cleanValue("company", body.company) : null,
    raised_by_name: cleanValue("raisedByName", body.raisedByName || fullName),
    description: cleanValue("description", body.description),
    purpose: cleanValue("purpose", body.purpose),
    links: cleanValue("links", body.links),
    priority: cleanValue("priority", body.priority || "High"),
    approval_status: "Pending",
    purchase_status: "Not Ordered",
  };
  if (!fields.company) throw badRequest("Choose the company it is for.");
  if (companies && !companies.includes(fields.company)) throw forbidden("That company is not yours to ask for.");
  if (fields.request_date > today) throw badRequest("The date cannot be in the future.");
  return fields;
};

/**
 * Changes to a row, checked against what this person may change.
 *
 * @param body { <column>: value, ... } - only the columns being changed
 */
export const checkEdit = (row, body = {}, user = {}, companies = null) => {
  const allowed = editableFields(row, user);
  const edits = {};
  for (const [column, value] of Object.entries(body || {})) {
    if (!COLUMNS[column]) throw badRequest(`"${column}" is not a column of the sheet.`);
    if (!allowed.includes(column)) throw forbidden("You may not change that column on this row.");
    if (column === "company" && companies && !companies.includes(cleanValue(column, value))) {
      throw forbidden("That company is not yours to ask for.");
    }
    edits[COLUMNS[column].field] = cleanValue(column, value);
  }
  if (!Object.keys(edits).length) throw badRequest("Nothing to change.");
  // Marking it received fills the date the sheet asks for, if nobody typed one.
  if (DONE_STATUSES.includes(edits.purchase_status) && !row.received_on && !("received_on" in edits)) {
    edits.received_on = erpToday();
  }
  return edits;
};

/* ------------------------------------------------------------------ shape */

const toRow = (row, user, files = 0) => ({
  id: row.name,
  date: row.request_date || null,
  type: row.request_type || "Purchase Request",
  company: row.company || "",
  raisedByName: row.raised_by_name || "",
  description: row.description || "",
  purpose: row.purpose || "",
  links: row.links || "",
  priority: row.priority || "",
  approvalStatus: row.approval_status || "Pending",
  purchaseStatus: row.purchase_status || "Not Ordered",
  expectedOn: row.expected_on || null,
  receivedOn: row.received_on || null,
  remarks: row.remarks || "",
  done: DONE_STATUSES.includes(row.purchase_status),
  raisedBy: row.raised_by || "",
  raisedAt: row.raised_at || null,
  updatedBy: row.updated_by || "",
  updatedAt: row.updated_at || row.modified || null,
  files,
  editable: editableFields(row, user),
});

/* ------------------------------------------------------------------ reads and writes */

/** One row - and for a plant head, missing unless it is their company's. */
const loadRow = async (id, scope) => {
  const doc = await getDoc(DOCTYPE, id).catch((error) => {
    if (error?.status === 404) return null;
    throw error;
  });
  const companies = sheetCompaniesFor(scope);
  if (!doc || (companies && !companies.includes(doc.company))) throw notFound("That request is not on the sheet");
  return doc;
};

/** The sheet, newest first. Filters are optional; every company is visible. */
export const listSheet = async ({ company = "", approval = "", purchase = "", type = "", open = false, limit = 500, user, scope } = {}) => {
  const filters = [];
  const companies = sheetCompaniesFor(scope);
  if (companies) filters.push([DOCTYPE, "company", "in", companies.length ? companies : ["__none__"]]);
  if (company) filters.push([DOCTYPE, "company", "=", company]);
  if (approval) filters.push([DOCTYPE, "approval_status", "=", approval]);
  if (purchase) filters.push([DOCTYPE, "purchase_status", "=", purchase]);
  if (type) filters.push([DOCTYPE, "request_type", "=", type]);
  if (open) filters.push([DOCTYPE, "purchase_status", "not in", DONE_STATUSES]);
  const rows = await listDocs(DOCTYPE, {
    fields: FIELDS,
    filters: filters.length ? filters : undefined,
    orderBy: "request_date desc, creation desc",
    limit,
  });
  const counts = await attachmentCounts(DOCTYPE, rows.map((r) => r.name)).catch(() => new Map());
  return rows.map((r) => toRow(r, user, counts.get(r.name) || 0));
};

export const getEntry = async (id, user, scope) => {
  const doc = await loadRow(id, scope);
  return { ...toRow(doc, user), images: await listAttachments(DOCTYPE, id) };
};

export const addEntry = async (body, user, scope) => {
  const profile = await getDoc("User", user?.email || "").catch(() => null);
  const fields = checkNew(body, {
    fullName: profile?.full_name || profile?.first_name || "",
    companies: sheetCompaniesFor(scope),
  });
  const now = erpNow();
  const created = await createDoc(DOCTYPE, {
    doctype: DOCTYPE,
    ...fields,
    raised_by: user?.email || "",
    raised_at: now,
    updated_by: user?.email || "",
    updated_at: now,
  });
  return getEntry(created.name, user, scope);
};

export const editEntry = async (id, body, user, scope) => {
  const doc = await loadRow(id, scope);
  const edits = checkEdit(doc, body, user, sheetCompaniesFor(scope));
  await updateDoc(DOCTYPE, id, { ...edits, updated_by: user?.email || "", updated_at: erpNow() });
  return getEntry(id, user, scope);
};

/** An image of the item - the sheet's "Image samples" column. Whoever may edit the row. */
export const addImage = async (id, file, user, scope) => {
  const doc = await loadRow(id, scope);
  if (!editableFields(doc, user).length) throw forbidden("You may not add to this row.");
  return attach(DOCTYPE, id, file);
};

export const removeImage = async (id, fileId, user, scope) => {
  const doc = await loadRow(id, scope);
  if (!editableFields(doc, user).length) throw forbidden("You may not change this row.");
  return detach(DOCTYPE, id, fileId);
};

/** The dropdowns, for the screens - a plant head is offered only their own company. */
export const sheetOptions = (scope) => ({
  types: REQUEST_TYPES,
  companies: sheetCompaniesFor(scope) || SHEET_COMPANIES,
  priorities: PRIORITIES,
  approvalStatuses: APPROVAL_STATUSES,
  purchaseStatuses: PURCHASE_STATUSES,
  doneStatuses: DONE_STATUSES,
});
