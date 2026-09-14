/**
 * Module 2 — maintenance planning and scheduling.
 *
 * A breakdown is not a form. The Plant Manager knows only that a machine has
 * stopped; priority, cause, spares and loss are all knowable later and by
 * somebody else. So this is one record with stages, where each stage is written
 * by a different role and can only carry what is knowable at that point.
 *
 * That is also what makes the reporting honest. Report-to-assessment and
 * assessment-to-running-again are only measurable if reporting and assessing
 * are separate events with separate timestamps, which a single form cannot give.
 *
 * Pushed by `scripts/syncMaintenance.js`. Order matters: a Link or Table target
 * is validated on insert, so children and link targets come first.
 */

/**
 * Only System Manager here, and the rest added afterwards as Custom DocPerm.
 *
 * Frappe refuses to let a non-Administrator set a role on a custom DocType
 * unless the session already holds that role, and it caches the session's role
 * list — so granting the integration account the role does not help within the
 * same run. Custom DocPerm is the mechanism meant for adding permissions to an
 * existing doctype, and it has no such restriction.
 */
const PERMISSIONS = [
  { role: "System Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1 },
];

/**
 * Added by the sync script once each DocType exists.
 *
 * System Manager is repeated here on purpose. The moment a doctype has any
 * Custom DocPerm, Frappe ignores the permissions built into the doctype
 * entirely and honours only these - so omitting System Manager silently
 * removed the administrator's own access, including the ability to delete.
 */
export const EXTRA_ROLE_PERMS = [
  { role: "System Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1, share: 1 },
  { role: "Store Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1 },
  { role: "Store Maintenance Manager", read: 1, write: 1, create: 1, report: 1, export: 1 },
  // Reports a breakdown and can cancel one. Everything after that is
  // maintenance's, so no delete and no export.
  { role: "Plant Manager", read: 1, write: 1, create: 1, report: 1 },
];

const f = (fieldname, label, fieldtype, extra = {}) => ({ fieldname, label, fieldtype, ...extra });
const link = (fieldname, label, target, extra = {}) =>
  f(fieldname, label, "Link", { options: target, ...extra });
const select = (fieldname, label, options, extra = {}) =>
  f(fieldname, label, "Select", { options: options.join("\n"), ...extra });
const check = (fieldname, label, extra = {}) => f(fieldname, label, "Check", { default: "0", ...extra });

const doc = ({ name, autoname, fields, istable = 0, extra = {} }) => ({
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
  ...extra,
});

/**
 * A plant. Three sites today, each with its own Plant Manager.
 *
 * Kept separate from the ERPNext Company because all three sit under one
 * company for stock purposes — see the note on ERP_COMPANY in stores.js — but
 * they are genuinely different places with different people responsible.
 */
const PLANT = doc({
  name: "CMMS Plant",
  autoname: "field:plant_name",
  fields: [
    f("plant_name", "Plant Name", "Data", { reqd: 1, unique: 1, in_list_view: 1 }),
    f("short_code", "Short Code", "Data", { reqd: 1, description: "MRP, HTR, MT" }),
    link("company", "ERPNext Company", "Company"),
    link("store_warehouse", "Store Serving This Plant", "Warehouse"),
    check("is_active", "Active", { default: "1", in_list_view: 1 }),
  ],
});

/**
 * A machine.
 *
 * Deliberately not ERPNext's `Asset`, which carries 52 fields of fixed-asset
 * accounting — depreciation schedules, finance books, insurance — and puts the
 * machine on the balance sheet when created properly. That is a finance
 * decision nobody has taken. This record can be linked to a real Asset later
 * if the machines are ever capitalised.
 */
const MACHINE = doc({
  name: "CMMS Machine",
  autoname: "field:machine_code",
  fields: [
    f("machine_code", "Machine Code", "Data", { reqd: 1, unique: 1, in_list_view: 1 }),
    f("machine_name", "Machine Name", "Data", { reqd: 1, in_list_view: 1 }),
    link("plant", "Plant", "CMMS Plant", { reqd: 1, in_list_view: 1 }),
    f("machine_type", "Type", "Data"),
    f("area", "Area / Section", "Data"),

    /**
     * What happens to production when this stops — not what it cost to buy.
     *
     * This is the field that decides how much process a failure earns. Without
     * it every broken hand tool demands a root cause analysis, the paperwork
     * exceeds the maintenance, and people stop using the system.
     */
    select("criticality", "Criticality", ["A - Critical", "B - Important", "C - Ordinary"], {
      reqd: 1,
      default: "B - Important",
      in_list_view: 1,
    }),
    select("status", "Status", ["Running", "Under Repair", "Stopped", "Retired"], {
      reqd: 1,
      default: "Running",
      in_list_view: 1,
    }),

    f("make", "Make", "Data"),
    f("model", "Model", "Data"),
    f("serial_no", "Serial No.", "Data"),
    f("year_made", "Year Made", "Int"),
    f("capacity", "Capacity / Size", "Data"),
    f("motor_kw", "Main Motor kW", "Float"),
    f("commissioned_on", "Commissioned On", "Date"),

    f("shifts_per_day", "Shifts per Day", "Int"),
    f("running_hours_per_day", "Running Hours per Day", "Float"),
    /**
     * What the machine makes in an hour, and the unit it is counted in.
     *
     * This replaced a rupee `loss_per_hour`. A money figure per stoppage read
     * as fact while resting on a rate nobody had agreed, and there was nothing
     * to check it against. What a plant actually loses when a machine stops is
     * product it did not make - so downtime multiplied by this rate says it
     * directly, in the unit the plant already counts in.
     *
     * The unit is per machine because the group's machines do not make the same
     * thing: a mixing mill is counted in kg and a curing press in pieces. It
     * also means output lost may not be summed across machines that disagree on
     * the unit, which is why the report totals it per unit rather than as one
     * number.
     *
     * Set once per machine and reviewed yearly. It does not need to be exact;
     * it needs to be consistent, so comparing two machines means something.
     */
    f("output_per_hour", "Output per Hour", "Float"),
    link("output_uom", "Output Unit", "UOM"),
    check("standby_available", "Standby Available"),
    check("stops_whole_plant", "Stops Whole Plant"),

    check("needs_power", "Needs Power", { default: "1" }),
    check("needs_steam", "Needs Steam"),
    check("needs_thermic_fluid", "Needs Thermic Fluid"),
    check("needs_compressed_air", "Needs Compressed Air"),
    check("needs_cooling_water", "Needs Cooling Water"),

    check("statutory_inspection", "Statutory Inspection Required"),
    f("statutory_due_date", "Certificate Due", "Date"),

    select("maintained_by", "Maintained By", ["In-house", "AMC", "Both"], { default: "In-house" }),
    f("supplier_contact", "Supplier / Service Contact", "Data"),
    f("recurring_problems", "Recurring Problems", "Small Text"),
    f("notes", "Notes", "Small Text"),
  ],
});

/** One spare a breakdown needs. */
const SPARE = doc({
  name: "CMMS Breakdown Spare",
  istable: 1,
  fields: [
    link("item_code", "Item", "Item", { in_list_view: 1 }),
    f("description", "Description", "Data", { reqd: 1, in_list_view: 1 }),
    f("qty_required", "Qty Required", "Float", { reqd: 1, in_list_view: 1 }),
    // Filled from the store when the assessment is saved, so the plan can be
    // built around what is actually on a shelf rather than what is hoped for.
    f("qty_in_store", "In Store", "Float", { read_only: 1, in_list_view: 1 }),
    check("needs_ordering", "Needs Ordering", { in_list_view: 1 }),
    link("supplier", "Supplier", "Supplier"),
    f("expected_date", "Supplier Promised", "Date"),
  ],
});

/**
 * A follow-up that stops the failure happening again.
 *
 * Kept as discrete actions with an owner and a date rather than a paragraph of
 * intent, because a paragraph cannot be chased and an action can.
 */
/**
 * A person on the repair.
 *
 * The name is free text and the ERPNext user is optional: four of the six on
 * the maintenance team are fitters with no login, and a Link to User would
 * have made them unrecordable - which is how "repaired by" ends up naming the
 * maintenance manager on every job.
 */
const WORKER = doc({
  name: "CMMS Breakdown Worker",
  istable: 1,
  fields: [
    f("worker_name", "Name", "Data", { reqd: 1, in_list_view: 1, columns: 4 }),
    link("worker", "ERPNext User", "User", { in_list_view: 1, columns: 4 }),
    select("role_on_job", "Role", ["", "Fitter", "Electrician", "Helper", "Supervisor", "Contractor"],
      { in_list_view: 1, columns: 2 }),
    f("hours", "Hours", "Float", { in_list_view: 1, columns: 2 }),
  ],
});

const PREVENTION = doc({
  name: "CMMS Prevention Action",
  istable: 1,
  fields: [
    select(
      "action_type",
      "Action",
      [
        "Raise minimum stock",
        "Change inspection / checklist",
        "Revise operating instructions",
        "Technical upgrade",
        "Raise a project",
        "Other",
      ],
      { reqd: 1, in_list_view: 1 }
    ),
    f("description", "What exactly", "Small Text", { reqd: 1, in_list_view: 1 }),
    link("owner_user", "Owner", "User", { in_list_view: 1 }),
    f("target_date", "By When", "Date", { in_list_view: 1 }),
    check("completed", "Done", { in_list_view: 1 }),
  ],
});

/** The record itself, in stage order. */
const BREAKDOWN = doc({
  name: "CMMS Breakdown",
  autoname: "format:BD-{YYYY}-{#####}",
  fields: [
    // --- stage 1: reported, by the Plant Manager ---
    link("machine", "Machine", "CMMS Machine", { reqd: 1, in_list_view: 1 }),
    f("machine_name", "Machine Name", "Data", { fetch_from: "machine.machine_name", read_only: 1 }),
    link("plant", "Plant", "CMMS Plant", { fetch_from: "machine.plant", read_only: 1, in_list_view: 1 }),
    f("stopped_at", "Stopped At", "Datetime", { reqd: 1, in_list_view: 1 }),
    f("what_happened", "What Happened", "Small Text", { reqd: 1 }),
    check("production_stopped", "Production Stopped"),
    link("reported_by", "Reported By", "User", { reqd: 1 }),

    // The state the workflow moves through. Read only: it is changed by a
    // workflow action, never by typing, so the transition rules cannot be
    // stepped around.
    select(
      "workflow_state",
      "Status",
      ["Reported", "Under Repair", "Repaired", "Closed", "Cancelled"],
      { default: "Reported", read_only: 1, in_list_view: 1 }
    ),

    // --- stage 2: assessed, by the Maintenance Manager ---
    /**
     * The leading blank is load-bearing.
     *
     * Frappe gives a Select with no explicit default the first of its options,
     * so without it every breakdown arrives already Critical - and a system
     * where everything is critical has no priorities at all. It also made the
     * assessment gate useless: a field that is never empty can never be
     * reported as missing.
     */
    select("priority", "Priority", ["", "Critical", "High", "Medium", "Low"], { in_list_view: 1 }),

    /**
     * What kind of failure it was.
     *
     * The single most useful thing to collect for reporting: it turns a list
     * of breakdowns into "the presses keep failing electrically", which is a
     * sentence somebody can act on. Blank first, for the same reason priority
     * is - a Select with no explicit default takes its first option, and
     * everything would arrive as Mechanical.
     */
    select(
      "failure_mode",
      "Failure Mode",
      ["", "Mechanical", "Electrical", "Hydraulic", "Pneumatic", "Instrumentation", "Operational", "Other"],
      { in_list_view: 1 }
    ),
    f("likely_cause", "Likely Cause", "Small Text"),
    f("spares_required", "Spares Required", "Table", { options: "CMMS Breakdown Spare" }),
    /**
     * Defaults from the machine, but a typed figure sticks.
     *
     * Without `fetch_if_empty` Frappe re-fetches on every save, so the rate
     * offered on the assessment form was silently overwritten by the machine's
     * own - the field looked editable and was not.
     */
    f("output_per_hour", "Output per Hour", "Float", {
      fetch_from: "machine.output_per_hour",
      fetch_if_empty: 1,
    }),
    link("output_uom", "Output Unit", "UOM", {
      fetch_from: "machine.output_uom",
      fetch_if_empty: 1,
    }),
    f("estimated_repair_hours", "Estimated Repair Hours", "Float"),
    link("assessed_by", "Assessed By", "User", { read_only: 1 }),
    f("assessed_at", "Assessed At", "Datetime", { read_only: 1 }),

    // --- stage 3: planned ---
    // Kept for the records raised before the team could be listed; the form
    // writes `repaired_by` now.
    link("assigned_to", "Assigned To", "User"),
    f("repaired_by", "Repaired By", "Table", { options: "CMMS Breakdown Worker" }),
    f("target_completion", "Target Completion", "Datetime"),
    link("supplier", "Supplier", "Supplier"),
    f("supplier_confirmed_date", "Supplier Promised", "Date"),
    f("planned_at", "Planned At", "Datetime", { read_only: 1 }),

    /**
     * When somebody actually started working on it.
     *
     * Without this, the time from reported to running again is one number and
     * there is no telling whether it was spent waiting for a spare or spent
     * with a spanner in hand. Those two have completely different fixes -
     * stock more spares, or train more fitters - so the report has to be able
     * to separate them.
     */
    f("repair_started_at", "Repair Started At", "Datetime", { read_only: 1 }),

    // --- stage 4: repaired ---
    f("actions_performed", "Actions Performed", "Small Text"),
    /**
     * When the machine went back to production, not when the fitter downed
     * tools.
     *
     * Called "Running Again At" until the maintenance team pointed out that
     * those are two different moments and only one of them ends the stoppage:
     * a machine can be mechanically finished and still be waiting on a trial
     * run, a mould change or an operator. Downtime is measured to the hand-over
     * because that is when production got its machine back, and a figure
     * measured to anything else understates every stoppage on the site.
     *
     * The fieldname is unchanged on purpose — renaming it would orphan every
     * breakdown already recorded against it.
     */
    f("completed_at", "Hand Over Time", "Datetime"),
    f("actual_downtime_hours", "Actual Downtime (hrs)", "Float", { read_only: 1 }),
    /**
     * Output not made, in the machine's own unit. Worked out at hand-over from
     * the downtime and the rate, never typed.
     */
    f("output_lost", "Output Lost", "Float", { read_only: 1 }),
    f("root_cause", "Root Cause", "Small Text"),

    /**
     * Has this happened before?
     *
     * The single most valuable thing to know about a failure, and the one a
     * list of breakdowns cannot tell you: the same bearing failing four times
     * in a year reads as four ordinary repairs unless somebody says out loud
     * that it is one problem. Asked at closing, where the person doing the
     * analysis has the machine's history in front of them.
     *
     * `repeat_of` points at the earlier breakdown when one can be named, and is
     * left blank when the crew know it has happened before but the earlier one
     * predates the system. A flag with no link is still worth having — the
     * report highlights on the flag, not on the link.
     */
    check("repeat_failure", "Repeat Failure"),
    link("repeat_of", "Repeat Of", "CMMS Breakdown"),
    // Person-hours, not elapsed hours. Two fitters for three hours is six, and
    // it is the figure that tells you what the repair actually cost in labour.
    f("labour_hours", "Labour (person-hours)", "Float"),
    link("stock_entry", "Spares Issued", "Stock Entry", { read_only: 1 }),

    // --- stage 5: prevented ---
    f("prevention_actions", "Prevention Actions", "Table", { options: "CMMS Prevention Action" }),
    f("closed_at", "Closed At", "Datetime", { read_only: 1 }),
  ],
});

/** Dependency order: children and link targets before the records using them. */
export const MAINTENANCE_DOCTYPES = [PLANT, MACHINE, SPARE, WORKER, PREVENTION, BREAKDOWN];

/**
 * The workflow.
 *
 * Roles carry the meaning here. A Plant Manager can report and cancel, and can
 * do nothing else — they are not expected to know a cause or a spare. Every
 * transition after that belongs to maintenance.
 *
 * Every state is docstatus 0 because the record is not submittable: a
 * breakdown is edited across days by several people, and a submitted document
 * in ERPNext cannot be edited at all.
 */
export const BREAKDOWN_WORKFLOW = {
  doctype: "Workflow",
  workflow_name: "CMMS Breakdown Flow",
  document_type: "CMMS Breakdown",
  workflow_state_field: "workflow_state",
  is_active: 1,
  send_email_alert: 0,
  states: [
    { state: "Reported", doc_status: "0", allow_edit: "Store Maintenance Manager" },
    { state: "Under Repair", doc_status: "0", allow_edit: "Store Maintenance Manager" },
    { state: "Repaired", doc_status: "0", allow_edit: "Store Maintenance Manager" },
    { state: "Closed", doc_status: "0", allow_edit: "Store Manager" },
    { state: "Cancelled", doc_status: "0", allow_edit: "Store Manager" },
  ],
  transitions: [
    /**
     * Reported straight to Under Repair.
     *
     * There were Assess and Plan states between these two. On this site both
     * happen on the phone while somebody walks to the machine, and states that
     * exist only to be clicked through are states that get clicked through
     * without being read.
     */
    { state: "Reported", action: "Start Repair", next_state: "Under Repair", allowed: "Store Maintenance Manager", allow_self_approval: 1 },
    { state: "Under Repair", action: "Machine Running", next_state: "Repaired", allowed: "Store Maintenance Manager", allow_self_approval: 1 },
    // Closing is the Manager's, not maintenance's: it is the check that a root
    // cause and a prevention action were actually recorded rather than skipped.
    { state: "Repaired", action: "Close", next_state: "Closed", allowed: "Store Manager", allow_self_approval: 1 },
    // A report that turns out to be nothing. Available to whoever raised it.
    { state: "Reported", action: "Cancel", next_state: "Cancelled", allowed: "Plant Manager", allow_self_approval: 1 },
    { state: "Reported", action: "Cancel as Maintenance", next_state: "Cancelled", allowed: "Store Maintenance Manager", allow_self_approval: 1 },
  ],
};

/** Workflow states and actions must exist as records before the workflow does. */
// Frappe accepts only these style names: "", Primary, Info, Success,
// Warning, Danger, Inverse. Colour carries urgency here - a breakdown nobody
// has looked at yet is the one that should catch the eye in a list.
export const WORKFLOW_STATES = [
  ["Reported", "Danger"],
  ["Under Repair", "Warning"],
  ["Repaired", "Success"],
  ["Closed", "Success"],
  ["Cancelled", "Inverse"],
];

export const WORKFLOW_ACTIONS = [
  "Start Repair",
  "Machine Running",
  "Close",
  "Cancel",
  "Cancel as Maintenance",
];

/* ------------------------------------------- changes to an existing install */

/**
 * The same additions, for an instance where these doctypes already exist.
 *
 * `scripts/syncMaintenance.js` never overwrites a DocType that is already
 * there, and it is right not to: pushing a DocType drops any column the new
 * definition omits, and dropping a column drops the data in it. So the fields
 * above are what a fresh instance gets, and these are how a running one catches
 * up.
 *
 * Custom Field is Frappe's own mechanism for exactly this. A field added this
 * way behaves identically to one declared on the doctype, and survives the next
 * push of the doctype itself — which is why the two lists can safely say the
 * same thing.
 *
 * Pushed by `scripts/syncBreakdownExtras.js`.
 */
/**
 * The output-lost fields, which the code above already expects.
 *
 * These replaced the rupee `loss_per_hour` in the doctype definition, and the
 * definition is only ever applied to a *fresh* instance — so on a running one
 * the fields did not exist while every query had already been rewritten to ask
 * for them. Frappe does not ignore an unknown field: it refuses the whole query
 * with `Field not permitted in query`, so `/api/breakdowns/machines`,
 * the breakdown list and the reliability report all failed outright, and the
 * pickers they feed came back empty.
 *
 * `loss_per_hour` is deliberately left in place rather than dropped. It holds
 * real figures, and there is no honest conversion from a rupee rate to kilos or
 * pieces — so the new fields start blank and are filled in per machine, which
 * is what the note on the doctype says should happen.
 */
export const MACHINE_CUSTOM_FIELDS = [
  {
    dt: "CMMS Machine",
    fieldname: "output_per_hour",
    label: "Output per Hour",
    fieldtype: "Float",
    insert_after: "running_hours_per_day",
    description: "What it makes in an hour, in the unit below",
  },
  {
    dt: "CMMS Machine",
    fieldname: "output_uom",
    label: "Output Unit",
    fieldtype: "Link",
    options: "UOM",
    insert_after: "output_per_hour",
    description: "kg for a mixing mill, nos for a press",
  },
];

export const BREAKDOWN_CUSTOM_FIELDS = [
  /**
   * The breakdown's own copy of the rate, and what the stoppage cost in output.
   *
   * The rate is fetched from the machine but only when blank, so a figure typed
   * on the record sticks — without `fetch_if_empty` Frappe re-fetches on every
   * save and the field looks editable while silently is not.
   */
  {
    dt: "CMMS Breakdown",
    fieldname: "output_per_hour",
    label: "Output per Hour",
    fieldtype: "Float",
    insert_after: "failure_mode",
    fetch_from: "machine.output_per_hour",
    fetch_if_empty: 1,
  },
  {
    dt: "CMMS Breakdown",
    fieldname: "output_uom",
    label: "Output Unit",
    fieldtype: "Link",
    options: "UOM",
    insert_after: "output_per_hour",
    fetch_from: "machine.output_uom",
    fetch_if_empty: 1,
  },
  {
    dt: "CMMS Breakdown",
    fieldname: "output_lost",
    label: "Output Lost",
    fieldtype: "Float",
    read_only: 1,
    insert_after: "actual_downtime_hours",
    description: "Downtime times the rate. Worked out at hand-over, never typed",
  },

  {
    dt: "CMMS Breakdown",
    fieldname: "repeat_failure",
    label: "Repeat Failure",
    fieldtype: "Check",
    default: "0",
    // After the root cause, because that is the stage where somebody is
    // actually in a position to answer it.
    insert_after: "root_cause",
    description: "This machine has failed this way before",
  },
  {
    dt: "CMMS Breakdown",
    fieldname: "repeat_of",
    label: "Repeat Of",
    fieldtype: "Link",
    options: "CMMS Breakdown",
    insert_after: "repeat_failure",
    depends_on: "eval:doc.repeat_failure",
    description: "The earlier breakdown, where one can be named",
  },
];

/**
 * Property Setters — changes to a field that already exists.
 *
 * A Custom Field cannot rename an existing one, and rewriting the DocType to
 * change a label would drop every column the rewrite omitted. Property Setter is
 * the supported way to override one property of one field, and it is what the
 * ERPNext desk itself writes when somebody edits a label in Customize Form.
 *
 * Only the label moves. `completed_at` keeps its fieldname, so every breakdown
 * already recorded against it is untouched — see the note on the field itself
 * for why the label changed.
 */
export const BREAKDOWN_PROPERTY_SETTERS = [
  {
    doctype_or_field: "DocField",
    doc_type: "CMMS Breakdown",
    field_name: "completed_at",
    property: "label",
    property_type: "Data",
    value: "Hand Over Time",
  },
];
