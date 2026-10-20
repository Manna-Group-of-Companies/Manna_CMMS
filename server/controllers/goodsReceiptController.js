import * as receipts from "../repository/goodsReceipts.js";
import * as hsn from "../repository/hsnRequests.js";
import { scopeFor, withinCompany } from "../repository/plantScope.js";

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
        // A plant head's own company only; everyone else sees the lot.
        onlyCompanies: (await scopeFor(req.user)).companies,
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
    // Another company's receipt is missing rather than forbidden - the same
    // answer an unknown id gets.
    if (!found || !withinCompany(await scopeFor(req.user), found.company)) {
      return res.status(404).json({ message: "Receipt not found" });
    }
    res.json(found);
  } catch (error) {
    fail(res, error, "Could not load the receipt");
  }
};

/** @route GET /api/goods-receipts/open-po?company=MRPPL */
export const openPo = async (req, res) => {
  try {
    const company = req.query.company || "";
    if (!withinCompany(await scopeFor(req.user), company)) {
      return res.status(403).json({ message: "That SAP company is not yours to receive for." });
    }
    res.json(await receipts.openPurchaseOrders(company));
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
    const { companies } = await scopeFor(req.user);
    res.status(201).json(await receipts.createGoodsReceipt(req.body, req.user, { onlyCompanies: companies }));
  } catch (error) {
    fail(res, error, "Could not save the goods receipt");
  }
};

/** @route POST /api/goods-receipts/stock-addition */
export const createStockAddition = async (req, res) => {
  try {
    const { companies } = await scopeFor(req.user);
    res.status(201).json(await receipts.createStockAddition(req.body, req.user, { onlyCompanies: companies }));
  } catch (error) {
    fail(res, error, "Could not save the stock addition");
  }
};

/** @route POST /api/goods-receipts/:id/retry */
export const retry = async (req, res) => {
  try {
    const found = await receipts.getReceipt(req.params.id);
    if (!found || !withinCompany(await scopeFor(req.user), found.company)) {
      return res.status(404).json({ message: "Receipt not found" });
    }
    res.json(await receipts.retryReceipt(req.params.id, req.user));
  } catch (error) {
    fail(res, error, "Could not send the receipt again");
  }
};

/** @route DELETE /api/goods-receipts/:id - one still waiting to post, with its waiting HSN requests */
export const remove = async (req, res) => {
  try {
    const found = await receipts.getReceipt(req.params.id);
    if (!found || !withinCompany(await scopeFor(req.user), found.company)) {
      return res.status(404).json({ message: "Receipt not found" });
    }
    res.json(await receipts.deleteReceipt(req.params.id));
  } catch (error) {
    fail(res, error, "Could not delete the receipt");
  }
};

/** A failed HSN request, if it is in this reader's companies. */
const inScopeHsn = async (req) => {
  const company = await hsn.hsnRequestCompany(req.params.id);
  return Boolean(company) && withinCompany(await scopeFor(req.user), company);
};

/** @route POST /api/goods-receipts/hsn-requests/:id/retry - a failed new HSN code, sent again */
export const resendHsn = async (req, res) => {
  try {
    if (!(await inScopeHsn(req))) return res.status(404).json({ message: "HSN request not found" });
    res.json(await hsn.resendHsnRequest(req.params.id, req.user));
  } catch (error) {
    fail(res, error, "Could not send the HSN code again");
  }
};

/** @route PUT /api/goods-receipts/hsn-requests/:id - { hsnCode }: a failed new HSN code, corrected */
export const correctHsn = async (req, res) => {
  try {
    if (!(await inScopeHsn(req))) return res.status(404).json({ message: "HSN request not found" });
    res.json(await hsn.correctHsnRequest(req.params.id, req.body?.hsnCode, req.user));
  } catch (error) {
    fail(res, error, "Could not correct the HSN code");
  }
};
