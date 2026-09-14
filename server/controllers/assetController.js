import * as assets from "../repository/assets.js";
import { machineReliability } from "../repository/breakdownMetrics.js";
import {
  preventionActionsForMachine,
  setPreventionActionDone,
} from "../repository/maintenance.js";
import { checklistsForMachine } from "../repository/preventive.js";
import { erpToday } from "../integrations/erpnext/time.js";
import { scopeFor, withinScope } from "../repository/plantScope.js";

/**
 * The asset register.
 *
 * The Maintenance Manager's own section: what machines exist, everything known
 * about each, and the drawings and manuals that came with them.
 */

const fail = (res, error, fallback = "Something went wrong") => {
  if (error?.status === 403) {
    return res.status(403).json({ message: "Your ERPNext role does not allow that." });
  }
  if (!error?.status) return res.status(400).json({ message: error.message });
  console.error(`${fallback}:`, error.message);
  return res.status(500).json({ message: fallback });
};

/** True when the signed-in person may read a machine on this plant. */
const mayReadPlant = async (req, plant) => withinScope(await scopeFor(req.user), plant);

/**
 * The same question where the plant is not already to hand.
 *
 * Short-circuits before reading the machine, so an unscoped role — which is
 * most of them — pays nothing for a check that could only ever say yes.
 */
const mayReadMachine = async (req, id) => {
  const scope = await scopeFor(req.user);
  if (!scope.scoped) return true;

  const asset = await assets.getAsset(id);
  return Boolean(asset) && withinScope(scope, asset.plant);
};

/** The 404 a machine outside the reader's plant gets, on any of its sub-routes. */
const noSuchMachine = (res) => res.status(404).json({ message: "No such machine" });

/** @route GET /api/assets */
export const list = async (req, res) => {
  try {
    // A plant head reads their own site's machines. Taken from the signed-in
    // user, not the query, so it is not a filter they can clear.
    const { plants } = await scopeFor(req.user);

    res.json(
      await assets.listAssetsWithFiles({
        plant: req.query.plant || "",
        onlyPlants: plants,
        status: req.query.status || "",
        search: req.query.search || "",
      })
    );
  } catch (error) {
    fail(res, error, "Could not load the asset register");
  }
};

/** @route GET /api/assets/plants */
export const plants = async (req, res) => {
  try {
    // The picker offers only what the reader may choose. Left unfiltered it
    // would list four plants and return nothing for three of them, which reads
    // as a broken screen rather than as a restriction.
    const scope = await scopeFor(req.user);
    const all = await assets.listPlants();
    res.json(all.filter((plant) => withinScope(scope, plant.name)));
  } catch (error) {
    fail(res, error, "Could not load plants");
  }
};

/** @route GET /api/assets/:id */
export const detail = async (req, res) => {
  try {
    const asset = await assets.getAsset(req.params.id);
    // A machine on somebody else's plant is not in this reader's register at
    // all, so it is missing rather than forbidden — the same answer they get
    // for a code that was never a machine.
    if (!asset || !(await mayReadPlant(req, asset.plant))) {
      return res.status(404).json({ message: "No such machine" });
    }
    res.json(asset);
  } catch (error) {
    fail(res, error, "Could not load that machine");
  }
};

/** @route POST /api/assets */
export const create = async (req, res) => {
  try {
    res.status(201).json(await assets.createAsset(req.body || {}));
  } catch (error) {
    fail(res, error, "Could not add the machine");
  }
};

/** @route PUT /api/assets/:id */
export const update = async (req, res) => {
  try {
    res.json(await assets.updateAsset(req.params.id, req.body || {}));
  } catch (error) {
    fail(res, error, "Could not save");
  }
};

/**
 * @route POST /api/assets/:id/files
 *
 * The file arrives base64-encoded inside JSON rather than as multipart, which
 * keeps this server free of an upload library for the one place it uploads.
 * The size limit lives in the repository, where the reason for it is written
 * down.
 */
export const attach = async (req, res) => {
  try {
    if (!(await mayReadMachine(req, req.params.id))) return noSuchMachine(res);
    res.status(201).json(await assets.attachToAsset(req.params.id, req.body || {}));
  } catch (error) {
    fail(res, error, "Could not attach the file");
  }
};

/** @route DELETE /api/assets/:id/files/:fileId */
export const detach = async (req, res) => {
  try {
    if (!(await mayReadMachine(req, req.params.id))) return noSuchMachine(res);
    res.json(await assets.detachFromAsset(req.params.id, req.params.fileId));
  } catch (error) {
    fail(res, error, "Could not remove the file");
  }
};


/**
 * @route GET /api/assets/:id/history?from=&to=
 *
 * Every breakdown this machine has had, and what they add up to.
 *
 * A year by default: a machine's history is read to answer "what does this
 * thing keep doing", and a month is rarely long enough to show a pattern.
 */
export const history = async (req, res) => {
  const to = req.query.to || erpToday();
  const from = req.query.from || erpToday(new Date(Date.now() - 365 * 86_400_000));

  if (from > to) {
    return res.status(400).json({ message: "The start date is after the end date" });
  }

  try {
    if (!(await mayReadMachine(req, req.params.id))) return noSuchMachine(res);

    const found = await machineReliability({ machine: req.params.id, from, to });
    if (!found) return noSuchMachine(res);
    res.json(found);
  } catch (error) {
    fail(res, error, "Could not load the breakdown history");
  }
};

/**
 * @route GET /api/assets/:id/prevention
 *
 * The preventive side of one machine, kept apart from its breakdown history.
 *
 * Two different things, deliberately answered together because they are two
 * halves of one question. The checklists are what is inspected on a schedule so
 * a failure never happens; the prevention actions are what was changed after
 * one did. A machine with neither is a machine nobody is looking after, and
 * that is only visible when both are on the same screen.
 */
export const prevention = async (req, res) => {
  try {
    if (!(await mayReadMachine(req, req.params.id))) return noSuchMachine(res);

    const [actions, checklists] = await Promise.all([
      preventionActionsForMachine(req.params.id, {
        from: req.query.from || "",
        to: req.query.to || "",
      }),
      // A machine with no checklists is a finding, not an error — so a failure
      // to read them must not take the actions down with it.
      checklistsForMachine(req.params.id).catch(() => []),
    ]);

    res.json({
      machine: req.params.id,
      actions,
      checklists,
      summary: {
        actions: actions.length,
        outstanding: actions.filter((a) => !a.completed).length,
        // Past its date and still not done. The only line on this screen that
        // is anybody's to act on today.
        overdue: actions.filter(
          (a) => !a.completed && a.targetDate && a.targetDate < erpToday()
        ).length,
        checklists: checklists.length,
      },
    });
  } catch (error) {
    fail(res, error, "Could not load what has been done to prevent failures");
  }
};

/**
 * @route PUT /api/assets/:id/prevention/:breakdown/:action
 *
 * Ticks a prevention action off, or puts it back.
 *
 * An action nobody can mark done is an action nobody chases, and the list stops
 * being a list of work and becomes a list of intentions.
 */
export const completePrevention = async (req, res) => {
  try {
    res.json(
      await setPreventionActionDone(
        req.params.breakdown,
        req.params.action,
        req.body?.completed !== false
      )
    );
  } catch (error) {
    fail(res, error, "Could not update that action");
  }
};
