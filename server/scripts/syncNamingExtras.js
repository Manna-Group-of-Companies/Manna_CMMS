import dotenv from "dotenv";

import { createDoc, docExists, getDoc, listDocs, updateDoc } from "../integrations/erpnext/client.js";
import { erpDisabledReason, erpHasCredentials } from "../integrations/erpnext/config.js";
import {
  NAMING_CUSTOM_FIELDS,
  NAMING_REQUEST_DOCTYPE,
  NAMING_REQUEST_WORKFLOW,
  NAMING_ROLE_PERMS,
  NAMING_TRANSITION_ROLES,
} from "../integrations/erpnext/namingRequestDoctype.js";

dotenv.config();

/**
 * Brings an existing CMMS Item Naming Request up to date.
 *
 *   node scripts/syncNamingExtras.js --dry-run
 *   node scripts/syncNamingExtras.js
 *
 * Three changes:
 *
 *   `plant` added, so the queue says which site wanted the name
 *   the approver moved from the plant heads to the VP Operations
 *   a Custom DocPerm for VP Operations, who now has to be able to write
 *
 * All three are done this way because `syncNamingRequest.js` never overwrites
 * something that already exists - and it is right not to. Pushing a DocType
 * drops any column the new definition omits, and dropping a column drops the
 * data in it. Custom Field and a targeted child-table edit are the mechanisms
 * Frappe provides for changing a doctype that is already carrying records.
 *
 * A fresh instance gets all of it from the definitions themselves, so running
 * this there reports everything as already present.
 *
 * Safe to run again.
 */

const DRY = process.argv.includes("--dry-run");
const log = (...p) => console.log(...p);
const step = (t) => log(`\n=== ${t} ===`);

const DT = NAMING_REQUEST_DOCTYPE.name;

const main = async () => {
  if (!erpHasCredentials()) {
    console.error(`ERPNext credentials are not set (${erpDisabledReason()}).`);
    process.exit(1);
  }
  if (DRY) log("DRY RUN - nothing will be written.\n");

  step("Prerequisites");
  for (const [doctype, name] of [
    ["DocType", DT],
    ["DocType", "CMMS Plant"],
    ["Role", "VP Operations"],
  ]) {
    if (!(await docExists(doctype, name))) {
      console.error(`\n${doctype} "${name}" does not exist. Nothing was changed.`);
      process.exit(1);
    }
    log(`  = ${doctype} ${name} - present`);
  }

  // --- the plant field ----------------------------------------------------
  step("Custom Fields");
  for (const field of NAMING_CUSTOM_FIELDS) {
    const where = `${field.dt}.${field.fieldname}`;

    /**
     * The field may already be on the doctype itself on a fresh instance, in
     * which case a Custom Field would be a duplicate column.
     *
     * `DocField` is not listable with a key whose access comes only from
     * System Manager - it answers PermissionError - so a failure here is read
     * as "not on the doctype" and the Custom Field check below decides. That is
     * the safe direction: creating a duplicate is refused by name, whereas
     * skipping wrongly would leave the field missing.
     */
    const onDoctype = await listDocs("DocField", {
      fields: ["name"],
      filters: [
        ["DocField", "parent", "=", field.dt],
        ["DocField", "fieldname", "=", field.fieldname],
      ],
      limit: 1,
    }).catch(() => []);

    if (onDoctype.length) {
      log(`  = ${where} - already on the doctype`);
      continue;
    }
    if (await docExists("Custom Field", `${field.dt}-${field.fieldname}`)) {
      log(`  = ${where} - already added`);
      continue;
    }
    if (DRY) {
      log(`  + ${where} (${field.fieldtype}) - would add`);
      continue;
    }
    await createDoc("Custom Field", { doctype: "Custom Field", ...field });
    log(`  + ${where} (${field.fieldtype}) - added`);
  }

  // --- who may decide -----------------------------------------------------
  step("Workflow transitions");
  const workflow = await getDoc("Workflow", NAMING_REQUEST_WORKFLOW.workflow_name);
  const before = workflow.transitions || [];

  const isDecision = (t) => t.action === "Approve" || t.action === "Reject";
  const dropped = before.filter(
    (t) => isDecision(t) && NAMING_TRANSITION_ROLES.remove.includes(t.allowed)
  );
  const kept = before.filter((t) => !dropped.includes(t));

  // Whatever the target roles are, exactly once each, for both decisions.
  const missing = [];
  for (const action of ["Approve", "Reject"]) {
    for (const role of NAMING_TRANSITION_ROLES.approve) {
      const has = kept.some(
        (t) => t.action === action && t.allowed === role && t.state === "Awaiting Approval"
      );
      if (!has) {
        missing.push({
          state: "Awaiting Approval",
          action,
          next_state: action === "Approve" ? "Approved" : "Rejected",
          allowed: role,
          allow_self_approval: 1,
        });
      }
    }
  }

  for (const t of dropped) log(`  - ${t.action} by ${t.allowed} - remove`);
  for (const t of missing) log(`  + ${t.action} by ${t.allowed} - add`);
  if (!dropped.length && !missing.length) log("  = already as intended");

  if ((dropped.length || missing.length) && !DRY) {
    await updateDoc("Workflow", workflow.name, {
      // The whole child table, because Frappe replaces a table it is given
      // rather than merging into it. Sending only the additions would silently
      // delete the rows that are meant to stay.
      transitions: [...kept, ...missing].map((t) => ({
        state: t.state,
        action: t.action,
        next_state: t.next_state,
        allowed: t.allowed,
        allow_self_approval: t.allow_self_approval ? 1 : 0,
      })),
    });
    log("  workflow updated");
  }

  // --- who may read and write it -----------------------------------------
  step("Role permissions");
  const existing = await listDocs("Custom DocPerm", {
    fields: ["role"],
    filters: [
      ["Custom DocPerm", "parent", "=", DT],
      ["Custom DocPerm", "permlevel", "=", 0],
    ],
    limit: 50,
  }).catch(() => []);
  const have = new Set(existing.map((r) => r.role));

  for (const perm of NAMING_ROLE_PERMS) {
    if (have.has(perm.role)) {
      log(`  = ${perm.role} - already granted`);
      continue;
    }
    if (DRY) {
      log(`  + ${perm.role} - would grant`);
      continue;
    }
    await createDoc("Custom DocPerm", {
      doctype: "Custom DocPerm",
      parent: DT,
      parenttype: "DocType",
      parentfield: "permissions",
      permlevel: 0,
      ...perm,
    });
    log(`  + ${perm.role} - granted`);
  }

  log("\nDone.");
};

main().catch((error) => {
  console.error("\nFailed:", error.message);
  process.exit(1);
});
