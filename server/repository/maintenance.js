import {
  callMethod,
  createDoc,
  docExists,
  getDoc,
  listAll,
  listChildRows,
  listDocs,
  updateDoc,
} from "../integrations/erpnext/client.js";
import { STAGES, mayTake, missingFor, nextActionFor } from "../integrations/erpnext/breakdownStages.js";
import { plantsFor } from "./plantScope.js";

// Re-exported so the breakdown controller keeps its one import.
export { plantsFor };
import { erpNow } from "../integrations/erpnext/time.js";
import { attach, detach, listAttachments } from "./attachments.js";

/**
 * Breakdowns and machines.
 *
 * Module 2 lives entirely in ERPNext — there is no MongoDB behind any of this —
 * which is why these screens work today while the Module 1 ones still wait on
 * the controller rewrite.
 *
 * The stage a breakdown is in is moved by a workflow action, never by writing
 * `workflow_state`. ERPNext refuses a state written directly, and that refusal
 * is the whole value of the workflow: it is what stops a breakdown appearing
 * as Planned when nobody assessed it.
 */

const BREAKDOWN_FIELDS = [
  "name",
  "machine",
  "machine_name",
  "plant",
  "workflow_state",
  "priority",
  "failure_mode",
  "stopped_at",
  "what_happened",
  "production_stopped",
  "reported_by",
  "likely_cause",
  "assigned_to",
  "target_completion",
  "completed_at",
  "output_per_hour",
  "output_uom",
  "repeat_failure",
  "repeat_of",
  "modified",
];

/** What each stage is waiting for, in the words the screen shows. */
const WAITING_ON = {
  Reported: "Maintenance to start work",
  "Under Repair": "Machine to run again",
  Repaired: "Manager to record the root cause",
  Closed: "",
  Cancelled: "",
};

/** Hours between two ERPNext datetimes, or null when one is missing. */
const hoursBetween = (from, to) => {
  if (!from || !to) return null;
  const a = new Date(String(from).replace(" ", "T"));
  const b = new Date(String(to).replace(" ", "T"));
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round(((b - a) / 3600_000) * 10) / 10;
};

const toSummary = (row) => {
  const stoppedFor = hoursBetween(row.stopped_at, row.completed_at || new Date().toISOString());
  const outputPerHour = Number(row.output_per_hour || 0);

  return {
    id: row.name,
    machine: row.machine,
    machineName: row.machine_name || row.machine,
    plant: row.plant,
    state: row.workflow_state,
    waitingOn: WAITING_ON[row.workflow_state] ?? "",
    priority: row.priority || "",
    failureMode: row.failure_mode || "",
    stoppedAt: row.stopped_at,
    completedAt: row.completed_at || null,
    whatHappened: row.what_happened,
    productionStopped: Boolean(row.production_stopped),
    reportedBy: row.reported_by,
    likelyCause: row.likely_cause || "",
    assignedTo: row.assigned_to || "",
    targetCompletion: row.target_completion || null,
    // Still running for an open breakdown, final once it is closed. Shown
    // rather than stored, so it cannot go stale on a record nobody reopened.
    stoppedForHours: stoppedFor,
    // What the machine would have made in that time, in its own unit. This
    // replaced a rupee figure worked out from a rate nobody had agreed.
    outputPerHour,
    outputUom: row.output_uom || "",
    outputLost: stoppedFor && outputPerHour ? Math.round(stoppedFor * outputPerHour * 10) / 10 : 0,
    // Carried on the summary so a list can mark a repeat without opening every
    // record. It is the flag a report highlights on, and highlighting it only
    // in the detail view would mean nobody ever saw it.
    repeatFailure: Boolean(row.repeat_failure),
    repeatOf: row.repeat_of || "",
    updatedAt: row.modified,
  };
};

/**
 * Breakdowns, newest first.
 *
 * `plant` narrows to one site. A Plant Manager is already restricted by an
 * ERPNext User Permission, so this is for the Manager choosing to look at one
 * plant rather than a security boundary — the boundary is in ERPNext.
 */
