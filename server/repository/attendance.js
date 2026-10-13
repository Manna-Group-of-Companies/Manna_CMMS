import {
  ErpError,
  createDoc,
  deleteDoc,
  getDoc,
  listDocs,
  updateDoc,
} from "../integrations/erpnext/client.js";
import { erpNow, erpToday } from "../integrations/erpnext/time.js";
import { MEMBER_ROLE } from "../integrations/erpnext/attendanceDoctypes.js";
import {
  AttendanceRuleError,
  NO_SCHEME,
  PUNCH_IN_FROM_MINUTE,
  PUNCH_OUT_UNTIL_MINUTE,
  assertHalfDayInTime,
  assertPunchInOpen,
  assertPunchOutOpen,
  dateOf,
  isIsoDate,
  isSet,
  leaveBalanceFor,
  leaveDaysFor,
  monthBounds,
  workingHours,
} from "../utils/attendanceRules.js";

/**
 * Attendance and leave for the maintenance team.
 *
 * The same journey the field-sales app gives its reps — punch in, punch out,
 * ask for a day to be corrected, apply for leave, a manager decides — against
 * the CMMS's own doctypes (see integrations/erpnext/attendanceDoctypes.js).
 *
 * Every stamp written here is `erpNow()`, this server's clock rendered in the
 * ERPNext timezone. The phone sends no times at all for a punch; it sends
 * where it was, and the server says when. That is the one thing the sales app
 * could never enforce — its reps wrote to ERPNext straight from a phone whose
 * clock they controlled — and the reason the rules live here rather than in
 * the Dart.
 *
 * Writes go out as the integration account, like every other CMMS write, and
 * `member` on each record says whose day it is.
 */

const LOG = "CMMS Attendance Log";
const REG = "CMMS Attendance Regularization";
const LEAVE = "CMMS Leave Request";
const SCHEME = "CMMS Leave Scheme";

const PENDING = "Pending Approval";

const LOG_FIELDS = [
  "name",
  "member",
  "member_name",
  "attendance_date",
  "status",
  "punch_in_time",
  "punch_out_time",
  "punch_in_latitude",
  "punch_in_longitude",
  "punch_out_latitude",
  "punch_out_longitude",
  "working_hours",
  "regularized",
];

const REG_FIELDS = [
  "name",
  "member",
  "member_name",
  "attendance_date",
  "requested_punch_in",
  "requested_punch_out",
  "reason",
  "status",
  "decided_by",
  "decided_at",
];

const LEAVE_FIELDS = [
  "name",
  "member",
  "member_name",
  "leave_date",
  "half_day",
  "half_day_period",
  "leave_days",
  "reason",
  "status",
  "is_manager_entry",
  "decided_by",
  "decided_at",
];

const text = (value) => (isSet(value) ? String(value) : null);
const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const coord = (value) => {
  const n = Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(n) ? null : n;
};

const toLog = (row) => ({
  id: row.name,
  member: row.member,
  memberName: row.member_name || row.member,
  date: row.attendance_date,
  status: row.status,
  punchIn: text(row.punch_in_time),
  punchOut: text(row.punch_out_time),
  punchInLatitude: coord(row.punch_in_latitude),
  punchInLongitude: coord(row.punch_in_longitude),
  punchOutLatitude: coord(row.punch_out_latitude),
  punchOutLongitude: coord(row.punch_out_longitude),
  workingHours: num(row.working_hours),
  regularized: Boolean(row.regularized),
});

const toRegularization = (row) => ({
  id: row.name,
  member: row.member,
  memberName: row.member_name || row.member,
  date: row.attendance_date,
  requestedIn: text(row.requested_punch_in),
  requestedOut: text(row.requested_punch_out),
  reason: row.reason || "",
  status: row.status,
  decidedBy: row.decided_by || "",
  decidedAt: text(row.decided_at),
});

const toLeave = (row) => ({
  id: row.name,
  member: row.member,
  memberName: row.member_name || row.member,
  date: row.leave_date,
  halfDay: Boolean(row.half_day),
  halfPeriod: row.half_day_period || "",
  days: num(row.leave_days),
  reason: row.reason || "",
  status: row.status,
  managerEntry: Boolean(row.is_manager_entry),
  decidedBy: row.decided_by || "",
  decidedAt: text(row.decided_at),
});

const rule = (message, extra) => new AttendanceRuleError(message, extra);

