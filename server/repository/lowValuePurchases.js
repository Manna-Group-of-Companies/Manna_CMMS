import { createDoc, getDoc, listChildRows, listDocs, updateDoc } from "../integrations/erpnext/client.js";
import { erpNow, erpToday } from "../integrations/erpnext/time.js";
import {
  LOW_VALUE_DOCTYPE as DOCTYPE,
  LOW_VALUE_LINE_DOCTYPE as LINE,
  LOW_VALUE_STATUSES,
} from "../integrations/erpnext/lowValuePurchaseDoctype.js";
import { MAINTENANCE_MANAGER, MANAGER, PURCHASE_MANAGER } from "../config/access.js";

/**
 * Low value purchase requests (20 Oct 2026). See lowValuePurchaseDoctype.js.
 *
 * Any manager or plant head asks; the purchase manager buys it or turns it
 * down; whoever asked, or the purchase manager, records it received. Nothing
 * goes to SAP.
 *
 * The rules are pure functions (`check*`, `allowedSteps`) so they are tested
 * without ERPNext - tests/purchasing.test.js. The rest reads and writes.
 */

const FIELDS = [
  "name", "plant", "department", "status", "urgency", "required_by", "purpose", "raised_by", "raised_at",
  "est_total", "vendor_name", "vendor_contact", "expected_on", "order_remarks", "ordered_by", "ordered_at",
  "total", "bill_no", "bill_date", "receive_remarks", "received_by", "received_at", "closed_reason",
  "closed_by", "closed_at", "modified",
];
const LINE_FIELDS = [
  "parent", "name", "idx", "description", "specification", "qty", "uom", "est_rate", "est_amount", "rate",
  "amount", "remarks",
];

/** The units offered on the form; anything else short may be typed. */
export const LOW_VALUE_UNITS = ["Nos", "Set", "Pair", "Box", "Packet", "Kg", "Meter", "Litre", "Roll", "Unit"];
export const MAX_LINES = 30;
const TEXT_MAX = 140;
const PURPOSE_MAX = 500;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Who buys: the purchase manager, and the Admin as the usual fallback. */
const BUYERS = [PURCHASE_MANAGER, MANAGER];

const tidy = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const money = (value) => Math.round(Number(value || 0) * 100) / 100;
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const forbidden = (message) => Object.assign(new Error(message), { status: 403 });
const notFound = (message) => Object.assign(new Error(message), { status: 404 });

/* ------------------------------------------------------------------ rules */

/**
 * The steps this person may take on this request now.
 *
 * @param doc    the record (ERPNext field names)
 * @param user   { email, role }
 * @param scope  from scopeFor - a plant head's plants, or unscoped
 */
export const allowedSteps = (doc, user = {}, scope = {}) => {
  const buyer = BUYERS.includes(user.role);
  const mine = Boolean(user.email) && doc.raised_by === user.email;
  const ownPlant = !scope?.scoped || (scope.plants || []).includes(doc.plant);
  return {
    order: buyer && doc.status === "Requested",
    reject: buyer && doc.status === "Requested",
    withdraw: doc.status === "Requested" && (mine || user.role === MANAGER),
    // Whoever asked, the buyer, maintenance, or the plant's own head: the
    // people who would actually see it arrive.
    receive:
      doc.status === "Ordered" &&
      (buyer || mine || user.role === MAINTENANCE_MANAGER || (scope?.scoped && ownPlant)),
  };
};

/**
 * A new request, checked. Gives back the fields to write.
 *
 * @param body  { plant, department, urgency, requiredBy, purpose,
 *                lines: [{ description, specification, qty, unit, estRate, remarks }] }
 * @param plants the plants this person may raise for (null: any)
 */
