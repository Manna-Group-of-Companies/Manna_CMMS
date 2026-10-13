import * as attendance from "../repository/attendance.js";
import { erpNow } from "../integrations/erpnext/time.js";
import { MAINTENANCE_MANAGER, MAINTENANCE_MEMBER, MANAGER } from "../config/access.js";

/**
 * Attendance and leave for the maintenance team, for the phone.
 *
 * Two audiences on one screen. A team member punches, looks at their month,
 * asks for a correction and applies for leave — always their own, with the
 * identity taken from the session and never from the body. The Maintenance
 * Manager (and the Admin, as the usual fallback) decides those requests, looks
 * at anybody's month, records a phoned-in absence and keeps the leave schemes.
 */

/** Who may decide a request, look at another member's month, and keep the schemes. */
export const APPROVER_ROLES = [MANAGER, MAINTENANCE_MANAGER];

const canApprove = (req) => APPROVER_ROLES.includes(req.user?.role);

/**
 * Turns a refusal into something the screen can show.
 *
 * A rule this module raised itself carries 422 and a code the phone acts on —
 * `OUTSIDE_WINDOW` opens the regularization shortcut. ERPNext's own refusals
 * keep their status. Anything else is a fault here, logged with its real
 * message and reported with a plain one.
 */
const fail = (res, error, fallback = "Something went wrong") => {
  if (error?.name === "AttendanceRuleError") {
    return res.status(422).json({
      message: error.message,
      code: error.code,
      regularizeDate: error.regularizeDate,
    });
  }
  if (error?.status === 403) {
    return res.status(403).json({ message: "Your ERPNext role does not allow that.", detail: error.message });
  }
  if (error?.status === 404) {
    return res.status(404).json({ message: "That record no longer exists." });
  }
  console.error(`${fallback}:`, error?.message || error);
  return res.status(500).json({ message: fallback });
};

const boolOf = (value) => value === true || value === 1 || value === "1" || value === "true";

/**
 * The member whose records a request is about.
 *
 * A member is always themselves. An approver may name somebody else with
 * `member`, and gets themselves when they do not — which, for an approver who
 * is not on the team, is an empty month rather than an error.
 */
const subjectOf = (req) => {
  const asked = String(req.query?.member || req.params?.email || "").trim().toLowerCase();
  if (asked && canApprove(req)) return asked;
  return String(req.user.email || "").toLowerCase();
};

/**
 * @desc    Where this person stands today, and what the screen needs to draw
 * @route   GET /api/attendance/me
 * @access  Private
 */
export const me = async (req, res) => {
  try {
    const isMember = req.user.role === MAINTENANCE_MEMBER;
    res.json({
      member: req.user.email,
      name: req.user.name || "",
      isMember,
      canApprove: canApprove(req),
      serverNow: erpNow(),
      window: attendance.punchWindow(),
      today: isMember ? await attendance.todayFor(req.user.email) : null,
    });
  } catch (error) {
    fail(res, error, "Could not read today's attendance");
  }
};

/**
 * @desc    Start the day
 * @route   POST /api/attendance/punch-in
 * @access  Private — team members
 */
export const punchIn = async (req, res) => {
  const { latitude, longitude } = req.body || {};
  try {
    res.status(201).json(await attendance.punchIn({ member: req.user.email, latitude, longitude }));
  } catch (error) {
    fail(res, error, "Could not punch in");
  }
};

/**
 * @desc    End the day, or move the end later
 * @route   POST /api/attendance/punch-out
 * @access  Private — team members
 */
export const punchOut = async (req, res) => {
  const { latitude, longitude } = req.body || {};
  try {
    res.json(await attendance.punchOut({ member: req.user.email, latitude, longitude }));
  } catch (error) {
    fail(res, error, "Could not punch out");
  }
};

/**
 * @desc    One month of punches, corrections and leave
 * @route   GET /api/attendance/month?year=&month=&member=
 * @access  Private
 */
export const month = async (req, res) => {
  const now = erpNow();
  const year = Number(req.query.year) || Number(now.slice(0, 4));
  const monthNo = Number(req.query.month) || Number(now.slice(5, 7));
  if (year < 2000 || year > 2100 || monthNo < 1 || monthNo > 12) {
    return res.status(400).json({ message: "Give a year and a month" });
  }
  try {
    res.json(await attendance.monthFor(subjectOf(req), year, monthNo));
  } catch (error) {
    fail(res, error, "Could not load the month");
  }
};

/**
 * @desc    Ask for a day's punches to be corrected
 * @route   POST /api/attendance/regularizations
 * @access  Private — team members
 */
