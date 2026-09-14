import { erpNow } from "./time.js";

/**
 * What each stage of a breakdown collects, and what it will not move without.
 *
 * The workflow in ERPNext decides *who* may move a breakdown on and in what
 * order. It has no opinion about whether anything was written down first — so
 * until now a breakdown could travel Reported to Closed as a row of timestamps
 * with no cause, no spares, no owner and no prevention. That is a status
 * tracker, not a maintenance record.
 *
 * This is the other half: the fields each stage exists to capture, and the ones
 * without which the stage has not actually happened. Kept as data rather than
 * as `if` statements in a controller, because the screens need the same list to
 * mark fields required, and two hand-maintained copies of it would drift.
 *
 * Pure: no database, no network.
 */

/** ERPNext's datetime format, in ERPNext's timezone. See time.js. */
const now = () => erpNow();

/**
 * The stages, keyed by the workflow action that ends them.
 *
 * `required` is deliberately short. Every field a stage owns is offered, but
 * demanding all of them would have people typing "n/a" to get past the form,
 * and an "n/a" recorded as a root cause is worse than an empty one — it looks
 * like an answer.
 */
/**
 * Who may take each step — enforced here, not by ERPNext.
 *
 * The workflow names roles on its transitions, and it looks like that is what
 * restricts them. It is not. Every transition is applied through the
 * integration account, so ERPNext checks *its* roles and never sees the person
 * who clicked. That worked by accident while the integration account happened
 * to hold every store role; the moment the API key moved to an account that
 * did not, "Start Repair" started failing — and had it moved to one that held
 * more, everybody would silently have been able to close a breakdown.
 *
 * So the real check is here, against the signed-in user. The roles on the
 * workflow stay as documentation of intent and to keep the ERPNext desk honest.
 */
export const STAGES = {
  /**
   * Straight to work.
   *
   * There was an Assess stage and a Plan stage here. Both are gone: on this
   * site the assessment and the planning happen on the phone while somebody
   * walks to the machine, and a form demanding they be typed first only
   * delayed the repair or got filled in afterwards with invented answers.
   *
   * Nothing is collected. The act of starting is the record — it stamps when
   * work actually began, which is the boundary every downtime figure is
   * measured against.
   */
  "Start Repair": {
    allowedRoles: ["Manager", "Maintenance Manager"],
    from: "Reported",
    to: "Under Repair",
    title: "Start the repair",
    blurb: "When work actually began. The details are recorded once it runs again.",
    fields: ["repair_started_at"],
    required: ["repair_started_at"],
    labels: { repair_started_at: "Work started at" },
    /**
     * Typed, not stamped.
     *
     * It was the moment somebody pressed the button, which is only the truth
     * when the button is pressed on the shop floor. In practice the record is
     * opened later, and a stamped time made every repair look instant and the
     * delay before it look longer than it was. Both halves of the downtime
     * split hang off this one figure, so it has to be the real one.
     */
    stamp: () => ({}),
  },

  /**
   * What happened, recorded while the machine is open.
   *
   * Facts only at this stage — what was done, when it ran again, who did it,
   * what it took. Why it failed is asked at closing, because a cause worked
   * out with the machine back in production is a considered answer rather than
   * something written to get the form closed.
   */
  "Machine Running": {
    allowedRoles: ["Manager", "Maintenance Manager"],
    from: "Under Repair",
    to: "Repaired",
    title: "Machine running again",
    blurb: "What was done, when it was handed back to production, and what it took.",
    fields: [
      "actions_performed",
      "completed_at",
      "failure_mode",
      "repaired_by",
      "spares_required",
    ],
    required: ["actions_performed", "completed_at", "failure_mode"],
    labels: {
      actions_performed: "What was done",
      /**
       * The hand-over, not the last turn of the spanner.
       *
       * Those are two different moments and only one of them ends the stoppage:
       * a machine can be mechanically finished and still waiting on a trial
       * run, a mould change or an operator. Downtime is measured to the moment
       * production got the machine back, because a figure measured to anything
       * else understates every stoppage on the site.
       */
      completed_at: "Hand over time",
      failure_mode: "Failure mode",
      repaired_by: "Repaired by",
    },
    stamp: () => ({}),
  },

  /**
   * The analysis, and what changes because of it.
   *
   * This is the stage the whole module exists for, and it is the Manager's on
   * purpose: somebody other than the person who did the repair has to look at
   * whether anything was learned. A breakdown closed with no cause and no
   * action is one that will be reported again.
   */
  Close: {
    allowedRoles: ["Manager"],
    from: "Repaired",
    to: "Closed",
    title: "Root cause and prevention",
    blurb: "Why it failed, whether it has happened before, and what changes now.",
    /**
     * "Has this happened before" is asked here and nowhere else.
     *
     * At the moment a machine stops nobody has the history in front of them,
     * and a guess at the report is a guess recorded as fact. At closing the
     * machine's whole record is on screen, so the question can actually be
     * answered — and it is the answer that turns four ordinary repairs into one
     * problem somebody has to solve.
     *
     * Not required, deliberately. Forcing an answer would get a tick from
     * whoever wanted the form closed, and a false repeat flag is worse than a
     * missing one: the report highlights on it.
     */
    fields: ["root_cause", "prevention_actions", "repeat_failure", "repeat_of"],
    required: ["root_cause", "prevention_actions"],
    labels: {
      root_cause: "Root cause",
      prevention_actions: "Prevention actions",
      repeat_failure: "This has happened before",
      repeat_of: "The earlier breakdown",
    },
    stamp: () => ({ closed_at: now() }),
  },

  Cancel: {
    allowedRoles: ["Manager", "Maintenance Manager", "Production Manager"],
    from: "Reported",
    to: "Cancelled",
    title: "Cancel the report",
    blurb: "Nothing was actually wrong, or it was reported twice.",
    fields: [],
    required: [],
    stamp: () => ({}),
  },

  "Cancel as Maintenance": {
    allowedRoles: ["Manager", "Maintenance Manager"],
    from: "Reported",
    to: "Cancelled",
    title: "Cancel the report",
    blurb: "Nothing was actually wrong, or it was reported twice.",
    fields: [],
    required: [],
    stamp: () => ({}),
  },
};

/** The action that moves a breakdown on from the state it is in. */
export const nextActionFor = (state) =>
  Object.entries(STAGES).find(([action, s]) => s.from === state && !action.startsWith("Cancel"))?.[0] || "";

/** Every field any stage may write, for the update allow-list. */
export const WRITABLE_FIELDS = [
  ...new Set(Object.values(STAGES).flatMap((s) => s.fields)),
];

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
 * @param doc     the breakdown as it would be after the pending edits
 * @returns [{ field, label }] - empty when the stage is complete
 */
export const missingFor = (action, doc = {}) => {
  const stage = STAGES[action];
  if (!stage) return [];

  const required = [...stage.required, ...(stage.conditional?.(doc) || [])];

  return required
    .filter((field) => !isGiven(doc[field]))
    .map((field) => ({ field, label: stage.labels?.[field] || field }));
};

/** True when this role may take this step. */
export const mayTake = (action, role) => {
  const stage = STAGES[action];
  if (!stage) return false;
  return stage.allowedRoles.includes(role);
};

/** The stage contract, safe to hand to the browser. */
export const describeStages = () =>
  Object.fromEntries(
    Object.entries(STAGES).map(([action, s]) => [
      action,
      {
        from: s.from,
        to: s.to,
        title: s.title,
        blurb: s.blurb,
        fields: s.fields,
        required: s.required,
        allowedRoles: s.allowedRoles,
        labels: s.labels || {},
      },
    ])
  );
