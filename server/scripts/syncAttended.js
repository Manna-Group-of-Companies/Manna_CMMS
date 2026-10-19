import dotenv from "dotenv";

import { createDoc, docExists, getDoc, listDocs, updateDoc } from "../integrations/erpnext/client.js";
import { erpDisabledReason, erpHasCredentials } from "../integrations/erpnext/config.js";
import { STAGES } from "../integrations/erpnext/breakdownStages.js";
import { REQUEST_STAGES } from "../integrations/erpnext/maintenanceRequestStages.js";

dotenv.config();

/**
 * The "Attended" step (20 Oct 2026), in ERPNext.
 *
 *   node scripts/syncAttended.js --dry-run
 *   node scripts/syncAttended.js
 *
 * Maintenance marks a breakdown or a maintenance request as seen before any
 * work starts. ERPNext needs four things for that, on both doctypes:
 *
 *   - the "Attended" Workflow State and the "Attend" Workflow Action;
 *   - the state in each workflow, and a transition for every step that now
 *     starts from it or ends in it - one per role, the System Manager row
 *     included, since the application applies every step as the integration
 *     account (see syncWorkflowServiceRole.js);
 *   - "Attended" among the Status options, or ERPNext refuses to save it;
 *   - the attended_by / attended_at fields the step stamps.
 *
 * Only adds. Every existing state, transition and field is left as it is, so
 * a record already past Reported is untouched. Safe to run again.
 */

const DRY = process.argv.includes("--dry-run");
const log = (...p) => console.log(...p);
const NL = "\n";

// The ERPNext roles behind each CMMS role, as the transitions name them. The
// System Manager is the integration account's role, which is what ERPNext
// actually checks.
const ERP_ROLES = {
  Manager: ["Store Manager", "System Manager"],
  "Maintenance Manager": ["Store Maintenance Manager"],
  "Production Manager": ["Plant Manager"],
  Supervisor: ["Store Supervisor"],
};

const FLOWS = [
  { doctype: "CMMS Breakdown", workflow: "CMMS Breakdown Flow", stages: STAGES },
  { doctype: "CMMS Maintenance Request", workflow: "CMMS Maintenance Request Flow", stages: REQUEST_STAGES },
];

const FIELDS = [
  { fieldname: "attended_by", label: "Attended By", fieldtype: "Link", options: "User", read_only: 1 },
  { fieldname: "attended_at", label: "Attended At", fieldtype: "Datetime", read_only: 1 },
];

const fromsOf = (stage) => [stage.from, ...(stage.alsoFrom || [])];

/** The states in the order the flow reaches them. */
const statesOf = (stages) => [
  ...new Set(Object.values(stages).flatMap((s) => [...fromsOf(s), s.to])),
];

