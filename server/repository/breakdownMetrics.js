import { getDoc, listAll } from "../integrations/erpnext/client.js";
import { erpNow } from "../integrations/erpnext/time.js";

/**
 * The reliability figures, worked out from the breakdown records.
 *
 * Nothing here is stored. Every number is derived from the timestamps each
 * stage already stamps, so a figure cannot go stale on a record somebody
 * reopened, and there is no second copy to disagree with the first.
 *
 * The definitions are written down because they are the whole argument. A
 * maintenance report is only worth reading if everybody agrees what "MTBF"
 * meant when it was printed, and there are three or four defensible answers to
 * that. These are the ones this system uses.
 */

/** Hours between two ERPNext datetimes, or null when either is missing. */
const hoursBetween = (from, to) => {
  if (!from || !to) return null;
  const a = new Date(String(from).replace(" ", "T"));
  const b = new Date(String(to).replace(" ", "T"));
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const h = (b - a) / 3_600_000;
  // A negative interval means somebody typed a time earlier than the one
  // before it. Counting it would drag an average below zero, which is worse
  // than not counting it at all.
  return h < 0 ? null : Math.round(h * 100) / 100;
};

const round = (n, places = 1) => {
  const f = 10 ** places;
  return Math.round((Number(n) || 0) * f) / f;
};

const mean = (values) => {
  const real = values.filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  if (!real.length) return null;
  return round(real.reduce((s, v) => s + v, 0) / real.length, 2);
};

/**
 * The intervals a breakdown is made of.
 *
 * Splitting them is the point. "Down for nine hours" says nothing about what to
 * fix; "eight of those nine passed before anybody started" says one thing, and
 * "eight of those nine were spent with a fitter on it" says something else
 * entirely.
 *
 * `waiting` used to sit between an assessment and the start of work. Those
 * stages are gone — assessment and planning happen on the phone now — so the
 * split is the two intervals that remain, both measured from timestamps
 * nobody types.
 */
const intervalsOf = (b, at = new Date()) => ({
  // Stopped until work actually started. How quickly maintenance got to it,
  // which is the whole of the delay now that nothing sits between the two.
  response: hoursBetween(b.stopped_at, b.repair_started_at),
  // Work started until the machine ran again. Time with a spanner in hand.
  repair: hoursBetween(b.repair_started_at, b.completed_at),
  // The whole stoppage, once it is over. Null while the machine is still down,
  // so an unfinished repair cannot be averaged in as though it had taken no
  // time at all.
  downtime: hoursBetween(b.stopped_at, b.completed_at),

  /**
   * The stoppage as it stands, counting up to now for one still open.
   *
   * This is what totals, cost and availability use. A machine that has been
   * down since Tuesday is not available, and treating an unfinished breakdown
   * as zero downtime reported the worst machines on the site as 100% available.
   */
  elapsed: hoursBetween(b.stopped_at, b.completed_at || erpNow(at)),
});

/**
 * Mean Time To Repair.
 *
 * Measured here as the *whole stoppage* - stopped until running again - rather
 * than the wrench time alone. That is the stricter reading and the honest one:
 * production does not care that the fitter was quick if the bearing took two
 * days to arrive. The wrench-time-only figure is reported separately as
 * `meanRepairHours`, so both are visible and neither has to be argued about.
 */
const mttr = (breakdowns) => mean(breakdowns.map((b) => intervalsOf(b).downtime));

/**
 * Mean Time Between Failures, per machine, in operating hours.
 *
 * Counted against the hours the machine was *meant to be running* over the
 * window, not calendar hours - a press worked one shift a day has not been
 * failing every 24 hours simply because the clock ran overnight. The machine
 * record carries `running_hours_per_day`, so that is what the window is
 * measured in; where it is not set, the calendar is used and the figure is
 * marked as such so nobody compares the two.
 *
 * Uptime is scheduled hours less recorded downtime. Dividing by the number of
 * failures gives the average run between them.
 *
 * With one failure in the window this is really "how long it ran before it
 * broke", which is not the same thing as a mean. It is still the best estimate
 * available and is reported with its sample size so the reader can judge.
 */
