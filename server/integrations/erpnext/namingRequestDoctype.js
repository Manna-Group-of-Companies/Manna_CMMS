/**
 * The item naming request: the one request flow the store still has.
 *
 * Stock arrives that nobody has a name for. The Maintenance Manager proposes
 * one against the naming convention, the VP Operations approves it, and only
 * then does it become a catalog item and go to SAP.
 *
 * The DocType that was here before this one - `CMMS Product Request` - was
 * built for a wider flow that has since been cut: it carried a warehouse, an
 * opening quantity and an ADD/EDIT switch, named the raiser a "supervisor",
 * and had no workflow at all, so its `status` field could be set to Approved
 * by typing the word. It also had nowhere to record what SAP said. It holds no
 * records and is superseded by this.
 */

const PERMISSIONS = [
  { role: "System Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1, share: 1 },
];

const f = (fieldname, label, fieldtype, extra = {}) => ({ fieldname, label, fieldtype, ...extra });
const link = (fieldname, label, target, extra = {}) =>
  f(fieldname, label, "Link", { options: target, ...extra });
const select = (fieldname, label, options, extra = {}) =>
  f(fieldname, label, "Select", { options: options.join("\n"), ...extra });
const check = (fieldname, label, extra = {}) => f(fieldname, label, "Check", { default: "0", ...extra });

export const NAMING_REQUEST_DOCTYPE = {
  doctype: "DocType",
  name: "CMMS Item Naming Request",
  module: "Custom",
  custom: 1,
  istable: 0,
  editable_grid: 0,
  track_changes: 1,
  allow_rename: 0,
  naming_rule: "Expression",
  autoname: "format:ITEM-REQ-{YYYY}-{#####}",
  permissions: PERMISSIONS,
  fields: [
    // --- what is being named ---------------------------------------------
    f("proposed_name", "Proposed Name", "Data", { reqd: 1, in_list_view: 1, length: 140 }),

    /**
     * The parts the name was built from, as the builder produced them.
     *
     * Kept so the request can be reopened in the builder rather than retyped,
     * and so a name can be traced back to the convention that produced it.
     * `proposed_name` stays the authoritative value - a name typed directly,
     * which the convention allows, has no parts behind it at all.
     */
    f("naming_parts", "Naming Parts (JSON)", "Long Text", { read_only: 1 }),
    check("name_compliant", "Meets the naming convention", { read_only: 1 }),
    f("naming_issues", "Naming Issues", "Small Text", { read_only: 1 }),

    /**
     * The site the request came from.
     *
     * The queue used to say who raised a name but not which company wanted it,
     * so a list of pending names read the same whether every one of them came
     * from one plant or from four.
     *
     * Deliberately not `reqd` on the DocType. Two requests already exist
     * without it, and a required field added underneath them would make those
     * records unsavable - including by the very screen somebody would use to
     * fill the field in. It is required by `raiseRequest` instead, so
     * everything new carries it and the two old ones can still be edited.
     *
     * CMMS Plant rather than ERPNext Company on purpose: stock is not split by
     * company here (every store is a warehouse under MRPPL), and CMMS Plant is
     * already what people and permissions are scoped by.
     */
    link("plant", "Plant", "CMMS Plant", { in_list_view: 1 }),

    link("item_group", "Item Group", "Item Group", { reqd: 1, in_list_view: 1 }),
    link("uom", "Unit", "UOM", { reqd: 1 }),
    f("brand", "Brand", "Data"),
    f("rack_location", "Rack Location", "Data"),
    f("min_stock", "Minimum Stock", "Float"),
    f("description", "Description", "Small Text"),
    // Why it is being added at all. The answer is almost always "it arrived
    // with a machine" or "the old one has no name", and knowing which is what
    // stops the catalog filling with one-off spares nobody stocks again.
    f("reason", "Why it is needed", "Small Text"),

    link("raised_by", "Raised By", "User", { reqd: 1, read_only: 1, in_list_view: 1 }),
    f("raised_at", "Raised At", "Datetime", { read_only: 1 }),

    // The state is moved by a workflow action, never by typing - which is the
    // whole difference between this and the DocType it replaces.
    select(
      "workflow_state",
      "Status",
      ["Awaiting Approval", "Approved", "In SAP", "Rejected"],
      { default: "Awaiting Approval", read_only: 1, in_list_view: 1 }
    ),

    // --- the decision -----------------------------------------------------
    link("decided_by", "Decided By", "User", { read_only: 1 }),
    f("decided_at", "Decided At", "Datetime", { read_only: 1 }),
    f("decision_note", "Note", "Small Text"),

    /**
     * The catalog item this became.
     *
     * Created on approval, not on the push, so the store can stock and issue
     * the part while SAP is still being dealt with. Its `custom_sap_item_code`
     * stays empty until the push succeeds, exactly as it does for the 654
     * items that came across from the store's own workbook.
     */
    link("erp_item", "Catalog Item", "Item", { read_only: 1 }),

    // --- SAP --------------------------------------------------------------
    f("sap_item_code", "SAP Item Code", "Data", { read_only: 1, in_list_view: 1 }),
    link("pushed_by", "Pushed By", "User", { read_only: 1 }),
    f("pushed_at", "Pushed At", "Datetime", { read_only: 1 }),
    /**
     * Whatever SAP said, kept verbatim.
     *
     * This is the first system to write into SAP, so the response to a push -
     * success or refusal - is the most valuable thing here. A refusal reduced to
     * "failed" would have to be reproduced by hand to be understood.
     */
    f("sap_response", "SAP Response", "Small Text", { read_only: 1 }),
  ],
};

/**
 * The workflow.
 *
 * Short on purpose. Naming is not a project; it is one person proposing and
 * one person agreeing. The value is that agreeing is a transition ERPNext
 * enforces and stamps, rather than a dropdown anybody can set.
 *
 * "In SAP" is reached by the push succeeding, not by a person choosing it, so
 * that state can only ever mean the item is really there.
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
export const NAMING_REQUEST_WORKFLOW = {
  doctype: "Workflow",
  workflow_name: "CMMS Item Naming Flow",
  document_type: "CMMS Item Naming Request",
  workflow_state_field: "workflow_state",
  is_active: 1,
  send_email_alert: 0,
  states: [
    { state: "Awaiting Approval", doc_status: "0", allow_edit: "Store Maintenance Manager" },
    { state: "Approved", doc_status: "0", allow_edit: "Store Manager" },
    { state: "In SAP", doc_status: "0", allow_edit: "Store Manager" },
    { state: "Rejected", doc_status: "0", allow_edit: "Store Manager" },
  ],
  transitions: [
    /**
     * The VP Operations decides. Deliberately not the person who proposed the
     * name: a naming convention that the same person writes and approves is a
     * convention in name only.
     *
     * The plant heads used to be here as well, which meant every naming request
     * went to all four of them and to the Admin - five people asked to agree a
     * name, and a queue that is everybody's is nobody's. The catalog is not
     * split by plant either, so a plant head approving a name was approving it
     * for the whole group, which is not their call to make. One approver, and
     * it is the operations office.
     *
     * The Admin keeps the transition because somebody has to be able to unblock
     * a queue when the VP is away; that is an administrator's job, not a second
     * opinion on naming.
     *
     * Two rows per action rather than one, because a Frappe transition names a
     * single role - "allowed" is a Link to Role, not a list. Both rows are the
     * same transition; whichever role the person holds matches one of them.
     */
    {
      state: "Awaiting Approval",
      action: "Approve",
      next_state: "Approved",
      allowed: "Store Manager",
      allow_self_approval: 1,
    },
    {
      state: "Awaiting Approval",
      action: "Approve",
      next_state: "Approved",
      allowed: "VP Operations",
      allow_self_approval: 1,
    },
    {
      state: "Awaiting Approval",
      action: "Reject",
      next_state: "Rejected",
      allowed: "Store Manager",
      allow_self_approval: 1,
    },
    {
      state: "Awaiting Approval",
      action: "Reject",
      next_state: "Rejected",
      allowed: "VP Operations",
      allow_self_approval: 1,
    },
    // Sending it back rather than rejecting outright, for a name that is
    // nearly right. Without this the only way to fix a typo is to reject and
    // have the whole thing raised again.
    {
      state: "Rejected",
      action: "Reopen",
      next_state: "Awaiting Approval",
      allowed: "Store Maintenance Manager",
      allow_self_approval: 1,
    },
    {
      state: "Approved",
      action: "Mark In SAP",
      next_state: "In SAP",
      allowed: "Store Manager",
      allow_self_approval: 1,
    },
  ],
};