const syncWorkflow = async ({ workflow: name, stages }) => {
  log(`\n=== ${name} ===`);
  const workflow = await getDoc("Workflow", name);
  const rows = workflow.transitions || [];
  const states = workflow.states || [];
  const known = new Set(states.map((x) => x.state));

  const newStates = statesOf(stages)
    .filter((state) => !known.has(state))
    .map((state) => ({ state, doc_status: "0", allow_edit: "Store Maintenance Manager" }));

  // The ERPNext action a step uses: its own erpAction or name.
  const has = new Set(rows.map((t) => `${t.state}|${t.action}|${t.next_state}|${t.allowed}`));
  const missing = [];
  for (const [action, stage] of Object.entries(stages)) {
    const erpAction = stage.erpAction || action;
    for (const from of fromsOf(stage)) {
      // Only the rows into and out of Attended; the rest of the flow is as it was.
      if (from !== "Attended" && stage.to !== "Attended") continue;
      const roles = new Set(stage.allowedRoles.flatMap((r) => ERP_ROLES[r] || []));
      roles.add("System Manager");
      for (const role of roles) {
        const key = `${from}|${erpAction}|${stage.to}|${role}`;
        if (has.has(key)) continue;
        has.add(key);
        missing.push({ state: from, action: erpAction, next_state: stage.to, allowed: role, allow_self_approval: 1 });
      }
    }
  }

  for (const x of newStates) log(`  + state "${x.state}"`);
  for (const t of missing) log(`  + ${t.state} -> ${t.next_state} as "${t.action}" for ${t.allowed}`);
  if (!newStates.length && !missing.length) {
    log("  = already as intended");
    return;
  }
  if (DRY) return;

  for (const x of newStates) {
    if (!(await docExists("Workflow State", x.state))) {
      await createDoc("Workflow State", { workflow_state_name: x.state, style: "Primary" });
    }
  }
  for (const action of new Set(missing.map((t) => t.action))) {
    if (!(await docExists("Workflow Action Master", action))) {
      await createDoc("Workflow Action Master", { workflow_action_name: action });
    }
  }
  await updateDoc("Workflow", name, {
    // Whole tables: Frappe replaces a child table it is given.
    states: [...states, ...newStates].map((x) => ({
      state: x.state,
      doc_status: x.doc_status ?? "0",
      allow_edit: x.allow_edit,
      update_field: x.update_field || null,
      update_value: x.update_value || null,
      is_optional_state: x.is_optional_state ? 1 : 0,
      message: x.message || null,
    })),
    transitions: [...rows, ...missing].map((t) => ({
      state: t.state,
      action: t.action,
      next_state: t.next_state,
      allowed: t.allowed,
      allow_self_approval: t.allow_self_approval ? 1 : 0,
      condition: t.condition || null,
    })),
  });
  log(`  ${newStates.length} state(s), ${missing.length} transition(s) added`);
};

const syncFields = async ({ doctype, stages }) => {
  log(`\n=== ${doctype} ===`);
  const meta = await getDoc("DocType", doctype);
  const fields = meta.fields || [];
  const custom = await listDocs("Custom Field", { filters: [["dt", "=", doctype]], fields: ["fieldname"], limit: 500 });
  const present = new Set([...fields, ...custom].map((x) => x.fieldname));
  const adding = FIELDS.filter((x) => !present.has(x.fieldname));
  for (const x of adding) log(`  + field ${x.fieldname}`);

  // Added as a Property Setter, so nothing else on the DocType is rewritten.
  const [setter] = await listDocs("Property Setter", {
    filters: [["doc_type", "=", doctype], ["field_name", "=", "workflow_state"], ["property", "=", "options"]],
    fields: ["name", "value"],
  });
  const status = fields.find((x) => x.fieldname === "workflow_state");
  const options = String(setter?.value ?? status?.options ?? "").split(NL).map((x) => x.trim()).filter(Boolean);
  const reached = statesOf(stages);
  const newOptions = reached.filter((x) => !options.includes(x));
  for (const x of newOptions) log(`  + Status option "${x}"`);

  if (!adding.length && !newOptions.length) {
    log("  = already as intended");
    return;
  }
  if (DRY) return;

  let after = fields[fields.length - 1]?.fieldname;
  for (const x of adding) {
    await createDoc("Custom Field", { dt: doctype, ...x, insert_after: after });
    after = x.fieldname;
  }
  if (newOptions.length) {
    const value = [...reached, ...options.filter((x) => !reached.includes(x))].join(NL);
    if (setter) {
      await updateDoc("Property Setter", setter.name, { value });
    } else {
      await createDoc("Property Setter", {
        doctype_or_field: "DocField",
        doc_type: doctype,
        field_name: "workflow_state",
        property: "options",
        property_type: "Text",
        value,
      });
    }
  }
  log("  done");
};

const main = async () => {
  if (!erpHasCredentials()) {
    console.error(`ERPNext credentials are not set (${erpDisabledReason()}).`);
    process.exit(1);
  }
  if (DRY) log("DRY RUN - nothing will be written.");
  // Fields and options first: a workflow state the Status field does not offer
  // would be refused the first time a record entered it.
  for (const flow of FLOWS) await syncFields(flow);
  for (const flow of FLOWS) await syncWorkflow(flow);
  log("\nDone.");
};

main().catch((error) => {
  console.error("\nFailed:", error.message);
  process.exit(1);
});
