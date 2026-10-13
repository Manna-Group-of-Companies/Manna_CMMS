/**
 * The attendance and leave rules, as plain functions over plain values.
 *
 * Ported from the field-sales app (SALES_DASHBOARD: `app/lib/core/
 * attendance_rules.dart`, `app/lib/core/leave_balance.dart` and the never-
 * installed `app/server/attendance_log_time_rules.py`). There the rules had to
 * run on the phone, because that site's plan had no Server Scripts and the rep
 * wrote straight to ERPNext. Here every write comes through this server, so
 * this is the copy that counts: every stamp is the server's own clock, and
 * moving the phone's clock changes nothing. The phone mirrors the two window
 * numbers only so it does not offer a punch this server is going to refuse.
 *
 * No ERPNext and no Express in this file, so the arithmetic can be tested on
 * its own — see `tests/attendanceRules.test.js`, which pins the leave figures
 * to HR's own sheet.
 */

/** Punch-in opens at 05:00. */
export const PUNCH_IN_FROM_MINUTE = 5 * 60;

/** Punch-out closes at the end of the 21:30 minute. */
export const PUNCH_OUT_UNTIL_MINUTE = 21 * 60 + 30;

/** A half day for today has to be asked for before noon. */
export const HALF_DAY_CUTOFF_MINUTE = 12 * 60;

/**
 * One day of paid leave for every month on the scheme.
 *
 * A constant rather than a field because everyone on the scheme accrues at
 * the same rate. If a unit is ever put on a different one, this becomes a
 * column on CMMS Leave Scheme beside the opening balance.
 */
export const LEAVE_ACCRUAL_PER_MONTH = 1;

/**
 * A rule refusing a request, as opposed to ERPNext or the network failing.
 *
 * Carries `status` so the controller's error mapping can tell it from an
 * ErpError, and `regularizeDate` when the person's only way forward is a
 * regularization request for that day, so the phone can offer the shortcut.
 */
export class AttendanceRuleError extends Error {
  constructor(message, { code = "RULE", regularizeDate = null } = {}) {
    super(message);
    this.name = "AttendanceRuleError";
    this.status = 422;
    this.code = code;
    this.regularizeDate = regularizeDate;
  }
}

/** Frappe reads an unset Date or Datetime back as null, '' or the string 'null'. */
export const isSet = (value) => {
  const s = String(value ?? "").trim();
  return s !== "" && s !== "null";
};

/** `YYYY-MM-DD` of an ERPNext stamp, or "" when there is none. */
export const dateOf = (stamp) => (isSet(stamp) ? String(stamp).slice(0, 10) : "");

/** Minute of the day of an ERPNext stamp (`YYYY-MM-DD HH:MM:SS`), or null. */
export const minuteOf = (stamp) => {
  const m = /^\d{4}-\d{2}-\d{2}[ T](\d{2}):(\d{2})/.exec(String(stamp ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

export const isIsoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));

/**
 * Hours between two stamps, to two places and never negative.
 *
 * Null when either is unset or unreadable, which is a different answer from
 * zero: a day with no punch-out has no measured hours, and writing 0 there
 * would make a forgotten punch look like a day nobody worked.
 */
export const workingHours = (punchIn, punchOut) => {
  if (!isSet(punchIn) || !isSet(punchOut)) return null;
  const a = new Date(String(punchIn).replace(" ", "T"));
  const b = new Date(String(punchOut).replace(" ", "T"));
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.max(0, Math.round(((b - a) / 3_600_000) * 100) / 100);
};

export const assertPunchInOpen = (nowStamp) => {
  if (minuteOf(nowStamp) < PUNCH_IN_FROM_MINUTE) {
    throw new AttendanceRuleError(
      "Punch-in opens at 5:00 AM. If you started before that, punch in now and " +
        "request a regularization for the earlier time.",
      { code: "OUTSIDE_WINDOW" }
    );
  }
};

export const assertPunchOutOpen = (nowStamp) => {
  if (minuteOf(nowStamp) > PUNCH_OUT_UNTIL_MINUTE) {
    throw new AttendanceRuleError(
      "Punch-out closed at 9:30 PM. Request a regularization for today and your " +
        "manager can set the time you actually finished.",
      { code: "OUTSIDE_WINDOW", regularizeDate: dateOf(nowStamp) }
    );
  }
};

export const assertHalfDayInTime = (leaveDate, nowStamp) => {
  if (leaveDate === dateOf(nowStamp) && minuteOf(nowStamp) >= HALF_DAY_CUTOFF_MINUTE) {
    throw new AttendanceRuleError("A half-day for today must be applied before 12 pm.", {
      code: "HALF_DAY_CUTOFF",
    });
  }
};

/** First and last day of a month, as ERPNext dates. */
export const monthBounds = (year, month) => {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const last = new Date(year, month, 0).getDate();
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${String(last).padStart(2, "0")}` };
};

const parseIsoDate = (raw) => {
  if (!isSet(raw)) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw).trim());
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
};

/**
 * Whole months from `fromIso` to `asOfIso`, inclusive of both ends' months.
 *
 * August to August is one month, not zero: the day is credited at the START
 * of its month, so a leave taken in August comes out of August's day. Zero
 * when `asOf` is before `from`, so a scheme starting next month credits
 * nothing yet.
 */
export const monthsAccrued = (fromIso, asOfIso) => {
  const from = parseIsoDate(fromIso);
  const asOf = parseIsoDate(asOfIso);
  if (!from || !asOf) return 0;
  const months = (asOf.year - from.year) * 12 + (asOf.month - from.month) + 1;
  return months < 0 ? 0 : months;
};

/**
 * Not on the scheme at all. Every figure is zero and means nothing — the
 * screens say "no leave scheme", never "0 days left", which reads as "you
 * have used them all".
 */
export const NO_SCHEME = Object.freeze({
  onScheme: false,
  opening: 0,
  accrued: 0,
  taken: 0,
  pending: 0,
  entitlement: 0,
  remaining: 0,
  overdrawn: false,
});

/**
 * How much paid leave somebody actually has.
 *
 * A running accrual, not an annual allowance: a balance carried forward from
 * before the scheme started, plus one day a month since, less what has been
 * approved. Pending days are reported but not deducted — a request that is
 * refused was never leave.
 *
 * `remaining` never reads below zero: "-2 days remaining" invites working out
 * what can still be taken, and the answer is nothing. `overdrawn` says plainly
 * that days already granted were unpaid.
 */
export const leaveBalanceFor = ({ accrualFrom, opening = 0, taken = 0, pending = 0, asOf }) => {
  // Unparseable reads as "not on the scheme" rather than as today: guessing
  // would invent an entitlement nobody granted.
  if (!parseIsoDate(accrualFrom)) return NO_SCHEME;

  const accrued = monthsAccrued(accrualFrom, asOf) * LEAVE_ACCRUAL_PER_MONTH;
  const entitlement = Number(opening) + accrued;
  const left = entitlement - Number(taken);

  return {
    onScheme: true,
    opening: Number(opening),
    accrued,
    taken: Number(taken),
    pending: Number(pending),
    entitlement,
    remaining: left < 0 ? 0 : left,
    overdrawn: left < -0.0001,
  };
};

export const leaveDaysFor = (halfDay) => (halfDay ? 0.5 : 1);
