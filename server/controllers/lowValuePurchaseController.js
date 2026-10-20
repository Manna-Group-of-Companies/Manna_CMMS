import * as lowValue from "../repository/lowValuePurchases.js";
import { listPlants } from "../repository/maintenance.js";
import { scopeFor, withinScope } from "../repository/plantScope.js";

/** Low value purchase requests. See repository/lowValuePurchases.js. */

const fail = (res, error, fallback = "Something went wrong") => {
  if ([400, 403, 404].includes(error?.status)) return res.status(error.status).json({ message: error.message });
  if (error?.status === 417) return res.status(400).json({ message: error.message });
  console.error(`${fallback}:`, error.message);
  return res.status(500).json({ message: fallback });
};

/** @route GET /api/low-value-purchases */
export const list = async (req, res) => {
  try {
    const scope = await scopeFor(req.user);
    res.json(
      await lowValue.listLowValue({
        status: req.query.status || "",
        plant: req.query.plant || "",
        limit: Math.min(Number(req.query.limit) || 100, 300),
        user: req.user,
        scope,
      })
    );
  } catch (error) {
    fail(res, error, "Could not load low value purchase requests");
  }
};

/** @route GET /api/low-value-purchases/options - the plants this person may raise for, and the units */
export const options = async (req, res) => {
  try {
    const scope = await scopeFor(req.user);
    const plants = (await listPlants()).filter((p) => withinScope(scope, p.name));
    res.json({ ...lowValue.lowValueOptions(), plants });
  } catch (error) {
    fail(res, error, "Could not load the form options");
  }
};

/** @route GET /api/low-value-purchases/:id */
export const detail = async (req, res) => {
  try {
    res.json(await lowValue.getLowValue(req.params.id, req.user, await scopeFor(req.user)));
  } catch (error) {
    fail(res, error, "Could not load the low value purchase request");
  }
};

/** @route POST /api/low-value-purchases */
export const raise = async (req, res) => {
  try {
    res.status(201).json(await lowValue.raiseLowValue(req.body, req.user, await scopeFor(req.user)));
  } catch (error) {
    fail(res, error, "Could not save the low value purchase request");
  }
};

/** @route POST /api/low-value-purchases/:id/:step - order, receive, reject or withdraw */
export const step = async (req, res) => {
  try {
    res.json(
      await lowValue.stepLowValue(req.params.id, req.params.step, req.body, req.user, await scopeFor(req.user))
    );
  } catch (error) {
    fail(res, error, "Could not save that step");
  }
};
