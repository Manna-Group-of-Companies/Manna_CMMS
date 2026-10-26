import * as orders from "../repository/purchaseOrders.js";
import { withNames } from "../repository/userNames.js";

/** Purchase orders made from quotations. See repository/purchaseOrders.js. */

const fail = (res, error, fallback = "Something went wrong") => {
  if ([400, 403, 404].includes(error?.status)) return res.status(error.status).json({ message: error.message });
  if (error?.status === 417) return res.status(400).json({ message: error.message });
  console.error(`${fallback}:`, error.message);
  return res.status(500).json({ message: fallback });
};

/** @route GET /api/purchase-orders */
export const list = async (req, res) => {
  try {
    res.json(
      await withNames(
        await orders.listOrders({
          status: req.query.status || "",
          syncStatus: req.query.syncStatus || "",
          limit: Math.min(Number(req.query.limit) || 100, 300),
        }),
        ["raisedBy"]
      )
    );
  } catch (error) {
    fail(res, error, "Could not load purchase orders");
  }
};

/** @route GET /api/purchase-orders/:id */
export const detail = async (req, res) => {
  try {
    const found = await orders.getOrder(req.params.id);
    if (!found) return res.status(404).json({ message: "Purchase order not found" });
    res.json(found);
  } catch (error) {
    fail(res, error, "Could not load the purchase order");
  }
};

/** @route POST /api/purchase-orders/:id/retry */
export const retry = async (req, res) => {
  try {
    res.json(await orders.retryOrder(req.params.id, req.user));
  } catch (error) {
    fail(res, error, "Could not send the purchase order again");
  }
};