export const listBreakdowns = async ({ plant = "", state = "", open = false, limit = 100, onlyPlants = null } = {}) => {
  const filters = [];
  if (plant) filters.push(["CMMS Breakdown", "plant", "=", plant]);
  // A production manager sees their own site and no other. Applied even when
  // they also passed a `plant` filter, so narrowing cannot be used to widen.
  if (Array.isArray(onlyPlants)) {
    filters.push(["CMMS Breakdown", "plant", "in", onlyPlants.length ? onlyPlants : ["__none__"]]);
  }
  if (state) filters.push(["CMMS Breakdown", "workflow_state", "=", state]);
  if (open) filters.push(["CMMS Breakdown", "workflow_state", "not in", ["Closed", "Cancelled"]]);

  const rows = await listDocs("CMMS Breakdown", {
    fields: BREAKDOWN_FIELDS,
    filters: filters.length ? filters : undefined,
    orderBy: "stopped_at desc",
    limit,
  });
  return rows.map(toSummary);
};

/**
 * The earlier failures on the same machine.
 *
 * Offered on the closing form so "has this happened before" can be answered by
 * looking rather than by remembering. Without the list the question gets a tick
 * from whoever has a good memory and a blank from whoever does not, and the
 * repeat count ends up measuring the staff rather than the machines.
 *
 * Deliberately not filtered by failure mode. A bearing that seizes and then
 * takes the shaft with it reads as two different modes and is one problem, and
 * the person closing the record is better placed to judge that than a filter.
 */
const priorFailuresOf = async (machine, exclude, stoppedAt) => {
  if (!machine) return [];

  const rows = await listDocs("CMMS Breakdown", {
    fields: ["name", "stopped_at", "failure_mode", "what_happened", "root_cause", "workflow_state"],
    filters: [
      ["CMMS Breakdown", "machine", "=", machine],
      ["CMMS Breakdown", "name", "!=", exclude],
      ["CMMS Breakdown", "workflow_state", "!=", "Cancelled"],
      // Only what came before it. A later breakdown cannot be the one this is a
      // repeat of, and offering it invites a loop nobody can read back.
      ...(stoppedAt ? [["CMMS Breakdown", "stopped_at", "<", stoppedAt]] : []),
    ],
    orderBy: "stopped_at desc",
    limit: 20,
  }).catch(() => []);

  return rows.map((r) => ({
    id: r.name,
    stoppedAt: r.stopped_at,
    failureMode: r.failure_mode || "",
    whatHappened: r.what_happened || "",
    rootCause: r.root_cause || "",
    state: r.workflow_state,
  }));
};

/** One breakdown in full, including its spares and prevention actions. */
export const getBreakdown = async (id) => {
  const doc = await getDoc("CMMS Breakdown", id).catch((error) => {
    if (error?.status === 404) return null;
    throw error;
  });
  if (!doc) return null;

  return {
    ...toSummary(doc),
    // Only fetched once the record has reached the stage that asks the
    // question. On every earlier stage it is a second round trip to ERPNext for
    // a list nothing on screen shows.
    priorFailures:
      doc.workflow_state === "Repaired" || doc.repeat_failure
        ? await priorFailuresOf(doc.machine, id, doc.stopped_at)
        : [],
    estimatedRepairHours: Number(doc.estimated_repair_hours || 0),
    plannedAt: doc.planned_at || null,
    repairStartedAt: doc.repair_started_at || null,
    files: await listAttachments("CMMS Breakdown", id),
    logSheetVerified: Boolean(doc.log_sheet_verified),
    logSheetVerifiedBy: doc.log_sheet_verified_by || "",
    logSheetVerifiedAt: doc.log_sheet_verified_at || null,
    repairedBy: (doc.repaired_by || []).map((w) => ({
      name: w.worker_name,
      user: w.worker || "",
      role: w.role_on_job || "",
      hours: Number(w.hours || 0),
    })),
    labourHours: Number(doc.labour_hours || 0),
    closedAt: doc.closed_at || null,
    actualDowntimeHours: Number(doc.actual_downtime_hours || 0),
    recordedOutputLost: Number(doc.output_lost || 0),
    outputPerHour: Number(doc.output_per_hour || 0),
    outputUom: doc.output_uom || "",
    productionStopped: Boolean(doc.production_stopped),
    actionsPerformed: doc.actions_performed || "",
    rootCause: doc.root_cause || "",
    supplier: doc.supplier || "",
    supplierPromised: doc.supplier_confirmed_date || null,
    assessedBy: doc.assessed_by || "",
    assessedAt: doc.assessed_at || null,
    spares: (doc.spares_required || []).map((s) => ({
      itemCode: s.item_code || "",
      description: s.description,
      qtyRequired: Number(s.qty_required || 0),
    })),
    preventionActions: (doc.prevention_actions || []).map((a) => ({
      actionType: a.action_type,
      description: a.description,
      owner: a.owner_user || "",
      targetDate: a.target_date || null,
      completed: Boolean(a.completed),
    })),
    // What the next step is and what it still wants, so the screen can say so
    // before somebody fills a form in and is refused at the end of it.
    nextAction: nextActionFor(doc.workflow_state),
    missing: missingFor(nextActionFor(doc.workflow_state), doc),
  };
};

