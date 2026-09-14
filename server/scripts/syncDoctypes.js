import dotenv from "dotenv";

import { createDoc, getDoc } from "../integrations/erpnext/client.js";
import { erpDisabledReason, erpEnabled } from "../integrations/erpnext/config.js";
import { DOCTYPES, LATE_FIELDS } from "../integrations/erpnext/doctypes.js";

dotenv.config();

/**
 * Creates the CMMS custom DocTypes in ERPNext.
 *
 *   node scripts/syncDoctypes.js --dry-run
 *   node scripts/syncDoctypes.js
 *
 * Needs only the ERPNext credentials — no database. Safe to run again: a
 * DocType that already exists is left alone rather than overwritten, because
 * overwriting one drops columns, and dropping a column drops the data in it.
 *
 * Changing an existing DocType is deliberately not automated. Adding a field
 * is safe and removing one is not, and a script cannot tell which a diff
 * intends. Add fields in the ERPNext UI, then reflect the change in
 * integrations/erpnext/doctypes.js so the file stays the source of truth.
 */

const DRY_RUN = process.argv.includes("--dry-run");

const log = (...parts) => console.log(...parts);

const exists = async (name) => {
  try {
    await getDoc("DocType", name);
    return true;
  } catch (error) {
    if (error?.status === 404) return false;
    throw error;
  }
};

const main = async () => {
  if (!erpEnabled()) {
    console.error(`ERPNext is not configured (${erpDisabledReason()}).`);
    process.exit(1);
  }

  log(`${DOCTYPES.length} DocType(s) defined.${DRY_RUN ? " DRY RUN - nothing will be written." : ""}\n`);

  let created = 0;
  let present = 0;
  const failures = [];

  for (const definition of DOCTYPES) {
    const label = definition.istable ? `${definition.name} (child table)` : definition.name;

    if (await exists(definition.name)) {
      log(`  = ${label} - already present`);
      present += 1;
      continue;
    }
    if (DRY_RUN) {
      log(`  + ${label} - would create, ${definition.fields.length} field(s)`);
      continue;
    }

    try {
      // Serial, and in the order the file declares. A Link or Table target is
      // validated on insert, so a parent created before its child is rejected.
      await createDoc("DocType", definition);
      log(`  + ${label} - created, ${definition.fields.length} field(s)`);
      created += 1;
    } catch (error) {
      failures.push({ name: definition.name, error: error.message });
      console.error(`  ! ${label} - ${error.message}`);
    }
  }

  // --- the fields that could not exist at creation time -----------------
  if (!DRY_RUN && failures.length === 0) {
    log("");
    for (const { parent, field } of LATE_FIELDS) {
      try {
        const current = await getDoc("DocType", parent);
        if (current.fields?.some((existing) => existing.fieldname === field.fieldname)) {
          log(`  = ${parent}.${field.fieldname} - already present`);
          continue;
        }

        // Sent as a Custom Field rather than by rewriting the DocType. A
        // rewrite would resend every field, and any drift between this file
        // and the live DocType would be applied as a silent migration.
        await createDoc("Custom Field", {
          doctype: "Custom Field",
          dt: parent,
          ...field,
          insert_after: current.fields?.[current.fields.length - 1]?.fieldname,
        });
        log(`  + ${parent}.${field.fieldname} - added`);
      } catch (error) {
        failures.push({ name: `${parent}.${field.fieldname}`, error: error.message });
        console.error(`  ! ${parent}.${field.fieldname} - ${error.message}`);
      }
    }
  }

  log(`\n${created} created, ${present} already present, ${failures.length} failed.`);
  if (failures.length > 0) process.exit(1);
};

main().catch((error) => {
  console.error("\nDocType sync failed:", error.message);
  process.exit(1);
});
