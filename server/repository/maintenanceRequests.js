import {
  callMethod,
  createDoc,
  getDoc,
  listDocs,
  updateDoc,
} from "../integrations/erpnext/client.js";
import {
  REQUEST_STAGES,
  mayTakeRequestStep,
  missingForRequest,
  nextRequestActionFor,
} from "../integrations/erpnext/maintenanceRequestStages.js";
import { erpNow } from "../integrations/erpnext/time.js";
import { attach, detach, listAttachments } from "./attachments.js";

/**
 * Maintenance requests — the planned work.
 *
 * Everything the plant asks maintenance for that is not a machine standing
 * still: fabrication, a preventive job, a scheduled routine, an improvement.
 * Kept apart from breakdowns because mixing them made the reliability figures
 * meaningless and made the planned jobs answer for a root cause they do not
 * have. See maintenanceRequestDoctypes.js for the full argument.
 *
 * Lives entirely in ERPNext, like the rest of Module 2. There is no MongoDB
 * behind any of this.
 *
 * The stage a request is in is moved by a workflow action, never by writing
 * `workflow_state` — ERPNext refuses a state written directly, and that refusal
 * is what stops a request appearing as Completed with nothing recorded on it.
 */

const REQUEST_FIELDS = [
  "name",
  "title",
  "request_type",
  "machine",
  "machine_name",
  "plant",
  "area",
  "workflow_state",
  "priority",
  "needed_by",
  "production_affected",
  "what_is_needed",
  "requested_by",
  "requested_at",
  "assigned_to",
  "target_date",
  "started_at",
  "completed_at",
  "closed_at",
  "labour_hours",
  "modified",
];

/** What each stage is waiting for, in the words the screen shows. */
const WAITING_ON = {
  Requested: "Maintenance to take it on",
  "In Progress": "Maintenance to finish",
  Completed: "The requester to close it",
  Closed: "",
  Cancelled: "",
};

/**
 * How a queue is ordered.
 *
 * ERPNext would sort a Select alphabetically, which puts High, Low, Medium in
 * that order and quietly ranks the least urgent second. Sorted here instead.
 */
const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2, "": 3 };

/** Hours between two ERPNext datetimes, or null when one is missing. */
const hoursBetween = (from, to) => {
  if (!from || !to) return null;
  const a = new Date(String(from).replace(" ", "T"));
  const b = new Date(String(to).replace(" ", "T"));
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const h = (b - a) / 3_600_000;
  return h < 0 ? null : Math.round(h * 10) / 10;
};

/** Days since a date, for "how long has this been sitting there". */
const daysSince = (value) => {
  if (!value) return null;
  const a = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(a.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - a.getTime()) / 86_400_000));
};

const toSummary = (row) => ({
  id: row.name,
  title: row.title,
  requestType: row.request_type || "",
  machine: row.machine || "",
  machineName: row.machine_name || row.machine || "",
  plant: row.plant,
  area: row.area || "",
  state: row.workflow_state,
  waitingOn: WAITING_ON[row.workflow_state] ?? "",
  priority: row.priority || "",
  neededBy: row.needed_by || null,
  productionAffected: Boolean(row.production_affected),
  whatIsNeeded: row.what_is_needed || "",
  requestedBy: row.requested_by,
  requestedAt: row.requested_at || null,
  assignedTo: row.assigned_to || "",
  targetDate: row.target_date || null,
  startedAt: row.started_at || null,
  completedAt: row.completed_at || null,
  closedAt: row.closed_at || null,
  labourHours: Number(row.labour_hours || 0),
  // How long it has been waiting, which is the question a queue is read to
  // answer. Shown rather than stored, so it cannot go stale.
  ageDays: daysSince(row.requested_at),
  // Only meaningful once the work is done; null while it is still open, so an
  // unfinished job cannot be averaged in as though it took no time.
  turnaroundHours: hoursBetween(row.requested_at, row.completed_at),
  workHours: hoursBetween(row.started_at, row.completed_at),
  updatedAt: row.modified,
});