const requireDate = (value, what) => {
  const date = String(value ?? "").slice(0, 10);
  if (!isIsoDate(date)) throw rule(`Pick the ${what}.`, { code: "BAD_DATE" });
  return date;
};

/** The window, as the phone mirrors it. */
export const punchWindow = () => ({
  punchInFromMinute: PUNCH_IN_FROM_MINUTE,
  punchOutUntilMinute: PUNCH_OUT_UNTIL_MINUTE,
});

// ------------------------------------------------------------------ punches

/** The day's log for one member, or null. Earliest punch-in wins if there are two. */
const logFor = async (member, date) => {
  const rows = await listDocs(LOG, {
    fields: LOG_FIELDS,
    filters: [
      [LOG, "member", "=", member],
      [LOG, "attendance_date", "=", date],
    ],
    orderBy: "punch_in_time asc",
    limit: 1,
  });
  return rows.length ? toLog(rows[0]) : null;
};

export const todayFor = (member) => logFor(member, erpToday());

/**
 * Starts the day.
 *
 * Coordinates are optional: a fitter standing inside a steel shed often has
 * no GPS fix, and refusing the punch for want of one would make the module
 * unusable in exactly the place it is meant for. The time is never optional
 * and never the phone's.
 */
export const punchIn = async ({ member, latitude = null, longitude = null }) => {
  const now = erpNow();
  assertPunchInOpen(now);
  const today = dateOf(now);

  const existing = await logFor(member, today);
  if (existing) {
    throw rule(
      existing.status === "Punched In"
        ? "You are already punched in today."
        : "You have already punched out today. Use Punch Out Again if you kept working.",
      { code: "ALREADY_PUNCHED" }
    );
  }

  const created = await createDoc(LOG, {
    member,
    attendance_date: today,
    status: "Punched In",
    punch_in_time: now,
    ...(coord(latitude) !== null && coord(longitude) !== null
      ? { punch_in_latitude: coord(latitude), punch_in_longitude: coord(longitude) }
      : {}),
  });
  return toLog(created);
};

/**
 * Ends the day. Punching out a second time is allowed and simply replaces the
 * first — the last one is the official punch-out, and the hours are recomputed
 * from it.
 */
export const punchOut = async ({ member, latitude = null, longitude = null }) => {
  const now = erpNow();
  assertPunchOutOpen(now);

  const log = await logFor(member, dateOf(now));
  if (!log || !log.punchIn) {
    throw rule("Punch in first — there is no punch-in for today.", { code: "NOT_PUNCHED_IN" });
  }

  const updated = await updateDoc(LOG, log.id, {
    punch_out_time: now,
    working_hours: workingHours(log.punchIn, now) ?? 0,
    status: "Punched Out",
    ...(coord(latitude) !== null && coord(longitude) !== null
      ? { punch_out_latitude: coord(latitude), punch_out_longitude: coord(longitude) }
      : {}),
  });
  return toLog(updated);
};

// -------------------------------------------------------------------- month

/** One member's month: every punch, every correction asked for, and leave granted or awaiting. */
export const monthFor = async (member, year, month) => {
  const { from, to } = monthBounds(year, month);
  const between = (doctype, field) => [doctype, field, "between", [from, to]];

  const [logs, regularizations, leaves] = await Promise.all([
    listDocs(LOG, {
      fields: LOG_FIELDS,
      filters: [[LOG, "member", "=", member], between(LOG, "attendance_date")],
      orderBy: "attendance_date asc",
      limit: 100,
    }),
    listDocs(REG, {
      fields: REG_FIELDS,
      filters: [[REG, "member", "=", member], between(REG, "attendance_date")],
      orderBy: "attendance_date asc",
      limit: 100,
    }),
    listDocs(LEAVE, {
      fields: LEAVE_FIELDS,
      filters: [
        [LEAVE, "member", "=", member],
        between(LEAVE, "leave_date"),
        // A refused request explains nothing about the day, so it is left out.
        [LEAVE, "status", "in", ["Approved", PENDING]],
      ],
      orderBy: "leave_date asc",
      limit: 100,
    }),
  ]);

  return {
    member,
    year,
    month,
    logs: logs.map(toLog),
    regularizations: regularizations.map(toRegularization),
    leaves: leaves.map(toLeave),
  };
};

// ---------------------------------------------------------- regularizations