/**
 * Reports a breakdown.
 *
 * Five fields, and deliberately no more. Anything else is a guess at the point
 * a machine has just stopped, and a guess recorded as fact is worse than a
 * blank — the maintenance team fills the rest in when they have looked at it.
 */
export const reportBreakdown = async ({
  machine,
  stoppedAt,
  whatHappened,
  productionStopped,
  priority = "",
  likelyCause = "",
  reportedBy,
}) => {
  if (!machine) throw new Error("A machine is required");
  if (!whatHappened?.trim()) throw new Error("Say what happened");

  const created = await createDoc("CMMS Breakdown", {
    doctype: "CMMS Breakdown",
    machine,
    stopped_at: stoppedAt || erpNow(),
    what_happened: whatHappened.trim(),
    production_stopped: productionStopped ? 1 : 0,
    // Asked at the report now that there is no assessment stage. Optional:
    // whoever finds a stopped machine may not know how urgent it is, and
    // guessing is worse than leaving it for maintenance to set.
    ...(priority ? { priority } : {}),
    ...(likelyCause.trim() ? { likely_cause: likelyCause.trim() } : {}),
    reported_by: reportedBy,
  });

  // The machine itself carries its own state, so a catalog or dashboard view
  // can show what is down without reading every breakdown.
  await updateDoc("CMMS Machine", machine, { status: "Under Repair" }).catch(() => {});

  return getBreakdown(created.name);
};

/** Saves the fields a stage owns, without moving the record on. */
export const updateBreakdown = async (id, fields) => {
  await updateDoc("CMMS Breakdown", id, fields);
  return getBreakdown(id);
};

/**
 * Moves a breakdown to its next stage.
 *
 * Goes through ERPNext's workflow rather than writing the state, so the
 * transition rules and the role restrictions on them are enforced by ERPNext
 * and cannot be stepped around by calling this API directly.
 */
export const applyAction = async (id, action) => {
  const doc = await getDoc("CMMS Breakdown", id);
  await callMethod("frappe.model.workflow.apply_workflow", { doc, action });

  const after = await getBreakdown(id);

  // A machine is running again once the repair is done.
  if (["Repaired", "Closed", "Cancelled"].includes(after.state)) {
    await updateDoc("CMMS Machine", after.machine, { status: "Running" }).catch(() => {});
  }
  return after;
};

/**
 * The spares used on a repair.
 *
 * Deliberately not checked against the catalog. The engineering store is being
 * renamed and recounted, so an item code typed here may not match anything yet
 * - and refusing a spare because the catalog has not caught up would mean the
 * spare simply goes unrecorded. Description and quantity are what matter; the
 * code is free text for whoever has one to hand.
 */
const toSpareRows = (spares = []) =>
  (spares || [])
    .filter((s) => String(s.description || "").trim())
    .map((s) => ({
      doctype: "CMMS Breakdown Spare",
      item_code: String(s.item_code || "").trim(),
      description: String(s.description).trim(),
      qty_required: Number(s.qty_required || 0),
    }));

/** Prevention actions, normalised for ERPNext's child table. */
const toPreventionRows = (actions = []) =>
  (actions || []).map((a) => ({
    doctype: "CMMS Prevention Action",
    action_type: a.action_type || "Other",
    description: a.description || "",
    owner_user: a.owner_user || "",
    target_date: a.target_date || null,
    completed: a.completed ? 1 : 0,
  }));

/**
 * Makes sure a named supplier exists, creating it if it does not.
 *
 * `supplier` is an ERPNext Link, so a name it does not hold is refused on
 * save. The instance starts with no Supplier records at all, which would make
 * the planning stage impossible to complete on the first day it is used - the
 * spares that need ordering are exactly the ones that have no supplier on file
 * yet.
 *
 * The form offers the existing list first, so this only fires for a genuinely
 * new name. It is still the one place in this module that creates master data
 * as a side effect, which is worth knowing when a list of suppliers turns out
 * to have three spellings of the same firm in it.
 */
