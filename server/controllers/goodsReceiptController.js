import * as receipts from "../repository/goodsReceipts.js";

/**
 * Goods receipts (from a bill, against a SAP PO) and nil-value stock
 * additions, for the Engineering Stock screen. See repository/goodsReceipts.js.
 */

const fail = (res, error, fallback = "Something went wrong") => {
  if ([400, 403, 404].includes(error?.status)) return res.status(error.status).json({ message: error.message });
  if (error?.status === 417) return res.status(400).json({ message: error.message });
  console.error(`${fallback}:`, error.message);
  return res.status(500).json({ message: fallback });
};

/** @route GET /api/goods-receipts */
export const list = async (req, res) => {
  try {
    res.json(
      await receipts.listReceipts({
        status: req.query.status || "",
        kind: req.query.kind || "",
        limit: Math.min(Number(req.query.limit) || 100, 300),
      })
    );
  } catch (error) {
    fail(res, error, "Could not load goods receipts");
  }
};

/** @route GET /api/goods-receipts/:id */
export const detail = async (req, res) => {
  try {
    const found = await receipts.getReceipt(req.params.id);
    if (!found) return res.status(404).json({ message: "Receipt not found" });
    res.json(found);
  } catch (error) {
    fail(res, error, "Could not load the receipt");
  }
};

/** @route GET /api/goods-receipts/open-po?company=MRPPL */
export const openPo = async (req, res) => {
  try {
    res.json(await receipts.openPurchaseOrders(req.query.company || ""));
  } catch (error) {
    fail(res, error, "Could not load the open purchase orders");
  }
};

/** @route POST /api/goods-receipts/refresh-po */
export const refreshPo = async (req, res) => {
  try {
    res.json(await receipts.refreshPurchaseOrders(req.user));
  } catch (error) {
    fail(res, error, "Could not ask SAP for the purchase orders");
  }
};

/** @route POST /api/goods-receipts */
export const createGoodsReceipt = async (req, res) => {
  try {
    res.status(201).json(await receipts.createGoodsReceipt(req.body, req.user));
  } catch (error) {
    fail(res, error, "Could not save the goods receipt");
  }
};

/** @route POST /api/goods-receipts/stock-addition */
export const createStockAddition = async (req, res) => {
  try {
    res.status(201).json(await receipts.createStockAddition(req.body, req.user));
  } catch (error) {
    fail(res, error, "Could not save the stock addition");
  }
};

/** @route POST /api/goods-receipts/:id/retry */
export const retry = async (req, res) => {
  try {
    res.json(await receipts.retryReceipt(req.params.id, req.user));
  } catch (error) {
    fail(res, error, "Could not send the receipt again");
  }
};
