import * as requests from "../repository/purchaseRequests.js";

/** Purchase requests for engineering stock. See repository/purchaseRequests.js. */

const fail = (res, error, fallback = "Something went wrong") => {
  if ([400, 403, 404].includes(error?.status)) return res.status(error.status).json({ message: error.message });
  if (error?.status === 417) return res.status(400).json({ message: error.message });
  console.error(`${fallback}:`, error.message);
  return res.status(500).json({ message: fallback });
};

/** @route GET /api/purchase-requests */
export const list = async (req, res) => {
  try {
    res.json(await requests.listRequests({ status: req.query.status || "", limit: Math.min(Number(req.query.limit) || 100, 300) }));
  } catch (error) {
    fail(res, error, "Could not load purchase requests");
  }
};

/** @route GET /api/purchase-requests/:id */
export const detail = async (req, res) => {
  try {
    const found = await requests.getRequest(req.params.id);
    if (!found) return res.status(404).json({ message: "Purchase request not found" });
    res.json(found);
  } catch (error) {
    fail(res, error, "Could not load the purchase request");
  }
};

/** @route POST /api/purchase-requests */
export const raise = async (req, res) => {
  try {
    res.status(201).json(await requests.raiseRequest(req.body, req.user));
  } catch (error) {
    fail(res, error, "Could not save the purchase request");
  }
};

/** @route POST /api/purchase-requests/:id/retry */
export const retry = async (req, res) => {
  try {
    res.json(await requests.retryRequest(req.params.id, req.user));
  } catch (error) {
    fail(res, error, "Could not send the purchase request again");
  }
};
