import dotenv from "dotenv";

import { createDoc, docExists, getDoc, listDocs, updateDoc } from "../integrations/erpnext/client.js";
import { erpDisabledReason, erpHasCredentials } from "../integrations/erpnext/config.js";
import {
  MAINTENANCE_DOCTYPES,
  BREAKDOWN_WORKFLOW,
  WORKFLOW_STATES,
  WORKFLOW_ACTIONS,
  EXTRA_ROLE_PERMS,
} from "../integrations/erpnext/maintenanceDoctypes.js";

dotenv.config();

/**
 * Creates Module 2 in ERPNext: the plant and machine registers, the breakdown
 * record, and the workflow that moves it between roles.
 *
 *   node scripts/syncMaintenance.js --dry-run
 *   node scripts/syncMaintenance.js
 *
 * Safe to run again. Anything already present is left alone rather than
 * overwritten, because overwriting a DocType drops columns and dropping a
 * column drops the data in it.
 */

const DRY = process.argv.includes("--dry-run");
const log = (...p) => console.log(...p);
const step = (t) => log(`\n=== ${t} ===`);

const ensure = async (doctype, name, build, label = "") => {
  if (await docExists(doctype, name)) {
    log(`  = ${name}${label} - already present`);
    return false;
  }
  if (DRY) {
    log(`  + ${name}${label} - would create`);
    return true;
  }
  await createDoc(doctype, build());
  log(`  + ${name}${label} - created`);
  return true;
};

const main = async () => {
  if (!erpHasCredentials()) {
    console.error(`ERPNext credentials are not set (${erpDisabledReason()}).`);
    process.exit(1);
  }
  if (DRY) log("DRY RUN - nothing will be written.\n");

  // --- the role the Plant Manager signs in with -------------------------
  step("Role");
  await ensure("Role", "Plant Manager", () => ({
    doctype: "Role",
    role_name: "Plant Manager",
    desk_access: 1,
    is_custom: 1,
  }));

  // --- doctypes, in dependency order ------------------------------------
  step("DocTypes");
  for (const definition of MAINTENANCE_DOCTYPES) {
    await ensure(
      "DocType",
      definition.name,
      () => definition,
      definition.istable ? " (child table)" : ""
    );
  }

  // --- the role permissions the DocType itself could not carry -----------
  step("Role permissions");
  for (const definition of MAINTENANCE_DOCTYPES) {
    if (definition.istable) continue;   // a child table inherits its parent's
    // Frappe names a Custom DocPerm with a hash, not anything predictable, so
    // existence has to be checked by what it points at. Checking by a
    // constructed name silently created a second copy of all nine on the
    // second run.
    const existing = await listDocs("Custom DocPerm", {
      fields: ["role"],
      filters: [
        ["Custom DocPerm", "parent", "=", definition.name],
        ["Custom DocPerm", "permlevel", "=", 0],
      ],
      limit: 50,
    });
    const held = new Set(existing.map((row) => row.role));

    for (const perm of EXTRA_ROLE_PERMS) {
      if (held.has(perm.role)) {
        log(`  = ${definition.name} / ${perm.role} - already present`);
        continue;
      }
      if (DRY) {
        log(`  + ${definition.name} / ${perm.role} - would grant`);
        continue;
      }
      await createDoc("Custom DocPerm", {
        doctype: "Custom DocPerm",
        parent: definition.name,
        parenttype: "DocType",
        parentfield: "permissions",
        permlevel: 0,
        ...perm,
      });
      log(`  + ${definition.name} / ${perm.role} - granted`);
    }
  }

  // --- workflow scaffolding ---------------------------------------------
  // Frappe creates these from the UI automatically; over the API they have to
  // exist before a Workflow can reference them, or the save fails on a link.
  step("Workflow states and actions");
  for (const [state, style] of WORKFLOW_STATES) {
    await ensure("Workflow State", state, () => ({
      doctype: "Workflow State",
      workflow_state_name: state,
      style,
    }));
  }
  for (const action of WORKFLOW_ACTIONS) {
    await ensure("Workflow Action Master", action, () => ({
      doctype: "Workflow Action Master",
      workflow_action_name: action,
    }));
  }

  // --- the workflow itself ----------------------------------------------
  step("Workflow");
  const created = await ensure(
    "Workflow",
    BREAKDOWN_WORKFLOW.workflow_name,
    () => BREAKDOWN_WORKFLOW
  );

  if (!created && !DRY) {
    // Already there. Make sure it is switched on rather than silently dormant,
    // which is how a workflow that exists still lets people edit freely.
    const wf = await getDoc("Workflow", BREAKDOWN_WORKFLOW.workflow_name);
    if (!wf.is_active) {
      await updateDoc("Workflow", BREAKDOWN_WORKFLOW.workflow_name, { is_active: 1 });
      log("  ! it existed but was inactive - switched on");
    }
  }

  step("Done");
  log(`${MAINTENANCE_DOCTYPES.length} doctype(s), ${WORKFLOW_STATES.length} state(s), ` +
      `${WORKFLOW_ACTIONS.length} action(s), 1 workflow.`);
};

main().catch((error) => {
  console.error("\nMaintenance setup failed:", error.message);
  process.exit(1);
});
