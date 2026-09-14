import { erpNow } from "./time.js";

/**
 * What each stage of a maintenance request collects, and what it will not move
 * without.
 *
 * The same split as breakdownStages.js, and for the same reason: ERPNext's
 * workflow decides *who* may move a record on and in what order, and has no
 * opinion about whether anything was written down first. This is the other
 * half.
 *
 * The stages are deliberately shorter than a breakdown's. A planned job does
 * not need an assessment, a failure mode, a root cause or a prevention action,
 * and demanding them is what had people typing "n/a" while these two record
 * types shared one form.
 *
 * Pure: no database, no network.
 */

const now = () => erpNow();

/**
 * Who may take each step — enforced here, not by ERPNext.
 *
 * Every transition is applied through the integration account, so ERPNext only
 * ever checks *its* roles and never sees the person who clicked. The roles on
 * the workflow stay as documentation of intent and to keep the ERPNext desk
 * honest; this is the check that actually holds. See breakdownStages.js for
 * the full account of how that was discovered.
 *
 * `requesterOnly` is the rule a workflow cannot express: closing is not open to
 * a role, it is open to the one person who asked for the work. Anybody else
 * closing it means the queue is being tidied rather than the job accepted.
 */
export const REQUEST_STAGES = {
  /**
   * Maintenance takes the job on.
   *
   * Nothing is required beyond the moment work began — a planned job is
   * accepted on the strength of the request, and asking for a method statement
   * before a fitter picks up a spanner would simply delay the fitter.
   *
   * `started_at` is typed rather than stamped, for the same reason the
   * breakdown's is: the record is usually opened after the fact, and a stamped
   * time makes every job look as though it started the moment it was read.
   */
  "Start Work": {
    allowedRoles: ["Manager", "Maintenance Manager"],
    from: "Requested",
    to: "In Progress",
    title: "Take the job on",
    blurb: "When work began, who is doing it, and when it should be finished by.",
    fields: ["started_at", "assigned_to", "target_date", "plan_notes"],
    required: ["started_at"],
    labels: {
      started_at: "Work started at",
      assigned_to: "Assigned to",
      target_date: "Target date",
      plan_notes: "How it will be done",
    },
    stamp: (user) => ({ accepted_by: user?.email || "" }),
  },

  /**
   * What was actually done, and what it took.
   *
   * Materials and labour are the point of this stage. A maintenance department
   * that records only that a job finished can say it was busy and nothing about
   * what the work cost — and the fabrication jobs are exactly the ones where
   * the material is most of the cost.
   *
   * Materials are not required: an inspection consumes nothing, and demanding a
   * row would get a made-up one. The crew is required, because somebody did the
   * work and a job with nobody on it is a job nobody can be asked about.
   */
  "Mark Complete": {
    allowedRoles: ["Manager", "Maintenance Manager"],
    from: "In Progress",
    to: "Completed",
    title: "Mark it complete",
    blurb: "What was done, when it finished, the materials used and who did it.",
    fields: ["work_done", "completed_at", "materials_used", "worked_by"],
    required: ["work_done", "completed_at", "worked_by"],
    labels: {
      work_done: "Work carried out",
      completed_at: "Completed at",
      materials_used: "Materials used",
      worked_by: "Worked by",
    },
    stamp: (user) => ({ completed_by: user?.email || "" }),
  },

  /**
   * The requester accepts it.
   *
   * Restricted to the person who raised it, which no workflow role can express.
   * Nothing is required: forcing a remark to close would only produce "ok", and
   * an "ok" recorded as feedback is worse than a blank. The tick that says
   * whether it was done to satisfaction is the answer that matters, and it has
   * a default so closing stays one click when it went fine.
   */
  "Close Request": {
    allowedRoles: ["Manager", "Maintenance Manager", "Supervisor", "Production Manager"],
    requesterOnly: true,
    from: "Completed",
    to: "Closed",
    title: "Close the request",
    blurb: "You asked for this work. Confirm it is what you wanted.",
    fields: ["closing_remarks", "satisfied"],
    required: [],
    labels: { closing_remarks: "Closing remarks", satisfied: "Done to satisfaction" },
    stamp: (user) => ({ closed_by: user?.email || "", closed_at: now() }),
  },

  /**
   * Closing a request whose requester has gone.
   *
   * People leave, and a completed job that can never be closed sits in the
   * queue forever looking like outstanding work. Kept as a separate action
   * rather than a wider rule on the one above, so the record says plainly that
   * somebody other than the requester signed it off.
   */
  "Close as Manager": {
    allowedRoles: ["Manager"],
    from: "Completed",
    to: "Closed",
    title: "Close on the requester's behalf",
    blurb: "For a request whose requester is no longer here to close it.",
    fields: ["closing_remarks", "satisfied"],
    required: ["closing_remarks"],
    labels: { closing_remarks: "Why you are closing it", satisfied: "Done to satisfaction" },
    stamp: (user) => ({ closed_by: user?.email || "", closed_at: now() }),
  },

  /**
   * Maintenance will not do it.
   *
   * The reason is required and that is the whole value of the step. A request
   * that disappears without one teaches the plant that raising them is
   * pointless, which is how a queue stops being used.
   */
  Reject: {
    allowedRoles: ["Manager", "Maintenance Manager"],
    from: "Requested",
    to: "Cancelled",
    title: "Turn the request down",
    blurb: "Say why. A request that vanishes without a reason stops people raising them.",
    fields: ["cancel_reason"],
    required: ["cancel_reason"],
    labels: { cancel_reason: "Why not" },
    stamp: (user) => ({ cancelled_by: user?.email || "" }),
  },

  /** The requester no longer needs it. */
  Withdraw: {
    allowedRoles: ["Manager", "Maintenance Manager", "Supervisor", "Production Manager"],
    requesterOnly: true,
    from: "Requested",
    to: "Cancelled",
    title: "Withdraw the request",
    blurb: "It is no longer needed, or it was raised twice.",
    fields: ["cancel_reason"],
    required: ["cancel_reason"],
    labels: { cancel_reason: "Why" },
    stamp: (user) => ({ cancelled_by: user?.email || "" }),
  },
};

