import * as preventive from "../repository/preventive.js";
import { scopeFor, withinScope } from "../repository/plantScope.js";

/**
 * Preventive maintenance checklists.
 *
 * The maintenance manager's own section: what gets inspected on each machine
 * and how often. Read by everybody, written by maintenance — a checklist is the
 * standard the plant is inspected against, and a standard anybody can edit is
 * not one.
 */

const fail = (res, error, fallback = "Something went wrong") => {
  if (error?.status === 403) {
    return res.status(403).json({ message: "Your ERPNext role does not allow that." });
  }
  // The doctype is not in ERPNext yet. Named rather than left as a 500, because
  // the answer is a migration nobody has run and the generic message sends
  // people looking at the server instead.
  if (error?.status === 404 && /DocType|not found/i.test(error.message || "")) {
    return res.status(503).json({
      message:
        "Preventive maintenance is not set up in ERPNext yet. Run " +
        '"npm run erp:sync-preventive" on the server.',
    });
  }
  if (!error?.status) return res.status(400).json({ message: error.message });
  console.error(`${fallback}:`, error.message);
  return res.status(500).json({ message: fallback });
};

/** @route GET /api/preventive */
export const list = async (req, res) => {
  try {
    res.json(
      await preventive.listChecklists({
        plant: req.query.plant || "",
        // A plant head reads their own site's sheets. Taken from the signed-in
        // user, as it is on the register and the breakdown list — a checklist
        // is the standard one plant is inspected against, and the others are
        // no more their business here than a machine on another site.
        onlyPlants: (await scopeFor(req.user)).plants,
        machine: req.query.machine || "",
        electricalSystem: req.query.electricalSystem || "",
        frequency: req.query.frequency || "",
        includeInactive: req.query.includeInactive === "true",
        search: req.query.search || "",
      })
    );
  } catch (error) {
    fail(res, error, "Could not load the checklists");
  }
};

/**
 * @route GET /api/preventive/coverage?plant=
 *
 * Which machines have which frequencies, and which have nothing. The useful
 * part is the empty cells, which a list of the checklists that exist cannot
 * show.
 */
export const coverage = async (req, res) => {
  try {
    res.json(
      await preventive.coverage({
        plant: req.query.plant || "",
        onlyPlants: (await scopeFor(req.user)).plants,
      })
    );
  } catch (error) {
    fail(res, error, "Could not work out the coverage");
  }
};

/** @route GET /api/preventive/frequencies */
export const frequencies = async (_req, res) => {
  res.json(preventive.FREQUENCIES);
};

/** @route GET /api/preventive/:id */
export const detail = async (req, res) => {
  try {
    const checklist = await preventive.getChecklist(req.params.id);

    // A sheet for another plant's machine is not in this reader's list, so it
    // is missing rather than forbidden — the same answer an unknown id gets.
    if (!checklist || !withinScope(await scopeFor(req.user), checklist.plant)) {
      return res.status(404).json({ message: "No such checklist" });
    }
    res.json(checklist);
  } catch (error) {
    fail(res, error, "Could not load that checklist");
  }
};

/** @route POST /api/preventive */
export const create = async (req, res) => {
  try {
    res.status(201).json(await preventive.createChecklist(req.body || {}));
  } catch (error) {
    fail(res, error, "Could not add the checklist");
  }
};

/** @route PUT /api/preventive/:id */
export const update = async (req, res) => {
  try {
    res.json(await preventive.updateChecklist(req.params.id, req.body || {}));
  } catch (error) {
    fail(res, error, "Could not save the checklist");
  }
};

/**
 * @route POST /api/preventive/:id/points
 *
 * Appends one point. Its own route rather than a full save because it is the
 * thing that happens most — a breakdown closes, and the point that would have
 * caught it has to reach the sheet before anybody forgets.
 */
export const addPoint = async (req, res) => {
  try {
    res.status(201).json(await preventive.addChecklistPoint(req.params.id, req.body || {}));
  } catch (error) {
    fail(res, error, "Could not add the point");
  }
};

/** @route POST /api/preventive/:id/copy */
export const copy = async (req, res) => {
  try {
    res.status(201).json(await preventive.copyChecklist(req.params.id, req.body || {}));
  } catch (error) {
    fail(res, error, "Could not copy the checklist");
  }
};

/** @route DELETE /api/preventive/:id */
export const remove = async (req, res) => {
  try {
    res.json(await preventive.removeChecklist(req.params.id));
  } catch (error) {
    fail(res, error, "Could not remove the checklist");
  }
};