const mtbf = ({ breakdowns, machine, windowDays }) => {
  const failures = breakdowns.length;
  if (!failures || !windowDays) return { hours: null, basis: "none", failures };

  const perDay = Number(machine?.running_hours_per_day || 0);
  const basis = perDay > 0 ? "operating" : "calendar";
  const scheduled = (perDay > 0 ? perDay : 24) * windowDays;

  const downtime = breakdowns.reduce((sum, b) => sum + (intervalsOf(b).elapsed || 0), 0);
  const uptime = Math.max(0, scheduled - downtime);

  return { hours: round(uptime / failures, 1), basis, failures, uptimeHours: round(uptime, 1) };
};

/**
 * Availability: the share of scheduled time the machine was fit to run.
 *
 * uptime / scheduled, over the same window MTBF uses. Reported as a percentage
 * because that is how everybody says it out loud.
 */
const availability = ({ breakdowns, machine, windowDays }) => {
  if (!windowDays) return null;
  const perDay = Number(machine?.running_hours_per_day || 0);
  const scheduled = (perDay > 0 ? perDay : 24) * windowDays;
  if (scheduled <= 0) return null;

  const downtime = breakdowns.reduce((sum, b) => sum + (intervalsOf(b).elapsed || 0), 0);
  return round(Math.max(0, (scheduled - downtime) / scheduled) * 100, 1);
};

/** Groups a list by a key, skipping blanks. */
const groupBy = (rows, key) => {
  const out = new Map();
  for (const row of rows) {
    const k = row[key];
    if (!k) continue;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(row);
  }
  return out;
};

/**
 * Output a stoppage cost, in the machine's own unit.
 *
 * This was a rupee figure. It is now product not made, because that is what a
 * plant actually loses and it can be checked against a shift's own numbers.
 */
const outputLostOf = (b) => {
  // The stored figure is preferred: it was worked out when the repair closed,
  // against the rate in force then, and rewriting history because a rate
  // changed later would make old reports irreproducible.
  if (Number(b.output_lost) > 0) return Number(b.output_lost);
  // Elapsed, not finished: a machine still down is still not making anything,
  // and a report that showed nothing for it would understate the very thing it
  // exists to surface.
  const elapsed = intervalsOf(b).elapsed;
  const perHour = Number(b.output_per_hour || 0);
  return elapsed && perHour ? Math.round(elapsed * perHour * 10) / 10 : 0;
};

/**
 * Output lost, totalled per unit.
 *
 * Not one number. The group's machines are counted in different units - kg on
 * a mixing mill, pieces on a press - and adding those together would produce a
 * total that means nothing and reads like it means something. Returns e.g.
 * `[{ uom: "Kg", quantity: 1240 }, { uom: "Nos", quantity: 380 }]`, worst
 * first, so a screen can print them side by side.
 */
const outputLostByUom = (rows) => {
  const totals = new Map();
  for (const b of rows) {
    const quantity = outputLostOf(b);
    if (!quantity) continue;
    // A machine with a rate but no unit set still gets counted, under a label
    // that says so rather than being silently dropped from the total.
    const uom = b.output_uom || "unit not set";
    totals.set(uom, (totals.get(uom) || 0) + quantity);
  }
  return [...totals.entries()]
    .map(([uom, quantity]) => ({ uom, quantity: round(quantity, 1) }))
    .sort((a, b) => b.quantity - a.quantity);
};

/**
 * The whole report for a window.
 *
 * @param from       ISO date, inclusive
 * @param to         ISO date, inclusive
 * @param plant      optional, narrows to one site
 */
