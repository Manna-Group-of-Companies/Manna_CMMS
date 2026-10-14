import * as technicians from "../repository/technicians.js";

/** The maintenance team register. See repository/technicians.js. */

const fail = (res, error, fallback = "Something went wrong") => {
  if ([400, 403, 404].includes(error?.status)) {
    return res.status(error.status).json({ message: error.message });
  }
  if (error?.status === 417) return res.status(400).json({ message: error.message });
  console.error(`${fallback}:`, error.message);
  return res.status(500).json({ message: fallback });
};

/**
 * @route GET /api/technicians
 *
 * `?active=1` is what the breakdown forms ask for - only people who can be
 * named on a repair today. The register screen asks for everyone.
 */
export const list = async (req, res) => {
  try {
    res.json(await technicians.listTechnicians({ activeOnly: req.query.active === "1" }));
  } catch (error) {
    fail(res, error, "Could not load the maintenance team");
  }
};

/** @route POST /api/technicians */
export const add = async (req, res) => {
  try {
    res.status(201).json(await technicians.addTechnician(req.body));
  } catch (error) {
    fail(res, error, "Could not add them to the maintenance team");
  }
};

/** @route PUT /api/technicians/:id */
export const update = async (req, res) => {
  try {
    res.json(await technicians.updateTechnician(req.params.id, req.body));
  } catch (error) {
    fail(res, error, "Could not save the change");
  }
};

/**
 * @route POST /api/technicians/:id/resign
 * @route POST /api/technicians/:id/reinstate
 *
 * Two routes rather than a flag in the body: they are different decisions, and
 * a mistyped body should not be able to turn one into the other.
 */
export const resign = async (req, res) => {
  try {
    res.json(
      await technicians.setTechnicianActive(req.params.id, false, {
        resignedOn: req.body?.resignedOn || "",
      })
    );
  } catch (error) {
    fail(res, error, "Could not record that they have left");
  }
};

export const reinstate = async (req, res) => {
  try {
    res.json(await technicians.setTechnicianActive(req.params.id, true));
  } catch (error) {
    fail(res, error, "Could not bring them back");
  }
};