export const checkRaise = (body = {}, plants = null, today = erpToday()) => {
  const plant = tidy(body.plant);
  if (!plant) throw badRequest("Choose the plant it is for.");
  if (Array.isArray(plants) && !plants.includes(plant)) throw forbidden("That plant is not yours to buy for.");
  const department = tidy(body.department);
  if (department.length > 60) throw badRequest("The department can be at most 60 characters.");
  const urgency = tidy(body.urgency) || "Normal";
  if (!["Normal", "Urgent"].includes(urgency)) throw badRequest("Urgency is Normal or Urgent.");
  const requiredBy = tidy(body.requiredBy);
  if (!DAY.test(requiredBy)) throw badRequest("Say by when it is needed.");
  if (requiredBy < today) throw badRequest("The required-by date cannot be in the past.");
  const purpose = tidy(body.purpose);
  if (!purpose) throw badRequest("Say what it is for.");
  if (purpose.length > PURPOSE_MAX) throw badRequest(`The purpose can be at most ${PURPOSE_MAX} characters.`);

  const wanted = Array.isArray(body.lines) ? body.lines : [];
  if (!wanted.length) throw badRequest("Add at least one item.");
  if (wanted.length > MAX_LINES) throw badRequest(`At most ${MAX_LINES} items on one request.`);
  const lines = wanted.map((w, i) => {
    const n = `Item ${i + 1}`;
    const description = tidy(w?.description);
    if (!description) throw badRequest(`${n}: say what is needed.`);
    const specification = tidy(w.specification);
    const remarks = tidy(w.remarks);
    for (const [value, label] of [[description, "description"], [specification, "specification"], [remarks, "remarks"]]) {
      if (value.length > TEXT_MAX) throw badRequest(`${n}: the ${label} can be at most ${TEXT_MAX} characters.`);
    }
    const qty = Number(w.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw badRequest(`${n}: the quantity must be more than zero.`);
    const uom = tidy(w.unit);
    if (!uom) throw badRequest(`${n}: give the unit.`);
    if (uom.length > 20) throw badRequest(`${n}: the unit can be at most 20 characters.`);
    const estRate = w.estRate === undefined || w.estRate === null || w.estRate === "" ? 0 : Number(w.estRate);
    if (!Number.isFinite(estRate) || estRate < 0) throw badRequest(`${n}: the estimated rate cannot be negative.`);
    return {
      doctype: LINE,
      description,
      specification,
      qty,
      uom,
      est_rate: money(estRate),
      est_amount: money(qty * estRate),
      remarks,
    };
  });

  return {
    plant,
    department,
    urgency,
    required_by: requiredBy,
    purpose,
    status: "Requested",
    est_total: money(lines.reduce((sum, l) => sum + l.est_amount, 0)),
    lines,
  };
};

/**
 * The purchase manager buys it: the vendor and the rate actually paid per line.
 *
 * @param body { vendorName, vendorContact, expectedOn, remarks, lines: [{ idx, rate }] }
 */
export const checkOrder = (doc, body = {}, today = erpToday()) => {
  if (doc.status !== "Requested") throw badRequest(`This request is ${doc.status}; only a requested one can be ordered.`);
  const vendorName = tidy(body.vendorName);
  if (!vendorName) throw badRequest("Say who it is bought from.");
  if (vendorName.length > TEXT_MAX) throw badRequest(`The vendor can be at most ${TEXT_MAX} characters.`);
  const vendorContact = tidy(body.vendorContact);
  if (vendorContact.length > 60) throw badRequest("The vendor contact can be at most 60 characters.");
  const expectedOn = tidy(body.expectedOn);
  if (expectedOn && !DAY.test(expectedOn)) throw badRequest("The expected date is not a date.");
  if (expectedOn && expectedOn < today) throw badRequest("The expected date cannot be in the past.");
  const remarks = tidy(body.remarks);
  if (remarks.length > PURPOSE_MAX) throw badRequest(`The remarks can be at most ${PURPOSE_MAX} characters.`);

  const rates = new Map((Array.isArray(body.lines) ? body.lines : []).map((w) => [Number(w?.idx), w?.rate]));
  const lines = (doc.lines || []).map((line) => {
    const given = rates.get(Number(line.idx));
    // Left blank, the estimate stands - most low value buys cost what was guessed.
    const rate = given === undefined || given === null || given === "" ? Number(line.est_rate || 0) : Number(given);
    if (!Number.isFinite(rate) || rate <= 0) throw badRequest(`Give the rate paid for ${line.description}.`);
    return { ...line, rate: money(rate), amount: money(Number(line.qty || 0) * rate) };
  });

  return {
    status: "Ordered",
    vendor_name: vendorName,
    vendor_contact: vendorContact,
    expected_on: expectedOn || null,
    order_remarks: remarks,
    total: money(lines.reduce((sum, l) => sum + l.amount, 0)),
    lines,
  };
};

/** It arrived. @param body { billNo, billDate, remarks } */
export const checkReceive = (doc, body = {}, today = erpToday()) => {
  if (doc.status !== "Ordered") throw badRequest(`This request is ${doc.status}; only an ordered one can be received.`);
  const billNo = tidy(body.billNo);
  if (billNo.length > 60) throw badRequest("The bill number can be at most 60 characters.");
  const billDate = tidy(body.billDate);
  if (billDate && !DAY.test(billDate)) throw badRequest("The bill date is not a date.");
  if (billDate && billDate > today) throw badRequest("The bill date cannot be in the future.");
  const remarks = tidy(body.remarks);
  if (remarks.length > PURPOSE_MAX) throw badRequest(`The remarks can be at most ${PURPOSE_MAX} characters.`);
  return { status: "Received", bill_no: billNo, bill_date: billDate || null, receive_remarks: remarks };
};

/** Rejected or withdrawn, with the reason. */
export const checkClose = (doc, to, body = {}) => {
  if (doc.status !== "Requested") throw badRequest(`This request is ${doc.status}; it can no longer be ${to.toLowerCase()}.`);
  const reason = tidy(body.reason);
  if (!reason) throw badRequest("Say why.");
  if (reason.length > PURPOSE_MAX) throw badRequest(`The reason can be at most ${PURPOSE_MAX} characters.`);
  return { status: to, closed_reason: reason };
};

/* ------------------------------------------------------------------ shape */

const WAITING_ON = {
  Requested: "The purchase manager to buy it",
  Ordered: "Delivery",
  Received: "",
  Rejected: "",
  Withdrawn: "",
};

const toLine = (row) => ({
  idx: Number(row.idx || 0),
  description: row.description || "",
  specification: row.specification || "",
  qty: Number(row.qty || 0),
  unit: row.uom || "",
  estRate: Number(row.est_rate || 0),
  estAmount: Number(row.est_amount || 0),
  rate: Number(row.rate || 0),
  amount: Number(row.amount || 0),
  remarks: row.remarks || "",
});

const toRequest = (row, lines, user, scope) => ({
  id: row.name,
  plant: row.plant,
  department: row.department || "",
  status: row.status || "Requested",
  waitingOn: WAITING_ON[row.status] ?? "",
  urgency: row.urgency || "Normal",
  requiredBy: row.required_by || null,
  purpose: row.purpose || "",
  raisedBy: row.raised_by || "",
  raisedAt: row.raised_at || null,
  estTotal: Number(row.est_total || 0),
  total: Number(row.total || 0),
  lines: lines.map(toLine),
  order: row.ordered_at
    ? {
        vendorName: row.vendor_name || "",
        vendorContact: row.vendor_contact || "",
        expectedOn: row.expected_on || null,
        remarks: row.order_remarks || "",
        by: row.ordered_by || "",
        at: row.ordered_at,
      }
    : null,
  received: row.received_at
    ? {
        billNo: row.bill_no || "",
        billDate: row.bill_date || null,
        remarks: row.receive_remarks || "",
        by: row.received_by || "",
        at: row.received_at,
      }
    : null,
  closed: row.closed_at
    ? { reason: row.closed_reason || "", by: row.closed_by || "", at: row.closed_at }
    : null,
  may: allowedSteps(row, user, scope),
  updatedAt: row.modified,
});

/* ------------------------------------------------------------------ reads and writes */

const loadDoc = async (id) => {
  const doc = await getDoc(DOCTYPE, id).catch((error) => {
    if (error?.status === 404) return null;
    throw error;
  });
  if (!doc) throw notFound("Low value purchase request not found");
  return doc;
};

/** Newest first, each with its lines. A plant head's own plants only. */
export const listLowValue = async ({ status = "", plant = "", limit = 100, user, scope } = {}) => {
  const filters = [];
  if (status) filters.push([DOCTYPE, "status", "=", status]);
  if (plant) filters.push([DOCTYPE, "plant", "=", plant]);
  if (scope?.scoped) filters.push([DOCTYPE, "plant", "in", scope.plants.length ? scope.plants : ["__none__"]]);
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
      limit: 3000,
      orderBy: "idx asc",
    });
    for (const l of lines) {
      if (!byParent.has(l.parent)) byParent.set(l.parent, []);
      byParent.get(l.parent).push(l);
    }
  }
  return rows.map((r) => toRequest(r, byParent.get(r.name) || [], user, scope));
};

