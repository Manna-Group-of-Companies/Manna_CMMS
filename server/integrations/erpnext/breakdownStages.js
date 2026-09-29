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
   * What happened, why, and what changes because of it.
   *
   * Maintenance's last step, and the one the whole module exists for: a
   * breakdown closed with no cause and no action is one that will be reported
   * again.
   *
   * The root cause and the prevention actions are asked here, with the repair,
   * since 29 Sep 2026. They used to be asked at closing, so the cause was worked
   * out with the machine back in production. Closing is now the plant's
   * confirmation that the machine is back, and the plant does not evaluate a
   * breakdown - so the evaluation has to be done by maintenance before the
   * record reaches them.
   *
   * "Has this happened before" moved with them. At the moment a machine stops
   * nobody has the history in front of them; here the machine's earlier
   * failures are on screen, so the question can be answered by looking. Not
   * required, deliberately: a false repeat flag is worse than a missing one,
   * because the report highlights on it.
   */
  "Machine Running": {
    allowedRoles: ["Manager", "Maintenance Manager"],
    from: "Under Repair",
    to: "Repaired",
    title: "Machine running again",
    blurb: "What was done, when it was handed back, what it took, why it failed and what changes now.",
    fields: [
      "actions_performed",
      "completed_at",
      "failure_mode",
      "repaired_by",
      "spares_required",
      "root_cause",
      "prevention_actions",
      "repeat_failure",
      "repeat_of",
    ],
    required: ["actions_performed", "completed_at", "failure_mode", "root_cause", "prevention_actions"],
    labels: {
      root_cause: "Root cause",
      prevention_actions: "Prevention actions",
      repeat_failure: "This has happened before",
      repeat_of: "The earlier breakdown",
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
   * The plant accepts the machine back.
   *
   * Open to the plant manager and to maintenance (29 Sep 2026; it was the
   * Admin's alone). The plant reports a breakdown and closes it; everything in
   * between is maintenance's. Nothing is collected - the repair and its
   * evaluation are already on the record, and the plant is not asked to write
   * either.
   *
   * The root cause and prevention actions are still required, checked against
   * the record rather than asked for, so nothing reaches Closed without them.
   * A breakdown that got to Repaired before they moved into "Machine Running"
   * has neither; `nextActionFor` sends it to "Close with Root Cause" instead.
   *
   * `conditional` rather than `required` on purpose. `required` goes to the
   * screens, and the phone checks it against its own form - which on this
   * step has no fields, so it would refuse every close. The server's check
   * reads the record, so that is where the guard lives.
   */
  Close: {
    allowedRoles: ["Manager", "Maintenance Manager", "Production Manager"],
    from: "Repaired",
    to: "Closed",
    title: "Close the breakdown",
    blurb: "The machine is back in production and the repair is accepted.",
    fields: [],
    required: [],
    conditional: () => ["root_cause", "prevention_actions"],
    labels: {
      root_cause: "Root cause (maintenance records it)",
      prevention_actions: "Prevention actions (maintenance records them)",
    },
    stamp: () => ({ closed_at: now() }),
  },

  /**
   * Closing one that reached Repaired under the old flow.
   *
   * Until 29 Sep 2026 the root cause was asked at closing, so a breakdown
   * repaired before then has none, and the plant's close above would refuse
   * it. Maintenance records the cause and closes it in one step, as before.
   * Offered only for such a record - see `nextActionFor`. It is the same
   * ERPNext transition as Close, so the workflow needs nothing new.
   */
  "Close with Root Cause": {
    allowedRoles: ["Manager", "Maintenance Manager"],
    erpAction: "Close",
    catchUp: true,
    from: "Repaired",
    to: "Closed",
    title: "Record the root cause and close",
    blurb: "Why it failed, whether it has happened before, and what changes now.",
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

/**
 * The action that moves a breakdown on from the state it is in.
 *
 * Takes the record as well as its state for one case: a breakdown repaired
 * before the root cause moved into "Machine Running" has none, so its next
 * step is maintenance's catch-up close rather than the plant's.
 */
export const nextActionFor = (state, doc = {}) => {
  if (state === "Repaired" && (!isGiven(doc.root_cause) || !isGiven(doc.prevention_actions))) {
    return "Close with Root Cause";
  }
  return (
    Object.entries(STAGES).find(
      ([action, s]) => s.from === state && !action.startsWith("Cancel") && !s.catchUp
    )?.[0] || ""
  );
};

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