const ensureSupplier = async (name) => {
  const clean = String(name || "").trim();
  if (!clean) return "";
  if (await docExists("Supplier", clean)) return clean;

  const created = await createDoc("Supplier", {
    doctype: "Supplier",
    supplier_name: clean,
    // The least opinionated group ERPNext ships with. Somebody buying properly
    // through ERPNext will want to correct this; a maintenance plan should not
    // be blocked waiting for them to.
    supplier_group: "All Supplier Groups",
  });
  return created?.name || clean;
};

/**
 * Saves a stage's details and moves the breakdown on, as one step.
 *
 * The two halves are deliberately not separable. Saving without advancing
 * leaves a form half-filled that nobody is prompted to finish; advancing
 * without saving is what this module did before, and it is how a breakdown
 * reaches Closed carrying nothing but timestamps.
 *
 * The gate is here rather than in the controller because it is a rule about
 * maintenance records, not about HTTP - and because the same check has to hold
 * whether the request came from the dashboard or from a script.
 */
export const saveAndAdvance = async (id, action, fields = {}, user = {}) => {
  const stage = STAGES[action];
  if (!stage) throw new Error(`"${action}" is not a step this breakdown has`);

  // Checked here rather than left to ERPNext: transitions are applied through
  // the integration account, so the workflow only ever sees that account's
  // roles and never the person who clicked. See breakdownStages.js.
  if (!mayTake(action, user?.role)) {
    const error = new Error(`A ${user?.role || "signed-out user"} may not take that step.`);
    error.forbidden = true;
    throw error;
  }

  const doc = await getDoc("CMMS Breakdown", id);
  if (doc.workflow_state !== stage.from) {
    throw new Error(
      `This breakdown is ${doc.workflow_state}. "${action}" only applies to one that is ${stage.from}.`
    );
  }

  // Only what this stage owns. A stage cannot reach back and rewrite an
  // earlier one's answers by including them in its payload.
  const edits = {};
  for (const field of stage.fields) {
    if (fields[field] !== undefined) edits[field] = fields[field];
  }

  if (edits.spares_required) {
    edits.spares_required = toSpareRows(edits.spares_required);
  }
  if (edits.prevention_actions) {
    edits.prevention_actions = toPreventionRows(edits.prevention_actions);
  }
  if (edits.repaired_by) {
    edits.repaired_by = (edits.repaired_by || [])
      .filter((w) => String(w.name || w.worker_name || "").trim())
      .map((w) => ({
        doctype: "CMMS Breakdown Worker",
        worker_name: String(w.name || w.worker_name).trim(),
        // Optional on purpose: most of the team have no ERPNext account.
        worker: w.user || w.worker || "",
        role_on_job: w.role || w.role_on_job || "",
        hours: Number(w.hours || 0),
      }));

    /**
     * Labour is the sum of the crew's hours, not a separate answer.
     *
     * It used to be typed as its own figure alongside the people, which asked
     * the same question twice and let the two disagree - the report would say
     * eight person-hours while the four names beside it added up to fourteen.
     * Derived here so there is one place the number can come from.
     */
    edits.labour_hours = edits.repaired_by.reduce((sum, w) => sum + Number(w.hours || 0), 0);
  }
  if (edits.supplier) {
    edits.supplier = await ensureSupplier(edits.supplier);
  }
  if (edits.repeat_failure !== undefined) {
    edits.repeat_failure = edits.repeat_failure ? 1 : 0;
    // Clearing the tick clears the link with it. A record that says "not a
    // repeat" while still pointing at the breakdown it repeats is a record two
    // screens will read differently, and `repeat_of` is what the machine's
    // history follows to draw the chain.
    if (!edits.repeat_failure) edits.repeat_of = "";
  }

  // Checked against the record as it will be, not as it was: a field filled in
  // on this very form counts as given.
  const merged = { ...doc, ...edits };
  const missing = missingFor(action, merged);
  if (missing.length) {
    const error = new Error(
      `Fill in ${missing.map((m) => m.label).join(", ")} before marking this ${stage.to}.`
    );
    error.missing = missing;
    error.incomplete = true;
    throw error;
  }

  // Downtime and loss are worked out, never typed. Two people typing the same
  // arithmetic differently is how a loss figure stops being comparable across
  // breakdowns, which is the only thing that makes it worth collecting.
  if (action === "Machine Running") {
    const downtime = hoursBetween(doc.stopped_at, edits.completed_at || doc.completed_at);
    if (downtime !== null) {
      edits.actual_downtime_hours = downtime;
      const perHour = Number(doc.output_per_hour || 0);
      if (perHour > 0) edits.output_lost = Math.round(downtime * perHour * 10) / 10;
    }
  }

  Object.assign(edits, stage.stamp(user));

  if (Object.keys(edits).length) await updateDoc("CMMS Breakdown", id, edits);

  return applyAction(id, action);
};