export const buildReport = async ({ from, to, plant = "" } = {}) => {
  const filters = [
    ["CMMS Breakdown", "stopped_at", ">=", `${from} 00:00:00`],
    ["CMMS Breakdown", "stopped_at", "<=", `${to} 23:59:59`],
    // A cancelled report was not a breakdown. Counting one would inflate the
    // failure count and depress every mean that divides by it.
    ["CMMS Breakdown", "workflow_state", "!=", "Cancelled"],
  ];
  if (plant) filters.push(["CMMS Breakdown", "plant", "=", plant]);

  const [breakdowns, machines] = await Promise.all([
    listAll("CMMS Breakdown", {
      fields: [
        "name", "machine", "machine_name", "plant", "workflow_state", "priority",
        "failure_mode", "stopped_at", "repair_started_at",
        "completed_at", "closed_at", "actual_downtime_hours", "output_lost",
        "output_per_hour", "output_uom", "labour_hours", "production_stopped", "root_cause",
        "repeat_failure", "repeat_of",
      ],
      filters,
      orderBy: "stopped_at desc",
    }),
    listAll("CMMS Machine", {
      fields: [
        "name", "machine_name", "plant", "criticality", "running_hours_per_day",
        "output_per_hour", "output_uom",
      ],
      filters: plant ? [["CMMS Machine", "plant", "=", plant]] : undefined,
    }),
  ]);

  const windowDays = Math.max(
    1,
    Math.round((new Date(`${to}T23:59:59`) - new Date(`${from}T00:00:00`)) / 86_400_000)
  );

  const byMachine = groupBy(breakdowns, "machine");
  const machineById = new Map(machines.map((m) => [m.name, m]));

  // --- per machine -------------------------------------------------------
  const perMachine = [...byMachine.entries()]
    .map(([id, rows]) => {
      const machine = machineById.get(id);
      const intervals = rows.map((r) => intervalsOf(r));
      const downtime = intervals.reduce((s, i) => s + (i.elapsed || 0), 0);
      const stillDown = rows.filter((r) => !r.completed_at).length;

      return {
        machine: id,
        machineName: rows[0].machine_name || id,
        plant: rows[0].plant,
        criticality: machine?.criticality || "",
        failures: rows.length,
        stillDown,
        /**
         * How many of this machine's failures were flagged as ones it has had
         * before.
         *
         * The number that changes what a row means. Six failures across six
         * different causes is a busy machine; six failures where four are
         * repeats is one unsolved problem being repaired over and over, and
         * only the second is worth a manager's morning.
         */
        repeats: rows.filter((r) => r.repeat_failure).length,
        downtimeHours: round(downtime, 1),
        // One machine, so one unit - no need for the per-unit breakdown here.
        outputLost: round(rows.reduce((s, b) => s + outputLostOf(b), 0), 1),
        outputUom: machine?.output_uom || rows.find((r) => r.output_uom)?.output_uom || "",
        labourHours: round(rows.reduce((s, b) => s + Number(b.labour_hours || 0), 0), 1),
        mtbf: mtbf({ breakdowns: rows, machine, windowDays }),
        mttrHours: mttr(rows),
        meanResponseHours: mean(intervals.map((i) => i.response)),
        meanRepairHours: mean(intervals.map((i) => i.repair)),
        availability: availability({ breakdowns: rows, machine, windowDays }),
      };
    })
    .sort((a, b) => b.downtimeHours - a.downtimeHours);

  // --- by failure mode ---------------------------------------------------
  const byMode = [...groupBy(breakdowns, "failure_mode").entries()]
    .map(([mode, rows]) => ({
      mode,
      failures: rows.length,
      downtimeHours: round(rows.reduce((s, b) => s + (intervalsOf(b).elapsed || 0), 0), 1),
      // A failure mode spans machines, so this can straddle units.
      outputLost: outputLostByUom(rows),
    }))
    .sort((a, b) => b.downtimeHours - a.downtimeHours);

  const unclassified = breakdowns.filter((b) => !b.failure_mode).length;

  // --- headline ----------------------------------------------------------
  const allIntervals = breakdowns.map((b) => intervalsOf(b));
  const totalDowntime = allIntervals.reduce((s, i) => s + (i.elapsed || 0), 0);
  const stillAccruing = breakdowns
    .filter((b) => !b.completed_at)
    .reduce((s, b) => s + (intervalsOf(b).elapsed || 0), 0);
  const closed = breakdowns.filter((b) => b.completed_at);
  const open = breakdowns.filter((b) => !b.completed_at);

  return {
    window: { from, to, days: windowDays, plant: plant || "All plants" },

    headline: {
      failures: breakdowns.length,
      stillOpen: open.length,
      machinesAffected: byMachine.size,
      machinesOnRegister: machines.length,
      downtimeHours: round(totalDowntime, 1),
      // Named separately so a big downtime figure can be read correctly: some
      // of it is history, and some is a machine that is down right now.
      downtimeStillAccruing: round(stillAccruing, 1),
      outputLost: outputLostByUom(breakdowns),
      labourHours: round(breakdowns.reduce((s, b) => s + Number(b.labour_hours || 0), 0), 1),
      // Across the fleet, weighted by nothing: the mean of the per-breakdown
      // stoppages, which is what somebody means by "how long does a breakdown
      // take us".
      mttrHours: mttr(closed),
      meanResponseHours: mean(allIntervals.map((i) => i.response)),
      meanRepairHours: mean(allIntervals.map((i) => i.repair)),
      productionStopped: breakdowns.filter((b) => b.production_stopped).length,
      // Flagged at closing by the person doing the analysis, so this counts
      // only failures somebody has actually judged to be a recurrence — never
      // a guess made by matching text.
      repeatFailures: breakdowns.filter((b) => b.repeat_failure).length,
    },

    perMachine,
    byMode,
    unclassified,

    /**
     * The failures somebody has said out loud have happened before.
     *
     * Its own section rather than a column, because it is read differently from
     * everything else in the report. The rest of these figures describe how bad
     * a month was; this one names the problems that were not actually solved
     * the last time they were repaired, which is the only part of a maintenance
     * report that is about the future.
     *
     * Grouped by machine and then newest first, so a chain reads in one go —
     * three rows against the same press, oldest last.
     */
    repeats: breakdowns
      .filter((b) => b.repeat_failure)
      .map((b) => ({
        id: b.name,
        machine: b.machine,
        machineName: b.machine_name || b.machine,
        plant: b.plant,
        failureMode: b.failure_mode || "",
        stoppedAt: b.stopped_at,
        downtimeHours: intervalsOf(b).elapsed,
        rootCause: b.root_cause || "",
        repeatOf: b.repeat_of || "",
      }))
      .sort((a, b) =>
        a.machineName === b.machineName
          ? String(b.stoppedAt).localeCompare(String(a.stoppedAt))
          : a.machineName.localeCompare(b.machineName)
      ),

    // The machines with more than one flagged repeat in the window. A single
    // repeat is a machine that failed twice; several is a machine nobody has
    // got to the bottom of.
    repeatOffenders: perMachine
      .filter((m) => m.repeats > 1)
      .sort((a, b) => b.repeats - a.repeats),

    // The worst offenders, which is what the first page of any maintenance
    // report is actually for.
    worstByDowntime: perMachine.slice(0, 5),
    worstByFrequency: [...perMachine].sort((a, b) => b.failures - a.failures).slice(0, 5),
    // There was a `worstByCost` here, ranking machines by the rupee value of
    // their stoppages. It is gone with the rupee figure and has not been
    // replaced by an output-lost ranking: output is counted per machine in that
    // machine's own unit, so ordering a mixing mill's kilos against a press's
    // pieces would produce a league table with no meaning. Downtime is the
    // comparable measure across machines, and worstByDowntime already gives it.
    // Nothing rendered worstByCost, so nothing loses a column.

    breakdowns: breakdowns.map((b) => {
      const i = intervalsOf(b);
      return {
        id: b.name,
        machine: b.machine,
        machineName: b.machine_name || b.machine,
        plant: b.plant,
        state: b.workflow_state,
        priority: b.priority || "",
        failureMode: b.failure_mode || "",
        stoppedAt: b.stopped_at,
        completedAt: b.completed_at || null,
        responseHours: i.response,
        repairHours: i.repair,
        downtimeHours: i.elapsed,
        finished: Boolean(b.completed_at),
        labourHours: Number(b.labour_hours || 0),
        outputLost: outputLostOf(b),
        outputUom: b.output_uom || "",
        rootCause: b.root_cause || "",
        repeatFailure: Boolean(b.repeat_failure),
        repeatOf: b.repeat_of || "",
      };
    }),
  };
};