/** The action that moves a request on from the state it is in. */
export const nextRequestActionFor = (state) =>
  Object.entries(REQUEST_STAGES).find(
    ([action, s]) => s.from === state && !["Reject", "Withdraw", "Close as Manager"].includes(action)
  )?.[0] || "";

/** A value counts as given when it is not blank, and not an empty table. */
const isGiven = (value) => {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  return true;
};

/**
 * What is still missing before this action can be taken.
 *
 * @param action  the workflow action
 * @param doc     the request as it would be after the pending edits
 * @returns [{ field, label }] - empty when the stage is complete
 */
export const missingForRequest = (action, doc = {}) => {
  const stage = REQUEST_STAGES[action];
  if (!stage) return [];

  return stage.required
    .filter((field) => !isGiven(doc[field]))
    .map((field) => ({ field, label: stage.labels?.[field] || field }));
};

/**
 * True when this person may take this step.
 *
 * `requesterOnly` narrows it further than any role can: the signed-in user has
 * to be the one who raised the request. A Manager is exempt because somebody
 * has to be able to unblock a record whose requester has left, and the separate
 * "Close as Manager" action records that they did.
 */
export const mayTakeRequestStep = (action, user = {}, request = {}) => {
  const stage = REQUEST_STAGES[action];
  if (!stage) return false;
  if (!stage.allowedRoles.includes(user?.role)) return false;
  if (stage.requesterOnly && user?.role !== "Manager") {
    return Boolean(user?.email) && user.email === request?.requested_by;
  }
  return true;
};

/** The stage contract, safe to hand to the browser. */
export const describeRequestStages = () =>
  Object.fromEntries(
    Object.entries(REQUEST_STAGES).map(([action, s]) => [
      action,
      {
        from: s.from,
        to: s.to,
        title: s.title,
        blurb: s.blurb,
        fields: s.fields,
        required: s.required,
        allowedRoles: s.allowedRoles,
        requesterOnly: Boolean(s.requesterOnly),
        labels: s.labels || {},
      },
    ])
  );