/* --------------------------------------------- what changed, per machine */

/**
 * Every prevention action ever recorded against one machine.
 *
 * The asset register shows what a machine *is* and MachineHistory shows what it
 * keeps doing. Neither answers the question a maintenance manager is actually
 * asked in a review: what have we changed so it stops doing it. Those decisions
 * exist — one per closed breakdown, sometimes several — but they are buried a
 * click deep inside individual breakdowns, which is the same as not existing.
 *
 * Pulled straight from the child table rather than by reading each breakdown
 * whole. A machine with a year of history behind it would otherwise cost forty
 * document fetches to answer, and a page that slow does not get opened.
 */
export const preventionActionsForMachine = async (machine, { from = "", to = "" } = {}) => {
  if (!machine) throw new Error("A machine is required");

  const breakdowns = await listAll("CMMS Breakdown", {
    fields: [
      "name",
      "stopped_at",
      "failure_mode",
      "root_cause",
      "closed_at",
      "repeat_failure",
      "workflow_state",
    ],
    filters: [
      ["CMMS Breakdown", "machine", "=", machine],
      // Prevention is recorded at closing, so an open breakdown has none and
      // asking for its rows would only cost a round trip.
      ["CMMS Breakdown", "workflow_state", "=", "Closed"],
      ...(from ? [["CMMS Breakdown", "stopped_at", ">=", `${from} 00:00:00`]] : []),
      ...(to ? [["CMMS Breakdown", "stopped_at", "<=", `${to} 23:59:59`]] : []),
    ],
    orderBy: "stopped_at desc",
  });

  if (!breakdowns.length) return [];

  const byId = new Map(breakdowns.map((b) => [b.name, b]));
  const ids = [...byId.keys()];

  let rows = [];
  try {
    rows = await listChildRows("CMMS Prevention Action", "CMMS Breakdown", {
      fields: ["name", "parent", "idx", "action_type", "description", "owner_user", "target_date", "completed"],
      filters: [["CMMS Prevention Action", "parent", "in", ids]],
      limit: 500,
    });
  } catch (error) {
    /**
     * Older Frappe builds refuse a child-table query outright.
     *
     * Falling back to whole documents rather than showing an empty list: a
     * machine that has had prevention actions recorded and displays none is a
     * far worse answer than a slow one, because it reads as "nothing was ever
     * done about it".
     *
     * Bounded to the most recent fifteen. Enough to answer the question anybody
     * is asking on this screen, and few enough that the fallback cannot become
     * a hundred parallel requests on a machine with a bad year behind it.
     */
    console.warn("Child-table query refused, reading breakdowns whole:", error.message);
    const docs = await Promise.all(
      breakdowns.slice(0, 15).map((b) => getDoc("CMMS Breakdown", b.name).catch(() => null))
    );
    rows = docs
      .filter(Boolean)
      .flatMap((d) => (d.prevention_actions || []).map((a) => ({ ...a, parent: d.name })));
  }

  return rows
    .map((a) => {
      const source = byId.get(a.parent) || {};
      return {
        id: a.name,
        breakdown: a.parent,
        actionType: a.action_type || "Other",
        description: a.description || "",
        owner: a.owner_user || "",
        targetDate: a.target_date || null,
        completed: Boolean(a.completed),
        // Carried so the action reads as a decision with a reason behind it
        // rather than a line on a to-do list.
        failureMode: source.failure_mode || "",
        rootCause: source.root_cause || "",
        decidedAt: source.closed_at || source.stopped_at || null,
        repeatFailure: Boolean(source.repeat_failure),
      };
    })
    .sort((a, b) => String(b.decidedAt || "").localeCompare(String(a.decidedAt || "")));
};