/**
 * The queue, most urgent first.
 *
 * Ordered by priority and then by age rather than by date alone: the point of
 * this list is that the planned work gets picked up between the breakdowns, and
 * a list in date order tells nobody which of them to pick up first.
 */
export const listRequests = async ({
  plant = "",
  state = "",
  type = "",
  open = false,
  mine = "",
  limit = 200,
  onlyPlants = null,
} = {}) => {
  const filters = [];
  if (plant) filters.push(["CMMS Maintenance Request", "plant", "=", plant]);
  // A production manager sees their own site and no other. Applied even when
  // they also passed a `plant` filter, so narrowing cannot be used to widen.
  if (Array.isArray(onlyPlants)) {
    filters.push([
      "CMMS Maintenance Request",
      "plant",
      "in",
      onlyPlants.length ? onlyPlants : ["__none__"],
    ]);
  }
  if (state) filters.push(["CMMS Maintenance Request", "workflow_state", "=", state]);
  if (type) filters.push(["CMMS Maintenance Request", "request_type", "=", type]);
  if (mine) filters.push(["CMMS Maintenance Request", "requested_by", "=", mine]);
  if (open) {
    filters.push(["CMMS Maintenance Request", "workflow_state", "not in", ["Closed", "Cancelled"]]);
  }

  const rows = await listDocs("CMMS Maintenance Request", {
    fields: REQUEST_FIELDS,
    filters: filters.length ? filters : undefined,
    orderBy: "requested_at desc",
    limit,
  });

  return rows.map(toSummary).sort((a, b) => {
    const settled = (r) => (["Closed", "Cancelled"].includes(r.state) ? 1 : 0);
    // Finished work sinks below live work whatever its priority: a closed
    // High from March is not the next thing anybody should pick up.
    if (settled(a) !== settled(b)) return settled(a) - settled(b);
    const rank = (p) => PRIORITY_RANK[p] ?? 3;
    if (rank(a.priority) !== rank(b.priority)) return rank(a.priority) - rank(b.priority);
    return (b.ageDays || 0) - (a.ageDays || 0);
  });
};

/** One request in full, including its materials and its crew. */
export const getRequest = async (id) => {
  const doc = await getDoc("CMMS Maintenance Request", id).catch((error) => {
    if (error?.status === 404) return null;
    throw error;
  });
  if (!doc) return null;

  const nextAction = nextRequestActionFor(doc.workflow_state);

  return {
    ...toSummary(doc),
    whyNeeded: doc.why_needed || "",
    planNotes: doc.plan_notes || "",
    acceptedBy: doc.accepted_by || "",
    workDone: doc.work_done || "",
    completedBy: doc.completed_by || "",
    closingRemarks: doc.closing_remarks || "",
    satisfied: Boolean(doc.satisfied),
    closedBy: doc.closed_by || "",
    cancelReason: doc.cancel_reason || "",
    cancelledBy: doc.cancelled_by || "",
    files: await listAttachments("CMMS Maintenance Request", id),
    logSheetVerified: Boolean(doc.log_sheet_verified),
    logSheetVerifiedBy: doc.log_sheet_verified_by || "",
    logSheetVerifiedAt: doc.log_sheet_verified_at || null,
    materials: (doc.materials_used || []).map((m) => ({
      itemCode: m.item_code || "",
      description: m.description,
      qty: Number(m.qty || 0),
      uom: m.uom || "",
      remarks: m.remarks || "",
    })),
    workedBy: (doc.worked_by || []).map((w) => ({
      name: w.worker_name,
      user: w.worker || "",
      role: w.role_on_job || "",
      hours: Number(w.hours || 0),
    })),
    // What the next step is and what it still wants, so the screen can say so
    // before somebody fills a form in and is refused at the end of it.
    nextAction,
    missing: missingForRequest(nextAction, doc),
  };
};

/**
 * Raises a request.
 *
 * More is asked here than when reporting a breakdown, and deliberately so. A
 * breakdown is reported by somebody standing in front of a stopped machine who
 * does not yet know anything; a request is written at a desk by somebody who
 * has decided they want something. The type and the reason are knowable at that
 * moment, and they are what let the work be scheduled at all.
 */
