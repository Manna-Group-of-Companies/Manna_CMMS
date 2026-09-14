import dotenv from "dotenv";

import { createDoc, docExists, listDocs } from "../integrations/erpnext/client.js";
import { erpDisabledReason, erpHasCredentials } from "../integrations/erpnext/config.js";
import {
  NAMING_REQUEST_DOCTYPE,
  NAMING_REQUEST_WORKFLOW,
  NAMING_ROLE_PERMS,
  NAMING_WORKFLOW_ACTIONS,
  NAMING_WORKFLOW_STATES,
} from "../integrations/erpnext/namingRequestDoctype.js";

dotenv.config();

/**
 * Creates the item naming request DocType and its workflow in ERPNext.
 *
 *   node scripts/syncNamingRequest.js --dry-run
 *   node scripts/syncNamingRequest.js
 *
 * Re-running is a no-op: anything already there is left alone.
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

  step("DocType");
  await ensure("DocType", NAMING_REQUEST_DOCTYPE.name, () => NAMING_REQUEST_DOCTYPE);

  step("Role permissions");
  // Frappe names a Custom DocPerm with a hash rather than anything predictable,
  // so existence is checked by what it points at. Checking by a constructed
  // name silently created a second copy of every row on the second run.
  const existing = await listDocs("Custom DocPerm", {
    fields: ["role"],
    filters: [
      ["Custom DocPerm", "parent", "=", NAMING_REQUEST_DOCTYPE.name],
      ["Custom DocPerm", "permlevel", "=", 0],
    ],
    limit: 50,
  });
  const held = new Set(existing.map((r) => r.role));

  for (const perm of NAMING_ROLE_PERMS) {
    if (held.has(perm.role)) {
      log(`  = ${perm.role} - already granted`);
      continue;
    }
    if (DRY) {
      log(`  + ${perm.role} - would grant`);
      continue;
    }
    await createDoc("Custom DocPerm", {
      doctype: "Custom DocPerm",
      parent: NAMING_REQUEST_DOCTYPE.name,
      parenttype: "DocType",
      parentfield: "permissions",
      permlevel: 0,
      ...perm,
    });
    log(`  + ${perm.role} - granted`);
  }

  // Frappe creates these from the UI automatically; over the API they have to
  // exist before a Workflow can reference them, or the save fails on a link.
  step("Workflow states and actions");
  for (const [state, style] of NAMING_WORKFLOW_STATES) {
    await ensure("Workflow State", state, () => ({
      doctype: "Workflow State",
      workflow_state_name: state,
      style,
    }));
  }
  for (const action of NAMING_WORKFLOW_ACTIONS) {
    await ensure("Workflow Action Master", action, () => ({
      doctype: "Workflow Action Master",
      workflow_action_name: action,
    }));
  }

  step("Workflow");
  await ensure(
    "Workflow",
    NAMING_REQUEST_WORKFLOW.workflow_name,
    () => NAMING_REQUEST_WORKFLOW
  );

  step("Done");
  log("Approval is now a workflow transition, not a field anybody can type into.");
};

main().catch((error) => {
  console.error("\nFailed:", error.message);
  process.exit(1);
});
