/**
 * Attendance and leave for the maintenance team.
 *
 * The field-sales app keeps the reps' attendance in three custom doctypes
 * (`Attendance Log`, `Attendance Regularization`, `Leave Request`), each keyed
 * by a Sales Person. The maintenance team are not sales people, and making
 * them Sales Person records so they could share those tables would put three
 * fitters into every sales headcount and HR roster. So these are the same
 * records, the same fields and the same vocabulary, keyed by the ERPNext User
 * instead — the CMMS's own copy, under its own prefix, beside the other CMMS
 * doctypes.
 *
 * Who is on the team is the role below, not a list in this file: giving
 * somebody `Store Maintenance Member` is the whole of adding them. Their paid
 * leave scheme — when accrual started and what they carried forward — is the
 * one thing a role cannot hold, and `CMMS Leave Scheme` holds it, one row per
 * member, maintained by the maintenance manager.
 *
 * Pushed by `scripts/syncAttendance.js`.
 */

/**
 * The ERPNext role a team member signs in with.
 *
 * Named like the other three `Store …` roles for the same reason they were:
 * ERPNext already has `Maintenance User` built in for its own asset
 * maintenance module, and a bare name would be ambiguous in the role picker.
 */
export const MEMBER_ROLE = "Store Maintenance Member";

