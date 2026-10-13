import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

import { listCatalog } from "../repository/catalog.js";
import { validateItemName } from "../utils/itemNaming.js";
import { grade, repair } from "../utils/nameRepair.js";

dotenv.config();

/**
 * Proposes a SOI1/SOP1-compliant name for every item in the catalog.
 *
 *   node scripts/proposeItemNames.js            → writes the JSON the sheet is built from
 *
 * Writes nothing to ERPNext. The output is a proposal for the Maintenance
 * Manager to approve; `renameItems.js` is what applies it afterwards.
 *
 * --- Why the rules are not re-implemented here --------------------------
 *
 * Every name, old and new, is judged by `utils/itemNaming.js` — the same
 * validator the intake form calls. This file only *rearranges* names; it never
 * decides what compliant means. A migration that carried its own opinion of
 * the convention would quietly rename 654 items to a standard nothing else in
 * the system agrees with.
 *
 * --- What it will not do -----------------------------------------------
 *
 * It never invents a specification. A little over a hundred items carry no
 * dimension or rating anywhere in their name — "Adjustable Spanner" is the
 * honest example — and the convention says such a name is not unique. The size
 * of that spanner is a fact about the shelf, not something this script can
 * derive, so those come through tidied but still non-compliant and flagged for
 * somebody to fill in. Guessing would produce a sheet that looks finished and
 * is wrong in a way nobody could spot afterwards.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "../../data/renaming");

const main = async () => {
  const items = await listCatalog();
  console.log(`Read ${items.length} items from ERPNext.`);

  const rows = items.map((item) => {
    const before = validateItemName(item.name);
    const after = repair(item.name);
    const { band, note, optional } = grade(item.name, before, after);

    // A name that already passes is never rewritten.
    const proposed = before.compliant ? item.name : after.proposed;

    return {
      code: item.code,
      current: item.name,
      proposed,
      changed: proposed !== item.name,
      wasCompliant: before.compliant,
      nowCompliant: before.compliant || after.compliant,
      band,
      note,
      optional,
      remaining: before.compliant ? "" : after.issues.map((i) => i.message).join(" "),
      category: item.category,
      subCategory: item.subCategory,
      unit: item.unit,
      quantity: item.quantity,
      rack: item.rackNumber || "",
    };
  });

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "proposed-names.json"), JSON.stringify(rows, null, 1));

  const bands = [
    "No change",
    "Optional - field order",
    "Fix - safe",
    "Fix - reordered",
    "Fix - needs the size",
    "Fix - needs a decision",
  ];
  console.log("");
  for (const b of bands) {
    console.log(`  ${b.padEnd(24)} ${rows.filter((r) => r.band === b).length}`);
  }
  console.log("");
  console.log(`  compliant before: ${rows.filter((r) => r.wasCompliant).length}`);
  console.log(`  compliant after:  ${rows.filter((r) => r.nowCompliant).length}`);
  console.log(`  names changed:    ${rows.filter((r) => r.changed).length}`);
  console.log(`\nWrote ${path.join(OUT, "proposed-names.json")}`);
};

main().catch((error) => {
  console.error("\nFailed:", error.message);
  process.exit(1);
});
