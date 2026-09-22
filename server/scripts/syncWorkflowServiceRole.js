import dotenv from "dotenv";

import { getDoc, updateDoc } from "../integrations/erpnext/client.js";
import { erpDisabledReason, erpHasCredentials } from "../integrations/erpnext/config.js";

dotenv.config();

/**
 * Lets the integration account actually perform the workflow transitions.
 *
 *   node scripts/syncWorkflowServiceRole.js --dry-run
 *   node scripts/syncWorkflowServiceRole.js
 *
 * Every CMMS transition names the role of the person who is *meant* to take it
 * - Plant Manager withdraws, Store Maintenance Manager starts work. But the
 * application never applies a transition as that person: it applies it as the
 * integration account, deliberately, because Frappe enforces CSRF on
 * cookie-authenticated writes and token auth is exempt. Who is allowed to take
 * a step is decided in the application instead, by `mayTakeRequestStep` and
 * `mayTake`, against the real signed-in user.
 *
 * So ERPNext sees the integration account's roles and nothing else. If that
 * account does not hold the role a transition names, Frappe answers "Not a
 * valid Workflow Action" and the button fails for everybody - which is exactly
 * what happened to Withdraw, and in fact to all six maintenance request
 * transitions. The breakdown workflow had already been given these rows, which
 * is the only reason breakdowns kept working and the problem stayed hidden.
 *
 * This adds a System Manager row beside every existing transition. It widens
 * nothing in practice: a System Manager is an ERPNext administrator, and the
 * application's own check is what actually gates the button.
 *
 * The better fix is a dedicated integration account holding exactly the store
 * roles, rather than a person's account that happens to be System Manager. This
 * keeps the system working until that exists, and stays correct afterwards.
 *
 * Safe to run again: a row that is already there is left alone.
 */

const DRY = process.argv.includes("--dry-run");
const SERVICE_ROLE = "System Manager";

const WORKFLOWS = [
  "CMMS Maintenance Request Flow",
  "CMMS Breakdown Flow",
  "CMMS Item Naming Flow",
];

const log = (...p) => console.log(...p);

const main = async () => {
  if (!erpHasCredentials()) {
    console.error(`ERPNext credentials are not set (${erpDisabledReason()}).`);
    process.exit(1);
  }
  if (DRY) log("DRY RUN - nothing will be written.\n");

  for (const name of WORKFLOWS) {
    log(`\n=== ${name} ===`);

    const workflow = await getDoc("Workflow", name).catch(() => null);
    if (!workflow) {
      log("  ! not on this instance - skipped");
      continue;
    }

    const rows = workflow.transitions || [];

    // A transition is identified by where it goes from, what it is called and
    // where it lands. The role is the part that varies between the duplicates.
    const has = new Set(rows.map((t) => `${t.state}|${t.action}|${t.next_state}|${t.allowed}`));
    const wanted = new Map();
    for (const t of rows) {
      const key = `${t.state}|${t.action}|${t.next_state}`;
      if (!wanted.has(key)) {
        wanted.set(key, {
          state: t.state,
          action: t.action,
          next_state: t.next_state,
          allowed: SERVICE_ROLE,
          allow_self_approval: 1,
        });
      }
    }

    const missing = [...wanted.entries()]
      .filter(([key]) => !has.has(`${key}|${SERVICE_ROLE}`))
      .map(([, row]) => row);

    if (!missing.length) {
      log(`  = all ${wanted.size} transitions already reachable by ${SERVICE_ROLE}`);
      continue;
    }

    for (const t of missing) log(`  + ${t.action} (from ${t.state}) - add ${SERVICE_ROLE}`);

    if (DRY) continue;

    await updateDoc("Workflow", name, {
      // The whole child table: Frappe replaces a table it is given rather than
      // merging into it, so sending only the additions would delete the rest.
      transitions: [...rows, ...missing].map((t) => ({
        state: t.state,
        action: t.action,
        next_state: t.next_state,
        allowed: t.allowed,
        allow_self_approval: t.allow_self_approval ? 1 : 0,
      })),
    });
    log(`  ${missing.length} added`);
  }

  log("\nDone.");
};

main().catch((error) => {
  console.error("\nFailed:", error.message);
  process.exit(1);
});