/** One request, or 404 - also for another plant's, which is missing to a plant head. */
export const getLowValue = async (id, user, scope) => {
  const doc = await loadDoc(id);
  if (scope?.scoped && !scope.plants.includes(doc.plant)) throw notFound("Low value purchase request not found");
  return toRequest(doc, doc.lines || [], user, scope);
};

export const raiseLowValue = async (body, user, scope) => {
  const fields = checkRaise(body, scope?.scoped ? scope.plants : null);
  const created = await createDoc(DOCTYPE, {
    doctype: DOCTYPE,
    ...fields,
    raised_by: user?.email || "",
    raised_at: erpNow(),
  });
  return getLowValue(created.name, user, scope);
};

/** The whole table, as Frappe replaces a child table it is given. */
const linesOut = (lines) =>
  lines.map((l) => ({
    name: l.name,
    description: l.description,
    specification: l.specification,
    qty: l.qty,
    uom: l.uom,
    est_rate: l.est_rate,
    est_amount: l.est_amount,
    rate: l.rate,
    amount: l.amount,
    remarks: l.remarks,
  }));

const STEPS = {
  order: (doc, body) => {
    const edits = checkOrder(doc, body);
    return { ...edits, lines: linesOut(edits.lines) };
  },
  receive: (doc, body) => checkReceive(doc, body),
  reject: (doc, body) => checkClose(doc, "Rejected", body),
  withdraw: (doc, body) => checkClose(doc, "Withdrawn", body),
};

