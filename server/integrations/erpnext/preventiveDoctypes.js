/**
 * Module 2c — preventive maintenance checklists.
 *
 * The inspections that stop a breakdown being reported in the first place. One
 * checklist per machine per frequency: what to look at daily, what to look at
 * weekly, and so on down to yearly.
 *
 * This is a *template*, not a record of an inspection. It is the sheet that
 * gets printed, carried to the machine and filled in with a pen — which is what
 * the maintenance team asked for and what they will actually use. A screen that
 * demanded every daily check be ticked on a tablet standing next to a running
 * mill would be ignored within a week, and the checklist would go back to being
 * a Word file on somebody's laptop.
 *
 * So the system owns the *content* — the points, their order, who may add one,
 * and which revision is current — and the paper owns the *event*. That split is
 * the one thing that keeps a checklist current: adding a point is a two-second
 * job here, and the next print carries it.
 *
 * No workflow. A checklist is master data that the maintenance manager edits
 * directly; putting an approval flow around adding "check the oil level" is how
 * points stop being added.
 *
 * Pushed by `scripts/syncPreventive.js`.
 */

const PERMISSIONS = [
  { role: "System Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1 },
];

/**
 * Added by the sync script once each DocType exists.
 *
 * Everyone reads. Only maintenance and the Manager write: a checklist is the
 * standard the plant is inspected against, and a standard anybody can edit is
 * not a standard. A production manager reads it, prints it and hands it to an
 * operator.
 */
export const PREVENTIVE_ROLE_PERMS = [
  { role: "System Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1, share: 1 },
  { role: "Store Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1 },
  { role: "Store Maintenance Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1 },
  { role: "Plant Manager", read: 1, report: 1, export: 1 },
  { role: "Store Supervisor", read: 1, report: 1 },
];

const f = (fieldname, label, fieldtype, extra = {}) => ({ fieldname, label, fieldtype, ...extra });
const link = (fieldname, label, target, extra = {}) =>
  f(fieldname, label, "Link", { options: target, ...extra });
const select = (fieldname, label, options, extra = {}) =>
  f(fieldname, label, "Select", { options: options.join("\n"), ...extra });
const check = (fieldname, label, extra = {}) => f(fieldname, label, "Check", { default: "0", ...extra });

const doc = ({ name, autoname, fields, istable = 0 }) => ({
  doctype: "DocType",
  name,
  module: "Custom",
  custom: 1,
  istable,
  editable_grid: istable ? 1 : 0,
  track_changes: istable ? 0 : 1,
  allow_rename: 0,
  ...(istable ? {} : { naming_rule: "Expression", autoname, permissions: PERMISSIONS }),
  fields,
});

/**
 * The frequencies, in the order a maintenance department says them.
 *
 * Exported because three other modules need the same list in the same order and
 * a second copy would eventually be sorted alphabetically by somebody being
 * helpful, which puts Daily after Annual and Monthly before Weekly.
 */
export const FREQUENCIES = [
  "Daily",
  "Weekly",
  "Monthly",
  "Quarterly",
  "Half-Yearly",
  "Yearly",
];

/**
 * One thing to check.
 *
 * Three columns rather than one: what to look at, how to tell, and what counts
 * as right. A point that says only "check the belt" gets a tick from anybody
 * who saw a belt. "Belt tension — press mid-span by hand — 10 to 15 mm deflection"
 * gets a tick from somebody who measured, and a blank from somebody who did not
 * know how, which is itself worth knowing.
 *
 * `how_to_check` is optional because plenty of points are genuinely
 * self-evident, and a form that demands three sentences for "sweep under the
 * machine" is a form people stop adding points to.
 *
 * A point used to carry a `section` and an `acceptance` too. Both are gone from
 * the application - the section repeated what the points already said and cost
 * a heading row on a sheet with none to spare, and the acceptance mostly
 * restated the method. What the person at the machine needs is the check and
 * the way to do it.
 *
 * The two columns are NOT dropped from a live instance. Dropping a column drops
 * its data, and the 62 checklists already entered have values in these; they
 * are simply no longer read or written, so they cannot drift. This definition
 * is what a fresh instance gets, which is why they are absent here.
 */
const POINT = doc({
  name: "CMMS Checklist Point",
  istable: 1,
  fields: [
    f("point", "What to Check", "Small Text", { reqd: 1, in_list_view: 1, columns: 6 }),
    /**
     * Small Text, not Data.
     *
     * Frappe truncates a Data field at 140 characters, and a real inspection
     * method runs longer than that more often than it looks — "Transformer
     * terminal can be inspected when the 11 kV transformer is switched off by
     * the rubber park team; the inspection must be planned during this period"
     * is 154. A method silently cut in half is worse than no method at all,
     * because the half that survives still reads like an instruction.
     */
    f("how_to_check", "How", "Small Text", { in_list_view: 1, columns: 4 }),
    /**
     * A point that can hurt somebody.
     *
     * Printed with a marker beside it and never quietly dropped when a
     * checklist is trimmed. Safety points are the first casualty of a list
     * somebody decided was too long.
     */
    check("is_safety", "Safety", { in_list_view: 1, columns: 1 }),
  ],
});

/**
 * One asset's checklist at one frequency.
 *
 * "Asset" rather than "machine" because the electrical portfolio is inspected
 * on a schedule too — panels, the transformer, the capacitor bank — and none of
 * it is a machine on the register. Exactly one of `machine` and
 * `electrical_system` is set; the repository enforces that, because Frappe has
 * no way to express "one of these two" on its own.
 *
 * Neither link is `reqd`, for that reason. A checklist with neither set would
 * be a sheet belonging to nothing, so do not read the missing `reqd` as
 * permission to create one.
 */
const CHECKLIST = doc({
  name: "CMMS Checklist",
  autoname: "format:PMC-{#####}",
  fields: [
    f("title", "Title", "Data", { reqd: 1, in_list_view: 1 }),
    link("machine", "Machine", "CMMS Machine", { in_list_view: 1 }),
    f("machine_name", "Machine Name", "Data", { fetch_from: "machine.machine_name", read_only: 1 }),
    link("electrical_system", "Electrical System", "CMMS Electrical System", { in_list_view: 1 }),
    f("system_name", "System Name", "Data", {
      fetch_from: "electrical_system.system_name",
      read_only: 1,
    }),
    /**
     * Set by the repository rather than fetched.
     *
     * It used to be `fetch_from: "machine.plant"`, which cannot work now that
     * a checklist may hang off an electrical system instead — Frappe fetches
     * from one source only, and an electrical checklist would have arrived
     * with no plant and fallen out of every plant-filtered view, including the
     * one that confines a plant head to their own site.
     */
    link("plant", "Plant", "CMMS Plant", { in_list_view: 1 }),
    f("area", "Area / Section", "Data", { fetch_from: "machine.area", read_only: 1 }),

    /**
     * The leading blank is load-bearing, as everywhere else in this module.
     *
     * Frappe gives a Select with no explicit default its first option, so
     * without it every checklist arrives as Daily — and a yearly overhaul list
     * silently filed as a daily round is worse than no checklist at all.
     */
    select("frequency", "Frequency", ["", ...FREQUENCIES], { reqd: 1, in_list_view: 1 }),

    /**
     * Who does it.
     *
     * The reason a daily checklist works at all: most daily points belong to
     * the operator who is standing there anyway, and routing them to a fitter
     * is how a daily list becomes a weekly one in practice.
     */
    select(
      "responsibility",
      "Done By",
      ["", "Operator", "Fitter", "Electrician", "Maintenance Team", "Contractor"],
      { in_list_view: 1 }
    ),
    f("estimated_minutes", "Takes About (minutes)", "Int"),

    // Isolation, lock-out, permits. Printed in a box at the top of the sheet
    // rather than as a point halfway down, because it has to be read before
    // anybody starts and not when they reach item nine.
    f("safety_note", "Before You Start", "Small Text"),

    f("points", "Points", "Table", { options: "CMMS Checklist Point" }),

    check("is_active", "Active", { default: "1", in_list_view: 1 }),
    /**
     * Which version of the sheet this is.
     *
     * Printed in the footer. A signed sheet in a file with no revision on it
     * cannot be matched to the list that was current when it was signed, which
     * is the first question an auditor asks.
     */
    f("revision", "Revision", "Data", { default: "1" }),
    f("effective_from", "Effective From", "Date"),
    f("notes", "Notes", "Small Text"),
  ],
});

/** Dependency order: the child table before the record that holds it. */
export const PREVENTIVE_DOCTYPES = [POINT, CHECKLIST];
