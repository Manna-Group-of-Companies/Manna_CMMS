import fs from "node:fs/promises";
import dotenv from "dotenv";

import { createDoc, listAll } from "../integrations/erpnext/client.js";
import { parseCsv } from "../integrations/erpnext/csv.js";

dotenv.config();

/**
 * Creates the Item Groups from a generated `01-item-groups.csv`.
 *
 *   node scripts/createItemGroups.js <path-to-01-item-groups.csv>
 *
 * ERPNext's own importer cannot be used for these. Item Group is a nested set,
 * and the importer inserts in parallel, which deadlocks siblings on the
 * parent's lft/rgt. So they go in one at a time, parents first - which the
 * generated file is already ordered for.
 *
 * Re-running is a no-op: anything already there is left alone, so this can be
 * run again after the catalog gains a category without touching the rest.
 */
const [, , file] = process.argv;
if (!file) {
  console.error("usage: node scripts/createItemGroups.js <01-item-groups.csv>");
  process.exit(1);
}

const main = async () => {
  const groups = parseCsv(await fs.readFile(file, "utf8"));
  const live = new Set((await listAll("Item Group", { fields: ["name"] })).map((g) => g.name));

  let made = 0;
  let had = 0;
  const skipped = [];

  for (const g of groups) {
    const name = g.item_group_name;
    const parent = g.parent_item_group;

    if (live.has(name)) {
      had++;
      continue;
    }
    // A child whose parent never got created would be refused by ERPNext with
    // a link error; saying which parent is missing is more use than that.
    if (!live.has(parent)) {
      skipped.push({ name, parent });
      continue;
    }

    await createDoc("Item Group", {
      doctype: "Item Group",
      item_group_name: name,
      parent_item_group: parent,
      is_group: Number(g.is_group) ? 1 : 0,
    });
    live.add(name);
    made++;
    console.log(`  created "${name}"  under ${parent}`);
  }

  console.log(`\n${made} created, ${had} already there, ${groups.length} in the file`);
  for (const s of skipped) {
    console.log(`  SKIPPED "${s.name}" - its parent "${s.parent}" does not exist`);
  }
  if (skipped.length) process.exitCode = 1;
};

main().catch((error) => {
  console.error("\nFailed:", error.message);
  process.exit(1);
});