export const requestRegularization = async (req, res) => {
  const { attendanceDate, punchIn: requestedIn, punchOut: requestedOut, reason } = req.body || {};
  try {
    res.status(201).json(
      await attendance.createRegularization({
        member: req.user.email,
        attendanceDate,
        punchIn: requestedIn,
        punchOut: requestedOut,
        reason,
      })
    );
  } catch (error) {
    fail(res, error, "Could not submit the regularization");
  }
};

/**
 * @desc    Corrections awaiting a decision
 * @route   GET /api/attendance/regularizations/pending
 * @access  Private — approvers
 */
export const pendingRegularizations = async (req, res) => {
  try {
    res.json(await attendance.pendingRegularizations());
  } catch (error) {
    fail(res, error, "Could not load the regularizations");
  }
};

/**
 * @desc    Approve or reject a correction
 * @route   POST /api/attendance/regularizations/:id/decide
 * @access  Private — approvers
 */
export const decideRegularization = async (req, res) => {
  try {
    res.json(
      await attendance.decideRegularization({
        id: req.params.id,
        approve: boolOf(req.body?.approve),
        decidedBy: req.user.email,
      })
    );
  } catch (error) {
    fail(res, error, "Could not record the decision");
  }
};

/**
 * @desc    My leave balance and requests
 * @route   GET /api/attendance/leave
 * @access  Private — team members
 */
export const myLeave = async (req, res) => {
  try {
    res.json(await attendance.leaveOverview(req.user.email));
  } catch (error) {
    fail(res, error, "Could not load your leave");
  }
};

/**
 * @desc    Apply for leave
 * @route   POST /api/attendance/leave
 * @access  Private — team members
 */
export const applyLeave = async (req, res) => {
  const { leaveDate, halfDay, halfPeriod, reason } = req.body || {};
  try {
    res.status(201).json(
      await attendance.createLeaveRequest({
        member: req.user.email,
        leaveDate,
        halfDay: boolOf(halfDay),
        halfPeriod,
        reason,
      })
    );
  } catch (error) {
    fail(res, error, "Could not apply for leave");
  }
};

/**
 * @desc    Leave requests awaiting a decision
 * @route   GET /api/attendance/leave/pending
 * @access  Private — approvers
 */
export const pendingLeave = async (req, res) => {
  try {
    res.json(await attendance.pendingLeave());
  } catch (error) {
    fail(res, error, "Could not load the leave requests");
  }
};

/**
 * @desc    Approve or reject a leave request
 * @route   POST /api/attendance/leave/:id/decide
 * @access  Private — approvers
 */
export const decideLeave = async (req, res) => {
  try {
    res.json(
      await attendance.decideLeave({
        id: req.params.id,
        approve: boolOf(req.body?.approve),
        decidedBy: req.user.email,
      })
    );
  } catch (error) {
    fail(res, error, "Could not record the decision");
  }
};

/**
 * @desc    Record leave on a member's behalf, already approved, any date
 * @route   POST /api/attendance/leave/manager-entry
 * @access  Private — approvers
 */
export const managerLeaveEntry = async (req, res) => {
  const { member, leaveDate, halfDay, halfPeriod, reason } = req.body || {};
  if (!member) return res.status(400).json({ message: "Pick a team member" });
  try {
    res.status(201).json(
      await attendance.managerLeaveEntry({
        member: String(member).trim().toLowerCase(),
        leaveDate,
        halfDay: boolOf(halfDay),
        halfPeriod,
        reason,
        decidedBy: req.user.email,
      })
    );
  } catch (error) {
    fail(res, error, "Could not record the leave");
  }
};

/**
 * @desc    The team, with each member's leave scheme
 * @route   GET /api/attendance/members
 * @access  Private — approvers
 */
export const members = async (req, res) => {
  try {
    res.json(await attendance.members());
  } catch (error) {
    fail(res, error, "Could not load the team");
  }
};

/**
 * @desc    One member's leave balance and requests
 * @route   GET /api/attendance/members/:email/leave
 * @access  Private — approvers
 */
export const memberLeave = async (req, res) => {
  try {
    res.json(await attendance.leaveOverview(subjectOf(req)));
  } catch (error) {
    fail(res, error, "Could not load that member's leave");
  }
};

/**
 * @desc    Put a member on the leave scheme, change their figures, or take them off it
 * @route   PUT /api/attendance/members/:email/scheme
 * @access  Private — approvers
 */
export const setScheme = async (req, res) => {
  const { accrualFrom, openingBalance } = req.body || {};
  try {
    res.json({
      member: subjectOf(req),
      scheme: await attendance.setScheme({ member: subjectOf(req), accrualFrom, openingBalance }),
    });
  } catch (error) {
    fail(res, error, "Could not save the leave scheme");
  }
};