/**
 * Changes to a CMMS Item Naming Request that already exists.
 *
 * `syncNamingRequest.js` only ever *creates* - and it is right not to overwrite,
 * because pushing a DocType drops any column the new definition omits and
 * dropping a column drops its data. So the field list above is what a fresh
 * instance gets, and this is how a running one catches up.
 *
 * Pushed by `scripts/syncNamingExtras.js`.
 */
export const NAMING_CUSTOM_FIELDS = [
  {
    dt: "CMMS Item Naming Request",
    fieldname: "plant",
    label: "Plant",
    fieldtype: "Link",
    options: "CMMS Plant",
    insert_after: "naming_issues",
    description: "The site the request came from",
  },
];

/**
 * The transitions this workflow should end up with, replacing what is there.
 *
 * Stated as a whole rather than as a patch: a workflow's transitions are a
 * child table, and reconciling one row at a time is how you end up with two
 * approvers because a delete failed quietly.
 */
export const NAMING_TRANSITION_ROLES = {
  /** Removed. Naming is not a plant head's decision - see the workflow note. */
  remove: ["Plant Manager"],
  /** The approver, plus the Admin so a queue is not stuck when they are away. */
  approve: ["Store Manager", "VP Operations"],
};

export const NAMING_WORKFLOW_STATES = [
  ["Awaiting Approval", "Warning"],
  ["Approved", "Info"],
  ["In SAP", "Success"],
  ["Rejected", "Danger"],
];

export const NAMING_WORKFLOW_ACTIONS = ["Approve", "Reject", "Reopen", "Mark In SAP"];

/** Who may do what with a naming request, beyond System Manager. */
export const NAMING_ROLE_PERMS = [
  /**
   * System Manager first, and never omitted.
   *
   * Once ANY Custom DocPerm exists for a DocType, Frappe uses those instead of
   * the permissions on the DocType itself - it does not merge them. Granting
   * the store roles here without naming System Manager therefore revokes it,
   * silently, and the integration account loses the DocType entirely. That is
   * exactly what happened to this one: it read fine until the API key was
   * reissued against an account whose access came only from System Manager.
   */
  { role: "System Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1, share: 1 },
  { role: "Store Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1 },
  { role: "Store Maintenance Manager", read: 1, write: 1, create: 1, report: 1, export: 1 },
  // The approver. Write but not create: deciding a name is not proposing one.
  { role: "VP Operations", read: 1, write: 1, report: 1, export: 1 },
  { role: "Store Supervisor", read: 1, report: 1 },
  /**
   * Plant Manager is deliberately absent, and this is the whole of the change:
   * naming is raised by maintenance and agreed by operations, and a plant head
   * has no part in it. They cannot read the queue, cannot create a request and
   * cannot decide one. The screen is gone from their menu too - see
   * `itemNaming` in config/access.js.
   */
];
