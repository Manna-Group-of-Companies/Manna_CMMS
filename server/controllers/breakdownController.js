import * as maintenance from "../repository/maintenance.js";
import { describeStages } from "../integrations/erpnext/breakdownStages.js";
import { buildReport } from "../repository/breakdownMetrics.js";
import { scopeFor, withinScope } from "../repository/plantScope.js";

/**
 * Breakdowns, for the web dashboard.
 *
 * Module 2 is web only, so nothing here is shaped for the tablets.
 *
 * Reporting is open to every signed-in role on purpose. Restricting who may
 * report a breakdown is the surest way to have breakdowns go unreported, and an
 * unreported breakdown is worth nothing to anybody. The restriction that
 * matters is on assessing and planning, and ERPNext's workflow holds that.
 */

/** Turns an ERPNext refusal into something the screen can show. */
const fail = (res, error, fallback = "Something went wrong") => {
  if (error?.status === 403) {
    return res.status(403).json({
      message: "Your ERPNext role does not allow that step.",
      detail: error.message,
    });
  }
  if (error?.status === 417) {
    // A workflow refusing a transition, almost always. Its message names the
    // states involved, which is more use than anything this layer could add.
    return res.status(400).json({ message: error.message });
  }
  /**
   * A refusal this code raised itself, not one ERPNext sent back.
   *
   * Without this it fell through to the generic 500 and its own message was
   * swallowed - "Could not record the verification" where the real answer was
   * "attach the signed log sheet first". A validation message the user can act
   * on must reach them.
   */
  if (!error?.status) return res.status(400).json({ message: error.message });

  console.error(`${fallback}:`, error.message);
  return res.status(500).json({ message: fallback });
};

/**
 * @desc    Breakdowns, newest first
 * @route   GET /api/breakdowns
 * @access  Private
 */
export const list = async (req, res) => {
  try {
    // A plant head runs one site. Everyone else sees the lot: the Admin, the
    // maintenance team and the management roles work across the group. Which
    // roles are confined is stated once, in config/access.js.
    const { plants } = await scopeFor(req.user);

    res.json(
      await maintenance.listBreakdowns({
        onlyPlants: plants,
        plant: req.query.plant || "",
        state: req.query.state || "",
        open: req.query.open === "true",
        limit: Math.min(Number(req.query.limit) || 100, 300),
      })
    );
  } catch (error) {
    fail(res, error, "Could not load breakdowns");
  }
};

/**
 * @desc    One breakdown in full
 * @route   GET /api/breakdowns/:id
 * @access  Private
 */
export const detail = async (req, res) => {
  try {
    const breakdown = await maintenance.getBreakdown(req.params.id);

    // A breakdown on somebody else's plant is not in this reader's list, so it
    // is missing rather than forbidden — the same answer an unknown id gets.
    if (!breakdown || !withinScope(await scopeFor(req.user), breakdown.plant)) {
      return res.status(404).json({ message: "Breakdown not found" });
    }
    res.json(breakdown);
  } catch (error) {
    fail(res, error, "Could not load that breakdown");
  }
};

/**
 * @desc    Report a breakdown
 * @route   POST /api/breakdowns
 * @access  Private
 */
export const report = async (req, res) => {
  const { machine, stoppedAt, whatHappened, productionStopped, priority, likelyCause } = req.body || {};

  try {
    const created = await maintenance.reportBreakdown({
      machine,
      stoppedAt,
      whatHappened,
      productionStopped,
      priority,
      likelyCause,
      // From the session, never the body: who reported a breakdown is not
      // something the sender should be able to choose.
      reportedBy: req.user.email,
    });
    res.status(201).json(created);
  } catch (error) {
    if (!error.status) return res.status(400).json({ message: error.message });
    fail(res, error, "Could not report the breakdown");
  }
};

/**
 * @desc    Save the fields belonging to the current stage
 * @route   PUT /api/breakdowns/:id
 * @access  Private
 */
export const update = async (req, res) => {
  // An allow-list rather than passing the body through: `workflow_state` is a
  // field on this doctype, and letting it be written here would step around
  // every transition rule the workflow exists to enforce.
  const ALLOWED = [
    "priority", "likely_cause", "failure_mode", "spares_required",
    "assigned_to", "labour_hours",
    "actions_performed", "completed_at", "root_cause", "prevention_actions",
  ];

  const fields = {};
  for (const key of ALLOWED) {
    if (req.body?.[key] !== undefined) fields[key] = req.body[key];
  }
  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ message: "Nothing to save" });
  }

  try {
    res.json(await maintenance.updateBreakdown(req.params.id, fields));
  } catch (error) {
    fail(res, error, "Could not save");
  }
};