export const createRegularization = async ({ member, attendanceDate, punchIn, punchOut, reason }) => {
  const date = requireDate(attendanceDate, "day to regularize");
  if (date > erpToday()) {
    throw rule("A day that has not happened yet cannot be regularized.", { code: "FUTURE" });
  }

  const requestedIn = text(punchIn);
  const requestedOut = text(punchOut);
  if (!requestedIn && !requestedOut) {
    throw rule("Give at least one of the punch times.", { code: "NO_TIMES" });
  }
  for (const stamp of [requestedIn, requestedOut]) {
    if (stamp && dateOf(stamp) !== date) {
      throw rule("The punch times must fall on the day being regularized.", { code: "BAD_TIME" });
    }
  }
  if (requestedIn && requestedOut && requestedOut <= requestedIn) {
    throw rule("Punch-out must be after punch-in.", { code: "BAD_TIME" });
  }

  const open = await listDocs(REG, {
    fields: ["name"],
    filters: [
      [REG, "member", "=", member],
      [REG, "attendance_date", "=", date],
      [REG, "status", "=", PENDING],
    ],
    limit: 1,
  });
  if (open.length) {
    throw rule("A regularization for this day is already awaiting approval.", { code: "DUPLICATE" });
  }

  const created = await createDoc(REG, {
    member,
    attendance_date: date,
    ...(requestedIn ? { requested_punch_in: requestedIn } : {}),
    ...(requestedOut ? { requested_punch_out: requestedOut } : {}),
    reason: String(reason || "").trim(),
    status: PENDING,
  });
  return toRegularization(created);
};

/**
 * What was actually punched on the days these corrections are for, keyed
 * `member|date`. Null when the logs could not be read, so nothing claims a
 * member punched nothing when nobody checked.
 */
const actualPunchesFor = async (regs) => {
  const members = [...new Set(regs.map((r) => r.member).filter(Boolean))];
  const dates = [...new Set(regs.map((r) => r.date).filter(Boolean))];
  if (!members.length || !dates.length) return new Map();
  try {
    const rows = await listDocs(LOG, {
      fields: ["member", "attendance_date", "punch_in_time", "punch_out_time"],
      filters: [
        [LOG, "member", "in", members],
        [LOG, "attendance_date", "in", dates],
      ],
      limit: 500,
    });
    return new Map(
      rows.map((l) => [
        `${l.member}|${l.attendance_date}`,
        { punchIn: text(l.punch_in_time), punchOut: text(l.punch_out_time) },
      ])
    );
  } catch {
    return null;
  }
};

/**
 * Every correction awaiting a decision, oldest day first, each carrying what
 * the day's log actually holds. The approver used to be shown only what was
 * asked for, and could not tell a forgotten punch-out from a day nobody
 * punched at all.
 */
export const pendingRegularizations = async () => {
  const rows = await listDocs(REG, {
    fields: REG_FIELDS,
    filters: [[REG, "status", "=", PENDING]],
    orderBy: "attendance_date asc",
    limit: 200,
  });
  const list = rows.map(toRegularization);
  const actual = await actualPunchesFor(list);
  return list.map((r) => ({
    ...r,
    actual: actual ? (actual.get(`${r.member}|${r.date}`) ?? { punchIn: null, punchOut: null }) : null,
  }));
};

/**
 * Approving writes the requested times onto the day's log and creates the log
 * if the day had none.
 *
 * A time the request leaves blank keeps whatever the log already holds. The
 * sales app overwrote both with the request, which wiped a real punch-in when
 * a rep asked only for the punch-out they had forgotten.
 */
export const decideRegularization = async ({ id, approve, decidedBy }) => {
  const reg = toRegularization(await getDoc(REG, id));
  if (reg.status !== PENDING) {
    throw rule(`This request was already ${reg.status.toLowerCase()}.`, { code: "ALREADY_DECIDED" });
  }

  const now = erpNow();
  if (approve) {
    const existing = await logFor(reg.member, reg.date);
    const punchIn = reg.requestedIn ?? existing?.punchIn ?? null;
    const punchOut = reg.requestedOut ?? existing?.punchOut ?? null;
    const body = {
      punch_in_time: punchIn,
      punch_out_time: punchOut,
      working_hours: workingHours(punchIn, punchOut) ?? 0,
      status: punchOut ? "Punched Out" : "Punched In",
      regularized: 1,
    };
    if (existing) {
      await updateDoc(LOG, existing.id, body);
    } else {
      await createDoc(LOG, { member: reg.member, attendance_date: reg.date, ...body });
    }
  }

  const updated = await updateDoc(REG, id, {
    status: approve ? "Approved" : "Rejected",
    decided_by: decidedBy,
    decided_at: now,
  });
  return toRegularization(updated);
};

