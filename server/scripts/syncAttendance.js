import dotenv from "dotenv";

import { createDoc, docExists, getDoc, listDocs, updateDoc } from "../integrations/erpnext/client.js";
import { erpDisabledReason, erpHasCredentials } from "../integrations/erpnext/config.js";
import {
  ATTENDANCE_DOCTYPES,
  ATTENDANCE_ROLE_PERMS,
  MEMBER_ROLE,
} from "../integrations/erpnext/attendanceDoctypes.js";

dotenv.config();

/**
 * Creates attendance and leave for the maintenance team in ERPNext: the role
 * a member signs in with, the four doctypes, and their role permissions.
 *
 *   node scripts/syncAttendance.js --dry-run
 *   node scripts/syncAttendance.js
 *   node scripts/syncAttendance.js --member sunny@mannarubber.com --member ramesh@mannarubber.com
 *
 * `--member` puts an existing ERPNext user on the team by giving them the
 * role. It does not create users: an account for a real person — the email,
 * the password, whether they already have one under another spelling — is a
 * decision for whoever administers ERPNext, not for a script to guess at.
 * Create the User in Desk first, then run this with their email.
 *
 * Safe to run again. Anything already present is left alone rather than
 * overwritten, because overwriting a DocType drops columns and dropping a
 * column drops the data in it.
 */

const DRY = process.argv.includes("--dry-run");
const log = (...p) => console.log(...p);
const step = (t) => log(`\n=== ${t} ===`);

/** Every `--member <email>` on the command line. */
const membersWanted = () => {
  const emails = [];
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--member" && args[i + 1]) emails.push(args[i + 1].trim().toLowerCase());
  }
  return emails;
};

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

/**
 * Gives one user the member role.
 *
 * The roles table is sent back whole: Frappe replaces a child table it is
 * given rather than merging into it, so sending only the new row would strip
 * every other role the person holds. Existing rows keep their `name` so they
 * are updated in place rather than deleted and recreated.
 */
const enrol = async (email) => {
  let user;
  try {
    user = await getDoc("User", email);
  } catch (error) {
    if (error?.status === 404) {
      log(`  ! ${email} - no such ERPNext user. Create the account in Desk, then run this again.`);
      return;
    }
    throw error;
  }

  const rows = user.roles || [];
  if (rows.some((row) => row.role === MEMBER_ROLE)) {
    log(`  = ${email} (${user.full_name}) - already on the team`);
    return;
  }
  if (user.enabled === 0) {
    log(`  ! ${email} (${user.full_name}) - account is disabled; enable it in Desk first`);
    return;
  }
  if (DRY) {
    log(`  + ${email} (${user.full_name}) - would be given ${MEMBER_ROLE}`);
    return;
  }
  await updateDoc("User", email, {
    roles: [...rows.map((row) => ({ name: row.name, role: row.role })), { role: MEMBER_ROLE }],
  });
  log(`  + ${email} (${user.full_name}) - given ${MEMBER_ROLE}`);
};

const main = async () => {
  if (!erpHasCredentials()) {
    console.error(`ERPNext credentials are not set (${erpDisabledReason()}).`);
    process.exit(1);
  }
  if (DRY) log("DRY RUN - nothing will be written.\n");

  // --- the role a team member signs in with ------------------------------
  step("Role");
  await ensure("Role", MEMBER_ROLE, () => ({
    doctype: "Role",
    role_name: MEMBER_ROLE,
    desk_access: 1,
    is_custom: 1,
  }));

  // --- doctypes, in dependency order ---------------------------------------
  step("DocTypes");
  for (const definition of ATTENDANCE_DOCTYPES) {
    await ensure("DocType", definition.name, () => definition);
  }

  // --- the role permissions the DocType itself could not carry -------------
  step("Role permissions");
  for (const definition of ATTENDANCE_DOCTYPES) {
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
    const held = new Set(existing.map((row) => row.role));

    for (const perm of ATTENDANCE_ROLE_PERMS) {
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

  // --- the people -----------------------------------------------------------
  const emails = membersWanted();
  step("Team members");
  if (emails.length === 0) {
    log("  (none given - add people with --member <email>)");
  }
  for (const email of emails) {
    await enrol(email);
  }

  step("Done");
  log(
    `${ATTENDANCE_DOCTYPES.length} doctype(s), 1 role. A member signs in to the phone app ` +
      "with their ERPNext email and password and lands on Attendance."
  );
  log(
    "Leave schemes are not seeded: the maintenance manager sets each member's " +
      "accrual start and carried-forward balance from the Team tab on the phone, " +
      "or in Desk under CMMS Leave Scheme."
  );
};

main().catch((error) => {
  console.error("\nAttendance setup failed:", error.message);
  process.exit(1);
});
