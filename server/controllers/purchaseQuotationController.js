import * as quotations from "../repository/purchaseQuotations.js";
import * as orders from "../repository/purchaseOrders.js";
import { withNames } from "../repository/userNames.js";

/** Quotations for purchase requests, and the PO made from each. See repository/purchaseQuotations.js. */

const fail = (res, error, fallback = "Something went wrong") => {
  if ([400, 403, 404].includes(error?.status)) return res.status(error.status).json({ message: error.message });
  if (error?.status === 417) return res.status(400).json({ message: error.message });
  console.error(`${fallback}:`, error.message);
  return res.status(500).json({ message: fallback });
};

/** @route GET /api/purchase-quotations */
export const list = async (req, res) => {
  try {
    res.json(
      await withNames(
        await quotations.listQuotations({
          status: req.query.status || "",
          request: req.query.request || "",
          limit: Math.min(Number(req.query.limit) || 100, 300),
        }),
        ["raisedBy"]
      )
    );
  } catch (error) {
    fail(res, error, "Could not load quotations");
  }
};

/** @route GET /api/purchase-quotations/requests - requests a quotation can be entered against */
export const requests = async (req, res) => {
  try {
    res.json(await quotations.quotableRequests());
  } catch (error) {
    fail(res, error, "Could not load the purchase requests");
  }
};

/** @route GET /api/purchase-quotations/options?company=HRI - suppliers, tax codes and units */
export const options = async (req, res) => {
  try {
    res.json(await quotations.optionsFor(req.query.company));
  } catch (error) {
    fail(res, error, "Could not load the SAP lists");
  }
};

/** @route GET /api/purchase-quotations/:id */
export const detail = async (req, res) => {
  try {
    const found = await quotations.getQuotation(req.params.id);
    if (!found) return res.status(404).json({ message: "Quotation not found" });
    res.json(found);
  } catch (error) {
    fail(res, error, "Could not load the quotation");
  }
};

/** @route POST /api/purchase-quotations */
export const create = async (req, res) => {
  try {
    res.status(201).json(await quotations.createQuotation(req.body, req.user));
  } catch (error) {
    fail(res, error, "Could not save the quotation");
  }
};

/** @route PUT /api/purchase-quotations/:id */
export const update = async (req, res) => {
  try {
    res.json(await quotations.updateQuotation(req.params.id, req.body, req.user));
  } catch (error) {
    fail(res, error, "Could not save the quotation");
  }
};

/** @route DELETE /api/purchase-quotations/:id */
export const remove = async (req, res) => {
  try {
    res.json(await quotations.deleteQuotation(req.params.id));
  } catch (error) {
    fail(res, error, "Could not delete the quotation");
  }
};

/** @route POST /api/purchase-quotations/:id/retry */
export const retry = async (req, res) => {
  try {
    res.json(await quotations.retryQuotation(req.params.id, req.user));
  } catch (error) {
    fail(res, error, "Could not send the quotation again");
  }
};

/** @route POST /api/purchase-quotations/:id/order - the PO, made from the quotation */
export const order = async (req, res) => {
  try {
    res.status(201).json(await orders.makeOrder(req.params.id, req.body, req.user));
  } catch (error) {
    fail(res, error, "Could not save the purchase order");
  }
};
