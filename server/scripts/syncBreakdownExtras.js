import dotenv from "dotenv";

import { createDoc, docExists, listDocs, updateDoc } from "../integrations/erpnext/client.js";
import { erpDisabledReason, erpHasCredentials } from "../integrations/erpnext/config.js";
import {
  BREAKDOWN_CUSTOM_FIELDS,
  BREAKDOWN_PROPERTY_SETTERS,
  MACHINE_CUSTOM_FIELDS,
} from "../integrations/erpnext/maintenanceDoctypes.js";

dotenv.config();

/**
 * Brings an existing CMMS Breakdown up to date.
 *
 *   node scripts/syncBreakdownExtras.js --dry-run
 *   node scripts/syncBreakdownExtras.js
 *
 * Three changes:
 *
 *   the repeat-failure flag and its link, added as Custom Fields
 *   the output-lost fields on the machine and the breakdown, likewise
 *   "Running Again At" relabelled "Hand Over Time", as a Property Setter
 *
 * The output fields are not optional. The code asks ERPNext for them by name,
 * and Frappe answers an unknown field by refusing the *whole* query — so until
 * this has run, the machine picker, the breakdown list and the reliability
 * report fail outright rather than degrade.
 *
 * Both are done this way because `syncMaintenance.js` never overwrites a
 * DocType that already exists — and it is right not to. Pushing a DocType drops
 * any column the new definition omits, and dropping a column drops the data in
 * it. Custom Field and Property Setter are Frappe's own mechanisms for changing
 * a doctype that is already carrying records.
 *
 * A fresh instance gets both from the doctype definition itself, so running
 * this there is a no-op that reports everything as already present.
 *
 * Safe to run again.
 */

const DRY = process.argv.includes("--dry-run");
const log = (...p) => console.log(...p);
const step = (t) => log(`\n=== ${t} ===`);

const main = async () => {
  if (!erpHasCredentials()) {
    console.error(`ERPNext credentials are not set (${erpDisabledReason()}).`);
    process.exit(1);
  }
  if (DRY) log("DRY RUN - nothing will be written.\n");

  step("Prerequisites");
  for (const needed of ["CMMS Machine", "CMMS Breakdown"]) {
    if (await docExists("DocType", needed)) {
      log(`  = ${needed} - present`);
      continue;
    }
    console.error(`\n${needed} does not exist. Run "node scripts/syncMaintenance.js" first.`);
    process.exit(1);
  }

  // --- the repeat-failure fields ----------------------------------------
  step("Custom Fields");
  for (const field of [...MACHINE_CUSTOM_FIELDS, ...BREAKDOWN_CUSTOM_FIELDS]) {
    // A Custom Field's name is "{doctype}-{fieldname}", but it is also possible
    // for the field to exist on the DocType itself on a fresh instance — in
    // which case adding a Custom Field for it would be a duplicate column.
    // Checked both ways.
    const onDoctype = await listDocs("DocField", {
      fields: ["name"],
      filters: [
        ["DocField", "parent", "=", field.dt],
        ["DocField", "fieldname", "=", field.fieldname],
      ],
      limit: 1,
    }).catch(() => []);

    // Named by doctype now that two are in play — "output_per_hour" alone
    // appears twice and says nothing about which one was added.
    const where = `${field.dt}.${field.fieldname}`;

    if (onDoctype.length) {
      log(`  = ${where} - already on the doctype`);
      continue;
    }

    const customName = `${field.dt}-${field.fieldname}`;
    if (await docExists("Custom Field", customName)) {
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

  // --- the relabel ------------------------------------------------------
  step("Property Setters");
  for (const setter of BREAKDOWN_PROPERTY_SETTERS) {
    // Frappe names these "{doctype}-{field}-{property}". Constructed rather
    // than searched because that name is stable and documented, unlike a
    // Custom DocPerm's.
    const name = `${setter.doc_type}-${setter.field_name}-${setter.property}`;

    if (await docExists("Property Setter", name)) {
      if (DRY) {
        log(`  = ${setter.field_name}.${setter.property} - already set, would confirm value`);
        continue;
      }
      // Present but possibly holding an older value — an earlier run of this
      // script, or somebody editing it in Customize Form. Written through so
      // the label in ERPNext matches the one this code believes it set.
      await updateDoc("Property Setter", name, { value: setter.value });
      log(`  = ${setter.field_name}.${setter.property} - already set, value confirmed`);
      continue;
    }
    if (DRY) {
      log(`  + ${setter.field_name}.${setter.property} = "${setter.value}" - would set`);
      continue;
    }

    await createDoc("Property Setter", { doctype: "Property Setter", ...setter });
    log(`  + ${setter.field_name}.${setter.property} = "${setter.value}" - set`);
  }

  step("Done");
  log("Repeat failures can be flagged at closing, and downtime is measured to the hand-over.");
  log("The machine picker, the breakdown list and the report can read their fields again.");
  log("Nothing already recorded has moved: completed_at keeps its fieldname and its values,");
  log("and loss_per_hour is left alone - output is a different figure in a different unit,");
  log("so it starts blank and is filled in per machine.");
};

main().catch((error) => {
  console.error("\nFailed:", error.message);
  process.exit(1);
});