// -------------------------------------------------------------------- leave

const schemeFor = async (member) => {
  try {
    const doc = await getDoc(SCHEME, member);
    return { accrualFrom: text(doc.accrual_from), openingBalance: num(doc.opening_balance) };
  } catch (error) {
    if (error instanceof ErpError && error.status === 404) return null;
    throw error;
  }
};

/**
 * What paid leave this member has left. `NO_SCHEME` for anybody without a
 * scheme row — a different answer from zero, which every screen keeps
 * different.
 */
export const leaveBalanceOf = async (member, asOf = erpToday()) => {
  const scheme = await schemeFor(member);
  if (!scheme?.accrualFrom) return { ...NO_SCHEME };

  // Only leave since accrual began. The opening balance is already net of
  // anything taken before then — counting it twice would charge for the same
  // days again.
  const rows = await listDocs(LEAVE, {
    fields: ["leave_days", "status"],
    filters: [
      [LEAVE, "member", "=", member],
      [LEAVE, "leave_date", ">=", scheme.accrualFrom],
      [LEAVE, "status", "in", ["Approved", PENDING]],
    ],
    limit: 1000,
  });

  let taken = 0;
  let pending = 0;
  for (const row of rows) {
    if (row.status === "Approved") taken += num(row.leave_days);
    else pending += num(row.leave_days);
  }

  return leaveBalanceFor({
    accrualFrom: scheme.accrualFrom,
    opening: scheme.openingBalance,
    taken,
    pending,
    asOf,
  });
};

export const leavesOf = async (member) => {
  const rows = await listDocs(LEAVE, {
    fields: LEAVE_FIELDS,
    filters: [[LEAVE, "member", "=", member]],
    orderBy: "leave_date desc",
    limit: 100,
  });
  return rows.map(toLeave);
};

/** The balance and the requests together — what the Leave screen draws. */
export const leaveOverview = async (member) => {
  const [balance, requests] = await Promise.all([leaveBalanceOf(member), leavesOf(member)]);
  return { balance, requests };
};

/** Two requests for the same day would deduct it twice. */
const assertNoLeaveOn = async (member, date) => {
  const rows = await listDocs(LEAVE, {
    fields: ["name", "status"],
    filters: [
      [LEAVE, "member", "=", member],
      [LEAVE, "leave_date", "=", date],
      [LEAVE, "status", "in", [PENDING, "Approved"]],
    ],
    limit: 1,
  });
  if (rows.length) {
    throw rule(
      rows[0].status === "Approved"
        ? "Leave is already approved for that day."
        : "Leave for that day is already awaiting approval.",
      { code: "DUPLICATE" }
    );
  }
};

const halfPeriodOf = (halfDay, halfPeriod) =>
  halfDay ? (String(halfPeriod || "") === "Afternoon" ? "Afternoon" : "Morning") : "";

export const createLeaveRequest = async ({ member, leaveDate, halfDay, halfPeriod, reason }) => {
  const date = requireDate(leaveDate, "leave date");
  const now = erpNow();
  const half = Boolean(halfDay);

  if (date < dateOf(now)) {
    throw rule(
      "Leave can be applied for today or a later day. Ask your manager to record an earlier day.",
      { code: "PAST" }
    );
  }
  if (half) assertHalfDayInTime(date, now);
  await assertNoLeaveOn(member, date);

  const created = await createDoc(LEAVE, {
    member,
    leave_date: date,
    half_day: half ? 1 : 0,
    half_day_period: halfPeriodOf(half, halfPeriod),
    leave_days: leaveDaysFor(half),
    reason: String(reason || "").trim(),
    status: PENDING,
  });
  return toLeave(created);
};