/**
 * One machine's history, for its page in the asset register.
 *
 * Built from the same intervals, the same MTBF and the same output-lost rule the
 * whole-plant report uses. That is the point of it living here rather than in
 * the asset repository: a machine page that computed availability its own way
 * would eventually disagree with the report, and nobody would know which was
 * right.
 *
 * The window defaults to a year because a machine's history is read to answer
 * "what does this thing keep doing", and a month is rarely long enough to show
 * a pattern.
 */
export const machineReliability = async ({ machine, from, to } = {}) => {
  if (!machine) throw new Error("A machine is required");

  const breakdowns = await listAll("CMMS Breakdown", {
    fields: [
      "name", "machine", "machine_name", "plant", "workflow_state", "priority",
      "failure_mode", "stopped_at", "repair_started_at", "completed_at",
      "closed_at", "actual_downtime_hours", "output_lost", "output_per_hour", "output_uom",
      "labour_hours", "production_stopped", "root_cause", "likely_cause",
      "actions_performed", "assigned_to", "reported_by",
      "repeat_failure", "repeat_of",
    ],
    filters: [
      ["CMMS Breakdown", "machine", "=", machine],
      ["CMMS Breakdown", "stopped_at", ">=", `${from} 00:00:00`],
      ["CMMS Breakdown", "stopped_at", "<=", `${to} 23:59:59`],
      // A cancelled report was not a failure. Counting one would inflate the
      // count and depress every mean that divides by it.
      ["CMMS Breakdown", "workflow_state", "!=", "Cancelled"],
    ],
    orderBy: "stopped_at desc",
  });

  const machineDoc = await getDoc("CMMS Machine", machine).catch(() => null);

  // A machine that is not on the register has no history - and answering with
  // an empty one claiming 100% availability would invent a record for
  // something that does not exist. Breakdowns are still checked first, so a
  // machine deleted from under its own history is reported rather than hidden.
  if (!machineDoc && breakdowns.length === 0) return null;

  const windowDays = Math.max(
    1,
    Math.round((new Date(`${to}T23:59:59`) - new Date(`${from}T00:00:00`)) / 86_400_000)
  );

  const intervals = breakdowns.map((b) => intervalsOf(b));
  const modes = [...groupBy(breakdowns, "failure_mode").entries()]
    .map(([mode, rows]) => ({
      mode,
      failures: rows.length,
      downtimeHours: round(rows.reduce((s, b) => s + (intervalsOf(b).elapsed || 0), 0), 1),
    }))
    .sort((a, b) => b.failures - a.failures);

  return {
    machine,
    machineName: machineDoc?.machine_name || machine,
    window: { from, to, days: windowDays },

    summary: {
      failures: breakdowns.length,
      stillOpen: breakdowns.filter((b) => !b.completed_at).length,
      downtimeHours: round(intervals.reduce((s, i) => s + (i.elapsed || 0), 0), 1),
      outputLost: outputLostByUom(breakdowns),
      labourHours: round(breakdowns.reduce((s, b) => s + Number(b.labour_hours || 0), 0), 1),
      mtbf: mtbf({ breakdowns, machine: machineDoc, windowDays }),
      mttrHours: mttr(breakdowns),
      availability: availability({ breakdowns, machine: machineDoc, windowDays }),
      meanResponseHours: mean(intervals.map((i) => i.response)),
      meanRepairHours: mean(intervals.map((i) => i.repair)),
      productionStopped: breakdowns.filter((b) => b.production_stopped).length,
      repeats: breakdowns.filter((b) => b.repeat_failure).length,
    },

    byMode: modes,
    unclassified: breakdowns.filter((b) => !b.failure_mode).length,

    breakdowns: breakdowns.map((b) => {
      const i = intervalsOf(b);
      return {
        id: b.name,
        state: b.workflow_state,
        priority: b.priority || "",
        failureMode: b.failure_mode || "",
        stoppedAt: b.stopped_at,
        completedAt: b.completed_at || null,
        finished: Boolean(b.completed_at),
        productionStopped: Boolean(b.production_stopped),
        responseHours: i.response,
        repairHours: i.repair,
        downtimeHours: i.elapsed,
        labourHours: Number(b.labour_hours || 0),
        outputLost: outputLostOf(b),
        outputUom: b.output_uom || "",
        // Carried on the row so the history reads as a story without having to
        // open every record: what they thought it was, what it turned out to
        // be, and what was done about it.
        likelyCause: b.likely_cause || "",
        rootCause: b.root_cause || "",
        repeatFailure: Boolean(b.repeat_failure),
        repeatOf: b.repeat_of || "",
        actionsPerformed: b.actions_performed || "",
        assignedTo: b.assigned_to || "",
        reportedBy: b.reported_by || "",
      };
    }),
  };
};

/** Exported for the tests, and so the definitions can be checked in isolation. */
export const __internals = { hoursBetween, intervalsOf, mtbf, availability, mttr, mean };