export const raiseRequest = async ({
  title,
  requestType,
  machine = "",
  plant,
  area = "",
  whatIsNeeded,
  whyNeeded = "",
  priority = "Medium",
  neededBy = "",
  productionAffected = false,
  requestedBy,
}) => {
  if (!String(title || "").trim()) throw new Error("Give the request a title");
  /**
   * The type of work is not asked for any more.
   *
   * The form dropped the field, so refusing a request without one would refuse
   * every request. It cannot simply be left empty either: `request_type` is
   * still `reqd` on the live DocType, and ERPNext answers "Value missing for
   * Type of Work" - the repo's own definition disagrees with the instance on
   * that, which only a real save reveals.
   *
   * So it defaults to "Other" and the office sets the real type when they pick
   * the job up. That is where the judgement belongs anyway: the person raising
   * a request was guessing at the category, and a guess recorded as fact is
   * worse than an honest "Other".
   */
  if (!String(whatIsNeeded || "").trim()) throw new Error("Say what is needed");
  if (!plant) throw new Error("A plant is required");

  const created = await createDoc("CMMS Maintenance Request", {
    doctype: "CMMS Maintenance Request",
    title: String(title).trim(),
    request_type: requestType || "Other",
    ...(machine ? { machine } : {}),
    plant,
    ...(area.trim() ? { area: area.trim() } : {}),
    what_is_needed: String(whatIsNeeded).trim(),
    ...(whyNeeded.trim() ? { why_needed: whyNeeded.trim() } : {}),
    priority: priority || "Medium",
    ...(neededBy ? { needed_by: neededBy } : {}),
    production_affected: productionAffected ? 1 : 0,
    requested_by: requestedBy,
    requested_at: erpNow(),
  });

  return getRequest(created.name);
};

/** Materials, normalised for ERPNext's child table. */
const toMaterialRows = (materials = []) =>
  (materials || [])
    .filter((m) => String(m.description || "").trim())
    .map((m) => ({
      doctype: "CMMS Request Material",
      item_code: String(m.item_code || "").trim(),
      description: String(m.description).trim(),
      qty: Number(m.qty || 0),
      uom: String(m.uom || "").trim(),
      remarks: String(m.remarks || "").trim(),
    }));

/** The crew, in the shape the shared worker table expects. */
const toWorkerRows = (workers = []) =>
  (workers || [])
    .filter((w) => String(w.name || w.worker_name || "").trim())
    .map((w) => ({
      doctype: "CMMS Breakdown Worker",
      worker_name: String(w.name || w.worker_name).trim(),
      // Optional on purpose: most of the maintenance team have no ERPNext
      // account, and a Link to User would make them unrecordable.
      worker: w.user || w.worker || "",
      role_on_job: w.role || w.role_on_job || "",
      hours: Number(w.hours || 0),
    }));

/**
 * Saves a stage's details and moves the request on, as one step.
 *
 * The two halves are deliberately not separable, for the same reason they are
 * not on a breakdown: saving without advancing leaves a half-filled form nobody
 * is prompted to finish, and advancing without saving is how a record reaches
 * Completed carrying nothing but timestamps.
 */
