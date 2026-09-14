import * as electrical from "../repository/electrical.js";
import { plantsFor } from "../repository/plantScope.js";

/**
 * The electrical portfolio.
 *
 * Reads are open to everyone signed in — a supervisor tracing which panel feeds
 * a press should not need permission. Writing is maintenance's.
 */

const fail = (res, error, fallback = "Something went wrong") => {
  // Deliberately the same answer as a missing record: a distinct "not yours"
  // would confirm what exists on the other site.
  if (error?.notFound) return res.status(404).json({ message: error.message });
  if (error?.status === 403) {
    return res.status(403).json({ message: "Your ERPNext role does not allow that." });
  }
  if (!error?.status) return res.status(400).json({ message: error.message });
  console.error(`${fallback}:`, error.message);
  return res.status(500).json({ message: fallback });
};

/**
 * Refuses a write to a plant the caller is not scoped to.
 *
 * The reads were scoped already; without this a production manager confined to
 * one site could still attach a file to another plant's system by its id. The
 * list would hide it and the URL would not.
 */
const assertInScope = async (req) => {
  const onlyPlants = await plantsFor(req.user.email);
  if (!onlyPlants.length) return;

  const system = await electrical.getSystem(req.params.id, { onlyPlants });
  if (!system) {
    const error = new Error("No such electrical system");
    error.notFound = true;
    throw error;
  }
};

/** @route GET /api/electrical */
export const list = async (req, res) => {
  try {
    // Anyone with plant permissions in ERPNext sees only those plants —
    // whatever their role. Somebody with none sees the group, which is how an
    // account that genuinely runs all four works.
    const onlyPlants = await plantsFor(req.user.email);
    res.json(await electrical.listSystems({ plant: req.query.plant || "", onlyPlants }));
  } catch (error) {
    fail(res, error, "Could not load the electrical systems");
  }
};

/** @route GET /api/electrical/:id */
export const detail = async (req, res) => {
  try {
    const onlyPlants = await plantsFor(req.user.email);
    const system = await electrical.getSystem(req.params.id, { onlyPlants });
    // Deliberately the same answer whether it does not exist or is another
    // plant's: a distinct "not yours" would confirm what is on the other site.
    if (!system) return res.status(404).json({ message: "No such electrical system" });
    res.json(system);
  } catch (error) {
    fail(res, error, "Could not load that system");
  }
};

/** @route PUT /api/electrical/:id */
export const update = async (req, res) => {
  try {
    await assertInScope(req);
    res.json(await electrical.updateSystem(req.params.id, req.body || {}));
  } catch (error) {
    fail(res, error, "Could not save");
  }
};

/**
 * @route POST /api/electrical/:id/files
 *
 * The installation document, single-line diagrams, test reports. This is where
 * the detail lives now that subsystems are gone.
 */
export const attach = async (req, res) => {
  try {
    await assertInScope(req);
    res.status(201).json(await electrical.attachToSystem(req.params.id, req.body || {}));
  } catch (error) {
    fail(res, error, "Could not attach the file");
  }
};

/** @route DELETE /api/electrical/:id/files/:fileId */
export const detach = async (req, res) => {
  try {
    await assertInScope(req);
    res.json(await electrical.detachFromSystem(req.params.id, req.params.fileId));
  } catch (error) {
    fail(res, error, "Could not remove the file");
  }
};