const PERMISSIONS = [
  { role: "System Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1 },
];

/**
 * Added by the sync script once each DocType exists — see the note on
 * Custom DocPerm in maintenanceDoctypes.js for why the DocType cannot carry
 * them itself.
 *
 * A member reads and writes, because punching out edits the row punching in
 * created. No delete: a punch is a record of a day, and a member erasing one
 * is exactly what the regularization trail exists to prevent. The managers
 * decide requests and keep the leave schemes.
 */
export const ATTENDANCE_ROLE_PERMS = [
  { role: "System Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1, share: 1 },
  { role: "Store Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1 },
  { role: "Store Maintenance Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1 },
  { role: MEMBER_ROLE, read: 1, write: 1, create: 1, report: 1 },
];

const f = (fieldname, label, fieldtype, extra = {}) => ({ fieldname, label, fieldtype, ...extra });
const link = (fieldname, label, target, extra = {}) =>
  f(fieldname, label, "Link", { options: target, ...extra });
const select = (fieldname, label, options, extra = {}) =>
  f(fieldname, label, "Select", { options: options.join("\n"), ...extra });
const check = (fieldname, label, extra = {}) => f(fieldname, label, "Check", { default: "0", ...extra });

const doc = ({ name, autoname, fields }) => ({
  doctype: "DocType",
  name,
  module: "Custom",
  custom: 1,
  istable: 0,
  editable_grid: 0,
  track_changes: 1,
  allow_rename: 0,
  naming_rule: "Expression",
  autoname,
  permissions: PERMISSIONS,
  fields,
});

/** The person, named the same way on every record so a list reads without a lookup. */
const member = () => [
  link("member", "Team Member", "User", { reqd: 1, in_list_view: 1, in_standard_filter: 1 }),
  f("member_name", "Name", "Data", { fetch_from: "member.full_name", read_only: 1, in_list_view: 1 }),
];

/**
 * One day's punches.
 *
 * `status` is Punched In until the punch-out lands, and stays Punched Out
 * however many times the punch-out is repeated — the last stamp is the
 * official one. `working_hours` is recomputed by the server from the two
 * stamps on every write, so it cannot disagree with them.
 */
const ATTENDANCE_LOG = doc({
  name: "CMMS Attendance Log",
  autoname: "format:CATT-{YYYY}-{#####}",
  fields: [
    ...member(),
    f("attendance_date", "Date", "Date", { reqd: 1, in_list_view: 1, in_standard_filter: 1 }),
    select("status", "Status", ["Punched In", "Punched Out"], {
      reqd: 1,
      default: "Punched In",
      in_list_view: 1,
    }),
    f("punch_in_time", "Punch In", "Datetime", { in_list_view: 1 }),
    f("punch_in_latitude", "Punch In Latitude", "Float", { precision: "6" }),
    f("punch_in_longitude", "Punch In Longitude", "Float", { precision: "6" }),
    f("punch_out_time", "Punch Out", "Datetime", { in_list_view: 1 }),
    f("punch_out_latitude", "Punch Out Latitude", "Float", { precision: "6" }),
    f("punch_out_longitude", "Punch Out Longitude", "Float", { precision: "6" }),
    f("working_hours", "Working Hours", "Float", { read_only: 1 }),
    // Set when an approved regularization wrote the times, so a report can
    // tell a stamped day from a corrected one.
    check("regularized", "Set by Regularization", { read_only: 1 }),
    f("remarks", "Remarks", "Small Text"),
  ],
});

/**
 * A member asking for a day's punches to be corrected — a forgotten
 * punch-out, a start before 05:00. Approving it writes the requested times
 * onto the day's log; the request itself stays as the audit trail of who
 * asked for what and who agreed.
 */
const REGULARIZATION = doc({
  name: "CMMS Attendance Regularization",
  autoname: "format:CREG-{YYYY}-{#####}",
  fields: [
    ...member(),
    f("attendance_date", "Date", "Date", { reqd: 1, in_list_view: 1, in_standard_filter: 1 }),
    f("requested_punch_in", "Requested Punch In", "Datetime"),
    f("requested_punch_out", "Requested Punch Out", "Datetime"),
    f("reason", "Reason", "Small Text"),
    select("status", "Status", ["Pending Approval", "Approved", "Rejected"], {
      reqd: 1,
      default: "Pending Approval",
      in_list_view: 1,
      in_standard_filter: 1,
    }),
    link("decided_by", "Decided By", "User", { read_only: 1 }),
    f("decided_at", "Decided At", "Datetime", { read_only: 1 }),
    f("decision_remarks", "Decision Remarks", "Small Text"),
  ],
});

/**
 * One day of leave, or half of one.
 *
 * `leave_days` is stored rather than derived so the balance is a plain sum
 * over the column. `is_manager_entry` marks a day the manager recorded on the
 * member's behalf — a phoned-in absence — which is created already approved
 * and may carry any date, unlike a member's own request.
 */
const LEAVE_REQUEST = doc({
  name: "CMMS Leave Request",
  autoname: "format:CLV-{YYYY}-{#####}",
  fields: [
    ...member(),
    f("leave_date", "Leave Date", "Date", { reqd: 1, in_list_view: 1, in_standard_filter: 1 }),
    check("half_day", "Half Day", { in_list_view: 1 }),
    select("half_day_period", "Half Day Period", ["", "Morning", "Afternoon"]),
    f("leave_days", "Leave Days", "Float", { default: "1", read_only: 1 }),
    f("reason", "Reason", "Small Text"),
    select("status", "Status", ["Pending Approval", "Approved", "Rejected"], {
      reqd: 1,
      default: "Pending Approval",
      in_list_view: 1,
      in_standard_filter: 1,
    }),
    check("is_manager_entry", "Entered by Manager"),
    link("decided_by", "Decided By", "User", { read_only: 1 }),
    f("decided_at", "Decided At", "Datetime", { read_only: 1 }),
  ],
});

/**
 * Who is on the paid-leave scheme, and from when.
 *
 * Named by the member, so there is exactly one row per person and the server
 * reads it by name. No row means not on the scheme — which is not the same as
 * an opening balance of zero: somebody carrying nothing forward still accrues
 * a day a month, and somebody off the scheme accrues nothing and must not be
 * told their leave is unpaid.
 */
const LEAVE_SCHEME = doc({
  name: "CMMS Leave Scheme",
  autoname: "field:member",
  fields: [
    link("member", "Team Member", "User", { reqd: 1, unique: 1, in_list_view: 1 }),
    f("member_name", "Name", "Data", { fetch_from: "member.full_name", read_only: 1, in_list_view: 1 }),
    f("accrual_from", "Leave Accrual Starts", "Date", { reqd: 1, in_list_view: 1 }),
    f("opening_balance", "Leave Balance Carried Forward", "Float", { default: "0", in_list_view: 1 }),
    f("notes", "Notes", "Small Text"),
  ],
});

export const ATTENDANCE_DOCTYPES = [ATTENDANCE_LOG, REGULARIZATION, LEAVE_REQUEST, LEAVE_SCHEME];
