import dotenv from "dotenv";

import { createDoc, docExists, listAll, listDocs } from "../integrations/erpnext/client.js";
import { erpDisabledReason, erpHasCredentials } from "../integrations/erpnext/config.js";
import {
  ELECTRICAL_DOCTYPES,
  ELECTRICAL_ROLE_PERMS,
} from "../integrations/erpnext/electricalDoctypes.js";

dotenv.config();

/**
 * Creates the electrical portfolio doctypes, and one Electrical System per
 * plant.
 *
 *   node scripts/syncElectrical.js --dry-run
 *   node scripts/syncElectrical.js
 *
 * Every plant gets a system whether or not anybody has filled it in yet: an
 * empty one says "nobody has recorded this", which is a finding. No system at
 * all just looks like the feature is missing.
 *
 * Re-running is a no-op.
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

  step("DocTypes");
  for (const definition of ELECTRICAL_DOCTYPES) {
    if (await docExists("DocType", definition.name)) {
      log(`  = ${definition.name} - already present`);
      continue;
    }
    if (DRY) {
      log(`  + ${definition.name} - would create`);
      continue;
    }
    await createDoc("DocType", definition);
    log(`  + ${definition.name} - created`);
  }

  step("Role permissions");
  for (const definition of ELECTRICAL_DOCTYPES) {
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

    for (const perm of ELECTRICAL_ROLE_PERMS) {
      if (held.has(perm.role)) continue;
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
      log(`  + ${definition.name} / ${perm.role}`);
    }
  }

  step("One system per plant");
  const plants = await listAll("CMMS Plant", { fields: ["name"] });
  const held = await listAll("CMMS Electrical System", { fields: ["plant"] }).catch(() => []);
  const covered = new Set(held.map((s) => s.plant));

  for (const plant of plants) {
    if (covered.has(plant.name)) {
      log(`  = ${plant.name} - already has one`);
      continue;
    }
    if (DRY) {
      log(`  + ${plant.name} - would create`);
      continue;
    }
    await createDoc("CMMS Electrical System", {
      doctype: "CMMS Electrical System",
      plant: plant.name,
      system_name: `${plant.name} Electrical System`,
    });
    log(`  + ${plant.name} - created`);
  }

  step("Done");
  log("Every plant now has an electrical system to fill in.");
};

main().catch((error) => {
  console.error("\nFailed:", error.message);
  process.exit(1);
});
