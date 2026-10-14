/**
 * The maintenance team - the people a repair can be recorded against.
 *
 * "Repaired by" used to suggest every enabled ERPNext user, which is the whole
 * company: accountants, plant heads, the store, anyone who has ever been given
 * a login. The one list it did not contain was the maintenance team, because
 * most of the fitters have no account at all - so the suggestions were useless
 * and the field was typed by hand, which is how the same person ends up in the
 * history as three different spellings.
 *
 * A register of its own, kept by the Maintenance Manager, is the fix. It is
 * deliberately not ERPNext's `Employee`: that is HR's record, it is created
 * when someone is put on payroll, and the fitters on this team are not all on
 * it. Who may be named on a repair is a maintenance question.
 *
 * Pushed by `scripts/syncTechnicians.js`.
 */

const f = (fieldname, label, fieldtype, extra = {}) => ({ fieldname, label, fieldtype, ...extra });

/**
 * Only System Manager in the DocType itself; the rest arrive as Custom DocPerm.
 *
 * Frappe refuses to let a non-Administrator set a role on a custom DocType
 * unless the session already holds that role, and it caches the session's role
 * list - see the same note in maintenanceDoctypes.js.
 */
const PERMISSIONS = [
  { role: "System Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1 },
];

/**
 * The moment a doctype has any Custom DocPerm, Frappe ignores the permissions
 * built into the doctype entirely and honours only these - so System Manager is
 * repeated here on purpose.
 */
export const TECHNICIAN_ROLE_PERMS = [
  { role: "System Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1, share: 1 },
  { role: "Store Maintenance Manager", read: 1, write: 1, create: 1, report: 1, export: 1 },
  // Everyone else reads: the name has to render on a breakdown they can open.
  { role: "Store Manager", read: 1, report: 1 },
  { role: "Plant Manager", read: 1, report: 1 },
];

/** The trades a repair is recorded against - the same list the crew rows offer. */
export const TRADES = ["Fitter", "Electrician", "Helper", "Supervisor", "Contractor"];

export const TECHNICIAN_DOCTYPE = {
  doctype: "DocType",
  name: "CMMS Technician",
  module: "Custom",
  custom: 1,
  istable: 0,
  editable_grid: 0,
  /**
   * Named by the person, so a breakdown's crew row reads as a name and two
   * records cannot describe the same person. It also means renaming someone is
   * a deliberate act rather than a silent edit.
   */
  autoname: "field:technician_name",
  fields: [
    f("technician_name", "Name", "Data", { reqd: 1, unique: 1, in_list_view: 1 }),
    f("trade", "Trade", "Select", {
      options: TRADES.join("\n"),
      default: "Fitter",
      in_list_view: 1,
    }),
    /**
     * Optional, and it will stay optional.
     *
     * Most of the team have no login. Requiring one here would rebuild exactly
     * the problem this register exists to solve - a list of people with
     * accounts rather than a list of people who do the work.
     */
    f("user", "ERPNext User", "Link", { options: "User" }),
    f("is_active", "Working Here", "Check", { default: "1", in_list_view: 1 }),
    /**
     * Resigning is a date, not a deletion.
     *
     * A breakdown from last March names whoever repaired it, and that has to go
     * on reading correctly after they leave. Deleting the record would either
     * break those rows or quietly rewrite the history of who did the work.
     */
    f("resigned_on", "Left On", "Date", { depends_on: "eval:!doc.is_active" }),
  ],
  permissions: PERMISSIONS,
};

/**
 * The team as it stands (13 Oct 2026), seeded on first run.
 *
 * Trades are left at the default rather than invented: the Maintenance Manager
 * sets each one from the register, and a guessed trade that nobody corrects is
 * worse than a blank the right person fills in.
 */
export const SEED_TECHNICIANS = ["Sunny", "Ramesh", "Saji", "Simod"];
