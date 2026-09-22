/**
 * Module 2b — maintenance requests.
 *
 * A breakdown is a machine that has stopped. Everything else maintenance is
 * asked for — a guard to be fabricated, a bearing greased on schedule, a
 * conveyor extended, a routine inspection — is not a breakdown, and putting it
 * through the breakdown record was making both records worse.
 *
 * It hurt the breakdown numbers first: MTBF, availability and "how long before
 * anybody started" are only meaningful over unplanned stoppages, and a
 * fabrication job logged as a breakdown drags every one of them. It hurt the
 * request second: a planned job was made to answer for a root cause and a
 * prevention action it does not have, so people wrote "n/a" to get past the
 * form — and an "n/a" recorded as a root cause looks like an answer.
 *
 * So this is a separate record with a shorter journey:
 *
 *   Requested -> In Progress -> Completed -> Closed
 *
 * Raised by the plant manager, worked by maintenance, and closed by whoever
 * raised it — because the person who asked for the work is the only one who
 * can say it is what they wanted. That last step is the whole difference
 * between a queue and a to-do list.
 *
 * Pushed by `scripts/syncMaintenanceRequests.js`. Order matters: a Link or
 * Table target is validated on insert, so children come first.
 */

const PERMISSIONS = [
  { role: "System Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1 },
];

/**
 * Added by the sync script once each DocType exists.
 *
 * The same constraint as the breakdown doctypes: Frappe refuses to let a
 * non-Administrator set a role on a custom DocType unless the session already
 * holds it, so the rest are added afterwards as Custom DocPerm. System Manager
 * is repeated because the moment a doctype has any Custom DocPerm, Frappe
 * ignores the permissions built into the doctype entirely.
 */
export const REQUEST_ROLE_PERMS = [
  { role: "System Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1, share: 1 },
  { role: "Store Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1 },
  { role: "Store Maintenance Manager", read: 1, write: 1, create: 1, report: 1, export: 1 },
  // Raises the request and closes it. Everything in between is maintenance's.
  { role: "Plant Manager", read: 1, write: 1, create: 1, report: 1 },
  { role: "Store Supervisor", read: 1, write: 1, create: 1, report: 1 },
];

const f = (fieldname, label, fieldtype, extra = {}) => ({ fieldname, label, fieldtype, ...extra });
const link = (fieldname, label, target, extra = {}) =>
  f(fieldname, label, "Link", { options: target, ...extra });
const select = (fieldname, label, options, extra = {}) =>
  f(fieldname, label, "Select", { options: options.join("\n"), ...extra });
const check = (fieldname, label, extra = {}) => f(fieldname, label, "Check", { default: "0", ...extra });

const doc = ({ name, autoname, fields, istable = 0 }) => ({
  doctype: "DocType",
  name,
  module: "Custom",
  custom: 1,
  istable,
  editable_grid: istable ? 1 : 0,
  track_changes: istable ? 0 : 1,
  allow_rename: 0,
  ...(istable ? {} : { naming_rule: "Expression", autoname, permissions: PERMISSIONS }),
  fields,
});

/**
 * One material used on the job.
 *
 * Deliberately not checked against the catalog, for the same reason breakdown
 * spares are not: the engineering store is still being renamed and recounted,
 * and refusing to record a length of angle iron because nobody has created an
 * Item for it means the angle iron simply goes unrecorded.
 *
 * Separate from `CMMS Breakdown Spare` because a fabrication job consumes raw
 * material by length and weight rather than spares by piece, and the spare row
 * carries a supplier and a promised date that make no sense here.
 */
const MATERIAL = doc({
  name: "CMMS Request Material",
  istable: 1,
  fields: [
    link("item_code", "Item", "Item", { in_list_view: 1, columns: 2 }),
    f("description", "Description", "Data", { reqd: 1, in_list_view: 1, columns: 4 }),
    f("qty", "Qty", "Float", { reqd: 1, in_list_view: 1, columns: 2 }),
    f("uom", "Unit", "Data", { in_list_view: 1, columns: 2, description: "nos, kg, m, litre" }),
    f("remarks", "Remarks", "Data", { in_list_view: 1, columns: 2 }),
  ],
});

/** The record itself, in stage order. */
const REQUEST = doc({
  name: "CMMS Maintenance Request",
  autoname: "format:MR-{YYYY}-{#####}",
  fields: [
    // --- stage 1: requested, by the plant manager ---
    f("title", "Title", "Data", { reqd: 1, in_list_view: 1 }),

    /**
     * What kind of work this is.
     *
     * The reason the record exists at all. Reporting on a maintenance
     * department that cannot separate fabrication from routine servicing can
     * say how busy it was and nothing about what it was busy with.
     *
     * The leading blank is load-bearing: Frappe gives a Select with no explicit
     * default its first option, so without it every request arrives as
     * Fabrication.
     */
    select(
      "request_type",
      "Type of Work",
      [
        "",
        "Fabrication",
        "Preventive Maintenance",
        "Scheduled Routine",
        "Improvement / Modification",
        "Installation",
        "Inspection",
        "Other",
      ],
      { reqd: 1, in_list_view: 1 }
    ),

    /**
     * Optional on purpose.
     *
     * A guard fabricated for the stores, a new rack, a lighting change — plenty
     * of what maintenance is asked for is not against any one machine, and
     * demanding one would have people picking whichever machine was nearest in
     * the list. The plant is what is always known.
     */
    link("machine", "Machine", "CMMS Machine", { in_list_view: 1 }),
    f("machine_name", "Machine Name", "Data", { fetch_from: "machine.machine_name", read_only: 1 }),
    link("plant", "Plant", "CMMS Plant", { reqd: 1, in_list_view: 1 }),
    f("area", "Area / Section", "Data"),

    f("what_is_needed", "What is Needed", "Small Text", { reqd: 1 }),
    f("why_needed", "Why", "Small Text", { description: "What it fixes or improves" }),

    /**
     * No Critical here, and that is deliberate.
     *
     * A genuinely critical job is a breakdown and belongs on the other record.
     * Offering Critical here is an invitation to route urgent work around the
     * breakdown flow, which is how downtime figures stop describing reality.
     */
    select("priority", "Priority", ["", "High", "Medium", "Low"], {
      in_list_view: 1,
      default: "Medium",
    }),
    f("needed_by", "Needed By", "Date"),
    check("production_affected", "Production is affected"),

    link("requested_by", "Requested By", "User", { reqd: 1 }),
    f("requested_at", "Requested At", "Datetime", { read_only: 1 }),

    // Moved by a workflow action, never by typing, so the transition rules
    // cannot be stepped around.
    select(
      "workflow_state",
      "Status",
      ["Requested", "In Progress", "Completed", "Closed", "Cancelled"],
      { default: "Requested", read_only: 1, in_list_view: 1 }
    ),

    // --- stage 2: accepted and started, by maintenance ---
    link("assigned_to", "Assigned To", "User"),
    f("target_date", "Target Date", "Date"),
    f("started_at", "Work Started At", "Datetime"),
    link("accepted_by", "Accepted By", "User", { read_only: 1 }),
    f("plan_notes", "How it will be done", "Small Text"),

    // --- stage 3: completed, by maintenance ---
    f("work_done", "Work Carried Out", "Small Text"),
    f("completed_at", "Completed At", "Datetime"),
    f("materials_used", "Materials Used", "Table", { options: "CMMS Request Material" }),
    /**
     * The same worker rows the breakdown uses.
     *
     * Reused rather than copied: it is the same question with the same answer
     * shape, and two child tables for "who did the work" would have to be kept
     * in step for the rest of this system's life.
     */
    f("worked_by", "Worked By", "Table", { options: "CMMS Breakdown Worker" }),
    // Person-hours, summed from the crew rather than typed. Two people for
    // three hours is six, and asking the same question twice lets the two
    // answers disagree.
    f("labour_hours", "Labour (person-hours)", "Float", { read_only: 1 }),
    link("completed_by", "Completed By", "User", { read_only: 1 }),

    // The signed sheet, confirmed by the maintenance head. Same rule as the
    // breakdown: the tick means somebody senior read the paper the crew signed.
    check("log_sheet_verified", "Log Sheet Verified", { read_only: 1 }),
    link("log_sheet_verified_by", "Verified By", "User", { read_only: 1 }),
    f("log_sheet_verified_at", "Verified At", "Datetime", { read_only: 1 }),

    // --- stage 4: closed, by whoever raised it ---
    f("closing_remarks", "Closing Remarks", "Small Text"),
    check("satisfied", "Done to satisfaction", { default: "1" }),
    link("closed_by", "Closed By", "User", { read_only: 1 }),
    f("closed_at", "Closed At", "Datetime", { read_only: 1 }),

    // --- rejected or withdrawn ---
    f("cancel_reason", "Reason", "Small Text"),
    link("cancelled_by", "Cancelled By", "User", { read_only: 1 }),
  ],
});

/** Dependency order: the child table before the record that holds it. */
export const REQUEST_DOCTYPES = [MATERIAL, REQUEST];

/**
 * The workflow.
 *
 * Four stops rather than the breakdown's five, and no root-cause stage at all.
 * A planned job has no root cause; asking for one is what produced the column
 * of "n/a" on the breakdown record this one was split out of.
 *
 * Every state is docstatus 0 because the record is edited across days by
 * several people, and a submitted document in ERPNext cannot be edited.
 */
/**
 * Whoever applies these transitions must hold the role each one names.
 *
 * The application applies them as the integration account, never as the person
 * who clicked - so ERPNext only ever sees that account's roles, and a role it
 * does not hold means "Not a valid Workflow Action" for everybody. Who may
 * really take a step is decided in the application, against the signed-in user.
 *
 * `scripts/syncWorkflowServiceRole.js` adds a System Manager row beside every
 * transition below for exactly that reason. Run it after creating these
 * workflows on a fresh instance, or every button here fails.
 */
export const REQUEST_WORKFLOW = {
  doctype: "Workflow",
  workflow_name: "CMMS Maintenance Request Flow",
  document_type: "CMMS Maintenance Request",
  workflow_state_field: "workflow_state",
  is_active: 1,
  send_email_alert: 0,
  states: [
    { state: "Requested", doc_status: "0", allow_edit: "Plant Manager" },
    { state: "In Progress", doc_status: "0", allow_edit: "Store Maintenance Manager" },
    { state: "Completed", doc_status: "0", allow_edit: "Store Maintenance Manager" },
    { state: "Closed", doc_status: "0", allow_edit: "Store Manager" },
    { state: "Cancelled", doc_status: "0", allow_edit: "Store Manager" },
  ],
  transitions: [
    { state: "Requested", action: "Start Work", next_state: "In Progress", allowed: "Store Maintenance Manager", allow_self_approval: 1 },
    { state: "In Progress", action: "Mark Complete", next_state: "Completed", allowed: "Store Maintenance Manager", allow_self_approval: 1 },
    /**
     * Closing belongs to the requester, not to maintenance.
     *
     * A workflow can only name a role, and the rule is narrower than that — it
     * is the one person who raised this request. That is checked against the
     * signed-in user in maintenanceRequestStages.js; the role here is the
     * floor, not the whole rule.
     */
    { state: "Completed", action: "Close Request", next_state: "Closed", allowed: "Plant Manager", allow_self_approval: 1 },
    { state: "Completed", action: "Close as Manager", next_state: "Closed", allowed: "Store Manager", allow_self_approval: 1 },
    // Maintenance will not do it, or the requester no longer needs it. Both
    // land in the same state; who stamped it and the reason say which.
    { state: "Requested", action: "Reject", next_state: "Cancelled", allowed: "Store Maintenance Manager", allow_self_approval: 1 },
    { state: "Requested", action: "Withdraw", next_state: "Cancelled", allowed: "Plant Manager", allow_self_approval: 1 },
  ],
};

/**
 * Workflow states and actions must exist as records before the workflow does.
 *
 * Frappe accepts only these style names: "", Primary, Info, Success, Warning,
 * Danger, Inverse. Nothing here is Danger — a maintenance request is by
 * definition the work that is not an emergency, and colouring it like one would
 * put it beside the breakdowns in every list that sorts by urgency.
 */
export const REQUEST_WORKFLOW_STATES = [
  ["Requested", "Warning"],
  ["In Progress", "Primary"],
  ["Completed", "Success"],
  ["Closed", "Success"],
  ["Cancelled", "Inverse"],
];

export const REQUEST_WORKFLOW_ACTIONS = [
  "Start Work",
  "Mark Complete",
  "Close Request",
  "Close as Manager",
  "Reject",
  "Withdraw",
];