const STAMPS = {
  order: (email) => ({ ordered_by: email, ordered_at: erpNow() }),
  receive: (email) => ({ received_by: email, received_at: erpNow() }),
  reject: (email) => ({ closed_by: email, closed_at: erpNow() }),
  withdraw: (email) => ({ closed_by: email, closed_at: erpNow() }),
};

/** Takes one step - order, receive, reject or withdraw - if this person may. */
export const stepLowValue = async (id, step, body, user, scope) => {
  if (!STEPS[step]) throw notFound(`"${step}" is not a step a low value purchase request has`);
  const doc = await loadDoc(id);
  if (scope?.scoped && !scope.plants.includes(doc.plant)) throw notFound("Low value purchase request not found");
  // The status first, so a step that has already been taken says so rather than "not allowed".
  const edits = STEPS[step](doc, body || {});
  if (!allowedSteps(doc, user, scope)[step]) throw forbidden(`A ${user?.role || "signed-out user"} may not take that step.`);
  await updateDoc(DOCTYPE, id, { ...edits, ...STAMPS[step](user?.email || "") });
  return getLowValue(id, user, scope);
};

/** What the raise form offers. */
export const lowValueOptions = () => ({ units: LOW_VALUE_UNITS, statuses: LOW_VALUE_STATUSES, maxLines: MAX_LINES });
