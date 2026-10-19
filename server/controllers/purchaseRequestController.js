import * as requests from "../repository/purchaseRequests.js";
import { scopeFor, withinCompany } from "../repository/plantScope.js";

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
    // A plant head's own company only; everyone else sees the lot.
    const { companies } = await scopeFor(req.user);
    res.json(
      await requests.listRequests({
        status: req.query.status || "",
        limit: Math.min(Number(req.query.limit) || 100, 300),
        onlyCompanies: companies,
      })
    );
  } catch (error) {
    fail(res, error, "Could not load purchase requests");
  }
};

/** @route GET /api/purchase-requests/:id */
export const detail = async (req, res) => {
  try {
    const found = await requests.getRequest(req.params.id);
    // Another company's request is not in this reader's list, so it is
    // missing rather than forbidden - the same answer an unknown id gets.
    if (!found || !withinCompany(await scopeFor(req.user), found.company)) {
      return res.status(404).json({ message: "Purchase request not found" });
    }
    res.json(found);
  } catch (error) {
    fail(res, error, "Could not load the purchase request");
  }
};

/** @route POST /api/purchase-requests */
export const raise = async (req, res) => {
  try {
    if (!withinCompany(await scopeFor(req.user), req.body?.company)) {
      return res.status(403).json({ message: "That SAP company is not yours to buy for." });
    }
    res.status(201).json(await requests.raiseRequest(req.body, req.user));
  } catch (error) {
    fail(res, error, "Could not save the purchase request");
  }
};

/** @route GET /api/purchase-requests/vendors?company=HRI - the SAP suppliers, for the PO form */
export const vendors = async (req, res) => {
  try {
    res.json(await requests.vendorsFor(req.query.company));
  } catch (error) {
    fail(res, error, "Could not load the vendors");
  }
};

/** @route POST /api/purchase-requests/:id/order - the purchase manager makes the PO */
export const order = async (req, res) => {
  try {
    res.json(await requests.orderRequest(req.params.id, req.body, req.user));
  } catch (error) {
    fail(res, error, "Could not save the purchase order");
  }
};

/** @route POST /api/purchase-requests/:id/order/retry */
export const retryOrder = async (req, res) => {
  try {
    res.json(await requests.retryOrder(req.params.id, req.user));
  } catch (error) {
    fail(res, error, "Could not send the purchase order again");
  }
};

/** @route POST /api/purchase-requests/:id/retry */
export const retry = async (req, res) => {
  try {
    const found = await requests.getRequest(req.params.id);
    if (!found || !withinCompany(await scopeFor(req.user), found.company)) {
      return res.status(404).json({ message: "Purchase request not found" });
    }
    res.json(await requests.retryRequest(req.params.id, req.user));
  } catch (error) {
    fail(res, error, "Could not send the purchase request again");
  }
};