/**
 * @desc    Save this stage's details and move the breakdown on
 * @route   POST /api/breakdowns/:id/action
 * @access  Private
 *
 * One call, not two. A save that does not advance leaves a half-filled form
 * nobody is prompted to finish, and an advance that does not save is how a
 * breakdown reaches Closed carrying nothing but timestamps.
 */
export const act = async (req, res) => {
  const { action, fields } = req.body || {};
  if (!action) return res.status(400).json({ message: "An action is required" });

  try {
    res.json(await maintenance.saveAndAdvance(req.params.id, action, fields || {}, req.user));
  } catch (error) {
    // An incomplete stage is the user's to fix, and the screen needs to know
    // which fields to mark rather than only what to print.
    if (error.forbidden) return res.status(403).json({ message: error.message });
    if (error.incomplete) {
      return res.status(422).json({ message: error.message, missing: error.missing });
    }
    if (!error.status) return res.status(400).json({ message: error.message });
    fail(res, error, "Could not move the breakdown on");
  }
};

/**
 * @desc    What each stage collects and will not move without
 * @route   GET /api/breakdowns/stages
 * @access  Private
 *
 * Served rather than duplicated in the client, so the fields a form marks
 * required cannot drift from the ones the server actually enforces.
 */
export const stages = async (_req, res) => {
  res.json(describeStages());
};

/**
 * @desc    The reliability report for a window
 * @route   GET /api/breakdowns/report?from=&to=&plant=
 * @access  Private (Manager)
 *
 * Every figure is worked out on the way out rather than stored, so a report run
 * twice on the same window gives the same answer and a record somebody reopened
 * cannot leave a stale number behind it.
 */
export const reliabilityReport = async (req, res) => {
  // A month back, which is the window somebody means when they ask how last
  // month went and do not say so.
  const today = new Date();
  const monthAgo = new Date(today.getTime() - 30 * 86_400_000);
  const iso = (d) => d.toISOString().slice(0, 10);

  const from = req.query.from || iso(monthAgo);
  const to = req.query.to || iso(today);

  if (from > to) {
    return res.status(400).json({ message: "The start date is after the end date" });
  }

  try {
    res.json(await buildReport({ from, to, plant: req.query.plant || "" }));
  } catch (error) {
    fail(res, error, "Could not build the report");
  }
};

/**
 * @desc    Attach the signed log sheet
 * @route   POST /api/breakdowns/:id/files
 */
export const attach = async (req, res) => {
  try {
    res.status(201).json(await maintenance.attachToBreakdown(req.params.id, req.body || {}));
  } catch (error) {
    fail(res, error, "Could not attach the file");
  }
};

/** @route DELETE /api/breakdowns/:id/files/:fileId */
export const detach = async (req, res) => {
  try {
    res.json(await maintenance.detachFromBreakdown(req.params.id, req.params.fileId));
  } catch (error) {
    fail(res, error, "Could not remove the file");
  }
};

/**
 * @desc    The maintenance head confirms he has seen the signed sheet
 * @route   POST /api/breakdowns/:id/verify
 */
export const verify = async (req, res) => {
  try {
    res.json(
      await maintenance.verifyLogSheet(req.params.id, {
        verified: req.body?.verified !== false,
        user: req.user,
      })
    );
  } catch (error) {
    fail(res, error, "Could not record the verification");
  }
};

/**
 * @desc    Machines, for the report form
 * @route   GET /api/breakdowns/machines
 * @access  Private
 */
export const machines = async (req, res) => {
  try {
    // The report form offers only machines the reporter may see, or a plant
    // head would be able to raise a breakdown against another site's press.
    const scope = await scopeFor(req.user);
    const all = await maintenance.listMachines({ plant: req.query.plant || "" });
    res.json(all.filter((machine) => withinScope(scope, machine.plant)));
  } catch (error) {
    fail(res, error, "Could not load machines");
  }
};

/**
 * @desc    People and suppliers, for the plan form
 * @route   GET /api/breakdowns/lookups
 * @access  Private
 */
export const lookups = async (_req, res) => {
  try {
    res.json(await maintenance.listLookups());
  } catch (error) {
    fail(res, error, "Could not load people and suppliers");
  }
};

/**
 * @desc    Plants, for filters
 * @route   GET /api/breakdowns/plants
 * @access  Private
 */
export const plants = async (req, res) => {
  try {
    // Left unfiltered the picker lists four plants and returns nothing for
    // three of them, which reads as a broken screen rather than a restriction.
    const scope = await scopeFor(req.user);
    const all = await maintenance.listPlants();
    res.json(all.filter((plant) => withinScope(scope, plant.name)));
  } catch (error) {
    fail(res, error, "Could not load plants");
  }
};