export const saveAndAdvanceRequest = async (id, action, fields = {}, user = {}) => {
  const stage = REQUEST_STAGES[action];
  if (!stage) throw new Error(`"${action}" is not a step this request has`);

  const doc = await getDoc("CMMS Maintenance Request", id);

  // Checked here rather than left to ERPNext: transitions are applied through
  // the integration account, so the workflow only ever sees that account's
  // roles and never the person who clicked. See maintenanceRequestStages.js.
  if (!mayTakeRequestStep(action, user, doc)) {
    const error = new Error(
      stage.requesterOnly
        ? "Only the person who raised this request can take that step."
        : `A ${user?.role || "signed-out user"} may not take that step.`
    );
    error.forbidden = true;
    throw error;
  }

  if (doc.workflow_state !== stage.from) {
    throw new Error(
      `This request is ${doc.workflow_state}. "${action}" only applies to one that is ${stage.from}.`
    );
  }

  // Only what this stage owns. A stage cannot reach back and rewrite an
  // earlier one's answers by including them in its payload.
  const edits = {};
  for (const field of stage.fields) {
    if (fields[field] !== undefined) edits[field] = fields[field];
  }

  if (edits.materials_used) edits.materials_used = toMaterialRows(edits.materials_used);
  if (edits.worked_by) {
    edits.worked_by = toWorkerRows(edits.worked_by);
    /**
     * Labour is the sum of the crew's hours, not a separate answer.
     *
     * The same rule the breakdown record settled on: asking for a total
     * alongside the people lets the two disagree, and they did — a report
     * saying eight person-hours beside four names adding up to fourteen.
     */
    edits.labour_hours = edits.worked_by.reduce((sum, w) => sum + Number(w.hours || 0), 0);
  }
  if (edits.satisfied !== undefined) edits.satisfied = edits.satisfied ? 1 : 0;

  // Checked against the record as it will be, not as it was: a field filled in
  // on this very form counts as given.
  const missing = missingForRequest(action, { ...doc, ...edits });
  if (missing.length) {
    const error = new Error(
      `Fill in ${missing.map((m) => m.label).join(", ")} before marking this ${stage.to}.`
    );
    error.missing = missing;
    error.incomplete = true;
    throw error;
  }

  Object.assign(edits, stage.stamp(user));

  if (Object.keys(edits).length) await updateDoc("CMMS Maintenance Request", id, edits);

  const fresh = await getDoc("CMMS Maintenance Request", id);
  await callMethod("frappe.model.workflow.apply_workflow", { doc: fresh, action });

  return getRequest(id);
};

/* ------------------------------------------------------------ the log sheet */

export { MAX_FILE_BYTES } from "./attachments.js";

/** The signed sheet, and anything else that belongs with the job. */
export const attachToRequest = (id, file) => attach("CMMS Maintenance Request", id, file);

/** Removes one. */
export const detachFromRequest = (id, fileId) => detach("CMMS Maintenance Request", id, fileId);

/**
 * The maintenance head confirming he has seen the signed sheet.
 *
 * The same rule as the breakdown's: a tick that means "the procedure was
 * followed" is worth nothing if the person ticking it never saw the paper, so
 * it cannot be set until a sheet is attached.
 */
export const verifyRequestLogSheet = async (id, { verified = true, user } = {}) => {
  const files = await listAttachments("CMMS Maintenance Request", id);
  if (verified && files.length === 0) {
    throw new Error("Attach the signed log sheet before verifying it.");
  }

  await updateDoc("CMMS Maintenance Request", id, {
    log_sheet_verified: verified ? 1 : 0,
    log_sheet_verified_by: verified ? user?.email || "" : "",
    log_sheet_verified_at: verified ? erpNow() : null,
  });
  return getRequest(id);
};

/**
 * What the plant has asked for, summarised.
 *
 * Small on purpose: the queue itself is the report. What a stat row adds is the
 * one thing a list cannot show at a glance — how much of the backlog is waiting
 * on maintenance and how much is waiting on the people who raised it.
 */
export const requestSummary = (rows = []) => {
  const live = rows.filter((r) => !["Closed", "Cancelled"].includes(r.state));
  const byType = new Map();
  for (const r of live) {
    byType.set(r.requestType || "Other", (byType.get(r.requestType || "Other") || 0) + 1);
  }

  return {
    open: live.length,
    notStarted: rows.filter((r) => r.state === "Requested").length,
    inProgress: rows.filter((r) => r.state === "In Progress").length,
    awaitingClosure: rows.filter((r) => r.state === "Completed").length,
    overdue: live.filter((r) => r.neededBy && r.neededBy < new Date().toISOString().slice(0, 10))
      .length,
    byType: [...byType.entries()].map(([type, count]) => ({ type, count })),
  };
};
