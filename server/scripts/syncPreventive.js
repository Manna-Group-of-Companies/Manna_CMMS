import dotenv from "dotenv";

import { createDoc, docExists, listDocs } from "../integrations/erpnext/client.js";
import { erpDisabledReason, erpHasCredentials } from "../integrations/erpnext/config.js";
import {
  PREVENTIVE_DOCTYPES,
  PREVENTIVE_ROLE_PERMS,
} from "../integrations/erpnext/preventiveDoctypes.js";

dotenv.config();

/**
 * Creates the preventive maintenance checklist doctypes.
 *
 *   node scripts/syncPreventive.js --dry-run
 *   node scripts/syncPreventive.js
 *
 * Run `syncMaintenance.js` first — a checklist links to a CMMS Machine.
 *
 * No workflow and no seed data. A checklist is master data the maintenance
 * manager writes, and there is no honest way for this script to invent the
 * contents: the points on a mixing mill's weekly round are a matter of fact
 * about that mill, and a plausible-looking list generated here would be signed
 * off by somebody assuming it came from the manufacturer.
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
  if (!(await docExists("DocType", "CMMS Machine"))) {
    console.error(
      '\nCMMS Machine does not exist. Run "node scripts/syncMaintenance.js" first — ' +
        "a checklist belongs to a machine and cannot be created without one."
    );
    process.exit(1);
  }
  log("  = CMMS Machine - present");

  step("DocTypes");
  for (const definition of PREVENTIVE_DOCTYPES) {
    const label = definition.istable ? " (child table)" : "";
    if (await docExists("DocType", definition.name)) {
      log(`  = ${definition.name}${label} - already present`);
      continue;
    }
    if (DRY) {
      log(`  + ${definition.name}${label} - would create`);
      continue;
    }
    await createDoc("DocType", definition);
    log(`  + ${definition.name}${label} - created`);
  }

  step("Role permissions");
  for (const definition of PREVENTIVE_DOCTYPES) {
    if (definition.istable) continue; // a child table inherits its parent's

    // Frappe names a Custom DocPerm with a hash, so existence is checked by
    // what it points at rather than by a name this code could construct.
    const existing = await listDocs("Custom DocPerm", {
      fields: ["role"],
      filters: [
        ["Custom DocPerm", "parent", "=", definition.name],
        ["Custom DocPerm", "permlevel", "=", 0],
      ],
      limit: 50,
    }).catch(() => []);
    const held = new Set(existing.map((r) => r.role));

    for (const perm of PREVENTIVE_ROLE_PERMS) {
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

  step("Done");
  log("Checklists can now be written in Preventive Maintenance.");
  log(
    "Nothing has been seeded. The existing checklists have to be entered or " +
      "imported — a list invented by this script would be signed off as though " +
      "it came from the manufacturer."
  );
};

main().catch((error) => {
  console.error("\nFailed:", error.message);
  process.exit(1);
});
