import dotenv from "dotenv";

import { createDoc, docExists, listDocs } from "../integrations/erpnext/client.js";
import { erpDisabledReason, erpHasCredentials } from "../integrations/erpnext/config.js";
import {
  TECHNICIAN_DOCTYPE,
  TECHNICIAN_ROLE_PERMS,
  SEED_TECHNICIANS,
} from "../integrations/erpnext/technicianDoctype.js";

dotenv.config();

/**
 * Creates the maintenance team register in ERPNext and seeds the four who are
 * on it today.
 *
 *   node scripts/syncTechnicians.js --dry-run
 *   node scripts/syncTechnicians.js
 *
 * Safe to run again. Anything already present is left alone rather than
 * overwritten - overwriting a DocType drops columns, and dropping a column
 * drops the data in it. A technician somebody has since marked as resigned is
 * not resurrected by a second run, because only absence is acted on.
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

  // --- the doctype -------------------------------------------------------
  step("DocType");
  if (await docExists("DocType", TECHNICIAN_DOCTYPE.name)) {
    log(`  = ${TECHNICIAN_DOCTYPE.name} - already present`);
  } else if (DRY) {
    log(`  + ${TECHNICIAN_DOCTYPE.name} - would create`);
  } else {
    await createDoc("DocType", TECHNICIAN_DOCTYPE);
    log(`  + ${TECHNICIAN_DOCTYPE.name} - created`);
  }

  // --- the permissions the DocType itself could not carry ----------------
  step("Role permissions");
  // Frappe names a Custom DocPerm with a hash, not anything predictable, so
  // existence is checked by what it points at rather than by a built name.
  const existing = DRY
    ? []
    : await listDocs("Custom DocPerm", {
        fields: ["role"],
        filters: [
          ["Custom DocPerm", "parent", "=", TECHNICIAN_DOCTYPE.name],
          ["Custom DocPerm", "permlevel", "=", 0],
        ],
        limit: 50,
      }).catch(() => []);
  const held = new Set(existing.map((row) => row.role));

  for (const perm of TECHNICIAN_ROLE_PERMS) {
    if (held.has(perm.role)) {
      log(`  = ${perm.role} - already present`);
      continue;
    }
    if (DRY) {
      log(`  + ${perm.role} - would grant`);
      continue;
    }
    await createDoc("Custom DocPerm", {
      doctype: "Custom DocPerm",
      parent: TECHNICIAN_DOCTYPE.name,
      parenttype: "DocType",
      parentfield: "permissions",
      permlevel: 0,
      ...perm,
    });
    log(`  + ${perm.role} - granted`);
  }

  // --- the team ----------------------------------------------------------
  step("Technicians");
  for (const name of SEED_TECHNICIANS) {
    if (!DRY && (await docExists(TECHNICIAN_DOCTYPE.name, name))) {
      log(`  = ${name} - already on the register`);
      continue;
    }
    if (DRY) {
      log(`  + ${name} - would add`);
      continue;
    }
    await createDoc(TECHNICIAN_DOCTYPE.name, {
      doctype: TECHNICIAN_DOCTYPE.name,
      technician_name: name,
      is_active: 1,
    });
    log(`  + ${name} - added`);
  }

  log("\nDone.");
};

main().catch((error) => {
  console.error("\nFailed:", error.message);
  process.exit(1);
});