/** Every leave request awaiting a decision, soonest day first, with the member's balance beside it. */
export const pendingLeave = async () => {
  const rows = await listDocs(LEAVE, {
    fields: LEAVE_FIELDS,
    filters: [[LEAVE, "status", "=", PENDING]],
    orderBy: "leave_date asc",
    limit: 200,
  });
  const list = rows.map(toLeave);

  const balances = new Map();
  await Promise.all(
    [...new Set(list.map((l) => l.member))].map(async (member) => {
      try {
        balances.set(member, await leaveBalanceOf(member));
      } catch {
        // Shown without a balance rather than not shown at all.
      }
    })
  );
  return list.map((l) => ({ ...l, balance: balances.get(l.member) ?? null }));
};

export const decideLeave = async ({ id, approve, decidedBy }) => {
  const leave = toLeave(await getDoc(LEAVE, id));
  if (leave.status !== PENDING) {
    throw rule(`This request was already ${leave.status.toLowerCase()}.`, { code: "ALREADY_DECIDED" });
  }
  const updated = await updateDoc(LEAVE, id, {
    status: approve ? "Approved" : "Rejected",
    decided_by: decidedBy,
    decided_at: erpNow(),
  });
  return toLeave(updated);
};

/**
 * Leave recorded by the manager on a member's behalf — a phoned-in absence.
 * Already approved, and any date is allowed: the whole point is recording a
 * day that has already happened.
 */
export const managerLeaveEntry = async ({ member, leaveDate, halfDay, halfPeriod, reason, decidedBy }) => {
  const date = requireDate(leaveDate, "leave date");
  const half = Boolean(halfDay);
  const team = await members();
  if (!team.some((m) => m.email === member)) {
    throw rule(`${member} is not on the maintenance team.`, { code: "NOT_A_MEMBER" });
  }
  await assertNoLeaveOn(member, date);

  const created = await createDoc(LEAVE, {
    member,
    leave_date: date,
    half_day: half ? 1 : 0,
    half_day_period: halfPeriodOf(half, halfPeriod),
    leave_days: leaveDaysFor(half),
    reason: String(reason || "").trim(),
    status: "Approved",
    is_manager_entry: 1,
    decided_by: decidedBy,
    decided_at: erpNow(),
  });
  return toLeave(created);
};

// --------------------------------------------------------------------- team

/**
 * Everyone holding the member role, with their leave scheme if they have one.
 *
 * Read off the role rather than a roster of our own, so adding somebody to the
 * team is one act — giving them the role — and there is no second list to
 * forget. Filtering a parent by its child table is something Frappe allows
 * without read access to the child, which the integration account lacks for
 * `Has Role`.
 */
export const members = async () => {
  const rows = await listDocs("User", {
    fields: ["name", "full_name"],
    filters: [
      ["Has Role", "role", "=", MEMBER_ROLE],
      ["User", "enabled", "=", 1],
    ],
    orderBy: "full_name asc",
    limit: 100,
  });

  // A user listed twice (the same role granted twice) is one person.
  const seen = new Map();
  for (const row of rows) {
    if (!seen.has(row.name)) seen.set(row.name, { email: row.name, name: row.full_name || row.name });
  }

  return Promise.all(
    [...seen.values()].map(async (m) => ({ ...m, scheme: await schemeFor(m.email).catch(() => null) }))
  );
};

export const isMember = async (email) => (await members()).some((m) => m.email === email);

/**
 * Puts a member on the paid-leave scheme, or changes their figures. An empty
 * accrual date takes them off it — the row goes, because "on the scheme from
 * nowhere" is not a state the balance can be worked out from.
 */
export const setScheme = async ({ member, accrualFrom, openingBalance }) => {
  if (!(await isMember(member))) {
    throw rule(`${member} is not on the maintenance team.`, { code: "NOT_A_MEMBER" });
  }

  const existing = await schemeFor(member);
  const from = String(accrualFrom ?? "").slice(0, 10);

  if (!from) {
    if (existing) await deleteDoc(SCHEME, member);
    return null;
  }
  if (!isIsoDate(from)) throw rule("Pick the month the accrual starts from.", { code: "BAD_DATE" });

  const opening = Number(openingBalance ?? 0);
  if (!Number.isFinite(opening) || opening < 0) {
    throw rule("The carried-forward balance must be zero or more.", { code: "BAD_BALANCE" });
  }

  const fields = { accrual_from: from, opening_balance: opening };
  const saved = existing
    ? await updateDoc(SCHEME, member, fields)
    : await createDoc(SCHEME, { member, ...fields });
  return { accrualFrom: text(saved.accrual_from), openingBalance: num(saved.opening_balance) };
};
