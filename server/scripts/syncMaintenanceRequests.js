import dotenv from "dotenv";

import { createDoc, docExists, getDoc, listDocs, updateDoc } from "../integrations/erpnext/client.js";
import { erpDisabledReason, erpHasCredentials } from "../integrations/erpnext/config.js";
import {
  REQUEST_DOCTYPES,
  REQUEST_ROLE_PERMS,
  REQUEST_WORKFLOW,
  REQUEST_WORKFLOW_ACTIONS,
  REQUEST_WORKFLOW_STATES,
} from "../integrations/erpnext/maintenanceRequestDoctypes.js";

dotenv.config();

/**
 * Creates the maintenance request record and the workflow that moves it.
 *
 *   node scripts/syncMaintenanceRequests.js --dry-run
 *   node scripts/syncMaintenanceRequests.js
 *
 * Run `syncMaintenance.js` first — this depends on CMMS Plant, CMMS Machine and
 * CMMS Breakdown Worker, and a Link or Table pointing at a doctype that does
 * not exist yet is refused on insert.
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

  // --- what this depends on ---------------------------------------------
  // Checked rather than assumed. A Table field pointing at a missing child
  // doctype fails with a message about a link, several layers from the real
  // cause, and the real cause is always "the other sync has not been run".
  step("Prerequisites");
  for (const needed of ["CMMS Plant", "CMMS Machine", "CMMS Breakdown Worker"]) {
    if (await docExists("DocType", needed)) {
      log(`  = ${needed} - present`);
      continue;
    }
    console.error(
      `\n${needed} does not exist. Run "node scripts/syncMaintenance.js" first — ` +
        "the request record links to it and cannot be created without it."
    );
    process.exit(1);
  }

  // --- doctypes, in dependency order ------------------------------------
  step("DocTypes");
  for (const definition of REQUEST_DOCTYPES) {
    await ensure(
      "DocType",
      definition.name,
      () => definition,
      definition.istable ? " (child table)" : ""
    );
  }

  // --- the role permissions the DocType itself could not carry -----------
  step("Role permissions");
  for (const definition of REQUEST_DOCTYPES) {
    if (definition.istable) continue; // a child table inherits its parent's

    // Frappe names a Custom DocPerm with a hash, not anything predictable, so
    // existence has to be checked by what it points at. Checking by a
    // constructed name would silently create a second copy on the next run.
    const existing = await listDocs("Custom DocPerm", {
      fields: ["role"],
      filters: [
        ["Custom DocPerm", "parent", "=", definition.name],
        ["Custom DocPerm", "permlevel", "=", 0],
      ],
      limit: 50,
    }).catch(() => []);
    const held = new Set(existing.map((row) => row.role));

    for (const perm of REQUEST_ROLE_PERMS) {
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
  //
  // Several are shared with the breakdown workflow — Closed and Cancelled are
  // the same records — which is why every one goes through `ensure` rather than
  // being created outright.
  step("Workflow states and actions");
  for (const [state, style] of REQUEST_WORKFLOW_STATES) {
    await ensure("Workflow State", state, () => ({
      doctype: "Workflow State",
      workflow_state_name: state,
      style,
    }));
  }
  for (const action of REQUEST_WORKFLOW_ACTIONS) {
    await ensure("Workflow Action Master", action, () => ({
      doctype: "Workflow Action Master",
      workflow_action_name: action,
    }));
  }

  // --- the workflow itself ----------------------------------------------
  step("Workflow");
  const created = await ensure(
    "Workflow",
    REQUEST_WORKFLOW.workflow_name,
    () => REQUEST_WORKFLOW
  );

  if (!created && !DRY) {
    // Already there. Make sure it is switched on rather than silently dormant,
    // which is how a workflow that exists still lets people edit freely.
    const wf = await getDoc("Workflow", REQUEST_WORKFLOW.workflow_name);
    if (!wf.is_active) {
      await updateDoc("Workflow", REQUEST_WORKFLOW.workflow_name, { is_active: 1 });
      log("  ! it existed but was inactive - switched on");
    }
  }

  step("Done");
  log(
    `${REQUEST_DOCTYPES.length} doctype(s), ${REQUEST_WORKFLOW_STATES.length} state(s), ` +
      `${REQUEST_WORKFLOW_ACTIONS.length} action(s), 1 workflow.`
  );
  log("Maintenance requests are separate from breakdowns from here on.");
};

main().catch((error) => {
  console.error("\nFailed:", error.message);
  process.exit(1);
});