/**
 * Ticks a prevention action off, or puts it back.
 *
 * ERPNext has no way to write one child row on its own, so the parent's whole
 * table is rewritten with this row's flag flipped. Matched on the row's own
 * name rather than its position, because a row deleted from the middle would
 * otherwise silently tick the wrong action.
 *
 * Worth having at all because an action nobody can mark done is an action
 * nobody chases. The list on the machine's page is only a list until it can be
 * worked through.
 */
export const setPreventionActionDone = async (breakdownId, rowId, done = true) => {
  const doc = await getDoc("CMMS Breakdown", breakdownId);
  const rows = doc.prevention_actions || [];

  const found = rows.some((r) => r.name === rowId);
  if (!found) throw new Error("That action is not on this breakdown any more");

  await updateDoc("CMMS Breakdown", breakdownId, {
    prevention_actions: rows.map((r) => ({
      ...r,
      completed: r.name === rowId ? (done ? 1 : 0) : r.completed ? 1 : 0,
    })),
  });

  return { breakdown: breakdownId, action: rowId, completed: Boolean(done) };
};

/* ------------------------------------------------------------ the log sheet */

export { MAX_FILE_BYTES } from "./attachments.js";

/** The signed sheet, and anything else that belongs with the repair. */
export const attachToBreakdown = (id, file) => attach("CMMS Breakdown", id, file);

/** Removes one. */
export const detachFromBreakdown = (id, fileId) => detach("CMMS Breakdown", id, fileId);

/**
 * The maintenance head confirming he has seen the signed sheet.
 *
 * Separate from closing on purpose. Closing records what was learned; this
 * records that somebody senior looked at the paper the crew signed and agrees
 * it describes what happened. A tick that means "the procedure was followed" is
 * worth nothing if the person ticking it never saw the sheet, so it cannot be
 * set until one is attached.
 */
export const verifyLogSheet = async (id, { verified = true, user } = {}) => {
  const files = await listAttachments("CMMS Breakdown", id);
  if (verified && files.length === 0) {
    throw new Error("Attach the signed log sheet before verifying it.");
  }

  await updateDoc("CMMS Breakdown", id, {
    log_sheet_verified: verified ? 1 : 0,
    log_sheet_verified_by: verified ? user?.email || "" : "",
    log_sheet_verified_at: verified ? erpNow() : null,
  });
  return getBreakdown(id);
};

/** Machines, for the picker on the report form. */
export const listMachines = async ({ plant = "", limit = 500 } = {}) => {
  const filters = [];
  if (plant) filters.push(["CMMS Machine", "plant", "=", plant]);

  const rows = await listAll("CMMS Machine", {
    fields: [
      "name", "machine_name", "plant", "area", "criticality", "status",
      "output_per_hour", "output_uom",
    ],
    filters: filters.length ? filters : undefined,
    orderBy: "name asc",
    max: limit,
  });

  return rows.map((m) => ({
    code: m.name,
    name: m.machine_name,
    plant: m.plant,
    area: m.area || "",
    criticality: m.criticality,
    status: m.status,
    outputPerHour: Number(m.output_per_hour || 0),
    outputUom: m.output_uom || "",
  }));
};

/**
 * The people and suppliers the plan forms link to.
 *
 * Both are ERPNext Link fields, which means a typed value that does not match a
 * record is refused on save. Offering the real list is the difference between
 * picking a name and guessing at one and being told no afterwards.
 */
export const listLookups = async () => {
  const [people, suppliers] = await Promise.all([
    listAll("User", {
      fields: ["name", "full_name"],
      filters: [
        ["User", "enabled", "=", 1],
        // Website and guest accounts are not people anybody assigns a repair to.
        ["User", "user_type", "=", "System User"],
      ],
      orderBy: "full_name asc",
    }).catch(() => []),
    listAll("Supplier", { fields: ["name"], orderBy: "name asc" }).catch(() => []),
  ]);

  return {
    people: people.map((u) => ({ email: u.name, name: u.full_name || u.name })),
    suppliers: suppliers.map((s) => s.name),
  };
};

/** The plants, for filters and pickers. */
export const listPlants = async () => {
  const rows = await listAll("CMMS Plant", {
    fields: ["name", "short_code"],
    filters: [["CMMS Plant", "is_active", "=", 1]],
    orderBy: "name asc",
  });
  return rows.map((p) => ({ name: p.name, code: p.short_code }));
};
